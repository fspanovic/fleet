import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anchorOf,
  classify,
  createServerStopper,
  parseLsofCwd,
  parseLsofListen,
  parsePsArgs,
  parsePsGroups,
  parseTmuxPanes,
  installedApp,
  processLabel,
} from '../lib/devservers.mjs';

const WT = '/w/worktrees/app-feat';
const VSCODE = '/Applications/Visual Studio Code.app/Contents/MacOS/Electron';

/**
 * A process table: [pid, ppid, pgid, cwd | null, comm, ports?]. Builds the snapshot `classify`
 * reads (cwds, listen, groups, args) the way the lsof / ps parsers would.
 */
function table(rows) {
  const cwds = new Map();
  const listen = new Map();
  const groups = new Map();
  const args = new Map();
  for (const [pid, ppid, pgid, cwd, comm, ports = []] of rows) {
    groups.set(pid, { pgid, ppid, comm });
    args.set(pid, `${comm} --args-of-${pid}`);
    if (cwd) cwds.set(pid, cwd);
    if (ports.length) listen.set(pid, new Set(ports));
  }
  return { cwds, listen, groups, args, panes: [] };
}

// The closing session: Claude 111 in tmux pane 110 (its window). Another tmux session's pane
// 140, another live session 160, this server 170, and an editor 150 — all with cwds inside.
const SNAP = table([
  [1, 0, 1, '/', '/sbin/launchd'],
  [100, 1, 100, WT, '/opt/homebrew/bin/tmux'], // the tmux server, started inside the worktree
  [110, 100, 110, WT, '/bin/zsh'], // the session's pane
  [111, 110, 111, WT, '/usr/local/bin/claude'], // the session
  [120, 111, 120, WT, '/bin/zsh'], // a Bash-tool shell…
  [121, 120, 120, `${WT}/apps/web`, '/usr/local/bin/node', [4250]], // …running vite
  [130, 1, 130, WT, '/usr/bin/ruby', [3000]], // an orphaned puma…
  [131, 130, 130, WT, '/usr/bin/ruby'], // …and its worker
  [140, 100, 140, WT, '/bin/zsh'], // another tmux session's pane
  [141, 140, 141, WT, '/usr/bin/ruby', [3001]], // `rails s` typed there
  [150, 1, 150, WT, VSCODE], // the editor (`code .`)
  [151, 150, 150, WT, '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper'],
  [160, 1, 160, `${WT}/sub`, '/usr/local/bin/claude'], // another live session
  [170, 1, 170, WT, '/usr/local/bin/node', [7777]], // this server
  [180, 1, 180, `${WT}/nested-wt`, '/usr/local/bin/node'], // another worktree nested inside
  [190, 1, 190, '/elsewhere', '/usr/local/bin/node', [5000]],
  [200, 1, 200, WT, '/usr/bin/ruby'], // an orphaned sidekiq whose group has an outsider
  [201, 1, 200, '/elsewhere', '/bin/sleep'],
  [202, 200, 200, '/tmp', '/bin/sh'], // its child, cwd outside — part of its tree
  [210, 1, 170, WT, '/usr/local/bin/node'], // an orphan in this server's process group
]);
const OWN = new Set([110, 111]);
const ANCHORS = new Map([
  [140, 'tmux other'],
  [160, 'session other'],
  [170, 'fleet web'],
]);

