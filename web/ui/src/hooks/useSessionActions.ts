// The session context menu (right-click on a row / card), the Delete dialog and the Link task picker are app-wide
// overlays (mounted once by components/SessionActions.tsx), opened through this module store
// like hooks/useStackUi.ts.
import { useSyncExternalStore, type MouseEvent } from 'react'

import type { Session } from '@/api/types'
import type { TitleScope } from '@/hooks/useTitles'

export interface SessionMenu {
  session: Session
  scope: TitleScope
  x: number
  y: number
}

interface State {
  menu: SessionMenu | null
  deleting: Session | null
  /** The session whose "Link task…" picker is open. */
  linking: Session | null
}

let state: State = { menu: null, deleting: null, linking: null }
const listeners = new Set<() => void>()

function update(next: Partial<State>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}

export function openSessionMenu(menu: SessionMenu) {
  update({ menu })
}

export function closeSessionMenu() {
  if (state.menu) update({ menu: null })
}

export function openDeleteDialog(session: Session) {
  update({ menu: null, deleting: session })
}

export function closeDeleteDialog() {
  if (state.deleting) update({ deleting: null })
}

export function openTaskPicker(session: Session) {
  update({ menu: null, linking: session })
}

export function closeTaskPicker() {
  if (state.linking) update({ linking: null })
}

export function useSessionActions(): State {
  return useSyncExternalStore(subscribe, () => state)
}

/** Right-click (two-finger click) on a row / card: the session menu at the pointer. A touch long-press stays the row's own. */
export function sessionMenuHandler(session: Session, scope: TitleScope, longPress?: (e: MouseEvent) => void) {
  return (e: MouseEvent) => {
    longPress?.(e)
    if (e.defaultPrevented) return
    e.preventDefault()
    openSessionMenu({ session, scope, x: e.clientX, y: e.clientY })
  }
}
