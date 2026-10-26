import type { FleetResponse, PullRequest, Session, Task } from '@/api/types'

// The server's rule (web/lib/fleet.mjs promptLinks, core/prs.rs body_links): a URL ends at
// whitespace or a quote, bracket, `|` or backslash; trailing sentence punctuation is not part of it.
const URL_RE = /https?:\/\/[^\s<>()[\]{}"'`|\\]+/gi

/** The distinct http(s) URLs in `text`, in order. */
export function urlsIn(text: string | null | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?*_~]+$/, '')
    if (/^https?:\/\/./i.test(url) && !out.includes(url)) out.push(url)
  }
  return out
}

/** The URLs in a session's first prompt: the server's `promptLinks`, else (older servers) those left in the trimmed `title`. */
export const sessionLinks = (s: Pick<Session, 'promptLinks' | 'title'>) => s.promptLinks ?? urlsIn(s.title)

const parse = (url: string) => {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/**
 * The task a URL names: `<origin>` + its id, from a path with `/tasks/<id>` (or `/tasks/task/<id>`),
 * anything after it (`/activity`, `?x=1`, `#c`) allowed. null for anything else.
 */
export function taskRefOf(url: string): { origin: string; id: string } | null {
  const u = parse(url)
  if (!u || (u.protocol !== 'https:' && u.protocol !== 'http:')) return null
  const m = /\/tasks\/(?:task\/)?(\d+)(?:\/|$)/.exec(u.pathname)
  return m ? { origin: u.origin, id: m[1] } : null
}

/** A session links its most-mentioned open task only when its transcript mentions it at least this often. */
export const MIN_TASK_MENTIONS = 3

export interface TaskLinks {
  /** Task id → the live sessions that link it (linkTasks). */
  sessionsByTask: Map<string, Session[]>
  /** `host/session_id` → the task its chip shows: its manual link, else the first its first prompt links, else the one it works on. */
  taskBySession: Map<string, Task>
  /** The `host/session_id`s whose task is a manual link (`manualTask`; the chip's marker). */
  manualSessions: Set<string>
  /** Task id → the PRs whose description links it. */
  prsByTask: Map<string, PullRequest[]>
  /** PR url → the first of your tasks its description links. */
  taskByPr: Map<string, Task>
}

const noLinks = (): TaskLinks => ({ sessionsByTask: new Map(), taskBySession: new Map(), manualSessions: new Set(), prsByTask: new Map(), taskByPr: new Map() })
export const NO_TASK_LINKS: TaskLinks = noLinks()

/**
 * Your tasks ↔ sessions and PRs. A session linked by hand (`manualTask`, "Link task…") links that task
 * alone — or, with `{ id: null }`, none at all; a manual link to a task not in `tasks` (closed, someone
 * else's) is ignored and the automatic links below apply. Otherwise a session links a task when (a) its first prompt links it
 * (sessionLinks), or (b) its transcript mentions it more than any other of `tasks` and at least
 * MIN_TASK_MENTIONS times (`taskMentions`; tied at the top → each). PRs link the tasks their
 * description links (`links`). A link counts when it names one of `tasks` on that task's own origin
 * (so a `/tasks/12` anywhere else never matches). Something that links several tasks is listed under
 * each and wears the first one's chip (a first-prompt link before a mentioned one); links to tasks not
 * in the list (closed, someone else's) are ignored.
 */
export function linkTasks(
  tasks: readonly Task[] | null | undefined,
  sessions: readonly Session[],
  prs: readonly PullRequest[],
): TaskLinks {
  if (!tasks?.length) return NO_TASK_LINKS
  const byKey = new Map<string, Task>()
  const byId = new Map(tasks.map((t) => [t.id, t]))
  for (const t of tasks) {
    const ref = taskRefOf(t.url)
    byKey.set(`${ref?.origin ?? ''}#${t.id}`, t)
  }
  const taskOf = (url: string) => {
    const ref = taskRefOf(url)
    return ref ? byKey.get(`${ref.origin}#${ref.id}`) : undefined
  }
  const tasksIn = (urls: readonly string[]) => {
    const out: Task[] = []
    for (const url of urls) {
      const t = taskOf(url)
      if (t && !out.includes(t)) out.push(t)
    }
    return out
  }
  /** The tasks of `tasks` a session's transcript mentions most, when that is at least MIN_TASK_MENTIONS times. */
  const workedOn = (s: Session) => {
    const counts = new Map<Task, number>()
    for (const m of s.taskMentions ?? []) {
      const t = taskOf(m.url)
      if (t && Number.isFinite(m.count)) counts.set(t, (counts.get(t) ?? 0) + m.count)
    }
    const top = Math.max(0, ...counts.values())
    return top < MIN_TASK_MENTIONS ? [] : [...counts].filter(([, n]) => n === top).map(([t]) => t)
  }
  const links = noLinks()
  for (const s of sessions) {
    if (!s.session_id) continue
    const key = `${s.host}/${s.session_id}`
    const manual = s.manualTask
    if (manual && manual.id === null) continue
    const pinned = manual?.id != null ? byId.get(manual.id) : undefined
    let ts: Task[]
    if (pinned) {
      ts = [pinned]
      links.manualSessions.add(key)
    } else {
      ts = tasksIn(sessionLinks(s))
      for (const t of workedOn(s)) if (!ts.includes(t)) ts.push(t)
    }
    if (!ts.length) continue
    links.taskBySession.set(key, ts[0])
    for (const t of ts) links.sessionsByTask.set(t.id, [...(links.sessionsByTask.get(t.id) ?? []), s])
  }
  for (const p of prs) {
    const ts = tasksIn(p.links ?? [])
    if (!ts.length) continue
    links.taskByPr.set(p.url, ts[0])
    for (const t of ts) links.prsByTask.set(t.id, [...(links.prsByTask.get(t.id) ?? []), p])
  }
  return links
}

const pickerMatches = (t: Task, q: string) =>
  [t.title, t.number ? `#${t.number}` : '', t.number ?? '', t.project ?? '', t.status ?? ''].some((v) => v.toLowerCase().includes(q))

/**
 * The "Link task…" picker's list: the tasks matching `query` (title, `#number`, project or status, any
 * case), the session's current task (`currentId`) first, the rest in the server's order.
 */
export function pickerTasks(tasks: readonly Task[] | null | undefined, query: string, currentId?: string | null): Task[] {
  const q = query.trim().toLowerCase()
  const out = (tasks ?? []).filter((t) => !q || pickerMatches(t, q))
  const i = currentId ? out.findIndex((t) => t.id === currentId) : -1
  if (i > 0) out.unshift(...out.splice(i, 1))
  return out
}

/** `fleet` with one session's `manualTask` replaced (`undefined` = removed) — the optimistic view after a link change. */
export function withManualTask(fleet: FleetResponse, host: string, id: string, manualTask: Session['manualTask']): FleetResponse {
  return {
    ...fleet,
    hosts: fleet.hosts.map((h) =>
      h.name !== host
        ? h
        : {
            ...h,
            sessions: h.sessions.map((s) => {
              if (s.session_id !== id) return s
              const next = { ...s }
              if (manualTask) next.manualTask = manualTask
              else delete next.manualTask
              return next
            }),
          },
    ),
  }
}
