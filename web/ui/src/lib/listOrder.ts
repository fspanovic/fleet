// Manual row order of the session list (`fleet.listOrder`): the board's card order (groups.ts →
// stickyOrder / placeCard / cardDropBefore) applied to the flat list as one pseudo-column.

import type { FleetResponse, Session } from '@/api/types'
import { placeCard, stickyOrder, type CardOrders } from '@/lib/groups'
import { allSessions, byLastActivity, clusterByStack, stackClusterKey } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'

/** The list's entry in `fleet.listOrder` (the CardOrders shape of `fleet.cardOrder`, one pseudo-column). */
export const LIST_ORDER_ID = '__list__'

/** A dragged list row carries this type, so text, links or files dragged over the list are ignored. */
export const ROW_DRAG_TYPE = 'application/x-fleet-list'

/** Is the drag (its DataTransfer) a list row? */
export const isRowDrag = (dt: { types: ArrayLike<string> }) => Array.from(dt.types).includes(ROW_DRAG_TYPE)

/**
 * The list's rows (`listView` order) in the user's order once a row was dragged into place:
 * rows already in it keep their place (live status changes never reshuffle them), new ones are
 * appended as they came and remembered — like `stickyCards`. A stack's rows stay adjacent
 * (`clusterByStack`). Until the first drag (no entry) the rows come back unchanged.
 * Returns the rows and the orders to remember (the same object when nothing changed).
 */
export function stickyList(sessions: Session[], orders: CardOrders): { sessions: Session[]; orders: CardOrders } {
  const prev = orders[LIST_ORDER_ID]
  if (!prev) return { sessions, orders }
  const r = stickyOrder(sessions, prev)
  return { sessions: clusterByStack(r.sessions), orders: r.order === prev ? orders : { ...orders, [LIST_ORDER_ID]: r.order } }
}

/**
 * Every session's key in today's list order (no filters): the first arrangement starts from it,
 * so rows a filter hides keep their place relative to the rest.
 */
export function listSeed(fleet: FleetResponse | null | undefined): string[] {
  return clusterByStack(allSessions(fleet).sort(byLastActivity)).map(sessionKey)
}

/**
 * `orders` with row `key` placed just before row `before` (null: at the end). `shown` = the rows
 * as drawn, `seed` = where an order not made yet starts (`listSeed`). A row of a session stack
 * takes its stack's other shown rows along (the list keeps them adjacent), unless it is dropped
 * inside its own stack: then only the order within the stack changes.
 */
export function placeListRow(
  orders: CardOrders,
  seed: readonly string[],
  shown: readonly Session[],
  key: string,
  before: string | null,
): CardOrders {
  const stackOf = (k: string | null) => {
    const s = k == null ? undefined : shown.find((x) => sessionKey(x) === k)
    return s ? stackClusterKey(s) : null
  }
  const stack = stackOf(key)
  const block = stack && stackOf(before) !== stack ? shown.filter((s) => stackClusterKey(s) === stack).map(sessionKey) : [key]
  return block.reduce((o, k) => placeCard(o, LIST_ORDER_ID, seed, k, before), orders)
}
