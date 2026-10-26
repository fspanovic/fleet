import { PinIcon } from 'lucide-react'

import type { Session, Task } from '@/api/types'
import { useSessionTask, useTasks } from '@/hooks/useTasks'
import { CHIP, CHIP_QUIET, TASK_COLOR } from '@/lib/styles'
import { taskColorStyle, taskTooltip } from '@/lib/tasks'
import { cn } from '@/lib/utils'

/** The chip's look: `#<number>`, tinted in the task's status colour (plain outline when it has none); a pin when linked by hand. */
export function TaskBadge({ task: t, manual = false, className }: { task: Task; manual?: boolean; className?: string }) {
  const style = taskColorStyle(t.statusColor)
  return (
    <span
      style={style}
      className={cn(
        CHIP,
        'font-mono',
        style ? [TASK_COLOR, 'bg-(--tc)/14 text-foreground'] : CHIP_QUIET,
        className,
      )}
    >
      {style ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-(--tc)" /> : null}#{t.number ?? t.id}
      {manual ? <PinIcon aria-hidden className="-ml-0.5 size-2.5 shrink-0 opacity-70" /> : null}
    </span>
  )
}

/** A task's workflow status, tinted in its colour with a dot (the plain outline when it has none). */
export function TaskStatusChip({ task: t, className }: { task: Task; className?: string }) {
  if (!t.status) return null
  const style = taskColorStyle(t.statusColor)
  return (
    <span
      style={style}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-2 text-2xs leading-5 font-medium whitespace-nowrap',
        style ? [TASK_COLOR, 'bg-(--tc)/14 text-foreground'] : 'bg-fill text-muted-foreground',
        className,
      )}
    >
      {style ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-(--tc)" /> : null}
      {t.status}
    </span>
  )
}

/**
 * The task a session links (lib/links.ts linkTasks: its manual link, else the open task of yours its first
 * prompt links, else the one its transcript mentions most): `#123` in the task's status colour, a pin when
 * linked by hand; a click opens it in Productive — never the row it sits in. Nothing when tasks are off or
 * it links none.
 */
export function TaskChip({ session: s, className }: { session: Pick<Session, 'host' | 'session_id'>; className?: string }) {
  const t = useSessionTask(s)
  const manual = useTasks().links.manualSessions.has(`${s.host}/${s.session_id}`)
  if (!t) return null
  return (
    <button
      type="button"
      title={manual ? `${taskTooltip(t)}\nLinked by hand` : taskTooltip(t)}
      aria-label={`Task #${t.number ?? t.id}${manual ? ' (linked by hand)' : ''}: open it in Productive`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        window.open(t.url, '_blank', 'noopener,noreferrer')
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className="relative inline-flex shrink-0 rounded-full outline-none after:absolute after:-inset-1.5 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <TaskBadge task={t} manual={manual} className={className} />
    </button>
  )
}
