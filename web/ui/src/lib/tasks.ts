import type { CSSProperties } from 'react'

import type { Session, SpawnRequest, Task, TaskQuickStart, TaskRef, TasksResponse, WorkflowStatus } from '@/api/types'
import type { TaskLinks } from '@/lib/links'
import { statusMeta, type StatusKey } from '@/lib/sessions'

/** `#/tasks`: the My tasks screen. */
export const isTasksLocation = (location: string) => location === '/tasks'

/** The first prompt of a session started from a task: its link, then its title. */
export const taskPrompt = (t: Pick<Task, 'url' | 'title'>) => `${t.url}\n${t.title}`

/** A quick start's placeholders (the server's QUICK_START_PLACEHOLDERS, lib/tasks.mjs). */
const PLACEHOLDER_RE = /\{(url|title|number|id)\}/g

/**
 * A quick start's `prompt` for one task: `{url}`, `{title}`, `{number}` ('' when it has none), `{id}`
 * replaced in one pass (a title that says `{url}` stays as it is); anything else is left alone.
 */
export function renderTaskPrompt(template: string, t: Pick<Task, 'url' | 'title' | 'number' | 'id'>): string {
  const values: Record<string, string> = { url: t.url, title: t.title, number: t.number ?? '', id: t.id }
  return template.replace(PLACEHOLDER_RE, (_, key: string) => values[key])
}

/**
 * The POST spawn body a quick start sends for a task (no name: the spawner picks one), or null when it
 * cannot start (its directory is gone on the server).
 */
export function quickStartRequest(q: TaskQuickStart, t: Pick<Task, 'url' | 'title' | 'number' | 'id'>): SpawnRequest | null {
  if (!q.dir || q.error) return null
  return {
    dir: q.dir,
    prompt: renderTaskPrompt(q.prompt, t),
    ...(q.model ? { model: q.model } : {}),
    ...(q.worktree ? { worktree: true } : {}),
  }
}

/** `/api/settings` `tasks.quickStart` → the well-formed entries (anything else dropped). */
export function normalizeQuickStarts(raw: unknown): TaskQuickStart[] {
  if (!Array.isArray(raw)) return []
  const out: TaskQuickStart[] = []
  for (const q of raw as Record<string, unknown>[]) {
    if (!q || typeof q !== 'object') continue
    if (typeof q.id !== 'string' || typeof q.label !== 'string' || !q.label || typeof q.prompt !== 'string') continue
    out.push({
      id: q.id,
      label: q.label,
      prompt: q.prompt,
      dir: typeof q.dir === 'string' && q.dir ? q.dir : null,
      dirLabel: typeof q.dirLabel === 'string' ? q.dirLabel : null,
      model: typeof q.model === 'string' && q.model ? q.model : null,
      worktree: q.worktree === true,
      setStatus: typeof q.setStatus === 'string' && q.setStatus.trim() ? q.setStatus.trim() : null,
      ...(typeof q.error === 'string' ? { error: q.error } : {}),
    })
  }
  return out
}

/** The focus filters' localStorage keys (the hidden statuses are a JSON array of status names, '' = no status). */
export const TASKS_HIDDEN_STATUSES_KEY = 'fleet.tasksHiddenStatuses'
export const TASKS_WITHOUT_SESSION_KEY = 'fleet.tasksWithoutSession'
export const TASKS_WITHOUT_PR_KEY = 'fleet.tasksWithoutPr'

/** What the My tasks screen hides, beyond the text filter. Default: nothing. */
export interface TaskFocus {
  /** Workflow status names to hide ('' = tasks without a status). */
  hiddenStatuses: readonly string[]
  /** Hide tasks that already have a live session. */
  withoutSession: boolean
  /** Hide tasks that already have a PR. */
  withoutPr: boolean
}

export const NO_TASK_FOCUS: TaskFocus = { hiddenStatuses: [], withoutSession: false, withoutPr: false }

