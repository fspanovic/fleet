import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKiller } from '../lib/kill.mjs';

function fakeProcess(alive = true, diesAfterTerm = true) {
  const sent = [];
  const killProcess = (pid, sig) => {
    sent.push(sig);
    if (!alive) {
      const e = new Error('no such process');
      e.code = 'ESRCH';
      throw e;
    }
    if (sig === 'SIGTERM' && diesAfterTerm) alive = false;
    if (sig === 'SIGKILL') alive = false;
  };
  return { sent, killProcess };
}

const noRun = async () => ({ stdout: '', stderr: '' });

function tmuxRun(shape, { failKill = null } = {}) {
  const calls = [];
  const run = async (bin, args) => {
    calls.push(args);
    if (args[0] === 'display-message') return { stdout: shape, stderr: '' };
    if (failKill && args[0].startsWith('kill-')) throw new Error(failKill);
    return { stdout: '', stderr: '' };
  };
  return { calls, run };
}

test('kill: resolves the pane first, SIGTERMs, then kill-session by id when it was the only window', async () => {
  const { sent, killProcess } = fakeProcess();
  const { calls, run } = tmuxRun('$3 @7 1\n');
  const k = createKiller({ run, killProcess, sleep: async () => {} });
  const res = await k.kill({ pid: 4242, backend: 'tmux', handle: '%7', tmux_session: 'job' });
  assert.deepEqual(res, { process: 'terminated', terminal: 'tmux-session-killed' });
  assert.deepEqual(sent, [0, 'SIGTERM', 0]);
  assert.deepEqual(calls[0], ['display-message', '-p', '-t', '%7', '#{session_id} #{window_id} #{session_windows}']);
  assert.deepEqual(calls.at(-1), ['kill-session', '-t', '$3']);
});

test('kill: only the window goes when the tmux session has other windows', async () => {
  const { killProcess } = fakeProcess();
  const { calls, run } = tmuxRun('$3 @7 2');
  const k = createKiller({ run, killProcess, sleep: async () => {} });
  const res = await k.kill({ pid: 4242, backend: 'tmux', handle: '%7', tmux_session: 'plain' });
  assert.equal(res.terminal, 'tmux-window-killed');
  assert.deepEqual(calls.at(-1), ['kill-window', '-t', '@7']);
});

test('kill: a tmux target that closed itself with Claude is fine, other tmux errors are not', async () => {
  const { killProcess } = fakeProcess();
  const gone = tmuxRun('$3 @7 1', { failKill: "can't find session: $3" });
  const res = await createKiller({ run: gone.run, killProcess, sleep: async () => {} }).kill({ pid: 4242, backend: 'tmux', handle: '%7' });
  assert.equal(res.terminal, 'tmux-session-killed');
  const broken = tmuxRun('$3 @7 1', { failKill: 'permission denied' });
  await assert.rejects(
    createKiller({ run: broken.run, killProcess: fakeProcess().killProcess, sleep: async () => {} }).kill({ pid: 4242, backend: 'tmux', handle: '%7' }),
    /permission denied/,
  );
});

test('kill: a pane that is already gone touches no tmux target', async () => {
  const { killProcess } = fakeProcess(false);
  const { calls, run } = tmuxRun(''); // tmux prints nothing for a vanished pane
  const res = await createKiller({ run, killProcess, sleep: async () => {} }).kill({ pid: 4242, backend: 'tmux', handle: '%7', tmux_session: 'job' });
  assert.deepEqual(res, { process: 'gone', terminal: 'tmux-pane-gone' });
  assert.ok(calls.every((a) => !a[0].startsWith('kill-')));
});

test('kill: escalates to SIGKILL after the grace period', async () => {
  const { sent, killProcess } = fakeProcess(true, false);
  const k = createKiller({ run: noRun, killProcess, sleep: async () => {}, graceMs: 0 });
  const res = await k.kill({ pid: 4242, backend: 'unknown', handle: null, tmux_session: null });
  assert.equal(res.process, 'killed');
  assert.ok(sent.includes('SIGKILL'));
  assert.equal(res.terminal, 'left');
});

