// My tasks: lib/tasks.mjs (Productive, fetch + Keychain faked) and GET /api/tasks. No network
// beyond 127.0.0.1; every id, name and token here is made up.
import test from 'node:test';
import assert from 'node:assert/strict';

import { createApi } from '../lib/api.mjs';
import { createHttpServer } from '../lib/app.mjs';
import { createFleet } from '../lib/fleet.mjs';
import { createFleetCli } from '../lib/fleet-cli.mjs';
import { normalizeConfig } from '../lib/config.mjs';
import { createTasks, decodeToken, mapTask, normalizeQuickStart, normalizeTasksConfig, orgSlug, PALETTE_NAMES, quickStartView } from '../lib/tasks.mjs';

const envelope = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const ENVELOPE = envelope({ organization_id: 42, person_id: 7001, user_id: 9, user_email: 'me@example.com', personal_access_token: 'pat-abc' });

function task(id, { title = `Task ${id}`, number = String(id), project = '1', status = '11', due = null, updated = '2026-01-02T10:00:00.000+01:00' } = {}) {
  return {
    id: String(id),
    type: 'tasks',
    attributes: { title, number, task_number: number, due_date: due, updated_at: updated, closed: false },
    relationships: { project: { data: { type: 'projects', id: project } }, workflow_status: { data: { type: 'workflow_statuses', id: status } } },
  };
}
const INCLUDED = [
  { id: '1', type: 'projects', attributes: { name: 'Website', project_color_id: 14 } },
  { id: '2', type: 'projects', attributes: { name: 'Mobile app' } },
  { id: '11', type: 'workflow_statuses', attributes: { name: 'To do', color_id: '9', category_id: 1 } },
  { id: '12', type: 'workflow_statuses', attributes: { name: 'In progress', color_id: '11', category_id: 2 } },
];

/** A fake Productive: `pages` = arrays of tasks; records every request. */
function fakeProductive({ pages = [[task(1), task(2, { project: '2', status: '12', due: '2026-02-01' })]], orgName = 'Acme Studio', status = 200 } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers });
    const json = (body, s = 200) => ({ ok: s >= 200 && s < 300, status: s, json: async () => body });
    if (status !== 200) return json({ errors: [{ status: String(status), title: 'Unauthorized' }] }, status);
    if (u.pathname.endsWith('/organizations/42')) return json({ data: { id: '42', type: 'organizations', attributes: { name: orgName } } });
    if (u.pathname.endsWith('/tasks')) {
      const n = Number(u.searchParams.get('page[number]'));
      return json({ data: pages[n - 1] ?? [], included: INCLUDED, meta: { current_page: n, total_pages: pages.length, total_count: pages.flat().length } });
    }
    return json({ errors: [{ title: 'not found' }] }, 404);
  };
  return { fetch, calls };
}

function keychain(value) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, ...args]);
    if (value == null) throw new Error('The specified item could not be found in the keychain.');
    return { stdout: `${value}\n`, stderr: '' };
  };
  return { run, calls };
}

const SETTINGS = normalizeTasksConfig({ productive: { keychain: { service: 'TEST_SERVICE', account: 'test-account' } } }, {});

test('normalizeTasksConfig: off by default, on with the key or the env token, bad shapes are errors', () => {
  assert.equal(normalizeTasksConfig(undefined, {}), null);
  assert.equal(normalizeTasksConfig({}, {}), null);
  assert.equal(normalizeTasksConfig(undefined, { PRODUCTIVE_AUTH_TOKEN: 'x' }).keychain, null);
  assert.deepEqual(SETTINGS.keychain, { service: 'TEST_SERVICE', account: 'test-account' });
  assert.equal(SETTINGS.apiUrl, 'https://api.productive.io/api/v2');
  const ids = normalizeTasksConfig({ productive: { organizationId: 42, personId: '7001', orgSlug: 'acme', apiUrl: 'http://127.0.0.1:1/api/' } }, {});
  assert.equal(ids.organizationId, '42');
  assert.equal(ids.personId, '7001');
  assert.equal(ids.apiUrl, 'http://127.0.0.1:1/api');
  for (const bad of [[], { productive: 'yes' }, { productive: { keychain: 'x' } }, { productive: { keychain: { account: 'a' } } }, { productive: { organizationId: 'abc' } }, { productive: { orgSlug: 'a b' } }, { productive: { apiUrl: 'ftp://x' } }]) {
    assert.throws(() => normalizeTasksConfig(bad, {}), /config\.web\.tasks/, JSON.stringify(bad));
  }
  // Through the whole config: a bad shape names the key, a good one lands on config.tasks.
  assert.throws(() => normalizeConfig({ web: { tasks: { productive: 1 } } }, { env: {}, home: '/nonexistent' }), /web\.tasks\.productive/);
  assert.equal(normalizeConfig({ web: { tasks: { productive: { keychain: { service: 'S' } } } } }, { env: {}, home: '/nonexistent' }).tasks.keychain.service, 'S');
  assert.equal(normalizeConfig({}, { env: {}, home: '/nonexistent' }).tasks, null);
});

