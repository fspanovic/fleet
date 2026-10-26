// Delete a session: close it exactly like lib/kill.mjs does, then remove the linked git
// worktree it ran in with `git worktree remove` (`--force` only when asked, and only when the
// worktree has changes or unpushed commits). The local branch is kept — except in a
// workspace fleet made for the session (`fleet spawn --worktree`; the row's `workspace`):
// there the branch fleet created goes too (`git branch -D`), but only when it is still the
// worktree's branch and has no commits that are not on a remote. A session in a main
// checkout or outside git is only closed; its directory is never touched. Nothing is ever
// deleted any other way: no `rm`, and `git worktree prune` only when a remove left the entry
// registered with its directory gone.
//
// Dev servers: before the worktree goes, every process started in it is stopped (SIGTERM, then
// SIGKILL after a grace period) — lib/devservers.mjs decides which ("rooted" in the worktree or
// in the closing session; never another session's, a tmux pane that stays open, an editor or
// this server). After the branch, the worktree's dev-environment leftovers (fe-live-env state,
// puma-dev host files, watchman roots — lib/leftovers.mjs) are cleaned where those tools exist.
// Order: close the session → stop servers → git worktree remove → branch → leftovers.
//
// Like kill, this lives in the web backend layer: it needs the `list --json` row (cwd, pid,
// terminal) and a few git calls on the session's host, the same checks `fleet prs
// cleanup-worktrees` makes (crates/fleet/src/core/prs.rs: `judge`, `pushed`).
import fs from 'node:fs/promises';
import path from 'node:path';

import { gitInfo } from './briefs.mjs';

export const MAX_LISTED_FILES = 10;
export const MAX_LISTED_COMMITS = 5;
const GIT_MS = 5000;
const REMOVE_MS = 60 * 1000;

