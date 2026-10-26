// The Today screen (`#/today`): what needs you across sessions, tasks and PRs, in one place — pure,
// unit-tested in today.test.ts. It only reads what the providers already hold (fleet, tasks + links, PRs).
import type { FleetResponse, PullRequest, Session, Task } from '@/api/types'
import type { TaskLinks } from '@/lib/links'
import { checksTone, isOthersDraft } from '@/lib/prs'
import { allSessions, byLastActivity, statusMeta } from '@/lib/sessions'
import { activeTasks, type TaskActivity } from '@/lib/tasks'

/** `#/today` */
export const isTodayLocation = (location: string) => location === '/today'

/** Every session waiting on you (job sessions too), most recent first. */
export const needsYou = (fleet: FleetResponse | null | undefined): Session[] =>
  allSessions(fleet)
    .filter((s) => statusMeta(s.status).key === 'waiting')
    .sort(byLastActivity)

export interface TaskInProgress {
  task: Task
  activity: TaskActivity
  /** The PRs whose description links it. */
  prs: PullRequest[]
}

/** Your tasks with live sessions (lib/tasks.ts activeTasks: waiting → working → idle), each with its PRs. */
export const tasksInProgress = (tasks: readonly Task[] | null | undefined, links: Pick<TaskLinks, 'sessionsByTask' | 'prsByTask'>): TaskInProgress[] =>
  activeTasks(tasks, links).map(({ task, activity }) => ({ task, activity, prs: links.prsByTask.get(task.id) ?? [] }))

/** PRs where your review is requested (`fleet prs` column `waitingOnMe`) — other people's drafts left out, as on the PR board. */
export const reviewRequests = (prs: readonly PullRequest[] | null | undefined, user: string): PullRequest[] =>
  (prs ?? []).filter((p) => p.column === 'waitingOnMe' && !isOthersDraft(p, user))

export type PrAction = 'mention' | 'changesRequested' | 'checksFailing'

export const PR_ACTION_LABEL: Record<PrAction, string> = { mention: 'unseen mention', changesRequested: 'changes requested', checksFailing: 'checks failing' }

const MINE = new Set<string>(['reviewMine', 'readyToMergeMine', 'draftMine'])
const isMine = (p: PullRequest, user: string) => MINE.has(p.column) || (!!user && p.author.toLowerCase() === user.toLowerCase())

/**
 * Why a PR needs you to act: an unseen @mention of you (any PR — column `unseenMentions`), or, on your own PR,
 * changes requested or failing checks. Empty: nothing to do.
 */
export function prActions(p: PullRequest, user: string): PrAction[] {
  const out: PrAction[] = []
  if (p.column === 'unseenMentions') out.push('mention')
  if (isMine(p, user)) {
    if (p.reviewDecision === 'changesRequested') out.push('changesRequested')
    if (checksTone(p.checks) === 'bad') out.push('checksFailing')
  }
  return out
}

/** Your PRs (and unseen mentions) that need you to act, with why — in the server's order. */
export const prsNeedingAction = (prs: readonly PullRequest[] | null | undefined, user: string): { pr: PullRequest; actions: PrAction[] }[] =>
  (prs ?? []).flatMap((pr) => {
    const actions = prActions(pr, user)
    return actions.length ? [{ pr, actions }] : []
  })
