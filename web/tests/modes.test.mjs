import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_MODE_PRESSES, claudeMode, cycleToMode, keptFlags, resumeInBypassCommand, validateUntil } from '../lib/modes.mjs';

// The bottom of a real Claude Code 2.1.306 pane (a custom status line above the mode line).
const pane = (modeLine, extra = '') => [
  ' ▐▛███▛█   Claude Code v2.1.306',
  '⏺ Session was started with bypass permissions, so plan mode won\'t ask',
  '  before most edits or commands.',
  '──────────────────────────────────────────── probe ─',
  '❯ Try "fix typecheck errors"',
  '────────────────────────────────────────────────────',
  '  ✔ probe HEAD │ ? ctx │ 65% left (3h42m) │ 0m │ opus-5.5 1M·high',
  modeLine,
  extra,
  '',
  '',
].join('\n');

// The order Shift+Tab walks for a session started with --dangerously-skip-permissions.
const CYCLE = [
  '  ⏵⏵ bypass permissions on (shift+tab to cycle) · ← for agents',
  '  ⏵⏵ auto mode on (shift+tab to cycle)',
  '  ⏸ manual mode on',
  '  ⏵⏵ accept edits on (shift+tab to cycle)',
  '  ⏸ plan mode on (shift+tab to cycle)',
];

test('claudeMode: reads every mode Claude Code prints under its prompt box', () => {
  assert.deepEqual(CYCLE.map((l) => claudeMode(pane(l))?.id), ['bypass', 'auto', 'manual', 'acceptEdits', 'plan']);
  assert.deepEqual(claudeMode(pane(CYCLE[0])), { id: 'bypass', label: 'bypass permissions' });
  // A hint line under it does not hide it.
  assert.equal(claudeMode(pane(CYCLE[1], "  tmux focus-events off · add 'set -g focus-events on'"))?.id, 'auto');
});

test('claudeMode: no mode line on screen is null, and the same words in the conversation never count', () => {
  assert.equal(claudeMode(pane('')), null, 'the "Session was started with bypass permissions" note is not a mode');
  assert.equal(claudeMode(''), null);
  assert.equal(claudeMode(null), null);
  const old = ['  ⏵⏵ bypass permissions on (shift+tab to cycle)', ...Array.from({ length: 20 }, (_, i) => `line ${i}`)].join('\n');
  assert.equal(claudeMode(old), null, 'only the bottom of the pane is read');
});

test('validateUntil: bypass or auto, only with Shift+Tab', () => {
  assert.deepEqual(validateUntil({ key: 'Escape' }), { ok: true, until: null });
  assert.deepEqual(validateUntil({ key: 'BTab', until: 'bypass' }), { ok: true, until: 'bypass' });
  assert.deepEqual(validateUntil({ key: 'BTab', until: 'auto' }), { ok: true, until: 'auto' });
  assert.equal(validateUntil({ key: 'BTab', until: 'plan' }).ok, false);
  assert.equal(validateUntil({ key: 'Enter', until: 'bypass' }).ok, false);
});

/** A fake pane that moves one step through `cycle` per press (or not at all when `deaf`). */
function fakePane(cycle, start = 0, { deaf = false } = {}) {
  let i = start;
  let presses = 0;
  return {
    read: async () => pane(cycle[i]),
    press: async () => {
      presses += 1;
      if (!deaf) i = (i + 1) % cycle.length;
    },
    get presses() {
      return presses;
    },
    get at() {
      return i;
    },
  };
}
const sleep = async () => {};

test('cycleToMode: bypass → auto → bypass, reading the pane after every press', async () => {
  const p = fakePane(CYCLE, 0);
  const toAuto = await cycleToMode({ target: 'auto', read: p.read, press: p.press, sleep });
  assert.equal(toAuto.result, 'switched');
  assert.equal(toAuto.presses, 1);
  assert.deepEqual(toAuto.cycle, ['bypass', 'auto']);
  const back = await cycleToMode({ target: 'bypass', read: p.read, press: p.press, sleep });
  assert.equal(back.result, 'switched');
  assert.equal(back.presses, 4);
  assert.deepEqual(back.cycle, ['auto', 'manual', 'acceptEdits', 'plan', 'bypass']);
  assert.equal(back.mode.id, 'bypass');
});

