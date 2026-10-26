import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSpawner, isWithin, launchCommand, paneTail, resolveAllowedDir, sanitizeName, shq, shqTyped, validateSpawnRequest } from '../lib/spawn.mjs';
import { WORDS, pickName, registryNames } from '../lib/names.mjs';

test('shq quotes like the fleet CLI', () => {
  assert.equal(shq('a b'), "'a b'");
  assert.equal(shq("it's"), "'it'\\''s'");
});

test('sanitizeName mirrors fleet tmux new', () => {
  assert.equal(sanitizeName('  Fix Login Bug! '), 'fix-login-bug');
  assert.equal(sanitizeName('---'), '');
  assert.equal(sanitizeName('x'.repeat(60)).length, 40);
});

test('launchCommand builds claude -n name [prompt]', () => {
  assert.equal(launchCommand({ name: 'job', prompt: '' }), "claude -n 'job'");
  assert.equal(launchCommand({ name: null, prompt: 'go' }), "claude 'go'");
  assert.equal(launchCommand({ launcher: 'cc', name: 'job', prompt: "do it's" }), "cc -n 'job' 'do it'\\''s'");
});

test('launchCommand types a multi-line prompt as one $\'…\' line (raw newlines get dropped)', () => {
  assert.equal(shqTyped('one line'), "'one line'");
  assert.equal(shqTyped("a\nit's \\ b\tc"), "$'a\\nit\\'s \\\\ b\\tc'");
  assert.equal(launchCommand({ name: null, prompt: 'Testiram.\nMulti line.\n\nPrompt.' }), "claude $'Testiram.\\nMulti line.\\n\\nPrompt.'");
});

test('launchCommand adds --model <id> (quoted) before -n', () => {
  assert.equal(launchCommand({ name: 'job', prompt: 'go', model: 'claude-haiku-4-5-20251001' }), "claude --model 'claude-haiku-4-5-20251001' -n 'job' 'go'");
  assert.equal(launchCommand({ launcher: 'cc', model: 'claude-opus-5-5[1m]' }), "cc --model 'claude-opus-5-5[1m]'");
  assert.equal(launchCommand({ name: null, prompt: '', model: '' }), 'claude', "'' = Claude's default, no flag");
});

test('validateSpawnRequest accepts a model id and rejects anything shell-shaped', () => {
  const opts = { spawnDirs: ['/tmp'] };
  assert.equal(validateSpawnRequest({ model: 'claude-sonnet-5' }, opts).model, 'claude-sonnet-5');
  assert.equal(validateSpawnRequest({ model: 'claude-opus-5-5[1m]' }, opts).model, 'claude-opus-5-5[1m]');
  assert.equal(validateSpawnRequest({}, opts).model, '');
  assert.equal(validateSpawnRequest({ model: '' }, opts).model, '');
  for (const bad of ["x'; rm -rf ~", 'a b', '$(id)', 'a;b', '`id`', 'a\nb', 'x'.repeat(101), 42, { id: 'x' }]) {
    const r = validateSpawnRequest({ model: bad }, opts);
    assert.equal(r.ok, false, `rejects ${JSON.stringify(bad)}`);
    assert.match(r.error, /model must be/);
  }
});

test('validateSpawnRequest defaults, sanitizes and rejects bad input', () => {
  const ok = validateSpawnRequest({ name: 'My Job', prompt: 'hi' }, { spawnDirs: ['/tmp'] });
  assert.equal(ok.ok, true);
  assert.equal(ok.name, 'my-job');
  assert.equal(ok.dir, '/tmp');
  const auto = validateSpawnRequest({}, { spawnDirs: ['/tmp'] });
  assert.equal(auto.name, null, 'the spawner picks a word');
  assert.equal(auto.nameGiven, false);
  assert.equal(ok.nameGiven, true);
  assert.equal(validateSpawnRequest({ name: '!!!' }, { spawnDirs: ['/tmp'] }).nameGiven, false, 'nothing usable typed');
  assert.equal(validateSpawnRequest({ dir: 'relative' }).ok, false);
  assert.equal(validateSpawnRequest({ prompt: 'x'.repeat(8001) }, { spawnDirs: ['/tmp'] }).ok, false);
  assert.equal(validateSpawnRequest({}, { spawnDirs: [] }).ok, false);
});