test('parsers: lsof cwd / LISTEN, ps groups / args, tmux panes, labels', () => {
  assert.deepEqual([...parseLsofCwd('p12\nfcwd\nn/w/a b\np13\nfcwd\nn/\n')], [
    [12, '/w/a b'],
    [13, '/'],
  ]);
  const listen = parseLsofListen('p12\nf20\nn*:4250\nf21\nn[::1]:4250\nf22\nn127.0.0.1:9229\np13\nf5\nn*:*\n');
  assert.deepEqual([...listen.get(12)], [4250, 9229]);
  assert.equal(listen.has(13), false);
  assert.deepEqual(parsePsGroups('  12    12     1 /usr/bin/node\n 13 12 12 /Applications/X Y.app/Contents/MacOS/X Y\njunk\n').get(13), {
    pgid: 12,
    ppid: 12,
    comm: '/Applications/X Y.app/Contents/MacOS/X Y',
  });
  assert.equal(parsePsArgs('  12 node /w/node_modules/.bin/vite --port 4250\n').get(12), 'node /w/node_modules/.bin/vite --port 4250');
  assert.deepEqual(parseTmuxPanes('110\t%5\t@2\tjob\n140\t%9\t@4\tother name\n\nbad\n'), [
    { pid: 110, paneId: '%5', windowId: '@2', session: 'job' },
    { pid: 140, paneId: '%9', windowId: '@4', session: 'other name' },
  ]);
  assert.equal(processLabel(VSCODE), 'Visual Studio Code');
  assert.equal(processLabel('/usr/bin/ruby'), 'ruby');
});

test('anchorOf: rooted in the worktree or the closing session → null; else what it belongs to', () => {
  const inside = (cwd) => typeof cwd === 'string' && (cwd === WT || cwd.startsWith(`${WT}/`));
  const ctx = { groups: SNAP.groups, cwds: SNAP.cwds, anchors: ANCHORS, own: OWN, inside };
  assert.equal(anchorOf(121, ctx), null, 'under the closing session');
  assert.equal(anchorOf(131, ctx), null, 'an orphan tree rooted inside');
  assert.equal(anchorOf(141, ctx), 'tmux other');
  assert.equal(anchorOf(151, ctx), 'Visual Studio Code', 'an app bundle is never rooted in the worktree');
  assert.equal(anchorOf(190, ctx), 'node', 'a top process outside');
});

test('classify: stops only what was started in the worktree, by group when the whole group is', () => {
  const { stop, kept } = classify(SNAP, { worktree: WT, nested: [`${WT}/nested-wt`], own: OWN, anchors: ANCHORS, selfPid: 170 });
  assert.deepEqual(
    stop.map((t) => ({ pid: t.pid, pgid: t.pgid, pids: t.pids, ports: t.ports, underSession: t.underSession })),
    [
      { pid: 120, pgid: 120, pids: [120, 121], ports: [4250], underSession: true },
      { pid: 130, pgid: 130, pids: [130, 131], ports: [3000], underSession: false },
      // Its group has a member outside the worktree: the pid and its tree only.
      { pid: 200, pgid: null, pids: [200, 202], ports: [], underSession: false },
      // Same process group as this server: never by group.
      { pid: 210, pgid: null, pids: [210], ports: [], underSession: false },
    ],
  );
  assert.equal(stop[0].label, 'zsh');
  assert.equal(stop[0].command, '/bin/zsh --args-of-120');
  assert.deepEqual(
    kept.map((k) => [k.pid, k.via]),
    [
      [100, 'parent of tmux other'],
      [140, 'tmux other'],
      [141, 'tmux other'],
      [150, 'Visual Studio Code'],
      [151, 'Visual Studio Code'],
      [160, 'session other'],
      [170, 'fleet web'],
    ],
  );
  assert.deepEqual(kept.find((k) => k.pid === 141).ports, [3001]);
  const all = new Set(stop.flatMap((t) => t.pids));
  for (const pid of [1, 100, 110, 111, 140, 141, 150, 151, 160, 170, 180, 190, 201]) assert.equal(all.has(pid), false, `${pid} is never signalled`);
});

test('classify: a group that holds the closing session is signalled per pid, not by group', () => {
  const snap = table([
    [110, 1, 110, '/', '/bin/zsh'],
    [111, 110, 111, WT, '/usr/local/bin/claude'],
    [112, 111, 111, WT, '/usr/local/bin/node', [4300]], // same group as Claude
  ]);
  const { stop } = classify(snap, { worktree: WT, own: new Set([111]), anchors: new Map(), selfPid: 999 });
  assert.deepEqual(stop.map((t) => [t.pid, t.pgid, t.pids]), [[112, null, [112]]]);
});

