// Switching a Claude Code session's model from Fleet: what the pane shows after `/model <alias>`.
// Claude Code 2.1.306 asks "Switch model?" when the conversation is cached for the current model
// (title "Switch model?", "This conversation is cached for the current model. Switching to <X> means the full
// history gets re-read on your next message.", then "❯ 1. Yes, switch to <X>" / "2. No, go back"; Enter picks
// the focused option). The same title also covers a PreModelSwitch hook's confirmation, and when usage is over
// the limit the focus starts on "No, go back" with no numbers — Fleet answers neither of those.

export type SwitchScreen =
  /** Claude switched (no question, or after the confirmation): its "Set model to …" line. */
  | { kind: 'switched'; label: string }
  /** The cache-miss "Switch model?" question, focus on "Yes, switch to <target>". */
  | { kind: 'confirm'; target: string }
  /** A dialog or answer Fleet must not act on (a hook's confirmation, a refusal, another dialog). */
  | { kind: 'other'; text: string }
  /** Nothing yet (the command has not landed / Claude is still drawing). */
  | { kind: 'none' }

const ECHO = /^\s*❯\s+\/model\s+(\S+)\s*$/
const TITLE = /^\s*Switch model\?\s*$/
const CACHE = /means the full history gets re-read/
const FOCUSED_YES = /^\s*❯\s*1\.\s*Yes, switch to (.+?)\s*$/
const SET = /Set model to (.+?)(?: and saved as your default for new sessions| for this session only|$)/
const REFUSED = /(Model switch (?:to .+ was blocked|blocked|failed)|Kept model as .+|uses usage credits.*|isn't available.*)/

/** The pane (`peek` text) below the last `❯ /model <alias>` echo, read for that switch. */
export function readSwitchScreen(pane: string, alias: string): SwitchScreen {
  const lines = pane.split('\n')
  let at = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(ECHO)
    if (m) {
      if (m[1] === alias) at = i
      break
    }
  }
  if (at < 0) return { kind: 'none' }
  const tail = lines.slice(at + 1)
  const title = tail.findIndex((l) => TITLE.test(l))
  if (title >= 0) {
    const body = tail.slice(title)
    const yes = body.map((l) => l.match(FOCUSED_YES)).find(Boolean)
    if (body.some((l) => CACHE.test(l)) && yes) return { kind: 'confirm', target: yes[1] }
    return { kind: 'other', text: 'Claude asks to confirm the switch in a way Fleet does not answer — check the terminal' }
  }
  for (const l of tail) {
    const set = l.match(SET)
    if (set) return { kind: 'switched', label: set[1].replace(/`/g, '').trim() }
    const refused = l.match(REFUSED)
    if (refused) return { kind: 'other', text: refused[1].replace(/`/g, '').trim() }
  }
  return { kind: 'none' }
}

/** Does a "Switch model?" target (`Opus 5.5`) belong to the alias's family (`opus`, `opus[1m]`)? */
export function targetMatches(target: string, alias: string): boolean {
  const family = alias.replace(/\[1m\]$/i, '').toLowerCase()
  return target.toLowerCase().startsWith(family)
}
