import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeleter, parseStatus, parseWorktreeList } from '../lib/delete.mjs';

const MAIN = '/w/repo';
const WT = '/w/worktrees/repo-feat';
const LIST = `worktree ${MAIN}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${WT}\nHEAD def\nbranch refs/heads/feat\n`;

/**
 * A git that knows two checkouts: MAIN (main checkout) and WT (a linked worktree of it).
 * `status`: porcelain -z output for WT; `ahead`: commits on no remote; `remove`: what
 * `worktree remove` does ('ok' | an error message); `after`: the worktree list after it.
 */
function fakeGit({ status = '', ahead = 0, remove = 'ok', after = `worktree ${MAIN}\nHEAD abc\nbranch refs/heads/main\n`, locked = false } = {}) {
  const calls = [];
  let removed = false;
  const run = async (bin, args) => {
    calls.push([bin, ...args]);
    const [, dir, ...rest] = args;
    const cmd = rest.join(' ');
    if (cmd.startsWith('rev-parse')) {
      if (dir.startsWith(WT)) return { stdout: `feat\n${WT}\n${MAIN}/.git/worktrees/repo-feat\n${MAIN}/.git\n`, stderr: '' };
      if (dir.startsWith(MAIN)) return { stdout: `main\n${MAIN}\n.git\n.git\n`, stderr: '' };
      throw new Error('fatal: not a git repository');
    }
    if (cmd === 'worktree list --porcelain') return { stdout: removed ? after : locked ? LIST.replace('branch refs/heads/feat\n', 'branch refs/heads/feat\nlocked\n') : LIST, stderr: '' };
    if (cmd === 'status --porcelain -z') return { stdout: status, stderr: '' };
    if (cmd.startsWith('rev-list --count')) return { stdout: `${ahead}\n`, stderr: '' };
    if (cmd.startsWith('log')) return { stdout: Array.from({ length: Math.min(ahead, 5) }, (_, i) => `c${i}\tcommit ${i}`).join('\n'), stderr: '' };
    if (rest[0] === 'worktree' && rest[1] === 'remove') {
      if (remove !== 'ok') throw new Error(remove);
      removed = true;
      return { stdout: '', stderr: '' };
    }
    if (cmd === 'worktree prune') return { stdout: '', stderr: '' };
    throw new Error(`unexpected git ${cmd}`);
  };
  return { calls, run };
}

function fakeKiller() {
  const killed = [];
  return { killed, kill: async (s) => (killed.push(s.session_id), { process: 'terminated', terminal: 'tmux-session-killed' }) };
}

const realpath = async (p) => p;
const session = (id, cwd, pid) => ({ session_id: id, pid, cwd, name: id, display_title: `title ${id}`, status: 'idle', host: 'laptop' });
const me = session('aaaaaaaa-1', `${WT}/src`, 101);
const gitCalls = (calls) => calls.filter((c) => c[3] === 'worktree' && c[4] !== 'list').map((c) => c.slice(1).join(' '));

test('parseWorktreeList: main checkout first, branches and locks', () => {
  assert.deepEqual(parseWorktreeList(`${LIST}\nworktree /w/x\nHEAD 123\ndetached\nlocked by me\n`), [
    { path: MAIN, branch: 'main', locked: false },
    { path: WT, branch: 'feat', locked: false },
    { path: '/w/x', branch: null, locked: true },
  ]);
});

test('parseStatus: porcelain -z entries, a rename counts once', () => {
  assert.deepEqual(parseStatus(' M a.txt\0?? dir/\0R  new.md\0old.md\0'), [
    { status: 'M', path: 'a.txt' },
    { status: '??', path: 'dir/' },
    { status: 'R', path: 'new.md' },
  ]);
  assert.deepEqual(parseStatus(''), []);
});

