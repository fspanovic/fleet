// Dormant sessions on the web side: lib/fleet-cli.mjs `restore`, lib/dormant.mjs (argv, error
// mapping, restore.onBoot) and the /api/hosts/:host/dormant… routes. The `fleet` CLI is faked;
// the peer pair runs on 127.0.0.1 ephemeral ports. Nothing here starts tmux or claude.
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
import { HttpError } from '../lib/http.mjs';
import { ambiguityCandidates, createDormant, dormantHttpError, validateDormantRequest } from '../lib/dormant.mjs';
import { createTranscriptReader, encodeCwd, locateRecordTranscript, piDirName } from '../lib/transcript.mjs';

const SID = 'aaaaaaaa-0000-0000-0000-000000000001';
const SID_CLOSED = 'cccccccc-0000-0000-0000-000000000002';

/** `fleet restore --json` (docs/cli.md → Session recovery). */
function dormantList(host, bootId = '1727000000') {
  return {
    host,
    bootId,
    dormant: [
      { kind: 'tmux', target: 'fleet-test-a', name: 'fleet-test-a', since: '2026-10-01T10:00:00Z', windows: 1, panes: 2, sessions: [{ sessionId: SID, name: 'fix', title: 'Fix login', cwd: '~/Code/project' }] },
      { kind: 'tmux', target: 'fleet-test-b', name: 'fleet-test-b', since: '2026-10-01T10:00:00Z', windows: 1, panes: 1, sessions: [] },
    ],
    closed: [
      { kind: 'claude', target: SID_CLOSED, name: 'Old work', since: '2026-10-02T10:00:00Z', closedAt: '2026-10-02T10:00:00Z', tmuxSession: 'fleet-test-c', windows: 1, panes: 1, sessions: [{ sessionId: SID_CLOSED, name: null, title: 'Old work', cwd: '~/Code/project' }] },
    ],
  };
}

const cliError = (code, stderr, stdout = '') => Object.assign(new Error(stderr || `exit ${code}`), { code, stderr, stdout });

