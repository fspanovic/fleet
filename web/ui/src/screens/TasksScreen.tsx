import { createContext, use, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  CalendarIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CornerLeftUpIcon,
  ExternalLinkIcon,
  FlagIcon,
  FoldVerticalIcon,
  FolderIcon,
  GitPullRequestIcon,
  Link2Icon,
  ListChecksIcon,
  ListFilterIcon,
  ListTodoIcon,
  ListTreeIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  OctagonAlertIcon,
  SquareTerminalIcon,
  TriangleAlertIcon,
  HourglassIcon,
  UnfoldVerticalIcon,
  WorkflowIcon,
  XIcon,
  ZapIcon,
} from 'lucide-react'
import { Link, useLocation } from 'wouter'

import type { Session, Task, TaskCount, TaskQuickStart, TaskRef } from '@/api/types'
import { Competition, fixtureLabel, Jersey, MatchState, useMadrid } from '@/components/Madrid'
import { Scoreboard } from '@/components/MadridMatch'
import { NewSessionDialog, NewSessionDrawer, type SpawnPrefill } from '@/components/NewSessionDrawer'
import { PrLinkChip } from '@/components/PrChip'
import { ScreenHeader } from '@/components/ScreenHeader'
import { StatusDot } from '@/components/StatusDot'
import { TaskStatusMenu } from '@/components/TaskStatusMenu'
import { TldrButton } from '@/components/TldrButton'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useNow } from '@/hooks/useNow'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { useTaskQuickStart, type TaskQuickStartState } from '@/hooks/useTaskQuickStart'
import { useTasks, useWatchTasks } from '@/hooks/useTasks'
import { useSessionTitle } from '@/hooks/useTitles'
import { relTime } from '@/lib/format'
import { parseIdList } from '@/lib/groups'
import { sessionHref, statusLabel, statusMeta } from '@/lib/sessions'
import { storage } from '@/lib/storage'
import { SEGMENT, SEGMENTED, TASK_CARD, TASK_ACTIVITY_TEXT, TASK_COLOR } from '@/lib/styles'
import {
  activeTasks,
  DEFAULT_TASKS_GROUP_BY,
  dueLabel,
  focusTasks,
  groupTasks,
  parseHiddenStatuses,
  parseTasksGroupBy,
  bundleByWork,
  relatedTaskIds,
  workBoxIds,
  renderTaskPrompt,
  sessionTasksFirstInGroups,
  TASKS_GROUP_BY_KEY,
  TASKS_HIDDEN_STATUSES_KEY,
  TASKS_WITHOUT_PR_KEY,
  TASKS_WITHOUT_SESSION_KEY,
  taskActivity,
  taskColorStyle,
  taskPrompt,
  taskStatuses,
  statusVariantKey,
  statusVariants,
  toggleHiddenStatus,
  type TaskActivity,
  type TaskFocus,
  type TaskGroup,
  type TaskItem,
  type TaskStatusOption,
  type TasksGroupBy,
} from '@/lib/tasks'
import { cn } from '@/lib/utils'

const collapsedKey = (by: TasksGroupBy) => `fleet.tasksCollapsed.${by}`
const BOXES_COLLAPSED_KEY = 'fleet.tasksBoxesCollapsed'

/**
 * `#/tasks`: your open tasks in Productive (GET /api/tasks) as a list, one row per task (TaskRow). A click on a
 * title opens the New session form with the task's link and title as the first prompt. On a row: the PRs whose
 * description links it (→ the PR dialog) and the live sessions whose first prompt does (→ the session). Grouped by project (default) or
 * status (`fleet.tasksGroupBy`), coloured with Productive's own status / project colours; groups collapse (ids per grouping in
 * `fleet.tasksCollapsed.<project|status>`, all open while filtering). Focus filters (persisted, default off):
 * hide statuses (`fleet.tasksHiddenStatuses`), tasks with a live session (`fleet.tasksWithoutSession`) or a
 * PR (`fleet.tasksWithoutPr`); the status line counts what they hide. Quick starts (`web.tasks.quickStart`)
 * are buttons on each row that spawn at once (useTaskQuickStart). Within a group, each milestone / parent task is a
 * foldable sub-header over its subtasks (WorkBlock). `pane` = the desktop layout (over the whole window);
 * `screen` = mobile (swipe back). A task a live session links (any status) names its sessions on its row, sits on
 * top of its loose tasks (waiting → working → idle) and is also listed in the "In sessions" band above the groups
 * (SessionTasks → the session), which the focus filters and the text filter leave alone. Each of those sessions
 * has a TL;DR beside its name (TldrButton); the status chip opens the task's workflow statuses (TaskStatusMenu),
 * and a pick is confirmed in the page before it is written to Productive.
 */