const DIRS = [
  { label: 'work', path: '/home/me/work' },
  { label: 'app', path: '/home/me/app' },
];

test('normalizeQuickStart: one object or a list; dir is a start directory label or a path; defaults', () => {
  assert.deepEqual(normalizeQuickStart(undefined, { spawnDirs: DIRS }), []);
  assert.deepEqual(normalizeQuickStart({ label: ' Orchestrate ', prompt: '/orchestrate {url}', dir: 'work' }, { spawnDirs: DIRS, home: '/home/me' }), [
    { id: '0', label: 'Orchestrate', prompt: '/orchestrate {url}', dir: { label: 'work' }, model: null, worktree: false, setStatus: null },
  ]);
  const two = normalizeQuickStart(
    [
      { label: 'Fix', prompt: 'Fix #{number} ({id}): {title}\n{url}', dir: '~/Code/x/', model: 'claude-opus-5-5', worktree: true, setStatus: ' Working ' },
      { label: 'Look', prompt: 'Look at {url}; {"json": 1} and { url } are plain text', dir: '/srv/repo', model: '' },
    ],
    { spawnDirs: DIRS, home: '/home/me' },
  );
  assert.deepEqual(two[0], { id: '0', label: 'Fix', prompt: 'Fix #{number} ({id}): {title}\n{url}', dir: { path: '/home/me/Code/x' }, model: 'claude-opus-5-5', worktree: true, setStatus: 'Working' });
  assert.deepEqual(two[1].dir, { path: '/srv/repo' });
  assert.equal(two[1].model, null, "'' is the default model");
  assert.equal(two[1].id, '1');
});

