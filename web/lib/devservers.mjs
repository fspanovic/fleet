// The dev servers a session left running in its linked worktree, and stopping them before the
// worktree is removed (lib/delete.mjs).
//
// "Started in the worktree" = its cwd is inside the worktree AND its process tree is rooted
// there: walking up the ppid chain reaches the session being deleted (its Claude process or a
// tmux pane of the window that closes with it), or a top process (ppid 1, e.g. an orphaned
// `vite` or `puma`) whose own cwd is inside the worktree. The walk stops at anything that lives
// outside: another live session, a tmux pane that stays open, this server, or a top process
// elsewhere (iTerm, an editor, launchd jobs). A top process whose executable is in an app
// installed system-wide (/Applications, /System/Applications, /System/Library, ~/Applications —
// an editor started with `code .`) is outside even when its cwd is inside; an `.app` anywhere
// else (puppeteer's Chrome for Testing under ~/.cache, started by a live test in the worktree)
// follows the cwd rule like any process. Any ancestor of something outside (the tmux server
// above other panes) is outside too. Everything here is
// derived from `lsof` (cwds, listening ports) and `ps` (pid, pgid, ppid, comm, args) snapshots;
// the signals go through an injected `killProcess`.
import os from 'node:os';
import path from 'node:path';

const SCAN_MS = 15 * 1000;
const STEP_MS = 250;
const MAX_COMMAND = 160;

export const isInside = (p, root) => typeof p === 'string' && (p === root || p.startsWith(root.endsWith(path.sep) ? root : root + path.sep));