export function TasksScreen({ layout = 'screen' }: { layout?: 'screen' | 'pane' }) {
  const pane = layout === 'pane'
  const [, navigate] = useLocation()
  const madrid = useMadrid()
  useWatchTasks()
  const { data, error, notConfigured, loading, refresh, refreshing, links } = useTasks()
  const [q, setQ] = useState('')
  const now = useNow(30_000)
  const [by, setBy] = usePersistentState<TasksGroupBy>(TASKS_GROUP_BY_KEY, DEFAULT_TASKS_GROUP_BY, parseTasksGroupBy)
  const [hiddenRaw, setHiddenRaw] = usePersistentState<string>(TASKS_HIDDEN_STATUSES_KEY, '[]', (r) => (parseHiddenStatuses(r) ? r : undefined))
  const [withoutSession, setWithoutSession] = usePersistentState<boolean>(TASKS_WITHOUT_SESSION_KEY, false, (r) => r === 'true')
  const [withoutPr, setWithoutPr] = usePersistentState<boolean>(TASKS_WITHOUT_PR_KEY, false, (r) => r === 'true')
  const focus = useMemo<TaskFocus>(
    () => ({ hiddenStatuses: parseHiddenStatuses(hiddenRaw) ?? [], withoutSession, withoutPr }),
    [hiddenRaw, withoutSession, withoutPr],
  )
  const setHiddenStatuses = (list: string[]) => setHiddenRaw(JSON.stringify(list))
  const showAll = () => {
    setHiddenStatuses([])
    setWithoutSession(false)
    setWithoutPr(false)
  }
  const focused = focusTasks(data?.tasks, focus, links)
  const active = useMemo(() => activeTasks(data?.tasks, links), [data?.tasks, links])
  const groups = sessionTasksFirstInGroups(groupTasks(focused.tasks, q, by), links)
  const statuses = taskStatuses(data?.tasks)
  const [collapsed, setCollapsed] = useState<Record<TasksGroupBy, string[]>>(() => ({
    project: parseIdList(storage.getJSON(collapsedKey('project'))),
    status: parseIdList(storage.getJSON(collapsedKey('status'))),
  }))
  const [hovered, setHovered] = useState<string | null>(null)
  const [folded, setFolded] = useState<string[]>(() => parseIdList(storage.getJSON(BOXES_COLLAPSED_KEY)))
  const saveFolded = (ids: string[]) => {
    setFolded(ids)
    storage.setJSON(BOXES_COLLAPSED_KEY, ids)
  }
  const boxIds = useMemo(() => workBoxIds(data?.tasks), [data?.tasks])
  const allFolded = boxIds.length > 0 && boxIds.every((id) => folded.includes(id))
  const mine = useMemo(() => new Map((data?.tasks ?? []).map((t) => [t.id, t])), [data?.tasks])
  const variants = useMemo(() => statusVariants(data?.tasks), [data?.tasks])
  const relations = useMemo<Relations>(() => {
    const t = hovered ? mine.get(hovered) : undefined
    return {
      mine,
      variants,
      lit: t ? relatedTaskIds(t, data?.tasks ?? []) : null,
      hover: setHovered,
      folded: new Set(folded),
      fold: (id, on) => {
        const rest = folded.filter((x) => x !== id)
        saveFolded(on ? [...rest, id] : rest)
      },
    }
  }, [hovered, mine, variants, data?.tasks, folded])
  const foldAllButton = boxIds.length ? (
    <button
      type="button"
      aria-pressed={allFolded}
      onClick={() => saveFolded(allFolded ? [] : boxIds)}
      title={allFolded ? 'Show every milestone\'s tasks' : 'Fold every milestone to its header'}
      aria-label={allFolded ? 'Unfold milestones' : 'Fold milestones'}
      className={pillClass(allFolded, pane ? 'sm' : 'lg')}
    >
      {allFolded ? <UnfoldVerticalIcon className="size-3.5" /> : <FoldVerticalIcon className="size-3.5" />}
      {pane ? null : allFolded ? 'Unfold milestones' : 'Fold milestones'}
    </button>
  ) : null
  const filtering = q.trim() !== ''
  const isOpen = (id: string) => filtering || !collapsed[by].includes(id)
  const toggle = (id: string) => {
    const ids = collapsed[by]
    const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
    setCollapsed({ ...collapsed, [by]: next })
    storage.setJSON(collapsedKey(by), next)
  }
  const [startWith, setStartWith] = useState<SpawnPrefill | null>(null)
  const start = (t: Task) => setStartWith({ prompt: taskPrompt(t), title: 'New session from task' })
  const quick = useTaskQuickStart((href) => navigate(href))

  const back = () => {
    if (!pane && window.history.length > 1) window.history.back()
    else navigate('/', { replace: !pane })
  }
  const screenRef = useRef<HTMLDivElement>(null)
  useSwipeBack(screenRef, back, !pane && !startWith)

  const refreshButton = (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Refresh tasks"
      title="Fetch from Productive now"
      onClick={() => void refresh()}
      disabled={refreshing || notConfigured}
      className={cn('shrink-0', pane ? 'size-9 rounded-full text-muted-foreground' : '-my-1.5 size-11 rounded-full')}
    >
      <RefreshCwIcon className={cn('size-5', refreshing && 'animate-spin')} />
    </Button>
  )

  const filter = (
    <div className="relative w-full">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter tasks"
        aria-label="Filter tasks"
        className="h-8 pl-8"
      />
    </div>
  )

  const groupToggle = <GroupByToggle value={by} onChange={setBy} size={pane ? 'sm' : 'lg'} />
  const focusControls = (
    <FocusControls
      statuses={statuses}
      focus={focus}
      onHiddenStatuses={setHiddenStatuses}
      onWithoutSession={setWithoutSession}
      onWithoutPr={setWithoutPr}
      onShowAll={showAll}
      size={pane ? 'sm' : 'lg'}
    />
  )
  const hiddenNote = focused.hidden ? (
    <>
      {' · '}
      <button
        type="button"
        onClick={showAll}
        title="Clear the focus filters"
        className="rounded-sm text-foreground underline decoration-dotted underline-offset-2 outline-none hover:decoration-solid focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {focused.hidden} hidden — show all
      </button>
    </>
  ) : null

  const fetched = data ? relTime(data.fetchedAt, now) : ''
  const status = notConfigured ? (
    <div className="rounded-xl border border-dashed border-hairline p-3 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">My tasks is not set up on this server.</p>
      <p className="mt-1 text-xs">
        Add <code className="font-mono">web.tasks.productive</code> to its fleet config (a Keychain item or{' '}
        <code className="font-mono">PRODUCTIVE_AUTH_TOKEN</code>), then restart the server.
        {error ? <span className="block pt-1 text-dimmer">{error}</span> : null}
      </p>
    </div>
  ) : (
    <p className={cn('text-xs', data?.stale || error ? 'text-status-waiting' : 'text-dimmer')}>
      {error && !data ? (
        <span className="inline-flex items-start gap-1">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0" />
          {error}
        </span>
      ) : data ? (
        <>
          {data.stale || error ? <TriangleAlertIcon className="mr-1 inline size-3.5 align-[-2px]" /> : null}
          {data.count} open{hiddenNote} · {fetched ? `fetched ${fetched} ago` : 'fetched just now'} from Productive
          {data.error || error ? ` — ${data.error ?? error}` : ''}
          {data.truncated ? ' · some tasks are missing (too many to list)' : ''}
        </>
      ) : null}
    </p>
  )

  const skeleton = (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2 rounded-xl bg-fill-hover p-3">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  )
  const showSkeleton = loading && !data && !error
  const empty =
    data && !groups.length ? (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {q ? 'No task matches.' : focused.hidden ? `All ${focused.hidden} open tasks are hidden by the filters.` : madrid ? 'No fixtures. Rest day.' : 'No open tasks assigned to you.'}
        {focused.hidden ? (
          <Button variant="link" size="sm" onClick={showAll} className="ml-1 h-auto p-0 align-baseline">
            Show all
          </Button>
        ) : null}
      </p>
    ) : null

  const NewSession = pane ? NewSessionDialog : NewSessionDrawer
  const form = (
    <NewSession open={startWith != null} onOpenChange={(o) => !o && setStartWith(null)} onOpenSession={(href) => navigate(href)} prefill={startWith} />
  )

  if (pane) {
    return (
      <Relations value={relations}>
      <section aria-label="My tasks" className={cn('flex h-full min-w-0 flex-1 flex-col bg-background', madrid && 'madrid-board')}>
        <header
          data-tauri-drag-region="deep"
          className="titlebar titlebar-lead flex shrink-0 items-center gap-2 py-2 pr-3 pl-5 [--titlebar-pad:1.25rem]"
        >
          <h1 className="flex shrink-0 items-center gap-2 text-lg font-bold tracking-(--tracking-display)">
            <ListTodoIcon className="size-4 text-muted-foreground" /> My tasks
            {madrid ? <span className="text-sm font-medium text-muted-foreground">· Fixtures</span> : null}
          </h1>
          <div className="mx-2 flex max-w-md min-w-0 flex-1">{filter}</div>
          {madrid ? <Scoreboard /> : null}
          {focusControls}
          {foldAllButton}
          {groupToggle}
          {refreshButton}
          <Button variant="ghost" size="icon" aria-label="Close" title="Close (Esc)" onClick={() => navigate('/')} className="ml-auto size-9 shrink-0 rounded-full text-muted-foreground">
            <XIcon className="size-5" />
          </Button>
        </header>
        <div className="shrink-0 px-4 pt-2">{status}</div>
        {active.length ? (
          <div className="shrink-0 px-4 pt-2">
            <SessionTasks items={active} pane />
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">
          <div className="mx-auto max-w-6xl space-y-6">
            {showSkeleton ? skeleton : null}
            {groups.map((g) => (
              <Section
                key={g.id}
                group={g}
                by={by}
                now={now}
                onStart={start}
                quick={quick}
                open={isOpen(g.id)}
                locked={filtering}
                onToggle={() => toggle(g.id)}
              />
            ))}
            {empty}
          </div>
        </div>
        {form}
      </section>
      </Relations>
    )
  }

  return (
    <Relations value={relations}>
    <div ref={screenRef} className="flex min-h-app flex-col bg-background">
      <ScreenHeader>
        <div className="-ml-2 flex min-h-8 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={back} className="-my-1.5 size-11 shrink-0 rounded-full">
            <ChevronLeftIcon className="size-6" />
          </Button>
          <h1 className="flex-1 text-2xl font-bold tracking-(--tracking-display)">My tasks</h1>
          {refreshButton}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <div className="min-w-0 flex-1">{filter}</div>
          {groupToggle}
        </div>
        <div className="no-scrollbar -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4">
          {focusControls}
          {foldAllButton}
        </div>
      </ScreenHeader>
      <div className="mx-auto w-full max-w-lg space-y-6 px-gutter pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] md:max-w-2xl">
        {status}
        {active.length ? <SessionTasks items={active} /> : null}
        {showSkeleton ? skeleton : null}
        {groups.map((g) => (
          <Section
            key={g.id}
            group={g}
            by={by}
            now={now}
            onStart={start}
            quick={quick}
            open={isOpen(g.id)}
            locked={filtering}
            onToggle={() => toggle(g.id)}
          />
        ))}
        {empty}
      </div>
      {form}
    </div>
    </Relations>
  )
}

/** Status | Project. `size="lg"` on mobile (44px tap targets). */
function GroupByToggle({ value, onChange, size }: { value: TasksGroupBy; onChange: (v: TasksGroupBy) => void; size: 'sm' | 'lg' }) {
  const item = cn(
    'gap-1.5',
    SEGMENT,
    size === 'lg' ? 'h-10 min-w-11 px-3 text-sm' : 'h-7 min-w-7 px-2.5 text-xs',
  )
  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(v) => {
        const next = parseTasksGroupBy(v)
        if (next) onChange(next)
      }}
      aria-label="Group by"
      spacing={0.5}
      className={SEGMENTED}
    >
      <ToggleGroupItem value="status" aria-label="Group by status" title="Group by workflow status" className={item}>
        <WorkflowIcon className="size-3.5" />
        Status
      </ToggleGroupItem>
      <ToggleGroupItem value="project" aria-label="Group by project" title="Group by project" className={item}>
        <FolderIcon className="size-3.5" />
        Project
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

/** A filter pill (as the pull requests' Drafts toggle); `size="lg"` on mobile. */
const pillClass = (on: boolean, size: 'sm' | 'lg') =>
  cn(
    'flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
    size === 'lg' ? 'h-9' : 'h-7',
    on ? 'border-transparent bg-primary/12 text-foreground ring-1 ring-primary/30 ring-inset' : 'border-transparent bg-fill text-muted-foreground hover:bg-fill-strong hover:text-foreground',
  )

/**
 * The focus filters: a Status menu (a checkbox per status present — unticked = hidden — and "Show every
 * status") and the Without session / Without PR toggles.
 */
function FocusControls({
  statuses,
  focus,
  onHiddenStatuses,
  onWithoutSession,
  onWithoutPr,
  onShowAll,
  size,
}: {
  statuses: TaskStatusOption[]
  focus: TaskFocus
  onHiddenStatuses: (list: string[]) => void
  onWithoutSession: (on: boolean) => void
  onWithoutPr: (on: boolean) => void
  onShowAll: () => void
  size: 'sm' | 'lg'
}) {
  const hidden = statuses.filter((st) => focus.hiddenStatuses.includes(st.id))
  const item = size === 'lg' ? 'min-h-10' : ''
  return (
    <div role="group" aria-label="Focus filters" className="flex shrink-0 items-center gap-1.5">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={hidden.length ? `Statuses, ${hidden.length} hidden` : 'Statuses'}
            title="Show or hide tasks by workflow status"
            className={pillClass(hidden.length > 0, size)}
          >
            <ListFilterIcon className="size-3.5" />
            Statuses
            {hidden.length ? <span className="text-dimmer tabular-nums">−{hidden.length}</span> : null}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-(--radix-dropdown-menu-content-available-height) w-60 overflow-y-auto">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Show tasks in</DropdownMenuLabel>
          {statuses.length ? null : <p className="px-2 py-1.5 text-xs text-dimmer">No tasks yet.</p>}
          {statuses.map((st) => (
            <DropdownMenuCheckboxItem
              key={st.id}
              checked={!focus.hiddenStatuses.includes(st.id)}
              // Stay open: several statuses are usually hidden at once.
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(on) => onHiddenStatuses(toggleHiddenStatus(focus.hiddenStatuses, st.id, !on))}
              className={item}
            >
              <ColorMark color={st.color} shape="dot" />
              <span className="min-w-0 flex-1 truncate">{st.title}</span>
              <span className="text-xs text-dimmer tabular-nums">{st.count}</span>
            </DropdownMenuCheckboxItem>
          ))}
          {focus.hiddenStatuses.length ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onHiddenStatuses([])} className={item}>
                Show every status
              </DropdownMenuItem>
            </>
          ) : null}
          {focus.hiddenStatuses.length || focus.withoutSession || focus.withoutPr ? (
            <DropdownMenuItem onSelect={onShowAll} className={item}>
              Clear all filters
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        aria-pressed={focus.withoutSession}
        onClick={() => onWithoutSession(!focus.withoutSession)}
        title={focus.withoutSession ? 'Show tasks that have a live session too' : 'Hide tasks that already have a live session'}
        className={pillClass(focus.withoutSession, size)}
      >
        <SquareTerminalIcon className="size-3.5" />
        Without session
      </button>
      <button
        type="button"
        aria-pressed={focus.withoutPr}
        onClick={() => onWithoutPr(!focus.withoutPr)}
        title={focus.withoutPr ? 'Show tasks that have a PR too' : 'Hide tasks that already have a PR'}
        className={pillClass(focus.withoutPr, size)}
      >
        <GitPullRequestIcon className="size-3.5" />
        Without PR
      </button>
    </div>
  )
}

/**
 * A Productive colour marker: a dot for a status, a rounded square for a project (as Productive draws
 * them). Nothing when the colour is unknown.
 */
function ColorMark({ color, shape, className }: { color: string | null | undefined; shape: 'dot' | 'square'; className?: string }) {
  const style = taskColorStyle(color)
  if (!style) return null
  return (
    <span
      aria-hidden
      style={style}
      className={cn(TASK_COLOR, 'inline-block shrink-0 bg-(--tc)', shape === 'dot' ? 'size-2 rounded-full' : 'size-2 rounded-[3px]', className)}
    />
  )
}

/**
 * How the cards tie together: every listed task by id, and while the pointer is on a card the ids of the tasks
 * related to it (lib/tasks.ts relatedTaskIds: parent, tree top, subtasks, dependencies), which light up.
 */
interface Relations {
  mine: ReadonlyMap<string, Task>
  /** Statuses sharing a colour told apart (lib/tasks.ts statusVariants). */
  variants: ReadonlyMap<string, number>
  lit: ReadonlySet<string> | null
  hover: (id: string | null) => void
  /** The milestone / parent boxes folded, and folding one. */
  folded: ReadonlySet<string>
  fold: (id: string, fold: boolean) => void
}

const RelationsContext = createContext<Relations>({ mine: new Map(), variants: new Map(), lit: null, hover: () => {}, folded: new Set(), fold: () => {} })

function Relations({ value, children }: { value: Relations; children: ReactNode }) {
  return <RelationsContext value={value}>{children}</RelationsContext>
}

/**
 * A task's workflow status on its card (index.css `.task-status`): a rail down the left edge in the status colour,
 * a shade and rail pattern of its own when another status shares that colour. Neutral (nothing)
 * when the task has no status or its colour is unknown.
 */
function useStatusTone(t: Pick<Task, 'status' | 'statusColor'> | null | undefined) {
  const { variants } = use(RelationsContext)
  const style = t?.status ? taskColorStyle(t.statusColor) : undefined
  if (!t || !style) return { className: undefined, style: undefined, 'data-status-variant': undefined }
  return { className: cn(TASK_COLOR, 'task-status'), style, 'data-status-variant': variants.get(statusVariantKey(t)) || undefined }
}

/** To a related task's card (scrolled to, flashed) when it is listed; otherwise to the task in Productive. */
function jumpToTask(r: TaskRef) {
  const el = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(r.id)}"]`)
  if (!el) {
    window.open(r.url, '_blank', 'noopener')
    return
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  el.classList.remove('task-flash')
  void el.offsetWidth
  el.classList.add('task-flash')
  el.addEventListener('animationend', () => el.classList.remove('task-flash'), { once: true })
}

/** How deep a task sits under its box's top task, through parents that are listed too; at most 3. */
function nestDepth(t: Task, topId: string | undefined, mine: ReadonlyMap<string, Task>): number {
  if (!topId) return 0
  let depth = 0
  let p = t.parent
  while (p && p.id !== topId && depth < 3) {
    const up = mine.get(p.id)
    if (!up) break
    depth += 1
    p = up.parent
  }
  return depth
}

const DEPENDENCY = {
  waitingOn: { label: 'Waiting on', icon: HourglassIcon, tone: 'bg-destructive/12 text-destructive' },
  blocks: { label: 'Blocks', icon: OctagonAlertIcon, tone: 'bg-status-waiting/15 text-status-waiting' },
  linked: { label: 'Linked', icon: Link2Icon, tone: 'bg-fill-strong text-muted-foreground' },
} as const

const REL_CHIP =
  'inline-flex h-6 max-w-full min-w-0 items-center gap-1 rounded-md px-1.5 text-2xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50 lg:h-5'

/** A related task as a chip: → its card when listed, else → Productive. Closed ones are struck through and quiet. */
function RelChip({ task: r, icon: Icon, label, tone, title }: { task: TaskRef; icon: typeof FlagIcon; label: string; tone: string; title: string }) {
  const { mine } = use(RelationsContext)
  const listed = mine.has(r.id)
  return (
    <button
      type="button"
      onClick={() => jumpToTask(r)}
      title={`${title}: #${r.number ?? r.id} ${r.title}${r.closed ? ' (closed)' : ''} — ${listed ? 'show its card' : 'open in Productive'}`}
      className={cn(REL_CHIP, r.closed ? 'bg-fill text-dimmer line-through' : tone, 'hover:brightness-110')}
    >
      <Icon aria-hidden className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}

/** `3/5` subtasks or to-dos done; all done turns green. */
function CountChip({ count: c, icon: Icon, noun }: { count: TaskCount; icon: typeof FlagIcon; noun: string }) {
  const done = c.total - c.open
  return (
    <span
      title={`${done} of ${c.total} ${noun} done`}
      className={cn(REL_CHIP, 'tabular-nums', done === c.total ? 'bg-status-busy/12 text-status-busy' : 'bg-fill-strong text-muted-foreground')}
    >
      {done === c.total ? <CheckIcon aria-hidden className="size-3 shrink-0" /> : <Icon aria-hidden className="size-3 shrink-0" />}
      {done}/{c.total}
    </span>
  )
}

/**
 * A task's ties: the milestone / parent it sits under (unless the group or the card above already says so), its
 * dependencies (waiting on, blocks, linked) and its subtask / to-do progress.
 */
function TaskRelations({ task: t, hide }: { task: Task; hide: ReadonlySet<string> }) {
  const up = [t.root, t.parent].filter((r): r is TaskRef => !!r && !hide.has(r.id))
  const deps = t.dependencies ?? []
  if (!up.length && !deps.length && !t.subtasks && !t.todos) return null
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {up.map((r) => (
        <RelChip
          key={r.id}
          task={r}
          icon={r.keyTask ? FlagIcon : CornerLeftUpIcon}
          label={`${r.number ? `#${r.number} ` : ''}${r.title}`}
          tone={r.keyTask ? 'bg-primary/12 text-primary' : 'bg-fill-strong text-muted-foreground'}
          title={r.keyTask ? 'Milestone' : 'Parent task'}
        />
      ))}
      {deps.map((d) => {
        const k = DEPENDENCY[d.kind]
        return (
          <RelChip
            key={`${d.kind}-${d.task.id}`}
            task={d.task}
            icon={k.icon}
            label={`${d.kind === 'linked' ? '' : `${k.label} `}#${d.task.number ?? d.task.id}`}
            tone={k.tone}
            title={k.label}
          />
        )
      })}
      {t.subtasks ? <CountChip count={t.subtasks} icon={ListTreeIcon} noun="subtasks" /> : null}
      {t.todos ? <CountChip count={t.todos} icon={ListChecksIcon} noun="to-dos" /> : null}
    </span>
  )
}

interface GroupProps {
  group: TaskGroup
  by: TasksGroupBy
  now: number
  onStart: (t: Task) => void
  quick: TaskQuickStartState
  open: boolean
  locked: boolean
  onToggle: () => void
}

/** A group's header: the button that opens / collapses its body (`bodyId`); off while `locked` (filtering: every group open). */
function GroupTitle({
  group: g,
  by,
  open,
  locked,
  onToggle,
  bodyId,
  className,
}: Pick<GroupProps, 'group' | 'by' | 'open' | 'locked' | 'onToggle'> & { bodyId: string; className?: string }) {
  const madrid = useMadrid()
  return (
    <h2 className="mb-1 text-sm font-semibold">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        disabled={locked}
        onClick={onToggle}
        className={cn('flex w-full items-center gap-2 rounded-lg px-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50', madrid && 'madrid-stage rounded-none px-1 pb-1.5', className)}
      >
        <ChevronRightIcon className={cn('size-4 shrink-0 text-dimmer transition-transform', open && 'rotate-90')} />
        <ColorMark color={g.color} shape={by === 'project' ? 'square' : 'dot'} className="size-2.5" />
        {madrid ? (
          <>
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate">{g.title}</span>
              <Competition name={g.title} />
            </span>
            <span className="madrid-count tabular-nums">{g.tasks.length}</span>
          </>
        ) : (
          <>
            <span className="min-w-0 truncate">{g.title}</span>
            <span className="text-xs font-normal text-dimmer tabular-nums">{g.tasks.length}</span>
          </>
        )}
      </button>
    </h2>
  )
}

/** A group (a project, or a status) as a titled list; its header stays on top while its rows scroll under it. */
function Section({ group: g, by, now, onStart, quick, open, locked, onToggle }: GroupProps) {
  const bodyId = useId()
  return (
    <section aria-label={g.title}>
      <GroupTitle group={g} by={by} open={open} locked={locked} onToggle={onToggle} bodyId={bodyId} className="sticky top-0 z-10 min-h-9 bg-background lg:min-h-8" />
      {open ? (
        <div id={bodyId} className="space-y-3">
          <GroupBody tasks={g.tasks} by={by} now={now} onStart={onStart} quick={quick} />
        </div>
      ) : null}
    </section>
  )
}

type RowProps = Pick<GroupProps, 'by' | 'now' | 'onStart' | 'quick'>

type WorkItem = Extract<TaskItem, { kind: 'work' }>

/**
 * A group's tasks: each milestone / parent task (lib/tasks.ts bundleByWork) as a sub-header over its subtasks, then
 * the loose tasks (under "Other tasks" when there is a milestone above them).
 */
function GroupBody({ tasks, ...row }: RowProps & { tasks: readonly Task[] }) {
  const items = bundleByWork(tasks)
  const works = items.filter((i): i is WorkItem => i.kind === 'work')
  const loose = items.flatMap((i) => (i.kind === 'task' ? [i.task] : []))
  return (
    <>
      {works.map((i) => (
        <WorkBlock key={`work-${i.work.id}`} item={i} {...row} />
      ))}
      {loose.length ? (
        <div>
          {works.length ? <h3 className="px-2 pt-1 pb-0.5 text-2xs font-semibold tracking-wider text-dimmer uppercase">Other tasks</h3> : null}
          <ul>
            {loose.map((t) => (
              <TaskRow key={t.id} task={t} {...row} />
            ))}
          </ul>
        </div>
      ) : null}
    </>
  )
}

const PROGRESS = [
  { key: 'started', label: 'in progress', bar: 'bg-primary' },
  { key: 'notStarted', label: 'to do', bar: 'bg-(--hairline-strong)' },
  { key: 'closed', label: 'done', bar: 'bg-status-busy' },
] as const

/** Your tasks under a milestone by workflow category: a segmented bar and its counts. */
function WorkProgress({ tasks, className }: { tasks: readonly Task[]; className?: string }) {
  const counts = PROGRESS.map((p) => ({ ...p, n: tasks.filter((t) => (t.statusCategory ?? 'notStarted') === p.key).length })).filter((p) => p.n)
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <div className="flex h-1.5 w-24 shrink-0 gap-px overflow-hidden rounded-full bg-fill" aria-hidden>
        {counts.map((p) => (
          <span key={p.key} className={p.bar} style={{ flexGrow: p.n }} />
        ))}
      </div>
      <span className="truncate text-2xs text-muted-foreground tabular-nums">{counts.map((p) => `${p.n} ${p.label}`).join(' · ')}</span>
    </div>
  )
}

/** A row's trailing actions, shown under the pointer or keyboard focus (always on touch). */
const ROW_ACTIONS = 'flex shrink-0 items-center gap-1 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 pointer-coarse:opacity-100'
/** On a task row they float over its right end (taking no room, so a full row never wraps for them); in flow on touch. */
const ROW_ACTIONS_FLOAT =
  'pointer-fine:pointer-events-none pointer-fine:absolute pointer-fine:top-1/2 pointer-fine:right-1 pointer-fine:-translate-y-1/2 pointer-fine:rounded-full pointer-fine:bg-float pointer-fine:p-0.5 pointer-fine:shadow-float pointer-fine:group-hover/row:pointer-events-auto pointer-fine:group-focus-within/row:pointer-events-auto'

/** Open it in Productive. */
function OpenLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="icon" className="size-7 rounded-full text-muted-foreground">
      <a href={href} target="_blank" rel="noreferrer" aria-label={label} title="Open in Productive">
        <ExternalLinkIcon className="size-3.5" />
      </a>
    </Button>
  )
}