/** A fake process table for signals: `term` pids die on SIGTERM, others only on SIGKILL; `eperm` refuse. */
function fakeProcesses({ alive, groups = {}, ignoreTerm = [], eperm = [] }) {
  const live = new Set(alive);
  const signals = [];
  const members = (id) => (id < 0 ? (groups[-id] ?? []) : [id]);
  const killProcess = (id, sig) => {
    signals.push([id, sig]);
    const pids = members(id).filter((p) => live.has(p));
    if (sig === 0) {
      if (!pids.length) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      return true;
    }
    if (!pids.length) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
    if (pids.some((p) => eperm.includes(p))) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    for (const p of pids) if (sig === 'SIGKILL' || !ignoreTerm.includes(p)) live.delete(p);
    return true;
  };
  return { killProcess, signals, live };
}

test('stop: SIGTERM, grace, SIGKILL; reports terminated / killed / gone / failed', async () => {
  const procs = fakeProcesses({ alive: [120, 121, 130, 131, 200], groups: { 120: [120, 121], 130: [130, 131] }, ignoreTerm: [130], eperm: [200] });
  const sleeps = [];
  const stopper = createServerStopper({ run: async () => ({ stdout: '' }), killProcess: procs.killProcess, sleep: async (ms) => sleeps.push(ms), selfPid: 999, graceMs: 1000 });
  const res = await stopper.stop([
    { pid: 120, pgid: 120, pids: [120, 121], ports: [4250] },
    { pid: 130, pgid: 130, pids: [130, 131], ports: [3000] },
    { pid: 200, pgid: null, pids: [200], ports: [] },
    { pid: 300, pgid: null, pids: [300], ports: [] },
  ]);
  assert.deepEqual(
    res.map((t) => [t.pid, t.result]),
    [
      [120, 'terminated'],
      [130, 'killed'],
      [200, 'failed'],
      [300, 'gone'],
    ],
  );
  assert.match(res[2].error, /not permitted/);
  assert.deepEqual(
    procs.signals.filter(([, s]) => s !== 0),
    [
      [-120, 'SIGTERM'],
      [-130, 'SIGTERM'],
      [200, 'SIGTERM'],
      [-130, 'SIGKILL'],
      [200, 'SIGKILL'],
    ],
  );
  assert.ok(sleeps.length >= 4 && sleeps.length <= 6, 'waits the grace period, then once after SIGKILL');
});

test('stop: never signals pid 1, this server or a group ≤ 1', async () => {
  const procs = fakeProcesses({ alive: [1, 999, 50], groups: { 1: [1] } });
  const stopper = createServerStopper({ run: async () => ({ stdout: '' }), killProcess: procs.killProcess, sleep: async () => {}, selfPid: 999, graceMs: 0 });
  await stopper.stop([
    { pid: 1, pgid: 1, pids: [1], ports: [] },
    { pid: 50, pgid: null, pids: [1, 999, 50], ports: [] },
  ]);
  assert.deepEqual(
    procs.signals.filter(([, s]) => s !== 0),
    [
      [50, 'SIGTERM'],
    ],
  );
});

function fakeRun(outputs) {
  const calls = [];
  const run = async (bin, args) => {
    calls.push([bin, ...args].join(' '));
    const key = Object.keys(outputs).find((k) => [bin, ...args].join(' ').startsWith(k));
    const out = outputs[key];
    if (out instanceof Error) throw out;
    if (out === undefined) throw new Error(`unexpected ${bin} ${args.join(' ')}`);
    return { stdout: out, stderr: '' };
  };
  return { run, calls };
}

const LSOF_CWD = ['p110', 'n' + WT, 'p111', 'n' + WT, 'p120', 'n' + WT, 'p121', 'n' + `${WT}/apps/web`, 'p140', 'n' + WT, 'p160', 'n' + `${WT}/sub`].join('\n');
const PS = ['1 1 0 /sbin/launchd', '100 100 1 /opt/homebrew/bin/tmux', '110 110 100 /bin/zsh', '111 111 110 /usr/local/bin/claude', '120 120 111 /bin/zsh', '121 120 120 /usr/local/bin/node', '140 140 100 /bin/zsh', '160 160 1 /usr/local/bin/claude'].join('\n');
const PANES = ['110\t%5\t@2\tjob', '112\t%6\t@2\tjob', '140\t%9\t@4\tother'].join('\n');

