import { useEffect, useState } from 'react'
import { CheckIcon, ChevronDownIcon, CircleAlertIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { api, isAbortError } from '@/api/client'
import type { Task, TaskStatusesResponse } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useTasks } from '@/hooks/useTasks'
import { TASK_COLOR } from '@/lib/styles'
import { statusChangeQuestion, taskColorStyle, taskRef, type StatusChangeRequest } from '@/lib/tasks'
import { cn } from '@/lib/utils'

/** A status colour dot (nothing when it has none). */
function StatusMark({ color, className }: { color: string | null | undefined; className?: string }) {
  const style = taskColorStyle(color)
  if (!style) return <span aria-hidden className={cn('size-1.5 shrink-0 rounded-full border border-dimmer', className)} />
  return <span aria-hidden style={style} className={cn(TASK_COLOR, 'size-1.5 shrink-0 rounded-full bg-(--tc)', className)} />
}

/**
 * A task's status chip (tinted in its colour; `quiet`: its dot and name only) that opens a menu of its workflow's statuses (GET
 * /api/tasks/:id/statuses, read each time it opens). Picking one asks first (useTasks().askStatusChange →
 * the provider's TaskStatusDialog); nothing is written from here.
 */
export function TaskStatusMenu({ task: t, quiet = false, className }: { task: Task; quiet?: boolean; className?: string }) {
  const [open, setOpen] = useState(false)
  const { askStatusChange } = useTasks()
  const style = taskColorStyle(t.statusColor)
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Status: ${t.status ?? 'none'} — change ${taskRef(t)}’s status`}
          title="Change the status in Productive"
          style={style}
          className={cn(
            'inline-flex items-center gap-1 rounded border px-1 leading-4 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:min-h-7',
            quiet
              ? cn(TASK_COLOR, 'min-w-0 gap-1.5 border-transparent px-1.5 py-0.5 text-muted-foreground hover:bg-fill-strong hover:text-foreground')
              : style
                ? cn(TASK_COLOR, 'border-(--tc)/35 bg-(--tc)/12 hover:bg-(--tc)/22')
                : 'hover:bg-muted/60',
            className,
          )}
        >
          {style ? <span aria-hidden className={cn('shrink-0 rounded-full bg-(--tc)', quiet ? 'size-2' : 'size-1.5')} /> : null}
          {quiet ? <span className="min-w-0 truncate">{t.status ?? 'No status'}</span> : (t.status ?? 'No status')}
          <ChevronDownIcon className={cn('size-3 shrink-0 text-dimmer', quiet && 'opacity-0 group-hover/row:opacity-100')} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-(--radix-dropdown-menu-content-available-height) w-56 overflow-y-auto">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Move {taskRef(t)} to</DropdownMenuLabel>
        {open ? (
          <StatusItems
            task={t}
            onPick={(status) => {
              setOpen(false)
              askStatusChange({ task: t, status, also: false })
            }}
          />
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The menu's body: mounted only while it is open, so the statuses are read then. */
function StatusItems({ task: t, onPick }: { task: Task; onPick: (s: TaskStatusesResponse['statuses'][number]) => void }) {
  const [data, setData] = useState<TaskStatusesResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const ac = new AbortController()
    api.taskStatuses(t.id, { signal: ac.signal }).then(setData, (err: unknown) => {
      if (!isAbortError(err)) setError((err as Error)?.message || 'could not load the statuses')
    })
    return () => ac.abort()
  }, [t.id])
  if (error) {
    return (
      <p role="alert" className="flex items-start gap-1.5 px-2 py-1.5 text-xs text-destructive">
        <CircleAlertIcon className="mt-px size-3.5 shrink-0" />
        <span className="break-words">{error}</span>
      </p>
    )
  }
  if (!data) {
    return (
      <p className="flex items-center gap-1.5 px-2 py-1.5 text-xs text-dimmer">
        <Loader2Icon className="size-3.5 animate-spin" /> Loading statuses…
      </p>
    )
  }
  if (!data.statuses.length) return <p className="px-2 py-1.5 text-xs text-dimmer">This workflow has no statuses.</p>
  return (
    <>
      {data.statuses.map((st) => {
        const current = st.id === data.current
        return (
          <DropdownMenuItem key={st.id} disabled={current} onSelect={() => onPick(st)} className="min-h-8 pointer-coarse:min-h-10">
            <StatusMark color={st.color} className="size-2" />
            <span className="min-w-0 flex-1 truncate">{st.name}</span>
            {current ? <CheckIcon className="size-3.5 text-dimmer" aria-label="current" /> : null}
          </DropdownMenuItem>
        )
      })}
    </>
  )
}

/**
 * The in-page confirmation of a status change ("Move #5606 to Peer Review?" / after a quick start "Also
 * move #5606 to Working?"). Only Move writes (POST /api/tasks/:id/status); a failure stays in the dialog.
 */
export function TaskStatusDialog({
  request: r,
  onClose,
  onChanged,
}: {
  request: StatusChangeRequest | null
  onClose: () => void
  onChanged: (task: Task) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const close = () => {
    if (busy) return
    setError(null)
    onClose()
  }
  const move = async () => {
    if (!r || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.setTaskStatus(r.task.id, r.status.id)
      onChanged(res.task)
      if (res.changed) toast.success(`Moved ${taskRef(r.task)} to ${res.task.status ?? r.status.name}`, { description: r.task.title })
      else toast.message(`${taskRef(r.task)} already is ${r.status.name}`)
      onClose()
    } catch (err) {
      setError((err as Error)?.message || 'could not change the status')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={r != null} onOpenChange={(o) => (o ? null : close())}>
      <DialogContent>
        {r ? (
          <>
            <DialogHeader>
              <DialogTitle>{statusChangeQuestion(r)}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-1.5">
                <span className="min-w-0 break-words">{r.task.title}</span>
              </DialogDescription>
            </DialogHeader>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {r.task.status ?? 'No status'} →
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <StatusMark color={r.status.color} className="size-2" />
                {r.status.name}
              </span>
              <span className="text-dimmer">· changes it in Productive</span>
            </p>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button variant="outline" onClick={close} disabled={busy}>
                {r.also ? 'Not now' : 'Cancel'}
              </Button>
              <Button onClick={() => void move()} disabled={busy}>
                {busy ? <Loader2Icon className="animate-spin" /> : null}
                Move to {r.status.name}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
