import { createContext, useContext, useEffect } from 'react'

import type { Session, Task, TasksResponse } from '@/api/types'
import { NO_TASK_LINKS, type TaskLinks } from '@/lib/links'
import type { StatusChangeRequest } from '@/lib/tasks'

export interface TasksState {
  data: TasksResponse | null
  error: string | null
  /** This server has no task source configured (501): the screen shows a hint, not an error. */
  notConfigured: boolean
  loading: boolean
  /** Fetch from Productive now (skips the server's cache). */
  refresh: () => Promise<void>
  refreshing: boolean
  /** Load and poll while the returned cleanup has not run (useWatchTasks). */
  watch: () => () => void
  /** Your tasks ↔ the fleet's sessions and the PRs (lib/links.ts); empty while tasks are off. */
  links: TaskLinks
  /** Ask (the in-page confirmation, app-wide) before moving a task to a status; nothing is written without "Move". */
  askStatusChange: (r: StatusChangeRequest) => void
  /** After a quick start with `setStatus`: resolve the name in the task's workflow, then ask (a toast when it has none). */
  offerStatus: (task: Task, statusName: string) => Promise<void>
}

const EMPTY: TasksState = {
  data: null,
  error: null,
  notConfigured: false,
  loading: false,
  refresh: async () => {},
  refreshing: false,
  watch: () => () => {},
  links: NO_TASK_LINKS,
  askStatusChange: () => {},
  offerStatus: async () => {},
}

export const TasksContext = createContext<TasksState>(EMPTY)

/** Your open tasks (providers/TasksProvider.tsx). */
export const useTasks = () => useContext(TasksContext)

/** Keep the tasks loaded and polled while the calling component is mounted (the My tasks screen). */
export function useWatchTasks() {
  const { watch } = useTasks()
  useEffect(() => watch(), [watch])
}

/** The task a session links (one of yours: its first prompt's, else the one it works on — linkTasks), if any. */
export function useSessionTask(s: Pick<Session, 'host' | 'session_id'>): Task | null {
  return useContext(TasksContext).links.taskBySession.get(`${s.host}/${s.session_id}`) ?? null
}