test('plan: the session and its tmux window close with it; other sessions and panes anchor; lsof exit 1 still parses', async () => {
  const lsofPartial = Object.assign(new Error('lsof: WARNING'), { code: 1, stdout: LSOF_CWD });
  const { run, calls } = fakeRun({
    'lsof -w -a -d cwd': lsofPartial,
    'lsof -w -nP -iTCP': 'p121\nn*:4250\n',
    'ps -A -o pid=,pgid=,ppid=,comm=': PS,
    'ps -A -o pid=,args=': '121 node vite --port 4250\n',
    'tmux list-panes': PANES,
  });
  const stopper = createServerStopper({ run, killProcess: () => assert.fail('plan never signals'), selfPid: 999 });
  const session = { session_id: 's1', pid: 111, backend: 'tmux', handle: '%5', cwd: WT };
  const other = { session_id: 's2', name: 'other', pid: 160, cwd: `${WT}/sub` };
  const p = await stopper.plan({ worktree: WT, session, sessions: [session, other] });
  assert.equal(p.error, null);
  assert.deepEqual([...p.own].sort(), [110, 111, 112]);
  assert.deepEqual(p.stop.map((t) => [t.pid, t.pgid, t.pids, t.ports, t.command]), [[120, 120, [120, 121], [4250], '/bin/zsh']]);
  assert.deepEqual(p.kept.map((k) => [k.pid, k.via]), [[140, 'tmux other'], [160, 'session other']]);
  assert.deepEqual([...p.listening], [4250]);
  assert.ok(calls.every((c) => !/kill/.test(c)));
});

test('plan: no lsof → an error, nothing to stop', async () => {
  const { run } = fakeRun({ lsof: Object.assign(new Error('spawn lsof ENOENT'), { code: 'ENOENT' }), ps: PS, tmux: '' });
  const p = await createServerStopper({ run, selfPid: 999 }).plan({ worktree: WT, session: { pid: 111 }, sessions: [] });
  assert.deepEqual(p.stop, []);
  assert.match(p.error, /could not list processes/);
});

test('installed apps only: an editor in /Applications stays, puppeteer Chrome for Testing under ~/.cache is stopped', () => {
  const HOME = '/Users/tester';
  const CHROME = `${HOME}/.cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
  const ZED = `${HOME}/Applications/Zed.app/Contents/MacOS/zed`;
  assert.equal(installedApp(VSCODE, HOME), true);
  assert.equal(installedApp('/System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal', HOME), true);
  assert.equal(installedApp('/System/Library/CoreServices/Finder.app/Contents/MacOS/Finder', HOME), true);
  assert.equal(installedApp(ZED, HOME), true);
  assert.equal(installedApp(CHROME, HOME), false);
  assert.equal(installedApp('/usr/local/bin/node', HOME), false);

  const snap = table([
    [150, 1, 150, WT, VSCODE], // `code .` in the worktree
    [151, 150, 150, WT, '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper'],
    [160, 1, 160, WT, ZED],
    [300, 1, 300, WT, CHROME, [9400]], // orphaned by a finished live test
    [301, 300, 300, WT, `${CHROME} Helper`],
    [310, 1, 310, '/elsewhere', CHROME], // a Chrome for Testing started elsewhere: not this worktree's
  ]);
  const { stop, kept } = classify(snap, { worktree: WT, own: new Set(), anchors: new Map(), selfPid: 999, home: HOME });
  assert.deepEqual(stop.map((t) => [t.pid, t.pgid, t.pids, t.ports, t.label]), [[300, 300, [300, 301], [9400], 'Google Chrome for Testing']]);
  assert.deepEqual(kept.map((k) => [k.pid, k.via]), [
    [150, 'Visual Studio Code'],
    [151, 'Visual Studio Code'],
    [160, 'Zed'],
  ]);
});
