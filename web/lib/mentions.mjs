// Task mentions: how often each task URL (`…/tasks/<id>`, `…/tasks/task/<id>`, any host) occurs in
// a live Claude session's transcript — the whole conversation, not only the first prompt — so the UI
// can tell which task a session works on (ui lib/links.ts). Counted from what was said or done:
// user and assistant text, tool inputs and tool results — not thinking, injected meta entries,
// system reminders, sidechains, talk between agents (below), or the duplicate copies a transcript
// line keeps of its tool input / result (`wireToolInputs`, `toolUseResult`).
//
// Transcripts are append-only JSONL, so a file is read once in full and then only from where the
// last read stopped. Scans run in the background: `stamp()` attaches what is counted so far and
// starts a refresh, so `/api/fleet` never waits on one (a change shows on the next poll).
import { promises as fs } from 'node:fs';

import { claudeHome, locateTranscript } from './transcript.mjs';

/** At most this many `taskMentions` per session, most mentioned first. */
export const TASK_MENTIONS_MAX = 10;
const CHUNK_BYTES = 1024 * 1024;
const HEAD_BYTES = 256;
const RETRY_LOCATE_MS = 30 * 1000;

// The URL rule of promptLinks (fleet.mjs), cut at the task id: `/tasks/<id>` or `/tasks/task/<id>`
// with no word character right after the id (`/tasks/42/activity` is task 42; `/tasks/42abc` is not).
const TASK_URL_RE = /https?:\/\/[^\s<>()[\]{}"'`|\\/]+(?:\/[^\s<>()[\]{}"'`|\\/]*)*?\/tasks\/(?:task\/)?(\d+)(?!\w)/gi;
const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/** Each task URL in `text` → `{ key: "<origin>#<id>", url: "<origin><path>/tasks/<id>" }`. */
export function taskUrlsIn(text) {
  if (typeof text !== 'string' || !text.includes('/tasks/')) return [];
  const out = [];
  for (const m of text.matchAll(TASK_URL_RE)) {
    const url = m[0];
    const origin = url.slice(0, url.indexOf('/', url.indexOf('//') + 2)).toLowerCase();
    out.push({ key: `${origin}#${m[1]}`, url: url.replace(/\/tasks\/task\//i, '/tasks/') });
  }
  return out;
}

function stringsOf(value, out) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) stringsOf(v, out);
  return out;
}

function blockTexts(content, out) {
  if (typeof content === 'string') out.push(content);
  else if (Array.isArray(content)) for (const b of content) if (b?.type === 'text' && typeof b.text === 'string') out.push(b.text);
}

// Talk between agents is not evidence of the work: a brief quotes whatever context it hands over
// (other tasks, examples) and a hand-back echoes it. So a subagent's brief (Agent / Task input), a
// SendMessage, the result of a synchronous Agent / Task call and an `<agent-message>` hand-back
// (a subagent's report or another session's message, delivered as a prompt) do not count.
const AGENT_TOOLS = new Set(['Agent', 'Task', 'SendMessage']);
const AGENT_TOOL_RE = /"name":\s*"(?:Agent|Task|SendMessage)"/;
const AGENT_MESSAGE_RE = /<agent-message\b[\s\S]*?(?:<\/agent-message>|$)/g;

/**
 * The texts of one transcript line that count (see the module comment). `agentCalls` collects the
 * ids of Agent / Task calls, so their results — later lines — are skipped too.
 */
export function lineTexts(line, agentCalls = new Set()) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return [];
  }
  if (!entry || (entry.type !== 'user' && entry.type !== 'assistant') || entry.isSidechain || entry.isMeta) return [];
  const content = entry.message?.content;
  const out = [];
  if (typeof content === 'string') out.push(content);
  else if (Array.isArray(content)) {
    for (const b of content) {
      if (b?.type === 'text' && typeof b.text === 'string') out.push(b.text);
      else if (b?.type === 'tool_use') {
        if (AGENT_TOOLS.has(b.name)) {
          if (b.id) agentCalls.add(b.id);
        } else stringsOf(b.input, out);
      } else if (b?.type === 'tool_result' && !agentCalls.has(b.tool_use_id)) blockTexts(b.content, out);
    }
  }
  return out.map((t) => (entry.type === 'user' ? t.replace(SYSTEM_REMINDER_RE, '') : t).replace(AGENT_MESSAGE_RE, ''));
}

/**
 * Add the task URLs of JSONL `text` (whole lines) to `counts` (key → { url, count }); `agentCalls`
 * carries the Agent / Task call ids across calls (see lineTexts).
 */
export function countInto(counts, text, agentCalls = new Set()) {
  for (const line of text.split('\n')) {
    if (!line.includes('/tasks/') && !AGENT_TOOL_RE.test(line)) continue; // most lines: no JSON.parse
    for (const t of lineTexts(line, agentCalls)) {
      for (const { key, url } of taskUrlsIn(t)) {
        const c = counts.get(key);
        if (c) c.count += 1;
        else counts.set(key, { url, count: 1 });
      }
    }
  }
  return counts;
}

