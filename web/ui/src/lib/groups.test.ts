import { describe, expect, test } from 'vitest'

import type { GroupsResponse, Session, SessionGroup } from '@/api/types'
import {
  BOARD_ORDER_MAX,
  CARD_COLUMNS_MAX,
  CARD_ORDER_MAX,
  applyGroupEdit,
  cardDropBefore,
  parseCardOrders,
  placeCard,
  stickyCards,
  memberId,
  reorderColumns,
  UNGROUPED_ID,
  type BoardColumn,
  boardColumns,
  boardOrder,
  effectiveGroups,
  fallbackGroups,
  groupsStatusText,
  canMoveOutOf,
  isGroupColumn,
  listSections,
  listSectionsOrder,
  parseIdList,
  parseViewMode,
  regroupToast,
  repoOf,
  sectionDrop,
  statusSummary,
  stickyColumns,
  withStackColumns,
} from './groups'

const s = (over: Partial<Session>): Session => ({ host: 'laptop', session_id: 'id', status: 'idle', ...over })
const g = (id: string, members: [string, string][], over: Partial<SessionGroup> = {}): SessionGroup => ({
  id,
  label: id,
  description: null,
  source: 'llm',
  members: members.map(([host, id]) => ({ host, id })),
  ...over,
})
const resp = (over: Partial<GroupsResponse>): GroupsResponse => ({
  enabled: true,
  host: 'laptop',
  intervalMinutes: 10,
  running: false,
  updatedAt: null,
  lastRun: null,
  groups: [],
  ...over,
})

describe('repoOf', () => {
  test('basename of the cwd', () => {
    expect(repoOf('~/Code/project')).toEqual({ id: 'repo:~/Code/project', label: 'project' })
    expect(repoOf('/srv/app/')).toEqual({ id: 'repo:/srv/app', label: 'app' })
  })
  test('worktrees group under their repo', () => {
    for (const cwd of ['~/Code/project/.worktrees/fix-a', '~/Code/project/worktrees/b/sub', '~/Code/project/.claude/worktrees/c'])
      expect(repoOf(cwd)?.id).toBe('repo:~/Code/project')
  })
  test('nothing for an empty cwd', () => {
    expect(repoOf(null)).toBeNull()
    expect(repoOf('  ')).toBeNull()
  })
})

test('fallbackGroups: one group per repo, across hosts', () => {
  const groups = fallbackGroups([
    s({ session_id: 'a', cwd: '~/Code/project' }),
    s({ session_id: 'b', host: 'workstation', cwd: '~/Code/project/.worktrees/x' }),
    s({ session_id: 'c', cwd: '~/Code/other' }),
    s({ session_id: 'd', cwd: null }),
  ])
  expect(groups.map((x) => [x.label, x.source, x.members.length])).toEqual([
    ['project', 'fallback', 2],
    ['other', 'fallback', 1],
  ])
})

test('effectiveGroups: server groups when enabled, else the fallback', () => {
  const sessions = [s({ session_id: 'a', cwd: '~/Code/project' })]
  expect(effectiveGroups(resp({ groups: [g('g1', [])] }), sessions)).toEqual({ groups: [g('g1', [])], fallback: false, defaultGroup: null })
  expect(effectiveGroups(resp({ groups: [g('g1', [])], defaultGroup: 'g1' }), sessions).defaultGroup).toBe('g1')
  expect(effectiveGroups(resp({ enabled: false, defaultGroup: 'g1' }), sessions)).toMatchObject({ fallback: true, defaultGroup: null })
  expect(effectiveGroups(null, sessions).groups[0].label).toBe('project')
})

