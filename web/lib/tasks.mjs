// My tasks: GET /api/tasks — the open tasks assigned to you in Productive (productive.io), for the
// "My tasks" screen (a click starts a session about one). Not host-specific: the server the browser
// asked answers with its own credentials (config `web.tasks.productive`, see ARCHITECTURE.md → Config).
//
// Credentials: `$PRODUCTIVE_AUTH_TOKEN`, else the macOS Keychain item `web.tasks.productive.keychain`
// (`security find-generic-password -s <service> [-a <account>] -w` — a launchd service has no shell
// env). The value is either a bare personal access token (then `organizationId` + `personId` come
// from the config) or a base64 JSON envelope `{ organization_id, person_id, personal_access_token, … }`;
// only the token itself is ever sent (`X-Auth-Token`).
//
// Productive's JSON:API: `GET /tasks?filter[assignee_id]=<person>&filter[status]=1` (open)
// `&filter[project.status]=1` (in an active project: an archived project's tasks stay open in
// Productive, but its own app hides them too), with the project and workflow status included,
// newest first, every page. Answers are cached (60 s,
// `refresh` skips it); a failed refresh serves the last answer with `stale` + `error`.
//
// Status changes (the one write): `statuses(id)` lists the workflow statuses one of those open tasks
// may move to (`GET /workflow_statuses?filter[project_id]=<its project>` — Productive accepts only its
// project's workflow's statuses), `setStatus(id, statusId)` PATCHes the task's `workflow_status`
// relationship after checking the id is one of them, then drops the list cache.

import path from 'node:path';

// config.mjs imports this module too; both are only read inside functions, so the cycle is harmless.
import { expandHome, MODEL_ID_RE } from './config.mjs';
import { HttpError } from './http.mjs';

export const DEFAULT_API_URL = 'https://api.productive.io/api/v2';
export const DEFAULT_APP_URL = 'https://app.productive.io';
export const TOKEN_ENV = 'PRODUCTIVE_AUTH_TOKEN';
const PAGE_SIZE = 200;
/** 2000 open tasks is plenty for a list; past it the answer says `truncated`. */
const MAX_PAGES = 10;
const CACHE_MS = 60 * 1000;
/** A task's project and status, and where it sits: its parent and its subtask tree's root. */
const TASK_INCLUDE = 'project,workflow_status,parent_task,root_task';
/** Task ids per dependencies request (the query string stays short). */
const DEPENDENCY_CHUNK = 100;
/** A Keychain read is a process: keep the credentials a while (a 401 drops them). */
const CREDS_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 20 * 1000;
const ID_RE = /^[0-9]{1,20}$/;
/** A workflow's statuses change rarely: keep them a while per project (a status change re-reads the task). */
const STATUSES_MS = 10 * 60 * 1000;
const STATUSES_PAGE_SIZE = 200;
const KEYCHAIN_NAME_RE = /^[^\0\n]{1,200}$/;

/** Workflow status categories (Productive's `category_id`). */
const CATEGORIES = { 1: 'notStarted', 2: 'started', 3: 'closed' };

/**
 * Productive's colour palette names by colour index: a workflow status's `color_id` and a project's
 * `project_color_id` index this list (its web app's `colorIndexToNameMap`, utils/custom-colors.ts).
 */
export const PALETTE_NAMES = Object.freeze([
  'canary', 'orange', 'fuchsia', 'lime-green', 'blue', 'electric', 'burgundy', 'celtic-blue', 'turquoise',
  'concrete', 'logan', 'yellow', 'azure', 'red', 'green', 'cyan', 'white',
]);
const paletteAt = (index) => {
  const s = String(index ?? '').trim();
  return /^[0-9]{1,3}$/.test(s) ? (PALETTE_NAMES[Number(s)] ?? null) : null;
};
/** A workflow status's colour as Productive shows it: its `color_id`, else picked by its id. */
const statusPalette = (status) => {
  if (!status) return null;
  const named = paletteAt(status.attributes?.color_id);
  if (named) return named;
  const id = Number.parseInt(String(status.id), 10);
  return PALETTE_NAMES[(Number.isFinite(id) ? id : 0) % PALETTE_NAMES.length];
};

