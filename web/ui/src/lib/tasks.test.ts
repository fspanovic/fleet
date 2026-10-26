import { describe, expect, it } from 'vitest'

import type { Task } from '@/api/types'
import { PALETTES } from './palettes'
import type { PullRequest, Session, TaskQuickStart } from '@/api/types'
import {
  activeTasks,
  activityRank,
  dueLabel,
  findStatusByName,
  focusTasks,
  groupTasks,
  isTasksLocation,
  NO_TASK_FOCUS,
  normalizeQuickStarts,
  parseHiddenStatuses,
  parseTasksGroupBy,
  quickStartRequest,
  quickStartStatusPlan,
  renderTaskPrompt,
  replaceTask,
  statusChangeQuestion,
  sessionTasksFirst,
  sessionTasksFirstInGroups,
  TASK_COLORS,
  taskColor,
  taskColorStyle,
  taskFocusActive,
  taskPrompt,
  taskActivity,
  taskRef,
  taskStatuses,
  taskTooltip,
  toggleHiddenStatus,
} from './tasks'

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  number: id,
  title: `Task ${id}`,
  url: `https://app.example/1-acme/tasks/${id}`,
  project: 'Website',
  status: 'To do',
  statusCategory: 'notStarted',
  dueDate: null,
  updatedAt: 1,
  ...over,
})

describe('isTasksLocation', () => {
  it('matches #/tasks only', () => {
    expect(isTasksLocation('/tasks')).toBe(true)
    expect(isTasksLocation('/tasks/12')).toBe(false)
    expect(isTasksLocation('/tasksx')).toBe(false)
    expect(isTasksLocation('/')).toBe(false)
  })
})

describe('taskPrompt', () => {
  it('is the link, then the title', () => {
    expect(taskPrompt(task('7', { title: 'Fix the login' }))).toBe('https://app.example/1-acme/tasks/7\nFix the login')
  })
})

describe('groupTasks', () => {
  const tasks = [
    task('1', { status: 'To do' }),
    task('2', { status: 'In progress', statusCategory: 'started', project: 'Mobile app' }),
    task('3', { status: 'Review', statusCategory: 'started' }),
    task('4', { status: null, statusCategory: null }),
    task('5', { status: 'In progress', statusCategory: 'started' }),
    task('6', { status: 'Backlog' }),
  ]

  it('groups by status: started first, then not started, by name; no status last; order kept inside', () => {
    const g = groupTasks(tasks)
    expect(g.map((x) => x.title)).toEqual(['In progress', 'Review', 'Backlog', 'To do', 'No status'])
    expect(g[0].tasks.map((t) => t.id)).toEqual(['2', '5'])
  })

  it('filters by title, #number, project and status, any case', () => {
    expect(groupTasks(tasks, 'mobile').flatMap((x) => x.tasks.map((t) => t.id))).toEqual(['2'])
    expect(groupTasks(tasks, '#6').flatMap((x) => x.tasks.map((t) => t.id))).toEqual(['6'])
    expect(groupTasks(tasks, 'REVIEW').map((x) => x.title)).toEqual(['Review'])
    expect(groupTasks(tasks, 'task 4').map((x) => x.title)).toEqual(['No status'])
    expect(groupTasks(tasks, 'nothing like it')).toEqual([])
  })

  it('handles nothing', () => {
    expect(groupTasks(null)).toEqual([])
    expect(groupTasks(null, '', 'project')).toEqual([])
  })

  it('colours a status group with its first coloured task', () => {
    const g = groupTasks([
      task('1', { status: 'Working', statusCategory: 'started', statusColor: null }),
      task('2', { status: 'Working', statusCategory: 'started', statusColor: 'yellow' }),
      task('3', { status: 'Backlog', statusColor: 'concrete' }),
      task('4', { status: 'Triage' }),
    ])
    expect(g.map((x) => [x.title, x.color])).toEqual([
      ['Working', 'yellow'],
      ['Backlog', 'concrete'],
      ['Triage', null],
    ])
  })
})