test('spawner creates the tmux session then types the launcher', async () => {
  const calls = [];
  const run = async (bin, args) => {
    calls.push([bin, ...args]);
    if (args[0] === 'has-session') throw new Error('no such session');
    return { stdout: '', stderr: '' };
  };
  const sp = createSpawner({ run, tmux: 'tmux', launcher: 'claude', sleep: async () => {} });
  const res = await sp.spawn({ name: 'job', dir: '/tmp', prompt: 'go' });
  assert.equal(res.tmuxSession, 'job');
  assert.deepEqual(calls[0], ['tmux', 'has-session', '-t', '=job']);
  assert.deepEqual(calls[1], ['tmux', 'new-session', '-d', '-s', 'job', '-c', '/tmp']);
  assert.deepEqual(calls[2], ['tmux', 'send-keys', '-t', 'job:', '-l', '--', "claude -n 'job' 'go'"]);
  assert.deepEqual(calls[3], ['tmux', 'send-keys', '-t', 'job:', 'Enter']);
  assert.equal(res.trusted, false);
  assert.equal(res.model, null);
});

test('spawner types --model when one was picked', async () => {
  const calls = [];
  const run = async (bin, args) => {
    calls.push([bin, ...args]);
    if (args[0] === 'has-session') throw new Error('no such session');
    return { stdout: '', stderr: '' };
  };
  const sp = createSpawner({ run, tmux: 'tmux', launcher: 'claude', sleep: async () => {} });
  const res = await sp.spawn({ name: 'job', dir: '/tmp', prompt: 'go', model: 'claude-haiku-4-5-20251001' });
  assert.deepEqual(calls[2], ['tmux', 'send-keys', '-t', 'job:', '-l', '--', "claude --model 'claude-haiku-4-5-20251001' -n 'job' 'go'"]);
  assert.equal(res.model, 'claude-haiku-4-5-20251001');
});

test('names: whimsical lowercase words, the same list as the fleet CLI', () => {
  assert.ok(WORDS.length >= 200, `${WORDS.length} words`);
  for (const w of WORDS) assert.match(w, /^[a-z]{1,16}$/);
  assert.equal(new Set(WORDS).size, WORDS.length, 'a word is listed twice');
  const rs = readFileSync(new URL('../../crates/fleet/src/core/words.rs', import.meta.url), 'utf8');
  const body = rs.split('pub const WORDS: &[&str] = &[')[1].split('];')[0];
  assert.deepEqual([...body.matchAll(/"([a-z]+)"/g)].map((m) => m[1]), WORDS);
});

test('pickName skips taken names, and suffixes -2, -3 once every word is taken', () => {
  const taken = WORDS.slice(1);
  for (const r of [0, 0.5, 0.999]) assert.equal(pickName(taken, () => r), WORDS[0]);
  assert.ok(WORDS.includes(pickName()));
  assert.notEqual(pickName([], () => 0), pickName([], () => 0.5), 'random picks the word');
  const second = pickName(WORDS, () => 0.3);
  assert.match(second, /^[a-z]+-2$/);
  assert.ok(WORDS.includes(second.slice(0, -2)));
  assert.match(pickName([...WORDS, ...WORDS.map((w) => `${w}-2`)], () => 0.3), /^[a-z]+-3$/);
});