/** A fake `fleet` binary: `list --json` and `--local restore --json …`, every call recorded. */
function fakeRun(self, { bootId } = {}) {
  const calls = [];
  const run = async (bin, args) => {
    calls.push(args);
    const out = (v) => ({ stdout: JSON.stringify(v), stderr: '' });
    if (args[0] === 'list') return out([]);
    assert.deepEqual(args.slice(0, 3), ['--local', 'restore', '--json'], `unexpected fleet call ${args.join(' ')}`);
    const rest = args.slice(3);
    const dry = rest.includes('--dry-run');
    const restored = (name) => ({ kind: 'tmux', from: name, session: name, renamed: false, windows: 1, panes: 1, launched: [], warnings: [], commands: [], dryRun: dry });
    if (!rest.length) return out(dormantList(self, bootId));
    if (rest.includes('--all')) {
      // One fails: exit 1, the report still on stdout.
      throw cliError(1, 'Error: 1 restore failed', JSON.stringify({ host: self, restored: [restored('fleet-test-a')], failed: [{ target: 'fleet-test-b', error: 'tmux: boom' }] }));
    }
    if (rest.includes('--forget-all')) return out({ host: self, forgotten: ['fleet-test-a', 'fleet-test-b'] });
    const forget = rest.find((a) => a.startsWith('--forget='));
    const target = forget ? forget.slice('--forget='.length) : rest[rest.indexOf('--') + 1];
    if (target === 'fleet-test') throw cliError(2, 'Error: "fleet-test" matches 2 dormant sessions: fleet-test-a, fleet-test-b — be more specific');
    if (target === 'broken') throw cliError(1, 'Error: restore failed', JSON.stringify({ host: self, restored: [], failed: [{ target, error: 'cwd gone' }] }));
    if (!target.startsWith('fleet-test-')) throw cliError(3, `Error: no dormant session matches "${target}"`);
    return out(forget ? { host: self, forgotten: [target] } : { host: self, restored: [restored(target)], failed: [] });
  };
  return { calls, run };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function startPair(t, { withDormant = true } = {}) {
  const hosts = {};
  const urls = {};
  const handles = {};
  for (const name of ['laptop', 'workstation']) {
    const fake = fakeRun(name);
    const cli = createFleetCli({ run: fake.run });
    const logs = [];
    hosts[name] = { ...fake, cli, logs, dormant: withDormant ? createDormant({ cli, log: (l) => logs.push(l) }) : null };
    const server = createHttpServer({ handleApi: (req, url) => handles[name](req, url) });
    urls[name] = await listen(server);
    t.after(() => server.close());
  }
  for (const name of ['laptop', 'workstation']) {
    const config = normalizeConfig(
      { self: name, hosts: { laptop: { web: urls.laptop }, workstation: { web: urls.workstation } } },
      { env: {}, home: '/home/tester' },
    );
    const h = hosts[name];
    const api = createApi({
      config,
      fleet: createFleet({ cli: h.cli, self: name }),
      backend: {},
      transcripts: {},
      spawner: {},
      cli: h.cli,
      dormant: h.dormant,
      warmFleet: false,
    });
    t.after(() => api.stop());
    handles[name] = api;
  }
  return { hosts, urls };
}

async function call(url, method = 'GET', body) {
  const res = await fetch(url, body === undefined ? { method } : { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

test('validateDormantRequest: a one-line target or all: true; dryRun only for restore', () => {
  assert.deepEqual(validateDormantRequest({ target: ' fleet-test-a ' }), { all: false, target: 'fleet-test-a', dryRun: false, closed: false });
  assert.deepEqual(validateDormantRequest({ all: true, dryRun: true }, { allowDryRun: true }), { all: true, target: null, dryRun: true, closed: false });
  assert.equal(validateDormantRequest({ target: 'x', dryRun: true }).dryRun, false);
  for (const bad of [{}, null, { target: '' }, { target: 'a\nb' }, { target: 5 }, { target: 'x'.repeat(201) }, { all: true, target: 'x' }, { all: 'yes' }]) {
    assert.throws(() => validateDormantRequest(bad), (e) => e instanceof HttpError && e.status === 400, JSON.stringify(bad));
  }
});

test('dormantHttpError: ambiguous → 409 with candidates, no match → 404, timeout → 504, old CLI → 501', () => {
  assert.deepEqual(ambiguityCandidates('"q" matches 2 dormant sessions: a-1, b-2 — be more specific'), ['a-1', 'b-2']);
  assert.deepEqual(ambiguityCandidates('something else'), []);
  const amb = dormantHttpError(Object.assign(new Error('"q" matches 2 dormant sessions: a, b — be more specific'), { exitCode: 2 }));
  assert.equal(amb.status, 409);
  assert.deepEqual(amb.body.candidates, ['a', 'b']);
  assert.equal(dormantHttpError(Object.assign(new Error('no dormant session matches "x"'), { exitCode: 3 })).status, 404);
  assert.equal(dormantHttpError(Object.assign(new Error('slow'), { timedOut: true })).status, 504);
  assert.equal(dormantHttpError(Object.assign(new Error('x'), { missing: true })).status, 501);
  assert.equal(dormantHttpError(new Error('boom')).status, 502);
});

test('fleet CLI restore: `--local restore --json …`, the target after `--`, forget as --forget=', async () => {
  const { calls, run } = fakeRun('laptop');
  const d = createDormant({ cli: createFleetCli({ run }) });
  await d.list();
  await d.restore({ target: 'fleet-test-a' });
  await d.restore({ target: 'fleet-test-a', dryRun: true });
  await d.forget({ target: 'fleet-test-a' });
  await d.forget({ all: true });
  assert.deepEqual(calls, [
    ['--local', 'restore', '--json'],
    ['--local', 'restore', '--json', '--', 'fleet-test-a'],
    ['--local', 'restore', '--json', '--dry-run', '--', 'fleet-test-a'],
    ['--local', 'restore', '--json', '--forget=fleet-test-a'],
    ['--local', 'restore', '--json', '--forget-all'],
  ]);
});

test('fleet CLI restore: an old binary without `restore` → 501', async () => {
  const cli = createFleetCli({ run: async () => { throw cliError(2, "error: unrecognized subcommand 'restore'"); } });
  await assert.rejects(createDormant({ cli }).list(), (e) => e.status === 501);
});

test('GET dormant: the CLI JSON, served locally or proxied once to the peer', async (t) => {
  const { hosts, urls } = await startPair(t);
  const local = await call(`${urls.laptop}/api/hosts/laptop/dormant`);
  assert.equal(local.status, 200);
  assert.deepEqual(local.body, dormantList('laptop'));
  const remote = await call(`${urls.laptop}/api/hosts/workstation/dormant`);
  assert.equal(remote.status, 200);
  assert.equal(remote.body.host, 'workstation');
  assert.deepEqual(hosts.workstation.calls.at(-1), ['--local', 'restore', '--json']);
  assert.equal((await call(`${urls.laptop}/api/hosts/nowhere/dormant`)).status, 404);
  assert.equal((await call(`${urls.laptop}/api/hosts/laptop/dormant`, 'POST', {})).status, 405);
  assert.equal((await call(`${urls.laptop}/api/hosts/laptop/dormant/restore`)).status, 405);
});

test('POST dormant/restore: one target, dry run, ambiguity 409 with candidates, unknown 404, bad body 400', async (t) => {
  const { hosts, urls } = await startPair(t);
  const base = `${urls.laptop}/api/hosts/workstation/dormant/restore`;
  const ok = await call(base, 'POST', { target: 'fleet-test-a' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.restored[0].session, 'fleet-test-a');
  assert.match(hosts.workstation.logs.at(-1), /restored fleet-test-a/);
  const dry = await call(base, 'POST', { target: 'fleet-test-a', dryRun: true });
  assert.equal(dry.body.restored[0].dryRun, true);
  assert.ok(hosts.workstation.calls.at(-1).includes('--dry-run'));
  const amb = await call(base, 'POST', { target: 'fleet-test' });
  assert.equal(amb.status, 409);
  assert.deepEqual(amb.body.candidates, ['fleet-test-a', 'fleet-test-b']);
  assert.match(amb.body.error, /be more specific/);
  assert.equal((await call(base, 'POST', { target: 'nope' })).status, 404);
  assert.equal((await call(base, 'POST', { target: '' })).status, 400);
  const failed = await call(base, 'POST', { target: 'broken' });
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, 'cwd gone');
});

test('POST dormant/restore { all: true }: a partial failure is a 200 with the report', async (t) => {
  const { hosts, urls } = await startPair(t);
  const r = await call(`${urls.laptop}/api/hosts/laptop/dormant/restore`, 'POST', { all: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.restored.length, 1);
  assert.deepEqual(r.body.failed, [{ target: 'fleet-test-b', error: 'tmux: boom' }]);
  assert.deepEqual(hosts.laptop.calls.at(-1), ['--local', 'restore', '--json', '--all']);
  assert.match(hosts.laptop.logs.at(-1), /failed fleet-test-b: tmux: boom/);
});

test('POST dormant/forget: a target or all; no dormant module → 501', async (t) => {
  const { urls } = await startPair(t);
  const one = await call(`${urls.laptop}/api/hosts/laptop/dormant/forget`, 'POST', { target: 'fleet-test-b' });
  assert.deepEqual(one.body, { host: 'laptop', forgotten: ['fleet-test-b'] });
  const all = await call(`${urls.laptop}/api/hosts/workstation/dormant/forget`, 'POST', { all: true });
  assert.deepEqual(all.body.forgotten, ['fleet-test-a', 'fleet-test-b']);
  const { urls: bare } = await startPair(t, { withDormant: false });
  const r = await call(`${bare.laptop}/api/hosts/laptop/dormant`);
  assert.equal(r.status, 501);
});

test('restore.onBoot: restores --all once per boot id (marker file), never throws', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-dormant-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const markerFile = path.join(dir, 'state', 'web-restored-boot');
  const { calls, run } = fakeRun('laptop', { bootId: '42' });
  const logs = [];
  const d = createDormant({ cli: createFleetCli({ run }), log: (l) => logs.push(l) });
  const first = await d.restoreOnBoot({ markerFile });
  assert.equal(first.restored.length, 1);
  assert.deepEqual(calls.at(-1), ['--local', 'restore', '--json', '--all']);
  assert.equal(fs.readFileSync(markerFile, 'utf8').trim(), '42');
  const n = calls.length;
  assert.equal(await d.restoreOnBoot({ markerFile }), null, 'a server restart in the same boot does nothing');
  assert.equal(calls.length, n + 1, 'only the list ran');
  const broken = createDormant({ cli: createFleetCli({ run: async () => { throw new Error('boom'); } }), log: (l) => logs.push(l) });
  assert.equal(await broken.restoreOnBoot({ markerFile }), null);
  assert.match(logs.at(-1), /restore\.onBoot failed/);
});

test('config: restore.onBoot defaults to false; a non-boolean is refused', () => {
  const base = { self: 'laptop' };
  const c = normalizeConfig(base, { env: {}, home: '/home/tester' });
  assert.equal(c.restore.onBoot, false);
  assert.equal(c.restore.markerFile, '/home/tester/.local/state/fleet/web-restored-boot');
  assert.equal(normalizeConfig({ ...base, restore: { onBoot: true } }, { env: {}, home: '/home/tester' }).restore.onBoot, true);
  assert.throws(() => normalizeConfig({ ...base, restore: { onBoot: 'yes' } }, { env: {}, home: '/home/tester' }), /restore\.onBoot/);
});

test('recently closed: closed: true → --closed on restore / forget; never with all on a restore', async (t) => {
  assert.deepEqual(validateDormantRequest({ target: 'x', closed: true }), { all: false, target: 'x', dryRun: false, closed: true });
  assert.deepEqual(validateDormantRequest({ all: true, closed: true }), { all: true, target: null, dryRun: false, closed: true });
  assert.throws(() => validateDormantRequest({ all: true, closed: true }, { allowAll: false }), (e) => e.status === 400);
  assert.throws(() => validateDormantRequest({ target: 'x', closed: 'yes' }), (e) => e.status === 400);
  assert.deepEqual(ambiguityCandidates('"q" matches 2 recently closed sessions: a, b — be more specific'), ['a', 'b']);

  const { calls, run } = fakeRun('laptop');
  const d = createDormant({ cli: createFleetCli({ run }) });
  await d.restore({ target: 'fleet-test-c', closed: true, dryRun: true });
  await d.forget({ target: 'fleet-test-c', closed: true });
  await d.forget({ all: true, closed: true });
  await assert.rejects(d.restore({ all: true, closed: true }), (e) => e.status === 400);
  assert.deepEqual(calls, [
    ['--local', 'restore', '--json', '--dry-run', '--closed', '--', 'fleet-test-c'],
    ['--local', 'restore', '--json', '--closed', '--forget=fleet-test-c'],
    ['--local', 'restore', '--json', '--closed', '--forget-all'],
  ]);

  const { hosts, urls } = await startPair(t);
  const list = await call(`${urls.laptop}/api/hosts/workstation/dormant`);
  assert.equal(list.body.closed[0].tmuxSession, 'fleet-test-c', 'closed passes through');
  const base = `${urls.laptop}/api/hosts/workstation/dormant`;
  const ok = await call(`${base}/restore`, 'POST', { target: 'fleet-test-c', closed: true });
  assert.equal(ok.status, 200);
  assert.deepEqual(hosts.workstation.calls.at(-1), ['--local', 'restore', '--json', '--closed', '--', 'fleet-test-c']);
  assert.equal((await call(`${base}/restore`, 'POST', { all: true, closed: true })).status, 400);
  const gone = await call(`${base}/forget`, 'POST', { all: true, closed: true });
  assert.equal(gone.status, 200);
  assert.deepEqual(hosts.workstation.calls.at(-1), ['--local', 'restore', '--json', '--closed', '--forget-all']);
});

test('recently closed: a CLI without --closed → 501; restore.onBoot ignores closed sessions', async (t) => {
  const old = createFleetCli({ run: async () => { throw cliError(2, "error: unexpected argument '--closed' found"); } });
  await assert.rejects(createDormant({ cli: old }).restore({ target: 'x', closed: true }), (e) => e.status === 501);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-dormant-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const view = { host: 'laptop', bootId: '7', dormant: [], closed: dormantList('laptop').closed };
  const run = async (bin, args) => {
    calls.push(args);
    return { stdout: JSON.stringify(view), stderr: '' };
  };
  const d = createDormant({ cli: createFleetCli({ run }) });
  assert.equal(await d.restoreOnBoot({ markerFile: path.join(dir, 'marker') }), null);
  assert.deepEqual(calls, [['--local', 'restore', '--json']], 'only the list — nothing restored');
});

// ------------------------------------------------------------------ read-only chat of a closed / dormant session

const SID_CODEX = 'dddddddd-0000-0000-0000-000000000003';
const SID_PI = 'eeeeeeee-0000-0000-0000-000000000004';
const SID_NO_TRANSCRIPT = 'ffffffff-0000-0000-0000-000000000005';

const claudeLine = (role, text, extra = {}) =>
  JSON.stringify({ type: role, timestamp: '2026-10-02T10:00:00Z', message: role === 'user' ? { role, content: text } : { id: `m-${text}`, role, content: [{ type: 'text', text }], stop_reason: 'end_turn' }, ...extra });

/** Temp transcript homes (Claude, Codex, pi) holding one transcript per record above, plus a secret outside them. */
function historyHomes(t, cwd) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const homes = { claude: path.join(root, 'claude'), codex: path.join(root, 'codex'), pi: path.join(root, 'pi') };
  const write = (file, lines) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.join('\n') + '\n');
  };
  const proj = path.join(homes.claude, 'projects', encodeCwd(cwd));
  write(path.join(proj, `${SID_CLOSED}.jsonl`), [claudeLine('user', 'first'), claudeLine('assistant', 'one'), claudeLine('user', 'second'), claudeLine('assistant', 'two')]);
  write(path.join(proj, `${SID}.jsonl`), [claudeLine('user', 'dormant prompt'), claudeLine('assistant', 'dormant reply')]);
  write(path.join(homes.codex, 'sessions', '2026', '10', '02', `rollout-2026-10-02T10-00-00-${SID_CODEX}.jsonl`), [
    JSON.stringify({ type: 'session_meta', payload: { id: SID_CODEX, cwd } }),
    JSON.stringify({ type: 'response_item', timestamp: '2026-10-02T10:00:00Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'codex prompt' }] } }),
    JSON.stringify({ type: 'response_item', timestamp: '2026-10-02T10:00:01Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'codex reply' }] } }),
  ]);
  write(path.join(homes.pi, 'sessions', piDirName(cwd), `2026-10-02T10-00-00_${SID_PI}.jsonl`), [
    JSON.stringify({ type: 'session', id: SID_PI, cwd }),
    JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'pi prompt' }] } }),
    JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'pi reply' }], stopReason: 'stop' } }),
  ]);
  const secret = path.join(root, 'secret.jsonl');
  write(secret, [claudeLine('user', 'secret')]);
  return { root, homes, secret };
}

