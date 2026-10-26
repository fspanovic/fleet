import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type Ref } from 'react'
import { NotebookTextIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, PlusIcon, SearchIcon, XIcon } from 'lucide-react'

import { DormantCard } from '@/components/board/DormantCard'
import { GroupSection } from '@/components/board/GroupedList'
import { ClosedSection } from '@/components/ClosedSection'
import { DormantSection } from '@/components/DormantSection'
import { HostDot } from '@/components/HostBadge'
import { StatusFilterLabel } from '@/components/JobChip'
import { SessionListSkeleton } from '@/components/SessionListSkeleton'
import { SessionRowList } from '@/components/SessionRowList'
import { StatusDot } from '@/components/StatusDot'
import { UsageSummary } from '@/components/UsageSummary'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ModuleButtons } from '@/components/ModuleNav'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { ViewToggle } from '@/components/ViewToggle'
import type { MoveCard } from '@/hooks/useGroups'
import { useNotesHosts } from '@/hooks/useNotes'
import { ALL_HOSTS, type SessionListState } from '@/hooks/useSessionList'
import { memberId, sectionDrop, type BoardColumn, type GroupEdit, type ViewMode } from '@/lib/groups'
import { isRowDrag } from '@/lib/listOrder'
import { allSessions, visibleStatusFilters, type StatusFilterId } from '@/lib/sessions'
import { ariaShortcut, sessionKey, shortcutHint, withHint } from '@/lib/shortcuts'
import { FILTER_SEGMENT, SEGMENTED, TOOLBAR } from '@/lib/styles'
import { cn } from '@/lib/utils'

const chip = cn('h-7 flex-1 px-2.5 text-xs', FILTER_SEGMENT)

export interface SidebarProps {
  list: SessionListState
  now: number
  cursorKey: string | null
  selectedKey: string | null
  searchRef: Ref<HTMLInputElement>
  /** ↑ / ↓ / Enter inside the search field drive the list cursor. */
  onSearchNav: (action: 'next' | 'prev' | 'open') => void
  onNew: () => void
  onCollapse: () => void
  /** List | Board toggle (omitted → no toggle). */
  viewMode?: ViewMode
  onViewMode?: (v: ViewMode) => void
  /** The list in sections, one per group (server groups on); omitted / null → the flat list. */
  sections?: SidebarSections | null
}

export interface SidebarSections {
  /** The board's columns, top to bottom (lib/groups.ts listSections). */
  columns: BoardColumn[]
  collapsed: readonly string[]
  /** Searching: every section open, its header off. */
  locked: boolean
  onToggle: (id: string) => void
  /** A row dragged into place in its section or another one: the board's card order (useBoardColumns' moveCard). */
  onMove: MoveCard
  /** Sessions can move between groups (the server's groups); `onEdit` moves one, as on the Board. */
  editable: boolean
  onEdit: (e: GroupEdit) => void
}