/** `p` with symlinks resolved, also when its tail no longer exists (prs.rs `canonical`). */
export async function canonical(p, realpath = fs.realpath) {
  const rest = [];
  let cur = path.resolve(p);
  for (;;) {
    try {
      return path.join(await realpath(cur), ...rest);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

const within = (p, root) => p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/** `git worktree list --porcelain` → [{ path, branch, locked }]; the main checkout first. */
export function parseWorktreeList(out) {
  return String(out ?? '')
    .split(/\n\n+/)
    .map((block) => {
      const wt = { path: null, branch: null, locked: false };
      for (const line of block.split('\n')) {
        if (line.startsWith('worktree ')) wt.path = line.slice('worktree '.length);
        else if (line.startsWith('branch refs/heads/')) wt.branch = line.slice('branch refs/heads/'.length);
        else if (line === 'locked' || line.startsWith('locked ')) wt.locked = true;
      }
      return wt;
    })
    .filter((wt) => wt.path);
}

/** `git status --porcelain -z` → [{ status, path }] (a rename's source entry is skipped). */
export function parseStatus(out) {
  const parts = String(out ?? '').split('\0');
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const status = e.slice(0, 2);
    files.push({ status: status.trim(), path: e.slice(3) });
    if (status[0] === 'R' || status[0] === 'C') i++;
  }
  return files;
}

/**
 * @param deps
 *   run      execFile wrapper (lib/run.mjs)
 *   killer   lib/kill.mjs killer — closes the session the way the kill route does
 *   git      git binary
 *   realpath fs.realpath (injected for tests)
 *   exists   (path) => Promise<boolean> (injected for tests)
 *   servers  lib/devservers.mjs stopper (optional: without it no process is stopped)
 *   leftovers lib/leftovers.mjs cleaner (optional: without it nothing else is cleaned)
 */
export function createDeleter({ run, killer, git = 'git', realpath = fs.realpath, exists, servers = null, leftovers = null }) {
  if (typeof run !== 'function') throw new TypeError('run must be a function');
  const pathExists =
    exists ??
    (async (p) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    });
  const gitIn = async (dir, args, timeout = GIT_MS) => (await run(git, ['-C', dir, ...args], { timeout })).stdout;

  async function registered(dir, wtPath) {
    try {
      const list = parseWorktreeList(await gitIn(dir, ['worktree', 'list', '--porcelain']));
      const want = await canonical(wtPath, realpath);
      for (const wt of list) if ((await canonical(wt.path, realpath)) === want) return true;
      return false;
    } catch {
      return null;
    }
  }

  /** Other live sessions (not `session`) whose cwd is inside `root`. */
  async function sessionsInside(root, session, sessions) {
    const out = [];
    for (const s of Array.isArray(sessions) ? sessions : []) {
      if (!s?.cwd || s === session) continue;
      if (session.session_id && s.session_id === session.session_id) continue;
      if (Number.isInteger(session.pid) && s.pid === session.pid) continue;
      if (!within(await canonical(s.cwd, realpath), root)) continue;
      out.push({
        host: s.host ?? null,
        id: s.session_id ?? null,
        name: s.name ?? null,
        title: s.display_title ?? s.name ?? null,
        cwd: s.cwd,
        status: s.status ?? null,
      });
    }
    return out;
  }

  /**
   * The workspace side of a delete: `null` unless the row says fleet made this worktree for
   * the session (`workspace`, from `fleet list --json`) and it is the worktree being removed.
   * → { handle, branch, deleteBranch } — `deleteBranch` when the worktree is still on the
   * branch fleet left it on and nothing on it is unpushed.
   */
  async function workspacePlan(session, worktree, top) {
    const ws = session.workspace;
    if (!ws || typeof ws.branch !== 'string' || typeof ws.path !== 'string') return null;
    if ((await canonical(ws.path, realpath)) !== top) return null;
    const own = Boolean(worktree.branch) && worktree.branch === ws.branch;
    return { handle: ws.handle ?? null, branch: ws.branch, deleteBranch: own && worktree.unpushed.count === 0 };
  }

  /** `git branch -D` the workspace branch after its worktree is gone — re-checked: no unpushed commits. */
  async function deleteWorkspaceBranch(mainPath, branch) {
    try {
      const n = Number.parseInt((await gitIn(mainPath, ['rev-list', '--count', `refs/heads/${branch}`, '--not', '--remotes'])).trim(), 10);
      if (n !== 0) return { deleted: false, note: `${branch} has ${Number.isFinite(n) ? n : 'some'} unpushed commit(s) — kept` };
      await gitIn(mainPath, ['branch', '-D', branch]);
      return { deleted: true, note: `deleted ${branch}` };
    } catch (err) {
      return { deleted: false, note: String(err?.message ?? err).trim().split('\n').pop() || `${branch} not deleted` };
    }
  }

  /**
   * The servers and leftovers side of a plan: what would be stopped in the worktree `top` and
   * what would be cleaned after it. → { servers: { stop, kept, error }, leftovers, own }
   */
  async function devPlan(session, sessions, top, nested) {
    const out = { servers: { stop: [], kept: [], error: null }, leftovers: [], own: null };
    let going = new Set();
    let ports = new Set();
    if (servers) {
      try {
        const sp = await servers.plan({ worktree: top, nested, session, sessions });
        out.servers = { stop: sp.stop, kept: sp.kept, error: sp.error };
        out.own = sp.own;
        going = new Set([...sp.own, ...sp.stop.flatMap((t) => t.pids)]);
        ports = new Set(sp.stop.flatMap((t) => t.ports));
      } catch (err) {
        out.servers.error = String(err?.message ?? err).split('\n')[0] || 'could not list processes';
      }
    }
    if (leftovers) {
      try {
        out.leftovers = await leftovers.plan({ worktree: top, going, ports });
      } catch {
        out.leftovers = [];
      }
    }
    return out;
  }

  /**
   * What Delete would do to `session` (a `list --json` row), given this host's live `sessions`.
   * Changes nothing. → { cwd, action: 'remove-worktree' | 'close-only', reason, checkout,
   * worktree, workspace, sessions, blocked, needsForce, servers: { stop, kept, error },
   * leftovers }
   */
  async function inspect(session, sessions = []) {
    return (await inspectFull(session, sessions)).plan;
  }

  /** inspect + what remove needs and the client does not see: { plan, ctx: { top, nested, own } | null }. */
  async function inspectFull(session, sessions = []) {
    const base = {
      cwd: session.cwd ?? null,
      action: 'close-only',
      reason: null,
      checkout: null,
      worktree: null,
      workspace: null,
      sessions: [],
      blocked: false,
      needsForce: false,
      servers: { stop: [], kept: [], error: null },
      leftovers: [],
    };
    const closeOnly = (extra) => ({ plan: { ...base, ...extra }, ctx: null });
    if (!session.cwd) return closeOnly({ reason: 'no-cwd' });
    const gi = await gitInfo(session.cwd, { run: (_bin, args, opts) => run(git, args, opts) });
    if (!gi) return closeOnly({ reason: 'not-git' });
    const checkout = { path: gi.toplevel, branch: gi.branch, linked: gi.linked };
    if (!gi.linked) return closeOnly({ reason: 'main-checkout', checkout });

    let list;
    try {
      list = parseWorktreeList(await gitIn(gi.toplevel, ['worktree', 'list', '--porcelain']));
    } catch {
      return closeOnly({ reason: 'not-git', checkout });
    }
    const top = await canonical(gi.toplevel, realpath);
    let entry = null;
    const nested = [];
    for (const wt of list.slice(1)) {
      const c = await canonical(wt.path, realpath);
      if (c === top) entry = wt;
      else if (within(c, top)) nested.push(c);
    }
    if (!entry || !list[0]) return closeOnly({ reason: 'main-checkout', checkout });

    const [status, ahead, others, dev] = await Promise.all([
      gitIn(gi.toplevel, ['status', '--porcelain', '-z']).then(parseStatus),
      gitIn(gi.toplevel, ['rev-list', '--count', 'HEAD', '--not', '--remotes']).then((s) => Number.parseInt(s.trim(), 10) || 0),
      sessionsInside(top, session, sessions),
      devPlan(session, sessions, top, nested),
    ]);
    const commits = ahead
      ? (await gitIn(gi.toplevel, ['log', `--max-count=${MAX_LISTED_COMMITS}`, '--format=%h%x09%s', 'HEAD', '--not', '--remotes']))
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const [sha, ...subject] = l.split('\t');
            return { sha, subject: subject.join('\t') };
          })
      : [];
    const worktree = {
      path: gi.toplevel,
      branch: gi.branch,
      mainPath: list[0].path,
      locked: entry.locked,
      dirty: { count: status.length, files: status.slice(0, MAX_LISTED_FILES) },
      unpushed: { count: ahead, commits },
    };
    const plan = {
      ...base,
      action: 'remove-worktree',
      checkout,
      worktree,
      workspace: await workspacePlan(session, worktree, top),
      sessions: others,
      blocked: others.length > 0,
      needsForce: status.length > 0 || ahead > 0,
      servers: dev.servers,
      leftovers: dev.leftovers,
    };
    return { plan, ctx: { top, nested, own: dev.own } };
  }

  /** Stop what was started in the worktree, from a fresh look after the session closed. */
  async function stopServers(session, sessions, ctx) {
    if (!servers) return { stopped: [], kept: [], error: null };
    try {
      const sp = await servers.plan({ worktree: ctx.top, nested: ctx.nested, session, sessions, own: ctx.own ?? undefined });
      const stopped = sp.stop.length ? await servers.stop(sp.stop) : [];
      return { stopped, kept: sp.kept, error: sp.error };
    } catch (err) {
      return { stopped: [], kept: [], error: String(err?.message ?? err).split('\n')[0] || 'stopping servers failed' };
    }
  }

  async function cleanLeftovers(top, stopped) {
    if (!leftovers) return [];
    try {
      const ports = new Set(stopped.filter((t) => t.result !== 'failed').flatMap((t) => t.ports));
      const listening = servers ? await servers.listening() : null;
      return await leftovers.clean({ worktree: top, ports, listening });
    } catch (err) {
      return [{ kind: 'leftovers', name: top, result: 'failed', note: String(err?.message ?? err).split('\n')[0] }];
    }
  }

  /**
   * Close `session` and remove its linked worktree. Refuses (nothing is closed) with
   * `{ refused: 'sessions' | 'locked' | 'changes', plan }` when another live session runs in the
   * worktree, when it is locked, or when it has changes / unpushed commits and `force` is not set.
   * → { plan, process, terminal, worktree: { path, branch, removed, forced, pruned, error,
   * branchDeleted?, branchNote? } | null, servers: { stopped, kept, error }, leftovers } —
   * `branchDeleted` / `branchNote` only for a fleet-made workspace (`plan.workspace`);
   * `servers.stopped`: the stop targets with `result` ('terminated' | 'killed' | 'gone' |
   * 'failed') and `error`; `leftovers`: [{ kind, name, result: 'removed' | 'kept' | 'failed', note }].
   */
  async function remove(session, sessions = [], { force = false } = {}) {
    if (!killer) throw new Error('no killer');
    const { plan, ctx } = await inspectFull(session, sessions);
    if (plan.action === 'remove-worktree') {
      if (plan.blocked) return { refused: 'sessions', plan };
      if (plan.worktree.locked) return { refused: 'locked', plan };
      if (plan.needsForce && !force) return { refused: 'changes', plan };
    }
    const closed = await killer.kill(session);
    if (plan.action !== 'remove-worktree') return { plan, ...closed, worktree: null, servers: { stopped: [], kept: [], error: null }, leftovers: [] };
    const stoppedServers = await stopServers(session, sessions, ctx);

    const wt = plan.worktree;
    const forced = Boolean(force && plan.needsForce);
    const result = { path: wt.path, branch: wt.branch, removed: false, forced, pruned: false, error: null };
    // A fleet-made workspace also says what happened to its branch.
    if (plan.workspace) Object.assign(result, { branchDeleted: false, branchNote: null });
    try {
      await gitIn(wt.mainPath, ['worktree', 'remove', ...(forced ? ['--force'] : []), wt.path], REMOVE_MS);
      result.removed = true;
    } catch (err) {
      result.error = String(err?.message ?? err).trim().split('\n').pop() || 'git worktree remove failed';
    }
    if ((await registered(wt.mainPath, wt.path)) && !(await pathExists(wt.path))) {
      try {
        await gitIn(wt.mainPath, ['worktree', 'prune']);
        result.pruned = true;
      } catch {
        /* the entry stays registered; `git worktree prune` by hand clears it */
      }
    }
    const ws = plan.workspace;
    if (ws && (result.removed || result.pruned)) {
      if (ws.deleteBranch) {
        const b = await deleteWorkspaceBranch(wt.mainPath, ws.branch);
        result.branchDeleted = b.deleted;
        result.branchNote = b.note;
      } else {
        result.branchNote = wt.branch === ws.branch ? `${ws.branch} has unpushed commits — kept` : `on ${wt.branch ?? 'no branch'}, not ${ws.branch} — kept`;
      }
    }
    const cleaned = await cleanLeftovers(ctx.top, stoppedServers.stopped);
    return { plan, ...closed, worktree: result, servers: stoppedServers, leftovers: cleaned };
  }

  return { inspect, remove };
}
