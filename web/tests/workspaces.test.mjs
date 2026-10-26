// Workspaces on the web side: the namer that names a worktree session after its work, the
// spawn API's `worktree` flag, the CLI wrappers, and Delete removing a fleet-made branch.
// Child processes are faked (git included); no tmux, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { PassThrough } from 'node:stream';

import { createApi } from '../lib/api.mjs';
import { normalizeConfig } from '../lib/config.mjs';
import { createDeleter } from '../lib/delete.mjs';
import { createFleetCli } from '../lib/fleet-cli.mjs';
import { createWorkspaceNamer, workspaceNameDue } from '../lib/workspaces.mjs';

const ws = (over = {}) => ({ handle: 'kelpie', branch: 'someone/kelpie', path: '/w/app/kelpie', repo: '/code/app', base: 'origin/main', named: false, ...over });
const row = (over = {}) => ({ session_id: 'aaaaaaaa-1', status: 'idle', title: 'fix the login form', workspace: ws(), ...over });

test('workspaceNameDue: an idle workspace session with a first prompt, not named yet', () => {
  assert.equal(workspaceNameDue(row()), true);
  assert.equal(workspaceNameDue(row({ status: 'busy' })), false);
  assert.equal(workspaceNameDue(row({ status: 'shell' })), false, 'a background task still running');
  assert.equal(workspaceNameDue(row({ status: 'waiting' })), false);
  assert.equal(workspaceNameDue(row({ title: null })), false);
  assert.equal(workspaceNameDue(row({ title: '  ' })), false);
  assert.equal(workspaceNameDue(row({ workspace: ws({ named: true }) })), false);
  assert.equal(workspaceNameDue(row({ workspace: null })), false);
  assert.equal(workspaceNameDue(row({ session_id: null })), false);
  assert.equal(workspaceNameDue(null), false);
});

test('workspace namer: names due sessions one at a time, retries held ones up to maxTries', async () => {
  const calls = [];
  let rows = [row(), row({ session_id: 'bbbbbbbb-2', status: 'busy' }), row({ session_id: 'cccccccc-3', workspace: ws({ handle: 'otter' }) })];
  const cli = {
    workspaceName: async ({ target }) => {
      calls.push(target);
      if (target === 'cccccccc-3') return { ok: false, result: 'held', message: 'waiting on you' };
      return { ok: true, result: 'named', message: 'kelpie → Fix login form', branch: { renamed: true, note: 'someone/kelpie → someone/fix-login-form' } };
    },
  };
  const logs = [];
  const namer = createWorkspaceNamer({ cli, listSessions: async () => rows, maxTries: 2, log: (l) => logs.push(l) });
  const first = await namer.tick();
  assert.deepEqual(calls, ['aaaaaaaa-1', 'cccccccc-3']);
  assert.deepEqual(first.map((r) => r.result), ['named', 'held']);
  assert.match(logs[0], /kelpie: named — kelpie → Fix login form · branch: someone\/kelpie → someone\/fix-login-form/);
  // The named one now says so; the held one is tried once more, then left alone.
  rows = [row({ workspace: ws({ named: true }) }), rows[1], rows[2]];
  await namer.tick();
  await namer.tick();
  assert.deepEqual(calls, ['aaaaaaaa-1', 'cccccccc-3', 'cccccccc-3']);
  // A failing listing is a quiet pass.
  const broken = createWorkspaceNamer({ cli, listSessions: async () => Promise.reject(new Error('no fleet')) });
  assert.deepEqual(await broken.tick(), []);
  assert.throws(() => createWorkspaceNamer({ cli: {}, listSessions: async () => [] }), /workspaceName/);
});