/** The stored hidden statuses (a JSON array of strings) → the list, deduplicated; undefined when it is not one. */
export function parseHiddenStatuses(raw: string | null | undefined): string[] | undefined {
  if (raw == null) return undefined
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (!Array.isArray(v)) return undefined
  return [...new Set(v.filter((x): x is string => typeof x === 'string'))]
}

/** Hide or show one status: the new hidden list (as stored). */
export function toggleHiddenStatus(hidden: readonly string[], status: string, hide: boolean): string[] {
  const rest = hidden.filter((s) => s !== status)
  return hide ? [...rest, status] : rest
}

export const taskFocusActive = (f: TaskFocus) => f.hiddenStatuses.length > 0 || f.withoutSession || f.withoutPr

export interface TaskStatusOption {
  /** The status name ('' = none): what `hiddenStatuses` holds. */
  id: string
  title: string
  color: string | null
  count: number
}

/** The statuses among `tasks`, in the Status grouping's order (started first), with how many tasks each. */
export const taskStatuses = (tasks: readonly Task[] | null | undefined): TaskStatusOption[] =>
  groupTasks(tasks, '', 'status').map((g) => ({ id: g.id, title: g.title, color: g.color, count: g.tasks.length }))

/**
 * The tasks the focus filters leave (order kept) and how many they hide. A task is hidden when its status
 * is hidden, or (`withoutSession`) a live session links it, or (`withoutPr`) a PR does (`links`: lib/links.ts).
 */
export function focusTasks(
  tasks: readonly Task[] | null | undefined,
  focus: TaskFocus,
  links: Pick<TaskLinks, 'sessionsByTask' | 'prsByTask'>,
): { tasks: Task[]; hidden: number } {
  const all = tasks ?? []
  if (!taskFocusActive(focus)) return { tasks: [...all], hidden: 0 }
  const hiddenStatuses = new Set(focus.hiddenStatuses)
  const kept = all.filter(
    (t) =>
      !hiddenStatuses.has(t.status ?? '') &&
      !(focus.withoutSession && links.sessionsByTask.get(t.id)?.length) &&
      !(focus.withoutPr && links.prsByTask.get(t.id)?.length),
  )
  return { tasks: kept, hidden: all.length - kept.length }
}

/** `#123 Title — In progress · Project (open in Productive)`: a task chip's tooltip. */
export const taskTooltip = (t: Pick<Task, 'id' | 'number' | 'title' | 'status' | 'project'>) =>
  `#${t.number ?? t.id} ${t.title}${t.status ? ` — ${t.status}` : ''}${t.project ? ` · ${t.project}` : ''} (open in Productive)`

/** How the My tasks screen groups: by workflow status or by project. */
export type TasksGroupBy = 'status' | 'project'
/** localStorage key of the viewer's choice (default `project`). */
export const TASKS_GROUP_BY_KEY = 'fleet.tasksGroupBy'
export const DEFAULT_TASKS_GROUP_BY: TasksGroupBy = 'project'
export const parseTasksGroupBy = (raw: string | null | undefined): TasksGroupBy | undefined =>
  raw === 'status' || raw === 'project' ? raw : undefined

export interface TaskGroup {
  /** The workflow status name, or the project name ('' = none). */
  id: string
  title: string
  /** The group's colour: a Productive palette name (taskColor()); null = neutral. */
  color: string | null
  tasks: Task[]
}

// Started work first, then what is still to do; anything else after.
const CATEGORY_ORDER: Record<string, number> = { started: 0, notStarted: 1, closed: 2 }
const rank = (t: Task) => CATEGORY_ORDER[t.statusCategory ?? ''] ?? 3

const matches = (t: Task, q: string) =>
  [t.title, t.number ? `#${t.number}` : '', t.number ?? '', t.project ?? '', t.status ?? '', t.root?.title ?? '', t.parent?.title ?? ''].some((s) =>
    s.toLowerCase().includes(q),
  )