describe('groupTasks by project', () => {
  const tasks = [
    task('1', { project: 'Website', updatedAt: 50 }),
    task('2', { project: 'Mobile app', status: 'Working', statusCategory: 'started', updatedAt: 10, projectColor: 'green' }),
    task('3', { project: 'Website', status: 'Working', statusCategory: 'started', updatedAt: 20, projectColor: 'burgundy' }),
    task('4', { project: null, status: 'Working', statusCategory: 'started', updatedAt: 99 }),
    task('5', { project: 'Website', status: 'Review', statusCategory: 'started', updatedAt: 30, projectColor: 'burgundy' }),
    task('6', { project: 'Admin', updatedAt: 70 }),
    task('7', { project: 'Mobile app', status: 'Done', statusCategory: 'closed', updatedAt: 80 }),
    task('8', { project: 'Mobile app', updatedAt: null }),
    task('9', { project: 'Mobile app', updatedAt: 40 }),
  ]

  it('orders projects by started tasks, then by name; no project last', () => {
    const g = groupTasks(tasks, '', 'project')
    expect(g.map((x) => x.title)).toEqual(['Website', 'Mobile app', 'Admin', 'No project'])
    expect(g.map((x) => x.tasks.length)).toEqual([3, 4, 1, 1])
  })

  it('orders tasks started → not started → the rest, newest first within each', () => {
    const g = groupTasks(tasks, '', 'project')
    expect(g[0].tasks.map((t) => t.id)).toEqual(['5', '3', '1'])
    expect(g[1].tasks.map((t) => t.id)).toEqual(['2', '9', '8', '7'])
  })

  it('takes the first project colour it sees; none stays null', () => {
    const g = groupTasks(tasks, '', 'project')
    expect(g.map((x) => x.color)).toEqual(['burgundy', 'green', null, null])
  })

  it('filters the same way', () => {
    expect(groupTasks(tasks, 'admin', 'project').map((x) => x.title)).toEqual(['Admin'])
    expect(groupTasks(tasks, 'review', 'project').flatMap((x) => x.tasks.map((t) => t.id))).toEqual(['5'])
  })

  it('does not reorder the caller’s array', () => {
    groupTasks(tasks, '', 'project')
    expect(tasks.map((t) => t.id)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9'])
  })
})

describe('parseTasksGroupBy', () => {
  it('knows status and project only', () => {
    expect(parseTasksGroupBy('status')).toBe('status')
    expect(parseTasksGroupBy('project')).toBe('project')
    expect(parseTasksGroupBy('Project')).toBeUndefined()
    expect(parseTasksGroupBy('')).toBeUndefined()
    expect(parseTasksGroupBy(null)).toBeUndefined()
  })
})

describe('task colours', () => {
  it('maps every Productive palette name but white; anything else is neutral', () => {
    expect(Object.keys(TASK_COLORS).sort()).toEqual(
      ['azure', 'blue', 'burgundy', 'canary', 'celtic-blue', 'concrete', 'cyan', 'electric', 'fuchsia', 'green', 'lime-green', 'logan', 'orange', 'red', 'turquoise', 'yellow'],
    )
    expect(taskColor('yellow')).toEqual({ light: '#8c6d00', dark: '#b39c4a' })
    expect(taskColor('white')).toBeNull()
    expect(taskColor('toString')).toBeNull()
    expect(taskColor(null)).toBeNull()
    expect(taskColor(undefined)).toBeNull()
  })

  it('taskColorStyle carries both modes as CSS variables', () => {
    expect(taskColorStyle('logan')).toEqual({ '--tc-l': '#505694', '--tc-d': '#8f95c6' })
    expect(taskColorStyle('nope')).toBeUndefined()
  })

  // Dots and tints are non-text graphics: at least 3:1 against every palette's background and card.
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  }
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (hi + 0.05) / (lo + 0.05)
  }
  it('reads on every palette in both modes', () => {
    const low: string[] = []
    for (const [name, c] of Object.entries(TASK_COLORS)) {
      for (const p of PALETTES) {
        for (const mode of ['light', 'dark'] as const) {
          for (const surface of ['background', 'card'] as const) {
            const bg = p.swatch[mode][surface]
            const r = contrast(c[mode], bg)
            if (r < 3) low.push(`${name} on ${p.id} ${mode} ${surface} ${bg}: ${r.toFixed(2)}`)
          }
        }
      }
    }
    expect(low).toEqual([])
  })
})