test('normalizeQuickStart: bad shapes are config errors naming the key', () => {
  const ok = { label: 'Go', prompt: '{url}', dir: 'work' };
  const cases = [
    ['yes', /quickStart must be an object/],
    [[1], /quickStart\[0\] must be an object/],
    [{ ...ok, label: '' }, /label must be 1-40/],
    [{ ...ok, label: 'x'.repeat(41) }, /label must be 1-40/],
    [[ok, { ...ok, label: 'go' }], /quickStart\[1\]\.label "go" is used twice/],
    [{ ...ok, prompt: '  ' }, /prompt must be a non-empty string/],
    [{ ...ok, prompt: 'x'.repeat(4001) }, /prompt must be a non-empty string/],
    [{ ...ok, prompt: 'see {link}' }, /unknown placeholder \{link\}/],
    [{ ...ok, dir: '' }, /dir must be a start directory label or a path/],
    [{ ...ok, dir: 'nope' }, /dir "nope" is not one of this host's start directories \(spawnDirs labels: work, app\)/],
    [{ ...ok, dir: 'Code/x' }, /dir "Code\/x" is not one of/],
    [{ ...ok, model: 'bad model' }, /model must be a model id/],
    [{ ...ok, worktree: 'yes' }, /worktree must be true or false/],
    [{ ...ok, setStatus: 5 }, /setStatus must be a workflow status name/],
    [{ ...ok, setStatus: '  ' }, /setStatus must be a workflow status name/],
    [{ ...ok, setStatus: 'x'.repeat(101) }, /setStatus must be a workflow status name/],
    [{ ...ok, setStatus: 'Two\nlines' }, /setStatus must be a workflow status name/],
    [Array.from({ length: 9 }, (_, i) => ({ ...ok, label: `q${i}` })), /more than 8 entries/],
  ];
  for (const [bad, re] of cases) assert.throws(() => normalizeQuickStart(bad, { spawnDirs: DIRS, home: '/home/me' }), re, JSON.stringify(bad).slice(0, 80));
});

test('normalizeTasksConfig / normalizeConfig: quickStart lands on config.tasks, checked against this host’s spawnDirs', () => {
  const tasks = { productive: { keychain: { service: 'S' } }, quickStart: { label: 'Orchestrate', prompt: '/orchestrate {url}', dir: 'work' } };
  const cfg = normalizeConfig({ self: 'laptop', spawnDirs: [{ label: 'work', paths: { laptop: '~/work', workstation: '/srv/work' } }, { label: 'other', paths: { workstation: '/srv/o' } }], web: { tasks } }, { env: {}, home: '/home/me' });
  assert.deepEqual(cfg.tasks.quickStart, [{ id: '0', label: 'Orchestrate', prompt: '/orchestrate {url}', dir: { label: 'work' }, model: null, worktree: false, setStatus: null }]);
  assert.deepEqual(normalizeTasksConfig({ productive: {} }, {}).quickStart, []);
  assert.deepEqual(normalizeTasksConfig({ quickStart: { label: 'Home', prompt: '{url}', dir: 'Home' } }, { PRODUCTIVE_AUTH_TOKEN: 'x' }, { spawnDirs: [{ label: 'Home', path: '/h' }] }).quickStart[0].dir, { label: 'Home' });
  // A label only another host has is not a start directory here.
  assert.throws(
    () => normalizeConfig({ self: 'laptop', spawnDirs: [{ label: 'other', paths: { workstation: '/srv/o' } }], web: { tasks: { ...tasks, quickStart: { ...tasks.quickStart, dir: 'other' } } } }, { env: {}, home: '/home/me' }),
    /web\.tasks\.quickStart\.dir "other" is not one of this host's start directories \(spawnDirs labels: Home\)/,
  );
  // Checked even while tasks are off (no productive, no env token): still a config error, still off.
  assert.throws(() => normalizeTasksConfig({ quickStart: { label: 'x' } }, {}), /quickStart\.prompt/);
  assert.equal(normalizeTasksConfig({ quickStart: { label: 'x', prompt: '{url}', dir: '/abs' } }, {}), null);
});

test('quickStartView: the dir resolved against the current start directories; a vanished label → null + error', () => {
  const qs = normalizeQuickStart(
    [
      { label: 'A', prompt: '{url}', dir: 'work' },
      { label: 'B', prompt: '{url}', dir: '/srv/repo', worktree: true, model: 'sonnet', setStatus: 'Working' },
    ],
    { spawnDirs: DIRS },
  );
  assert.deepEqual(quickStartView(qs, DIRS), [
    { id: '0', label: 'A', prompt: '{url}', dir: '/home/me/work', dirLabel: 'work', model: null, worktree: false, setStatus: null },
    { id: '1', label: 'B', prompt: '{url}', dir: '/srv/repo', dirLabel: null, model: 'sonnet', worktree: true, setStatus: 'Working' },
  ]);
  const gone = quickStartView(qs, [{ label: 'app', path: '/home/me/app' }]);
  assert.equal(gone[0].dir, null);
  assert.match(gone[0].error, /"work" is not configured on this host/);
  assert.equal(gone[1].error, undefined);
  assert.deepEqual(quickStartView(undefined, DIRS), []);
});

test('decodeToken: the envelope yields only its token + ids; anything else is a bare token', () => {
  assert.deepEqual(decodeToken(ENVELOPE), { token: 'pat-abc', organizationId: '42', personId: '7001' });
  assert.deepEqual(decodeToken('  plain-token-123 '), { token: 'plain-token-123', organizationId: null, personId: null });
  // Long base64-looking text that is not an envelope stays a bare token.
  const notEnvelope = Buffer.from('just some bytes that are long enough to look like base64').toString('base64');
  assert.equal(decodeToken(notEnvelope).token, notEnvelope);
  assert.equal(decodeToken(''), null);
});

test('orgSlug: like the app’s organization slug', () => {
  assert.equal(orgSlug('42', 'Acme Studio'), '42-acme-studio');
  assert.equal(orgSlug('42', 'Acme'), '42-acme');
  // Byte for byte the app's (`dasherize`, then every other character → `-`): only the id matters to its router.
  assert.equal(orgSlug('42', 'Café & Co.'), '42-caf----co-');
  assert.equal(orgSlug('42', 'BigCorp d.o.o.'), '42-big-corp-d-o-o-');
});

test('mapTask: the stable shape', () => {
  const included = new Map(INCLUDED.map((i) => [`${i.type}:${i.id}`, i]));
  const t = mapTask(task(5, { status: '12', due: '2026-03-04' }), included, { appUrl: 'https://app.example', slug: '42-acme' });
  assert.deepEqual(t, {
    id: '5',
    number: '5',
    title: 'Task 5',
    url: 'https://app.example/42-acme/tasks/5',
    project: 'Website',
    status: 'In progress',
    statusCategory: 'started',
    statusColor: 'yellow',
    projectColor: 'green',
    dueDate: '2026-03-04',
    updatedAt: Date.parse('2026-01-02T10:00:00.000+01:00'),
  });
  const bare = mapTask({ id: 6, attributes: {}, relationships: {} }, new Map(), { appUrl: 'https://app.example', slug: '42' });
  assert.equal(bare.project, null);
  assert.equal(bare.status, null);
  assert.equal(bare.statusCategory, null);
  assert.equal(bare.statusColor, null);
  assert.equal(bare.projectColor, null);
  assert.equal(bare.updatedAt, null);
});

test('mapTask: colours are Productive palette names (its colour index → name map)', () => {
  assert.equal(PALETTE_NAMES.length, 17);
  const map = (status, project) => {
    const included = new Map([
      ['workflow_statuses:20', { id: '20', type: 'workflow_statuses', attributes: { name: 'S', category_id: 1, ...status } }],
      ['projects:3', { id: '3', type: 'projects', attributes: { name: 'P', ...project } }],
    ]);
    return mapTask(task(9, { status: '20', project: '3' }), included, { appUrl: 'https://app.example', slug: '42' });
  };
  // The indices the real API sends: "Working" 11, "Triage" 10, "Backlog" 9, "Paused" 1, "On Latest" 12.
  assert.equal(map({ color_id: '11' }).statusColor, 'yellow');
  assert.equal(map({ color_id: '10' }).statusColor, 'logan');
  assert.equal(map({ color_id: '9' }).statusColor, 'concrete');
  assert.equal(map({ color_id: '1' }).statusColor, 'orange');
  assert.equal(map({ color_id: '12' }).statusColor, 'azure');
  assert.equal(map({ color_id: 0 }).statusColor, 'canary');
  assert.equal(map({ color_id: '16' }).statusColor, 'white');
  // No / unknown color_id: picked by the status id, as Productive does (20 % 17 = 3).
  assert.equal(map({}).statusColor, 'lime-green');
  assert.equal(map({ color_id: '17' }).statusColor, 'lime-green');
  assert.equal(map({ color_id: 'red' }).statusColor, 'lime-green');
  assert.equal(map({}, { project_color_id: 6 }).projectColor, 'burgundy');
  assert.equal(map({}, { project_color_id: '14' }).projectColor, 'green');
  // No project colour: none (Productive would derive one from the client company, which is not fetched).
  assert.equal(map({}, {}).projectColor, null);
  assert.equal(map({}, { project_color_id: '99' }).projectColor, null);
  assert.equal(map({}, { project_color_id: null }).projectColor, null);
});

test('list: Keychain envelope → only the token is sent; every page; org slug from its name', async () => {
  const p = fakeProductive({ pages: [[task(1), task(2)], [task(3, { project: '2', status: '12' })]] });
  const kc = keychain(ENVELOPE);
  const tasks = createTasks({ settings: SETTINGS, run: kc.run, fetch: p.fetch, env: {}, platform: 'darwin' });
  const r = await tasks.list();
  assert.deepEqual(kc.calls, [['security', 'find-generic-password', '-s', 'TEST_SERVICE', '-a', 'test-account', '-w']]);
  assert.equal(r.count, 3);
  assert.equal(r.tasks.length, 3);
  assert.equal(r.truncated, false);
  assert.equal(r.stale, false);
  assert.equal(r.tasks[0].url, 'https://app.productive.io/42-acme-studio/tasks/1');
  assert.equal(r.tasks[2].project, 'Mobile app');
  const taskCalls = p.calls.filter((c) => c.path.endsWith('/tasks'));
  assert.deepEqual(taskCalls.map((c) => c.query['page[number]']), ['1', '2']);
  const q = taskCalls[0].query;
  assert.equal(q['filter[assignee_id]'], '7001');
  assert.equal(q['filter[status]'], '1');
  assert.equal(q['filter[project.status]'], '1');
  assert.equal(q.include, 'project,workflow_status');
  for (const c of p.calls) {
    assert.equal(c.headers['X-Auth-Token'], 'pat-abc');
    assert.equal(c.headers['X-Organization-Id'], '42');
  }
});

test('list: only tasks in active projects (filter[project.status]=1); the status routes refuse an archived project’s task', async () => {
  // Productive's own semantics: an archived project's tasks stay open, `project.status` 1 = active, 2 = archived.
  const projects = [
    { id: '1', type: 'projects', attributes: { name: 'Website', archived_at: null } },
    { id: '3', type: 'projects', attributes: { name: 'Old client', archived_at: '2026-06-09T14:16:55.000+02:00' } },
  ];
  const all = [task(1), task(2, { project: '3' }), task(3), task(4, { project: '3' })];
  const calls = [];
  const json = (body, s = 200) => ({ ok: s >= 200 && s < 300, status: s, json: async () => body });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams) });
    if (u.pathname.endsWith('/organizations/42')) return json({ data: { id: '42', type: 'organizations', attributes: { name: 'Acme Studio' } } });
    if (u.pathname.endsWith('/tasks')) {
      const want = u.searchParams.get('filter[project.status]');
      const archived = (t) => projects.find((pr) => pr.id === t.relationships.project.data.id).attributes.archived_at != null;
      const data = all.filter((t) => want == null || (want === '1' ? !archived(t) : archived(t)));
      return json({ data, included: [...projects, ...INCLUDED.filter((i) => i.type !== 'projects')], meta: { total_pages: 1, total_count: data.length } });
    }
    return json({ errors: [{ title: 'not found' }] }, 404);
  };
  const tasks = createTasks({ settings: SETTINGS, run: keychain(ENVELOPE).run, fetch, env: {}, platform: 'darwin' });
  const r = await tasks.list();
  assert.equal(calls.find((c) => c.path.endsWith('/tasks')).query['filter[project.status]'], '1');
  assert.equal(r.count, 2);
  assert.deepEqual(r.tasks.map((t) => [t.id, t.project]), [['1', 'Website'], ['3', 'Website']]);
  for (const id of ['2', '4']) {
    await assert.rejects(tasks.statuses(id), (err) => err.status === 404 && /not one of your open tasks/.test(err.message), id);
    await assert.rejects(tasks.setStatus(id, '11'), (err) => err.status === 404, id);
  }
  assert.equal(calls.filter((c) => c.method !== 'GET').length, 0);
});

