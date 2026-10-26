import { describe, expect, test } from 'vitest'

import { ApiError } from '@/api/client'

import { recap, recapAt, recapError, recapStale, sentences, todosLabel, updatedLabel, STALE_SLACK_MS } from './tldr'

describe('sentences', () => {
  test('splits on sentence ends, collapses whitespace and line breaks', () => {
    expect(sentences('Fixing the login loop.  The fix is in review!\nNext: tests?')).toEqual([
      'Fixing the login loop.',
      'The fix is in review!',
      'Next: tests?',
    ])
  })
  test('keeps abbreviations, initials, file names and versions inside a sentence', () => {
    expect(sentences('Edits e.g. src/brief.ts and v1.2.3 per J. Doe. Done.')).toEqual(['Edits e.g. src/brief.ts and v1.2.3 per J. Doe.', 'Done.'])
  })
  test('a closing quote or bracket stays with its sentence; no trailing dot is fine', () => {
    expect(sentences('He said "ok." (Then left.) Still going')).toEqual(['He said "ok."', '(Then left.)', 'Still going'])
  })
  test('empty', () => {
    expect(sentences('')).toEqual([])
    expect(sentences('   \n ')).toEqual([])
  })
})

describe('recap', () => {
  test('a short summary is shown whole', () => {
    expect(recap('One. Two.')).toEqual({ text: 'One. Two.', more: false })
  })
  test('at most 5 sentences', () => {
    const r = recap('One. Two. Three. Four. Five. Six. Seven.')
    expect(r).toEqual({ text: 'One. Two. Three. Four. Five.', more: true })
  })
  test('stops before the sentence that would pass the char limit', () => {
    const s = `${'x'.repeat(30)}.`
    const r = recap(`${s} ${s} ${s}`, 5, 70)
    expect(r.text).toBe(`${s} ${s}`)
    expect(r.more).toBe(true)
  })
  test('an over-long first sentence is cut at a word boundary with an ellipsis', () => {
    const r = recap(`${'word '.repeat(40).trim()}.`, 5, 50)
    expect(r.more).toBe(true)
    expect(r.text.endsWith('word…')).toBe(true)
    expect(r.text.length).toBeLessThanOrEqual(51)
  })
  test('empty / missing', () => {
    expect(recap('')).toEqual({ text: '', more: false })
    expect(recap(null)).toEqual({ text: '', more: false })
  })
})

describe('recapAt / recapStale', () => {
  const gen = '2026-01-02T03:00:00.000Z'
  const genMs = Date.parse(gen)
  const brief = (summary: string, generatedAt: string | null = gen, editedAt: string | null = null) => ({ parsed: { summary }, generatedAt, editedAt })

  test('recapAt prefers the generation, else the edit', () => {
    expect(recapAt(brief('x'))).toBe(genMs)
    expect(recapAt(brief('x', null, '2026-01-02T04:00:00.000Z'))).toBe(Date.parse('2026-01-02T04:00:00.000Z'))
    expect(recapAt(brief('x', null, null))).toBeNull()
    expect(recapAt(null)).toBeNull()
  })
  test('no brief / no summary / never written → stale', () => {
    expect(recapStale(null, genMs)).toBe(true)
    expect(recapStale(brief('  '), genMs)).toBe(true)
    expect(recapStale(brief('x', null, null), genMs)).toBe(true)
  })
  test('activity after the summary (past the slack) → stale', () => {
    expect(recapStale(brief('x'), genMs - 5 * 60_000)).toBe(false)
    expect(recapStale(brief('x'), genMs + STALE_SLACK_MS)).toBe(false)
    expect(recapStale(brief('x'), genMs + STALE_SLACK_MS + 1)).toBe(true)
  })
  test('unknown activity time never makes it stale', () => {
    expect(recapStale(brief('x'), null)).toBe(false)
    expect(recapStale(brief('x'), undefined)).toBe(false)
    expect(recapStale(brief('x'), 0)).toBe(false)
  })
})

describe('labels', () => {
  test('todosLabel', () => {
    expect(todosLabel({ done: 3, total: 5 })).toBe('3/5 todos')
    expect(todosLabel({ done: 0, total: 1 })).toBe('0/1 todo')
    expect(todosLabel({ done: 0, total: 0 })).toBeNull()
    expect(todosLabel(null)).toBeNull()
  })
  test('updatedLabel', () => {
    const now = 1_000_000_000_000
    expect(updatedLabel(now - 20_000, now)).toBe('updated just now')
    expect(updatedLabel(now - 4 * 60_000, now)).toBe('updated 4 min ago')
    expect(updatedLabel(now - 3 * 3_600_000, now)).toBe('updated 3 h ago')
    expect(updatedLabel(now - 3 * 86_400_000, now)).toBe('updated 3 d ago')
    expect(updatedLabel(null, now)).toBeNull()
    expect(updatedLabel(0, now)).toBeNull()
  })
})

describe('recapError', () => {
  test('the hourly cap with its wait', () => {
    expect(recapError(new ApiError('capped', 429, { error: 'capped', retryAfterMs: 11.5 * 60_000 }))).toBe('Recap limit reached, try again in 12 min')
    expect(recapError(new ApiError('capped', 429, null))).toBe('Recap limit reached, try again in 1 min')
  })
  test('server reasons pass through; an old server is named', () => {
    expect(recapError(new ApiError('transcript not found for this session', 404))).toBe('transcript not found for this session')
    expect(recapError(new ApiError('not found', 404))).toMatch(/predates briefs/)
    expect(recapError(new ApiError('session briefs are not available on this server', 501))).toBe('session briefs are not available on this server')
    expect(recapError(new ApiError('HTTP 502', 502))).toBe('host unreachable')
    expect(recapError(new ApiError('network unreachable', 0))).toBe('network unreachable')
  })
})