test('inspect: a clean linked worktree is removable without force', async () => {
  const { run } = fakeGit();
  const d = createDeleter({ run, killer: fakeKiller(), realpath });
  const plan = await d.inspect(me, [me]);
  assert.equal(plan.action, 'remove-worktree');
  assert.deepEqual(plan.checkout, { path: WT, branch: 'feat', linked: true });
  assert.deepEqual(plan.worktree, { path: WT, branch: 'feat', mainPath: MAIN, locked: false, dirty: { count: 0, files: [] }, unpushed: { count: 0, commits: [] } });
  assert.equal(plan.blocked, false);
  assert.equal(plan.needsForce, false);
});

test('delete: clean worktree → kill, then `git worktree remove` (not forced) from the main checkout', async () => {
  const { calls, run } = fakeGit();
  const killer = fakeKiller();
  const d = createDeleter({ run, killer, realpath, exists: async () => false });
  const res = await d.remove(me, [me], { force: true });
  assert.equal(res.refused, undefined);
  assert.deepEqual(killer.killed, ['aaaaaaaa-1']);
  assert.equal(res.terminal, 'tmux-session-killed');
  assert.deepEqual(res.worktree, { path: WT, branch: 'feat', removed: true, forced: false, pruned: false, error: null });
  assert.deepEqual(gitCalls(calls), [`-C ${MAIN} worktree remove ${WT}`]);
  assert.ok(!calls.some((c) => c.includes('branch')), 'the branch is kept');
});

test('delete: uncommitted changes / unpushed commits are refused unless forced, nothing closed', async () => {
  const dirty = fakeGit({ status: ' M a.txt\0?? b.txt\0', ahead: 2 });
  const killer = fakeKiller();
  const d = createDeleter({ run: dirty.run, killer, realpath, exists: async () => false });
  const plan = await d.inspect(me, [me]);
  assert.equal(plan.needsForce, true);
  assert.equal(plan.worktree.dirty.count, 2);
  assert.deepEqual(plan.worktree.dirty.files.map((f) => f.path), ['a.txt', 'b.txt']);
  assert.deepEqual(plan.worktree.unpushed, { count: 2, commits: [{ sha: 'c0', subject: 'commit 0' }, { sha: 'c1', subject: 'commit 1' }] });

  const refused = await d.remove(me, [me]);
  assert.equal(refused.refused, 'changes');
  assert.deepEqual(killer.killed, []);
  assert.deepEqual(gitCalls(dirty.calls), []);

  const forced = await d.remove(me, [me], { force: true });
  assert.deepEqual(killer.killed, ['aaaaaaaa-1']);
  assert.equal(forced.worktree.forced, true);
  assert.deepEqual(gitCalls(dirty.calls), [`-C ${MAIN} worktree remove --force ${WT}`]);
});

test('delete: another live session inside the worktree blocks it, even forced', async () => {
  const { calls, run } = fakeGit({ status: ' M a.txt\0' });
  const killer = fakeKiller();
  const d = createDeleter({ run, killer, realpath });
  const other = session('bbbbbbbb-2', `${WT}/web`, 202);
  const elsewhere = session('cccccccc-3', '/w/worktrees/repo-feat-2', 303);
  const plan = await d.inspect(me, [me, other, elsewhere]);
  assert.equal(plan.blocked, true);
  assert.deepEqual(plan.sessions, [{ host: 'laptop', id: 'bbbbbbbb-2', name: 'bbbbbbbb-2', title: 'title bbbbbbbb-2', cwd: `${WT}/web`, status: 'idle' }]);
  const res = await d.remove(me, [me, other, elsewhere], { force: true });
  assert.equal(res.refused, 'sessions');
  assert.deepEqual(killer.killed, []);
  assert.deepEqual(gitCalls(calls), []);
});

test('delete: a locked worktree is refused before anything is closed', async () => {
  const { calls, run } = fakeGit({ locked: true });
  const killer = fakeKiller();
  const res = await createDeleter({ run, killer, realpath }).remove(me, [me], { force: true });
  assert.equal(res.refused, 'locked');
  assert.deepEqual(killer.killed, []);
  assert.deepEqual(gitCalls(calls), []);
});