test('list: cached 60 s, refresh skips the cache, concurrent calls share one fetch', async () => {
  let clock = 1_000_000;
  const p = fakeProductive();
  const tasks = createTasks({ settings: SETTINGS, run: keychain(ENVELOPE).run, fetch: p.fetch, env: {}, platform: 'darwin', now: () => clock });
  const count = () => p.calls.filter((c) => c.path.endsWith('/tasks')).length;
  await Promise.all([tasks.list(), tasks.list()]);
  assert.equal(count(), 1);
  clock += 30_000;
  await tasks.list();
  assert.equal(count(), 1);
  await tasks.list({ refresh: true });
  assert.equal(count(), 2);
  clock += 61_000;
  await tasks.list();
  assert.equal(count(), 3);
  // The org name is fetched once.
  assert.equal(p.calls.filter((c) => c.path.endsWith('/organizations/42')).length, 1);
});

test('list: the env token wins over the Keychain; a bare token needs configured ids; orgSlug from config', async () => {
  const p = fakeProductive();
  const kc = keychain(ENVELOPE);
  const bareSettings = normalizeTasksConfig({ productive: { organizationId: '42', personId: '7001', orgSlug: 'acme' } }, {});
  const r = await createTasks({ settings: bareSettings, run: kc.run, fetch: p.fetch, env: { PRODUCTIVE_AUTH_TOKEN: 'bare-pat' }, platform: 'darwin' }).list();
  assert.equal(kc.calls.length, 0);
  assert.equal(p.calls[0].headers['X-Auth-Token'], 'bare-pat');
  assert.equal(r.tasks[0].url, 'https://app.productive.io/42-acme/tasks/1');
  assert.equal(p.calls.filter((c) => c.path.includes('/organizations/')).length, 0);

  const noIds = createTasks({ settings: normalizeTasksConfig(undefined, { PRODUCTIVE_AUTH_TOKEN: 'bare-pat' }), fetch: p.fetch, env: { PRODUCTIVE_AUTH_TOKEN: 'bare-pat' } });
  await assert.rejects(noIds.list(), (err) => err.status === 501 && /organizationId and personId/.test(err.message));
});

