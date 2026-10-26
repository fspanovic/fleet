import { describe, expect, it } from 'vitest'

import { ApiError } from '@/api/client'
import type { ClosedView, DormantView } from '@/api/types'
import {
  closedCount,
  closedHref,
  closedMeta,
  dormantCount,
  dormantErrorMessage,
  dormantIndex,
  dormantMember,
  dormantMeta,
  dormantMissing,
  dormantTitles,
  findPastEntry,
  hasEntries,
  hostDormant,
  matchesDormantMember,
  pastErrorText,
  pastMarker,
  pastRecord,
  pastTitle,
  pastWhen,
  previewSessionId,
  restoreSummary,
  searchDormant,
} from '@/lib/dormant'

const NOW = Date.parse('2026-10-04T12:00:00Z')
const tmux: DormantView = {
  kind: 'tmux',
  target: 'fix-login',
  name: 'fix-login',
  since: '2026-10-04T09:00:00Z',
  windows: 1,
  panes: 2,
  sessions: [{ sessionId: 'aaaa-1', name: 'fix', title: 'Fix login', cwd: '~/Code/project' }],
}
const lone: DormantView = { kind: 'claude', target: 'bbbb-2', name: 'Review PR', since: null, windows: 0, panes: 0, sessions: [{ sessionId: 'bbbb-2', name: null, title: null, cwd: null }] }

describe('dormant helpers', () => {
  it('indexes dormant Claude sessions by host/sessionId', () => {
    const idx = dormantIndex([{ host: 'workstation', views: [tmux, lone], closed: [] }])
    expect([...idx.keys()]).toEqual(['workstation/aaaa-1', 'workstation/bbbb-2'])
    expect(idx.get('workstation/aaaa-1')).toEqual({ host: 'workstation', id: 'aaaa-1', title: 'Fix login', since: Date.parse('2026-10-04T09:00:00Z') })
    expect(idx.get('workstation/bbbb-2')?.title).toBe('Review PR')
    expect(dormantCount([{ host: 'a', views: [tmux, lone], closed: [] }, { host: 'b', views: [], closed: [] }])).toBe(2)
  })

  it('a group member is dormant by the server flag or the dormant list', () => {
    const idx = dormantIndex([{ host: 'laptop', views: [tmux], closed: [] }])
    expect(dormantMember({ host: 'laptop', id: 'aaaa-1' }, idx)?.title).toBe('Fix login')
    expect(dormantMember({ host: 'laptop', id: 'cccc-3', dormant: true }, idx)).toEqual({ host: 'laptop', id: 'cccc-3', title: 'cccc-3', since: null })
    expect(dormantMember({ host: 'laptop', id: 'cccc-3' }, idx)).toBeNull()
    expect(dormantMember({ host: 'workstation', id: 'aaaa-1' }, idx)).toBeNull()
  })

  it('titles and meta lines', () => {
    expect(dormantTitles(tmux)).toBe('Fix login')
    expect(dormantTitles({ ...tmux, sessions: [] })).toBe('no Claude panes')
    expect(dormantMeta(tmux, NOW)).toBe('tmux · 1 window · 2 panes · down 3h')
    expect(dormantMeta(lone, NOW)).toBe('not in tmux')
  })

  it('errors: old servers are missing, ambiguity lists candidates', () => {
    expect(dormantMissing(new ApiError('not found', 404))).toBe(true)
    expect(dormantMissing(new ApiError('x', 501))).toBe(true)
    expect(dormantMissing(new ApiError('no dormant session matches "x"', 404))).toBe(false)
    expect(dormantErrorMessage(new ApiError('amb', 409, { error: 'amb', candidates: ['a', 'b'] }))).toBe('Ambiguous — matches a, b')
    expect(dormantErrorMessage(new ApiError('no dormant session matches "x"', 404))).toBe('no dormant session matches "x"')
  })

  it('restore summaries', () => {
    const entry = { kind: 'tmux', from: 'fix-login', session: 'fix-login', renamed: false, windows: 1, panes: 2, launched: [{ sessionId: 'aaaa-1', title: 'Fix login', line: '…' }], warnings: [], commands: [], dryRun: false }
    expect(restoreSummary({ host: 'laptop', restored: [entry], failed: [] })).toEqual({ ok: true, title: 'Resumed fix-login', description: '1 Claude session resuming' })
    const partial = restoreSummary({ host: 'laptop', restored: [entry], failed: [{ target: 'x', error: 'boom' }] })
    expect(partial.ok).toBe(false)
    expect(partial.description).toBe('1 Claude session resuming\nx: boom')
    expect(restoreSummary({ host: 'laptop', restored: [], failed: [] }).title).toBe('Nothing resumed')
  })

  it('recently closed: parsed beside dormant, own count and meta, never in the Board index', () => {
    const closed: ClosedView = { ...lone, target: 'cccc-3', name: 'Old work', closedAt: '2026-10-04T10:00:00Z', since: '2026-10-04T10:00:00Z', tmuxSession: 'api', sessions: [{ sessionId: 'cccc-3', name: null, title: 'Old work', cwd: '~/Code/project' }] }
    const h = hostDormant('laptop', { dormant: [], closed: [closed] })
    expect(h).toEqual({ host: 'laptop', views: [], closed: [closed] })
    expect(hostDormant('old', { dormant: [tmux] }).closed).toEqual([])
    expect(hasEntries(h)).toBe(true)
    expect(hasEntries(hostDormant('x', {}))).toBe(false)
    expect(closedCount([h])).toBe(1)
    expect(dormantCount([h])).toBe(0)
    expect(dormantIndex([h]).size).toBe(0)
    expect(closedMeta(closed, NOW)).toBe('in tmux api · ~/Code/project · closed 2h ago')
    expect(closedMeta({ ...closed, tmuxSession: undefined, closedAt: null, since: null }, NOW)).toBe('not in tmux · ~/Code/project')
    expect(closedMeta({ ...tmux, closedAt: '2026-10-04T11:00:00Z' }, NOW)).toBe('tmux · 1 window · 2 panes · closed 1h ago')
  })
})