/**
 * The tasks grouped (`filter`: title, `#number`, project or status, any case).
 *
 * `status` (the default here): by workflow status — statuses of the same name in different workflows are
 * one group; started ones first, then not started, by name within each; a task keeps the server's order
 * (most recently updated first).
 *
 * `project`: one group per project — most started tasks first, then by name, "No project" last; inside,
 * started → not started → the rest, most recently updated first.
 *
 * A group's colour is its first coloured task's status / project colour.
 */
export function groupTasks(tasks: readonly Task[] | null | undefined, filter = '', by: TasksGroupBy = 'status'): TaskGroup[] {
  const q = filter.trim().toLowerCase()
  const byProject = by === 'project'
  const groups = new Map<string, TaskGroup & { rank: number; started: number }>()
  for (const t of tasks ?? []) {
    if (q && !matches(t, q)) continue
    const id = (byProject ? t.project : t.status) ?? ''
    let g = groups.get(id)
    if (!g) groups.set(id, (g = { id, title: id || (byProject ? 'No project' : 'No status'), color: null, tasks: [], rank: rank(t), started: 0 }))
    g.rank = Math.min(g.rank, rank(t))
    if (t.statusCategory === 'started') g.started++
    g.color ??= (byProject ? t.projectColor : t.statusColor) ?? null
    g.tasks.push(t)
  }
  const named = (a: TaskGroup, b: TaskGroup) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || a.title.localeCompare(b.title)
  const list = [...groups.values()]
  if (!byProject) list.sort((a, b) => a.rank - b.rank || named(a, b))
  else {
    list.sort((a, b) => (a.id ? 0 : 1) - (b.id ? 0 : 1) || b.started - a.started || named(a, b))
    for (const g of list) g.tasks.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity))
  }
  return list.map(({ id, title, color, tasks: ts }) => ({ id, title, color, tasks: ts }))
}

/**
 * Productive's palette (the server's `statusColor` / `projectColor`) → the colour drawn per mode:
 * Productive's own `--color-icon-<palette>-highlight` token (frontend addons/ui/src/sass/colors/
 * semantics.scss → primitives.scss; palette name → token name via legacy-colors.scss
 * `$legacy-palette-to-new`), moved along the same primitive ramp only as far as it takes to stay at
 * 3:1 on every fleet palette's background and card (tasks.test.ts checks): light canary 900, lime-green
 * 800, yellow 800, green 700, cyan 700; dark fuchsia / electric / burgundy / celtic-blue 950, concrete
 * 700. `white` (Productive's "no colour") is absent: neutral.
 */
export const TASK_COLORS: Readonly<Record<string, { light: string; dark: string }>> = {
  canary: { light: '#706400', dark: '#b3a84a' },
  orange: { light: '#c6451a', dark: '#c68a75' },
  fuchsia: { light: '#c7265b', dark: '#d9a2b4' },
  'lime-green': { light: '#417405', dark: '#82b34a' },
  blue: { light: '#1080b0', dark: '#75aec6' },
  electric: { light: '#8554d4', dark: '#b7a2d9' },
  burgundy: { light: '#a52b66', dark: '#d9a2bd' },
  'celtic-blue': { light: '#4f6bf8', dark: '#a2abd9' },
  turquoise: { light: '#03847c', dark: '#4ab3ac' },
  concrete: { light: '#6d6d6d', dark: '#9f9f9f' },
  logan: { light: '#505694', dark: '#8f95c6' },
  yellow: { light: '#8c6d00', dark: '#b39c4a' },
  azure: { light: '#2d78e1', dark: '#7597c6' },
  red: { light: '#cc1818', dark: '#dc8080' },
  green: { light: '#007a5e', dark: '#75c6a8' },
  cyan: { light: '#00778c', dark: '#75bac6' },
}

/** A palette name → its colours, null for none / unknown (draw neutral). */
export const taskColor = (name: string | null | undefined) => (name && Object.hasOwn(TASK_COLORS, name) ? TASK_COLORS[name] : null)

