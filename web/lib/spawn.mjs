// Start a fresh agent session — Claude Code, Codex or pi — in a new tmux session (one tmux
// session = one job, same convention as `fleet tmux new`). Mirrors `fleet spawn` (tmux): open the
// pane in `dir`, then type `<harness> [--model <id>] -n <name> '<prompt>'` into the shell so the
// user's PATH/profile apply. A spawn without a name gets a random word (lib/names.mjs) as both its
// tmux and its Claude session name.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODEL_ID_RE } from './config.mjs';
import { pickName, registryNames } from './names.mjs';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const PLAYER_RE = /^\p{L}[\p{L}\p{M} .'’-]{0,31}$/u;

/** POSIX single-quote shell escaping (same as the fleet CLI's `shq`). */
export function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

/**
 * Quote a string that gets *typed* into a shell. A raw newline inside '…' does not survive
 * being typed (zsh drops it), so multi-line text goes as ANSI-C `$'…'` with escapes instead.
 */
export function shqTyped(s) {
  const str = String(s);
  if (!/[\n\r\t]/.test(str)) return shq(str);
  const esc = str.replace(/[\\'\n\r\t]/g, (c) => ({ '\\': '\\\\', "'": "\\'", '\n': '\\n', '\r': '\\r', '\t': '\\t' })[c]);
  return `$'${esc}'`;
}

/** Sanitize a user-typed name into a tmux-safe session name (like `fleet tmux new`). */
export function sanitizeName(raw) {
  const cleaned = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned;
}

/**
 * The longest line we type inline. A fresh pane's shell may still be sourcing its profile,
 * so typed text can land in the tty's canonical-mode buffer, which macOS caps at 1024 bytes
 * (MAX_CANON) — the rest is dropped and the command never runs. Longer prompts go via a file.
 */
export const TYPED_LINE_MAX = 900;

/** The coding agents a spawn can start (`core::harness::Harness`). */
export const HARNESSES = ['claude', 'codex', 'pi'];
export const HARNESS_LABELS = { claude: 'Claude', codex: 'Codex', pi: 'pi' };

/** Build the shell line typed into the new pane (`promptFile`: read the prompt from there). */
export function launchCommand({ launcher = 'claude', harness = 'claude', name, prompt, model, promptFile }) {
  // The spawner always names the session (a random word when nobody typed one): `-n` makes it
  // a chosen name, which the title shows at once and auto-naming leaves alone.
  // Codex has no name flag: its tmux session carries the name, and Codex titles the thread.
  const parts = [launcher];
  if (model) parts.push('--model', shq(model));
  if (name && harness !== 'codex') parts.push('-n', shq(name));
  if (promptFile) parts.push(`"$(cat ${shq(promptFile)})"`);
  else if (prompt && prompt.trim()) parts.push(shqTyped(prompt));
  return parts.join(' ');
}

export function validateSpawnRequest(body, { spawnDirs = [] } = {}) {
  const errors = [];
  // No usable name → null: the spawner picks a free word (lib/names.mjs).
  const nameGiven = Boolean(body?.name && sanitizeName(body.name));
  const name = nameGiven ? sanitizeName(body.name) : null;
  if (nameGiven && !NAME_RE.test(name)) errors.push('name must be 1-40 chars of letters, digits, - or _');

  let dir = typeof body?.dir === 'string' && body.dir.trim() ? body.dir.trim() : spawnDirs[0];
  if (!dir) errors.push('dir is required');
  else if (!path.isAbsolute(dir)) errors.push('dir must be an absolute path');
  else dir = path.normalize(dir);

  let prompt = '';
  if (body?.prompt != null) {
    if (typeof body.prompt !== 'string') errors.push('prompt must be a string');
    else if (body.prompt.length > 8000) errors.push('prompt too long (max 8000 chars)');
    else prompt = body.prompt;
  }
  // Typed into a shell: a strict charset on top of the quoting. '' / absent = the harness's default.
  let model = '';
  if (body?.model != null && body.model !== '') {
    if (typeof body.model !== 'string' || !MODEL_ID_RE.test(body.model)) {
      errors.push('model must be 1-100 chars of letters, digits, . _ [ ] / : or -');
    } else model = body.model;
  }
  let harness = 'claude';
  if (body?.harness != null && body.harness !== '') {
    if (!HARNESSES.includes(body.harness)) errors.push(`harness must be one of ${HARNESSES.join(', ')}`);
    else harness = body.harness;
  }
  // `worktree: true`: start it in a new git worktree of `dir`'s repo (`fleet workspace new`).
  if (body?.worktree != null && typeof body.worktree !== 'boolean') errors.push('worktree must be a boolean');
  const worktree = body?.worktree === true;
  // `player`: a Madrid-palette spawn, named `<player> <n>` (lib/squad.mjs) unless a name was typed.
  let player = null;
  if (body?.player != null && body.player !== '') {
    if (typeof body.player !== 'string' || !PLAYER_RE.test(body.player.trim())) errors.push("player must be 1-32 letters, spaces, . ' or -");
    else player = body.player.trim();
  }
  if (errors.length) return { ok: false, error: errors.join('; ') };
  return { ok: true, name, dir, prompt, nameGiven, model, harness, worktree, player };
}

/** True when `child` is `root` or lies beneath it (both already resolved). */
export function isWithin(child, root) {
  const rel = path.relative(root, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve `dir` (realpath: follows symlinks, collapses `..`) and require it to be one of
 * `roots` (this host's spawnDirs; $HOME when none) or a subdirectory of one. Returns the
 * resolved path; throws `{ status: 400 }` otherwise, so a web client can't start Claude
 * anywhere on the machine.
 */
export async function resolveAllowedDir(dir, roots, { home = os.homedir() } = {}) {
  const list = roots?.length ? roots : [home];
  let real;
  try {
    real = await fs.realpath(dir);
  } catch {
    throw Object.assign(new Error(`dir does not exist: ${dir}`), { status: 400 });
  }
  const resolvedRoots = [];
  for (const r of list) {
    try {
      resolvedRoots.push(await fs.realpath(r));
    } catch {
      /* a configured root that doesn't exist on disk allows nothing */
    }
  }
  if (!resolvedRoots.some((r) => isWithin(real, r))) {
    throw Object.assign(
      new Error(`dir is not inside one of this host's spawn dirs (${list.join(', ')}): ${dir}`),
      { status: 400 },
    );
  }
  return real;
}

/**
 * `promptDir`: where prompts too long to type are written (like `fleet handoff` briefs,
 * they are kept — the record of what the session was started with).
 */
const SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', 'dash', 'ksh', 'tcsh', 'csh', 'nu']);

/** The last few non-empty lines of a pane, each capped, for an error message. */
export function paneTail(text, { lines = 4, width = 200 } = {}) {
  return String(text)
    .split('\n')
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-lines)
    .map((l) => (l.length > width ? `${l.slice(0, width)}…` : l))
    .join('\n');
}

export function createSpawner({
  run,
  tmux = 'tmux',
  launcher = 'claude',
  launchers = {},
  enterDelayMs = 400,
  sleep,
  promptDir = path.join(os.homedir(), '.claude', 'fleet-prompts'),
  claudeHome = path.join(os.homedir(), '.claude'),
  random = Math.random,
}) {
  const wait = sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));

  async function tmuxSessionNames() {
    try {
      const { stdout } = await run(tmux, ['list-sessions', '-F', '#{session_name}'], { timeout: 5000 });
      return String(stdout ?? '').split('\n').filter(Boolean);
    } catch {
      return []; // no tmux server yet
    }
  }

  /** A word no tmux session and no Claude session on this host is called yet. */
  async function freshName() {
    const [tmuxNames, claudeNames] = await Promise.all([tmuxSessionNames(), registryNames(claudeHome)]);
    return pickName([...tmuxNames, ...claudeNames], random);
  }

  async function tmuxHasSession(name) {
    try {
      await run(tmux, ['has-session', '-t', `=${name}`], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * `nameGiven: false` (or no `name`): pick a free word, used as the tmux and the Claude name.
   * `title`: the Claude name when it is not the tmux `name` (`Kovačić 27` / `kovacic-27`).
   * @returns {{ name, dir, tmuxSession, command, trusted, model, harness }}
   */
  async function spawn({ name, dir, prompt, nameGiven = true, model = '', harness = 'claude', title = null }) {
    let st;
    try {
      st = await fs.stat(dir);
    } catch {
      throw Object.assign(new Error(`dir does not exist: ${dir}`), { status: 400 });
    }
    if (!st.isDirectory()) throw Object.assign(new Error(`not a directory: ${dir}`), { status: 400 });
    if (!nameGiven || !name) name = await freshName();
    if (await tmuxHasSession(name)) {
      throw Object.assign(new Error(`tmux session "${name}" already exists`), { status: 409 });
    }
    await run(tmux, ['new-session', '-d', '-s', name, '-c', dir], { timeout: 8000 });
    const launch = { launcher: launchers[harness] || (harness === 'claude' ? launcher : harness), harness, name: title || name, prompt, model };
    let command = launchCommand(launch);
    if (Buffer.byteLength(command) > TYPED_LINE_MAX) {
      const d = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
      const promptFile = path.join(promptDir, `${stamp}-${name}.md`);
      await fs.mkdir(promptDir, { recursive: true, mode: 0o700 });
      await fs.writeFile(promptFile, prompt, { mode: 0o600 });
      command = launchCommand({ ...launch, promptFile });
    }
    // Give the login shell a moment to source its profile before typing into it.
    await wait(enterDelayMs);
    await run(tmux, ['send-keys', '-t', `${name}:`, '-l', '--', command], { timeout: 8000 });
    await wait(150);
    await run(tmux, ['send-keys', '-t', `${name}:`, 'Enter'], { timeout: 8000 });
    const trusted = await acceptTrustPrompt(name, { harness });
    if (!trusted) await ensureStarted(name, { harness });
    return { name: title || name, dir, tmuxSession: name, command, trusted, model: model || null, harness };
  }

  /**
   * A directory Claude has never run in stops at "Is this a project you trust?" with
   * "No, exit" preselected; `fleet list` does not show the session until that is answered.
   * The user picked the directory explicitly, so answer "Yes" (Down, Enter) for them.
   * Polls the pane for up to ~10s; returns true when the prompt was seen and accepted.
   */
  async function acceptTrustPrompt(name, { tries = 20, intervalMs = 500, settleMs = 1200, harness = 'claude' } = {}) {
    for (let i = 0; i < tries; i += 1) {
      await wait(intervalMs);
      let text = '';
      try {
        ({ stdout: text } = await run(tmux, ['capture-pane', '-p', '-t', `${name}:`], { timeout: 5000 }));
      } catch {
        return false; // pane gone
      }
      if (harness === 'codex') {
        // Codex: "Trust this folder?" with "› 1. Trust and continue" preselected → Enter.
        if (/Trust this folder\?/.test(text)) {
          await wait(settleMs);
          const { stdout: now } = await run(tmux, ['capture-pane', '-p', '-t', `${name}:`], { timeout: 5000 });
          if (!/›\s*1\.\s*Trust and continue/.test(now)) return false;
          await run(tmux, ['send-keys', '-t', `${name}:`, 'Enter'], { timeout: 5000 });
          return true;
        }
        if (/OpenAI Codex|Ask Codex|for shortcuts/.test(text)) return false; // Codex is up
        continue;
      }
      if (harness === 'pi') {
        if (/escape interrupt|ctrl\+c\/ctrl\+d|Pi can explain/i.test(text)) return false; // pi is up (no trust prompt)
        continue;
      }
      if (/trust this folder/i.test(text)) {
        // The dialog is drawn before Ink listens for keys: settle, move to "Yes",
        // and only press Enter once the pane shows "Yes" highlighted — an early
        // Enter would confirm the preselected "No, exit".
        await wait(settleMs);
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await run(tmux, ['send-keys', '-t', `${name}:`, 'Down'], { timeout: 5000 });
          await wait(400);
          const { stdout: after } = await run(tmux, ['capture-pane', '-p', '-t', `${name}:`], { timeout: 5000 });
          if (/[❯>]\s*Yes, I trust/i.test(after)) {
            await run(tmux, ['send-keys', '-t', `${name}:`, 'Enter'], { timeout: 5000 });
            return true;
          }
        }
        return false;
      }
      if (/^\s*[❯>]\s*$/m.test(text) || /bypass permissions|auto mode|shift\+tab/i.test(text)) return false; // Claude is up
    }
    return false;
  }

  /**
   * After the trust-prompt wait: if the pane is still (or again) just a shell, Claude never
   * started — a mangled launch line, `command not found`, a bad flag. Kill the leftover tmux
   * session and fail with the pane's last lines, so the caller sees why (and keeps the prompt).
   * Anything else in the foreground (Claude shows as its version, e.g. `2.1.285`) counts as started.
   */
  async function ensureStarted(name, { harness = 'claude' } = {}) {
    const who = HARNESS_LABELS[harness] ?? harness;
    let current = '';
    try {
      ({ stdout: current } = await run(tmux, ['display-message', '-p', '-t', `${name}:`, '#{pane_current_command}'], { timeout: 5000 }));
    } catch {
      throw Object.assign(new Error(`${who} did not start: tmux session "${name}" is gone`), { status: 502 });
    }
    if (!SHELLS.has(current.trim().replace(/^-/, ''))) return;
    let tail = '';
    try {
      const { stdout } = await run(tmux, ['capture-pane', '-p', '-J', '-t', `${name}:`], { timeout: 5000 });
      tail = paneTail(stdout);
    } catch {
      /* best effort */
    }
    await run(tmux, ['kill-session', '-t', `=${name}`], { timeout: 5000 }).catch(() => {});
    throw Object.assign(new Error(`${who} did not start${tail ? `:\n${tail}` : ''}`), { status: 502 });
  }

  return { spawn, freshName, tmuxHasSession, acceptTrustPrompt, ensureStarted };
}