test('fleet-cli: workspaceNew passes dir/handle; workspaceName resolves a held report (exit 3)', async () => {
  const seen = [];
  const cli = createFleetCli({
    bin: 'fleet',
    run: async (bin, args) => {
      seen.push(args);
      if (args[2] === 'new') return { stdout: JSON.stringify({ handle: 'kelpie', path: '/w/app/kelpie' }), stderr: '' };
      throw Object.assign(new Error('exit 3'), { code: 3, stdout: JSON.stringify({ ok: false, result: 'held', message: 'waiting' }), stderr: '' });
    },
  });
  assert.deepEqual(await cli.workspaceNew({ dir: '/code/app', handle: 'kelpie' }), { handle: 'kelpie', path: '/w/app/kelpie' });
  assert.deepEqual(seen[0], ['--local', 'workspace', 'new', '--dir', '/code/app', '--json', '--handle', 'kelpie']);
  assert.equal((await cli.workspaceName({ target: 'aaaaaaaa-1' })).result, 'held');
  assert.deepEqual(seen[1], ['--local', 'workspace', 'name', 'aaaaaaaa-1', '--json']);

  const old = createFleetCli({ run: async () => Promise.reject(Object.assign(new Error('exit 2'), { stderr: "error: unrecognized subcommand 'workspace'\n" })) });
  await assert.rejects(old.workspaceNew({ dir: '/x' }), (e) => e.missing === true);
});

async function spawnVia(api, body) {
  const req = Object.assign(new PassThrough(), { method: 'POST', headers: {} });
  req.end(JSON.stringify(body));
  return api(req, new URL('http://x/api/hosts/solo/spawn'));
}

