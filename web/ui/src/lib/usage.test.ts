import { describe, expect, test } from 'vitest'

import type { UsageLimit, UsageResponse } from '@/api/types'
import { compactLimits, extraUsageText, groupByAccount, money, resetsLabel, shortLimitLabel, splitAccounts, usageLevel } from '@/lib/usage'

const usage = (over: Partial<UsageResponse> = {}): UsageResponse => ({
  host: 'laptop',
  account: { uuid: 'u1', email: 'me@example.com', organization: null, plan: 'max', tier: null, plan_label: 'Max 5x' },
  limits: [],
  extra_usage: null,
  fetched_at: '2026-09-29T20:00:00Z',
  stale: false,
  error: null,
  ...over,
})

const limit = (kind: string, percent: number, over: Partial<UsageLimit> = {}): UsageLimit => ({
  kind,
  group: kind === 'session' ? 'session' : 'weekly',
  label: kind,
  model: null,
  percent,
  severity: 'normal',
  resets_at: null,
  active: false,
  ...over,
})

describe('usage', () => {
  test('bands: severity wins, then percent', () => {
    expect(usageLevel({ percent: 10, severity: 'normal' })).toBe('low')
    expect(usageLevel({ percent: 75, severity: 'normal' })).toBe('warn')
    expect(usageLevel({ percent: 10, severity: 'warning' })).toBe('warn')
    expect(usageLevel({ percent: 95, severity: 'normal' })).toBe('hot')
    expect(usageLevel({ percent: 10, severity: 'critical' })).toBe('hot')
  })

  test('reset labels', () => {
    const now = Date.parse('2026-09-29T20:00:00Z')
    expect(resetsLabel('2026-09-29T20:45:00Z', now)).toBe('in 45m')
    expect(resetsLabel('2026-09-29T22:20:00Z', now)).toBe('in 2h 20m')
    expect(resetsLabel('2026-10-02T12:00:00Z', now)).toMatch(/\d{2}:\d{2}$/)
    expect(resetsLabel(null, now)).toBeNull()
    expect(resetsLabel('nope', now)).toBeNull()
  })

  test('money', () => {
    expect(money(null, 'USD')).toBeNull()
    expect(money(12.5, 'USD')).toMatch(/12[.,]50/)
    expect(money(3, null)).toBe('3.00')
  })

  test('hosts on one account collapse into one, keeping the freshest read', () => {
    const accounts = groupByAccount([
      { host: 'laptop', usage: usage({ stale: true }), error: null },
      { host: 'workstation', usage: usage({ host: 'workstation', fetched_at: '2026-09-29T19:00:00Z' }), error: null },
      { host: 'other', usage: usage({ host: 'other', account: null }), error: null },
      { host: 'down', usage: null, error: 'unreachable' },
    ])
    expect(accounts.map((a) => a.hosts)).toEqual([['laptop', 'workstation'], ['other']])
    expect(accounts[0].usage.host).toBe('workstation')
  })

  test('extra usage text', () => {
    const x = { enabled: true, used: 12.5, limit: 50, currency: null, percent: 25 }
    expect(extraUsageText({ ...x, enabled: false })).toBe('Off')
    expect(extraUsageText(x)).toBe('12.50 / 50.00')
    expect(extraUsageText({ ...x, limit: null })).toBe('12.50 spent')
    expect(extraUsageText({ ...x, used: null, limit: null })).toBe('On')
  })

  test('compact limits: session and weekly always, the rest once used', () => {
    const fable = limit('weekly_scoped', 0.4, { model: 'Fable' })
    const opus = limit('weekly_scoped', 12, { model: 'Opus' })
    const picked = compactLimits([fable, limit('weekly_all', 0), opus, limit('session', 0)])
    expect(picked.map((l) => l.model ?? l.kind)).toEqual(['weekly_all', 'session', 'Opus'])
  })

  test('short limit labels', () => {
    expect(shortLimitLabel({ kind: 'session', label: 'Current session', model: null })).toBe('Session')
    expect(shortLimitLabel({ kind: 'weekly_all', label: 'Weekly · all models', model: null })).toBe('Weekly')
    expect(shortLimitLabel({ kind: 'weekly_scoped', label: 'Weekly · Fable', model: 'Fable' })).toBe('Fable')
    expect(shortLimitLabel({ kind: 'monthly', label: 'monthly', model: null })).toBe('monthly')
  })

  test("the main account is this server's, else the first", () => {
    const accounts = groupByAccount([
      { host: 'laptop', usage: usage(), error: null },
      { host: 'workstation', usage: usage({ host: 'workstation', account: null }), error: null },
    ])
    expect(splitAccounts(accounts, 'workstation').main?.hosts).toEqual(['workstation'])
    expect(splitAccounts(accounts, 'workstation').others.map((a) => a.hosts)).toEqual([['laptop']])
    expect(splitAccounts(accounts, 'elsewhere').main?.hosts).toEqual(['laptop'])
    expect(splitAccounts(accounts, null).others).toHaveLength(1)
    expect(splitAccounts([], 'laptop')).toEqual({ main: null, others: [] })
  })
})
