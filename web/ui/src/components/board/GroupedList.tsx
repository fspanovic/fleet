import type { DragEventHandler, ReactNode } from 'react'
import { ChevronRightIcon, LayersIcon } from 'lucide-react'

import { DormantCard } from '@/components/board/DormantCard'
import { DefaultGroupMark, GroupColumnMenu } from '@/components/board/GroupColumnMenu'
import { StatusSummaryDots } from '@/components/board/StatusSummaryDots'
import { SessionRow } from '@/components/SessionRow'
import { StackColumnMenu } from '@/components/stack/StackColumnMenu'
import { useCollapsedGroups } from '@/hooks/useGroups'
import { useStackLabel } from '@/hooks/useStackLabels'
import { PENDING_PREFIX, isGroupColumn, type BoardColumn, type GroupEdit } from '@/lib/groups'
import { sessionKey } from '@/lib/shortcuts'
import { SECTION_LABEL } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** Mobile board: one collapsible section per group / session stack (collapsed ids persist in `fleet.groupsCollapsed`); stacks get a ⋯ menu. */
export function GroupedList({ columns, now }: { columns: BoardColumn[]; now: number }) {
  const [collapsed, toggle] = useCollapsedGroups()

  return (
    <div className="flex flex-col gap-5">
      {columns.map((c) => (
        <GroupSection key={c.id} column={c} open={!collapsed.includes(c.id)} onToggle={() => toggle(c.id)}>
          {c.sessions.map((s) => (
            <SessionRow key={sessionKey(s)} session={s} now={now} />
          ))}
          {c.dormant?.map((m) => <DormantCard key={`${m.host}/${m.id}`} member={m} now={now} />)}
        </GroupSection>
      ))}
    </div>
  )
}

export interface GroupSectionProps {
  column: BoardColumn
  open: boolean
  onToggle: () => void
  /** Always open, the header off (desktop: while searching). */
  locked?: boolean
  /** The desktop sidebar's compact header (My tasks' sections): label and count, status dots on the right, description as a tooltip. */
  desktop?: boolean
  /** A drop target for rows dragged in from another section (desktop sidebar): the whole section, its header too; `over` lights it up. */
  drop?: { over: boolean; onDragOver: DragEventHandler; onDragLeave: DragEventHandler; onDrop: DragEventHandler }
  /** The server's groups are editable (desktop sidebar): a group gets a ⋯ menu (Make default). */
  onEdit?: (e: GroupEdit) => void
  /** The section's rows, shown while open. */
  children: ReactNode
}

/** One group / session stack as a collapsible section: the header toggles its rows; a stack (or, with `onEdit`, a group) gets a ⋯ menu beside it. */
export function GroupSection({ column: c, open, onToggle, locked = false, desktop = false, drop, onEdit, children }: GroupSectionProps) {
  const bodyId = `group-${c.id}`
  const groupMenu = onEdit && isGroupColumn(c) && !c.id.startsWith(PENDING_PREFIX)
  const defaultMark = c.isDefault ? <DefaultGroupMark /> : null
  const chevron = (
    <ChevronRightIcon
      className={cn('shrink-0 text-dimmer transition-transform duration-(--dur-base) ease-out', desktop ? 'size-3.5 opacity-70' : 'size-4', open && 'rotate-90')}
    />
  )
  const stackIcon = c.stack ? <LayersIcon aria-label="Session stack" className="size-3.5 shrink-0 text-primary" /> : null
  return (
    <section
      aria-label={c.label}
      onDragOver={drop?.onDragOver}
      onDragLeave={drop?.onDragLeave}
      onDrop={drop?.onDrop}
      className={cn('relative', drop && 'rounded-2xl transition-[background-color,box-shadow]', drop?.over && 'bg-primary/8 ring-1 ring-primary/50')}
    >
      {desktop ? (
        <h2 className="mb-0.5">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            disabled={locked}
            onClick={onToggle}
            title={c.description ?? undefined}
            className="group/sec flex min-h-8 w-full items-center gap-1.5 rounded-lg px-2 text-left outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {chevron}
            {stackIcon}
            <ColumnLabel column={c} className={cn(SECTION_LABEL, 'group-hover/sec:text-muted-foreground', c.ungrouped && 'opacity-80')} />
            {defaultMark}
            <span className="text-2xs text-dimmer/80 tabular-nums">{c.sessions.length}</span>
            <StatusSummaryDots summary={c.summary} className="ml-auto" />
            {c.stack || groupMenu ? <span aria-hidden className="w-7 shrink-0" /> : null}
          </button>
        </h2>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {chevron}
          <span className="min-w-0 flex-1">
            <span className={cn('flex min-w-0 items-center gap-1.5 text-lg font-semibold tracking-(--tracking-heading)', c.ungrouped && 'text-muted-foreground')}>
              {stackIcon}
              <ColumnLabel column={c} />
              {defaultMark}
            </span>
            {c.description ? <span className="block truncate text-xs text-dimmer">{c.description}</span> : null}
          </span>
          <StatusSummaryDots summary={c.summary} />
          <span className="rounded-full bg-fill px-2 text-xs font-medium text-muted-foreground tabular-nums">{c.sessions.length}</span>
          {/* Room for the stack menu, which sits over the button (no button inside a button). */}
          {c.stack || groupMenu ? <span aria-hidden className="w-9 shrink-0" /> : null}
        </button>
      )}
      {c.stack ? (
        <div className={desktop ? 'absolute top-0 right-0 flex h-8 items-center' : 'absolute top-0 right-0 flex h-11 items-center'}>
          <StackColumnMenu stack={c.stack} label={c.label} sessions={c.sessions} className={desktop ? undefined : 'size-10 rounded-lg'} />
        </div>
      ) : groupMenu ? (
        <div className={desktop ? 'absolute top-0 right-0 flex h-8 items-center' : 'absolute top-0 right-0 flex h-11 items-center'}>
          <GroupColumnMenu column={c} onEdit={onEdit} className={desktop ? undefined : 'size-10 rounded-lg'} />
        </div>
      ) : null}
      {open ? (
        <div id={bodyId} className={cn('animate-fade', desktop ? 'flex flex-col gap-2' : 'mt-1 flex flex-col gap-2.5')}>
          {children}
        </div>
      ) : null}
    </section>
  )
}

/** A section's name — a stack's optimistic label while a rename is in flight (hooks/useStackLabels.ts). */
function ColumnLabel({ column: c, className }: { column: BoardColumn; className?: string }) {
  const { label } = useStackLabel(c.stack?.host, c.stack?.id, c.label)
  return <span className={cn('min-w-0 truncate', className)}>{label}</span>
}
