import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

import { api } from '@/api/client'
import type { Task, TaskQuickStart } from '@/api/types'
import { useFleet } from '@/hooks/useFleet'
import { useSettings } from '@/hooks/useSettings'
import { useSquadPick } from '@/hooks/useSquad'
import { useTasks } from '@/hooks/useTasks'
import { harnessLabel } from '@/lib/harness'
import { followSpawn } from '@/lib/spawnFlow'
import { settleLegend } from '@/lib/squad'
import { quickStartRequest } from '@/lib/tasks'

export interface TaskQuickStartState {
  /** The configured quick starts (`web.tasks.quickStart`); empty: no buttons. */
  actions: TaskQuickStart[]
  /** This one is being started for this task (its button is off). */
  isBusy: (taskId: string, actionId: string) => boolean
  /** Spawn it now: no form, the session opens once it registers. */
  run: (task: Task, action: TaskQuickStart) => Promise<void>
}

const busyKey = (taskId: string, actionId: string) => `${taskId}\n${actionId}`

/**
 * My tasks quick starts: POST spawn on this server's host (the one whose config holds them, `self`)
 * with the rendered prompt — then the New session form's own follow-up (lib/spawnFlow.ts: toast,
 * watch, open). Unnamed: the spawner picks the name. Errors are toasts. A quick start with `setStatus`
 * then offers to move the task there (useTasks().offerStatus: the in-page "Also move #N to …?").
 */
export function useTaskQuickStart(onOpenSession: (href: string) => void): TaskQuickStartState {
  const { self, taskQuickStarts } = useSettings()
  const { applyFleet } = useFleet()
  const { offerStatus } = useTasks()
  const pickLegend = useSquadPick()
  const [busy, setBusy] = useState<ReadonlySet<string>>(() => new Set())
  // A second click before React re-renders the disabled button must not start a second session.
  const inflight = useRef(new Set<string>())

  const mark = useCallback((key: string, on: boolean) => {
    if (on) inflight.current.add(key)
    else inflight.current.delete(key)
    setBusy(new Set(inflight.current))
  }, [])

  const run = useCallback(
    async (task: Task, action: TaskQuickStart) => {
      const key = busyKey(task.id, action.id)
      if (inflight.current.has(key)) return
      const body = quickStartRequest(action, task)
      if (!self || !body) {
        toast.error(`${action.label}: cannot start`, { description: action.error ?? 'This server has not said which host it is yet.' })
        return
      }
      mark(key, true)
      const legend = pickLegend()
      try {
        const res = await api.spawn(self, { ...body, player: legend?.[1] })
        const where = res.workspace ? ` in a new worktree (${res.workspace.branch})` : ''
        followSpawn(
          { host: self, name: res.name, tmuxSession: res.tmuxSession },
          { loading: `${action.label}: starting ${res.name} on ${self}${where}…`, who: harnessLabel('claude'), sent: body.prompt ?? '', onFleet: applyFleet, onOpenSession, legend },
        )
        if (action.setStatus) void offerStatus(task, action.setStatus)
      } catch (err) {
        settleLegend(legend)
        toast.error(`${action.label} failed for #${task.number ?? task.id}`, { description: (err as Error)?.message || 'Failed to start' })
      } finally {
        mark(key, false)
      }
    },
    [self, applyFleet, onOpenSession, mark, offerStatus, pickLegend],
  )

  const isBusy = useCallback((taskId: string, actionId: string) => busy.has(busyKey(taskId, actionId)), [busy])
  return { actions: taskQuickStarts, isBusy, run }
}
