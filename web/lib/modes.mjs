// Claude Code's permission mode, read from its pane, and the two ways the web UI changes it:
// Shift+Tab until the status line shows the target (POST …/keys `until`), and a restart in place
// that resumes the same conversation with --dangerously-skip-permissions (POST …/kill `restart`).
// Pure helpers; api.mjs drives them with lib/backends.mjs and lib/kill.mjs.
import { shq } from './spawn.mjs';

/** Mode ids (Claude's `--permission-mode` names, `bypass` for bypassPermissions). */
export const MODE_IDS = ['manual', 'acceptEdits', 'plan', 'bypass', 'auto', 'dontAsk'];

/** What `until` may ask for: the two modes the UI switches between. */
export const MODE_TARGETS = ['bypass', 'auto'];

/**
 * The mode line under Claude's prompt box, e.g. `⏵⏵ bypass permissions on (shift+tab to cycle)`,
 * `⏸ plan mode on`, `⏸ manual mode on`, `⏵⏵ accept edits on`, `⏵⏵ auto mode on`. Only the last
 * lines of the pane are looked at, so the same words in the conversation above never count.
 */
const MODE_LINE_RE = /^\s*(?:⏵⏵|⏵|⏸)\s+(.+?)\s+on\b/;
const MODE_LINE_WINDOW = 12;

function modeId(label) {
  const l = label.toLowerCase();
  if (/bypass/.test(l)) return 'bypass';
  if (/^auto\b/.test(l)) return 'auto';
  if (/accept edits/.test(l)) return 'acceptEdits';
  if (/^plan\b/.test(l)) return 'plan';
  if (/don'?t ask/.test(l)) return 'dontAsk';
  if (/^(manual|default)\b/.test(l)) return 'manual';
  return l.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || null;
}

/**
 * The permission mode the pane shows: `{ id, label }` (`label` as Claude prints it, e.g.
 * "bypass permissions"), or null when no mode line is on screen (not Claude, a dialog covers it,
 * an older Claude whose default mode prints none).
 */
export function claudeMode(text) {
  const lines = String(text ?? '')
    .split('\n')
    .filter((l) => l.trim())
    .slice(-MODE_LINE_WINDOW);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const m = MODE_LINE_RE.exec(lines[i]);
    if (m) {
      const id = modeId(m[1]);
      if (id) return { id, label: m[1].trim() };
    }
  }
  return null;
}

/** Validate POST …/keys `until`: absent → null; else one of MODE_TARGETS, and only with `key: "BTab"`. */
export function validateUntil(body) {
  if (body?.until === undefined || body.until === null) return { ok: true, until: null };
  if (!MODE_TARGETS.includes(body.until)) return { ok: false, error: `until must be one of ${MODE_TARGETS.join(', ')}` };
  if (body.key !== 'BTab') return { ok: false, error: 'until needs key "BTab" (Shift+Tab cycles the permission mode)' };
  return { ok: true, until: body.until };
}

/** Claude's cycle has five modes; one more press brings it back to where it started. */
export const MAX_MODE_PRESSES = 6;

/**
 * Press Shift+Tab until the pane shows `target`, reading the pane after every press. Stops after
 * one full cycle (the starting mode again) or MAX_MODE_PRESSES, so a cycle without the target
 * leaves the session in the mode it started in.
 *
 * @param deps
 *   read   () => Promise<string>   the pane text
 *   press  () => Promise<void>     one Shift+Tab
 *   sleep  (ms) => Promise
 * @returns {{ result: 'already' | 'switched' | 'missing' | 'unreadable' | 'stuck', mode, from, presses, cycle }}
 *   `cycle`: the mode ids seen, in order, starting with the one it started in.
 */
export async function cycleToMode({ target, read, press, sleep, maxPresses = MAX_MODE_PRESSES, pollMs = 150, settleMs = 2500 }) {
  let current = claudeMode(await read());
  if (!current) return { result: 'unreadable', mode: null, from: null, presses: 0, cycle: [] };
  const from = current;
  const cycle = [current.id];
  if (current.id === target) return { result: 'already', mode: current, from, presses: 0, cycle };
  let presses = 0;
  while (presses < maxPresses) {
    await press();
    presses += 1;
    // Wait for the redraw: the mode line changes once Claude took the key.
    let next = null;
    for (let waited = 0; waited < settleMs; waited += pollMs) {
      await sleep(pollMs);
      next = claudeMode(await read());
      if (next && next.id !== current.id) break;
    }
    if (!next || next.id === current.id) return { result: 'stuck', mode: next ?? current, from, presses, cycle };
    current = next;
    cycle.push(current.id);
    if (current.id === target) return { result: 'switched', mode: current, from, presses, cycle };
    if (current.id === from.id) return { result: 'missing', mode: current, from, presses, cycle };
  }
  return { result: 'missing', mode: current, from, presses, cycle };
}

/** Flags of the running Claude command line a restart keeps (as `fleet restore` does, minus the permission ones). */
const KEEP_BOOL_FLAGS = new Set(['--chrome']);
const KEEP_VALUE_FLAGS = new Set(['--model', '--add-dir', '--agent', '--fallback-model']);
export const BYPASS_FLAG = '--dangerously-skip-permissions';
const VALUE_RE = /^[A-Za-z0-9._\[\]\/:~+=@,-]{1,200}$/;

/** The kept flags of a `ps -o args=` line, `--k=v` normalised to `--k v`; values with odd characters are dropped. */
export function keptFlags(args) {
  const argv = String(args ?? '').trim().split(/\s+/).filter(Boolean).slice(1);
  const out = [];
  for (let i = 0; i < argv.length; i += 1) {
    let flag = argv[i];
    let value = null;
    const eq = flag.indexOf('=');
    if (flag.startsWith('--') && eq > 0) {
      value = flag.slice(eq + 1);
      flag = flag.slice(0, eq);
    }
    if (KEEP_BOOL_FLAGS.has(flag) && value === null) out.push(flag);
    else if (KEEP_VALUE_FLAGS.has(flag)) {
      if (value === null) {
        value = argv[i + 1] ?? '';
        i += 1;
      }
      if (VALUE_RE.test(value)) out.push(flag, value);
    }
  }
  return out;
}

/**
 * The shell line typed into the pane to bring the conversation back in bypass mode:
 * `cd <cwd> && <launcher> [kept flags] --resume <id> --dangerously-skip-permissions [-n <name>]`.
 * Flags the launcher already carries are not repeated.
 */
export function resumeInBypassCommand({ launcher = 'claude', cwd, sessionId, name = null, args = '' }) {
  const have = new Set(String(launcher).split(/\s+/));
  const parts = [launcher];
  const kept = keptFlags(args);
  for (let i = 0; i < kept.length; i += 1) {
    const flag = kept[i];
    const takesValue = KEEP_VALUE_FLAGS.has(flag);
    const value = takesValue ? kept[(i += 1)] : null;
    if (have.has(flag) && flag !== '--add-dir') continue;
    parts.push(flag);
    if (value !== null) parts.push(shq(value));
  }
  parts.push('--resume', shq(sessionId));
  if (!have.has(BYPASS_FLAG)) parts.push(BYPASS_FLAG);
  if (name) parts.push('-n', shq(name));
  return `cd ${shq(cwd)} && ${parts.join(' ')}`;
}