test('cycleToMode: already there presses nothing', async () => {
  const p = fakePane(CYCLE, 0);
  const r = await cycleToMode({ target: 'bypass', read: p.read, press: p.press, sleep });
  assert.equal(r.result, 'already');
  assert.equal(p.presses, 0);
});

test('cycleToMode: a cycle without the target stops after one full turn, back where it started', async () => {
  // Started with neither skip-permissions flag: no bypass in the cycle.
  const noBypass = [CYCLE[2], CYCLE[3], CYCLE[4], CYCLE[1]];
  const p = fakePane(noBypass, 0);
  const r = await cycleToMode({ target: 'bypass', read: p.read, press: p.press, sleep });
  assert.equal(r.result, 'missing');
  assert.equal(r.presses, 4);
  assert.equal(p.at, 0, 'left in the mode it started in');
  assert.deepEqual(r.cycle, ['manual', 'acceptEdits', 'plan', 'auto', 'manual']);
});

test('cycleToMode: bounded even when the starting mode never comes back', async () => {
  let n = 0;
  const labels = ['manual mode', 'accept edits', 'plan mode', 'auto mode', 'dont-know', 'x one', 'x two', 'x three', 'x four'];
  const r = await cycleToMode({ target: 'bypass', read: async () => pane(`  ⏸ ${labels[n]} on`), press: async () => void (n += 1), sleep });
  assert.equal(r.result, 'missing');
  assert.equal(r.presses, MAX_MODE_PRESSES);
});

test('cycleToMode: no mode line is unreadable (nothing pressed); a key that changes nothing is stuck', async () => {
  let pressed = 0;
  const none = await cycleToMode({ target: 'bypass', read: async () => pane(''), press: async () => void (pressed += 1), sleep });
  assert.equal(none.result, 'unreadable');
  assert.equal(pressed, 0);
  const p = fakePane(CYCLE, 1, { deaf: true });
  const stuck = await cycleToMode({ target: 'bypass', read: p.read, press: p.press, sleep });
  assert.equal(stuck.result, 'stuck');
  assert.equal(stuck.presses, 1);
});

test('keptFlags: model, add-dir, agent, fallback-model and chrome; never the permission flags', () => {
  assert.deepEqual(
    keptFlags('claude --dangerously-skip-permissions --model opus -n name --permission-mode=plan --add-dir /a --add-dir=/b --chrome --agent=rev --fallback-model sonnet'),
    ['--model', 'opus', '--add-dir', '/a', '--add-dir', '/b', '--chrome', '--agent', 'rev', '--fallback-model', 'sonnet'],
  );
  assert.deepEqual(keptFlags('claude --model $(rm)'), [], 'a value with shell characters is dropped');
  assert.deepEqual(keptFlags(''), []);
});

test('resumeInBypassCommand: resume the same id in the same cwd with --dangerously-skip-permissions, name kept', () => {
  assert.equal(
    resumeInBypassCommand({ launcher: 'claude', cwd: '/w/app', sessionId: 'abcd-1234', name: 'kelpie', args: 'claude --model opus -n kelpie' }),
    "cd '/w/app' && claude --model 'opus' --resume 'abcd-1234' --dangerously-skip-permissions -n 'kelpie'",
  );
  // No name: no -n. A launcher that already bypasses is not given the flag twice, nor its own flags.
  assert.equal(
    resumeInBypassCommand({ launcher: 'claude --dangerously-skip-permissions --model x', cwd: "/it's", sessionId: 's1', args: 'claude --model x --chrome' }),
    "cd '/it'\\''s' && claude --dangerously-skip-permissions --model x --chrome --resume 's1'",
  );
});