/** `fleet restore --json` with a closed Claude, Codex and pi session, a dormant Claude one and one without a transcript. */
function historyList(host, cwd) {
  const one = (sessionId, title, extra = {}) => ({ sessionId, name: null, title, cwd, ...extra });
  const closed = (s, at) => ({ kind: 'claude', target: s.sessionId, name: s.title, since: at, closedAt: at, windows: 1, panes: 1, sessions: [s] });
  return {
    host,
    bootId: '7',
    dormant: [{ kind: 'tmux', target: 'fleet-test-a', name: 'fleet-test-a', since: '2026-10-01T10:00:00Z', windows: 1, panes: 1, sessions: [one(SID, 'Fix login')] }],
    closed: [
      { ...closed(one(SID_CLOSED, 'Old work'), '2026-10-02T10:00:00Z'), tmuxSession: 'fleet-test-c' },
      closed(one(SID_CODEX, 'Codex work', { harness: 'codex' }), '2026-10-02T09:00:00Z'),
      closed(one(SID_PI, 'Pi work', { harness: 'pi' }), '2026-10-02T08:00:00Z'),
      closed(one(SID_NO_TRANSCRIPT, 'Lost'), '2026-10-02T07:00:00Z'),
    ],
  };
}

async function startHistoryPair(t, { withDormant = true } = {}) {
  const cwd = '/home/tester/Code/project';
  const files = historyHomes(t, cwd);
  const urls = {};
  const handles = {};
  const calls = {};
  for (const name of ['laptop', 'workstation']) {
    const server = createHttpServer({ handleApi: (req, url) => handles[name](req, url) });
    urls[name] = await listen(server);
    t.after(() => server.close());
  }
  for (const name of ['laptop', 'workstation']) {
    calls[name] = [];
    const run = async (bin, args) => {
      calls[name].push(args);
      if (args[0] === 'list') return { stdout: '[]', stderr: '' };
      assert.deepEqual(args, ['--local', 'restore', '--json'], 'only the list is ever asked for');
      return { stdout: JSON.stringify(historyList(name, cwd)), stderr: '' };
    };
    const cli = createFleetCli({ run });
    const config = normalizeConfig({ self: name, hosts: { laptop: { web: urls.laptop }, workstation: { web: urls.workstation } } }, { env: {}, home: '/home/tester' });
    const api = createApi({
      config,
      fleet: createFleet({ cli, self: name }),
      backend: {},
      transcripts: createTranscriptReader({ home: files.homes.claude, codexHome: files.homes.codex, piHome: files.homes.pi }),
      spawner: {},
      cli,
      dormant: withDormant ? createDormant({ cli }) : null,
      warmFleet: false,
    });
    t.after(() => api.stop());
    handles[name] = api;
  }
  return { urls, calls, files, cwd };
}

