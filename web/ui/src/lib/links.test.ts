import { describe, expect, it } from 'vitest'

import type { FleetResponse, PullRequest, Session, Task } from '@/api/types'

import { linkTasks, MIN_TASK_MENTIONS, NO_TASK_LINKS, pickerTasks, sessionLinks, taskRefOf, urlsIn, withManualTask } from './links'

const APP = 'https://app.example.com/1-acme'

const task = (id: string, o: Partial<Task> = {}): Task => ({
  id,
  number: `${id}0`,
  title: `Task ${id}`,
  url: `${APP}/tasks/${id}`,
  project: null,
  status: 'In progress',
  statusCategory: 'started',
  dueDate: null,
  updatedAt: null,
  ...o,
})

const session = (id: string, o: Partial<Session> = {}): Session => ({ host: 'ws', session_id: id, ...o })

const pr = (n: number, links?: string[]): PullRequest =>
  ({ number: n, url: `https://github.com/acme/app/pull/${n}`, ...(links ? { links } : {}) }) as PullRequest

describe('urlsIn', () => {
  it('finds distinct http(s) URLs, without markdown or sentence punctuation around them', () => {
    expect(urlsIn(`Task: ${APP}/tasks/42.\nSee [doc](https://docs.example.com/a?b=1#c), <HTTPS://x.example/y>, again ${APP}/tasks/42`)).toEqual([
      `${APP}/tasks/42`,
      'https://docs.example.com/a?b=1#c',
      'HTTPS://x.example/y',
    ])
    expect(urlsIn('http:// httpd ftp://x mailto:a@b.c')).toEqual([])
    expect(urlsIn(null)).toEqual([])
  })
})

describe('taskRefOf', () => {
  it('reads the task id from every URL shape a task link takes', () => {
    for (const url of [
      `${APP}/tasks/42`,
      `${APP}/tasks/42/`,
      `${APP}/tasks/42/activity`,
      `${APP}/tasks/42?filter=1#comment-3`,
      `${APP}/tasks/task/42`,
      'HTTPS://APP.EXAMPLE.COM/1-acme/tasks/42',
    ]) {
      expect(taskRefOf(url), url).toEqual({ origin: 'https://app.example.com', id: '42' })
    }
  })

  it('is null for anything that names no task', () => {
    for (const url of [`${APP}/tasks`, `${APP}/tasks/42abc`, `${APP}/tasks/new`, `${APP}/projects/42`, 'not a url', 'ftp://app.example.com/tasks/42']) {
      expect(taskRefOf(url), url).toBeNull()
    }
  })
})

describe('sessionLinks', () => {
  it('prefers the server’s promptLinks, else reads the (trimmed) title', () => {
    expect(sessionLinks({ promptLinks: [`${APP}/tasks/1`], title: `${APP}/tasks/2` })).toEqual([`${APP}/tasks/1`])
    expect(sessionLinks({ promptLinks: [], title: `${APP}/tasks/2` })).toEqual([])
    expect(sessionLinks({ title: `/orchestrate ${APP}/tasks/2\nfix it` })).toEqual([`${APP}/tasks/2`])
    expect(sessionLinks({ title: null })).toEqual([])
  })
})