/**
 * A milestone (key task) or parent task with your subtasks in this group: a two-line sub-header (its icon and title,
 * then its number and your subtasks' progress; when the task itself is yours, its status and a start-session button) that folds the rows
 * under it; folded ids live in TasksScreen (`fleet.tasksBoxesCollapsed`).
 */
function WorkBlock({ item, ...row }: RowProps & { item: WorkItem }) {
  const { work: w, top } = item
  const { lit, hover, folded, fold } = use(RelationsContext)
  const open = !folded.has(w.id)
  const Icon = w.keyTask ? FlagIcon : ListTreeIcon
  return (
    <section aria-label={`${w.keyTask ? 'Milestone' : 'Parent task'} #${w.number ?? w.id} ${w.title}`}>
      <div
        data-task-id={top?.id ?? w.id}
        onMouseEnter={() => top && hover(top.id)}
        onMouseLeave={() => hover(null)}
        className={cn('group/row flex items-start gap-2 rounded-xl px-2 py-2 hover:bg-fill-hover', top && lit?.has(top.id) && 'bg-primary/8')}
      >
        <button
          type="button"
          aria-expanded={open}
          onClick={() => fold(w.id, open)}
          title={open ? 'Fold its subtasks' : 'Show its subtasks'}
          className="flex min-w-0 flex-1 items-start gap-2.5 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <span className={cn('grid size-7 shrink-0 place-items-center rounded-lg', w.keyTask ? 'bg-primary/12 text-primary' : 'bg-fill-strong text-muted-foreground')}>
            <Icon aria-hidden className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1">
              <span className="min-w-0 truncate text-sm font-semibold text-foreground">{w.title}</span>
              <ChevronRightIcon className={cn('size-3.5 shrink-0 text-dimmer transition-transform', open && 'rotate-90')} />
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-dimmer">
              <span className="shrink-0 font-mono">#{w.number ?? w.id}</span>
              <WorkProgress tasks={item.tasks} />
            </span>
          </span>
        </button>
        {top?.status ? <TaskStatusMenu task={top} quiet className="mt-0.5 text-xs" /> : null}
        <span className={ROW_ACTIONS}>
          {top ? (
            <Button variant="ghost" size="icon" aria-label={`Start a session on #${w.number ?? w.id}`} title="Start a session on this task" onClick={() => row.onStart(top)} className="size-7 rounded-full text-muted-foreground">
              <SquareTerminalIcon className="size-3.5" />
            </Button>
          ) : null}
          <OpenLink href={w.url} label={`Open #${w.number ?? w.id} in Productive`} />
        </span>
      </div>
      {open ? (
        <ul className="ml-5.5 border-l border-hairline pl-2">
          {item.tasks.map((t) => (
            <TaskRow key={t.id} task={t} {...row} topId={w.id} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

const DUE_TONE = { overdue: 'text-destructive', soon: 'text-status-waiting' } as const

/**
 * A quick start on a task: spawns at once (no form). Off while it starts, and when its start directory
 * is gone on the server (the tooltip says why).
 */
function QuickStartButton({ task: t, action: a, quick }: { task: Task; action: TaskQuickStart; quick: TaskQuickStartState }) {
  const busy = quick.isBusy(t.id, a.id)
  const off = !a.dir || !!a.error
  const where = a.dirLabel ?? a.dir ?? ''
  return (
    <button
      type="button"
      onClick={() => void quick.run(t, a)}
      disabled={busy || off}
      aria-label={`${a.label} #${t.number ?? t.id}`}
      title={off ? (a.error ?? 'Not available') : `${a.label}: start a session in ${where} now${a.worktree ? ' (new worktree)' : ''} — ${renderTaskPrompt(a.prompt, t)}`}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-medium text-muted-foreground lg:h-6 lg:px-2',
        'outline-none hover:bg-fill-strong hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
      )}
    >
      {busy ? <Loader2Icon className="size-3 animate-spin" /> : <ZapIcon className="size-3" />}
      {a.label}
    </button>
  )
}

/**
 * A task as one row: its number and status (→ the status menu: TaskStatusMenu), then its title (→ the New session
 * form). Grouped by status it shows its project; by project the group says that, so it does not. After the title:
 * its ties, PRs, the live sessions that link it (taskActivity, any status; each name → its session, with a TL;DR)
 * and its due date; the quick starts and the Productive link float over its right end under the pointer.
 */
function TaskRow({
  task: t,
  by,
  now,
  onStart,
  quick,
  topId,
}: {
  task: Task
  by: TasksGroupBy
  now: number
  onStart: (t: Task) => void
  quick: TaskQuickStartState
  /** Under a milestone: its id — subtasks under a listed parent indent beneath it. */
  topId?: string
}) {
  const { mine, lit, hover } = use(RelationsContext)
  const depth = nestDepth(t, topId, mine)
  const hide = new Set([topId ?? '', depth && t.parent ? t.parent.id : ''])
  const due = dueLabel(t.dueDate, now)
  const { links } = useTasks()
  const prs = links.prsByTask.get(t.id) ?? []
  const activity = taskActivity(t, links)
  const madrid = useMadrid()
  return (
    <li
      data-task-id={t.id}
      data-live={activity ? '' : undefined}
      onMouseEnter={() => hover(t.id)}
      onMouseLeave={() => hover(null)}
      style={{ paddingLeft: 4 + depth * 16 } as CSSProperties}
      className={cn('group/row relative flex min-h-10 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg py-1 pr-1 hover:bg-fill-hover lg:min-h-9', lit?.has(t.id) && 'bg-primary/8')}
    >
      <span className="w-12 shrink-0 font-mono text-xs text-dimmer">{t.number ? `#${t.number}` : null}</span>
      <span className="flex w-36 shrink-0 text-xs">{t.status ? <TaskStatusMenu task={t} quiet className="max-w-full" /> : null}</span>
      <button
        type="button"
        onClick={() => onStart(t)}
        title="Start a session on this task"
        className="flex min-w-0 flex-1 basis-48 items-center gap-2 rounded-md py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {madrid && activity?.state === 'working' ? (
          <span className="madrid-live inline-flex shrink-0 items-center gap-1 rounded px-1 text-3xs font-semibold tracking-wider" title="A session is working on it">
            <span className="madrid-live-dot size-1.5 rounded-full" />
            LIVE
          </span>
        ) : madrid && activity?.state === 'waiting' ? (
          <span className="madrid-ht inline-flex shrink-0 items-center rounded px-1 text-3xs font-semibold tracking-wider" title="Half-time talk: a session needs you">
            HT
          </span>
        ) : madrid ? (
          <MatchState category={t.statusCategory} />
        ) : null}
        {t.project && by === 'status' ? (
          <span className="inline-flex max-w-40 shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <ColorMark color={t.projectColor} shape="square" />
            <span className="min-w-0 truncate">{t.project}</span>
          </span>
        ) : null}
        <span className="min-w-0 truncate text-sm text-foreground">{t.title}</span>
      </button>
      <TaskRelations task={t} hide={hide} />
      {prs.map((p) => (
        <PrLinkChip key={p.url} pr={p} className="max-w-48" />
      ))}
      {activity?.sessions.map((s) => (
        <ActiveSession key={`${s.host}/${s.session_id}`} session={s} />
      ))}
      {due ? (
        <span className={cn('inline-flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground tabular-nums', due.tone && DUE_TONE[due.tone])} title={`Due ${t.dueDate}`}>
          <CalendarIcon className="size-3" />
          {madrid && t.dueDate ? fixtureLabel(due, t.dueDate, now) : due.label}
        </span>
      ) : null}
      <span className={cn(ROW_ACTIONS, ROW_ACTIONS_FLOAT)}>
        {quick.actions.map((a) => (
          <QuickStartButton key={a.id} task={t} action={a} quick={quick} />
        ))}
        <OpenLink href={t.url} label={`Open #${t.number ?? t.id} in Productive`} />
      </span>
    </li>
  )
}

/** A session's title (the optimistic one while a rename is pending). */
function SessionTitle({ session }: { session: Session }) {
  return <>{useSessionTitle(session).title}</>
}

/** `● lapwing working` / `● bracken idle`: a live session as a link to it, in its status colour — busy pulses (not with reduced motion). */
function ActiveSessionLink({ session: s, className }: { session: Session; className?: string }) {
  const key = statusMeta(s.status).key
  return (
    <Link
      href={sessionHref(s)}
      title={`Open the session — ${statusLabel(s)}`}
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-sm text-xs font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50',
        TASK_ACTIVITY_TEXT[key],
        className,
      )}
    >
      <StatusDot status={s.status} className={cn('size-2', key === 'busy' && 'motion-safe:animate-pulse')} />
      <Jersey playerKey={`${s.host}/${s.session_id}`} className="size-4" />
      <span className="min-w-0 truncate text-foreground">
        <SessionTitle session={s} />
      </span>
      <span className="shrink-0">{statusLabel(s)}</span>
    </Link>
  )
}

/** A session's TL;DR (the session brief recap popover), named after the session. */
function SessionTldr({ session }: { session: Session }) {
  return <TldrButton session={session} variant="inline" label={`TL;DR: ${useSessionTitle(session).title}`} />
}

/** A live session on a task: the link to it, then its TL;DR. */
function ActiveSession({ session: s }: { session: Session }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-0.5">
      <ActiveSessionLink session={s} />
      <SessionTldr session={s} />
    </span>
  )
}

