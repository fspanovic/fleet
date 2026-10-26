import { describe, expect, test } from 'vitest'

import type { Subagent } from '@/api/types'
import { runningSubagents, subagentJob, subagentMeta, subagentsCountLabel, subagentsTooltip } from './subagents'

const now = 1_000_000_000_000
const agent = (over: Partial<Subagent> = {}): Subagent => ({
  id: 'a1',
  description: 'Fix the login bug',
  agent_type: 'general-purpose',
  model: 'opus',
  background: true,
  started_at: now - 5 * 60_000,
  last_active_at: now - 10_000,
  depth: 1,
  parent_agent_id: null,
  ...over,
})

describe('runningSubagents', () => {
  test('the list, or none for an older CLI / a bad value', () => {
    expect(runningSubagents({ subagents: [agent()] })).toHaveLength(1)
    expect(runningSubagents({})).toEqual([])
    expect(runningSubagents({ subagents: null })).toEqual([])
    expect(runningSubagents(null)).toEqual([])
    expect(runningSubagents({ subagents: 'x' as unknown as Subagent[] })).toEqual([])
  })
})

describe('labels', () => {
  test('count, job and tooltip', () => {
    expect(subagentsCountLabel(1)).toBe('1 subagent running')
    expect(subagentsCountLabel(3)).toBe('3 subagents running')
    expect(subagentJob(agent({ description: '  ' }))).toBe('general-purpose')
    expect(subagentJob(agent({ description: '', agent_type: null }))).toBe('subagent')
    expect(subagentsTooltip([agent(), agent({ id: 'a2', description: 'Review the PR' })])).toBe(
      '2 subagents running\n• Fix the login bug\n• Review the PR',
    )
  })

  test('meta: type, model, running for, mode', () => {
    expect(subagentMeta(agent(), now)).toBe('general-purpose · opus · 5m · background')
    expect(subagentMeta(agent({ model: 'claude-sonnet-5', background: false }), now)).toBe('general-purpose · Sonnet 5 · 5m · foreground')
    expect(subagentMeta(agent({ agent_type: null, model: null, started_at: null }), now)).toBe('background')
  })
})