test('list: no token → 501; Productive 401 → 502 (never a 401); a failed refresh serves the last answer as stale', async () => {
  const none = createTasks({ settings: SETTINGS, run: keychain(null).run, fetch: fakeProductive().fetch, env: {}, platform: 'darwin' });
  await assert.rejects(none.list(), (err) => err.status === 501 && /no Productive token/.test(err.message));

  const rejected = createTasks({ settings: SETTINGS, run: keychain(ENVELOPE).run, fetch: fakeProductive({ status: 401 }).fetch, env: {}, platform: 'darwin' });
  await assert.rejects(rejected.list(), (err) => err.status === 502 && /rejected the token/.test(err.message));

  let fail = false;
  const p = fakeProductive();
  const flaky = async (url, init) => {
    if (fail) throw new Error('getaddrinfo ENOTFOUND');
    return p.fetch(url, init);
  };
  const tasks = createTasks({ settings: SETTINGS, run: keychain(ENVELOPE).run, fetch: flaky, env: {}, platform: 'darwin' });
  const first = await tasks.list();
  fail = true;
  const again = await tasks.list({ refresh: true });
  assert.equal(again.stale, true);
  assert.match(again.error, /unreachable/);
  assert.deepEqual(again.tasks, first.tasks);
});

test('list: the org name unavailable → links with the bare org id', async () => {
  const p = fakeProductive();
  const noOrg = async (url, init) => (url.includes('/organizations/') ? { ok: false, status: 500, json: async () => ({}) } : p.fetch(url, init));
  const r = await createTasks({ settings: SETTINGS, run: keychain(ENVELOPE).run, fetch: noOrg, env: {}, platform: 'darwin' }).list();
  assert.equal(r.tasks[0].url, 'https://app.productive.io/42/tasks/1');
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function startApi(t, tasks, rawConfig = { version: 1, self: 'laptop' }) {
  let handle;
  const server = createHttpServer({ handleApi: (req, url) => handle(req, url), uiDir: null });
  const base = await listen(server);
  t.after(() => server.close());
  const config = normalizeConfig(rawConfig, { env: {}, home: '/nonexistent' });
  const cli = createFleetCli({ run: async () => ({ stdout: '[]', stderr: '' }) });
  handle = createApi({ config, cli, fleet: createFleet({ cli, self: 'laptop' }), backend: {}, transcripts: {}, spawner: {}, tasks, warmFleet: false });
  t.after(() => handle.stop());
  return base;
}

test('GET /api/tasks: 501 when not configured; the list (refresh=1 passed on) when it is; settings say which', async (t) => {
  const off = await startApi(t, null);
  let res = await fetch(`${off}/api/tasks`);
  assert.equal(res.status, 501);
  assert.match((await res.json()).error, /not configured/);
  assert.deepEqual((await (await fetch(`${off}/api/settings`)).json()).tasks, { enabled: false });

  const calls = [];
  const on = await startApi(t, { list: async (o) => (calls.push(o), { source: 'productive', fetchedAt: 1, stale: false, error: null, truncated: false, count: 0, tasks: [] }) });
  res = await fetch(`${on}/api/tasks?refresh=1`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).source, 'productive');
  assert.deepEqual(calls, [{ refresh: true }]);
  assert.equal((await fetch(`${on}/api/tasks`, { method: 'POST' })).status, 405);
  assert.deepEqual((await (await fetch(`${on}/api/settings`)).json()).tasks, { enabled: true, quickStart: [] });
});

test('GET /api/settings: the quick starts (with tasks on), dir resolved against this host’s spawnDirs', async (t) => {
  const list = async () => ({ source: 'productive', fetchedAt: 1, stale: false, error: null, truncated: false, count: 0, tasks: [] });
  const raw = {
    version: 1,
    self: 'laptop',
    spawnDirs: [{ label: 'work', paths: { laptop: '/home/me/work' } }],
    web: { tasks: { productive: { keychain: { service: 'S' } }, quickStart: { label: 'Orchestrate', prompt: '/orchestrate {url}', dir: 'work' } } },
  };
  const on = await startApi(t, { list }, raw);
  assert.deepEqual((await (await fetch(`${on}/api/settings`)).json()).tasks, {
    enabled: true,
    quickStart: [{ id: '0', label: 'Orchestrate', prompt: '/orchestrate {url}', dir: '/home/me/work', dirLabel: 'work', model: null, worktree: false, setStatus: null }],
  });
  // Tasks off on this server: no quick starts either.
  const off = await startApi(t, null, raw);
  assert.deepEqual((await (await fetch(`${off}/api/settings`)).json()).tasks, { enabled: false });
});

/**
 * A fake Productive with state for the status routes: tasks 1 (project 1) and 2 (project 2), workflow
 * statuses per project, PATCH /tasks/:id moving one. Records every request (method, path, query, body).
 */
function statefulProductive({ patchStatus = 200 } = {}) {
  const calls = [];
  const statusOf = { 1: '11', 2: '12' };
  const projectOf = { 1: '1', 2: '2' };
  const STATUSES = {
    1: [
      { id: '13', type: 'workflow_statuses', attributes: { name: 'Done', color_id: '14', category_id: 3, position: 3 } },
      { id: '11', type: 'workflow_statuses', attributes: { name: 'To do', color_id: '9', category_id: 1, position: 1 } },
      { id: '12', type: 'workflow_statuses', attributes: { name: 'In progress', color_id: '11', category_id: 2, position: 2 } },
    ],
    2: [{ id: '12', type: 'workflow_statuses', attributes: { name: 'In progress', color_id: '11', category_id: 2, position: 1 } }],
  };
  const allStatuses = [...STATUSES[1], ...STATUSES[2]];
  const json = (body, s = 200) => ({ ok: s >= 200 && s < 300, status: s, json: async () => body });
  const one = (id) => task(id, { project: projectOf[id], status: statusOf[id] });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ method, path: u.pathname, query: Object.fromEntries(u.searchParams), headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const included = [...INCLUDED, ...allStatuses];
    if (u.pathname.endsWith('/organizations/42')) return json({ data: { id: '42', type: 'organizations', attributes: { name: 'Acme Studio' } } });
    if (u.pathname.endsWith('/tasks')) return json({ data: [one(1), one(2)], included, meta: { total_pages: 1 } });
    const m = /\/tasks\/(\d+)$/.exec(u.pathname);
    if (m && method === 'GET') return json({ data: one(m[1]), included });
    if (m && method === 'PATCH') {
      if (patchStatus !== 200) return json({ errors: [{ detail: 'project workflow is archived' }] }, patchStatus);
      statusOf[m[1]] = JSON.parse(init.body).data.relationships.workflow_status.data.id;
      return json({ data: one(m[1]) });
    }
    if (u.pathname.endsWith('/workflow_statuses')) return json({ data: STATUSES[u.searchParams.get('filter[project_id]')] ?? [] });
    return json({ errors: [{ title: 'not found' }] }, 404);
  };
  return { fetch, calls, statusOf };
}