/**
 * Inline style carrying a palette's two colours (`--tc-l` / `--tc-d`); `TASK_COLOR` (lib/styles.ts) picks
 * one per mode as `--tc`. undefined for none / unknown.
 */
export function taskColorStyle(name: string | null | undefined): CSSProperties | undefined {
  const c = taskColor(name)
  return c ? ({ '--tc-l': c.light, '--tc-d': c.dark } as CSSProperties) : undefined
}

/**
 * Statuses that share one palette colour told apart: statusVariantKey(task) → 0 (the first by name: the plain
 * colour) or 1…3 (index.css `.task-status[data-status-variant]`: a shade and a rail pattern of its own). Statuses
 * alone on their colour, and tasks without a known colour, are absent (= 0).
 */
export function statusVariants(tasks: readonly Task[] | null | undefined): Map<string, number> {
  const byColor = new Map<string, Set<string>>()
  for (const t of tasks ?? []) {
    if (!t.status || !t.statusColor || !taskColor(t.statusColor)) continue
    const names = byColor.get(t.statusColor) ?? new Set<string>()
    names.add(t.status)
    byColor.set(t.statusColor, names)
  }
  const out = new Map<string, number>()
  for (const [color, names] of byColor) {
    if (names.size < 2) continue
    ;[...names].sort((a, b) => a.localeCompare(b)).forEach((name, i) => out.set(`${color}|${name}`, Math.min(i, 3)))
  }
  return out
}

/** A task's key in statusVariants(). */
export const statusVariantKey = (t: Pick<Task, 'status' | 'statusColor'>) => `${t.statusColor ?? ''}|${t.status ?? ''}`

const DAY_MS = 24 * 60 * 60 * 1000
const dayStart = (ms: number) => {
  const d = new Date(ms)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/**
 * A due date as a row shows it: Today, Tomorrow, Yesterday, else the date (the year only when it is
 * not this one). `overdue`: before today; `soon`: today or tomorrow.
 */
export function dueLabel(dueDate: string | null, now: number): { label: string; tone: 'overdue' | 'soon' | null } | null {
  const m = dueDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate) : null
  if (!m) return null
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const days = Math.round((due.getTime() - dayStart(now)) / DAY_MS)
  const tone = days < 0 ? 'overdue' : days <= 1 ? 'soon' : null
  if (days === 0) return { label: 'Today', tone }
  if (days === 1) return { label: 'Tomorrow', tone }
  if (days === -1) return { label: 'Yesterday', tone }
  const sameYear = due.getFullYear() === new Date(now).getFullYear()
  const label = due.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' })
  return { label, tone }
}

/**
 * What the live sessions linking a task are doing, the one that matters most first: `waiting` (one needs
 * you), `working` (one is busy), `idle` (only idle / background-task / unknown ones). null: no live session
 * links it. Every state frames the card the same way (TaskCard); the state only orders the tasks.
 */
export type TaskActivityState = 'waiting' | 'working' | 'idle'

export interface TaskActivity {
  state: TaskActivityState
  /** Every linked live session, waiting first, then busy, then the rest (the card header names them all). */
  sessions: Session[]
}

const SESSION_RANK: Record<StatusKey, number> = { waiting: 0, busy: 1, idle: 2, unknown: 2 }
const sessionRank = (s: Session) => SESSION_RANK[statusMeta(s.status).key]
const STATE_BY_RANK: TaskActivityState[] = ['waiting', 'working', 'idle']

/** A task's activity from `links.sessionsByTask` (lib/links.ts): see TaskActivityState. */
export function taskActivity(t: Pick<Task, 'id'>, links: Pick<TaskLinks, 'sessionsByTask'>): TaskActivity | null {
  const linked = links.sessionsByTask.get(t.id) ?? []
  if (!linked.length) return null
  const sessions = [...linked].sort((a, b) => sessionRank(a) - sessionRank(b))
  return { state: STATE_BY_RANK[sessionRank(sessions[0])], sessions }
}