describe('dueLabel', () => {
  const now = new Date(2026, 4, 10, 15, 0).getTime()
  it('names the near days and marks overdue / soon', () => {
    expect(dueLabel('2026-05-10', now)).toEqual({ label: 'Today', tone: 'soon' })
    expect(dueLabel('2026-05-11', now)).toEqual({ label: 'Tomorrow', tone: 'soon' })
    expect(dueLabel('2026-05-09', now)).toEqual({ label: 'Yesterday', tone: 'overdue' })
    expect(dueLabel('2026-05-01', now)?.tone).toBe('overdue')
    expect(dueLabel('2026-06-01', now)?.tone).toBeNull()
  })
  it('shows the year only when it is not this one', () => {
    expect(dueLabel('2027-01-02', now)?.label).toMatch(/2027/)
    expect(dueLabel('2026-06-01', now)?.label).not.toMatch(/2026/)
  })
  it('no date, no label', () => {
    expect(dueLabel(null, now)).toBeNull()
    expect(dueLabel('soon', now)).toBeNull()
  })
})

describe('taskTooltip', () => {
  it('names the task, its status and project when known', () => {
    expect(taskTooltip({ id: '9', number: '12', title: 'Fix login', status: 'In progress', project: 'App' })).toBe('#12 Fix login — In progress · App (open in Productive)')
    expect(taskTooltip({ id: '9', number: null, title: 'Fix login', status: null, project: null })).toBe('#9 Fix login (open in Productive)')
  })
})

describe('renderTaskPrompt', () => {
  const t = task('42', { number: '1234', title: 'Fix the {url} parser', url: 'https://app.example/1-acme/tasks/42' })
  it('fills url, title, number and id', () => {
    expect(renderTaskPrompt('/orchestrate {url}', t)).toBe('/orchestrate https://app.example/1-acme/tasks/42')
    expect(renderTaskPrompt('#{number} ({id}) {title}\n{url}', t)).toBe('#1234 (42) Fix the {url} parser\nhttps://app.example/1-acme/tasks/42')
  })
  it('replaces every occurrence in one pass (the title’s own braces stay)', () => {
    expect(renderTaskPrompt('{id} {id} {title}', t)).toBe('42 42 Fix the {url} parser')
  })
  it('leaves anything else alone; no number → empty', () => {
    expect(renderTaskPrompt('{URL} { url } {other} {"a": 1}', t)).toBe('{URL} { url } {other} {"a": 1}')
    expect(renderTaskPrompt('#{number}', { ...t, number: null })).toBe('#')
  })
})

const qs = (over: Partial<TaskQuickStart> = {}): TaskQuickStart => ({
  id: '0',
  label: 'Orchestrate',
  prompt: '/orchestrate {url}',
  dir: '/home/me/work',
  dirLabel: 'work',
  model: null,
  worktree: false,
  ...over,
})

describe('quickStartRequest', () => {
  const t = task('42')
  it('is the spawn body: dir + rendered prompt, no name; model / worktree only when set', () => {
    expect(quickStartRequest(qs(), t)).toEqual({ dir: '/home/me/work', prompt: '/orchestrate https://app.example/1-acme/tasks/42' })
    expect(quickStartRequest(qs({ model: 'claude-opus-5-5', worktree: true }), t)).toEqual({
      dir: '/home/me/work',
      prompt: '/orchestrate https://app.example/1-acme/tasks/42',
      model: 'claude-opus-5-5',
      worktree: true,
    })
  })
  it('null when its directory is gone on the server', () => {
    expect(quickStartRequest(qs({ dir: null, error: 'gone' }), t)).toBeNull()
    expect(quickStartRequest(qs({ error: 'gone' }), t)).toBeNull()
  })
})

describe('normalizeQuickStarts', () => {
  it('keeps the well-formed entries, defaults the optional fields', () => {
    expect(normalizeQuickStarts(undefined)).toEqual([])
    expect(normalizeQuickStarts({})).toEqual([])
    expect(
      normalizeQuickStarts([
        { id: '0', label: 'Orchestrate', prompt: '/orchestrate {url}', dir: '/w', dirLabel: 'work', model: null, worktree: false, setStatus: ' Working ' },
        { id: '1', label: 'B', prompt: 'x', dir: null, error: 'gone', worktree: 'yes', model: '', setStatus: 5 },
        null,
        { id: 2, label: 'C', prompt: 'x' },
        { id: '3', label: '', prompt: 'x' },
      ]),
    ).toEqual([
      { id: '0', label: 'Orchestrate', prompt: '/orchestrate {url}', dir: '/w', dirLabel: 'work', model: null, worktree: false, setStatus: 'Working' },
      { id: '1', label: 'B', prompt: 'x', dir: null, dirLabel: null, model: null, worktree: false, setStatus: null, error: 'gone' },
    ])
  })
})

