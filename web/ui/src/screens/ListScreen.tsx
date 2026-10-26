import { useRef, useState, type TouchEvent } from 'react'
import { EllipsisIcon, MicIcon, PlusIcon, SearchIcon, TriangleAlertIcon, XIcon, GitPullRequestIcon } from 'lucide-react'
import { useLocation } from 'wouter'

import { GroupedList } from '@/components/board/GroupedList'
import { GroupsStatus } from '@/components/board/GroupsStatus'
import { ClosedSection } from '@/components/ClosedSection'
import { DormantSection } from '@/components/DormantSection'
import { HostDot } from '@/components/HostBadge'
import { StatusFilterLabel } from '@/components/JobChip'
import { NewSessionDrawer } from '@/components/NewSessionDrawer'
import { ModuleMenuItems } from '@/components/ModuleNav'
import { ScreenHeader } from '@/components/ScreenHeader'
import { SessionListSkeleton } from '@/components/SessionListSkeleton'
import { SessionRowList } from '@/components/SessionRowList'
import { StatusDot } from '@/components/StatusDot'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { UsageSummary } from '@/components/UsageSummary'
import { ViewToggle } from '@/components/ViewToggle'
import { useBoardColumns, useGroups, useViewMode } from '@/hooks/useGroups'
import { useSettings } from '@/hooks/useSettings'
import { useNow } from '@/hooks/useNow'
import { ALL_HOSTS, useSessionList } from '@/hooks/useSessionList'
import { pullIntent } from '@/lib/gestures'
import { allSessions, visibleStatusFilters, findStatusFilter, type StatusFilterId } from '@/lib/sessions'
import { FILTER_SEGMENT, SEGMENTED, TOOLBAR } from '@/lib/styles'
import { cn } from '@/lib/utils'

const chipClass = cn('h-9 px-3.5 text-sm', FILTER_SEGMENT)

