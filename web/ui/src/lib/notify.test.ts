import { describe, expect, test } from 'vitest'

import type { FleetResponse, Session } from '@/api/types'

import { isWatching, nativeNotifyLink, waitingAlert, waitingKeys, waitingTitlePrefix, waitingTransition } from './notify'

const s = (host: string, id: string, status: string, extra: Partial<Session> = {}): Session => ({ host, session_id: id, status, display_title: id, ...extra })
const fleet = (hosts: { name: string; ok?: boolean; sessions: Session[] }[]): FleetResponse =>
  ({ self: 'laptop', hosts: hosts.map((h) => ({ ok: true, ...h })) }) as unknown as FleetResponse

describe('waitingTransition', () => {
  test('the first fleet only sets the baseline: sessions already waiting never alert', () => {
    const t = waitingTransition(null, fleet([{ name: 'laptop', sessions: [s('laptop', 'a', 'waiting'), s('laptop', 'b', 'busy')] }]))
    expect(t.entered).toEqual([])
    expect([...t.keys]).toEqual(['laptop/a'])
  })

  test('a session that starts waiting alerts once, not on every poll', () => {
    const f1 = fleet([{ name: 'laptop', sessions: [s('laptop', 'a', 'busy')] }])
    const f2 = fleet([{ name: 'laptop', sessions: [s('laptop', 'a', 'waiting', { waiting_for: 'permission' })] }])
    const t0 = waitingTransition(null, f1)
    const t1 = waitingTransition(t0.keys, f2)
    expect(t1.entered.map((x) => x.session_id)).toEqual(['a'])
    const t2 = waitingTransition(t1.keys, f2)
    expect(t2.entered).toEqual([])
  })

  test('it alerts again only after leaving waiting', () => {
    const busy = fleet([{ name: 'laptop', sessions: [s('laptop', 'a', 'busy')] }])
    const waiting = fleet([{ name: 'laptop', sessions: [s('laptop', 'a', 'waiting')] }])
    let k = waitingTransition(null, busy).keys
    const steps = [waiting, waiting, busy, waiting].map((f) => {
      const t = waitingTransition(k, f)
      k = t.keys
      return t.entered.length
    })
    expect(steps).toEqual([1, 0, 0, 1])
  })

  test('a new session that registers already waiting alerts', () => {
    const t0 = waitingTransition(null, fleet([{ name: 'laptop', sessions: [] }]))
    const t1 = waitingTransition(t0.keys, fleet([{ name: 'laptop', sessions: [s('laptop', 'n', 'waiting')] }]))
    expect(t1.entered.map((x) => x.session_id)).toEqual(['n'])
  })

  test('a host that stops answering keeps its waiting sessions: no alert when it comes back', () => {
    const up = fleet([
      { name: 'laptop', sessions: [] },
      { name: 'workstation', sessions: [s('workstation', 'w', 'waiting')] },
    ])
    const down = fleet([
      { name: 'laptop', sessions: [] },
      { name: 'workstation', ok: false, sessions: [] },
    ])
    const t0 = waitingTransition(null, up)
    const t1 = waitingTransition(t0.keys, down)
    expect(t1.entered).toEqual([])
    expect(t1.keys.has('workstation/w')).toBe(true)
    expect(waitingTransition(t1.keys, up).entered).toEqual([])
  })

  test('shell / unknown statuses are not waiting; voice operators are left out', () => {
    const f = fleet([{ name: 'laptop', sessions: [s('laptop', 'a', 'shell'), s('laptop', 'b', 'unknown'), s('laptop', 'op', 'waiting', { operator: true } as Partial<Session>)] }])
    expect([...waitingKeys(f)]).toEqual([])
  })
})

describe('isWatching', () => {
  const a = { host: 'laptop', session_id: 'abc' }
  test('only the open session in a focused, visible page', () => {
    expect(isWatching(a, { hash: '#/s/laptop/abc', focused: true, visible: true })).toBe(true)
    expect(isWatching(a, { hash: '#/s/laptop/abc', focused: false, visible: true })).toBe(false)
    expect(isWatching(a, { hash: '#/s/laptop/abc', focused: true, visible: false })).toBe(false)
    expect(isWatching(a, { hash: '#/s/laptop/other', focused: true, visible: true })).toBe(false)
    expect(isWatching(a, { hash: '#/today', focused: true, visible: true })).toBe(false)
  })
})

describe('waitingAlert', () => {
  test('name + needs you, what it waits for, its route', () => {
    const a = waitingAlert(s('workstation', 'id 1', 'waiting', { display_title: 'lapwing', waiting_for: ' permission ' }))
    expect(a).toEqual({ title: 'lapwing needs you', body: 'permission', path: '/s/workstation/id%201', tag: 'fleet-waiting:workstation/id 1' })
  })
  test('no reason: the host', () => {
    expect(waitingAlert(s('laptop', 'x', 'waiting', { display_title: 'bracken' })).body).toBe('waiting on you · laptop')
  })
  test('the Fleet.app link carries title, body and path', () => {
    const link = nativeNotifyLink({ title: 'a & b needs you', body: 'permission', path: '/s/h/1', tag: 't' })
    const u = new URL(link)
    expect(u.protocol).toBe('fleet:')
    expect(u.host).toBe('notify')
    expect(Object.fromEntries(u.searchParams)).toEqual({ title: 'a & b needs you', body: 'permission', path: '/s/h/1' })
  })
})

test('waitingTitlePrefix', () => {
  expect(waitingTitlePrefix(0)).toBe('')
  expect(waitingTitlePrefix(3)).toBe('(3) ')
})