describe('searchDormant', () => {
  const view = (name: string, extra: Partial<ClosedView> = {}): ClosedView => ({
    kind: 'tmux',
    target: name,
    name,
    since: null,
    closedAt: null,
    windows: 1,
    panes: 1,
    sessions: [{ sessionId: 'abc12345', name: null, title: 'Fix login bug', cwd: '~/Code/api' }],
    ...extra,
  })
  const h = { host: 'workstation', views: [view('web'), view('docs', { sessions: [] })], closed: [view('old', { tmuxSession: 'infra', sessions: [] })] }

  it('keeps everything without a query', () => {
    expect(searchDormant(h, '  ')).toBe(h)
  })

  it('matches names, Claude titles, cwds, tmux sessions and the host', () => {
    expect(searchDormant(h, 'login').views.map((v) => v.name)).toEqual(['web'])
    expect(searchDormant(h, 'code/api').views.map((v) => v.name)).toEqual(['web'])
    expect(searchDormant(h, 'DOCS').views.map((v) => v.name)).toEqual(['docs'])
    expect(searchDormant(h, 'infra').closed.map((v) => v.name)).toEqual(['old'])
    expect(searchDormant(h, 'workstation').views).toHaveLength(2)
    expect(searchDormant(h, 'nothing')).toMatchObject({ views: [], closed: [] })
  })
})

describe('matchesDormantMember', () => {
  const m = { host: 'laptop', id: 'abc12345-0000', title: 'Refactor groups', since: null }

  it('matches title, host and id', () => {
    expect(matchesDormantMember(m, '')).toBe(true)
    expect(matchesDormantMember(m, 'refactor')).toBe(true)
    expect(matchesDormantMember(m, 'laptop')).toBe(true)
    expect(matchesDormantMember(m, 'abc123')).toBe(true)
    expect(matchesDormantMember(m, 'zzz')).toBe(false)
  })
})