/** Desktop left column: header + summary, search, status/host filters, the session list (one section per group when the server groups). */
export function Sidebar({ list, now, cursorKey, selectedKey, searchRef, onSearchNav, onNew, onCollapse, viewMode, onViewMode, sections }: SidebarProps) {
  const { fleet, error, query, setQuery, status, setStatus, setHostFilter, hosts, hostNames, host, view, hostCounts, summary, unreachable, note } = list
  const listRef = useRef<HTMLDivElement>(null)

  // Keep the cursor row visible (j/k past the edge).
  useEffect(() => {
    if (!cursorKey) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-session-key="${CSS.escape(cursorKey)}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursorKey])

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      onSearchNav(e.key === 'ArrowDown' ? 'next' : 'prev')
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onSearchNav('open')
    } else if (e.key === 'Escape' && query) {
      // First Esc clears, the second leaves the field (window handler).
      e.preventDefault()
      e.stopPropagation()
      setQuery('')
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div data-tauri-drag-region className="shrink-0 space-y-3 px-3 pt-3 pb-2.5">
        {/* The desktop app's traffic lights sit over this row (see index.css → Desktop app). */}
        <div data-tauri-drag-region="deep" className="titlebar-lead flex min-h-8 items-center gap-2 [--titlebar-offset:0.75rem]">
          <h1 className="brand-title text-xl font-bold tracking-(--tracking-display)">Fleet</h1>
          {fleet ? (
            <div className="flex items-center gap-2.5 text-xs font-medium text-muted-foreground tabular-nums" aria-label="Status summary">
              {summary.waiting > 0 ? (
                <span className="flex items-center gap-1 font-semibold text-status-waiting" title="Needs you">
                  <StatusDot status="waiting" className="size-2" />
                  {summary.waiting}
                </span>
              ) : null}
              <span className="flex items-center gap-1" title="Busy">
                <StatusDot status="busy" className="size-2" />
                {summary.busy}
              </span>
              <span className="flex items-center gap-1" title="Idle">
                <StatusDot status="idle" className="size-2" />
                {summary.idle}
              </span>
            </div>
          ) : null}
          <span
            className={cn('ml-auto truncate text-right text-3xs tabular-nums', note.error ? 'text-destructive' : 'text-dimmer')}
            aria-live="polite"
          >
            {note.text}
          </span>
          <Button size="icon" aria-label="New session" title={withHint('New session', 'new')} onClick={onNew} className="size-8 shrink-0 rounded-full shadow-[0_4px_12px_-4px_color-mix(in_oklab,var(--primary)_70%,transparent)]">
            <PlusIcon />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Collapse sidebar" title={withHint('Collapse sidebar', 'sidebar')} onClick={onCollapse} className="shrink-0 rounded-full text-muted-foreground">
            <PanelLeftCloseIcon />
          </Button>
        </div>

        <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-dimmer" />
          <Input
            ref={searchRef}
            type="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Search name, title, cwd…"
            aria-label="Search sessions"
            aria-keyshortcuts={ariaShortcut('search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            className="h-9 rounded-full border-transparent bg-fill pr-9 pl-8 shadow-none focus-visible:border-transparent focus-visible:bg-card [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute inset-y-0 right-0 grid w-9 place-items-center rounded-r-full text-dimmer outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <XIcon className="size-4" />
            </button>
          ) : (
            <Kbd className="absolute top-1/2 right-2 -translate-y-1/2">{shortcutHint('search')}</Kbd>
          )}
        </div>
          {viewMode && onViewMode ? <ViewToggle value={viewMode} onChange={onViewMode} labels={false} /> : null}
        </div>

        <ToggleGroup
          type="single"
          value={status}
          onValueChange={(v) => v && setStatus(v as StatusFilterId)}
          aria-label="Filter by status"
          spacing={0.5}
          className={cn(SEGMENTED, 'no-scrollbar w-full flex-nowrap overflow-x-auto')}
        >
          {visibleStatusFilters(fleet ? view.counts : null, status).map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} className={chip} title={f.id === 'scheduled' ? 'Sessions started by scheduled jobs' : undefined}>
              <StatusFilterLabel filter={f} />
              <span className="text-2xs text-dimmer tabular-nums group-data-[state=on]/toggle:text-muted-foreground">
                {fleet ? view.counts[f.id] : ''}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {hostNames.length > 1 ? (
          <ToggleGroup
            type="single"
            value={host ?? ALL_HOSTS}
            onValueChange={(v) => v && setHostFilter(v)}
            aria-label="Filter by host"
            spacing={0.5}
            className={cn(SEGMENTED, 'no-scrollbar w-full flex-nowrap overflow-x-auto')}
          >
            <ToggleGroupItem value={ALL_HOSTS} className={chip}>
              All
            </ToggleGroupItem>
            {hosts.map((h) => (
              <ToggleGroupItem key={h.name} value={h.name} className={chip}>
                <HostDot host={h.name} />
                <span className={cn(h.ok === false && 'text-destructive')}>{h.name}</span>
                <span className="text-2xs text-dimmer tabular-nums">{h.ok === false ? '!' : (hostCounts.get(h.name) ?? 0)}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>

      <div ref={listRef} data-session-list className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pt-2 pb-4">
        {error ? (
          <Alert variant="destructive" className="mb-2">
            <AlertDescription>
              {fleet ? `Refresh failed: ${error} — showing last known data` : `Could not reach fleet web: ${error}`}
            </AlertDescription>
          </Alert>
        ) : null}
        {unreachable.map((h) => (
          <Alert key={h.name} variant="destructive" className="mb-2">
            <AlertDescription className="break-words">
              {h.name} unreachable: {h.error || 'no response'}
            </AlertDescription>
          </Alert>
        ))}
        {!fleet ? (
          <SessionListSkeleton />
        ) : sections && sections.columns.length > 0 ? (
          <SectionedList sections={sections} now={now} selectedKey={selectedKey} cursorKey={cursorKey} />
        ) : !sections && view.sessions.length > 0 ? (
          <SessionRowList
            label="Sessions"
            className="flex flex-col gap-2"
            sessions={view.sessions}
            now={now}
            selectedKey={selectedKey}
            cursorKey={cursorKey}
            onMove={list.moveRow}
          />
        ) : unreachable.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-dimmer">
            {allSessions(fleet).length > 0 ? 'Nothing matches.' : 'No Claude sessions running.'}
          </div>
        ) : null}
        {fleet ? <DormantSection now={now} host={host} query={query} desktop className="mt-4" /> : null}
        {fleet ? <ClosedSection now={now} host={host} query={query} desktop className="mt-3" /> : null}
      </div>

      <div className="shrink-0 space-y-2 px-2.5 pt-1 pb-2.5 text-xs text-dimmer">
        <UsageSummary layout="rows" className="rounded-xl bg-fill-hover px-2.5 py-2 hover:bg-fill" />
        {/* Work modules on the left, helper screens (usage, settings) on the right. Jump and the shortcuts live in ⌘K / ⌘? and Settings. */}
        <nav aria-label="Modules" className="flex items-center gap-1.5">
          <div className={TOOLBAR}>
            <ModuleButtons size="icon-sm" group="work" className="rounded-full" />
          </div>
          <span className="ml-auto" />
          <div className={TOOLBAR}>
            <ModuleButtons size="icon-sm" group="utility" className="rounded-full" />
          </div>
        </nav>
      </div>
    </div>
  )
}

/**
 * The list in sections, one per board column (a group's ⋯ makes it the default group). A row drags
 * into place in its section or, by the Board's rules (sectionDrop: out of a group or Ungrouped), into
 * another group's section: onto its rows (a line shows where it
 * lands), its header (collapsed or not) or its "No sessions" (it goes last). The section lights up,
 * the session moves there (`onEdit`) and takes that spot in the board's card order.
 */
function SectionedList({ sections, now, selectedKey, cursorKey }: { sections: SidebarSections; now: number; selectedKey: string | null; cursorKey: string | null }) {
  const { columns, editable } = sections
  const [dragKey, setDragKey] = useState<string | null>(null)
  /** The section a row from another one would move to. */
  const [over, setOver] = useState<string | null>(null)
  const onDrag = (key: string | null) => {
    setDragKey(key)
    if (key == null) setOver(null)
  }

  /** Row `key` lands in section `c` just before row `before` (null: at the end). */
  const land = (c: BoardColumn, key: string, before: string | null) => {
    const d = sectionDrop(columns, key, c.id, editable)
    if (!d) return
    const moved = d.from.id !== c.id
    if (moved) sections.onEdit({ op: 'move', host: d.session.host, session: memberId(d.session), to: c.id })
    sections.onMove(c.id, c.sessions.map(sessionKey), key, before, moved ? d.from.id : undefined)
  }
  /** Is the drag a row of another section that may move into `c`? */
  const incoming = (e: DragEvent, c: BoardColumn) => {
    if (dragKey == null || !isRowDrag(e.dataTransfer)) return false
    const d = sectionDrop(columns, dragKey, c.id, editable)
    return !!d && d.from.id !== c.id
  }
  const drop = (c: BoardColumn) => ({
    over: over === c.id,
    onDragOver(e: DragEvent) {
      if (!incoming(e, c)) {
        if (over === c.id) setOver(null)
        return
      }
      // Over the section's rows the list has placed it (its drop line); anywhere else it goes last.
      if (!e.isDefaultPrevented()) {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }
      if (over !== c.id) setOver(c.id)
    },
    onDragLeave(e: DragEvent) {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === c.id ? null : o))
    },
    onDrop(e: DragEvent) {
      if (!e.isDefaultPrevented() && dragKey != null && incoming(e, c)) {
        e.preventDefault()
        land(c, dragKey, null)
      }
      onDrag(null)
    },
  })

  return (
    <nav aria-label="Sessions" className="flex flex-col gap-4">
      {columns.map((c) => (
        <GroupSection
          key={c.id}
          column={c}
          open={sections.locked || !sections.collapsed.includes(c.id)}
          locked={sections.locked}
          onToggle={() => sections.onToggle(c.id)}
          desktop
          drop={drop(c)}
          onEdit={editable ? sections.onEdit : undefined}
        >
          {c.sessions.length > 0 ? (
            <SessionRowList
              className="flex flex-col gap-2"
              sessions={c.sessions}
              now={now}
              selectedKey={selectedKey}
              cursorKey={cursorKey}
              onMove={(_, key, before) => land(c, key, before)}
              shared={{ key: dragKey, onDrag, accepts: (key) => sectionDrop(columns, key, c.id, editable) != null }}
            />
          ) : !c.dormant?.length ? (
            <p className="px-3 py-1 text-xs text-dimmer">No sessions</p>
          ) : null}
          {c.dormant?.map((m) => <DormantCard key={`${m.host}/${m.id}`} member={m} now={now} desktop />)}
        </GroupSection>
      ))}
    </nav>
  )
}

/** The collapsed sidebar: a thin rail with the essentials. */
export function SidebarRail({
  waiting,
  onExpand,
  onNew,
  onPalette,
}: {
  waiting: number
  onExpand: () => void
  onNew: () => void
  onPalette: () => void
}) {
  return (
    <div data-tauri-drag-region className="titlebar-rail flex h-full w-12 shrink-0 flex-col items-center gap-1 py-3">
      <Button variant="ghost" size="icon" aria-label="Expand sidebar" title={withHint('Expand sidebar', 'sidebar')} onClick={onExpand}>
        <PanelLeftOpenIcon />
      </Button>
      <Button size="icon" aria-label="New session" title={withHint('New session', 'new')} onClick={onNew} className="rounded-full shadow-[0_4px_12px_-4px_color-mix(in_oklab,var(--primary)_70%,transparent)]">
        <PlusIcon />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Jump to a session" title={withHint('Jump to a session', 'palette')} onClick={onPalette}>
        <SearchIcon />
      </Button>
      {waiting > 0 ? (
        <span
          className="mt-1 flex items-center gap-1 text-xs font-semibold text-status-waiting tabular-nums"
          title={`${waiting} need you`}
          aria-label={`${waiting} sessions need you`}
        >
          <StatusDot status="waiting" className="size-2" />
          {waiting}
        </span>
      ) : null}
      <div className="mt-auto flex flex-col items-center gap-1">
        <ModuleButtons side="right" />
      </div>
    </div>
  )
}

/** Link to the notes explorer; nothing when no host has notes. */
export function NotesLink({ className, size = 'icon' }: { className?: string; size?: 'icon' | 'icon-sm' }) {
  const hosts = useNotesHosts()
  if (!hosts.length) return null
  return (
    <Button asChild variant="ghost" size={size} className={cn('text-dimmer hover:text-foreground', className)}>
      <a href="#/notes" aria-label="Notes" title={withHint('Notes', 'notes')}>
        <NotebookTextIcon />
      </a>
    </Button>
  )
}