test('registryNames reads every name in the Claude session registry, skipping junk', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'fleet-names-'));
  try {
    assert.deepEqual(await registryNames(home), [], 'no registry yet');
    mkdirSync(path.join(home, 'sessions'));
    writeFileSync(path.join(home, 'sessions', '1.json'), JSON.stringify({ pid: 1, name: 'kelpie', nameSource: 'user' }));
    writeFileSync(path.join(home, 'sessions', '2.json'), JSON.stringify({ pid: 2, name: 'work-28', nameSource: 'derived' }));
    writeFileSync(path.join(home, 'sessions', '3.json'), '{ half-written');
    writeFileSync(path.join(home, 'sessions', '4.json'), JSON.stringify({ pid: 4 }));
    writeFileSync(path.join(home, 'sessions', 'notes.txt'), 'ballyhoo');
    assert.deepEqual((await registryNames(home)).sort(), ['kelpie', 'work-28']);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('an unnamed spawn gets a word free in tmux and in Claude\'s registry, as tmux name and -n', async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'fleet-names-'));
  try {
    mkdirSync(path.join(home, 'sessions'));
    writeFileSync(path.join(home, 'sessions', '1.json'), JSON.stringify({ pid: 1, name: WORDS[1] }));
    const calls = [];
    const run = async (bin, args) => {
      calls.push([bin, ...args]);
      if (args[0] === 'list-sessions') return { stdout: `${WORDS[0]}\nmain\n`, stderr: '' };
      if (args[0] === 'has-session') throw new Error('no such session');
      return { stdout: '', stderr: '' };
    };
    const random = () => 0; // the first free word
    const sp = createSpawner({ run, tmux: 'tmux', launcher: 'claude', sleep: async () => {}, claudeHome: home, random });
    assert.equal(await sp.freshName(), WORDS[2]);
    calls.length = 0;
    const res = await sp.spawn({ name: null, nameGiven: false, dir: '/tmp', prompt: 'go', model: 'claude-haiku-4-5-20251001' });
    const word = WORDS[2];
    assert.equal(res.name, word);
    assert.equal(res.tmuxSession, word);
    assert.deepEqual(calls[0], ['tmux', 'list-sessions', '-F', '#{session_name}']);
    assert.deepEqual(calls[2], ['tmux', 'new-session', '-d', '-s', word, '-c', '/tmp']);
    assert.deepEqual(calls[3], ['tmux', 'send-keys', '-t', `${word}:`, '-l', '--', `claude --model 'claude-haiku-4-5-20251001' -n '${word}' 'go'`]);
    // Codex: the word names the tmux session only.
    calls.length = 0;
    const cx = await sp.spawn({ name: null, nameGiven: false, dir: '/tmp', prompt: 'go', harness: 'codex' });
    assert.equal(cx.tmuxSession, word);
    assert.deepEqual(calls[3], ['tmux', 'send-keys', '-t', `${word}:`, '-l', '--', "codex 'go'"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('codex and pi: their launcher, --model, -n for pi only; a bad harness is refused', () => {
  assert.equal(launchCommand({ launcher: 'codex', harness: 'codex', name: 'job', model: 'gpt-6', prompt: 'go' }), "codex --model 'gpt-6' 'go'");
  assert.equal(launchCommand({ launcher: 'pi', harness: 'pi', name: 'job', model: 'openai/gpt-5.5:high', prompt: '' }), "pi --model 'openai/gpt-5.5:high' -n 'job'");
  const ok = validateSpawnRequest({ dir: '/tmp', harness: 'pi', model: 'openai/gpt-5.5' });
  assert.equal(ok.ok, true);
  assert.equal(ok.harness, 'pi');
  assert.equal(validateSpawnRequest({ dir: '/tmp' }).harness, 'claude');
  assert.equal(validateSpawnRequest({ dir: '/tmp', harness: 'bash' }).ok, false);
});

test('spawner launches codex with its configured command and accepts its trust prompt', async () => {
  const calls = [];
  let captures = 0;
  const run = async (bin, args) => {
    calls.push([bin, ...args]);
    if (args[0] === 'has-session') throw new Error('no such session');
    if (args[0] === 'capture-pane') {
      captures += 1;
      return { stdout: 'Trust this folder? Codex can read…\n› 1. Trust and continue\n  2. Back' };
    }
    return { stdout: '', stderr: '' };
  };
  const sp = createSpawner({ run, launcher: 'claude', launchers: { codex: 'cx' }, sleep: async () => {} });
  const res = await sp.spawn({ name: 'job', dir: '/tmp', prompt: 'go', harness: 'codex' });
  assert.deepEqual(calls[2], ['tmux', 'send-keys', '-t', 'job:', '-l', '--', "cx 'go'"]);
  assert.equal(res.harness, 'codex');
  assert.equal(res.trusted, true);
  assert.ok(captures >= 2);
  assert.deepEqual(calls.at(-1), ['tmux', 'send-keys', '-t', 'job:', 'Enter']);
});

test('spawner passes a prompt too long to type via a file', async (t) => {
  const promptDir = mkdtempSync(path.join(os.tmpdir(), 'fleet-prompts-'));
  t.after(() => rmSync(promptDir, { recursive: true, force: true }));
  const calls = [];
  const run = async (bin, args) => {
    calls.push(args);
    if (args[0] === 'has-session') throw new Error('no such session');
    return { stdout: '', stderr: '' };
  };
  const prompt = `Skeniraj šta je radila.\n\n${'č'.repeat(600)}\nit's done`;
  const sp = createSpawner({ run, sleep: async () => {}, promptDir });
  const res = await sp.spawn({ name: 'job', dir: '/tmp', prompt });
  const [file] = readdirSync(promptDir);
  assert.match(file, /^\d{8}-\d{6}-job\.md$/);
  const full = path.join(promptDir, file);
  assert.equal(readFileSync(full, 'utf8'), prompt);
  assert.equal(res.command, `claude -n 'job' "$(cat '${full}')"`);
  assert.deepEqual(calls[2], ['send-keys', '-t', 'job:', '-l', '--', res.command]);
});

test('spawner accepts the folder-trust prompt when it appears', async () => {
  const calls = [];
  let captures = 0;
  const run = async (bin, args) => {
    calls.push(args);
    if (args[0] === 'has-session') throw new Error('no such session');
    if (args[0] === 'capture-pane') {
      captures += 1;
      if (captures < 2) return { stdout: 'starting…', stderr: '' };
      const downs = calls.filter((a) => a[0] === 'send-keys' && a[a.length - 1] === 'Down').length;
      return { stdout: downs === 0 ? '❯ No, exit\n  Yes, I trust this folder\n' : '  No, exit\n❯ Yes, I trust this folder\n', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  const sp = createSpawner({ run, sleep: async () => {} });
  const res = await sp.spawn({ name: 'job', dir: '/tmp', prompt: '' });
  assert.equal(res.trusted, true);
  const keys = calls.filter((a) => a[0] === 'send-keys').map((a) => a[a.length - 1]);
  assert.deepEqual(keys, ["claude -n 'job'", 'Enter', 'Down', 'Enter']);
});

test('spawner fails with the pane tail and kills the session when Claude never starts', async () => {
  const calls = [];
  const run = async (bin, args) => {
    calls.push(args);
    if (args[0] === 'has-session') throw new Error('no such session');
    if (args[0] === 'display-message') return { stdout: '-zsh\n', stderr: '' };
    if (args[0] === 'capture-pane') return { stdout: "➜  work claude 'go\nquote> \n\n", stderr: '' };
    return { stdout: '', stderr: '' };
  };
  const sp = createSpawner({ run, sleep: async () => {} });
  await assert.rejects(sp.spawn({ name: 'job', dir: '/tmp', prompt: 'go' }), (e) => {
    assert.equal(e.status, 502);
    assert.equal(e.message, "Claude did not start:\n➜  work claude 'go\nquote>");
    return true;
  });
  assert.deepEqual(calls.at(-1), ['kill-session', '-t', '=job']);
});

test('spawner leaves a session alone once something other than the shell runs in it', async () => {
  const calls = [];
  const run = async (bin, args) => {
    calls.push(args);
    if (args[0] === 'has-session') throw new Error('no such session');
    if (args[0] === 'display-message') return { stdout: '2.1.285\n', stderr: '' };
    return { stdout: 'loading…', stderr: '' };
  };
  const sp = createSpawner({ run, sleep: async () => {} });
  await sp.spawn({ name: 'job', dir: '/tmp', prompt: 'go' });
  assert.equal(calls.some((a) => a[0] === 'kill-session'), false);
});

test('paneTail keeps the last non-empty lines, capped', () => {
  assert.equal(paneTail('a\n\nb\nc\nd\ne\n\n'), 'b\nc\nd\ne');
  assert.equal(paneTail('x'.repeat(250), { width: 10 }), `${'x'.repeat(10)}…`);
});

test('spawner refuses an existing tmux session and a missing dir', async () => {
  const run = async () => ({ stdout: '', stderr: '' });
  const sp = createSpawner({ run, sleep: async () => {} });
  await assert.rejects(sp.spawn({ name: 'job', dir: '/tmp', prompt: '' }), (e) => e.status === 409);
  await assert.rejects(sp.spawn({ name: 'job', dir: '/definitely/not/here', prompt: '' }), (e) => e.status === 400);
});

test('isWithin is path-segment aware', () => {
  assert.equal(isWithin('/a/b', '/a/b'), true);
  assert.equal(isWithin('/a/b/c', '/a/b'), true);
  assert.equal(isWithin('/a/bc', '/a/b'), false);
  assert.equal(isWithin('/a', '/a/b'), false);
});

test('resolveAllowedDir allows roots and subdirs, rejects .. and symlink escapes', async (t) => {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'fleet-spawn-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  mkdirSync(path.join(root, 'sub'), { recursive: true });
  mkdirSync(outside);
  symlinkSync(outside, path.join(root, 'link-out'));
  symlinkSync(path.join(root, 'sub'), path.join(base, 'link-in'));

  assert.equal(await resolveAllowedDir(root, [root]), root);
  assert.equal(await resolveAllowedDir(path.join(root, 'sub'), [root]), path.join(root, 'sub'));
  assert.equal(await resolveAllowedDir(path.join(base, 'link-in'), [root]), path.join(root, 'sub'), 'symlink into a root is fine');
  const bad = (e) => e.status === 400;
  await assert.rejects(resolveAllowedDir(outside, [root]), bad);
  await assert.rejects(resolveAllowedDir(path.join(root, '..', 'outside'), [root]), bad);
  await assert.rejects(resolveAllowedDir(path.join(root, 'link-out'), [root]), bad);
  await assert.rejects(resolveAllowedDir(path.join(root, 'missing'), [root]), bad);
  await assert.rejects(resolveAllowedDir(root, [path.join(base, 'nope')]), bad, 'a missing root allows nothing');
  // No spawnDirs: $HOME subtree only.
  assert.equal(await resolveAllowedDir(path.join(root, 'sub'), [], { home: base }), path.join(root, 'sub'));
  await assert.rejects(resolveAllowedDir('/', [], { home: base }), bad);
});