test('closed / dormant messages: the live messages shape from the record, limit and truncated', async (t) => {
  const { urls, cwd } = await startHistoryPair(t);
  const base = `${urls.laptop}/api/hosts/laptop/dormant/sessions`;
  const r = await call(`${base}/${SID_CLOSED}/messages`);
  assert.equal(r.status, 200);
  assert.equal(r.body.host, 'laptop');
  assert.equal(r.body.id, SID_CLOSED);
  assert.equal(r.body.status, 'closed');
  assert.equal(r.body.name, 'Old work');
  assert.equal(r.body.limit, 60);
  assert.deepEqual(r.body.messages.map((m) => [m.role, m.text]), [['user', 'first'], ['assistant', 'one'], ['user', 'second'], ['assistant', 'two']]);
  assert.equal(r.body.total, 4);
  assert.equal(r.body.truncated, false);
  assert.equal(typeof r.body.updatedAt, 'number');
  assert.equal(typeof r.body.capturedAt, 'number');
  assert.deepEqual(r.body.record, {
    pool: 'closed', kind: 'claude', target: SID_CLOSED, name: 'Old work', title: 'Old work', sessionName: null, cwd,
    harness: 'claude', since: '2026-10-02T10:00:00Z', closedAt: '2026-10-02T10:00:00Z', tmuxSession: 'fleet-test-c',
  });

  const two = await call(`${base}/${SID_CLOSED}/messages?limit=2`);
  assert.deepEqual(two.body.messages.map((m) => m.text), ['second', 'two']);
  assert.equal(two.body.truncated, true);
  assert.equal(two.body.limit, 2);

  // A unique prefix of ≥ 8 characters, like the live routes; a dormant session too.
  const dormantOne = await call(`${base}/${SID.slice(0, 8)}/messages`);
  assert.equal(dormantOne.status, 200);
  assert.equal(dormantOne.body.id, SID);
  assert.equal(dormantOne.body.status, 'dormant');
  assert.equal(dormantOne.body.record.pool, 'dormant');
  assert.equal(dormantOne.body.record.closedAt, null);
  assert.deepEqual(dormantOne.body.messages.map((m) => m.text), ['dormant prompt', 'dormant reply']);
});

