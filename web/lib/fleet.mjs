import { sortSessions } from './util.mjs';

export const TITLE_MAX = 300;

/** Cap a session title for transport: the first prompt can run to 10 KB, the UI shows one line. */
export function trimTitle(title, max = TITLE_MAX) {
  if (typeof title !== 'string') return title ?? null;
  return title.length > max ? `${title.slice(0, max)}…` : title;
}

/** At most this many `promptLinks` per session. */
export const PROMPT_LINKS_MAX = 20;
const URL_RE = /https?:\/\/[^\s<>()[\]{}"'`|\\]+/gi;

/**
 * The distinct http(s) URLs in `text`, in order, at most `max` — the same rule as a PR's `links`
 * (core/prs.rs `body_links`): a URL ends at whitespace or a quote, bracket, `|` or backslash, and
 * trailing sentence punctuation is not part of it. Read from the whole first prompt before
 * trimTitle() cuts it: a slash command's arguments come at the very end of its expansion.
 */
export function promptLinks(text, max = PROMPT_LINKS_MAX) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?*_~]+$/, '');
    if (/^https?:\/\/./i.test(url) && !out.includes(url)) out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/** A session row for transport: the title trimmed, `promptLinks` (when the first prompt has any) from the whole of it. */
function forTransport(s) {
  const links = promptLinks(s.title);
  return { ...s, title: trimTitle(s.title), ...(links.length ? { promptLinks: links } : {}) };
}

/**
 * The first `web.sessionStyles` rule (config.mjs#normalizeSessionStyles) that matches a transported
 * session → `{ label, color }`, else null. Every key of a rule's `match` must hold: `command` equals
 * the CLI's `first_command`; `promptIncludes` is in `title` (as transported), ignoring case.
 */
export function sessionStyleFor(s, rules) {
  if (!Array.isArray(rules) || !rules.length || !s) return null;
  const title = typeof s.title === 'string' ? s.title.toLowerCase() : '';
  for (const r of rules) {
    const m = r.match ?? {};
    if (m.command != null && s.first_command !== m.command) continue;
    if (m.promptIncludes != null && !title.includes(m.promptIncludes.toLowerCase())) continue;
    return { label: r.label, color: r.color };
  }
  return null;
}

/**
 * Stamp `style: { label, color }` on every session a rule matches, on every host — the rules of the
 * server building the view, so one config styles the whole fleet. A peer's own `style` is replaced.
 */
export function stampSessionStyles(hosts, rules) {
  if (!Array.isArray(rules) || !rules.length) return hosts;
  return hosts.map((h) => {
    if (!Array.isArray(h?.sessions)) return h;
    const sessions = h.sessions.map((s) => {
      const { style: _peer, ...rest } = s;
      const style = sessionStyleFor(rest, rules);
      return style ? { ...rest, style } : rest;
    });
    return { ...h, sessions };
  });
}

/**
 * Every route and view keys a session by `session_id`. A Codex session has none until its first
 * prompt (no transcript yet): it goes by `pid-<pid>` until then. Claude rows always carry one.
 */
export function placeholderId(s) {
  return Number.isInteger(s?.pid) ? `pid-${s.pid}` : null;
}

/**
 * Local session discovery (via the `fleet` CLI, see lib/fleet-cli.mjs) with a short TTL
 * cache and in-flight de-duplication. Never throws: failures come back as { ok:false, error }.
 */
export function createFleet({ cli, self = 'local', ttlMs = 2000, now = Date.now } = {}) {
  if (!cli || typeof cli.list !== 'function') throw new TypeError('cli.list must be a function');

  let cached = null; // { at, value }
  let inFlight = null;

  async function discover() {
    const fetchedAt = now();
    try {
      const raw = await cli.list();
      const sessions = sortSessions(raw).map((s) => ({ ...forTransport(s), session_id: s.session_id ?? placeholderId(s), host: self }));
      return { name: self, ok: true, fetchedAt, sessions };
    } catch (err) {
      return { name: self, ok: false, error: String(err?.message ?? err), fetchedAt, sessions: [] };
    }
  }

  async function localHost({ force = false } = {}) {
    if (!force && cached && now() - cached.at < ttlMs) return cached.value;
    if (inFlight) return inFlight;
    inFlight = discover()
      .then((value) => {
        cached = { at: now(), value };
        return value;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  /** Sessions of this host, or null if discovery failed. */
  async function localSessions(opts) {
    const host = await localHost(opts);
    return host.ok ? host.sessions : null;
  }

  function invalidate() {
    cached = null;
  }

  return { localHost, localSessions, invalidate };
}