/** `counts` → `[{ url, count }]`, most mentioned first, at most `max`. */
export function summarize(counts, max = TASK_MENTIONS_MAX) {
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, max).map(({ url, count }) => ({ url, count }));
}

async function readRange(fh, start, end) {
  const buf = Buffer.alloc(end - start);
  let off = 0;
  while (off < buf.length) {
    const { bytesRead } = await fh.read(buf, off, buf.length - off, start + off);
    if (!bytesRead) break;
    off += bytesRead;
  }
  return buf.subarray(0, off);
}

/**
 * Count `file` into `state` from `state.offset` on, whole lines only (a line still being written
 * is read on the next scan). A file that shrank or whose head changed is counted afresh.
 */
export async function scanFile(file, state = null) {
  const stat = await fs.stat(file);
  if (state && state.file === file && state.size === stat.size && state.mtimeMs === stat.mtimeMs) return state;
  const fh = await fs.open(file, 'r');
  try {
    const head = (await readRange(fh, 0, Math.min(HEAD_BYTES, stat.size))).toString('latin1');
    const common = state ? Math.min(head.length, state.head.length) : 0;
    const fresh = !state || state.file !== file || stat.size < state.offset || head.slice(0, common) !== state.head.slice(0, common);
    const next = fresh
      ? { file, head, offset: 0, size: 0, mtimeMs: 0, counts: new Map(), agentCalls: new Set() }
      : { ...state, head: head.length > state.head.length ? head : state.head, counts: new Map([...state.counts].map(([k, v]) => [k, { ...v }])), agentCalls: new Set(state.agentCalls) };
    let pos = next.offset;
    let carry = Buffer.alloc(0);
    while (pos < stat.size) {
      const chunk = await readRange(fh, pos, Math.min(stat.size, pos + CHUNK_BYTES));
      if (!chunk.length) break;
      pos += chunk.length;
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const nl = buf.lastIndexOf(0x0a);
      if (nl === -1) {
        carry = buf;
        continue;
      }
      countInto(next.counts, buf.subarray(0, nl + 1).toString('utf8'), next.agentCalls);
      carry = buf.subarray(nl + 1);
    }
    next.offset = pos - carry.length;
    next.size = stat.size;
    next.mtimeMs = stat.mtimeMs;
    return next;
  } finally {
    await fh.close();
  }
}

/**
 * Task mentions of this host's live Claude sessions.
 *   stamp(host)       → host with `taskMentions` on every session counted so far that mentions a
 *                       task (sync; never waits), and a background refresh started for its sessions
 *   refresh(sessions) → Promise: locate, (re)scan changed transcripts, forget sessions gone
 *                       (one at a time; a call while one runs runs once more after it)
 */
export function createTaskMentions({ home = claudeHome(), locate = (cwd, id) => locateTranscript(cwd, id, home), now = Date.now, logError = () => {} } = {}) {
  const states = new Map(); // session_id → scan state + { mentions }
  const located = new Map(); // session_id → { file, at }
  let running = null;
  let again = null;

  async function fileOf(s) {
    const hit = located.get(s.session_id);
    if (hit?.file) return hit.file;
    if (hit && now() - hit.at < RETRY_LOCATE_MS) return null;
    const file = await locate(s.cwd, s.session_id);
    located.set(s.session_id, { file, at: now() });
    return file;
  }

  async function refreshOnce(sessions) {
    const live = new Set();
    for (const s of sessions) {
      const id = s?.session_id;
      if (!id || (s.harness && s.harness !== 'claude')) continue;
      live.add(id);
      try {
        const file = await fileOf(s);
        if (!file) continue;
        const prev = states.get(id);
        const next = await scanFile(file, prev ?? null);
        if (next !== prev) states.set(id, { ...next, mentions: summarize(next.counts) });
      } catch (err) {
        if (err?.code === 'ENOENT') {
          located.delete(id);
          states.delete(id);
        } else logError(err, `task mentions ${id}`);
      }
    }
    for (const id of states.keys()) if (!live.has(id)) states.delete(id);
    for (const id of located.keys()) if (!live.has(id)) located.delete(id);
  }

  function refresh(sessions) {
    if (running) {
      again = sessions;
      return running;
    }
    running = (async () => {
      let next = sessions;
      while (next) {
        again = null;
        await refreshOnce(next);
        next = again;
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  function stamp(host) {
    if (!host?.ok || !Array.isArray(host.sessions)) return host;
    refresh(host.sessions).catch((err) => logError(err, 'task mentions'));
    const sessions = host.sessions.map((s) => {
      const m = s?.session_id ? states.get(s.session_id)?.mentions : null;
      return m?.length ? { ...s, taskMentions: m } : s;
    });
    return { ...host, sessions };
  }

  return { stamp, refresh, get: (id) => states.get(id)?.mentions ?? null };
}