describe('boardColumns', () => {
  const sessions = [
    s({ session_id: 'a', status: 'idle', updated_at: 1 }),
    s({ session_id: 'b', status: 'busy', updated_at: 2 }),
    s({ session_id: 'c', status: 'waiting', updated_at: 3 }),
    s({ session_id: 'd', host: 'workstation', status: 'idle', updated_at: 5 }),
    s({ session_id: 'e', status: 'idle', updated_at: 4 }),
  ]

  test('joins, drops dead members and empty groups, puts the rest in Ungrouped (last)', () => {
    const cols = boardColumns(sessions, [
      g('quiet', [['laptop', 'a'], ['laptop', 'gone']]),
      g('empty', [['laptop', 'gone2']]),
      g('hot', [['laptop', 'b'], ['laptop', 'c'], ['workstation', 'd']]),
    ])
    expect(cols.map((c) => c.id)).toEqual(['hot', 'quiet', UNGROUPED_ID])
    expect(cols[0].sessions.map((x) => x.session_id)).toEqual(['c', 'd', 'b']) // waiting first, then recency
    expect(cols[0].summary).toEqual({ waiting: 1, busy: 1, idle: 1, unknown: 0 })
    expect(cols[2]).toMatchObject({ label: 'Ungrouped', ungrouped: true })
    expect(cols[2].sessions.map((x) => x.session_id)).toEqual(['e'])
  })

  test('with a default group, sessions no group claims are in its column (no Ungrouped), marked; it shows when empty', () => {
    const cols = boardColumns(
      sessions,
      [g('hot', [['laptop', 'b'], ['laptop', 'c']]), g('inbox', [], { source: 'manual' }), g('quiet', [['laptop', 'a']])],
      undefined,
      'inbox',
    )
    expect(cols.map((c) => [c.id, c.sessions.map((x) => x.session_id), c.isDefault ?? false])).toEqual([
      ['hot', ['c', 'b'], false],
      ['inbox', ['d', 'e'], true],
      ['quiet', ['a'], false],
    ])
    // An empty model group made default still shows (a drop target); a default id that is gone is no default.
    const empty = boardColumns([sessions[0]], [g('quiet', [['laptop', 'a']]), g('llm-default', [])], undefined, 'llm-default')
    expect(empty.map((c) => [c.id, c.isDefault ?? false])).toEqual([
      ['quiet', false],
      ['llm-default', true],
    ])
    const gone = boardColumns(sessions, [g('quiet', [['laptop', 'a']])], undefined, 'nope')
    expect(gone.map((c) => c.id)).toEqual(['quiet', UNGROUPED_ID])
  })

  test('a session claimed twice lands in the first group only', () => {
    const cols = boardColumns([sessions[0]], [g('one', [['laptop', 'a']]), g('two', [['laptop', 'a']])])
    expect(cols.map((c) => c.id)).toEqual(['one'])
  })

  test('members match by host too, and by pid when that is the id', () => {
    const cols = boardColumns(
      [s({ session_id: 'x', pid: 42 }), s({ session_id: 'y', host: 'workstation' })],
      [g('pid', [['laptop', '42']]), g('wrong-host', [['laptop', 'y']])],
    )
    expect(cols.map((c) => [c.id, c.sessions.map((x) => x.session_id)])).toEqual([
      ['pid', ['x']],
      [UNGROUPED_ID, ['y']],
    ])
  })

  test('ordering: waiting > busy > size > label', () => {
    const cols = boardColumns(
      [
        s({ session_id: 'a' }),
        s({ session_id: 'b' }),
        s({ session_id: 'c' }),
        s({ session_id: 'd', status: 'busy' }),
        s({ session_id: 'e', status: 'waiting' }),
        s({ session_id: 'f' }),
      ],
      [g('big', [['laptop', 'a'], ['laptop', 'b']]), g('busy', [['laptop', 'd']]), g('beta', [['laptop', 'c']]), g('alpha', [['laptop', 'f']]), g('wait', [['laptop', 'e']])],
    )
    expect(cols.map((c) => c.id)).toEqual(['wait', 'busy', 'big', 'alpha', 'beta'])
    expect(boardOrder(cols).map((x) => x.session_id)).toEqual(['e', 'd', 'a', 'b', 'f', 'c'])
  })

  test('filtered-out sessions simply do not appear', () => {
    expect(boardColumns([], [g('g', [['laptop', 'a']])])).toEqual([])
  })

  test('dormant members: dimmed cards after the live ones; a dormant-only group stays; live wins; claimed once', () => {
    const dormantOf = (m: { host: string; id: string; dormant?: boolean }) =>
      m.dormant || m.id.startsWith('z') ? { host: m.host, id: m.id, title: `T ${m.id}`, since: null } : null
    const cols = boardColumns(
      [sessions[0]],
      [
        g('mixed', [['laptop', 'a'], ['laptop', 'z1'], ['laptop', 'gone']]),
        g('asleep', [['laptop', 'z2'], ['laptop', 'z1']]),
        { ...g('flagged', []), members: [{ host: 'laptop', id: 'q', dormant: true }] },
        g('dead', [['laptop', 'gone']]),
      ],
      dormantOf,
    )
    expect(cols.map((c) => [c.id, c.sessions.map((x) => x.session_id), (c.dormant ?? []).map((d) => d.id)])).toEqual([
      ['mixed', ['a'], ['z1']],
      ['asleep', [], ['z2']],
      ['flagged', [], ['q']],
    ])
    expect(withStackColumns(cols, [sessions[0]]).map((c) => c.id)).toEqual(['mixed', 'asleep', 'flagged'])
  })
})

