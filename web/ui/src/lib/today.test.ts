import { describe, expect, test } from 'vitest'

import type { FleetResponse, PullRequest, Session, Task } from '@/api/types'

import { linkTasks } from './links'
import { isTodayLocation, needsYou, prActions, prsNeedingAction, reviewRequests, tasksInProgress } from './today'

const s = (host: string, id: string, status: string, extra: Partial<Session> = {}): Session => ({ host, session_id: id, status, ...extra })
const fleet = (sessions: Session[]): FleetResponse => ({ self: 'laptop', hosts: [{ name: 'laptop', ok: true, sessions }] }) as unknown as FleetResponse

const pr = (n: number, extra: Partial<PullRequest> = {}): PullRequest =>
  ({
    column: 'reviewMine',
    owner: 'o',
    repo: 'r',
    number: n,
    title: `PR ${n}`,
    url: `https://github.com/o/r/pull/${n}`,
    author: 'me',
    draft: false,
    reviewDecision: null,
    checks: null,
    ...extra,
  }) as PullRequest

const task = (id: string): Task => ({
  id,
  number: id,
  title: `Task ${id}`,
  url: `https://app.example.com/tasks/${id}`,
  project: null,
  status: 'In progress',
  statusCategory: 'started',
  dueDate: null,
  updatedAt: null,
})

test('isTodayLocation', () => {
  expect(isTodayLocation('/today')).toBe(true)
  expect(isTodayLocation('/tasks')).toBe(false)
})

describe('needsYou', () => {
  test('only waiting sessions, job sessions included, most recent first', () => {
    const out = needsYou(
      fleet([
        s('laptop', 'a', 'waiting', { updated_at: 1 }),
        s('laptop', 'b', 'busy', { updated_at: 5 }),
        s('laptop', 'c', 'waiting', { updated_at: 9, origin: { job: 'nightly' } as Session['origin'] }),
        s('laptop', 'd', 'shell'),
      ]),
    )
    expect(out.map((x) => x.session_id)).toEqual(['c', 'a'])
  })
  test('no fleet: nothing', () => {
    expect(needsYou(null)).toEqual([])
  })
})

describe('tasksInProgress', () => {
  test('tasks with live sessions, waiting first, each with its PRs', () => {
    const tasks = [task('1'), task('2'), task('3')]
    const sessions = [
      s('laptop', 'x', 'busy', { promptLinks: ['https://app.example.com/tasks/1'] }),
      s('laptop', 'y', 'waiting', { promptLinks: ['https://app.example.com/tasks/2'] }),
    ]
    const prs = [pr(7, { links: ['https://app.example.com/tasks/1'] })]
    const out = tasksInProgress(tasks, linkTasks(tasks, sessions, prs))
    expect(out.map((t) => [t.task.id, t.activity.state, t.prs.map((p) => p.number)])).toEqual([
      ['2', 'waiting', []],
      ['1', 'working', [7]],
    ])
  })
  test('tasks off: nothing', () => {
    expect(tasksInProgress(null, linkTasks(null, [], []))).toEqual([])
  })
})

describe('reviewRequests', () => {
  test('the waitingOnMe column, other people’s drafts left out', () => {
    const prs = [
      pr(1, { column: 'waitingOnMe', author: 'ana' }),
      pr(2, { column: 'waitingOnMe', author: 'ana', draft: true }),
      pr(3, { column: 'reviewMine' }),
      pr(4, { column: 'waitingOnAuthor', author: 'ana' }),
    ]
    expect(reviewRequests(prs, 'me').map((p) => p.number)).toEqual([1])
    expect(reviewRequests(undefined, 'me')).toEqual([])
  })
})

describe('prActions / prsNeedingAction', () => {
  test('changes requested and failing checks on your PRs', () => {
    expect(prActions(pr(1, { reviewDecision: 'changesRequested' }), 'me')).toEqual(['changesRequested'])
    expect(prActions(pr(1, { column: 'draftMine', checks: 'failure' }), 'me')).toEqual(['checksFailing'])
    expect(prActions(pr(1, { column: 'readyToMergeMine', checks: 'error', reviewDecision: 'changesRequested' }), 'me')).toEqual(['changesRequested', 'checksFailing'])
  })
  test('passing / pending checks and approvals need nothing', () => {
    expect(prActions(pr(1, { checks: 'success', reviewDecision: 'approved' }), 'me')).toEqual([])
    expect(prActions(pr(1, { checks: 'pending' }), 'me')).toEqual([])
  })
  test('someone else’s PR only for an unseen mention', () => {
    expect(prActions(pr(1, { column: 'waitingOnMe', author: 'ana', checks: 'failure', reviewDecision: 'changesRequested' }), 'me')).toEqual([])
    expect(prActions(pr(1, { column: 'unseenMentions', author: 'ana', checks: 'failure' }), 'me')).toEqual(['mention'])
  })
  test('your own PR with an unseen mention keeps its other reasons (author match, any case)', () => {
    expect(prActions(pr(1, { column: 'unseenMentions', author: 'Me', checks: 'failure' }), 'me')).toEqual(['mention', 'checksFailing'])
  })
  test('in the server’s order, only those with a reason', () => {
    const prs = [pr(1, { checks: 'failure' }), pr(2), pr(3, { column: 'unseenMentions', author: 'ana' })]
    expect(prsNeedingAction(prs, 'me').map((x) => [x.pr.number, x.actions])).toEqual([
      [1, ['checksFailing']],
      [3, ['mention']],
    ])
  })
})