describe('focus filters', () => {
  const tasks = [
    task('1', { status: 'Triage' }),
    task('2', { status: 'Backlog' }),
    task('3', { status: 'In progress', statusCategory: 'started' }),
    task('4', { status: null, statusCategory: null }),
    task('5', { status: 'In progress', statusCategory: 'started' }),
  ]
  const s = (id: string) => ({ host: 'laptop', session_id: id }) as Session
  const pr = (n: number) => ({ url: `https://github.com/o/r/pull/${n}` }) as PullRequest
  const links = { sessionsByTask: new Map([['3', [s('a')]], ['2', []]]), prsByTask: new Map([['5', [pr(1)]]]) }

  it('hides nothing by default (a copy, order kept)', () => {
    const r = focusTasks(tasks, NO_TASK_FOCUS, links)
    expect(r).toEqual({ tasks, hidden: 0 })
    expect(r.tasks).not.toBe(tasks)
    expect(taskFocusActive(NO_TASK_FOCUS)).toBe(false)
    expect(focusTasks(null, NO_TASK_FOCUS, links)).toEqual({ tasks: [], hidden: 0 })
  })
  it('hides statuses ("" = no status) and counts them', () => {
    const r = focusTasks(tasks, { ...NO_TASK_FOCUS, hiddenStatuses: ['Triage', 'Backlog', 'Gone'] }, links)
    expect(r.tasks.map((t) => t.id)).toEqual(['3', '4', '5'])
    expect(r.hidden).toBe(2)
    expect(focusTasks(tasks, { ...NO_TASK_FOCUS, hiddenStatuses: [''] }, links).tasks.map((t) => t.id)).toEqual(['1', '2', '3', '5'])
  })
  it('without session / without PR hide tasks a live session / a PR links (an empty list is none)', () => {
    expect(focusTasks(tasks, { ...NO_TASK_FOCUS, withoutSession: true }, links).tasks.map((t) => t.id)).toEqual(['1', '2', '4', '5'])
    expect(focusTasks(tasks, { ...NO_TASK_FOCUS, withoutPr: true }, links).tasks.map((t) => t.id)).toEqual(['1', '2', '3', '4'])
    const all = focusTasks(tasks, { hiddenStatuses: ['Triage'], withoutSession: true, withoutPr: true }, links)
    expect(all.tasks.map((t) => t.id)).toEqual(['2', '4'])
    expect(all.hidden).toBe(3)
  })
  it('works with either grouping (filter first, then group)', () => {
    const kept = focusTasks(tasks, { ...NO_TASK_FOCUS, hiddenStatuses: ['Triage', 'Backlog'] }, links).tasks
    expect(groupTasks(kept, '', 'status').map((g) => g.id)).toEqual(['In progress', ''])
    expect(groupTasks(kept, '', 'project').flatMap((g) => g.tasks.map((t) => t.id))).toEqual(['3', '5', '4'])
  })
  it('lists the statuses present in the status grouping’s order, with counts', () => {
    expect(taskStatuses(tasks)).toEqual([
      { id: 'In progress', title: 'In progress', color: null, count: 2 },
      { id: 'Backlog', title: 'Backlog', color: null, count: 1 },
      { id: 'Triage', title: 'Triage', color: null, count: 1 },
      { id: '', title: 'No status', color: null, count: 1 },
    ])
    expect(taskStatuses(undefined)).toEqual([])
  })
  it('parses the stored list (a JSON array of strings) and toggles one', () => {
    expect(parseHiddenStatuses('["Triage","Backlog","Triage",3]')).toEqual(['Triage', 'Backlog'])
    expect(parseHiddenStatuses('[]')).toEqual([])
    expect(parseHiddenStatuses('{"a":1}')).toBeUndefined()
    expect(parseHiddenStatuses('nope')).toBeUndefined()
    expect(parseHiddenStatuses(null)).toBeUndefined()
    expect(toggleHiddenStatus(['Triage'], 'Backlog', true)).toEqual(['Triage', 'Backlog'])
    expect(toggleHiddenStatus(['Triage', 'Backlog'], 'Triage', false)).toEqual(['Backlog'])
    expect(toggleHiddenStatus(['Triage'], 'Triage', true)).toEqual(['Triage'])
  })
})