test('statusSummary counts unknown statuses as unknown', () => {
  expect(statusSummary([s({ status: 'weird' }), s({ status: 'busy' })])).toEqual({ waiting: 0, busy: 1, idle: 0, unknown: 1 })
})

test('statusSummary counts shell (idle with a background task running) as idle', () => {
  expect(statusSummary([s({ status: 'shell' }), s({ status: 'idle' })])).toEqual({ waiting: 0, busy: 0, idle: 2, unknown: 0 })
})

describe('groupsStatusText', () => {
  const now = 1_000_000
  test('disabled / missing → fallback', () => {
    expect(groupsStatusText(null, now)).toBe('fallback: by repo')
    expect(groupsStatusText(resp({ enabled: false }), now)).toBe('fallback: by repo')
  })
  test('running, never run, ok, failed', () => {
    expect(groupsStatusText(resp({ running: true }), now)).toBe('grouping…')
    expect(groupsStatusText(resp({}), now)).toBe('not grouped yet')
    expect(groupsStatusText(resp({ lastRun: { at: now - 180_000, ms: 1, ok: true, mode: 'incremental', modelCalls: 1 } }), now)).toBe(
      'grouped 3m ago · 1 model call',
    )
    expect(groupsStatusText(resp({ lastRun: { at: now - 60_000, ms: 1, ok: true, mode: 'noop', modelCalls: 0 } }), now)).toBe(
      'grouped 1m ago · 0 model calls',
    )
    expect(groupsStatusText(resp({ lastRun: { at: now - 60_000, ms: 1, ok: true, mode: 'fallback' } }), now)).toBe('grouped 1m ago · fallback')
    expect(groupsStatusText(resp({ lastRun: { at: now - 120_000, ms: 1, ok: false, error: 'x' } }), now)).toBe('grouping failed 2m ago')
  })
})

test('regroupToast', () => {
  expect(regroupToast(resp({ lastRun: { at: 1, ms: 1, ok: false, error: 'claude missing' } }))).toBe('Grouping failed: claude missing')
  expect(regroupToast(resp({ groups: [g('a', [])], lastRun: { at: 1, ms: 1, ok: true, mode: 'noop', modelCalls: 0 } }))).toBe(
    'No changes · 1 group',
  )
  expect(
    regroupToast(resp({ groups: [g('a', []), g('b', [])], lastRun: { at: 1, ms: 1, ok: true, mode: 'incremental', modelCalls: 2, classified: 3 } })),
  ).toBe('Grouped 3 sessions into 2 groups · 2 model calls')
})

test('parseIdList / parseViewMode', () => {
  expect(parseIdList(['a', 1, 'b'])).toEqual(['a', 'b'])
  expect(parseIdList('nope')).toEqual([])
  expect(parseViewMode('board')).toBe('board')
  expect(parseViewMode('grid')).toBeUndefined()
})