test('delete: the main checkout and a non-git cwd only close the session', async () => {
  for (const [cwd, reason] of [
    [`${MAIN}/web`, 'main-checkout'],
    ['/tmp/scratch', 'not-git'],
    [null, 'no-cwd'],
  ]) {
    const { calls, run } = fakeGit();
    const killer = fakeKiller();
    const s = session('dddddddd-4', cwd, 404);
    const d = createDeleter({ run, killer, realpath });
    const plan = await d.inspect(s, [s]);
    assert.equal(plan.action, 'close-only', reason);
    assert.equal(plan.reason, reason);
    const res = await d.remove(s, [s], { force: true });
    assert.deepEqual(killer.killed, ['dddddddd-4'], reason);
    assert.equal(res.worktree, null);
    assert.deepEqual(gitCalls(calls), [], reason);
  }
});

test('delete: a failed remove is reported (the session is already closed); prune only for a missing dir still registered', async () => {
  const failing = fakeGit({ remove: "fatal: '/w/worktrees/repo-feat' contains modified or untracked files, use --force to delete it" });
  const res = await createDeleter({ run: failing.run, killer: fakeKiller(), realpath, exists: async () => true }).remove(me, [me]);
  assert.equal(res.worktree.removed, false);
  assert.match(res.worktree.error, /modified or untracked/);
  assert.equal(res.worktree.pruned, false);
  assert.ok(!failing.calls.some((c) => c.includes('prune')));

  // Removed, but git still lists it and its directory is gone: prune.
  const stale = fakeGit({ after: LIST });
  const res2 = await createDeleter({ run: stale.run, killer: fakeKiller(), realpath, exists: async () => false }).remove(me, [me]);
  assert.equal(res2.worktree.removed, true);
  assert.equal(res2.worktree.pruned, true);
  assert.deepEqual(gitCalls(stale.calls), [`-C ${MAIN} worktree remove ${WT}`, `-C ${MAIN} worktree prune`]);
});

/** Fake lib/devservers.mjs + lib/leftovers.mjs that log into `log` (shared with git and the killer). */
function fakeDev(log) {
  const target = { pid: 120, pgid: 120, label: 'node', command: 'node vite', ports: [4250], pids: [120, 121], underSession: true };
  const servers = {
    plans: [],
    plan: async (args) => {
      servers.plans.push(args);
      log.push(args.own ? 'servers.plan(after close)' : 'servers.plan');
      return { stop: [target], kept: [{ pid: 140, label: 'zsh', command: 'zsh', ports: [], via: 'tmux other' }], error: null, own: new Set([101, 110]), listening: new Set([4250]) };
    },
    stop: async (targets) => (log.push(`servers.stop ${targets.map((t) => t.pid).join(',')}`), targets.map((t) => ({ ...t, result: 'terminated', error: null }))),
    listening: async () => (log.push('servers.listening'), new Set()),
  };
  const leftovers = {
    plan: async ({ going, ports }) => (log.push(`leftovers.plan going=${[...going].join(',')} ports=${[...ports].join(',')}`), [{ kind: 'puma-dev', name: 'app-feat-4250.productive.io', port: 4250, keep: null }]),
    clean: async ({ worktree, ports, listening }) => (
      log.push(`leftovers.clean ${worktree} ports=${[...ports].join(',')} listening=${[...listening].join(',')}`),
      [{ kind: 'puma-dev', name: 'app-feat-4250.productive.io', result: 'removed', note: 'port 4250' }]
    ),
  };
  return { servers, leftovers, target };
}

test('inspect: lists the servers it would stop and the leftovers it would clean', async () => {
  const log = [];
  const { servers, leftovers, target } = fakeDev(log);
  const d = createDeleter({ run: fakeGit().run, killer: fakeKiller(), realpath, servers, leftovers });
  const plan = await d.inspect(me, [me]);
  assert.deepEqual(plan.servers, { stop: [target], kept: [{ pid: 140, label: 'zsh', command: 'zsh', ports: [], via: 'tmux other' }], error: null });
  assert.deepEqual(plan.leftovers, [{ kind: 'puma-dev', name: 'app-feat-4250.productive.io', port: 4250, keep: null }]);
  assert.equal(plan.own, undefined, 'internal state is not part of the plan');
  assert.deepEqual(servers.plans[0].worktree, WT);
  assert.deepEqual(log, ['servers.plan', 'leftovers.plan going=101,110,120,121 ports=4250']);
  assert.deepEqual(servers.plans.length, 1);
});