const isObject = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
const optId = (v, key) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (!ID_RE.test(s)) throw new Error(`config.web.tasks.productive.${key} must be a numeric id`);
  return s;
};
const optUrl = (v, key) => {
  if (v == null) return null;
  if (typeof v !== 'string' || !/^https?:\/\/[^\s]+$/.test(v.trim())) throw new Error(`config.web.tasks.productive.${key} must be an http(s) URL`);
  return v.trim().replace(/\/+$/, '');
};

/** What a quick start's `prompt` may name: `{url}`, `{title}`, `{number}`, `{id}` (the task's). */
export const QUICK_START_PLACEHOLDERS = Object.freeze(['url', 'title', 'number', 'id']);
const MAX_QUICK_STARTS = 8;
const MAX_QUICK_START_LABEL = 40;
/** Leaves room for the task's link and title inside the spawn route's 8000-char prompt. */
const MAX_QUICK_START_PROMPT = 4000;
/** A workflow status name (`setStatus`), as Productive allows. */
const MAX_STATUS_NAME = 100;

/**
 * `web.tasks.quickStart` → `[{ id, label, prompt, dir: { label } | { path }, model, worktree, setStatus }]`
 * (`[]` when unset). One object or an array of them: `{ label, prompt, dir, model?, worktree?, setStatus? }`.
 * `prompt` is a template (QUICK_START_PLACEHOLDERS; any other `{word}` is an error, so a typo shows at
 * start); `dir` is the label of one of this host's start directories (`spawnDirs`: the offered
 * `[{ label, path }]`) or an absolute / `~` path (the spawn route still checks it against the
 * allow-list). `setStatus`: a workflow status name the UI offers to move the task to once the session
 * started (resolved within each task's own workflow, case-insensitively; it asks first). Throws on a bad shape.
 */
export function normalizeQuickStart(raw, { spawnDirs = [], home } = {}) {
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  if (list.length > MAX_QUICK_STARTS) throw new Error(`config.web.tasks.quickStart has more than ${MAX_QUICK_STARTS} entries`);
  const seen = new Set();
  return list.map((q, i) => {
    const key = Array.isArray(raw) ? `config.web.tasks.quickStart[${i}]` : 'config.web.tasks.quickStart';
    if (!isObject(q)) throw new Error(`${key} must be an object { label, prompt, dir, model?, worktree? }`);
    const label = typeof q.label === 'string' ? q.label.trim() : '';
    if (!label || label.length > MAX_QUICK_START_LABEL) throw new Error(`${key}.label must be 1-${MAX_QUICK_START_LABEL} characters`);
    if (seen.has(label.toLowerCase())) throw new Error(`${key}.label "${label}" is used twice`);
    seen.add(label.toLowerCase());
    if (typeof q.prompt !== 'string' || !q.prompt.trim() || q.prompt.length > MAX_QUICK_START_PROMPT) {
      throw new Error(`${key}.prompt must be a non-empty string of at most ${MAX_QUICK_START_PROMPT} characters`);
    }
    for (const m of q.prompt.matchAll(/\{([A-Za-z_]+)\}/g)) {
      if (!QUICK_START_PLACEHOLDERS.includes(m[1])) {
        throw new Error(`${key}.prompt has an unknown placeholder {${m[1]}} (use ${QUICK_START_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')})`);
      }
    }
    const d = typeof q.dir === 'string' ? q.dir.trim() : '';
    if (!d) throw new Error(`${key}.dir must be a start directory label or a path`);
    let dir;
    if (d.startsWith('/') || d === '~' || d.startsWith('~/')) {
      const abs = expandHome(d, home);
      if (!path.isAbsolute(abs)) throw new Error(`${key}.dir must be absolute or start with ~: ${d}`);
      dir = { path: path.normalize(abs).replace(/(.)\/+$/, '$1') };
    } else {
      if (!spawnDirs.some((s) => s.label === d)) {
        const labels = spawnDirs.map((s) => s.label).join(', ') || 'none';
        throw new Error(`${key}.dir "${d}" is not one of this host's start directories (spawnDirs labels: ${labels}) nor an absolute or ~ path`);
      }
      dir = { label: d };
    }
    let model = null;
    if (q.model != null && q.model !== '') {
      if (typeof q.model !== 'string' || !MODEL_ID_RE.test(q.model)) throw new Error(`${key}.model must be a model id (letters, digits and ._[]/:-)`);
      model = q.model;
    }
    if (q.worktree != null && typeof q.worktree !== 'boolean') throw new Error(`${key}.worktree must be true or false`);
    let setStatus = null;
    if (q.setStatus != null && q.setStatus !== '') {
      const st = typeof q.setStatus === 'string' ? q.setStatus.trim() : '';
      if (!st || st.length > MAX_STATUS_NAME || /[\0-\x1f]/.test(st)) throw new Error(`${key}.setStatus must be a workflow status name (1-${MAX_STATUS_NAME} characters, one line)`);
      setStatus = st;
    }
    return { id: String(i), label, prompt: q.prompt, dir, model, worktree: q.worktree === true, setStatus };
  });
}

