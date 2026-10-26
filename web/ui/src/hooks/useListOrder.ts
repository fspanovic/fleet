import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

import type { FleetResponse, Session } from '@/api/types'
import { parseCardOrders, type CardOrders } from '@/lib/groups'
import { listSeed, placeListRow, stickyList } from '@/lib/listOrder'
import { storage } from '@/lib/storage'

const LIST_ORDER_KEY = 'fleet.listOrder'

// One store for every useSessionList (the desktop shell, Settings): a drag in one is never
// overwritten by another's stale copy.
let current: CardOrders | null = null
const listeners = new Set<() => void>()
const read = (): CardOrders => (current ??= parseCardOrders(storage.getJSON(LIST_ORDER_KEY)))
function write(next: CardOrders) {
  if (next === read()) return
  current = next
  storage.set(LIST_ORDER_KEY, JSON.stringify(next))
  for (const l of listeners) l()
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Drop row `key` just before row `before` (null: at the end); `shown` = the rows as drawn. */
export type MoveRow = (shown: Session[], key: string, before: string | null) => void

/**
 * The session list's rows (`listView` order) in the order the user dragged them into
 * (`fleet.listOrder`, stickyList): today's order until the first drag, then sticky — status
 * changes never reshuffle it, new sessions are appended. `moveRow` is that drag.
 */
export function useListOrder(sessions: Session[], fleet: FleetResponse | null): { sessions: Session[]; moveRow: MoveRow } {
  const orders = useSyncExternalStore(subscribe, read, read)
  const sticky = useMemo(() => stickyList(sessions, orders), [sessions, orders])
  useEffect(() => {
    // Remember appended rows (skip when the store moved on since this render: it re-renders).
    if (sticky.orders !== orders && orders === read()) write(sticky.orders)
  }, [sticky.orders, orders])
  const moveRow = useCallback<MoveRow>((shown, key, before) => write(placeListRow(read(), listSeed(fleet), shown, key, before)), [fleet])
  return { sessions: sticky.sessions, moveRow }
}