test('delete: close → stop servers → git worktree remove → leftovers, all reported', async () => {
  const log = [];
  const { servers, leftovers } = fakeDev(log);
  const git = fakeGit();
  const run = async (bin, args) => {
    if (args.includes('remove')) log.push('git worktree remove');
    return git.run(bin, args);
  };
  const killer = { kill: async () => (log.push('kill'), { process: 'terminated', terminal: 'tmux-session-killed' }) };
  const res = await createDeleter({ run, killer, realpath, exists: async () => false, servers, leftovers }).remove(me, [me]);
  assert.deepEqual(log, [
    'servers.plan',
    'leftovers.plan going=101,110,120,121 ports=4250',
    'kill',
    'servers.plan(after close)',
    'servers.stop 120',
    'git worktree remove',
    'servers.listening',
    `leftovers.clean ${WT} ports=4250 listening=`,
  ]);
  // The fresh look after the close reuses the pids that closed with the session.
  assert.deepEqual([...servers.plans[1].own], [101, 110]);
  assert.deepEqual(res.servers.stopped.map((t) => [t.pid, t.result, t.ports]), [[120, 'terminated', [4250]]]);
  assert.deepEqual(res.servers.kept.map((k) => k.pid), [140]);
  assert.equal(res.servers.error, null);
  assert.deepEqual(res.leftovers, [{ kind: 'puma-dev', name: 'app-feat-4250.productive.io', result: 'removed', note: 'port 4250' }]);
  assert.equal(res.worktree.removed, true);
});

test('delete: a refused delete stops nothing and cleans nothing; close-only never stops servers', async () => {
  const log = [];
  const { servers, leftovers } = fakeDev(log);
  const dirty = fakeGit({ status: ' M a.txt\0' });
  const refused = await createDeleter({ run: dirty.run, killer: fakeKiller(), realpath, servers, leftovers }).remove(me, [me]);
  assert.equal(refused.refused, 'changes');
  assert.equal(refused.plan.servers.stop.length, 1, 'the 409 still shows what would be stopped');
  assert.ok(!log.some((l) => /stop|clean/.test(l)), log.join(' | '));

  log.length = 0;
  const s = session('dddddddd-4', `${MAIN}/web`, 404);
  const res = await createDeleter({ run: fakeGit().run, killer: fakeKiller(), realpath, servers, leftovers }).remove(s, [s]);
  assert.deepEqual(log, []);
  assert.deepEqual(res.servers, { stopped: [], kept: [], error: null });
  assert.deepEqual(res.leftovers, []);
  const plan = await createDeleter({ run: fakeGit().run, killer: fakeKiller(), realpath, servers, leftovers }).inspect(s, [s]);
  assert.deepEqual([plan.servers, plan.leftovers], [{ stop: [], kept: [], error: null }, []]);
});

test('delete: a failing process scan or cleaner is reported, the worktree is still removed', async () => {
  const servers = {
    plan: async () => {
      throw new Error('ps exploded');
    },
    stop: async () => assert.fail('nothing to stop'),
    listening: async () => null,
  };
  const leftovers = {
    plan: async () => {
      throw new Error('boom');
    },
    clean: async () => {
      throw new Error('disk on fire');
    },
  };
  const d = createDeleter({ run: fakeGit().run, killer: fakeKiller(), realpath, exists: async () => false, servers, leftovers });
  const plan = await d.inspect(me, [me]);
  assert.match(plan.servers.error, /ps exploded/);
  assert.deepEqual(plan.leftovers, []);
  const res = await d.remove(me, [me]);
  assert.equal(res.worktree.removed, true);
  assert.match(res.servers.error, /ps exploded/);
  assert.deepEqual(res.leftovers, [{ kind: 'leftovers', name: WT, result: 'failed', note: 'disk on fire' }]);
});