/**
 * The quick starts as /api/settings shows them: `dir` resolved against this host's start directories
 * now (Settings → Start directories may have changed them since start) — an absolute path, or null
 * with `error` when its label is gone.
 */
export function quickStartView(quickStart, spawnDirs = []) {
  return (quickStart ?? []).map(({ id, label, prompt, dir, model, worktree, setStatus = null }) => {
    const found = dir.label != null ? spawnDirs.find((s) => s.label === dir.label) : null;
    const resolved = dir.path ?? found?.path ?? null;
    return {
      id,
      label,
      prompt,
      dir: resolved,
      dirLabel: dir.label ?? null,
      model,
      worktree,
      setStatus,
      ...(resolved ? {} : { error: `start directory "${dir.label}" is not configured on this host any more` }),
    };
  });
}

/**
 * `web.tasks` → the tasks settings, or null (off). On when `web.tasks.productive` is an object or
 * `$PRODUCTIVE_AUTH_TOKEN` is set. Throws on a bad shape (a config error, like every other key);
 * `quickStart` is checked even while tasks are off. `opts`: this host's offered `spawnDirs` and `home`
 * (for `quickStart.dir`).
 */
export function normalizeTasksConfig(raw, env = process.env, opts = {}) {
  const wt = raw == null ? {} : raw;
  if (!isObject(wt)) throw new Error('config.web.tasks must be an object { productive, quickStart }');
  const quickStart = normalizeQuickStart(wt.quickStart, opts);
  const p = wt.productive;
  if (p == null) return env[TOKEN_ENV]?.trim() ? { provider: 'productive', keychain: null, organizationId: null, personId: null, orgSlug: null, apiUrl: DEFAULT_API_URL, appUrl: DEFAULT_APP_URL, quickStart } : null;
  if (!isObject(p)) throw new Error('config.web.tasks.productive must be an object { keychain, organizationId, personId, orgSlug }');
  let keychain = null;
  if (p.keychain != null) {
    const k = p.keychain;
    if (!isObject(k) || typeof k.service !== 'string' || !KEYCHAIN_NAME_RE.test(k.service.trim())) {
      throw new Error('config.web.tasks.productive.keychain must be an object { service, account? } naming a Keychain item');
    }
    if (k.account != null && (typeof k.account !== 'string' || !KEYCHAIN_NAME_RE.test(k.account.trim()))) {
      throw new Error('config.web.tasks.productive.keychain.account must be a non-empty string');
    }
    keychain = { service: k.service.trim(), account: k.account?.trim() || null };
  }
  if (p.orgSlug != null && (typeof p.orgSlug !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(p.orgSlug.trim()))) {
    throw new Error('config.web.tasks.productive.orgSlug must be letters, digits, - and _ (the part after "<org id>-" in a task link)');
  }
  return {
    provider: 'productive',
    keychain,
    organizationId: optId(p.organizationId, 'organizationId'),
    personId: optId(p.personId, 'personId'),
    orgSlug: p.orgSlug?.trim() || null,
    apiUrl: optUrl(p.apiUrl, 'apiUrl') ?? DEFAULT_API_URL,
    appUrl: optUrl(p.appUrl, 'appUrl') ?? DEFAULT_APP_URL,
    quickStart,
  };
}

