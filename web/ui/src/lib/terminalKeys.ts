// Operating a terminal UI from Fleet: Claude Code's own dialogs (`/mcp`, `/model`, `/config`,
// `/resume`, `/plugin`, `/permissions`, `/hooks`…), permission prompts, Codex approvals. Pure
// helpers, unit-tested in terminalKeys.test.ts; components/session/TerminalDialog.tsx is the view.
import { ApiError } from '@/api/client'
import type { Message, ModeSwitchResponse, ModeTarget, PermissionMode, SessionKey } from '@/api/types'
import { pendingQuestion } from '@/lib/questions'

/** Claude Code's registry `waitingFor` while one of its interactive dialogs is open. */
export const DIALOG_OPEN = 'dialog open'

/** One of Claude's own dialogs is open: a typed message would go into it (the server holds it, 409). */
export function isDialogOpen(status: string | null | undefined, waitingFor: string | null | undefined): boolean {
  return status === 'waiting' && (waitingFor ?? '').trim() === DIALOG_OPEN
}

/**
 * Should the session screen show the live terminal + keys? The session waits on something the
 * transcript cannot show (a dialog, a permission prompt) — not on an AskUserQuestion, which the
 * chat answers with its own card.
 */
export function needsTerminal(status: string | null | undefined, messages: Message[] | null | undefined): boolean {
  return status === 'waiting' && pendingQuestion(messages) == null
}

/** The send was held because a dialog is open (POST …/send → 409 `held: "dialog"`). */
export function isDialogHeld(err: unknown): boolean {
  return err instanceof ApiError && err.status === 409 && (err.data as { held?: unknown } | null)?.held === 'dialog'
}

/** Key buttons, in the order Claude's dialog footers name them. */
export const TERMINAL_KEYS: { key: SessionKey; label: string; title: string }[] = [
  { key: 'Escape', label: 'Esc', title: 'Escape: back / close the dialog' },
  { key: 'Up', label: '↑', title: 'Up' },
  { key: 'Down', label: '↓', title: 'Down' },
  { key: 'Left', label: '←', title: 'Left' },
  { key: 'Right', label: '→', title: 'Right' },
  { key: 'Tab', label: 'Tab', title: 'Tab' },
  { key: 'BTab', label: '⇧Tab', title: 'Shift+Tab' },
  { key: 'Space', label: 'Space', title: 'Space: toggle' },
  { key: 'BSpace', label: '⌫', title: 'Backspace' },
  { key: 'Enter', label: 'Enter ↵', title: 'Enter: select / confirm' },
]

export type TerminalInput = { key: SessionKey } | { text: string }

const EVENT_KEYS: Record<string, SessionKey> = {
  Escape: 'Escape',
  Enter: 'Enter',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Backspace: 'BSpace',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ' ': 'Space',
}

/**
 * What a keystroke in the focused terminal panel sends: a key, a printable character to type,
 * or null (leave it to the app: ⌘/Ctrl/Alt shortcuts, IME composition, function keys).
 */
export function inputFromKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey' | 'isComposing'>): TerminalInput | null {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return null
  if (e.key === 'Tab') return { key: e.shiftKey ? 'BTab' : 'Tab' }
  const key = EVENT_KEYS[e.key]
  if (key) return { key }
  const chars = [...e.key]
  if (chars.length === 1) {
    const code = chars[0].codePointAt(0) ?? 0
    if (code >= 0x20 && code !== 0x7f) return { text: e.key }
  }
  return null
}

/** Queue for the terminal: consecutive characters go out as one `type` call; order is kept. */
export function pushInput(queue: TerminalInput[], input: TerminalInput, maxText = 200): TerminalInput[] {
  const last = queue[queue.length - 1]
  if ('text' in input && last && 'text' in last && last.text.length + input.text.length <= maxText) {
    return [...queue.slice(0, -1), { text: last.text + input.text }]
  }
  return [...queue, input]
}

// --- Claude's permission mode (the Details "Permissions" row) -------------------------------

/** Short names for Claude's permission modes (status line ids from the server). */
const MODE_NAMES: Record<string, string> = {
  bypass: 'Bypass permissions',
  auto: 'Auto mode',
  manual: 'Manual',
  acceptEdits: 'Accept edits',
  plan: 'Plan mode',
  dontAsk: "Don't ask",
}

/** "Bypass permissions", "Auto mode"…; Claude's own label for a mode fleet does not know; null when unknown. */
export function modeName(mode: PermissionMode | null | undefined): string | null {
  if (!mode) return null
  return MODE_NAMES[mode.id] ?? mode.label.replace(/^./, (c) => c.toUpperCase())
}

/** Where the switch goes: out of bypass to auto, from anything else to bypass. */
export function switchTarget(mode: PermissionMode | null | undefined): ModeTarget {
  return mode?.id === 'bypass' ? 'auto' : 'bypass'
}

/** The switch button's label for that target. */
export function switchLabel(target: ModeTarget): string {
  return target === 'bypass' ? 'Switch to bypass' : 'Switch to auto'
}

/** Can this session's mode be switched from Fleet: a live Claude Code session in a terminal fleet drives. */
export function canSwitchMode(s: { harness?: string | null; backend?: string | null } | null | undefined): boolean {
  if (!s) return false
  return (s.harness ?? 'claude') === 'claude' && (s.backend === 'tmux' || s.backend === 'iterm')
}

/** Only a tmux pane can be restarted in place. */
export function canRestartInPlace(s: { backend?: string | null } | null | undefined): boolean {
  return s?.backend === 'tmux'
}

type ModeBody = { held?: unknown; unavailable?: unknown; restart?: unknown; cycle?: unknown }
const bodyOf = (err: unknown): ModeBody | null => (err instanceof ApiError && err.status === 409 ? ((err.data as ModeBody | null) ?? null) : null)

/** The switch was refused because bypass is not in the session's Shift+Tab cycle: offer "Restart in bypass". */
export function bypassUnavailable(err: unknown): boolean {
  const b = bodyOf(err)
  return b?.unavailable === 'bypass' && b.restart === true
}

/** Refused because the session waits on a prompt or question (nothing pressed). */
export function modeHeld(err: unknown): boolean {
  return bodyOf(err)?.held === 'waiting'
}

/** Toast copy for a successful switch. */
export function modeSwitchToast(res: Pick<ModeSwitchResponse, 'mode' | 'already' | 'presses'>): string {
  const name = modeName(res.mode) ?? 'the mode'
  if (res.already) return `Already in ${name.toLowerCase()}`
  return `${name} on (${res.presses} × ⇧Tab)`
}
