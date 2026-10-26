import { useState } from 'react'
import { Link2OffIcon, Loader2Icon, RotateCcwIcon } from 'lucide-react'
import { toast } from 'sonner'

import { ApiError, api } from '@/api/client'
import type { Session, Task } from '@/api/types'
import { HostDot } from '@/components/HostBadge'
import { TaskBadge, TaskStatusChip } from '@/components/TaskChip'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useFleet } from '@/hooks/useFleet'
import { useTasks, useWatchTasks } from '@/hooks/useTasks'
import { pickerTasks, withManualTask } from '@/lib/links'
import { findSession } from '@/lib/sessions'
import { sessionTitle } from '@/lib/title'

/** Why a link change failed, in words: an older server has no such route (404 without "unknown session") or store (501). */
function linkError(err: unknown, host: string): string {
  if (err instanceof ApiError) {
    if (err.status === 501 || (err.status === 404 && !/unknown session/i.test(err.message))) return `${host}'s fleet server can't link tasks yet — update it there`
    if (err.status === 404) return 'Session gone'
  }
  return (err as Error)?.message || 'request failed'
}

/**
 * "Link task…": a searchable list of your open tasks (number, title, project, status); picking one links
 * the session to it by hand (it wins over the automatic links). "Unlink" links it to no task (automatic
 * links hidden too); "Link automatically" forgets the manual choice. Stored on the session's host.
 */
export function TaskLinkDialog({ session: initial, onClose }: { session: Session; onClose: () => void }) {
  const { fleet, applyFleet } = useFleet()
  const { data, error: tasksError, links } = useTasks()
  useWatchTasks()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const s = findSession(fleet, initial.host, initial.session_id) ?? initial
  const key = `${s.host}/${s.session_id}`
  const current = links.taskBySession.get(key) ?? null
  const manual = s.manualTask
  const list = pickerTasks(data?.tasks, query, current?.id)

  const change = async (taskId: string | null | undefined, done: string) => {
    if (busy) return
    setBusy(true)
    try {
      const r = taskId === undefined ? await api.clearSessionTask(s.host, s.session_id) : await api.setSessionTask(s.host, s.session_id, taskId)
      if (fleet) applyFleet(withManualTask(fleet, s.host, s.session_id, r.manualTask ?? undefined))
      toast.success(done, { description: sessionTitle(s) })
      onClose()
    } catch (err) {
      toast.error("Couldn't change the task link", { description: linkError(err, s.host) })
      setBusy(false)
    }
  }
  const pick = (t: Task) => {
    if (manual?.id === t.id) return onClose()
    void change(t.id, `Linked to #${t.number ?? t.id}`)
  }

  return (
    <Dialog open onOpenChange={(o) => (o || busy ? null : onClose())}>
      <DialogContent className="top-[18%] translate-y-0 overflow-hidden rounded-xl! p-0 sm:max-w-xl" showCloseButton={false}>
        <DialogTitle className="sr-only">Link task</DialogTitle>
        <DialogDescription className="flex min-w-0 items-center gap-1.5 px-3 pt-3 text-xs">
          <HostDot host={s.host} />
          <span className="truncate">Link {sessionTitle(s)} to one of your tasks</span>
          {busy ? <Loader2Icon className="ml-auto size-3.5 shrink-0 animate-spin" /> : null}
        </DialogDescription>
        <Command loop shouldFilter={false} className="**:data-[slot=command-input-wrapper]:p-2">
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search by title, #number, project or status…" aria-label="Search tasks" disabled={busy} />
          <CommandList className="max-h-[min(60vh,28rem)]">
            <CommandEmpty>{data ? 'No matching open tasks.' : tasksError ? `Couldn't load your tasks: ${tasksError}` : 'Loading your tasks…'}</CommandEmpty>
            {current || manual ? (
              <CommandGroup heading="Link">
                {current ? (
                  <CommandItem value="unlink" disabled={busy} onSelect={() => void change(null, 'Unlinked')}>
                    <Link2OffIcon />
                    Unlink #{current.number ?? current.id}
                  </CommandItem>
                ) : null}
                {manual ? (
                  <CommandItem value="automatic" disabled={busy} onSelect={() => void change(undefined, 'Linked automatically again')}>
                    <RotateCcwIcon />
                    Link automatically
                    <span className="ml-auto text-xs text-dimmer">first prompt / most mentioned</span>
                  </CommandItem>
                ) : null}
              </CommandGroup>
            ) : null}
            {list.length ? (
              <CommandGroup heading="Your open tasks">
                {list.map((t) => (
                  <CommandItem
                    key={t.id}
                    value={`task ${t.id}`}
                    disabled={busy}
                    data-checked={current?.id === t.id}
                    onSelect={() => pick(t)}
                    className="items-start [&>svg:last-child]:mt-0.5"
                  >
                    <TaskBadge task={t} manual={manual?.id === t.id} className="mt-0.5" />
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate">{t.title}</span>
                      {t.project ? <span className="truncate text-xs text-dimmer">{t.project}</span> : null}
                    </span>
                    <TaskStatusChip task={t} className="mt-0.5" />
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