const statusTasks = (p, o = {}) => createTasks({ settings: SETTINGS, run: keychain(ENVELOPE).run, fetch: p.fetch, env: {}, platform: 'darwin', ...o });

test('statuses: the task’s project workflow, in Productive’s order, with the current one; only your open tasks', async () => {
  const p = statefulProductive();
  const tasks = statusTasks(p);
  const r = await tasks.statuses('1');
  assert.deepEqual(r, {
    taskId: '1',
    projectId: '1',
    current: '11',
    statuses: [
      { id: '11', name: 'To do', category: 'notStarted', color: 'concrete', position: 1 },
      { id: '12', name: 'In progress', category: 'started', color: 'yellow', position: 2 },
      { id: '13', name: 'Done', category: 'closed', color: 'green', position: 3 },
    ],
  });
  const ws = p.calls.find((c) => c.path.endsWith('/workflow_statuses'));
  assert.equal(ws.query['filter[project_id]'], '1');
  assert.equal(ws.headers['X-Auth-Token'], 'pat-abc');
  // Cached per project: a second look reads the task again, not the statuses.
  await tasks.statuses('1');
  assert.equal(p.calls.filter((c) => c.path.endsWith('/workflow_statuses')).length, 1);
  await assert.rejects(tasks.statuses('99'), (err) => err.status === 404 && /not one of your open tasks/.test(err.message));
  for (const bad of ['abc', '1;2', '', '../1']) await assert.rejects(tasks.statuses(bad), (err) => err.status === 400, bad);
  // Nothing was ever written.
  assert.equal(p.calls.filter((c) => c.method !== 'GET').length, 0);
});

