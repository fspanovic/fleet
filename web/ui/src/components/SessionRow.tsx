import type { DragEvent } from 'react'
import { Link } from 'wouter'

import type { Session } from '@/api/types'
import { ContextMeter } from '@/components/ContextMeter'
import { EditableTitle } from '@/components/EditableTitle'
import { HostBadge } from '@/components/HostBadge'
import { JobChip } from '@/components/JobChip'
import { Jersey } from '@/components/Madrid'
import { PrChip } from '@/components/PrChip'
import { DeleteSessionButton } from '@/components/SessionActions'
import { SessionStyleChip } from '@/components/SessionStyleChip'
import { StackChip } from '@/components/stack/StackChip'
import { StatusDot } from '@/components/StatusDot'
import { SubagentsChip } from '@/components/SubagentsChip'
import { TldrButton } from '@/components/TldrButton'
import { TaskChip } from '@/components/TaskChip'
import { WorkspaceChip } from '@/components/WorkspaceChip'
import { useLongPress } from '@/hooks/useLongPress'
import { sessionMenuHandler } from '@/hooks/useSessionActions'
import { openTitleEditor, useEditing, useSessionTitle } from '@/hooks/useTitles'
import { CHIP, CHIP_QUIET, ROW_CURSOR, ROW_SELECTED, ROW_SURFACE, SESSION_CARD_TEXT, STATUS_TEXT, TITLE_MIN } from '@/lib/styles'
import { relTime, sessionSubtitle, shortCwd } from '@/lib/format'
import { harnessLabel, sessionHarness } from '@/lib/harness'
import { sessionHref, statusLabel, statusMeta } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { echoesTitle } from '@/lib/title'
import { cn } from '@/lib/utils'


export interface SessionRowProps {
  session: Session
  now: number
  /** Desktop sidebar: this row is the session open in the detail pane. */
  selected?: boolean
  /** Desktop sidebar: the keyboard cursor (↑/↓) is on this row. */
  cursor?: boolean
  /** Drag'n'drop in the list (pointer devices): the row can be dragged into place (SessionRowList). */
  drag?: { dragging: boolean; onStart: (e: DragEvent) => void; onEnd: () => void }
}

/**
 * One session in the list: status, title, host, status label / waiting_for, first prompt,
 * stack chip (opens the Stack sheet), job chip (started by a scheduled job), its PR and task chips, running subagents, the workspace handle
 * (a worktree fleet made for it), cwd, backend, context, age; when a `web.sessionStyles` rule matched, its label
 * next to the host. The title is editable in place: the pencil on hover
 * (desktop), ⌘E / F2 on the cursor row, or a long press (touch). Clicking the row opens it; the
 * trash on hover and a right-click (the session menu) delete it. With `drag`, it can be dragged into place.
 */
export function SessionRow({ session: s, now, selected, cursor, drag }: SessionRowProps) {
  const meta = statusMeta(s.status)
  const { title } = useSessionTitle(s)
  const prompt = sessionSubtitle(s)
  // The brief's summary line, else the first prompt unless the title is just its slug (no generated title yet).
  const subtitle = s.briefSummary || (echoesTitle(title, prompt) ? '' : prompt)
  const cwd = shortCwd(s.cwd)
  const backend = String(s.backend || 'unknown')
  const harness = sessionHarness(s)
  const longPress = useLongPress(() => openTitleEditor('row', sessionKey(s)))
  // Selecting text in the title field must not drag the row.
  const editing = useEditing('row', sessionKey(s))

  return (
    <Link
      href={sessionHref(s)}
      {...longPress}
      onContextMenu={sessionMenuHandler(s, 'row', longPress.onContextMenu)}
      aria-current={selected ? 'page' : undefined}
      data-session-key={selected || cursor ? `${s.host}/${s.session_id}` : undefined}
      data-row-key={drag ? sessionKey(s) : undefined}
      data-session-card=""
      draggable={drag ? !editing : undefined}
      onDragStart={drag && !editing ? drag.onStart : undefined}
      onDragEnd={drag?.onEnd}
      className={cn(
        'group/row flex min-h-16 animate-enter gap-2.5 rounded-2xl px-3.5 py-3 text-foreground [-webkit-touch-callout:none]',
        ROW_SURFACE,
        SESSION_CARD_TEXT,
        'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        selected && ROW_SELECTED,
        cursor && ROW_CURSOR,
        drag?.dragging && 'opacity-40',
      )}
    >
      {/* The status dot in its own column, so every line of the row starts under the title. */}
      <span className="flex h-[1.3rem] shrink-0 items-center pointer-coarse:h-6">
        <StatusDot status={s.status} className="size-2" />
      </span>
      <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-start gap-3">
      <Jersey playerKey={sessionKey(s)} className="size-10" />
      <div className="min-w-0 flex-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <EditableTitle session={s} scope="row" className="text-md leading-snug font-semibold tracking-(--tracking-heading)" boxClassName={TITLE_MIN} />
        <HostBadge host={s.host} />
        <SessionStyleChip session={s} />
        {/* The status label and the hover actions wrap to a second line together when they don't fit beside the title. */}
        <span className="flex max-w-full min-w-0 items-center gap-2">
          <span className={cn('min-w-0 truncate text-xs font-medium transition-colors duration-(--dur-slow)', STATUS_TEXT[meta.key])} title={statusLabel(s)}>
            {statusLabel(s)}
          </span>
          <TldrButton session={s} variant="row" />
          <DeleteSessionButton session={s} className="-my-1 -mr-1.5" />
        </span>
      </div>
      {subtitle ? <p className="mt-1 line-clamp-2 text-body-sm leading-[1.45] break-words text-muted-foreground">{subtitle}</p> : null}
      </div>
      </div>
      <div className="@container mt-2 flex min-w-0 items-center gap-1.5 text-2xs text-dimmer">
        <StackChip session={s} />
        <JobChip session={s} />
        <PrChip session={s} />
        <TaskChip session={s} />
        <SubagentsChip session={s} />
        <WorkspaceChip session={s} />
        {cwd ? <span className="min-w-0 truncate font-mono">{cwd}</span> : null}
        {harness !== 'claude' ? (
          <span className={cn(CHIP, 'bg-primary/10 text-[color-mix(in_oklab,var(--color-primary),var(--color-foreground)_30%)]')} title={s.model ?? undefined}>
            {harnessLabel(harness)}
          </span>
        ) : null}
        {backend !== 'unknown' ? <span className={cn(CHIP, CHIP_QUIET, 'font-normal')}>{backend}</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <ContextMeter context={s.context} variant="tokens" />
          <span className="tabular-nums">{relTime(s.updated_at, now)}</span>
        </span>
      </div>
      </div>
    </Link>
  )
}