describe('task activity', () => {
  const s = (id: string, status: string) => ({ host: 'laptop', session_id: id, status }) as Session
  const links = (m: Record<string, Session[]>) => ({ sessionsByTask: new Map(Object.entries(m)) })
  const busy = s('a', 'busy')
  const waiting = s('b', 'waiting')
  const idle = s('c', 'idle')
  const shell = s('d', 'shell')

  it('is null without a live session (an empty list is none)', () => {
    expect(taskActivity(task('1'), links({}))).toBeNull()
    expect(taskActivity(task('1'), links({ '1': [] }))).toBeNull()
  })
  it('every state is an activity; the strongest session names it: waiting → busy → idle / shell / unknown', () => {
    expect(taskActivity(task('1'), links({ '1': [idle, busy, waiting] }))).toEqual({ state: 'waiting', sessions: [waiting, busy, idle] })
    expect(taskActivity(task('1'), links({ '1': [idle, busy] }))).toEqual({ state: 'working', sessions: [busy, idle] })
    expect(taskActivity(task('1'), links({ '1': [shell, idle] }))).toEqual({ state: 'idle', sessions: [shell, idle] })
    expect(taskActivity(task('1'), links({ '1': [s('x', 'unknown')] }))?.state).toBe('idle')
    expect(taskActivity(task('1'), links({ '1': [s('x', 'BUSY')] }))?.state).toBe('working')
  })
  it('leaves the linked list as it is', () => {
    const list = [idle, waiting]
    taskActivity(task('1'), links({ '1': list }))
    expect(list).toEqual([idle, waiting])
  })
  it('activityRank: waiting 0, working 1, idle 2, none 3', () => {
    const l = links({ w: [waiting], b: [busy], i: [shell] })
    expect(['w', 'b', 'i', 'none'].map((id) => activityRank(taskActivity(task(id), l)))).toEqual([0, 1, 2, 3])
  })
  it('the band: every task a live session links (idle too), waiting → working → idle, task order kept within each', () => {
    const tasks = [task('1'), task('2'), task('3'), task('4'), task('5'), task('6')]
    const l = links({ '1': [s('a', 'busy')], '2': [s('b', 'idle')], '3': [s('c', 'waiting')], '5': [s('d', 'busy'), s('e', 'waiting')], '6': [s('f', 'shell')] })
    const band = activeTasks(tasks, l)
    expect(band.map((b) => [b.task.id, b.activity.state])).toEqual([
      ['3', 'waiting'],
      ['5', 'waiting'],
      ['1', 'working'],
      ['2', 'idle'],
      ['6', 'idle'],
    ])
    expect(band[1].activity.sessions.map((x) => x.session_id)).toEqual(['e', 'd'])
    expect(activeTasks(null, l)).toEqual([])
    expect(activeTasks(tasks, links({}))).toEqual([])
  })
  it('sessionTasksFirst: linked tasks on top in band order; the rest keep their order', () => {
    const tasks = ['1', '2', '3', '4', '5', '6'].map((id) => task(id))
    const l = links({ '2': [idle], '4': [busy], '6': [waiting] })
    expect(sessionTasksFirst(tasks, l).map((t) => t.id)).toEqual(['6', '4', '2', '1', '3', '5'])
    expect(sessionTasksFirst(tasks, links({})).map((t) => t.id)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(tasks.map((t) => t.id)).toEqual(['1', '2', '3', '4', '5', '6'])
  })
  it('in the groups: linked tasks on top of each group, groups and their counts unchanged (both groupings)', () => {
    const tasks = [
      task('1', { project: 'Website', status: 'In progress', statusCategory: 'started' }),
      task('2', { project: 'App', status: 'To do' }),
      task('3', { project: 'Website', status: 'To do' }),
      task('4', { project: 'App', status: 'In progress', statusCategory: 'started' }),
      task('5', { project: 'Website', status: 'To do' }),
    ]
    const l = links({ '3': [idle], '5': [waiting], '2': [busy] })
    for (const by of ['status', 'project'] as const) {
      const plain = groupTasks(tasks, '', by)
      const sorted = sessionTasksFirstInGroups(plain, l)
      expect(sorted.map((g) => [g.id, g.tasks.length])).toEqual(plain.map((g) => [g.id, g.tasks.length]))
      for (const [i, g] of sorted.entries()) {
        const linked = g.tasks.filter((t) => l.sessionsByTask.has(t.id)).map((t) => t.id)
        expect(g.tasks.slice(0, linked.length).map((t) => t.id)).toEqual(linked)
        expect(g.tasks.slice(linked.length).map((t) => t.id)).toEqual(plain[i].tasks.filter((t) => !l.sessionsByTask.has(t.id)).map((t) => t.id))
      }
    }
    const toDo = sessionTasksFirstInGroups(groupTasks(tasks, '', 'status'), l).find((g) => g.id === 'To do')!
    expect(toDo.tasks.map((t) => t.id)).toEqual(['5', '2', '3'])
    const website = sessionTasksFirstInGroups(groupTasks(tasks, '', 'project'), l).find((g) => g.id === 'Website')!
    expect(website.tasks.map((t) => t.id)).toEqual(['5', '3', '1'])
  })
})

describe('status changes', () => {
  const statuses = [
    { id: '11', name: 'To do', category: 'notStarted' as const, color: 'concrete', position: 1 },
    { id: '12', name: 'Working', category: 'started' as const, color: 'yellow', position: 2 },
    { id: '14', name: 'working', category: 'started' as const, color: 'blue', position: 3 },
    { id: '13', name: 'Peer Review', category: 'started' as const, color: null, position: 4 },
  ]

  it('names a task by its number, else its id', () => {
    expect(taskRef(task('5', { number: '5606' }))).toBe('#5606')
    expect(taskRef(task('77', { number: null }))).toBe('#77')
  })

  it('asks "Move #N to …?", or "Also move…?" after a quick start', () => {
    const t = task('1', { number: '5606' })
    expect(statusChangeQuestion({ task: t, status: statuses[3], also: false })).toBe('Move #5606 to Peer Review?')
    expect(statusChangeQuestion({ task: t, status: statuses[1], also: true })).toBe('Also move #5606 to Working?')
  })

  it('finds a status by name within one workflow: trimmed, any case, the first of equals', () => {
    expect(findStatusByName(statuses, ' peer review ')?.id).toBe('13')
    expect(findStatusByName(statuses, 'WORKING')?.id).toBe('12')
    expect(findStatusByName(statuses, 'Done')).toBeNull()
    expect(findStatusByName(statuses, '')).toBeNull()
    expect(findStatusByName(statuses, null)).toBeNull()
    expect(findStatusByName([], 'Working')).toBeNull()
  })

  it('plans a quick start’s setStatus: ask, already there, or missing in this workflow', () => {
    expect(quickStartStatusPlan({ current: '11', statuses }, 'Working')).toEqual({ kind: 'ask', status: statuses[1] })
    expect(quickStartStatusPlan({ current: '12', statuses }, 'working')).toEqual({ kind: 'already', status: statuses[1] })
    expect(quickStartStatusPlan({ current: '11', statuses }, 'Deployed')).toEqual({ kind: 'missing' })
    expect(quickStartStatusPlan({ current: null, statuses: [] }, 'Working')).toEqual({ kind: 'missing' })
  })

  it('replaces the moved task in place, leaving the rest (and a missing task) alone', () => {
    const data = { source: 'productive' as const, fetchedAt: 1, stale: false, error: null, truncated: false, count: 2, tasks: [task('1'), task('2')] }
    const moved = task('2', { status: 'Working', statusCategory: 'started', statusColor: 'yellow' })
    const next = replaceTask(data, moved)
    expect(next?.tasks.map((t) => t.status)).toEqual(['To do', 'Working'])
    expect(next?.tasks[0]).toBe(data.tasks[0])
    expect(data.tasks[1].status).toBe('To do')
    expect(replaceTask(data, task('9'))).toBe(data)
    expect(replaceTask(null, moved)).toBeNull()
  })
})