test('setStatus: PATCHes the workflow_status relationship (JSON:API), returns the task, busts the list cache', async () => {
  let clock = 1_000_000;
  const p = statefulProductive();
  const tasks = statusTasks(p, { now: () => clock });
  const listed = await tasks.list();
  assert.equal(listed.tasks[0].status, 'To do');
  const r = await tasks.setStatus('1', '12');
  assert.equal(r.ok, true);
  assert.equal(r.changed, true);
  assert.equal(r.task.id, '1');
  assert.equal(r.task.status, 'In progress');
  assert.equal(r.task.statusCategory, 'started');
  assert.equal(r.task.url, 'https://app.productive.io/42-acme-studio/tasks/1');
  const patches = p.calls.filter((c) => c.method === 'PATCH');
  assert.equal(patches.length, 1);
  assert.match(patches[0].path, /\/tasks\/1$/);
  assert.deepEqual(patches[0].body, { data: { type: 'tasks', id: '1', relationships: { workflow_status: { data: { type: 'workflow_statuses', id: '12' } } } } });
  assert.equal(patches[0].headers['X-Auth-Token'], 'pat-abc');
  assert.equal(patches[0].headers['X-Organization-Id'], '42');
  // The list is fetched afresh (within the 60 s cache window).
  const before = p.calls.filter((c) => c.path.endsWith('/tasks')).length;
  clock += 1000;
  await tasks.list();
  assert.equal(p.calls.filter((c) => c.path.endsWith('/tasks')).length, before + 1);
  // A number id is accepted as well.
  assert.equal((await tasks.setStatus('1', 13)).task.status, 'Done');
});