/** Where a task sorts by its sessions: waiting 0, working 1, idle 2, no live session 3. */
export const activityRank = (a: TaskActivity | null): number => (a ? STATE_BY_RANK.indexOf(a.state) : STATE_BY_RANK.length)

/** `tasks` with the ones a live session links first (waiting → working → idle); order kept otherwise. */
export function sessionTasksFirst<T extends Pick<Task, 'id'>>(tasks: readonly T[], links: Pick<TaskLinks, 'sessionsByTask'>): T[] {
  const rank = new Map(tasks.map((t) => [t.id, activityRank(taskActivity(t, links))]))
  return [...tasks].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
}

/** The groups (same order, same counts) with their tasks a live session links on top (sessionTasksFirst). */
export const sessionTasksFirstInGroups = (groups: readonly TaskGroup[], links: Pick<TaskLinks, 'sessionsByTask'>): TaskGroup[] =>
  groups.map((g) => ({ ...g, tasks: sessionTasksFirst(g.tasks, links) }))

/**
 * The "In sessions" band: every task a live session links, with its activity — waiting first (they need
 * you), then working, then idle; in `tasks`' order within each. Unaffected by the focus filters.
 */
export function activeTasks(tasks: readonly Task[] | null | undefined, links: Pick<TaskLinks, 'sessionsByTask'>): { task: Task; activity: TaskActivity }[] {
  const out: { task: Task; activity: TaskActivity }[] = []
  for (const t of tasks ?? []) {
    const activity = taskActivity(t, links)
    if (activity) out.push({ task: t, activity })
  }
  return out.sort((a, b) => activityRank(a.activity) - activityRank(b.activity))
}

/** `#5606` (the id when it has no number): how a confirmation names a task. */
export const taskRef = (t: Pick<Task, 'id' | 'number'>) => `#${t.number ?? t.id}`

/**
 * A status change waiting for the in-page confirmation: from the status menu (`also: false` → "Move #5606
 * to Peer Review?") or after a quick start's session started (`also: true` → "Also move #5606 to Working?").
 */
export interface StatusChangeRequest {
  task: Task
  status: Pick<WorkflowStatus, 'id' | 'name' | 'color' | 'category'>
  also: boolean
}

export const statusChangeQuestion = (r: Pick<StatusChangeRequest, 'task' | 'also'> & { status: Pick<WorkflowStatus, 'name'> }) =>
  `${r.also ? 'Also move' : 'Move'} ${taskRef(r.task)} to ${r.status.name}?`

/** A status by name within one workflow (trimmed, any case); the first of several same-named ones; null when none. */
export function findStatusByName<S extends Pick<WorkflowStatus, 'name'>>(statuses: readonly S[], name: string | null | undefined): S | null {
  const want = String(name ?? '').trim().toLowerCase()
  if (!want) return null
  return statuses.find((st) => st.name.trim().toLowerCase() === want) ?? null
}

/**
 * What a quick start's `setStatus` means for one task, given its workflow's statuses: ask to move it
 * (`ask`), nothing to do (`already` there), or the workflow has no such status (`missing`).
 */
export function quickStartStatusPlan(
  r: { current: string | null; statuses: readonly WorkflowStatus[] },
  name: string,
): { kind: 'ask'; status: WorkflowStatus } | { kind: 'already'; status: WorkflowStatus } | { kind: 'missing' } {
  const status = findStatusByName(r.statuses, name)
  if (!status) return { kind: 'missing' }
  return status.id === r.current ? { kind: 'already', status } : { kind: 'ask', status }
}

/** The tasks answer with one task replaced by its updated copy (same place); unchanged when it is not there. */
export function replaceTask(data: TasksResponse | null, task: Task): TasksResponse | null {
  if (!data || !data.tasks.some((t) => t.id === task.id)) return data
  return { ...data, tasks: data.tasks.map((t) => (t.id === task.id ? task : t)) }
}