test('closed messages: Codex and pi records read from their own transcript dirs', async (t) => {
  const { urls } = await startHistoryPair(t);
  const base = `${urls.laptop}/api/hosts/laptop/dormant/sessions`;
  const codex = await call(`${base}/${SID_CODEX}/messages`);
  assert.equal(codex.status, 200);
  assert.equal(codex.body.record.harness, 'codex');
  assert.deepEqual(codex.body.messages.map((m) => [m.role, m.text]), [['user', 'codex prompt'], ['assistant', 'codex reply']]);
  const pi = await call(`${base}/${SID_PI}/messages`);
  assert.equal(pi.status, 200);
  assert.equal(pi.body.record.harness, 'pi');
  assert.deepEqual(pi.body.messages.map((m) => [m.role, m.text]), [['user', 'pi prompt'], ['assistant', 'pi reply']]);
});

test('closed messages: not a record → 404, no transcript → 404, bad ids → 400, POST → 405, no recovery → 501', async (t) => {
  const { urls } = await startHistoryPair(t);
  const base = `${urls.laptop}/api/hosts/laptop/dormant/sessions`;
  const unknown = await call(`${base}/99999999-0000-0000-0000-000000000000/messages`);
  assert.equal(unknown.status, 404);
  assert.match(unknown.body.error, /not a recently closed or dormant session/);
  assert.equal((await call(`${base}/cccccccc/messages`)).status, 200, 'a unique prefix');
  assert.equal((await call(`${base}/ccccccc/messages`)).status, 404, 'a prefix under 8 characters is no match');
  const lost = await call(`${base}/${SID_NO_TRANSCRIPT}/messages`);
  assert.equal(lost.status, 404);
  assert.match(lost.body.error, /transcript not found/);
  assert.equal((await call(`${base}/${SID_CLOSED}/messages`, 'POST', {})).status, 405);
  assert.equal((await call(`${urls.laptop}/api/hosts/nowhere/dormant/sessions/${SID_CLOSED}/messages`)).status, 404);

  const off = await startHistoryPair(t, { withDormant: false });
  assert.equal((await call(`${off.urls.laptop}/api/hosts/laptop/dormant/sessions/${SID_CLOSED}/messages`)).status, 501);
});