/** `lsof -a -d cwd -Fpn` → Map pid → cwd. */
export function parseLsofCwd(text) {
  const out = new Map();
  let pid = null;
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && Number.isInteger(pid)) out.set(pid, line.slice(1));
  }
  return out;
}

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpn` → Map pid → Set(port). */
export function parseLsofListen(text) {
  const out = new Map();
  let pid = null;
  for (const line of String(text ?? '').split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && Number.isInteger(pid)) {
      const port = Number(line.slice(line.lastIndexOf(':') + 1));
      if (Number.isInteger(port) && port > 0) {
        const ports = out.get(pid) ?? new Set();
        ports.add(port);
        out.set(pid, ports);
      }
    }
  }
  return out;
}

/** `ps -A -o pid=,pgid=,ppid=,comm=` → Map pid → { pgid, ppid, comm }. */
export function parsePsGroups(text) {
  const out = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)(?:\s+(.*))?$/);
    if (m) out.set(Number(m[1]), { pgid: Number(m[2]), ppid: Number(m[3]), comm: m[4] ?? null });
  }
  return out;
}

/** `ps -A -o pid=,args=` → Map pid → args. */
export function parsePsArgs(text) {
  const out = new Map();
  for (const line of String(text ?? '').split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m) out.set(Number(m[1]), m[2]);
  }
  return out;
}

/** `tmux list-panes -a -F '#{pane_pid}\t#{pane_id}\t#{window_id}\t#{session_name}'` → [{ pid, paneId, windowId, session }]. */
export function parseTmuxPanes(text) {
  return String(text ?? '')
    .split('\n')
    .flatMap((line) => {
      const [pid, paneId, windowId, ...session] = line.split('\t');
      return /^\d+$/.test(pid ?? '') && paneId ? [{ pid: Number(pid), paneId, windowId: windowId ?? null, session: session.join('\t') }] : [];
    });
}

/** `/Applications/Visual Studio Code.app/Contents/MacOS/Electron` → "Visual Studio Code"; `/usr/bin/node` → "node". */
export function processLabel(comm) {
  const app = String(comm ?? '').match(/([^/]+)\.app\//);
  return app ? app[1] : path.basename(String(comm ?? ''));
}

/**
 * An executable inside an app installed system-wide (/Applications, /System/Applications,
 * /System/Library, ~/Applications): an editor, a terminal. An `.app` anywhere else (puppeteer's
 * Chrome for Testing under ~/.cache) gets no guard.
 */
export function installedApp(comm, home = os.homedir()) {
  const c = String(comm ?? '');
  if (!/\.app\//.test(c)) return false;
  const roots = ['/Applications/', '/System/Applications/', '/System/Library/', ...(home ? [path.join(home, 'Applications') + '/'] : [])];
  return roots.some((r) => c.startsWith(r));
}

/**
 * What `pid` belongs to, walking up its parents (the worktree-cleanup skill's `processAnchor`):
 * null = rooted in the worktree (it reaches `own` — the session being deleted — or a top
 * process whose cwd is `inside`); otherwise the label of what it belongs to (an anchor's label,
 * or the top process's name).
 */
export function anchorOf(pid, { groups, cwds, anchors, own, inside, home = os.homedir() }) {
  const seen = new Set();
  let cur = pid;
  while (!seen.has(cur)) {
    seen.add(cur);
    if (anchors.has(cur)) return anchors.get(cur);
    if (own.has(cur)) return null;
    const g = groups.get(cur);
    if (g === undefined) return null;
    if (g.ppid <= 1) {
      if (installedApp(g.comm, home)) return processLabel(g.comm);
      return inside(cwds.get(cur)) ? null : processLabel(g.comm ?? '') || `pid ${cur}`;
    }
    cur = g.ppid;
  }
  return null;
}

function childrenOf(groups) {
  const kids = new Map();
  for (const [pid, g] of groups) {
    if (!kids.has(g.ppid)) kids.set(g.ppid, []);
    kids.get(g.ppid).push(pid);
  }
  return kids;
}

/** Every descendant of `pid` (breadth first). */
export function descendants(pid, groups, kids = childrenOf(groups)) {
  const out = [];
  const seen = new Set([pid]);
  const queue = [pid];
  while (queue.length) {
    for (const c of kids.get(queue.shift()) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
      queue.push(c);
    }
  }
  return out;
}

/** The parents of `pid` up to (not including) pid 1. */
export function ancestors(pid, groups) {
  const out = [];
  const seen = new Set([pid]);
  let cur = groups.get(pid)?.ppid;
  while (Number.isInteger(cur) && cur > 1 && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = groups.get(cur)?.ppid;
  }
  return out;
}

const shortCommand = (s) => {
  const one = String(s ?? '').replace(/\s+/g, ' ').trim();
  return one.length > MAX_COMMAND ? `${one.slice(0, MAX_COMMAND - 1)}…` : one || null;
};

/**
 * Split the processes whose cwd is inside `worktree` into what Delete stops and what it leaves.
 *
 * @param snap     { cwds, listen, groups, args, panes } — parsed lsof / ps / tmux snapshots
 * @param worktree canonical worktree path
 * @param nested   canonical paths of other worktrees inside it (their processes are theirs)
 * @param own      pids that close with the session (its process, the panes of its tmux window)
 * @param anchors  Map pid → label of what stays (other sessions, panes that stay, this server)
 * @param selfPid  this server's pid
 * @returns {{ stop: Target[], kept: Kept[] }}
 *   Target { pid, pgid, label, command, ports, pids, underSession } — `pgid` set: the whole
 *   process group is signalled (every member is rooted in the worktree); null: `pid` and its
 *   descendants. `underSession`: it runs under the closing session (normally ends with it)
 *   Kept { pid, label, command, ports, via } — `via`: what it belongs to
 */
export function classify(snap, { worktree, nested = [], own = new Set(), anchors = new Map(), selfPid = process.pid, home = os.homedir() }) {
  const { cwds, listen, groups, args } = snap;
  const inside = (cwd) => isInside(cwd, worktree) && !nested.some((n) => isInside(cwd, n));
  // Ancestors of anything that stays (or of the closing session itself) are never stopped:
  // a tmux server or a shell started inside the worktree still hosts them.
  const guarded = new Map();
  for (const [pid, label] of [...anchors, ...[...own].map((p) => [p, 'this session'])]) {
    for (const a of ancestors(pid, groups)) if (!guarded.has(a) && !own.has(a)) guarded.set(a, `parent of ${label}`);
  }
  const ports = (pids) => [...new Set(pids.flatMap((p) => [...(listen.get(p) ?? [])]))].sort((a, b) => a - b);
  const describe = (pid) => {
    const comm = groups.get(pid)?.comm ?? null;
    return { label: processLabel(comm ?? args.get(pid)?.split(' ')[0] ?? '') || `pid ${pid}`, command: shortCommand(args.get(pid) ?? comm) };
  };

  const killable = new Set();
  const kept = [];
  for (const [pid, cwd] of cwds) {
    if (!Number.isInteger(pid) || pid <= 1 || own.has(pid) || !inside(cwd)) continue;
    const via =
      pid === selfPid ? 'fleet web' : anchors.get(pid) ?? guarded.get(pid) ?? anchorOf(pid, { groups, cwds, anchors, own, inside, home });
    if (via === null) killable.add(pid);
    else kept.push({ pid, ...describe(pid), ports: ports([pid]), via });
  }

  const untouchable = new Set([selfPid, ...own, ...anchors.keys(), ...guarded.keys(), ...kept.map((k) => k.pid)]);
  const selfPgid = groups.get(selfPid)?.pgid;
  const kids = childrenOf(groups);
  const byGroup = new Map();
  for (const [pid, g] of groups) {
    if (!byGroup.has(g.pgid)) byGroup.set(g.pgid, []);
    byGroup.get(g.pgid).push(pid);
  }
  const roots = [...killable].filter((pid) => !killable.has(groups.get(pid)?.ppid)).sort((a, b) => a - b);
  const plan = new Map();
  for (const pid of roots) {
    const pgid = groups.get(pid)?.pgid;
    const members = byGroup.get(pgid) ?? [];
    const groupSafe =
      Number.isInteger(pgid) &&
      pgid > 1 &&
      pgid !== selfPgid &&
      members.length > 0 &&
      members.every((m) => !untouchable.has(m) && (!cwds.has(m) || inside(cwds.get(m))));
    const key = groupSafe ? `g${pgid}` : `p${pid}`;
    if (plan.has(key)) continue;
    const pids = groupSafe ? [...members].sort((a, b) => a - b) : [pid, ...descendants(pid, groups, kids).filter((p) => !untouchable.has(p))];
    // A group is named after its leader when the leader is in it, else after this root.
    const head = groupSafe && members.includes(pgid) ? pgid : pid;
    // underSession: it runs under the session's own process / pane (it normally ends with it).
    const underSession = ancestors(pid, groups).some((a) => own.has(a));
    plan.set(key, { pid: head, pgid: groupSafe ? pgid : null, ...describe(head), ports: ports(pids), pids, underSession });
  }
  // A root already covered by another root's group or tree is not listed twice.
  const covered = new Set();
  const stop = [];
  for (const t of plan.values()) {
    if (t.pids.every((p) => covered.has(p))) continue;
    t.pids.forEach((p) => covered.add(p));
    stop.push(t);
  }
  return { stop, kept: kept.sort((a, b) => a.pid - b.pid) };
}

function isAlive(pid, killProcess) {
  try {
    killProcess(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

/**
 * @param deps
 *   run          execFile wrapper (lib/run.mjs)
 *   tmux         tmux binary
 *   lsof / ps    binaries
 *   killProcess  process.kill (injected for tests)
 *   sleep        (ms) => Promise
 *   selfPid      this server's pid (never signalled, nor its process group)
 *   home         $HOME (for ~/Applications: apps installed there are never "started in" a worktree)
 *   graceMs      SIGTERM → SIGKILL grace period
 */
export function createServerStopper({
  run,
  tmux = 'tmux',
  lsof = 'lsof',
  ps = 'ps',
  killProcess = process.kill.bind(process),
  sleep,
  selfPid = process.pid,
  home = os.homedir(),
  graceMs = 8000,
}) {
  if (typeof run !== 'function') throw new TypeError('run must be a function');
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // lsof exits 1 when it could not read some process; what it printed is still right.
  const output = (bin, args) =>
    run(bin, args, { timeout: SCAN_MS }).then(
      (r) => r.stdout,
      (err) => {
        if (err?.code === 'ENOENT' || !err?.stdout) throw err;
        return err.stdout;
      },
    );

  /** Every process's cwd, listening ports, group and parent, and the tmux panes. */
  async function snapshot() {
    const [cwd, listenOut, groupsOut, argsOut, panesOut] = await Promise.all([
      output(lsof, ['-w', '-a', '-d', 'cwd', '-Fpn']),
      output(lsof, ['-w', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']).catch(() => ''),
      output(ps, ['-A', '-o', 'pid=,pgid=,ppid=,comm=']),
      output(ps, ['-A', '-o', 'pid=,args=']).catch(() => ''),
      run(tmux, ['list-panes', '-a', '-F', '#{pane_pid}\t#{pane_id}\t#{window_id}\t#{session_name}'], { timeout: 5000 }).then(
        (r) => r.stdout,
        () => '', // no tmux server: no panes
      ),
    ]);
    return {
      cwds: parseLsofCwd(cwd),
      listen: parseLsofListen(listenOut),
      groups: parsePsGroups(groupsOut),
      args: parsePsArgs(argsOut),
      panes: parseTmuxPanes(panesOut),
    };
  }

  /** The pids that close with `session`: its process and the panes of its tmux window (kill.mjs takes the window). */
  function ownOf(session, panes) {
    const own = new Set();
    if (Number.isInteger(session?.pid) && session.pid > 1) own.add(session.pid);
    if (session?.backend === 'tmux' && session.handle) {
      const pane = panes.find((p) => p.paneId === session.handle);
      for (const p of panes) if (pane && p.windowId === pane.windowId) own.add(p.pid);
    }
    return own;
  }

  /** What stays: other live sessions, tmux panes outside the closing window, this server. */
  function anchorsOf(session, sessions, panes, own) {
    const anchors = new Map();
    for (const p of panes) if (!own.has(p.pid)) anchors.set(p.pid, `tmux ${p.session}`);
    for (const s of Array.isArray(sessions) ? sessions : []) {
      if (!Number.isInteger(s?.pid) || own.has(s.pid) || s === session) continue;
      if (session?.session_id && s.session_id === session.session_id) continue;
      anchors.set(s.pid, `session ${s.name ?? s.display_title ?? s.session_id?.slice(0, 8) ?? s.pid}`);
    }
    anchors.set(selfPid, 'fleet web');
    return anchors;
  }

  /**
   * What Delete would stop in `worktree` for `session`, from a fresh snapshot.
   * `own`: pass the pids captured before the session was closed (its panes are gone after).
   * → { stop, kept, error, own: Set, listening: Set(port) }
   */
  async function plan({ worktree, nested = [], session, sessions = [], own: ownIn = null }) {
    let snap;
    try {
      snap = await snapshot();
    } catch (err) {
      return { stop: [], kept: [], error: `could not list processes: ${String(err?.message ?? err).split('\n')[0]}`, own: ownIn ?? new Set(), listening: new Set() };
    }
    const own = ownIn ?? ownOf(session, snap.panes);
    const anchors = anchorsOf(session, sessions, snap.panes, own);
    const { stop, kept } = classify(snap, { worktree, nested, own, anchors, selfPid, home });
    return { stop, kept, error: null, own, listening: new Set([...snap.listen.values()].flatMap((s) => [...s])) };
  }

  /** Ports something listens on right now (for leftovers that must only go once their port is free). */
  async function listening() {
    try {
      const listen = parseLsofListen(await output(lsof, ['-w', '-nP', '-iTCP', '-sTCP:LISTEN', '-Fpn']));
      return new Set([...listen.values()].flatMap((s) => [...s]));
    } catch {
      return null;
    }
  }

  const selfPgid = () => {
    try {
      return typeof process.getpgid === 'function' && selfPid === process.pid ? process.getpgid(selfPid) : null;
    } catch {
      return null;
    }
  };

  /** Signal a target; returns an error message for a refused signal (EPERM), else null. */
  function signal(t, sig) {
    const send = (id) => {
      try {
        killProcess(id, sig);
        return null;
      } catch (err) {
        return err?.code === 'ESRCH' ? null : String(err?.message ?? err);
      }
    };
    if (t.pgid) {
      if (t.pgid <= 1 || t.pgid === selfPgid()) return 'refused: own process group';
      return send(-t.pgid);
    }
    let error = null;
    for (const p of t.pids) if (p > 1 && p !== selfPid) error = send(p) ?? error;
    return error;
  }

  /**
   * SIGTERM every target (its process group, or its pids), wait up to graceMs for all of them,
   * then SIGKILL what is left. → [{ ...target, result: 'terminated' | 'killed' | 'gone' |
   * 'failed', error }]
   */
  async function stop(targets) {
    const alive = (t) => t.pids.some((p) => p > 1 && p !== selfPid && isAlive(p, killProcess));
    const out = targets.map((t) => ({ ...t, result: alive(t) ? null : 'gone', error: null }));
    for (const t of out) if (t.result === null) t.error = signal(t, 'SIGTERM');
    for (let waited = 0; waited < graceMs && out.some((t) => t.result === null && alive(t)); waited += STEP_MS) await wait(STEP_MS);
    const survivors = out.filter((t) => t.result === null && alive(t));
    for (const t of survivors) t.error = signal(t, 'SIGKILL') ?? t.error;
    if (survivors.length) await wait(STEP_MS);
    for (const t of out) {
      if (t.result !== null) continue;
      if (!survivors.includes(t)) t.result = 'terminated';
      else t.result = alive(t) ? 'failed' : 'killed';
      if (t.result !== 'failed') t.error = null;
      else t.error ??= 'still running after SIGKILL';
    }
    return out;
  }

  return { plan, stop, listening, snapshot };
}
