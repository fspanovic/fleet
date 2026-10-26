// Running subagents on a session row (`subagents`, docs/architecture.md → Running subagents) — pure helpers.
import type { Session, Subagent } from '@/api/types'
import { modelLabel, relTime } from '@/lib/format'

/** The session's running subagents; none for an older CLI (field missing) or a bad value. */
export function runningSubagents(s: Pick<Session, 'subagents'> | null | undefined): Subagent[] {
  const list = s?.subagents
  return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string') : []
}

/** A subagent's job, never blank. */
export function subagentJob(a: Pick<Subagent, 'description' | 'agent_type'>): string {
  return a.description?.trim() || a.agent_type || 'subagent'
}

/** "1 subagent running", "3 subagents running". */
export function subagentsCountLabel(n: number): string {
  return `${n} subagent${n === 1 ? '' : 's'} running`
}

/** The chip's tooltip: the count, then one job per line. */
export function subagentsTooltip(list: Subagent[]): string {
  return [subagentsCountLabel(list.length), ...list.map((a) => `• ${subagentJob(a)}`)].join('\n')
}

/** "general-purpose · Opus 5.5 · 5m · background": type, model, running for, mode. */
export function subagentMeta(a: Subagent, now = Date.now()): string {
  return [
    a.agent_type,
    a.model ? modelLabel(a.model) : null,
    a.started_at ? relTime(a.started_at, now) : null,
    a.background === false ? 'foreground' : 'background',
  ]
    .filter(Boolean)
    .join(' · ')
}