test('closed messages: path traversal in the id is refused before anything is read', async (t) => {
  const { urls, calls } = await startHistoryPair(t);
  const base = `${urls.laptop}/api/hosts/laptop/dormant/sessions`;
  const before = calls.laptop.length;
  for (const bad of ['..%2F..%2Fsecret', '%2E%2E', '..', `${SID_CLOSED}%2F..%2F..%2Fsecret`, '%2Fetc%2Fpasswd', 'a.b.c.d.e.f', '%E0%A4%A']) {
    const r = await call(`${base}/${bad}/messages`);
    // `..` / `%2E%2E` are dot segments: the URL parser drops them, leaving no route (404).
    assert.equal(r.status, bad === '..' || bad === '%2E%2E' ? 404 : 400, bad);
  }
  assert.equal(calls.laptop.length, before, 'the record list was never fetched');
});

test('locateRecordTranscript: only inside the harness dir — a symlink out, a traversing cwd and bad ids are null', async (t) => {
  const { homes, secret, root } = historyHomes(t, '/w/app');
  const proj = path.join(homes.claude, 'projects', encodeCwd('/w/app'));
  const linked = '11111111-0000-0000-0000-000000000000';
  fs.symlinkSync(secret, path.join(proj, `${linked}.jsonl`));
  assert.equal(await locateRecordTranscript({ sessionId: linked, cwd: '/w/app' }, homes), null, 'a symlink pointing outside');
  const found = await locateRecordTranscript({ sessionId: SID_CLOSED, cwd: '/w/app' }, homes);
  assert.equal(found.harness, 'claude');
  assert.equal(found.file, fs.realpathSync(path.join(proj, `${SID_CLOSED}.jsonl`)));
  // The id is the only part of the path a record controls besides cwd, which is encoded.
  assert.equal(await locateRecordTranscript({ sessionId: '../secret', cwd: '/w/app' }, homes), null);
  assert.equal(await locateRecordTranscript({ sessionId: 'secret', cwd: '../..' }, homes), null);
  assert.equal(await locateRecordTranscript({ sessionId: 'secret', cwd: root }, homes), null);
  // A Codex record is never looked up in Claude's dir (and the other way round).
  assert.equal(await locateRecordTranscript({ sessionId: SID_CLOSED, cwd: '/w/app', harness: 'codex' }, homes), null);
  assert.equal((await locateRecordTranscript({ sessionId: SID_CODEX, harness: 'codex' }, homes)).harness, 'codex');
  assert.equal(await locateRecordTranscript({ sessionId: SID_CODEX, harness: 'claude' }, homes), null);
  assert.equal((await locateRecordTranscript({ sessionId: SID_PI, cwd: '/elsewhere', harness: 'pi' }, homes)).harness, 'pi', 'pi: any cwd dir when its own has none');
});

test('closed messages: proxied once to the peer that has the record', async (t) => {
  const { urls, calls } = await startHistoryPair(t);
  const r = await call(`${urls.laptop}/api/hosts/workstation/dormant/sessions/${SID_CLOSED}/messages?limit=1`);
  assert.equal(r.status, 200);
  assert.equal(r.body.host, 'workstation');
  assert.deepEqual(r.body.messages.map((m) => m.text), ['two']);
  assert.ok(calls.workstation.some((a) => a.join(' ') === '--local restore --json'), 'the peer resolved its own record');
  assert.ok(!calls.laptop.some((a) => a.includes('restore')), 'the proxying host read nothing');
  // A proxied request is never proxied again.
  assert.equal((await call(`${urls.laptop}/api/hosts/workstation/dormant/sessions/${SID_CLOSED}/messages?local=1`)).status, 404);
});
