// Manual session → task links: the store (lib/task-links.mjs) and its routes over real HTTP
// between two API servers (laptop + workstation), child processes faked.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApi } from '../lib/api.mjs';
import { createHttpServer } from '../lib/app.mjs';
import { createFleet } from '../lib/fleet.mjs';
import { createFleetCli } from '../lib/fleet-cli.mjs';
import { normalizeConfig } from '../lib/config.mjs';
import { PRUNE_AFTER_MS, createTaskLinks, validateTaskLinkBody } from '../lib/task-links.mjs';

const A = 'aaaaaaaa-0000-0000-0000-000000000001';
const B = 'bbbbbbbb-0000-0000-0000-000000000002';

function tmpFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-task-links-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'state', 'task-links.json');
}

const host = (...ids) => ({ name: 'laptop', ok: true, sessions: ids.map((id) => ({ session_id: id, name: id.slice(0, 4) })) });

test('validateTaskLinkBody: a task id (string or number) or null; anything else is an error', () => {
  assert.deepEqual(validateTaskLinkBody({ taskId: '123' }), { ok: true, taskId: '123' });
  assert.deepEqual(validateTaskLinkBody({ taskId: 456 }), { ok: true, taskId: '456' });
  assert.deepEqual(validateTaskLinkBody({ taskId: null }), { ok: true, taskId: null });
  for (const bad of [null, [], {}, { taskId: '' }, { taskId: '0' }, { taskId: '12a' }, { taskId: '../x' }, { taskId: 1.5 }, { taskId: -3 }, { taskId: true }, { taskId: '1'.repeat(21) }]) {
    assert.equal(validateTaskLinkBody(bad).ok, false, JSON.stringify(bad));
  }
});

test('store: set / clear persist atomically; stamp puts manualTask on the sessions that have one', async (t) => {
  const file = tmpFile(t);
  const links = createTaskLinks({ file, now: () => 1000 });
  assert.equal(links.get(A), null);
  assert.deepEqual(links.stamp(host(A, B)), host(A, B), 'nothing stored → rows untouched');
  await links.set(A, '42');
  await links.set(B, null);
  const stamped = links.stamp(host(A, B));
  assert.deepEqual(stamped.sessions.map((s) => s.manualTask), [{ id: '42' }, { id: null }]);
  assert.equal((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).links[A], { taskId: '42', at: 1000, seenAt: 1000 });
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ['task-links.json'], 'no temp file left');

  // A new instance reads the file back.
  const again = createTaskLinks({ file, now: () => 2000 });
  assert.deepEqual(again.get(B), { taskId: null, at: 1000, seenAt: 1000 });
  assert.equal(await again.clear(B), true);
  assert.equal(await again.clear(B), false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).links[B], undefined);
  await assert.rejects(again.set('../etc', '1'), /not a session id/);
  await assert.rejects(again.set(A, 'x1'), /not a task id/);
});

test('store: a missing or broken file starts empty; bad entries are skipped', async (t) => {
  const file = tmpFile(t);
  const errors = [];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ nope');
  assert.equal(createTaskLinks({ file, logError: (e, c) => errors.push(c) }).get(A), null);
  assert.equal(errors.length, 1);
  fs.writeFileSync(file, JSON.stringify({ links: { [A]: { taskId: '7', at: 5 }, [B]: { taskId: 'x' }, '../x': { taskId: '1' } } }));
  const links = createTaskLinks({ file });
  assert.deepEqual(links.get(A), { taskId: '7', at: 5, seenAt: 5 });
  assert.equal(links.get(B), null);
});

test('store: entries of sessions gone longer than the prune age are dropped; live ones are kept', async (t) => {
  const file = tmpFile(t);
  let clock = 1000;
  const links = createTaskLinks({ file, now: () => clock });
  await links.set(A, '1');
  await links.set(B, '2');
  clock += PRUNE_AFTER_MS;
  links.stamp(host(A)); // B gone exactly the prune age: kept
  assert.ok(links.get(B));
  clock += 1;
  links.stamp(host()); // A was seen 1 ms ago, B is past it
  assert.ok(links.get(A));
  assert.equal(links.get(B), null);
  await links.flush();
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).links), [A]);
  // A failed discovery prunes nothing.
  clock += 10 * PRUNE_AFTER_MS;
  links.stamp({ name: 'laptop', ok: false, error: 'boom' });
  assert.ok(links.get(A));
});

test('store: at most maxEntries, the least recently seen dropped first', async (t) => {
  let clock = 0;
  const links = createTaskLinks({ file: tmpFile(t), now: () => ++clock, maxEntries: 2 });
  await links.set(A, '1');
  await links.set(B, '2');
  await links.set('cccccccc-0000', '3');
  assert.equal(links.get(A), null);
  assert.ok(links.get(B));
});