/** A task as a reference to itself (a top task of its own tree). */
export const selfRef = (t: Task): TaskRef => ({ id: t.id, number: t.number, title: t.title, url: t.url, keyTask: !!t.keyTask, closed: t.statusCategory === 'closed' })

/** The piece of work a task belongs to: its subtask tree's top task (a milestone or a parent task), itself when it has subtasks; null = standalone. */
export function workOf(t: Task): TaskRef | null {
  return t.root ?? t.parent ?? (t.subtasks || t.keyTask ? selfRef(t) : null)
}

/** A group's tasks as laid out: a loose task, or a piece of work (a milestone / parent task) boxing its subtasks. */
export type TaskItem = { kind: 'task'; task: Task } | { kind: 'work'; work: TaskRef; top: Task | null; tasks: Task[] }

/**
 * A group's tasks with every piece of work (workOf) gathered into one box where its first task stood: the top task
 * itself (when it is in the group) heads the box, its subtasks inside in tree order. A top task with none of its
 * subtasks here stays a plain card.
 */
export function bundleByWork(tasks: readonly Task[]): TaskItem[] {
  const out: TaskItem[] = []
  const boxes = new Map<string, Extract<TaskItem, { kind: 'work' }>>()
  for (const t of tasks) {
    const work = workOf(t)
    if (!work) {
      out.push({ kind: 'task', task: t })
      continue
    }
    let box = boxes.get(work.id)
    if (!box) {
      box = { kind: 'work', work, top: null, tasks: [] }
      boxes.set(work.id, box)
      out.push(box)
    }
    if (t.id === work.id) box.top = t
    else box.tasks.push(t)
  }
  return out.map((i) => (i.kind === 'work' && !i.tasks.length && i.top ? { kind: 'task', task: i.top } : i.kind === 'work' ? { ...i, tasks: treeOrder(i.tasks, i.work.id) } : i))
}

/** The milestones / parent tasks that box at least one of your tasks (bundleByWork): what "fold all" folds. */
export function workBoxIds(tasks: readonly Task[] | null | undefined): string[] {
  const ids = new Set<string>()
  for (const t of tasks ?? []) {
    const w = workOf(t)
    if (w && w.id !== t.id) ids.add(w.id)
  }
  return [...ids]
}

/** A box's tasks: each followed by its own subtasks (those in the list), started → not started → the rest. */
function treeOrder(tasks: Task[], topId: string): Task[] {
  const byRank = (a: Task, b: Task) => rank(a) - rank(b) || (b.updatedAt ?? -Infinity) - (a.updatedAt ?? -Infinity)
  const ids = new Set(tasks.map((t) => t.id))
  const children = new Map<string, Task[]>()
  const tops: Task[] = []
  for (const t of tasks) {
    const p = t.parent?.id
    if (t.id !== topId && p && p !== topId && ids.has(p)) children.set(p, [...(children.get(p) ?? []), t])
    else tops.push(t)
  }
  const out: Task[] = []
  const walk = (t: Task) => {
    out.push(t)
    for (const c of (children.get(t.id) ?? []).sort(byRank)) walk(c)
  }
  for (const t of tops.sort((a, b) => (a.id === topId ? -1 : b.id === topId ? 1 : byRank(a, b)))) walk(t)
  return out
}

/** The tasks a task is tied to (its parent, its tree's top, its subtasks, its dependencies): what lights up with it. */
export function relatedTaskIds(t: Task, all: readonly Task[]): Set<string> {
  const ids = new Set<string>()
  if (t.parent) ids.add(t.parent.id)
  if (t.root) ids.add(t.root.id)
  for (const d of t.dependencies ?? []) ids.add(d.task.id)
  for (const o of all) {
    if (o.parent?.id === t.id || o.root?.id === t.id) ids.add(o.id)
    if (o.dependencies?.some((d) => d.task.id === t.id)) ids.add(o.id)
  }
  ids.delete(t.id)
  return ids
}
