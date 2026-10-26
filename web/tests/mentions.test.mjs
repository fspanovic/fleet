import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { countInto, createTaskMentions, scanFile, summarize, taskUrlsIn, TASK_MENTIONS_MAX } from '../lib/mentions.mjs';
import { encodeCwd } from '../lib/transcript.mjs';

const APP = 'https://app.example.com/1-acme';
const line = (obj) => JSON.stringify(obj);
const user = (content, extra = {}) => line({ type: 'user', message: { role: 'user', content }, ...extra });
const asst = (content) => line({ type: 'assistant', message: { role: 'assistant', content } });
const text = (t) => ({ type: 'text', text: t });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (id, content) => ({ type: 'tool_result', tool_use_id: id, content });
const counted = (jsonl) => summarize(countInto(new Map(), `${jsonl}\n`));

test('taskUrlsIn: task URLs of any host, keyed by origin + id, `/tasks/task/<id>` folded', () => {
  const found = taskUrlsIn(
    `see ${APP}/tasks/42, ${APP}/tasks/42/activity and (${APP}/tasks/task/42?x=1) and HTTPS://APP.EXAMPLE.COM/1-acme/tasks/42 ` +
      `plus https://other.example/tasks/7 but not ${APP}/tasks/42abc, ${APP}/tasks/new or ${APP}/projects/42`,
  );
  assert.deepEqual(
    found.map((f) => f.key),
    ['https://app.example.com#42', 'https://app.example.com#42', 'https://app.example.com#42', 'https://app.example.com#42', 'https://other.example#7'],
  );
  assert.equal(found[2].url, `${APP}/tasks/42`);
  assert.deepEqual(taskUrlsIn(null), []);
});

test('counts user and assistant text, tool inputs and tool results across the whole transcript', () => {
  const jsonl = [
    user(`https://github.com/acme/app/pull/1`), // the first prompt names no task
    asst([tool('t1', 'Bash', { command: 'gh pr view 1' })]),
    user([result('t1', `Task: [42](${APP}/tasks/42)`)], { toolUseResult: { stdout: `${APP}/tasks/42` } }),
    asst([text(`Task is ${APP}/tasks/42, sibling ${APP}/tasks/43.`)]),
    line({ type: 'assistant', message: { role: 'assistant', content: [tool('t2', 'Bash', { command: `gh pr edit 1 --body "${APP}/tasks/42 ${APP}/tasks/43"` })] }, wireToolInputs: [`${APP}/tasks/42`] }),
    asst([{ type: 'thinking', thinking: `${APP}/tasks/43 ${APP}/tasks/43 ${APP}/tasks/43` }]),
    user(`<system-reminder>${APP}/tasks/43</system-reminder>`),
    user(`skill text ${APP}/tasks/43`, { isMeta: true }),
    user(`${APP}/tasks/43`, { isSidechain: true }),
    line({ type: 'queue-operation', operation: 'enqueue', content: `${APP}/tasks/43` }),
    line({ type: 'api-request-blob', message: { content: `${APP}/tasks/43` } }),
    'not json /tasks/43',
  ].join('\n');
  assert.deepEqual(counted(jsonl), [
    { url: `${APP}/tasks/42`, count: 3 },
    { url: `${APP}/tasks/43`, count: 2 },
  ]);
});

test('talk between agents does not count: briefs, SendMessage, Agent results, <agent-message> hand-backs', () => {
  const jsonl = [
    asst([tool('a1', 'Agent', { prompt: `fix ${APP}/tasks/9 (see also ${APP}/tasks/9)` })]),
    user([result('a1', `report: ${APP}/tasks/9`)]),
    asst([tool('s1', 'SendMessage', { to: 'x', message: `${APP}/tasks/9` })]),
    user(`Another Claude session sent a message:\n<agent-message from="abc">\n  done with ${APP}/tasks/9\n</agent-message>\nand the user's ${APP}/tasks/5`),
    user([result('b1', `<agent-message from="def">${APP}/tasks/9</agent-message>`)]),
  ].join('\n');
  assert.deepEqual(counted(jsonl), [{ url: `${APP}/tasks/5`, count: 1 }]);
});

test('summarize: most mentioned first, capped', () => {
  const counts = new Map();
  for (let i = 0; i < TASK_MENTIONS_MAX + 5; i++) counts.set(`k${i}`, { url: `${APP}/tasks/${i}`, count: i });
  const out = summarize(counts);
  assert.equal(out.length, TASK_MENTIONS_MAX);
  assert.equal(out[0].count, TASK_MENTIONS_MAX + 4);
});

function fixture() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'fleet-mentions-'));
  const cwd = '/home/user/Code/project';
  const dir = path.join(home, 'projects', encodeCwd(cwd));
  mkdirSync(dir, { recursive: true });
  return { home, cwd, file: (id) => path.join(dir, `${id}.jsonl`) };
}