describe('stickyColumns', () => {
  const col = (id: string, over: Partial<BoardColumn> = {}): BoardColumn => ({
    id,
    label: id,
    description: null,
    source: 'llm',
    ungrouped: id === UNGROUPED_ID,
    sessions: [],
    summary: { waiting: 0, busy: 0, idle: 0, unknown: 0 },
    ...over,
  })
  const ids = (cols: BoardColumn[]) => cols.map((c) => c.id)

  test('first run keeps the incoming order and remembers it (Ungrouped not remembered, always last)', () => {
    const r = stickyColumns([col('b'), col('a'), col(UNGROUPED_ID)], [])
    expect(ids(r.columns)).toEqual(['b', 'a', UNGROUPED_ID])
    expect(r.order).toEqual(['b', 'a'])
  })

  test('known columns keep their place when the incoming order changes; new ones are appended', () => {
    const r = stickyColumns([col(UNGROUPED_ID), col('new'), col('a'), col('b')], ['b', 'a'])
    expect(ids(r.columns)).toEqual(['b', 'a', 'new', UNGROUPED_ID])
    expect(r.order).toEqual(['b', 'a', 'new'])
  })

  test('a column that disappears keeps its slot for when it comes back', () => {
    const gone = stickyColumns([col('c'), col('a')], ['a', 'b', 'c'])
    expect(ids(gone.columns)).toEqual(['a', 'c'])
    expect(gone.order).toEqual(['a', 'b', 'c'])
    expect(ids(stickyColumns([col('c'), col('b'), col('a')], gone.order).columns)).toEqual(['a', 'b', 'c'])
  })

  test('a new stack column goes first; a remembered one keeps its slot', () => {
    const r = stickyColumns([col('a'), col('stack:st-1', { source: 'stack' }), col('b')], ['a', 'b'])
    expect(ids(r.columns)).toEqual(['stack:st-1', 'a', 'b'])
    expect(r.order).toEqual(['stack:st-1', 'a', 'b'])
    expect(ids(stickyColumns([col('stack:st-1', { source: 'stack' }), col('a'), col('b')], ['a', 'stack:st-1', 'b']).columns)).toEqual([
      'a',
      'stack:st-1',
      'b',
    ])
  })

  test('over the cap, absent ids are forgotten first', () => {
    const prev = Array.from({ length: BOARD_ORDER_MAX }, (_, i) => `old${i}`)
    const r = stickyColumns([col('old50'), col('new')], prev)
    expect(r.order).toHaveLength(BOARD_ORDER_MAX)
    expect(r.order).toContain('old50')
    expect(r.order).not.toContain('old0')
    expect(r.order.at(-1)).toBe('new')
  })
})

describe('applyGroupEdit', () => {
  const base = resp({ groups: [g('g-1', [['laptop', 'a'], ['laptop', 'b']]), g('g-2', [['workstation', 'c']], { label: 'Reviews' })] })

  test('rename changes only that label', () => {
    const r = applyGroupEdit(base, { op: 'rename', id: 'g-2', label: 'Code Reviews' })
    expect(r.groups.map((x) => x.label)).toEqual(['g-1', 'Code Reviews'])
    expect(base.groups[1].label).toBe('Reviews')
  })

  test('move into a group; an emptied group goes', () => {
    const r = applyGroupEdit(base, { op: 'move', host: 'workstation', session: 'c', to: 'g-1' })
    expect(r.groups.map((x) => [x.id, x.members.map((m) => m.id)])).toEqual([['g-1', ['a', 'b', 'c']]])
  })

  test('move to a new group, or to the one that already has that name', () => {
    const r = applyGroupEdit(base, { op: 'move', host: 'laptop', session: 'a', label: 'Spike' })
    expect(r.groups.at(-1)).toMatchObject({ id: 'pending:Spike', label: 'Spike', source: 'manual', members: [{ host: 'laptop', id: 'a' }] })
    const reused = applyGroupEdit(base, { op: 'move', host: 'laptop', session: 'a', label: 'reviews' })
    expect(reused.groups.find((x) => x.id === 'g-2')?.members.map((m) => m.id)).toEqual(['c', 'a'])
  })

  test('create adds an empty own group; delete removes it; an own group left empty stays', () => {
    const made = applyGroupEdit(base, { op: 'create', label: 'Spikes' })
    expect(made.groups.at(-1)).toMatchObject({ id: 'pending:Spikes', source: 'manual', members: [] })
    expect(applyGroupEdit(made, { op: 'delete', id: 'pending:Spikes' }).groups).toHaveLength(2)
    const own = resp({ groups: [g('m', [['laptop', 'a']], { source: 'manual' }), g('g-2', [])] })
    expect(applyGroupEdit(own, { op: 'move', host: 'laptop', session: 'a', to: 'g-2' }).groups.map((x) => x.id)).toEqual(['m', 'g-2'])
  })

  test('default: set and unset; deleting the default group clears it; a default group left empty stays', () => {
    const set = applyGroupEdit(base, { op: 'default', id: 'g-2' })
    expect(set.defaultGroup).toBe('g-2')
    expect(applyGroupEdit(set, { op: 'default', id: null }).defaultGroup).toBeNull()
    const emptied = applyGroupEdit(set, { op: 'move', host: 'workstation', session: 'c', to: 'g-1' })
    expect(emptied.groups.map((x) => x.id)).toEqual(['g-1', 'g-2'])
    expect(applyGroupEdit(emptied, { op: 'delete', id: 'g-2' })).toMatchObject({ defaultGroup: null, groups: [{ id: 'g-1' }] })
    expect(applyGroupEdit(set, { op: 'delete', id: 'g-1' }).defaultGroup).toBe('g-2')
  })

  test('an unclaimed session shown in the default column moves out like a member', () => {
    const r = resp({ groups: [g('inbox', [], { source: 'manual' }), g('paused', [], { source: 'manual' })], defaultGroup: 'inbox' })
    const before = boardColumns([s({ session_id: 'n' })], r.groups, undefined, r.defaultGroup)
    expect(before.map((c) => [c.id, c.sessions.length])).toEqual([['inbox', 1], ['paused', 0]])
    const moved = applyGroupEdit(r, { op: 'move', host: 'laptop', session: 'n', to: 'paused' })
    const after = boardColumns([s({ session_id: 'n' })], moved.groups, undefined, moved.defaultGroup)
    expect(after.map((c) => [c.id, c.sessions.length])).toEqual([['paused', 1], ['inbox', 0]])
  })

  test('boardColumns shows an own group with no members as an empty column, not other empty ones', () => {
    const cols = boardColumns([s({ session_id: 'a' })], [g('own', [], { source: 'manual' }), g('llm', []), g('gone', [['laptop', 'x']], { source: 'manual' })])
    expect(cols.map((c) => [c.id, c.sessions.length])).toEqual([['own', 0], [UNGROUPED_ID, 1]])
  })

  test('memberId: the session id, else the pid', () => {
    expect(memberId(s({ session_id: 'x' }))).toBe('x')
    expect(memberId(s({ session_id: '', pid: 42 }))).toBe('42')
  })
})

