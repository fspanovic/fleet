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
import { StatusDot } from '@/components/StatusDot'
import { SubagentsChip } from '@/components/SubagentsChip'
import { TldrButton } from '@/components/TldrButton'
import { TaskChip } from '@/components/TaskChip'
import { WorkspaceChip } from '@/components/WorkspaceChip'
import { useLongPress } from '@/hooks/useLongPress'
import { sessionMenuHandler } from '@/hooks/useSessionActions'
import { openTitleEditor, useEditing, useSessionTitle } from '@/hooks/useTitles'
import { relTime, sessionSubtitle } from '@/lib/format'
import { sessionHref, statusLabel, statusMeta } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { CARD_CURSOR, CARD_SELECTED, CARD_SURFACE, SESSION_CARD_TEXT, STATUS_TEXT, TITLE_MIN } from '@/lib/styles'
import { echoesTitle } from '@/lib/title'
import { cn } from '@/lib/utils'

export interface BoardCardProps {
  session: Session
  now: number
  selected?: boolean
  cursor?: boolean
  /** Desktop: open through the shell (cursor + focus handling) instead of plain navigation. */
  onOpen?: (s: Session) => void
  /** Board drag'n'drop: the card can be dragged to another column. */
  drag?: { dragging: boolean; onStart: (e: DragEvent) => void; onEnd: () => void }
}

/** One session on the desktop board: status, title (editable in place, see SessionRow), host, subtitle, running subagents, status / waiting_for, context, age; trash on hover / right-click menu as on rows. */
export function BoardCard({ session: s, now, selected, cursor, onOpen, drag }: BoardCardProps) {
  const meta = statusMeta(s.status)
  const { title } = useSessionTitle(s)
  // Selecting text in the title field must not drag the card.
  const editing = useEditing('card', sessionKey(s))
  const prompt = sessionSubtitle(s)
  // The brief's summary line, else the first prompt unless the title is just its slug (no generated title yet).
  const subtitle = s.briefSummary || (echoesTitle(title, prompt) ? '' : prompt)
  const longPress = useLongPress(() => openTitleEditor('card', sessionKey(s)))
  return (
    <Link
      href={sessionHref(s)}
      {...longPress}
      onContextMenu={sessionMenuHandler(s, 'card', longPress.onContextMenu)}
      draggable={drag && !editing ? true : undefined}
      onDragStart={editing ? undefined : drag?.onStart}
      onDragEnd={drag?.onEnd}
      onClick={(e) => {
        if (!onOpen || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        onOpen(s)
      }}
      aria-current={selected ? 'page' : undefined}
      data-session-key={sessionKey(s)}
      data-session-card=""
      className={cn(
        'group/row block animate-enter rounded-[1rem] px-4 py-3.5 text-card-foreground [-webkit-touch-callout:none]',
        CARD_SURFACE,
        SESSION_CARD_TEXT,
        'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        selected && CARD_SELECTED,
        cursor && CARD_CURSOR,
        drag?.dragging && 'opacity-40',
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
      <Jersey playerKey={sessionKey(s)} className="size-10" />
      <div className="min-w-0 flex-1">
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot status={s.status} className="size-2" />
        <EditableTitle session={s} scope="card" className="text-base leading-snug font-semibold tracking-(--tracking-heading)" boxClassName={TITLE_MIN} />
        <HostBadge host={s.host} className="h-4.5 px-1.5 text-3xs" />
        <SessionStyleChip session={s} className="h-4.5 text-3xs" />
        <TldrButton session={s} variant="card" />
        <DeleteSessionButton session={s} className="-my-1 -mr-1.5" />
      </div>
      {subtitle ? <p className="mt-1.5 line-clamp-2 text-body-sm leading-[1.5] break-words text-muted-foreground">{subtitle}</p> : null}
      </div>
      </div>
      <div className="@container mt-3 flex min-w-0 items-center gap-1.5 text-2xs text-dimmer">
        <PrChip session={s} />
        <TaskChip session={s} />
        <JobChip session={s} />
        <SubagentsChip session={s} />
        <WorkspaceChip session={s} />
        <span className={cn('min-w-0 truncate font-medium transition-colors duration-(--dur-slow)', STATUS_TEXT[meta.key])}>{statusLabel(s)}</span>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <ContextMeter context={s.context} variant="tokens" />
          <span className="tabular-nums">{relTime(s.updated_at, now)}</span>
        </span>
      </div>
    </Link>
  )
}