test('scanFile reads appended lines only, waits for a partial line, and starts over on a rewrite', async () => {
  const { file } = fixture();
  const f = file('s1');
  writeFileSync(f, `${asst([text(`${APP}/tasks/1`)])}\n${asst([text(`${APP}/tasks/1`)])}`); // second line not finished
  const a = await scanFile(f);
  assert.deepEqual(summarize(a.counts), [{ url: `${APP}/tasks/1`, count: 1 }]);
  assert.equal(await scanFile(f, a), a, 'unchanged file → the same state, nothing read');

  appendFileSync(f, `\n${asst([text(`${APP}/tasks/2`)])}\n`);
  const b = await scanFile(f, a);
  assert.deepEqual(summarize(b.counts), [{ url: `${APP}/tasks/1`, count: 2 }, { url: `${APP}/tasks/2`, count: 1 }]);
  assert.deepEqual(summarize(a.counts), [{ url: `${APP}/tasks/1`, count: 1 }], 'the previous state is left as it was');
  assert.equal(b.offset, readFileSync(f).length);

  writeFileSync(f, `${user(`${APP}/tasks/3 ${APP}/tasks/3`)}\n${asst([text('padding padding padding padding padding padding padding')])}\n${asst([text('more')])}\n`);
  const c = await scanFile(f, b);
  assert.deepEqual(summarize(c.counts), [{ url: `${APP}/tasks/3`, count: 2 }], 'a different head → counted afresh');

  // An Agent call in one scan, its result in the next: the result still does not count.
  const g = file('s2');
  writeFileSync(g, `${asst([tool('a1', 'Agent', { prompt: 'go' })])}\n`);
  const d = await scanFile(g);
  appendFileSync(g, `${user([result('a1', `${APP}/tasks/4`)])}\n`);
  assert.deepEqual(summarize((await scanFile(g, d)).counts), []);
});

test('createTaskMentions: stamp never waits; counts attach on the next poll, rescans only changed files', async () => {
  const { home, cwd, file } = fixture();
  writeFileSync(file('a'), `${asst([text(`${APP}/tasks/1 ${APP}/tasks/1 ${APP}/tasks/2`)])}\n`);
  writeFileSync(file('b'), `${asst([text('no tasks here')])}\n`);
  const located = [];
  const m = createTaskMentions({
    home,
    locate: async (c, id) => {
      located.push(id);
      const { locateTranscript } = await import('../lib/transcript.mjs');
      return locateTranscript(c, id, home);
    },
  });
  const host = {
    name: 'ws',
    ok: true,
    sessions: [
      { session_id: 'a', cwd },
      { session_id: 'b', cwd },
      { session_id: 'none', cwd }, // no transcript
      { session_id: 'pid-7', cwd, harness: 'codex' },
    ],
  };
  const first = m.stamp(host);
  assert.equal(first.sessions.some((s) => 'taskMentions' in s), false, 'nothing counted yet: the poll does not wait');
  await m.refresh(host.sessions);
  const second = m.stamp(host);
  assert.deepEqual(second.sessions[0].taskMentions, [{ url: `${APP}/tasks/1`, count: 2 }, { url: `${APP}/tasks/2`, count: 1 }]);
  assert.equal('taskMentions' in second.sessions[1], false, 'no task mentioned → no field');
  assert.equal('taskMentions' in second.sessions[2], false);
  assert.equal('taskMentions' in host.sessions[0], false, 'the host passed in is not changed');
  await m.refresh(host.sessions);

  const before = m.get('a');
  appendFileSync(file('a'), `${asst([text(`${APP}/tasks/2 ${APP}/tasks/2`)])}\n`);
  await m.refresh(host.sessions);
  assert.notEqual(m.get('a'), before, 'the changed file is rescanned');
  assert.deepEqual(m.get('a'), [{ url: `${APP}/tasks/2`, count: 3 }, { url: `${APP}/tasks/1`, count: 2 }]);
  assert.deepEqual(m.get('b'), []);
  const b = m.get('b');
  await m.refresh(host.sessions);
  assert.equal(m.get('b'), b, 'an unchanged file keeps its counts');
  assert.deepEqual(located.filter((id) => id === 'a'), ['a'], 'a found transcript is not looked up again');
  assert.equal(located.includes('pid-7'), false, 'non-Claude sessions are skipped');

  await m.refresh([{ session_id: 'b', cwd }]);
  assert.equal(m.get('a'), null, 'a session gone from the list is forgotten');
  assert.deepEqual(m.stamp({ ok: false, error: 'x', sessions: [] }), { ok: false, error: 'x', sessions: [] });
});

test('/api/fleet and ?local=1 carry taskMentions on this host’s sessions', async () => {
  const { createApi } = await import('../lib/api.mjs');
  const { createFleet } = await import('../lib/fleet.mjs');
  const { normalizeConfig } = await import('../lib/config.mjs');
  const sessions = [{ session_id: 's1', name: 'one', status: 'idle', cwd: '/w' }, { session_id: 's2', name: 'two', status: 'idle', cwd: '/w' }];
  const fleet = createFleet({ cli: { list: async () => sessions }, self: 'solo' });
  const config = normalizeConfig({ self: 'solo' }, { env: {}, home: '/home/tester' });
  const taskMentions = { stamp: (host) => ({ ...host, sessions: host.sessions.map((s) => (s.session_id === 's1' ? { ...s, taskMentions: [{ url: `${APP}/tasks/1`, count: 3 }] } : s)) }) };
  const api = createApi({ config, fleet, backend: {}, transcripts: {}, spawner: {}, taskMentions, warmFleet: false });
  for (const q of ['', '?local=1']) {
    const res = await api({ method: 'GET', headers: {} }, new URL(`http://x/api/fleet${q}`));
    const byId = Object.fromEntries(res.body.hosts[0].sessions.map((s) => [s.session_id, s]));
    assert.deepEqual(byId.s1.taskMentions, [{ url: `${APP}/tasks/1`, count: 3 }], q);
    assert.equal('taskMentions' in byId.s2, false, q);
  }
});
