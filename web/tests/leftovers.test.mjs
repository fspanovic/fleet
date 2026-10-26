import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createLeftovers } from '../lib/leftovers.mjs';

/** A throwaway $HOME with ~/.puma-dev and the fe-live-env state dir (both optional). */
async function fakeHome(t, { puma = true, fe = true } = {}) {
  const home = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fleet-leftovers-')));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const feDir = path.join(home, 'productive', 'work', 'output', 'fe-live-env');
  const pumaDir = path.join(home, '.puma-dev');
  if (fe) await fs.mkdir(path.join(feDir, 'ports'), { recursive: true });
  if (puma) await fs.mkdir(pumaDir, { recursive: true });
  const worktree = path.join(home, 'worktrees', 'frontend-feat');
  await fs.mkdir(worktree, { recursive: true });
  return { home, feDir, pumaDir, worktree };
}

const write = (file, content) => fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content));
const exists = (file) =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );

/** Liveness only (signal 0): `alive` pids answer, everything else is gone. */
const liveness = (alive = []) => (pid, sig) => {
  assert.equal(sig, 0, 'leftovers never send a real signal');
  if (!alive.includes(pid)) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
  return true;
};

function fakeWatchman(roots) {
  const calls = [];
  const run = async (bin, args) => {
    calls.push([bin, ...args].join(' '));
    if (roots instanceof Error) throw roots;
    if (args.includes('watch-list')) return { stdout: JSON.stringify({ version: '2024', roots }), stderr: '' };
    if (args.includes('watch-del')) return { stdout: JSON.stringify({ version: '2024', 'watch-del': true, root: args.at(-1) }), stderr: '' };
    throw new Error(`unexpected ${args.join(' ')}`);
  };
  return { run, calls };
}

test('nothing there (no state dir, no ~/.puma-dev, no watchman): plan and clean are empty, nothing is created', async (t) => {
  const { home, worktree } = await fakeHome(t, { puma: false, fe: false });
  const { run } = fakeWatchman(Object.assign(new Error('spawn watchman ENOENT'), { code: 'ENOENT' }));
  const lo = createLeftovers({ run, home, killProcess: liveness() });
  assert.deepEqual(await lo.plan({ worktree, ports: new Set([4250]) }), []);
  assert.deepEqual(await lo.clean({ worktree, ports: new Set([4250]), listening: new Set() }), []);
  assert.equal(await exists(path.join(home, '.puma-dev')), false);
});

test('fe-live-env: the env for this worktree goes once nobody holds it; others and live ones stay', async (t) => {
  const { home, feDir, pumaDir, worktree } = await fakeHome(t);
  const host = path.join(pumaDir, 'app-feat-4250.productive.io');
  await write(path.join(feDir, 'feat.json'), { worktree, port: 4250, pid: 500, pumaDevHostFile: host, holders: [{ id: 'abc', pid: 111, fleetSession: { name: 'zephyr' } }] });
  await write(path.join(feDir, 'feat.pid'), '500\n');
  await write(path.join(feDir, 'feat.log'), 'vite output');
  await write(path.join(feDir, 'ports', '4250.lock'), { suffix: 'feat', pid: 500 });
  await write(path.join(feDir, 'ports', '4251.lock'), { suffix: 'other', pid: 501 });
  await write(path.join(feDir, 'other.json'), { worktree: path.join(home, 'worktrees', 'frontend-other'), port: 4251, pid: 501, holders: [] });
  await write(host, '4250\n');
  const { run } = fakeWatchman([]);

  // Preview: held by the closing session (111) and served by a server being stopped (500).
  const lo = createLeftovers({ run, home, killProcess: liveness([111, 500]) });
  assert.deepEqual(await lo.plan({ worktree, going: new Set([111, 500]), ports: new Set() }), [
    { kind: 'fe-live-env', name: 'feat', port: 4250, keep: null },
    { kind: 'puma-dev', name: 'app-feat-4250.productive.io', port: 4250, keep: null },
  ]);
  // Held by a session that stays: kept, and its host file with it.
  assert.deepEqual(
    (await lo.plan({ worktree, going: new Set([500]) })).map((i) => [i.name, i.keep]),
    [
      ['feat', 'held by zephyr (pid 111)'],
      ['app-feat-4250.productive.io', 'its fe-live-env stays'],
    ],
  );

  // After the delete: everyone is gone.
  const res = await createLeftovers({ run, home, killProcess: liveness() }).clean({ worktree, ports: new Set([4250]), listening: new Set() });
  assert.deepEqual(res, [
    { kind: 'fe-live-env', name: 'feat', result: 'removed', note: 'feat.json, feat.pid, ports/4250.lock' },
    { kind: 'puma-dev', name: 'app-feat-4250.productive.io', result: 'removed', note: 'port 4250' },
  ]);
  assert.equal(await exists(path.join(feDir, 'feat.log')), true, 'logs stay');
  assert.equal(await exists(path.join(feDir, 'other.json')), true);
  assert.equal(await exists(path.join(feDir, 'ports', '4251.lock')), true);
});