/**
 * "In sessions": every task a live session links (lib/tasks.ts activeTasks — waiting, then working, then idle),
 * above the groups in both groupings and whatever the focus filters hide — each a compact card that opens its
 * first session; a task with several sessions lists the others as their own links. Nothing when none.
 */
function SessionTasks({ items, pane = false }: { items: { task: Task; activity: TaskActivity }[]; pane?: boolean }) {
  const madrid = useMadrid()
  return (
    <section aria-label="In sessions">
      <h2 className="mb-1 flex items-center gap-2 px-1 text-sm font-semibold">
        {madrid ? (
          <>
            <img src="/madrid-ball.svg" alt="" className="size-4" /> On the pitch
          </>
        ) : (
          'In sessions'
        )}{' '}
        <span className={cn('text-xs font-normal text-dimmer tabular-nums', madrid && 'madrid-count')}>{items.length}</span>
      </h2>
      <div className={cn('flex gap-2.5', pane ? 'no-scrollbar -mx-3 overflow-x-auto px-3 pt-1.5 pb-5' : 'flex-col')}>
        {items.map(({ task, activity }) => (
          <SessionTaskCard key={task.id} task={task} activity={activity} className={pane ? 'w-72 shrink-0' : undefined} />
        ))}
      </div>
    </section>
  )
}