test('reorderColumns', () => {
  expect(reorderColumns(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  expect(reorderColumns(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a'])
  expect(reorderColumns(['a', 'b', 'c'], 'a', UNGROUPED_ID)).toEqual(['b', 'c', 'a'])
  expect(reorderColumns(['a', 'b'], 'x', 'b')).toEqual(['a', 'x', 'b'])
  expect(reorderColumns(['a', 'b'], 'a', 'a')).toEqual(['a', 'b'])
})

describe('withStackColumns', () => {
  const st = (id: string, label = id) => ({ id, label })
  const sessions = [
    s({ session_id: 'a', cwd: '~/Code/project', stack: st('st-1', 'Login fix'), updated_at: 5 }),
    s({ session_id: 'b', cwd: '~/Code/project', stack: null, updated_at: 4 }),
    s({ session_id: 'c', cwd: '~/Code/other', stack: st('st-1', 'Login fix'), status: 'waiting', updated_at: 3 }),
    s({ session_id: 'd', cwd: '~/Code/other', stack: st('st-2'), updated_at: 2 }),
  ]
  const base = () => boardColumns(sessions, fallbackGroups(sessions))

  test('every stack is a column before the others; its members leave their groups; empty groups vanish', () => {
    const cols = withStackColumns(base(), sessions)
    expect(cols.map((c) => c.id)).toEqual(['stack:st-1', 'stack:st-2', 'repo:~/Code/project'])
    const first = cols[0]
    expect(first).toMatchObject({ label: 'Login fix', source: 'stack', ungrouped: false, stack: { id: 'st-1', host: 'laptop' } })
    // Waiting first inside the column, and the summary follows the members.
    expect(first.sessions.map((x) => x.session_id)).toEqual(['c', 'a'])
    expect(first.summary.waiting).toBe(1)
    const project = cols[2]
    expect(project.sessions.map((x) => x.session_id)).toEqual(['b'])
    expect(project.summary).toEqual(statusSummary(project.sessions))
  })

  test('no stacks (older servers, no `stack` on rows): the columns come back as they were', () => {
    const plain = sessions.map(({ stack: _stack, ...rest }) => rest as Session)
    const cols = boardColumns(plain, fallbackGroups(plain))
    expect(withStackColumns(cols, plain)).toBe(cols)
  })

  test('only stacks with a shown member get a column (filters apply)', () => {
    const shown = sessions.filter((x) => x.session_id !== 'd')
    const cols = withStackColumns(boardColumns(shown, fallbackGroups(sessions)), shown)
    expect(cols.map((c) => c.id)).toEqual(['stack:st-1', 'repo:~/Code/project'])
  })

  test('the same stack id on two hosts stays two columns', () => {
    const two = [s({ session_id: 'a', stack: st('st-1') }), s({ session_id: 'b', host: 'workstation', stack: st('st-1') })]
    const cols = withStackColumns(boardColumns(two, []), two)
    expect(cols.map((c) => c.id)).toEqual(['stack:st-1', 'stack:workstation/st-1'])
    expect(boardOrder(cols).map((x) => x.session_id)).toEqual(['a', 'b'])
    // The same stack homed on the laptop, one member running on the workstation: one column.
    const home = { id: 'st-1', label: 'Login fix', host: 'laptop' }
    const shared = [s({ session_id: 'a', stack: home, updated_at: 2 }), s({ session_id: 'b', host: 'workstation', stack: home, updated_at: 1 })]
    const one = withStackColumns(boardColumns(shared, []), shared)
    expect(one.map((c) => c.id)).toEqual(['stack:st-1'])
    expect(one[0].stack).toEqual({ id: 'st-1', host: 'laptop' })
    expect(one[0].sessions.map((x) => x.session_id)).toEqual(['a', 'b'])
  })
})

describe('manual card order', () => {
  const col = (id: string, sessions: Session[], over: Partial<BoardColumn> = {}): BoardColumn => ({
    id,
    label: id,
    description: null,
    source: 'llm',
    ungrouped: id === UNGROUPED_ID,
    sessions,
    summary: statusSummary(sessions),
    ...over,
  })
  const keys = (c: BoardColumn) => c.sessions.map((x) => `${x.host}/${x.session_id}`)
  const a = s({ session_id: 'a', updated_at: 3 })
  const b = s({ session_id: 'b', updated_at: 2 })
  const c = s({ session_id: 'c', updated_at: 1 })

  test('a column never arranged by hand keeps its incoming (byUrgency) order and gets no entry', () => {
    const orders = {}
    const r = stickyCards([col('g', [a, b, c])], orders)
    expect(keys(r.columns[0])).toEqual(['laptop/a', 'laptop/b', 'laptop/c'])
    expect(r.orders).toBe(orders)
  })

  test('an arranged column keeps its order whatever the statuses; new cards are appended and remembered', () => {
    const orders = { g: ['laptop/c', 'laptop/a'] }
    // b is new to the order, and now waiting: it still goes after the arranged cards.
    const r = stickyCards([col('g', [s({ session_id: 'b', status: 'waiting' }), a, c])], orders)
    expect(keys(r.columns[0])).toEqual(['laptop/c', 'laptop/a', 'laptop/b'])
    expect(r.orders).toEqual({ g: ['laptop/c', 'laptop/a', 'laptop/b'] })
    // Stable: a second pass changes nothing (same object back, no state churn).
    expect(stickyCards(r.columns, r.orders).orders).toBe(r.orders)
  })

  test('a card that is gone (filtered out, moved, closed) keeps its slot for when it comes back', () => {
    const orders = { g: ['laptop/c', 'laptop/b', 'laptop/a'] }
    const gone = stickyCards([col('g', [a, c])], orders)
    expect(keys(gone.columns[0])).toEqual(['laptop/c', 'laptop/a'])
    expect(gone.orders).toBe(orders)
    expect(keys(stickyCards([col('g', [a, b, c])], gone.orders).columns[0])).toEqual(['laptop/c', 'laptop/b', 'laptop/a'])
  })

  test('the j/k order (boardOrder) follows the card order', () => {
    const r = stickyCards([col('g', [a, b]), col('h', [c])], { g: ['laptop/b', 'laptop/a'] })
    expect(boardOrder(r.columns).map((x) => x.session_id)).toEqual(['b', 'a', 'c'])
  })

  test('over the per-column cap, absent cards are forgotten first', () => {
    const prev = Array.from({ length: CARD_ORDER_MAX }, (_, i) => `laptop/old${i}`)
    const r = stickyCards([col('g', [s({ session_id: 'old50' }), s({ session_id: 'new' })])], { g: prev })
    expect(r.orders.g).toHaveLength(CARD_ORDER_MAX)
    expect(r.orders.g).toContain('laptop/old50')
    expect(r.orders.g).not.toContain('laptop/old0')
    expect(r.orders.g.at(-1)).toBe('laptop/new')
  })

  test('over the column cap, columns not on the board are forgotten first (least recently arranged)', () => {
    const orders = Object.fromEntries(Array.from({ length: CARD_COLUMNS_MAX + 2 }, (_, i) => [`g${i}`, [`laptop/x${i}`]]))
    const r = stickyCards([col('g0', [s({ session_id: 'x0' })])], orders)
    expect(Object.keys(r.orders)).toHaveLength(CARD_COLUMNS_MAX)
    expect(r.orders.g0).toEqual(['laptop/x0'])
    expect(r.orders.g1).toBeUndefined()
    expect(r.orders.g2).toBeUndefined()
    expect(r.orders.g3).toBeDefined()
    // More arranged columns on the board than the cap: nothing to forget, and no churn.
    const many = Array.from({ length: CARD_COLUMNS_MAX + 1 }, (_, i) => col(`g${i}`, [s({ session_id: `x${i}` })]))
    const full = Object.fromEntries(many.map((m, i) => [m.id, [`laptop/x${i}`]]))
    expect(stickyCards(many, full).orders).toBe(full)
  })

  test('placeCard: within a column, before a card or at the end', () => {
    expect(placeCard({ g: ['a', 'b', 'c'] }, 'g', [], 'c', 'a')).toEqual({ g: ['c', 'a', 'b'] })
    expect(placeCard({ g: ['a', 'b', 'c'] }, 'g', [], 'a', null)).toEqual({ g: ['b', 'c', 'a'] })
    // Unknown `before` (stale): the end.
    expect(placeCard({ g: ['a', 'b'] }, 'g', [], 'a', 'zz')).toEqual({ g: ['b', 'a'] })
  })

  test('placeCard: a column without an order starts from the cards as drawn', () => {
    expect(placeCard({}, 'g', ['a', 'b', 'c'], 'c', 'b')).toEqual({ g: ['a', 'c', 'b'] })
  })

  test('placeCard: from another column — it leaves that order; the arranged column becomes the most recent', () => {
    const r = placeCard({ g: ['a', 'b'], h: ['x'], k: ['y'] }, 'h', ['x'], 'a', 'x', 'g')
    expect(r).toEqual({ g: ['b'], k: ['y'], h: ['a', 'x'] })
    expect(Object.keys(r)).toEqual(['g', 'k', 'h'])
  })

  test('cardDropBefore: by midpoints; its own spot is no drop', () => {
    const shown = ['a', 'b', 'c']
    const mids = [10, 30, 50]
    expect(cardDropBefore(shown, mids, 5, 'x')).toBe('a')
    expect(cardDropBefore(shown, mids, 35, 'x')).toBe('c')
    expect(cardDropBefore(shown, mids, 60, 'x')).toBeNull()
    expect(cardDropBefore([], [], 0, 'x')).toBeNull()
    // Dragging b: just above or just below it leaves it where it is.
    expect(cardDropBefore(shown, mids, 25, 'b')).toBeUndefined()
    expect(cardDropBefore(shown, mids, 45, 'b')).toBeUndefined()
    expect(cardDropBefore(shown, mids, 5, 'b')).toBe('a')
    expect(cardDropBefore(shown, mids, 55, 'b')).toBeNull()
  })

  test('parseCardOrders', () => {
    expect(parseCardOrders({ g: ['a', 1, 'b'], h: 'nope', k: [] })).toEqual({ g: ['a', 'b'] })
    expect(parseCardOrders(['a'])).toEqual({})
    expect(parseCardOrders(null)).toEqual({})
  })
})

describe('desktop list sections', () => {
  const sessions = [
    s({ session_id: 'a', status: 'busy', updated_at: 3 }),
    s({ session_id: 'b', status: 'waiting', updated_at: 1 }),
    s({ session_id: 'c', updated_at: 2 }),
    s({ session_id: 'd', updated_at: 4 }),
  ]
  const cols = boardColumns(sessions, [
    g('progress', [['laptop', 'a'], ['laptop', 'b']], { source: 'manual' }),
    g('watcher', [['laptop', 'c']], { source: 'manual' }),
    g('paused', [], { source: 'manual' }),
  ])

  test('listSections: every column, the empty group of yours too; narrowed, only those with a match', () => {
    expect(listSections(cols, false).map((c) => [c.id, c.sessions.length])).toEqual([
      ['progress', 2],
      ['watcher', 1],
      ['paused', 0],
      [UNGROUPED_ID, 1],
    ])
    expect(listSections(cols, true).map((c) => c.id)).toEqual(['progress', 'watcher', UNGROUPED_ID])
  })

  test('listSectionsOrder: section by section, rows top to bottom, collapsed sections skipped', () => {
    expect(listSectionsOrder(cols, []).map((x) => x.session_id)).toEqual(['b', 'a', 'c', 'd'])
    expect(listSectionsOrder(cols, ['progress', 'gone']).map((x) => x.session_id)).toEqual(['c', 'd'])
    expect(listSectionsOrder(cols, ['progress', 'watcher', 'paused', UNGROUPED_ID])).toEqual([])
  })

  test('isGroupColumn: a group, not Ungrouped, not a session stack', () => {
    expect(cols.map((c) => [c.id, isGroupColumn(c)])).toEqual([
      ['progress', true],
      ['watcher', true],
      ['paused', true],
      [UNGROUPED_ID, false],
    ])
    expect(isGroupColumn({ ...cols[0], id: 'stack:st', source: 'stack' })).toBe(false)
  })

  test('canMoveOutOf: a group or Ungrouped, not a session stack', () => {
    expect(cols.map((c) => [c.id, canMoveOutOf(c)])).toEqual([
      ['progress', true],
      ['watcher', true],
      ['paused', true],
      [UNGROUPED_ID, true],
    ])
    expect(canMoveOutOf({ ...cols[0], id: 'stack:st', source: 'stack' })).toBe(false)
  })

  describe('sectionDrop', () => {
    const e = s({ session_id: 'e', stack: { id: 'st', label: 'Stack', host: 'laptop' } })
    const stacked: BoardColumn[] = [...cols, { ...cols[0], id: 'stack:st', source: 'stack', stack: { id: 'st', host: 'laptop' }, sessions: [e] }]
    const from = (r: ReturnType<typeof sectionDrop>) => (r ? [r.from.id, r.session.session_id] : null)

    test('a group row into another group, the empty one included', () => {
      expect(from(sectionDrop(stacked, 'laptop/a', 'watcher', true))).toEqual(['progress', 'a'])
      expect(from(sectionDrop(stacked, 'laptop/c', 'paused', true))).toEqual(['watcher', 'c'])
    })

    test('an Ungrouped row into any group, the empty one included', () => {
      expect(from(sectionDrop(stacked, 'laptop/d', 'watcher', true))).toEqual([UNGROUPED_ID, 'd'])
      expect(from(sectionDrop(stacked, 'laptop/d', 'paused', true))).toEqual([UNGROUPED_ID, 'd'])
    })

    test('back into its own section: a reorder, whatever the section', () => {
      expect(from(sectionDrop(stacked, 'laptop/a', 'progress', false))).toEqual(['progress', 'a'])
      expect(from(sectionDrop(stacked, 'laptop/d', UNGROUPED_ID, true))).toEqual([UNGROUPED_ID, 'd'])
      expect(from(sectionDrop(stacked, 'laptop/e', 'stack:st', true))).toEqual(['stack:st', 'e'])
    })

    test('no move off an editable list, out of a stack, or into Ungrouped or a stack', () => {
      expect(sectionDrop(stacked, 'laptop/a', 'watcher', false)).toBeNull()
      expect(sectionDrop(stacked, 'laptop/d', 'watcher', false)).toBeNull()
      expect(sectionDrop(stacked, 'laptop/e', 'watcher', true)).toBeNull()
      expect(sectionDrop(stacked, 'laptop/a', UNGROUPED_ID, true)).toBeNull()
      expect(sectionDrop(stacked, 'laptop/a', 'stack:st', true)).toBeNull()
      expect(sectionDrop(stacked, 'laptop/d', 'stack:st', true)).toBeNull()
    })

    test('a row or section not in the list: no drop', () => {
      expect(sectionDrop(stacked, 'laptop/zz', 'watcher', true)).toBeNull()
      expect(sectionDrop(stacked, 'laptop/a', 'gone', true)).toBeNull()
    })
  })
})
