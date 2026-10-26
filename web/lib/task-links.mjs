// Manual session → task links (the "Link task…" picker): one small JSON file per host in fleet's
// state dir, keyed by session id. A link names a task id (`{ id: "123" }`) or says the session is
// linked to no task (`{ id: null }`, which also hides the UI's automatic links). Every session of
// this host that has an entry gets it on its row as `manualTask`. Entries whose session has not
// been seen live for PRUNE_AFTER_MS are dropped (a closed session can still be restored for a while).
// See ARCHITECTURE.md → Manual task links.
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { SESSION_ID_RE } from './briefs.mjs';

export const TASK_LINKS_FILE = 'task-links.json';
/** A Productive task id: digits only (the UI's `Task.id`). */
export const TASK_ID_RE = /^[1-9][0-9]{0,19}$/;
/** Gone this long → forgotten. */
export const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many entries; the least recently seen go first. */
export const MAX_ENTRIES = 1000;
/** A live session's `seenAt` is written back at most this often (it only feeds the pruning). */
const SEEN_WRITE_MS = 60 * 60 * 1000;

/**
 * The body of `PUT …/sessions/:id/task`: `{ taskId: "123" }` (a number is accepted too) or
 * `{ taskId: null }`. → `{ ok: true, taskId: string | null }` | `{ ok: false, error }`.
 */
export function validateTaskLinkBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !('taskId' in body)) {
    return { ok: false, error: 'body must be { taskId: "<task id>" | null }' };
  }
  const raw = body.taskId;
  if (raw === null) return { ok: true, taskId: null };
  const id = typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw) : raw;
  if (typeof id !== 'string' || !TASK_ID_RE.test(id)) return { ok: false, error: 'taskId must be a task id (digits) or null' };
  return { ok: true, taskId: id };
}

function readEntries(file, logError) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err?.code !== 'ENOENT') logError(err, `task links: read ${file}`);
    return new Map();
  }
  const out = new Map();
  try {
    const links = JSON.parse(text)?.links;
    for (const [id, e] of Object.entries(links && typeof links === 'object' ? links : {})) {
      if (!SESSION_ID_RE.test(id) || !e || typeof e !== 'object') continue;
      const taskId = e.taskId === null ? null : typeof e.taskId === 'string' && TASK_ID_RE.test(e.taskId) ? e.taskId : undefined;
      if (taskId === undefined) continue;
      const at = Number.isFinite(e.at) ? e.at : 0;
      out.set(id, { taskId, at, seenAt: Number.isFinite(e.seenAt) ? e.seenAt : at });
    }
  } catch (err) {
    logError(err, `task links: ${file} is not valid JSON — starting empty`);
  }
  return out;
}

/**
 * @param {object} opts
 *   file   absolute path of the JSON file (created on the first write, mode 600)
 * @returns {{
 *   get(id): { taskId, at, seenAt } | null,
 *   set(id, taskId: string | null): Promise<entry>,
 *   clear(id): Promise<boolean>,
 *   stamp(host): host,   // `manualTask: { id }` on its sessions with an entry; seen / prune bookkeeping
 *   flush(): Promise<void>,
 * }}
 */
export function createTaskLinks({ file, now = Date.now, pruneAfterMs = PRUNE_AFTER_MS, maxEntries = MAX_ENTRIES, logError = () => {} }) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw new TypeError('task links file must be an absolute path');
  let entries = null; // loaded on first use
  let written = new Map(); // id → seenAt as last written
  let saving = Promise.resolve();

  const load = () => {
    if (!entries) {
      entries = readEntries(file, logError);
      written = new Map([...entries].map(([id, e]) => [id, e.seenAt]));
    }
    return entries;
  };

  async function writeFile() {
    const links = {};
    for (const [id, e] of load()) links[id] = { taskId: e.taskId, at: e.at, seenAt: e.seenAt };
    const text = `${JSON.stringify({ version: 1, links }, null, 2)}\n`;
    await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await fsp.writeFile(tmp, text, { mode: 0o600 });
      await fsp.rename(tmp, file);
    } catch (err) {
      await fsp.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
    written = new Map([...load()].map(([id, e]) => [id, e.seenAt]));
  }

  /** Writes run one at a time, each with the state at its turn. */
  function save() {
    const next = saving.catch(() => {}).then(writeFile);
    saving = next.catch(() => {});
    return next;
  }

  function trim() {
    const all = load();
    if (all.size <= maxEntries) return;
    const oldest = [...all].sort((a, b) => a[1].seenAt - b[1].seenAt).slice(0, all.size - maxEntries);
    for (const [id] of oldest) all.delete(id);
  }

  async function set(id, taskId) {
    if (!SESSION_ID_RE.test(String(id))) throw new Error(`not a session id: ${id}`);
    if (taskId !== null && !TASK_ID_RE.test(String(taskId))) throw new Error(`not a task id: ${taskId}`);
    const t = now();
    const entry = { taskId, at: t, seenAt: t };
    load().set(id, entry);
    trim();
    await save();
    return entry;
  }

  async function clear(id) {
    if (!load().delete(id)) return false;
    await save();
    return true;
  }

  function stamp(host) {
    if (!host?.ok || !Array.isArray(host.sessions)) return host;
    const all = load();
    if (!all.size) return host;
    const t = now();
    let dirty = false;
    const live = new Set();
    const sessions = host.sessions.map((s) => {
      const e = s?.session_id ? all.get(s.session_id) : null;
      if (!e) return s;
      live.add(s.session_id);
      e.seenAt = t;
      if (t - (written.get(s.session_id) ?? 0) >= SEEN_WRITE_MS) dirty = true;
      return { ...s, manualTask: { id: e.taskId } };
    });
    for (const [id, e] of all) {
      if (!live.has(id) && t - e.seenAt > pruneAfterMs) {
        all.delete(id);
        dirty = true;
      }
    }
    if (dirty) save().catch((err) => logError(err, 'task links: save'));
    return { ...host, sessions };
  }

  return {
    file,
    get: (id) => load().get(id) ?? null,
    set,
    clear,
    stamp,
    flush: () => saving,
  };
}