describe('linkTasks', () => {
  const tasks = [task('1'), task('2')]

  it('links every session whose first prompt names a task, on any host', () => {
    const sessions = [
      session('a', { title: `${APP}/tasks/1\nTask 1` }),
      session('b', { host: 'laptop', title: 'later', promptLinks: ['https://docs.example.com/x', `${APP}/tasks/1/activity`] }),
      session('c', { title: 'no link' }),
      session('d', { title: `${APP}/tasks/2` }),
    ]
    const l = linkTasks(tasks, sessions, [])
    expect(l.sessionsByTask.get('1')?.map((s) => `${s.host}/${s.session_id}`)).toEqual(['ws/a', 'laptop/b'])
    expect(l.sessionsByTask.get('2')?.map((s) => s.session_id)).toEqual(['d'])
    expect(l.taskBySession.get('laptop/b')?.id).toBe('1')
    expect(l.taskBySession.has('ws/c')).toBe(false)
  })

  it('ignores unknown task ids, other origins and rows without a session id', () => {
    const sessions = [
      session('a', { title: `${APP}/tasks/99` }),
      session('b', { title: 'https://elsewhere.example/1-acme/tasks/1' }),
      session('', { title: `${APP}/tasks/1` }),
    ]
    const l = linkTasks(tasks, sessions, [pr(5, [`${APP}/tasks/99`])])
    expect(l.sessionsByTask.size).toBe(0)
    expect(l.taskBySession.size).toBe(0)
    expect(l.prsByTask.size).toBe(0)
  })

  it('a prompt or PR naming several tasks is listed under each, its chip the first known one', () => {
    const l = linkTasks(tasks, [session('a', { title: `${APP}/tasks/99 ${APP}/tasks/2 and ${APP}/tasks/1` })], [pr(7, [`${APP}/tasks/2`, `${APP}/tasks/1`])])
    expect(l.taskBySession.get('ws/a')?.id).toBe('2')
    expect(l.sessionsByTask.get('1')?.length).toBe(1)
    expect(l.sessionsByTask.get('2')?.length).toBe(1)
    expect(l.taskByPr.get('https://github.com/acme/app/pull/7')?.id).toBe('2')
    expect(l.prsByTask.get('1')?.map((p) => p.number)).toEqual([7])
  })

  it('links PRs by their description’s links; older servers send none', () => {
    const l = linkTasks(tasks, [], [pr(5, [`${APP}/tasks/1`]), pr(6, [`${APP}/tasks/1?x=1`]), pr(8)])
    expect(l.prsByTask.get('1')?.map((p) => p.number)).toEqual([5, 6])
    expect(l.taskByPr.size).toBe(2)
  })

  describe('by transcript mentions', () => {
    const mentions = (...pairs: [string, number][]) => pairs.map(([id, count]) => ({ url: `${APP}/tasks/${id}`, count }))

    it('links the open task a session mentions most, from MIN_TASK_MENTIONS on (a PR link first)', () => {
      expect(MIN_TASK_MENTIONS).toBe(3)
      const mayfly = session('mayfly', { title: 'https://github.com/acme/app/pull/9', promptLinks: ['https://github.com/acme/app/pull/9'], taskMentions: mentions(['2', 3], ['1', 2]) })
      const l = linkTasks(tasks, [mayfly], [])
      expect(l.taskBySession.get('ws/mayfly')?.id).toBe('2')
      expect(l.sessionsByTask.get('2')?.map((s) => s.session_id)).toEqual(['mayfly'])
      expect(l.sessionsByTask.has('1')).toBe(false)
      const below = session('b', { taskMentions: mentions(['2', 2], ['1', 1]) })
      expect(linkTasks(tasks, [below], []).taskBySession.has('ws/b')).toBe(false)
    })

    it('a session that mentions many tasks a few times each links none', () => {
      const many = [task('1'), task('2'), task('3'), task('4'), task('5')]
      const orchestrator = session('o', { taskMentions: mentions(['1', 1], ['2', 1], ['3', 1], ['4', 1], ['5', 1]) })
      const l = linkTasks(many, [orchestrator], [])
      expect(l.taskBySession.size).toBe(0)
      expect(l.sessionsByTask.size).toBe(0)
    })

    it('ties at the top link each tied task; the chip is the first', () => {
      const l = linkTasks([task('1'), task('2'), task('3')], [session('t', { taskMentions: mentions(['2', 4], ['1', 4], ['3', 3]) })], [])
      expect(l.taskBySession.get('ws/t')?.id).toBe('2')
      expect(l.sessionsByTask.get('1')?.length).toBe(1)
      expect(l.sessionsByTask.get('2')?.length).toBe(1)
      expect(l.sessionsByTask.has('3')).toBe(false)
    })

    it('the first-prompt link keeps the chip and coexists with the most-mentioned task', () => {
      const both = session('a', { title: `/orchestrate ${APP}/tasks/1`, taskMentions: mentions(['2', 5], ['1', 2]) })
      const same = session('b', { title: `${APP}/tasks/1`, taskMentions: mentions(['1', 7]) })
      const l = linkTasks(tasks, [both, same], [])
      expect(l.taskBySession.get('ws/a')?.id).toBe('1')
      expect(l.sessionsByTask.get('1')?.map((s) => s.session_id)).toEqual(['a', 'b'])
      expect(l.sessionsByTask.get('2')?.map((s) => s.session_id)).toEqual(['a'])
    })

    it('ignores mentions of unknown tasks and other origins: the top among YOUR tasks counts', () => {
      const s = session('u', {
        taskMentions: [
          { url: `${APP}/tasks/99`, count: 20 },
          { url: 'https://elsewhere.example/1-acme/tasks/2', count: 10 },
          { url: `${APP}/tasks/task/1`, count: 2 },
          { url: `${APP}/tasks/1/activity`, count: 1 },
          { url: 'not a url', count: 50 },
        ],
      })
      const l = linkTasks(tasks, [s], [])
      expect(l.taskBySession.get('ws/u')?.id).toBe('1')
      expect(l.sessionsByTask.has('2')).toBe(false)
    })
  })

  it('no tasks (not configured, not loaded) → nothing', () => {
    expect(linkTasks(null, [session('a', { title: `${APP}/tasks/1` })], [])).toBe(NO_TASK_LINKS)
    expect(linkTasks([], [], [])).toBe(NO_TASK_LINKS)
  })
})