test('setStatus: strict ids; a status outside the task’s workflow, the same status or a refusal write nothing (or say so)', async () => {
  const p = statefulProductive();
  const tasks = statusTasks(p);
  const patches = () => p.calls.filter((c) => c.method === 'PATCH').length;
  for (const bad of [undefined, null, '', 'abc', '12 ', '1e3', 12.5, -1, { id: 12 }, ['12']]) {
    await assert.rejects(tasks.setStatus('1', bad), (err) => err.status === 400 && /statusId must be/.test(err.message), JSON.stringify(bad));
  }
  await assert.rejects(tasks.setStatus('x', '12'), (err) => err.status === 400);
  await assert.rejects(tasks.setStatus('99', '12'), (err) => err.status === 404);
  // Task 2's workflow (project 2) has only status 12.
  await assert.rejects(tasks.setStatus('2', '11'), (err) => err.status === 400 && /not in task 2's workflow/.test(err.message));
  const same = await tasks.setStatus('2', '12');
  assert.equal(same.changed, false);
  assert.equal(same.task.status, 'In progress');
  assert.equal(patches(), 0);

  const refusing = statefulProductive({ patchStatus: 422 });
  await assert.rejects(statusTasks(refusing).setStatus('1', '12'), (err) => err.status === 409 && /archived/.test(err.message));
  assert.equal(refusing.statusOf[1], '11');
});

test('/api/tasks/:id/statuses (GET) and /api/tasks/:id/status (POST): routed, methods and bodies checked, 501 when off', async (t) => {
  const off = await startApi(t, null);
  assert.equal((await fetch(`${off}/api/tasks/1/statuses`)).status, 501);
  assert.equal((await fetch(`${off}/api/tasks/1/status`, { method: 'POST', body: '{"statusId":"2"}' })).status, 501);

  const calls = [];
  const fake = {
    list: async () => ({ tasks: [] }),
    statuses: async (id) => (calls.push(['statuses', id]), { taskId: id, projectId: '1', current: '11', statuses: [] }),
    setStatus: async (id, statusId) => (calls.push(['setStatus', id, statusId]), { ok: true, changed: true, task: { id } }),
  };
  const on = await startApi(t, fake);
  let res = await fetch(`${on}/api/tasks/7/statuses`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).taskId, '7');
  res = await fetch(`${on}/api/tasks/7/status`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ statusId: '12' }) });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, changed: true, task: { id: '7' } });
  assert.deepEqual(calls, [['statuses', '7'], ['setStatus', '7', '12']]);
  assert.equal((await fetch(`${on}/api/tasks/7/statuses`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${on}/api/tasks/7/status`)).status, 405);
  assert.equal((await fetch(`${on}/api/tasks/7/status`, { method: 'POST', body: '[1]' })).status, 400);
  assert.equal((await fetch(`${on}/api/tasks/7/status`, { method: 'POST', body: 'nope' })).status, 400);
  assert.equal(calls.length, 2);
});
