import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { ApiError, api, isAbortError } from '@/api/client'
import type { Task, TasksResponse } from '@/api/types'
import { TaskStatusDialog } from '@/components/TaskStatusMenu'
import { useFleet } from '@/hooks/useFleet'
import { usePoller } from '@/hooks/usePoller'
import { usePrs } from '@/hooks/usePrs'
import { TasksContext, type TasksState } from '@/hooks/useTasks'
import { linkTasks } from '@/lib/links'
import { allSessions } from '@/lib/sessions'
import { quickStartStatusPlan, replaceTask, taskRef, type StatusChangeRequest } from '@/lib/tasks'

// The server caches Productive's answer for 60s; polling reads that cache.
const POLL_MS = 60_000
// Nothing watches: the task chips on session rows and PR cards only need a slow refresh.
const BACKGROUND_MS = 5 * 60_000

/**
 * Your open tasks (GET /api/tasks — this server's Productive credentials), app-wide: loaded once on
 * start and every 5 min for the task chips on session rows / PR cards (`links`, lib/links.ts — the
 * fleet's sessions and the PRs of usePrs()), every 60 s while a screen watches (useWatchTasks). Not
 * configured here (501, or 404 from an older server): no background polling, no links.
 * Status changes are confirmed here (TaskStatusDialog), app-wide, so a quick start's "Also move…?" stays
 * up while its new session opens; a change applied updates the task in place until the next fetch.
 */
export function TasksProvider({ children }: { children: ReactNode }) {
  const [watchers, setWatchers] = useState(0)
  const watch = useCallback(() => {
    setWatchers((n) => n + 1)
    return () => setWatchers((n) => n - 1)
  }, [])

  const [data, setData] = useState<TasksResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notConfigured, setNotConfigured] = useState(false)
  const [settled, setSettled] = useState(false)

  const load = useCallback(async (signal: AbortSignal, refresh = false) => {
    try {
      const r = await api.tasks({ signal, refresh })
      setData(r)
      setError(null)
      setNotConfigured(false)
    } catch (err) {
      if (isAbortError(err)) throw err
      // 501: not configured here; 404: a server that predates tasks.
      const off = err instanceof ApiError && (err.status === 501 || err.status === 404)
      setNotConfigured(off)
      setError(off ? (err.status === 404 ? 'this server runs an older fleet — update it to see tasks' : err.message) : (err as Error)?.message || 'could not load tasks')
    } finally {
      setSettled(true)
    }
  }, [])

  const reload = usePoller((signal) => load(signal).catch(() => {}), watchers > 0 ? POLL_MS : BACKGROUND_MS, {
    enabled: watchers > 0 || !notConfigured,
  })
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await load(new AbortController().signal, true)
    } catch {
      reload()
    } finally {
      setRefreshing(false)
    }
  }, [load, reload])

  const { fleet } = useFleet()
  const { data: prs } = usePrs()
  const tasks = notConfigured ? null : data?.tasks
  const links = useMemo(() => linkTasks(tasks, allSessions(fleet), prs?.prs ?? []), [tasks, fleet, prs])

  const [pending, setPending] = useState<StatusChangeRequest | null>(null)
  const askStatusChange = useCallback((r: StatusChangeRequest) => setPending(r), [])
  const applyTask = useCallback((task: Task) => setData((d) => replaceTask(d, task)), [])
  const offerStatus = useCallback(async (task: Task, statusName: string) => {
    try {
      const plan = quickStartStatusPlan(await api.taskStatuses(task.id), statusName)
      if (plan.kind === 'missing') toast.message(`${taskRef(task)} stays as it is`, { description: `Its workflow has no “${statusName}” status.` })
      else if (plan.kind === 'ask') setPending({ task, status: plan.status, also: true })
    } catch (err) {
      toast.error(`Could not read ${taskRef(task)}’s statuses`, { description: (err as Error)?.message || undefined })
    }
  }, [])

  const loading = watchers > 0 && !settled
  const value = useMemo<TasksState>(
    () => ({ data, error, notConfigured, loading, refresh, refreshing, watch, links, askStatusChange, offerStatus }),
    [data, error, notConfigured, loading, refresh, refreshing, watch, links, askStatusChange, offerStatus],
  )
  return (
    <TasksContext.Provider value={value}>
      {children}
      <TaskStatusDialog request={pending} onClose={() => setPending(null)} onChanged={applyTask} />
    </TasksContext.Provider>
  )
}