describe('manual task links', () => {
  const tasks = [task('1'), task('2'), task('3')]
  const mentions = (...m: [string, number][]) => m.map(([id, count]) => ({ url: `${APP}/tasks/${id}`, count }))

  it('a manual link wins over the first prompt and mentions, alone, and is marked manual', () => {
    const s = session('m', { title: `${APP}/tasks/1`, taskMentions: mentions(['2', 9]), manualTask: { id: '3' } })
    const auto = session('a', { title: `${APP}/tasks/1` })
    const l = linkTasks(tasks, [s, auto], [])
    expect(l.taskBySession.get('ws/m')?.id).toBe('3')
    expect(l.sessionsByTask.get('3')?.map((x) => x.session_id)).toEqual(['m'])
    expect(l.sessionsByTask.get('1')?.map((x) => x.session_id)).toEqual(['a'])
    expect(l.sessionsByTask.has('2')).toBe(false)
    expect([...l.manualSessions]).toEqual(['ws/m'])
  })

  it('{ id: null } links nothing, automatic links included', () => {
    const s = session('n', { title: `${APP}/tasks/1`, taskMentions: mentions(['2', 9]), manualTask: { id: null } })
    const l = linkTasks(tasks, [s], [])
    expect(l.taskBySession.has('ws/n')).toBe(false)
    expect(l.sessionsByTask.size).toBe(0)
    expect(l.manualSessions.size).toBe(0)
  })

  it('a manual link to a task not in your list is ignored: the automatic links apply', () => {
    const s = session('u', { title: `${APP}/tasks/1`, manualTask: { id: '99' } })
    const l = linkTasks(tasks, [s], [])
    expect(l.taskBySession.get('ws/u')?.id).toBe('1')
    expect(l.manualSessions.size).toBe(0)
  })

  it('pickerTasks filters by title, #number, project or status and puts the current task first', () => {
    const list = [task('1', { title: 'Fix login' }), task('2', { project: 'Website' }), task('3', { status: 'Review' })]
    expect(pickerTasks(list, '').map((t) => t.id)).toEqual(['1', '2', '3'])
    expect(pickerTasks(list, '', '3').map((t) => t.id)).toEqual(['3', '1', '2'])
    expect(pickerTasks(list, ' LOGIN ').map((t) => t.id)).toEqual(['1'])
    expect(pickerTasks(list, '#20').map((t) => t.id)).toEqual(['2'])
    expect(pickerTasks(list, 'website').map((t) => t.id)).toEqual(['2'])
    expect(pickerTasks(list, 'review', '1').map((t) => t.id)).toEqual(['3'])
    expect(pickerTasks(null, 'x')).toEqual([])
  })

  it('withManualTask sets or removes one session\'s manualTask, leaving the rest alone', () => {
    const fleet = {
      self: 'ws',
      hosts: [
        { name: 'ws', ok: true, sessions: [session('a'), session('b', { manualTask: { id: '1' } })] },
        { name: 'lap', ok: true, sessions: [{ ...session('a'), host: 'lap' }] },
      ],
    } as FleetResponse
    const linked = withManualTask(fleet, 'ws', 'a', { id: '2' })
    expect(linked.hosts[0].sessions[0].manualTask).toEqual({ id: '2' })
    expect(linked.hosts[1].sessions[0].manualTask).toBeUndefined()
    expect(linked.hosts[0].sessions[1]).toBe(fleet.hosts[0].sessions[1])
    const cleared = withManualTask(fleet, 'ws', 'b', undefined)
    expect('manualTask' in cleared.hosts[0].sessions[1]).toBe(false)
  })
})