// --- the routes ---------------------------------------------------------------------------

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function startPair(t) {
  const sessions = {
    laptop: [{ session_id: A, name: 'one', status: 'idle', backend: 'tmux', handle: '%1', updated_at: 1 }],
    workstation: [{ session_id: B, name: 'two', status: 'idle', backend: 'tmux', handle: '%2', updated_at: 2 }],
  };
  const servers = {};
  const urls = {};
  const handles = {};
  const stores = {};
  for (const name of ['laptop', 'workstation']) {
    servers[name] = createHttpServer({ handleApi: (req, url) => handles[name](req, url) });
    urls[name] = await listen(servers[name]);
    t.after(() => servers[name].close());
  }
  for (const name of ['laptop', 'workstation']) {
    const config = normalizeConfig({ self: name, hosts: { laptop: { web: urls.laptop }, workstation: { web: urls.workstation } } }, { env: {}, home: '/home/tester' });
    const cli = createFleetCli({ run: async () => ({ stdout: JSON.stringify(sessions[name]), stderr: '' }) });
    stores[name] = createTaskLinks({ file: tmpFile(t) });
    const api = createApi({ config, fleet: createFleet({ cli, self: name }), backend: {}, transcripts: {}, spawner: {}, taskLinks: stores[name] });
    t.after(() => api.stop());
    handles[name] = api;
  }
  return { urls, stores };
}

async function call(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
const rowOf = (fleet, hostName) => fleet.hosts.find((h) => h.name === hostName).sessions[0];

test('PUT/DELETE …/sessions/:id/task: stored on the session\'s host (proxied once), shown in /api/fleet', async (t) => {
  const { urls, stores } = await startPair(t);
  const put = await call('PUT', `${urls.laptop}/api/hosts/workstation/sessions/bbbbbbbb/task`, { taskId: '123' });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { host: 'workstation', id: B, manualTask: { id: '123' } });
  assert.deepEqual(stores.workstation.get(B).taskId, '123');
  assert.equal(stores.laptop.get(B), null, 'the proxying server stores nothing');

  let fleet = (await call('GET', `${urls.laptop}/api/fleet`)).body;
  assert.deepEqual(rowOf(fleet, 'workstation').manualTask, { id: '123' });
  assert.equal('manualTask' in rowOf(fleet, 'laptop'), false, 'absent without an entry');

  // Explicitly linked to none.
  assert.equal((await call('PUT', `${urls.laptop}/api/hosts/laptop/sessions/aaaaaaaa/task`, { taskId: null })).status, 200);
  fleet = (await call('GET', `${urls.laptop}/api/fleet`)).body;
  assert.deepEqual(rowOf(fleet, 'laptop').manualTask, { id: null });

  const del = await call('DELETE', `${urls.laptop}/api/hosts/workstation/sessions/bbbbbbbb/task`);
  assert.deepEqual(del.body, { host: 'workstation', id: B, manualTask: null });
  assert.equal(stores.workstation.get(B), null);
  fleet = (await call('GET', `${urls.laptop}/api/fleet`)).body;
  assert.equal('manualTask' in rowOf(fleet, 'workstation'), false);
});

test('task link route: bad body 400, unknown session 404, wrong method 405, never chained, a gone session\'s entry can be deleted', async (t) => {
  const { urls, stores } = await startPair(t);
  assert.equal((await call('PUT', `${urls.laptop}/api/hosts/laptop/sessions/aaaaaaaa/task`, { taskId: 'abc' })).status, 400);
  assert.equal((await call('PUT', `${urls.laptop}/api/hosts/laptop/sessions/aaaaaaaa/task`, {})).status, 400);
  assert.equal((await call('PUT', `${urls.laptop}/api/hosts/laptop/sessions/zzzzzzzzzz/task`, { taskId: '1' })).status, 404);
  assert.equal((await call('PUT', `${urls.laptop}/api/hosts/nowhere/sessions/aaaaaaaa/task`, { taskId: '1' })).status, 404);
  assert.equal((await call('GET', `${urls.laptop}/api/hosts/laptop/sessions/aaaaaaaa/task`)).status, 405);
  assert.equal((await call('PUT', `${urls.laptop}/api/hosts/workstation/sessions/bbbbbbbb/task?local=1`, { taskId: '1' })).status, 404);
  assert.equal(stores.laptop.get(A), null);

  const gone = 'cccccccc-0000-0000-0000-000000000003';
  await stores.laptop.set(gone, '9');
  const del = await call('DELETE', `${urls.laptop}/api/hosts/laptop/sessions/${gone}/task`);
  assert.equal(del.status, 200);
  assert.equal(stores.laptop.get(gone), null);
  assert.equal((await call('DELETE', `${urls.laptop}/api/hosts/laptop/sessions/${gone}/task`)).status, 404, 'nothing left to forget');
});

test('task link route: 501 on a server without the store', async () => {
  const config = normalizeConfig({ self: 'solo' }, { env: {}, home: '/home/tester' });
  const cli = createFleetCli({ run: async () => ({ stdout: JSON.stringify([{ session_id: A, name: 'one', status: 'idle' }]), stderr: '' }) });
  const api = createApi({ config, fleet: createFleet({ cli, self: 'solo' }), backend: {}, transcripts: {}, spawner: {}, warmFleet: false });
  await assert.rejects(api({ method: 'DELETE', headers: {} }, new URL(`http://x/api/hosts/solo/sessions/${A}/task`)), (err) => err.status === 501);
});
