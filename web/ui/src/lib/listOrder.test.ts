import { describe, expect, test } from 'vitest'

import type { FleetResponse, Session } from '@/api/types'
import { CARD_ORDER_MAX, type CardOrders } from './groups'
import { LIST_ORDER_ID, isRowDrag, listSeed, placeListRow, stickyList } from './listOrder'

const s = (id: string, over: Partial<Session> = {}): Session => ({ host: 'laptop', session_id: id, status: 'idle', ...over })
const ids = (rows: Session[]) => rows.map((x) => x.session_id)
const k = (id: string) => `laptop/${id}`
const st = { id: 'st-1', label: 'Login fix' }

describe('stickyList', () => {
  const [a, b, c] = [s('a'), s('b'), s('c')]

  test('no order yet: the rows and the orders come back as they are', () => {
    const rows = [a, b, c]
    const orders: CardOrders = { other: ['x'] }
    const r = stickyList(rows, orders)
    expect(r.sessions).toBe(rows)
    expect(r.orders).toBe(orders)
  })

  test('the user order wins over the activity order; status changes never reshuffle it', () => {
    const orders = { [LIST_ORDER_ID]: [k('c'), k('a'), k('b')] }
    const r = stickyList([s('b', { status: 'waiting' }), a, c], orders)
    expect(ids(r.sessions)).toEqual(['c', 'a', 'b'])
    expect(r.orders).toBe(orders)
  })

  test('new sessions are appended (as they came) and remembered; absent ones keep their slot', () => {
    const orders = { [LIST_ORDER_ID]: [k('b'), k('a')], other: ['x'] }
    const r = stickyList([s('new2'), s('new1'), a], orders)
    expect(ids(r.sessions)).toEqual(['a', 'new2', 'new1'])
    expect(r.orders).toEqual({ [LIST_ORDER_ID]: [k('b'), k('a'), k('new2'), k('new1')], other: ['x'] })
    // b comes back to its slot.
    expect(ids(stickyList([s('new1'), b, a, s('new2')], r.orders).sessions)).toEqual(['b', 'a', 'new2', 'new1'])
    expect(stickyList([a, s('new1'), s('new2')], r.orders).orders).toBe(r.orders)
  })

  test('a stack stays adjacent: it moves up to its first member', () => {
    const orders = { [LIST_ORDER_ID]: [k('m1'), k('a'), k('m2'), k('b')] }
    const r = stickyList([s('a'), s('b'), s('m1', { stack: st }), s('m2', { stack: st })], orders)
    expect(ids(r.sessions)).toEqual(['m1', 'm2', 'a', 'b'])
  })

  test('the order is capped: absent keys are forgotten first', () => {
    const prev = Array.from({ length: CARD_ORDER_MAX }, (_, i) => k(`old${i}`))
    const r = stickyList([s('old50'), s('new')], { [LIST_ORDER_ID]: prev })
    expect(r.orders[LIST_ORDER_ID]).toHaveLength(CARD_ORDER_MAX)
    expect(r.orders[LIST_ORDER_ID][0]).toBe(k('old1'))
    expect(r.orders[LIST_ORDER_ID].at(-1)).toBe(k('new'))
  })
})

describe('placeListRow', () => {
  test('the first drag starts from the seed, so rows a filter hides keep their place', () => {
    const shown = [s('a'), s('c')]
    const r = placeListRow({}, [k('a'), k('b'), k('c'), k('d')], shown, k('c'), k('a'))
    expect(r[LIST_ORDER_ID]).toEqual([k('c'), k('a'), k('b'), k('d')])
  })

  test('before a row or at the end; other entries are kept', () => {
    const orders = { [LIST_ORDER_ID]: [k('a'), k('b'), k('c')], other: ['x'] }
    const shown = [s('a'), s('b'), s('c')]
    expect(placeListRow(orders, [], shown, k('a'), null)).toEqual({ [LIST_ORDER_ID]: [k('b'), k('c'), k('a')], other: ['x'] })
    expect(placeListRow(orders, [], shown, k('c'), k('b'))[LIST_ORDER_ID]).toEqual([k('a'), k('c'), k('b')])
  })

  test('a stack row takes its shown stack along, in order', () => {
    const shown = [s('a'), s('m1', { stack: st }), s('m2', { stack: st }), s('b')]
    const orders = { [LIST_ORDER_ID]: shown.map((x) => k(x.session_id)) }
    expect(placeListRow(orders, [], shown, k('m2'), k('a'))[LIST_ORDER_ID]).toEqual([k('m1'), k('m2'), k('a'), k('b')])
    expect(placeListRow(orders, [], shown, k('m1'), null)[LIST_ORDER_ID]).toEqual([k('a'), k('b'), k('m1'), k('m2')])
  })

  test('dropped inside its own stack: only the order within the stack changes', () => {
    const shown = [s('a'), s('m1', { stack: st }), s('m2', { stack: st }), s('b')]
    const orders = { [LIST_ORDER_ID]: shown.map((x) => k(x.session_id)) }
    const r = placeListRow(orders, [], shown, k('m2'), k('m1'))
    expect(r[LIST_ORDER_ID]).toEqual([k('a'), k('m2'), k('m1'), k('b')])
    expect(ids(stickyList(shown, r).sessions)).toEqual(['a', 'm2', 'm1', 'b'])
  })
})

test('listSeed: every session, most recent first, stacks adjacent', () => {
  const fleet: FleetResponse = {
    self: 'laptop',
    hosts: [
      {
        name: 'laptop',
        ok: true,
        sessions: [s('old', { updated_at: 1 }), s('m1', { updated_at: 5, stack: st }), s('new', { updated_at: 9 }), s('m2', { updated_at: 2, stack: st })],
      },
    ],
  }
  expect(listSeed(fleet)).toEqual([k('new'), k('m1'), k('m2'), k('old')])
  expect(listSeed(null)).toEqual([])
})

test('isRowDrag: only a list row, not text, links or files', () => {
  expect(isRowDrag({ types: ['application/x-fleet-list'] })).toBe(true)
  expect(isRowDrag({ types: ['text/plain', 'Files'] })).toBe(false)
  expect(isRowDrag({ types: ['application/x-fleet-board'] })).toBe(false)
})