export function ListScreen() {
  const now = useNow(1000)
  const { fleet, error, query, setQuery, status, setStatus, setHostFilter, hosts, hostNames, host, view, moveRow, hostCounts, summary, unreachable, note } =
    useSessionList(now)
  const [newOpen, setNewOpen] = useState(false)
  const [, navigate] = useLocation()
  const [mode, setMode] = useViewMode()
  const settings = useSettings()
  const board = mode === 'board'
  const groups = useGroups(board)
  const { columns } = useBoardColumns(board, view.sessions, groups.groups, fleet, host, query)
  // The filter rows live in a drawer under the search field, closed by default: swipe down on
  // the header (or tap the handle) opens it, swipe up closes it. Active filters show on the handle.
  const [filtersOpen, setFiltersOpen] = useState(false)
  const filterSummary = [status !== 'all' ? findStatusFilter(status).label : null, host].filter(Boolean).join(' · ')
  const clearFilters = () => {
    setStatus('all')
    setHostFilter(ALL_HOSTS)
  }
  const touch = useRef<{ x: number; y: number } | null>(null)
  const onTouchStart = (e: TouchEvent) => {
    // The search field keeps its own gestures (caret, selection).
    touch.current = e.target instanceof HTMLInputElement ? null : { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onTouchEnd = (e: TouchEvent, onHandle: boolean) => {
    const t = touch.current
    touch.current = null
    if (!t) return
    const intent = pullIntent(e.changedTouches[0].clientX - t.x, e.changedTouches[0].clientY - t.y)
    if (intent === 'open') setFiltersOpen(true)
    else if (intent === 'close') setFiltersOpen(false)
    else if (intent === 'tap' && onHandle) setFiltersOpen((o) => !o)
  }

  return (
    // The list sits on the tinted frame, so each session card (its own surface) stands off the page.
    <div className="flex min-h-app flex-col overflow-x-clip bg-frame">
      <ScreenHeader className="bg-frame/72">
        <div onTouchStart={onTouchStart} onTouchEnd={(e) => onTouchEnd(e, false)}>
        <div className="flex min-h-8 items-center gap-0.5 min-[400px]:gap-1 sm:gap-2.5">
          <h1 className="brand-title mr-1.5 shrink-0 text-2xl font-bold tracking-(--tracking-display) sm:mr-0">Fleet</h1>
          {fleet ? (
            <div className="flex min-w-0 items-center gap-2 overflow-hidden text-xs font-medium text-muted-foreground tabular-nums" aria-label="Status summary">
              {summary.waiting > 0 ? (
                <span className="flex items-center gap-1 font-semibold text-status-waiting">
                  <StatusDot status="waiting" className="size-2" />
                  {summary.waiting}
                </span>
              ) : null}
              <span className="flex items-center gap-1">
                <StatusDot status="busy" className="size-2" />
                {summary.busy}
              </span>
              <span className="flex items-center gap-1">
                <StatusDot status="idle" className="size-2" />
                {summary.idle}
              </span>
            </div>
          ) : null}
          {/* Freshness lives in Settings → Status; the header only flags trouble. */}
          <span className="ml-auto" />
          {note.error || unreachable.length ? (
            <Button asChild variant="ghost" size="icon" className="-my-1 size-8 shrink-0 rounded-full min-[400px]:size-9 sm:size-10 text-destructive [&_svg:not([class*='size-'])]:size-5">
              <a
                href="#/settings"
                role="status"
                aria-label={note.error ? `Offline — ${note.text}` : `${unreachable.map((h) => h.name).join(', ')} unreachable`}
                title={note.error ? note.text : `${unreachable.map((h) => h.name).join(', ')} unreachable`}
              >
                <TriangleAlertIcon />
              </a>
            </Button>
          ) : null}
          <div className={cn(TOOLBAR, '-my-1')}>
          <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 rounded-full min-[400px]:size-9 text-muted-foreground [&_svg:not([class*='size-'])]:size-5">
            <a href="#/prs" aria-label="Pull requests" title="Pull requests">
              <GitPullRequestIcon />
            </a>
          </Button>
          {/* The rest of the screens sit behind one button: the header row is narrow on a phone. */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="More"
                title="More"
                className="size-8 shrink-0 rounded-full min-[400px]:size-9 text-muted-foreground [&_svg:not([class*='size-'])]:size-5"
              >
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              {/* Pull requests stay in the header, the operator is the mic button. */}
              <ModuleMenuItems exclude={['prs', 'operator']} />
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
          <Button
            size="icon"
            aria-label="New session"
            title="New session"
            onClick={() => setNewOpen(true)}
            className="-my-1 ml-1 size-9 shrink-0 rounded-full min-[400px]:size-10 shadow-[0_6px_16px_-6px_color-mix(in_oklab,var(--primary)_75%,transparent)] [&_svg:not([class*='size-'])]:size-5"
          >
            <PlusIcon />
          </Button>
        </div>

        <UsageSummary layout="strip" className="mt-1.5 -mx-1 px-1 py-0.5" />

        <div className="mt-2 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-dimmer" />
          <Input
            type="search"
            inputMode="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Search name, title, cwd…"
            aria-label="Search sessions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 rounded-full border-transparent bg-fill pr-10 pl-10 text-base shadow-none focus-visible:border-transparent focus-visible:bg-card md:text-base [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery('')}
              className="absolute inset-y-0 right-0 grid w-11 place-items-center text-dimmer"
            >
              <XIcon className="size-4" />
            </button>
          ) : null}
        </div>
          <ViewToggle value={mode} onChange={setMode} size="lg" />
        </div>

        <div
          className={cn('grid transition-[grid-template-rows] duration-(--dur-slow) ease-out', filtersOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
          inert={!filtersOpen}
        >
        <div className="min-h-0 overflow-hidden">
        <ToggleGroup
          type="single"
          value={status}
          onValueChange={(v) => v && setStatus(v as StatusFilterId)}
          aria-label="Filter by status"
          spacing={0.5}
          className={cn(SEGMENTED, 'no-scrollbar mt-2.5 w-full overflow-x-auto')}
        >
          {visibleStatusFilters(fleet ? view.counts : null, status).map((f) => (
            <ToggleGroupItem key={f.id} value={f.id} className={chipClass} title={f.id === 'scheduled' ? 'Sessions started by scheduled jobs' : undefined}>
              <StatusFilterLabel filter={f} />
              <span className="text-xs text-dimmer tabular-nums group-data-[state=on]/toggle:text-muted-foreground">
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
            className={cn(SEGMENTED, 'no-scrollbar mt-2 w-full overflow-x-auto')}
          >
            <ToggleGroupItem value={ALL_HOSTS} className={cn(chipClass, 'h-8 text-body-sm')}>
              All
            </ToggleGroupItem>
            {hosts.map((h) => (
              <ToggleGroupItem key={h.name} value={h.name} className={cn(chipClass, 'h-8 text-body-sm')}>
                <HostDot host={h.name} />
                <span className={cn(h.ok === false && 'text-destructive')}>{h.name}</span>
                <span className="text-xs text-dimmer tabular-nums">{h.ok === false ? '!' : (hostCounts.get(h.name) ?? 0)}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}

        {board ? <GroupsStatus state={groups} now={now} size="lg" className="mt-1 -mb-1 justify-between" /> : null}
        </div>
        </div>

        <div className="relative -mb-1.5 flex min-h-6 items-center justify-center">
          <button
            type="button"
            aria-label={filtersOpen ? 'Hide filters' : 'Show filters'}
            aria-expanded={filtersOpen}
            className="flex h-6 min-w-0 flex-1 touch-none items-center justify-center gap-2 outline-none"
            onTouchStart={(e) => {
              e.stopPropagation()
              touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
            }}
            onTouchEnd={(e) => {
              e.stopPropagation()
              e.preventDefault() // no synthetic click after a touch — the touch already decided
              onTouchEnd(e, true)
            }}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <span className={cn('h-1 w-9 shrink-0 rounded-full transition-colors', filtersOpen ? 'bg-muted-foreground/60' : 'bg-muted-foreground/30')} />
            {filterSummary && !filtersOpen ? (
              <span className="min-w-0 truncate text-xs font-medium text-primary">
                {filterSummary}
              </span>
            ) : null}
          </button>
          {filterSummary && !filtersOpen ? (
            <button
              type="button"
              aria-label="Clear filters"
              title="Clear filters"
              onClick={clearFilters}
              className="relative -mr-1 grid size-6 shrink-0 place-items-center rounded-full text-dimmer after:absolute after:-inset-2.5 active:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
        </div>
      </ScreenHeader>

      <main className="flex-1 pb-safe px-safe">
        <div className={cn('mx-auto w-full max-w-3xl px-gutter pt-2', settings.operator ? 'pb-28' : 'pb-8')}>
          {error ? (
            <Alert variant="destructive" className="my-2">
              <AlertDescription>
                {fleet ? `Refresh failed: ${error} — showing last known data` : `Could not reach fleet web: ${error}`}
              </AlertDescription>
            </Alert>
          ) : null}

          {unreachable.map((h) => (
            <Alert key={h.name} variant="destructive" className="my-2">
              <AlertDescription className="break-words">
                {h.name} unreachable: {h.error || 'no response'}
              </AlertDescription>
            </Alert>
          ))}

          {!fleet ? (
            <SessionListSkeleton />
          ) : board && columns.length > 0 ? (
            <GroupedList columns={columns} now={now} />
          ) : view.sessions.length > 0 ? (
            <SessionRowList className="flex flex-col gap-2.5" sessions={view.sessions} now={now} onMove={moveRow} />
          ) : unreachable.length === 0 ? (
            <EmptyState anySessions={allSessions(fleet).length > 0} />
          ) : null}

          {fleet ? <DormantSection now={now} host={host} query={query} className="mt-6" /> : null}
          {fleet ? <ClosedSection now={now} host={host} query={query} className="mt-4" /> : null}
        </div>
      </main>

      {/* The operator: one tap from the list to talking with the fleet. */}
      {settings.operator ? (
        <a
          href="#/operator"
          aria-label="Talk to the operator"
          title="Operator — talk to the fleet"
          className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1.25rem,calc(env(safe-area-inset-bottom)+0.5rem))] z-30 grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-xl transition-[scale,box-shadow] duration-(--dur-fast) ease-spring active:scale-95"
        >
          <MicIcon className="size-6" />
        </a>
      ) : null}
      <NewSessionDrawer open={newOpen} onOpenChange={setNewOpen} onOpenSession={(href) => navigate(href)} />
    </div>
  )
}

function EmptyState({ anySessions }: { anySessions: boolean }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-dimmer">
      {anySessions ? 'Nothing matches.' : 'No Claude sessions running.'}
    </div>
  )
}
