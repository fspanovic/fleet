// Workspaces in the UI: a session started in a new git worktree fleet made for it (`fleet spawn
// --worktree`, New session → New worktree; docs/architecture.md → Workspaces). Pure helpers.
import type { Session } from '@/api/types'

/** localStorage key: the New session form's last "New worktree" choice (per browser). */
export const WORKTREE_KEY = 'fleet.spawnWorktree'

/** The stored choice → on/off (anything but '1' is off: a plain spawn is the default). */
export function worktreeChoice(stored: string | null | undefined): boolean {
  return stored === '1'
}

/** The workspace label of a row: its handle, or null when it runs in no fleet-made worktree. */
export function workspaceHandle(s: Pick<Session, 'workspace'>): string | null {
  const h = s.workspace?.handle
  return typeof h === 'string' && h.trim() ? h : null
}

/** The chip's tooltip: "Worktree kelpie · branch someone/fix-login · from origin/main". */
export function workspaceTooltip(s: Pick<Session, 'workspace'>): string {
  const w = s.workspace
  if (!w) return ''
  return [`Worktree ${w.handle}`, w.branch ? `branch ${w.branch}` : '', w.base ? `from ${w.base}` : ''].filter(Boolean).join(' · ')
}