test('spawn API: worktree: true makes the workspace first and starts the session there, named after the handle', async () => {
  const calls = [];
  const cli = createFleetCli({ run: async () => ({ stdout: '[]', stderr: '' }) });
  cli.workspaceNew = async (o) => (calls.push(['workspaceNew', o]), { handle: 'ballyhoo', path: '/w/app/ballyhoo', branch: 'someone/ballyhoo', base: 'origin/main' });
  const spawner = { spawn: async (req) => (calls.push(['spawn', req]), { name: req.name, dir: req.dir, tmuxSession: req.name, command: 'claude', trusted: false }) };
  const config = normalizeConfig({ self: 'solo', spawnDirs: [{ path: os.tmpdir() }] }, { env: {}, home: '/home/tester' });
  const api = createApi({ config, cli, spawner, fleet: { localHost: async () => ({ ok: true, sessions: [] }) }, warmFleet: false });

  const res = await spawnVia(api, { dir: os.tmpdir(), prompt: 'reply OK', worktree: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.workspace.handle, 'ballyhoo');
  assert.equal(res.body.tmuxSession, 'ballyhoo');
  const [, made] = calls.find((c) => c[0] === 'workspaceNew');
  assert.equal(made.dir, fs.realpathSync(os.tmpdir()));
  assert.equal(made.handle, null);
  const [, spawned] = calls.find((c) => c[0] === 'spawn');
  assert.equal(spawned.dir, '/w/app/ballyhoo');
  assert.equal(spawned.name, 'ballyhoo');
  assert.equal(spawned.nameGiven, true);
  assert.equal(spawned.prompt, 'reply OK');

  // A typed name is the handle.
  await spawnVia(api, { dir: os.tmpdir(), worktree: true, name: 'my-task' });
  assert.equal(calls.filter((c) => c[0] === 'workspaceNew').at(-1)[1].handle, 'my-task');

  // Without the flag: the plain spawn, no workspace.
  const before = calls.filter((c) => c[0] === 'workspaceNew').length;
  await spawnVia(api, { dir: os.tmpdir() });
  assert.equal(calls.filter((c) => c[0] === 'workspaceNew').length, before);
  assert.equal(calls.at(-1)[1].dir, fs.realpathSync(os.tmpdir()));

  // Not a boolean: 400, nothing made.
  await assert.rejects(spawnVia(api, { dir: os.tmpdir(), worktree: 'yes' }), (e) => e.status === 400 && /worktree must be a boolean/.test(e.message));

  // The CLI refuses (not a git repo): 400 with its message, nothing spawned.
  cli.workspaceNew = async () => Promise.reject(new Error('/tmp is not inside a git repo'));
  const n = calls.length;
  await assert.rejects(spawnVia(api, { dir: os.tmpdir(), worktree: true }), (e) => e.status === 400 && /not inside a git repo/.test(e.message));
  assert.equal(calls.length, n);
});

const MAIN = '/w/app';
const WT = '/w/ws/app/kelpie';
const LIST = `worktree ${MAIN}\nHEAD abc\nbranch refs/heads/main\n\nworktree ${WT}\nHEAD def\nbranch refs/heads/someone/kelpie\n`;

/** A git that knows MAIN and WT (a linked worktree on `someone/kelpie`); `ahead`: commits on no remote. */
function fakeGit({ ahead = 0, dirty = false } = {}) {
  const calls = [];
  let removed = false;
  const run = async (bin, args) => {
    const [, dir, ...rest] = args;
    const cmd = rest.join(' ');
    calls.push(cmd);
    if (cmd.startsWith('rev-parse')) {
      if (dir.startsWith(WT)) return { stdout: `someone/kelpie\n${WT}\n${MAIN}/.git/worktrees/kelpie\n${MAIN}/.git\n`, stderr: '' };
      throw new Error('fatal: not a git repository');
    }
    if (cmd === 'worktree list --porcelain') return { stdout: removed ? `worktree ${MAIN}\nHEAD abc\nbranch refs/heads/main\n` : LIST, stderr: '' };
    if (cmd === 'status --porcelain -z') return { stdout: dirty ? ' M a.txt\0' : '', stderr: '' };
    if (cmd.startsWith('rev-list --count')) return { stdout: `${ahead}\n`, stderr: '' };
    if (cmd.startsWith('log')) return { stdout: ahead ? 'c0\twork' : '', stderr: '' };
    if (cmd.startsWith('worktree remove')) {
      removed = true;
      return { stdout: '', stderr: '' };
    }
    if (cmd === 'branch -D someone/kelpie') return { stdout: '', stderr: '' };
    throw new Error(`unexpected git ${cmd}`);
  };
  return { calls, run };
}

const killer = { kill: async () => ({ process: 'terminated', terminal: 'tmux-session-killed' }) };
const wsRow = (over = {}) => ({ session_id: 'aaaaaaaa-1', pid: 101, cwd: WT, name: 'kelpie', status: 'idle', workspace: ws({ path: WT, repo: MAIN, named: true }), ...over });
const realpath = async (p) => p;

test('delete: a fleet-made workspace goes with its branch when nothing on it is unpushed', async () => {
  const { calls, run } = fakeGit();
  const d = createDeleter({ run, killer, realpath, exists: async () => false });
  const s = wsRow();
  const plan = await d.inspect(s, [s]);
  assert.deepEqual(plan.workspace, { handle: 'kelpie', branch: 'someone/kelpie', deleteBranch: true });
  const res = await d.remove(s, [s]);
  assert.equal(res.worktree.removed, true);
  assert.equal(res.worktree.branchDeleted, true);
  // Re-checked on the branch itself after the worktree is gone, then deleted.
  const i = calls.indexOf('rev-list --count refs/heads/someone/kelpie --not --remotes');
  assert.ok(i > calls.findIndex((c) => c.startsWith('worktree remove')));
  assert.equal(calls.at(-1), 'branch -D someone/kelpie');
});

test('delete: unpushed commits keep the workspace branch (forced remove); a row without workspace keeps its branch', async () => {
  const { calls, run } = fakeGit({ ahead: 1 });
  const d = createDeleter({ run, killer, realpath, exists: async () => false });
  const s = wsRow();
  assert.equal((await d.inspect(s, [s])).workspace.deleteBranch, false);
  assert.equal((await d.remove(s, [s])).refused, 'changes');
  const res = await d.remove(s, [s], { force: true });
  assert.equal(res.worktree.removed, true);
  assert.equal(res.worktree.branchDeleted, false);
  assert.match(res.worktree.branchNote, /unpushed/);
  assert.equal(calls.includes('branch -D someone/kelpie'), false);

  // Dirty but nothing unpushed (forced): the branch holds nothing a remote lacks — it goes.
  const dirty = fakeGit({ dirty: true });
  const r1 = await createDeleter({ run: dirty.run, killer, realpath, exists: async () => false }).remove(s, [s], { force: true });
  assert.equal(r1.worktree.branchDeleted, true);

  // The row says nothing about a workspace (or another one): the branch stays, no extra fields.
  for (const row of [wsRow({ workspace: null }), wsRow({ workspace: ws({ path: '/w/ws/app/other' }) })]) {
    const g = fakeGit();
    const r = await createDeleter({ run: g.run, killer, realpath, exists: async () => false }).remove(row, [row]);
    assert.equal(r.worktree.removed, true);
    assert.equal('branchDeleted' in r.worktree, false);
    assert.equal(g.calls.includes('branch -D someone/kelpie'), false);
  }
});
