import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createApi } from '../lib/api.mjs';
import { normalizeConfig, normalizeSessionStyles, SESSION_STYLE_COLORS, SESSION_STYLES_MAX } from '../lib/config.mjs';
import { createFleet, sessionStyleFor, stampSessionStyles } from '../lib/fleet.mjs';
import { createFleetCli } from '../lib/fleet-cli.mjs';

const WATCHER = { label: 'Watcher', match: { command: '/p-x:start' }, color: 'electric' };

test('web.sessionStyles: normalized, optional, a bad shape is a config error', () => {
  assert.deepEqual(normalizeConfig({}, { env: {}, home: '/h' }).sessionStyles, []);
  const cfg = normalizeConfig(
    { web: { sessionStyles: [{ label: ' Watcher ', match: { command: ' /p-x:start ' }, color: 'electric' }, { label: 'Review', match: { promptIncludes: 'review PR', command: '/review' }, color: 'cyan' }] } },
    { env: {}, home: '/h' },
  );
  assert.deepEqual(cfg.sessionStyles, [
    { label: 'Watcher', color: 'electric', match: { command: '/p-x:start' } },
    { label: 'Review', color: 'cyan', match: { command: '/review', promptIncludes: 'review PR' } },
  ]);

  const bad = (list, re) => assert.throws(() => normalizeSessionStyles(list), re);
  bad({}, /must be an array/);
  bad(['x'], /\[0\] must be an object/);
  bad([{ ...WATCHER, label: '' }], /label must be/);
  bad([{ ...WATCHER, label: 'x'.repeat(25) }], /label must be/);
  bad([{ ...WATCHER, color: 'violet' }], /color must be one of/);
  bad([{ ...WATCHER, color: 'toString' }], /color must be one of/);
  bad([{ ...WATCHER, match: null }], /match must be an object/);
  bad([{ ...WATCHER, match: {} }], /needs command or promptIncludes/);
  bad([{ ...WATCHER, match: { cmd: '/x' } }], /unknown keys: cmd/);
  bad([{ ...WATCHER, match: { command: 'p-x:start' } }], /slash command/);
  bad([{ ...WATCHER, match: { command: '/a b' } }], /slash command/);
  bad([{ ...WATCHER, match: { promptIncludes: '  ' } }], /promptIncludes must be/);
  bad(Array.from({ length: SESSION_STYLES_MAX + 1 }, () => WATCHER), /more than 20/);
  assert.throws(() => normalizeConfig({ web: { sessionStyles: 1 } }, { env: {}, home: '/h' }), /config\.web\.sessionStyles/);
});

test('sessionStyles colours are the UI palette (ui/src/lib/tasks.ts TASK_COLORS)', () => {
  const src = fs.readFileSync(new URL('../ui/src/lib/tasks.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('export const TASK_COLORS'));
  const body = block.slice(0, block.indexOf('\n}\n'));
  const names = [...body.matchAll(/^\s+'?([a-z-]+)'?: \{ light:/gm)].map((m) => m[1]);
  assert.deepEqual([...SESSION_STYLE_COLORS].sort(), names.sort());
});

test('sessionStyleFor: the first rule whose every match key holds', () => {
  const rules = normalizeSessionStyles([
    WATCHER,
    { label: 'Both', match: { command: '/review', promptIncludes: 'urgent' }, color: 'red' },
    { label: 'Prompt', match: { promptIncludes: 'Bug WATCH' }, color: 'cyan' },
  ]);
  assert.deepEqual(sessionStyleFor({ first_command: '/p-x:start', title: 'Base directory for this skill: …' }, rules), { label: 'Watcher', color: 'electric' });
  assert.equal(sessionStyleFor({ first_command: '/p-x:stop', title: 'x' }, rules), null);
  assert.equal(sessionStyleFor({ title: '/p-x:start' }, rules), null, 'a command matches first_command, never the prompt text');
  assert.equal(sessionStyleFor({ first_command: '/review', title: 'look at it' }, rules), null);
  assert.deepEqual(sessionStyleFor({ first_command: '/review', title: 'URGENT: look' }, rules), { label: 'Both', color: 'red' });
  assert.deepEqual(sessionStyleFor({ title: 'start the bug watch now' }, rules), { label: 'Prompt', color: 'cyan' });
  assert.equal(sessionStyleFor({ title: null }, rules), null);
  assert.equal(sessionStyleFor({ first_command: '/p-x:start' }, []), null);
});

test('stampSessionStyles: every host, a peer’s own style replaced, nothing without rules', () => {
  const rules = normalizeSessionStyles([WATCHER]);
  const hosts = [
    { name: 'laptop', sessions: [{ session_id: 'a', first_command: '/p-x:start' }, { session_id: 'b', first_command: null }] },
    { name: 'workstation', sessions: [{ session_id: 'c', first_command: '/other', style: { label: 'Stale', color: 'red' } }] },
    { name: 'down', ok: false, sessions: [] },
  ];
  const out = stampSessionStyles(hosts, rules);
  assert.deepEqual(out[0].sessions.map((s) => s.style ?? null), [{ label: 'Watcher', color: 'electric' }, null]);
  assert.equal('style' in out[1].sessions[0], false);
  assert.equal(stampSessionStyles(hosts, []), hosts);
});

test('/api/fleet stamps `style` from this server’s rules on its own and its peers’ sessions', async () => {
  const rows = [
    { session_id: 'aaaaaaaa-0000-0000-0000-000000000001', name: 'bracken', status: 'idle', first_command: '/p-x:start', title: `Base directory for this skill: ${'x'.repeat(400)}`, updated_at: 2 },
    { session_id: 'aaaaaaaa-0000-0000-0000-000000000002', name: 'siskin', status: 'busy', first_command: null, title: 'fix it', updated_at: 1 },
  ];
  const cli = createFleetCli({ run: async () => ({ stdout: JSON.stringify(rows), stderr: '' }) });
  const config = normalizeConfig(
    { self: 'laptop', hosts: { workstation: { web: 'http://127.0.0.1:1' } }, web: { sessionStyles: [WATCHER] } },
    { env: {}, home: '/home/tester' },
  );
  const fetchPeerHost = async (name) => ({ name, ok: true, fetchedAt: 1, sessions: [{ session_id: 'cccccccc-0000-0000-0000-000000000003', host: name, first_command: '/p-x:start' }] });
  const api = createApi({ config, fleet: createFleet({ cli, self: 'laptop' }), cli, fetchPeerHost, warmFleet: false });
  const res = await api({ method: 'GET', headers: {} }, new URL('http://x/api/fleet'));
  const byName = Object.fromEntries(res.body.hosts.flatMap((h) => h.sessions).map((s) => [s.name ?? s.host, s]));
  assert.deepEqual(byName.bracken.style, { label: 'Watcher', color: 'electric' });
  assert.equal(byName.bracken.first_command, '/p-x:start');
  assert.equal(byName.siskin.style, undefined);
  assert.deepEqual(byName.workstation.style, { label: 'Watcher', color: 'electric' });
});