function SessionTaskCard({ task: t, activity, className }: { task: Task; activity: TaskActivity; className?: string }) {
  const [first, ...more] = activity.sessions
  const key = statusMeta(first.status).key
  const tone = useStatusTone(t)
  return (
    <div
      data-status-variant={tone['data-status-variant']}
      style={tone.style}
      className={cn(TASK_CARD, useMadrid() && 'madrid-fixture', tone.className, className)}
    >
      <Link
        href={sessionHref(first)}
        title={`Open the session on #${t.number ?? t.id} — ${statusLabel(first)}`}
        className="block rounded-[calc(0.875rem-1px)] px-3 py-2.5 outline-none hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
      >
        <div className={cn('flex min-w-0 items-center gap-1.5 text-xs font-medium', TASK_ACTIVITY_TEXT[key])}>
          <StatusDot status={first.status} className={cn('size-2', key === 'busy' && 'motion-safe:animate-pulse')} />
          <Jersey playerKey={`${first.host}/${first.session_id}`} className="size-4" />
          <span className="min-w-0 truncate text-foreground">
            <SessionTitle session={first} />
          </span>
          <span className="shrink-0">{statusLabel(first)}</span>
          <SessionTldr session={first} />
        </div>
        <div className="mt-0.5 truncate font-medium text-foreground">{t.title}</div>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {t.number ? <span className="shrink-0 font-mono">#{t.number}</span> : null}
          {t.status ? (
            <span className="inline-flex shrink-0 items-center gap-1 text-foreground">
              <ColorMark color={t.statusColor} shape="dot" />
              {t.status}
            </span>
          ) : null}
          {t.project ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <ColorMark color={t.projectColor} shape="square" />
              <span className="min-w-0 truncate">{t.project}</span>
            </span>
          ) : null}
        </div>
      </Link>
      {more.length ? (
        <div className="flex flex-col gap-0.5 border-t px-2.5 py-1">
          {more.map((s) => (
            <ActiveSession key={`${s.host}/${s.session_id}`} session={s} />
          ))}
        </div>
      ) : null}
    </div>
  )
}