/**
 * A stored token → `{ token, organizationId, personId }`. The envelope (base64 JSON with
 * `personal_access_token`) carries the ids; a bare token has none (null).
 */
export function decodeToken(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^[A-Za-z0-9+/=_-]{40,}$/.test(raw)) {
    try {
      const env = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      if (isObject(env) && typeof env.personal_access_token === 'string' && env.personal_access_token.trim()) {
        const id = (v) => (v != null && ID_RE.test(String(v)) ? String(v) : null);
        return { token: env.personal_access_token.trim(), organizationId: id(env.organization_id), personId: id(env.person_id) };
      }
    } catch {
      /* not an envelope: a bare token */
    }
  }
  return { token: raw, organizationId: null, personId: null };
}

/** The org part of an app link: `<id>-<name, dasherized>` (as Productive's own `organization.slug`). */
export function orgSlug(id, name) {
  const dashed = `${id}-${name ?? ''}`
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[ _]/g, '-');
  return dashed.replace(/[^a-z0-9\-_]+/g, '-');
}

const toMs = (v) => {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** A related task (a parent, the root of a subtask tree, a dependency's other end): enough to name and link it. */
function taskRef(t, { appUrl, slug }) {
  if (!t?.id || !ID_RE.test(String(t.id))) return null;
  const a = t.attributes ?? {};
  const number = a.number ?? a.task_number ?? null;
  return {
    id: String(t.id),
    number: number == null ? null : String(number),
    title: typeof a.title === 'string' ? a.title : '',
    url: `${appUrl}/${slug}/tasks/${t.id}`,
    keyTask: String(a.type_id) === '3',
    closed: typeof a.closed_at === 'string' && a.closed_at !== '',
  };
}

const count = (total, open) => {
  const n = Number(total);
  return Number.isFinite(n) && n > 0 ? { total: n, open: Math.max(0, Number(open) || 0) } : null;
};

/** Productive's dependency `type_id` as seen from its `task`: it blocks the dependent task, waits on it, or is linked. */
const DEPENDENCY_KINDS = { 1: 'blocks', 2: 'waitingOn', 3: 'linked' };

/** One JSON:API task (+ the `included` index) → the stable Task shape. */
export function mapTask(t, included, { appUrl, slug }) {
  const a = t.attributes ?? {};
  const rel = (name) => {
    const d = t.relationships?.[name]?.data;
    return d ? (included.get(`${d.type}:${d.id}`) ?? null) : null;
  };
  const project = rel('project');
  const status = rel('workflow_status');
  const number = a.number ?? a.task_number ?? null;
  return {
    id: String(t.id),
    number: number == null ? null : String(number),
    title: typeof a.title === 'string' ? a.title : '',
    url: `${appUrl}/${slug}/tasks/${t.id}`,
    project: typeof project?.attributes?.name === 'string' ? project.attributes.name : null,
    status: typeof status?.attributes?.name === 'string' ? status.attributes.name : null,
    statusCategory: CATEGORIES[status?.attributes?.category_id] ?? null,
    statusColor: statusPalette(status),
    projectColor: paletteAt(project?.attributes?.project_color_id),
    dueDate: typeof a.due_date === 'string' && a.due_date ? a.due_date : null,
    updatedAt: toMs(a.updated_at),
    // Its place in the work: a key task (Productive's milestone), its parent and the subtask tree's root
    // (when that is not the parent), its subtasks and todos, its dependencies (filled by withDependencies).
    keyTask: String(a.type_id) === '3',
    parent: taskRef(rel('parent_task'), { appUrl, slug }),
    root: t.relationships?.root_task?.data?.id && t.relationships.root_task.data.id !== t.relationships?.parent_task?.data?.id ? taskRef(rel('root_task'), { appUrl, slug }) : null,
    subtasks: count(a.subtask_count, a.open_subtask_count),
    todos: count(a.todo_count, a.open_todo_count),
    dependencyCount: Number(a.task_dependency_count) || 0,
    dependencies: [],
  };
}

/**
 * @param {object} opts
 *   settings  normalizeTasksConfig() (non-null)
 *   run       lib/run.mjs (the Keychain read)
 *   fetch     injectable for tests
 *   env, platform, now
 * @returns {{ list({ refresh }): Promise<TasksResponse> }}  throws HttpError
 */
export function createTasks({ settings, run, fetch = globalThis.fetch, env = process.env, platform = process.platform, now = Date.now, log = () => {} }) {
  let creds = null; // { token, organizationId, personId, at }
  let slug = null; // `<org id>-<name>`, once known
  let cache = null; // { body, at }
  let inflight = null;
  let generation = 0; // bumped by a status change: a list fetched before it is not cached
  const statusCache = new Map(); // project id → { statuses, at }

  async function readKeychain() {
    const k = settings.keychain;
    if (!k || platform !== 'darwin' || !run) return null;
    const args = ['find-generic-password', '-s', k.service, ...(k.account ? ['-a', k.account] : []), '-w'];
    try {
      const { stdout } = await run('security', args, { timeout: 5000 });
      return stdout.trim() || null;
    } catch {
      return null; // not in the Keychain, or it is locked
    }
  }

  async function credentials() {
    if (creds && now() - creds.at < CREDS_MS) return creds;
    const stored = env[TOKEN_ENV]?.trim() || (await readKeychain());
    const where = settings.keychain ? `$${TOKEN_ENV} or the Keychain item "${settings.keychain.service}"` : `$${TOKEN_ENV}`;
    if (!stored) throw new HttpError(`tasks: no Productive token on this server (${where})`, 501);
    const d = decodeToken(stored);
    const organizationId = settings.organizationId ?? d.organizationId;
    const personId = settings.personId ?? d.personId;
    if (!organizationId || !personId) {
      throw new HttpError('tasks: a bare Productive token needs web.tasks.productive.organizationId and personId', 501);
    }
    creds = { token: d.token, organizationId, personId, at: now() };
    return creds;
  }

  async function get(c, pathAndQuery, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(`${settings.apiUrl}${pathAndQuery}`, {
        method,
        headers: { 'X-Auth-Token': c.token, 'X-Organization-Id': c.organizationId, 'Content-Type': 'application/vnd.api+json', Accept: 'application/vnd.api+json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError';
      throw new HttpError(timedOut ? 'tasks: Productive timed out' : `tasks: Productive unreachable: ${err?.message ?? err}`, timedOut ? 504 : 502);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      // The token's problems are this server's, not the caller's: 502, never a 401 the UI would misread.
      if (res.status === 401 || res.status === 403) creds = null;
      const detail = data?.errors?.[0]?.detail || data?.errors?.[0]?.title || `HTTP ${res.status}`;
      log(`tasks: Productive ${res.status} on ${method} ${pathAndQuery.split('?')[0]}: ${detail}`);
      // A write Productive refused on its merits (an archived workflow, a permission): the caller's 409.
      if (method !== 'GET' && (res.status === 422 || res.status === 403)) throw new HttpError(`tasks: Productive refused the change: ${detail}`, 409);
      throw new HttpError(res.status === 401 ? 'tasks: Productive rejected the token (401)' : `tasks: Productive answered ${res.status}: ${detail}`, 502);
    }
    if (!isObject(data)) throw new HttpError('tasks: Productive sent no JSON', 502);
    return data;
  }

  /** `<org id>-<slug>`: configured, else from the organization's name (once), else the bare id. */
  async function linkSlug(c) {
    if (slug) return slug;
    if (settings.orgSlug) return (slug = `${c.organizationId}-${settings.orgSlug}`);
    try {
      const org = await get(c, `/organizations/${c.organizationId}`);
      const name = org?.data?.attributes?.name;
      if (typeof name === 'string' && name.trim()) return (slug = orgSlug(c.organizationId, name.trim()));
    } catch (err) {
      log(`tasks: organization name unavailable (${err.message}); links use the bare id`);
    }
    return c.organizationId; // the app resolves the org by the leading id; not cached, so the next fetch tries again
  }

  async function fetchAll() {
    const c = await credentials();
    const s = await linkSlug(c);
    const tasks = [];
    const raw = [];
    const included = new Map();
    let truncated = false;
    for (let page = 1; ; page++) {
      const q = new URLSearchParams({
        'filter[assignee_id]': c.personId,
        'filter[status]': '1',
        'filter[project.status]': '1',
        include: TASK_INCLUDE,
        sort: '-updated_at',
        'page[size]': String(PAGE_SIZE),
        'page[number]': String(page),
      });
      const body = await get(c, `/tasks?${q}`);
      for (const i of Array.isArray(body.included) ? body.included : []) included.set(`${i.type}:${i.id}`, i);
      for (const t of Array.isArray(body.data) ? body.data : []) {
        raw.push(t);
        // JSON:API never repeats a primary resource in `included`: a parent that is one of your tasks too is only here.
        included.set(`tasks:${t.id}`, t);
      }
      const pages = Number(body.meta?.total_pages) || 1;
      if (page >= pages || !body.data?.length) break;
      if (page >= MAX_PAGES) {
        truncated = true;
        break;
      }
    }
    for (const t of raw) tasks.push(mapTask(t, included, { appUrl: settings.appUrl, slug: s }));
    await withDependencies(c, s, tasks);
    return { source: 'productive', fetchedAt: now(), stale: false, error: null, truncated, count: tasks.length, tasks };
  }

  /**
   * Fills `dependencies` of the tasks that have any (`GET /task_dependencies?filter[task_id]=…`, the other
   * end included): `[{ kind, task }]`, kind as seen from this task. A failure leaves them empty (logged):
   * the list matters more than its links.
   */
  async function withDependencies(c, s, tasks) {
    const byId = new Map(tasks.filter((t) => t.dependencyCount > 0).map((t) => [t.id, t]));
    const ids = [...byId.keys()];
    try {
      for (let i = 0; i < ids.length; i += DEPENDENCY_CHUNK) {
        for (let page = 1; page <= MAX_PAGES; page++) {
          const q = new URLSearchParams({
            'filter[task_id]': ids.slice(i, i + DEPENDENCY_CHUNK).join(','),
            include: 'task,dependent_task',
            'page[size]': String(PAGE_SIZE),
            'page[number]': String(page),
          });
          const body = await get(c, `/task_dependencies?${q}`);
          const included = new Map((Array.isArray(body.included) ? body.included : []).map((x) => [`${x.type}:${x.id}`, x]));
          for (const d of Array.isArray(body.data) ? body.data : []) {
            const owner = byId.get(String(d.relationships?.task?.data?.id ?? ''));
            const other = d.relationships?.dependent_task?.data;
            const kind = DEPENDENCY_KINDS[d.attributes?.type_id];
            const ref = other ? taskRef(included.get(`tasks:${other.id}`) ?? { id: other.id }, { appUrl: settings.appUrl, slug: s }) : null;
            if (owner && kind && ref && !owner.dependencies.some((x) => x.task.id === ref.id && x.kind === kind)) owner.dependencies.push({ kind, task: ref });
          }
          if (page >= (Number(body.meta?.total_pages) || 1) || !body.data?.length) break;
        }
      }
    } catch (err) {
      log(`tasks: dependencies unavailable (${err.message})`);
    }
  }

  async function list({ refresh = false } = {}) {
    if (!refresh && cache && now() - cache.at < CACHE_MS) return cache.body;
    if (!inflight) {
      const at = generation;
      inflight = fetchAll()
        .then((body) => {
          // A status change since this fetch started: its answer may predate it, so it is not kept.
          if (at === generation) cache = { body, at: now() };
          return body;
        })
        .finally(() => {
          inflight = null;
        });
    }
    try {
      return await inflight;
    } catch (err) {
      // Not configured (501) is not a hiccup: say so even with an old answer around.
      if (cache && err?.status !== 501) return { ...cache.body, stale: true, error: String(err.message) };
      throw err;
    }
  }

  /** One of your open tasks (as /api/tasks lists it), else 404: the status routes touch nothing else. */
  async function ownTask(id) {
    const key = String(id ?? '');
    if (!ID_RE.test(key)) throw new HttpError('task id must be numeric', 400);
    const body = await list();
    if (!body.tasks.some((t) => t.id === key)) throw new HttpError(`task ${key} is not one of your open tasks`, 404);
    return key;
  }

  /** The task as Productive has it now: the stable shape + its project and workflow status ids. */
  async function readTask(c, id) {
    const s = await linkSlug(c);
    const body = await get(c, `/tasks/${id}?include=${TASK_INCLUDE}`);
    if (!isObject(body.data)) throw new HttpError('tasks: Productive sent no task', 502);
    const included = new Map((Array.isArray(body.included) ? body.included : []).map((i) => [`${i.type}:${i.id}`, i]));
    const projectId = body.data.relationships?.project?.data?.id;
    const statusId = body.data.relationships?.workflow_status?.data?.id;
    return {
      task: mapTask(body.data, included, { appUrl: settings.appUrl, slug: s }),
      projectId: projectId != null && ID_RE.test(String(projectId)) ? String(projectId) : null,
      statusId: statusId != null && ID_RE.test(String(statusId)) ? String(statusId) : null,
    };
  }

  /** A project's workflow statuses, in Productive's order: `[{ id, name, category, color, position }]`. */
  async function projectStatuses(c, projectId, { fresh = false } = {}) {
    const hit = statusCache.get(projectId);
    if (!fresh && hit && now() - hit.at < STATUSES_MS) return hit.statuses;
    const q = new URLSearchParams({ 'filter[project_id]': projectId, 'page[size]': String(STATUSES_PAGE_SIZE) });
    const body = await get(c, `/workflow_statuses?${q}`);
    const statuses = (Array.isArray(body.data) ? body.data : [])
      .filter((st) => st && ID_RE.test(String(st.id)) && typeof st.attributes?.name === 'string')
      .map((st) => ({
        id: String(st.id),
        name: st.attributes.name,
        category: CATEGORIES[st.attributes.category_id] ?? null,
        color: statusPalette(st),
        position: Number.isFinite(Number(st.attributes.position)) ? Number(st.attributes.position) : null,
      }))
      .sort((a, b) => (a.position ?? Infinity) - (b.position ?? Infinity) || Number(a.id) - Number(b.id));
    statusCache.set(projectId, { statuses, at: now() });
    return statuses;
  }

  /** GET /api/tasks/:id/statuses — the statuses one of your open tasks may move to, and its current one. */
  async function statuses(id) {
    const key = await ownTask(id);
    const c = await credentials();
    const t = await readTask(c, key);
    if (!t.projectId) throw new HttpError(`task ${key} has no project, so no workflow`, 409);
    return { taskId: key, projectId: t.projectId, current: t.statusId, statuses: await projectStatuses(c, t.projectId) };
  }

  /**
   * POST /api/tasks/:id/status — move one of your open tasks to `statusId`, one of its workflow's
   * statuses (re-read fresh, so a renamed / removed status is caught). `{ ok, changed, task }`; already
   * there → `changed: false`, nothing written.
   */
  async function setStatus(id, statusId) {
    const sid = typeof statusId === 'number' && Number.isSafeInteger(statusId) ? String(statusId) : statusId;
    if (typeof sid !== 'string' || !ID_RE.test(sid)) throw new HttpError('statusId must be a numeric workflow status id', 400);
    const key = await ownTask(id);
    const c = await credentials();
    const before = await readTask(c, key);
    if (!before.projectId) throw new HttpError(`task ${key} has no project, so no workflow`, 409);
    const allowed = await projectStatuses(c, before.projectId, { fresh: true });
    const target = allowed.find((st) => st.id === sid);
    if (!target) throw new HttpError(`status ${sid} is not in task ${key}'s workflow`, 400);
    if (before.statusId === sid) return { ok: true, changed: false, task: before.task };
    await get(c, `/tasks/${key}`, {
      method: 'PATCH',
      body: { data: { type: 'tasks', id: key, relationships: { workflow_status: { data: { type: 'workflow_statuses', id: sid } } } } },
    });
    log(`tasks: moved task ${key} to status ${sid} (${target.name})`);
    // A single read has no dependencies: the listed task's carry over.
    const listed = cache?.body?.tasks?.find((t) => t.id === key) ?? null;
    generation += 1;
    cache = null;
    const after = await readTask(c, key).catch(() => null);
    const task = after?.task
      ? { ...after.task, dependencies: listed?.dependencies ?? [] }
      : { ...before.task, status: target.name, statusCategory: target.category, statusColor: target.color };
    return { ok: true, changed: true, task };
  }

  return { list, statuses, setStatus };
}
