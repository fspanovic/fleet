// Delete a session (close it + remove its linked git worktree): what the confirm dialog says
// and offers for a GET …/worktree answer, and how a result is toasted. Pure.
import { ApiError } from '@/api/client'
import type { DeleteResponse, LeftoverPlan, WorktreeInspect } from '@/api/types'
import { shortCwd } from '@/lib/format'

export type DeleteState = 'worktree' | 'force' | 'blocked' | 'locked' | 'close-only'

export interface DeletePlan {
  state: DeleteState
  /** The primary button, or null when only "Close session only" is possible. */
  confirm: { label: string; force: boolean } | null
  /** Offer closing the session while keeping the worktree (another session in it, locked). */
  closeOnly: boolean
  /** One sentence on what happens to the directory. */
  note: string
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const CLOSE_ONLY_NOTES: Record<NonNullable<WorktreeInspect['reason']>, string> = {
  'main-checkout': "It runs in the repo's main checkout, not a linked worktree: only the session is closed, the directory stays.",
  'not-git': 'Its directory is not in a git repository: only the session is closed, the directory stays.',
  'no-cwd': 'Its directory is unknown: only the session is closed.',
}

export function deletePlan(w: WorktreeInspect): DeletePlan {
  if (w.action !== 'remove-worktree' || !w.worktree) {
    return { state: 'close-only', confirm: { label: 'Close session', force: false }, closeOnly: false, note: CLOSE_ONLY_NOTES[w.reason ?? 'no-cwd'] }
  }
  // A workspace fleet made for the session: its branch goes too when nothing on it is unpushed.
  const branch = w.workspace?.deleteBranch
    ? `the branch ${w.workspace.branch} fleet made for it is deleted too (nothing on it is unpushed)`
    : w.worktree.branch
      ? `the branch ${w.worktree.branch} stays`
      : 'it is on a detached HEAD'
  if (w.blocked) {
    return {
      state: 'blocked',
      confirm: null,
      closeOnly: true,
      note: `${plural(w.sessions.length, 'other session')} ${w.sessions.length === 1 ? 'runs' : 'run'} in this worktree: it can't be removed while they do.`,
    }
  }
  if (w.worktree.locked) {
    return { state: 'locked', confirm: null, closeOnly: true, note: 'The worktree is locked (git worktree unlock): it is kept.' }
  }
  if (w.needsForce) {
    return { state: 'force', confirm: { label: 'Delete anyway', force: true }, closeOnly: false, note: `Closes the session and force-removes the worktree; what is listed below is lost, ${branch}.` }
  }
  return { state: 'worktree', confirm: { label: 'Delete', force: false }, closeOnly: false, note: `Closes the session and removes the worktree (git worktree remove); ${branch}.` }
}

/** "2 uncommitted changes · 1 commit not pushed" — empty when clean. */
export function changesSummary(w: WorktreeInspect): string {
  const wt = w.worktree
  if (!wt) return ''
  return [
    wt.dirty.count ? plural(wt.dirty.count, 'uncommitted change') : '',
    wt.unpushed.count ? `${plural(wt.unpushed.count, 'commit')} not pushed` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The host's server predates the route (404 "not found", 501): it can only close. */
export function deleteUnsupported(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 501 || (err.status === 404 && err.message === 'not found'))
}

/** A 409 from POST …/delete carries the fresh plan: show it instead of an error. */
export function refusedPlan(err: unknown): WorktreeInspect | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null
  const d = err.data as (WorktreeInspect & { refused?: string }) | null
  return d && typeof d === 'object' && d.action ? d : null
}

const MAX_KEPT_LISTED = 3

/** "node 1234 · :4250 :4251" — a process tree Delete stops (or stopped). */
export function serverText(t: { label: string; pid: number; ports: number[] }): string {
  const ports = t.ports.map((p) => `:${p}`).join(' ')
  return `${t.label || 'pid'} ${t.pid}${ports ? ` · ${ports}` : ''}`
}

/** "puma-dev app-x.productive.io" / "watchman root ~/wt/app" — a leftover. */
export function leftoverText(l: { kind: LeftoverPlan['kind']; name: string }): string {
  return l.kind === 'watchman' ? `watchman root ${shortCwd(l.name, 60)}` : `${l.kind} ${l.name}`
}

export interface DevLine {
  key: string
  text: string
  /** Secondary text: a stopped process's command, why a leftover stays. */
  detail: string | null
}

export interface DevPlan {
  /** Stopped before the worktree is removed. */
  stop: DevLine[]
  /** "zsh 140 (tmux other), …" — inside the worktree but left running; null when none. */
  kept: string | null
  /** Cleaned after the worktree is removed (`detail`: why one stays). */
  clean: DevLine[]
  /** The host could not list its processes: nothing will be stopped. */
  error: string | null
}

/** What the Delete dialog lists besides the worktree: servers stopped first, leftovers cleaned after. Empty for an older server. */
export function devPlan(w: WorktreeInspect): DevPlan {
  const servers = w.servers ?? { stop: [], kept: [], error: null }
  const kept = servers.kept.slice(0, MAX_KEPT_LISTED).map((k) => `${k.label} ${k.pid} (${k.via})`)
  if (servers.kept.length > MAX_KEPT_LISTED) kept.push(`+${servers.kept.length - MAX_KEPT_LISTED} more`)
  return {
    stop: servers.stop.map((t) => ({ key: `${t.pgid ? 'g' : 'p'}${t.pgid ?? t.pid}`, text: serverText(t), detail: t.command })),
    kept: kept.length ? kept.join(', ') : null,
    clean: (w.leftovers ?? []).map((l) => ({ key: `${l.kind}:${l.name}`, text: leftoverText(l), detail: l.keep ? `kept: ${l.keep}` : null })),
    error: servers.error,
  }
}

/** What a delete did besides the worktree: what went, and what did not. */
export function devOutcome(res: DeleteResponse): { done: string[]; problems: string[] } {
  const stopped = res.servers?.stopped ?? []
  const failed = stopped.filter((t) => t.result === 'failed')
  const ended = stopped.filter((t) => t.result !== 'failed' && t.result !== 'gone')
  const left = res.leftovers ?? []
  const cleaned = left.filter((l) => l.result === 'removed')
  const done = [ended.length ? `stopped ${plural(ended.length, 'server')}` : '', cleaned.length ? `cleaned ${plural(cleaned.length, 'leftover')}` : ''].filter(Boolean)
  const problems = [
    res.servers?.error ?? '',
    ...failed.map((t) => `${serverText(t)} still running${t.error ? ` (${t.error})` : ''}`),
    ...left.filter((l) => l.result === 'failed').map((l) => `${leftoverText(l)}: ${l.note ?? 'failed'}`),
  ].filter(Boolean)
  return { done, problems }
}

export interface DeleteToast {
  tone: 'success' | 'warning'
  title: string
  description: string
}

export function deleteToast(res: DeleteResponse, name: string): DeleteToast {
  const wt = res.worktree
  if (!wt) return { tone: 'success', title: `Closed ${name}`, description: 'Its directory was left alone' }
  const { done, problems } = devOutcome(res)
  const tail = [...done, ...problems].map((s) => ` · ${s}`).join('')
  if (!wt.removed) return { tone: 'warning', title: `Closed ${name}, worktree kept`, description: `${wt.error || 'git worktree remove failed'}${tail}` }
  const branch = wt.branch ? ` · branch ${wt.branch} ${wt.branchDeleted ? 'deleted' : 'kept'}` : ''
  return { tone: problems.length ? 'warning' : 'success', title: `Deleted ${name}`, description: `Removed ${shortCwd(wt.path)}${wt.forced ? ' (forced)' : ''}${branch}${tail}` }
}