test('fe-live-env: a live holder at clean time keeps the env and its host file', async (t) => {
  const { home, feDir, pumaDir, worktree } = await fakeHome(t);
  const host = path.join(pumaDir, 'app-feat-4250.productive.io');
  await write(path.join(feDir, 'feat.json'), { worktree, port: 4250, pid: 500, pumaDevHostFile: host, holders: [{ id: 'abc', pid: 222 }] });
  await write(host, '4250');
  const res = await createLeftovers({ run: fakeWatchman([]).run, home, killProcess: liveness([222]) }).clean({ worktree, ports: new Set([4250]), listening: new Set() });
  assert.deepEqual(res, [
    { kind: 'fe-live-env', name: 'feat', result: 'kept', note: 'held by abc (pid 222)' },
    { kind: 'puma-dev', name: 'app-feat-4250.productive.io', result: 'kept', note: 'its fe-live-env stays' },
  ]);
  assert.equal(await exists(path.join(feDir, 'feat.json')), true);
  assert.equal(await exists(host), true);
});

test('puma-dev: only app-* files on a stopped server port (once free) or links into the worktree', async (t) => {
  const { home, pumaDir, worktree } = await fakeHome(t, { fe: false });
  await write(path.join(pumaDir, 'app-feat-4250.productive.io'), '4250\n'); // a stopped server's port
  await write(path.join(pumaDir, 'app-busy-4252.productive.io'), '4252\n'); // stopped, but something listens again
  await write(path.join(pumaDir, 'app-other-4299.productive.io'), '4299\n'); // not ours
  await write(path.join(pumaDir, 'app.productive.io'), '4200\n'); // the main one: never
  await write(path.join(pumaDir, 'api.productive.io'), '4250\n'); // not app-*
  await fs.symlink(worktree, path.join(pumaDir, 'app-link.productive.io'));
  await fs.symlink(path.join(home, 'elsewhere'), path.join(pumaDir, 'app-away.productive.io'));
  const lo = createLeftovers({ run: fakeWatchman([]).run, home, killProcess: liveness() });
  const ports = new Set([4250, 4252, 4200]);
  assert.deepEqual(
    (await lo.plan({ worktree, ports })).map((i) => i.name),
    ['app-busy-4252.productive.io', 'app-feat-4250.productive.io', 'app-link.productive.io'],
  );
  const res = await lo.clean({ worktree, ports, listening: new Set([4252]) });
  assert.deepEqual(
    res.map((r) => [r.name, r.result]),
    [
      ['app-busy-4252.productive.io', 'kept'],
      ['app-feat-4250.productive.io', 'removed'],
      ['app-link.productive.io', 'removed'],
    ],
  );
  for (const name of ['app-busy-4252.productive.io', 'app-other-4299.productive.io', 'app.productive.io', 'api.productive.io', 'app-away.productive.io']) {
    assert.equal(await exists(path.join(pumaDir, name)), true, name);
  }
  // Ports unknown (lsof failed): port files stay.
  await write(path.join(pumaDir, 'app-feat-4250.productive.io'), '4250\n');
  const unknown = await lo.clean({ worktree, ports, listening: null });
  assert.deepEqual(unknown.find((r) => r.name === 'app-feat-4250.productive.io'), { kind: 'puma-dev', name: 'app-feat-4250.productive.io', result: 'kept', note: 'could not check port 4250' });
});

test('watchman: only roots inside the worktree, and never starts a watchman server', async (t) => {
  const { home, worktree } = await fakeHome(t, { puma: false, fe: false });
  const { run, calls } = fakeWatchman([worktree, `${worktree}/apps/productive`, `${worktree}-2`, '/w/other']);
  const lo = createLeftovers({ run, home, killProcess: liveness() });
  assert.deepEqual(
    (await lo.plan({ worktree })).map((i) => [i.kind, i.name]),
    [
      ['watchman', worktree],
      ['watchman', `${worktree}/apps/productive`],
    ],
  );
  const res = await lo.clean({ worktree });
  assert.deepEqual(res.map((r) => [r.name, r.result]), [
    [worktree, 'removed'],
    [`${worktree}/apps/productive`, 'removed'],
  ]);
  assert.ok(calls.every((c) => c.startsWith('watchman --no-spawn ')));
  assert.deepEqual(
    calls.filter((c) => c.includes('watch-del')),
    [`watchman --no-spawn watch-del ${worktree}`, `watchman --no-spawn watch-del ${worktree}/apps/productive`],
  );
});

test('FE_LIVE_ENV_WORK_ROOT moves the state dir', async (t) => {
  const { home, worktree } = await fakeHome(t, { puma: false, fe: false });
  const root = path.join(home, 'elsewhere-work');
  await fs.mkdir(path.join(root, 'output', 'fe-live-env'), { recursive: true });
  await write(path.join(root, 'output', 'fe-live-env', 'feat.json'), { worktree, port: 4250, holders: [] });
  const lo = createLeftovers({ run: fakeWatchman([]).run, home, env: { FE_LIVE_ENV_WORK_ROOT: root }, killProcess: liveness() });
  assert.deepEqual(await lo.plan({ worktree }), [{ kind: 'fe-live-env', name: 'feat', port: 4250, keep: null }]);
});