test('kill: bad pids are skipped, never signalled', async () => {
  const { sent, killProcess } = fakeProcess();
  const k = createKiller({ run: noRun, killProcess, sleep: async () => {} });
  assert.equal(await k.terminate(1), 'skipped');
  assert.equal(await k.terminate(Number('x')), 'skipped');
  assert.deepEqual(sent, []);
});

test('kill: iterm closes the tab, tolerates refusal, dead pid is reported gone', async () => {
  const { killProcess } = fakeProcess(false);
  let closed = 0;
  const k = createKiller({ run: noRun, killProcess, sleep: async () => {}, closeIterm: async () => { closed += 1; } });
  const res = await k.kill({ pid: 4242, backend: 'iterm', handle: 'ABC', tmux_session: null });
  assert.deepEqual(res, { process: 'gone', terminal: 'iterm-tab-closed' });
  assert.equal(closed, 1);
  const k2 = createKiller({ run: noRun, killProcess, sleep: async () => {}, closeIterm: async () => { throw new Error('nope'); } });
  assert.equal((await k2.kill({ pid: 4242, backend: 'iterm', handle: 'ABC' })).terminal, 'iterm-tab-left');
});

/** tmux for a restart: the pane's pid, then its foreground command (`claude` until it died, then the shell). */
function restartRun({ panePid = '100', after = 'zsh' } = {}) {
  const calls = [];
  let dead = false;
  const run = async (bin, args) => {
    calls.push([bin, ...args]);
    if (args[0] === 'display-message' && args.at(-1) === '#{pane_pid}') return { stdout: `${panePid}\n`, stderr: '' };
    if (args[0] === 'display-message' && args.at(-1) === '#{pane_current_command}') {
      if (after === null && dead) throw new Error("can't find pane: %7");
      return { stdout: dead ? `${after}\n` : '2.1.306\n', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  return { calls, run, die: () => (dead = true) };
}

test('restart: ends Claude, keeps the pane, and types the resume line into it once the shell is back', async () => {
  const r = restartRun();
  const { sent, killProcess } = fakeProcess();
  const k = createKiller({ run: r.run, killProcess: (pid, sig) => (sig === 'SIGTERM' && r.die(), killProcess(pid, sig)), sleep: async () => {} });
  const res = await k.restart({ pid: 4242, backend: 'tmux', handle: '%7' }, "cd '/w' && claude --resume 's1' --dangerously-skip-permissions");
  assert.deepEqual(res, { process: 'terminated', terminal: 'left', pane: '%7' });
  assert.deepEqual(sent, [0, 'SIGTERM', 0]);
  const typed = r.calls.filter((c) => c[1] === 'send-keys');
  assert.deepEqual(typed, [
    ['tmux', 'send-keys', '-t', '%7', '-l', '--', "cd '/w' && claude --resume 's1' --dangerously-skip-permissions"],
    ['tmux', 'send-keys', '-t', '%7', 'Enter'],
  ]);
  assert.equal(r.calls.some((c) => /^kill-/.test(c[1])), false, 'the terminal is kept');
});

test('restart: refused before anything ends when Claude is the pane\'s own process, or not in tmux', async () => {
  const r = restartRun({ panePid: '4242' });
  const { sent, killProcess } = fakeProcess();
  const k = createKiller({ run: r.run, killProcess, sleep: async () => {} });
  await assert.rejects(k.restart({ pid: 4242, backend: 'tmux', handle: '%7' }, 'x'), (e) => e.status === 409 && /own command/.test(e.message));
  assert.deepEqual(sent, [], 'nothing signalled');
  await assert.rejects(k.restart({ pid: 4242, backend: 'iterm', handle: 'w0t0p0' }, 'x'), (e) => e.status === 409);
});

test('restart: a pane that closed anyway is a 502 and nothing is typed', async () => {
  const r = restartRun({ after: null });
  const { killProcess } = fakeProcess();
  const k = createKiller({ run: r.run, killProcess: (pid, sig) => (sig === 'SIGTERM' && r.die(), killProcess(pid, sig)), sleep: async () => {} });
  await assert.rejects(k.restart({ pid: 4242, backend: 'tmux', handle: '%7' }, 'x'), (e) => e.status === 502);
  assert.equal(r.calls.some((c) => c[1] === 'send-keys'), false);
});