describe('closed / dormant preview', () => {
  const closed: ClosedView = {
    kind: 'claude',
    target: 'cccc-3',
    name: 'Old work',
    since: '2026-10-04T10:00:00Z',
    closedAt: '2026-10-04T10:00:00Z',
    tmuxSession: 'api',
    windows: 1,
    panes: 1,
    sessions: [{ sessionId: 'cccc-3', name: 'old', title: 'Old work', cwd: '/w/app', harness: 'codex' }],
  }
  const hosts = [{ host: 'laptop', views: [tmux], closed: [closed] }]

  it('the route and which session a row opens', () => {
    expect(closedHref('work station', 'a/b')).toBe('/closed/work%20station/a%2Fb')
    expect(previewSessionId(tmux)).toBe('aaaa-1')
    expect(previewSessionId({ ...tmux, sessions: [] })).toBeNull()
  })

  it('finds the entry of a session id in either list, on its own host only', () => {
    expect(findPastEntry(hosts, 'laptop', 'cccc-3')).toMatchObject({ pool: 'closed', view: closed })
    expect(findPastEntry(hosts, 'laptop', 'aaaa-1')).toMatchObject({ pool: 'dormant', view: tmux, session: { title: 'Fix login' } })
    expect(findPastEntry(hosts, 'workstation', 'aaaa-1')).toBeNull()
    expect(findPastEntry(hosts, 'laptop', 'zzzz')).toBeNull()
  })

  it('a record from the sidebar until the server answers; the server wins', () => {
    const fromList = pastRecord(null, findPastEntry(hosts, 'laptop', 'cccc-3'))
    expect(fromList).toEqual({
      pool: 'closed', kind: 'claude', target: 'cccc-3', name: 'Old work', title: 'Old work', sessionName: 'old', cwd: '/w/app',
      harness: 'codex', since: '2026-10-04T10:00:00Z', closedAt: '2026-10-04T10:00:00Z', tmuxSession: 'api',
    })
    const dormantRec = pastRecord(null, findPastEntry(hosts, 'laptop', 'aaaa-1'))
    expect(dormantRec).toMatchObject({ pool: 'dormant', target: 'fix-login', harness: 'claude', closedAt: null, tmuxSession: null })
    const server = { ...fromList!, title: 'Renamed' }
    expect(pastRecord(server, findPastEntry(hosts, 'laptop', 'cccc-3'))).toBe(server)
    expect(pastRecord(null, null)).toBeNull()
  })

  it('title, when and marker', () => {
    const r = pastRecord(null, findPastEntry(hosts, 'laptop', 'cccc-3'))
    expect(pastTitle(r, 'cccc-3')).toBe('Old work')
    expect(pastTitle({ ...r!, title: null, sessionName: null }, 'cccc-3')).toBe('Old work')
    expect(pastTitle(null, '0123456789abcdef')).toBe('01234567')
    expect(pastWhen(r, NOW)).toBe('closed 2h ago')
    expect(pastWhen(pastRecord(null, findPastEntry(hosts, 'laptop', 'aaaa-1')), NOW)).toBe('down 3h')
    expect(pastWhen(null, NOW)).toBe('')
    expect(pastMarker(r)).toBe('Closed — read only')
    expect(pastMarker({ pool: 'dormant' })).toBe('Dormant — read only')
    expect(pastMarker(null)).toBe('Closed — read only')
  })

  it('error texts: gone from the lists, no transcript, an old host', () => {
    expect(pastErrorText(null)).toBeNull()
    expect(pastErrorText(new ApiError('not a recently closed or dormant session: x', 404))).toMatch(/no longer in the recently closed/i)
    expect(pastErrorText(new ApiError('transcript not found for this session', 404))).toBe('No transcript on disk for this session')
    expect(pastErrorText(new ApiError('not found', 404))).toMatch(/update it there/)
    expect(pastErrorText(new ApiError('session recovery is not available on this server', 501))).toMatch(/update it there/)
    expect(pastErrorText(new ApiError('network unreachable', 0))).toBe('network unreachable')
    expect(pastErrorText(new ApiError('fleet restore failed: boom', 502))).toBe('fleet restore failed: boom')
  })
})
