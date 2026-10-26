import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronLeftIcon, SunriseIcon, XIcon } from 'lucide-react'
import { Link, useLocation } from 'wouter'

import type { PullRequest, Session } from '@/api/types'
import { CornerLink } from '@/components/CornerLink'
import { PrCard } from '@/components/PrCard'
import { PrLinkChip, PrSessionLink } from '@/components/PrChip'
import { PrDialog } from '@/components/PrDialog'
import { ScreenHeader } from '@/components/ScreenHeader'
import { SessionRow } from '@/components/SessionRow'
import { TaskBadge } from '@/components/TaskChip'
import { Button } from '@/components/ui/button'
import { useFleet } from '@/hooks/useFleet'
import { useNow } from '@/hooks/useNow'
import { usePrs } from '@/hooks/usePrs'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { useTasks, useWatchTasks } from '@/hooks/useTasks'
import { prRef } from '@/lib/prs'
import { sessionHref, statusLabel, statusMeta } from '@/lib/sessions'
import { STATUS_TEXT, TASK_ACTIVITY_CARD, TASK_CARD, TASK_CARD_INNER_TOP } from '@/lib/styles'
import { needsYou, prsNeedingAction, reviewRequests, tasksInProgress, type TaskInProgress } from '@/lib/today'
import { cn } from '@/lib/utils'

/**
 * `#/today`: what needs you, top to bottom — sessions waiting on you (→ the session), your tasks with live
 * sessions and their PRs (lib/tasks.ts activeTasks), PRs where your review is requested, and your PRs that
 * need you to act (changes requested, failing checks, unseen mentions). A PR opens its dialog right here.
 * Empty sections shrink to one quiet line. `pane` = the desktop layout (the whole window, like My tasks);
 * `screen` = mobile (swipe back).
 */
export function TodayScreen({ layout = 'screen' }: { layout?: 'screen' | 'pane' }) {
  const pane = layout === 'pane'
  const [, navigate] = useLocation()
  const now = useNow(30_000)
  const { fleet } = useFleet()
  useWatchTasks()
  const tasks = useTasks()
  const prs = usePrs()
  const user = prs.data?.user ?? ''

  const waiting = useMemo(() => needsYou(fleet), [fleet])
  const active = useMemo(() => tasksInProgress(tasks.data?.tasks, tasks.links), [tasks.data?.tasks, tasks.links])
  const reviews = useMemo(() => reviewRequests(prs.data?.prs, user), [prs.data?.prs, user])
  const mine = useMemo(() => prsNeedingAction(prs.data?.prs, user), [prs.data?.prs, user])

  const [openPr, setOpenPr] = useState<PullRequest | null>(null)
  // The dialog follows the polled PR (checked out, CI moved on) while it stays in the list.
  const current = openPr ? (prs.data?.prs.find((p) => p.url === openPr.url) ?? openPr) : null

  const back = () => {
    if (!pane && window.history.length > 1) window.history.back()
    else navigate('/', { replace: !pane })
  }
  const screenRef = useRef<HTMLDivElement>(null)
  useSwipeBack(screenRef, back, !pane && !openPr)

  const prsNote = !prs.data ? (prs.error ?? (prs.loading ? 'Loading pull requests…' : 'No pull requests yet.')) : null
  const prCards = (list: PullRequest[]) =>
    list.map((p) => <PrCard key={p.url} pr={p} now={now} onOpen={setOpenPr} sessions={prs.links.byPr.get(p.url)} />)

  const content = (
    <div className={cn('mx-auto w-full space-y-5 pt-3', pane ? 'max-w-none px-6 pb-6' : 'max-w-3xl px-gutter pb-[max(1.5rem,env(safe-area-inset-bottom))]')}>
      <TodaySection title="Needs you" count={waiting.length} empty="Nothing is waiting on you.">
        {waiting.map((s) => (
          <SessionRow key={`${s.host}/${s.session_id}`} session={s} now={now} />
        ))}
      </TodaySection>
      <TodaySection
        title="In progress"
        count={active.length}
        empty={tasks.notConfigured ? 'My tasks is not set up on this server.' : (tasks.error ?? 'None of your tasks has a live session.')}
      >
        {active.map((t) => (
          <TaskInProgressCard key={t.task.id} item={t} />
        ))}
      </TodaySection>
      <TodaySection title="Your reviews" count={reviews.length} empty={prsNote ?? 'No review requests.'}>
        {prCards(reviews)}
      </TodaySection>
      <TodaySection title="Your PRs" count={mine.length} empty={prsNote ?? 'None of your PRs needs you.'}>
        {prCards(mine.map((m) => m.pr))}
      </TodaySection>
    </div>
  )

  const dialog = current ? (
    <PrDialog
      key={prRef(current)}
      pr={current}
      host={prs.host}
      sessions={prs.links.byPr.get(current.url) ?? []}
      onClose={() => setOpenPr(null)}
      onChanged={prs.reload}
    />
  ) : null

  if (pane) {
    return (
      <section aria-label="Today" className="flex h-full min-w-0 flex-1 flex-col bg-background">
        <header
          data-tauri-drag-region="deep"
          className="titlebar titlebar-lead flex shrink-0 items-center gap-2 py-2 pr-3 pl-5 [--titlebar-pad:1.25rem]"
        >
          <h1 className="flex shrink-0 items-center gap-2 text-lg font-bold tracking-(--tracking-display)">
            <SunriseIcon className="size-4 text-muted-foreground" /> Today
          </h1>
          <Button variant="ghost" size="icon" aria-label="Close" title="Close (Esc)" onClick={() => navigate('/')} className="ml-auto size-9 shrink-0 rounded-full text-muted-foreground">
            <XIcon className="size-5" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
        {dialog}
      </section>
    )
  }

  return (
    <div ref={screenRef} className="flex min-h-app flex-col bg-background">
      <ScreenHeader>
        <div className="-ml-2 flex min-h-8 items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Back" onClick={back} className="-my-1.5 size-11 shrink-0 rounded-full">
            <ChevronLeftIcon className="size-6" />
          </Button>
          <h1 className="flex-1 text-2xl font-bold tracking-(--tracking-display)">Today</h1>
        </div>
      </ScreenHeader>
      {content}
      {dialog}
    </div>
  )
}

/** A section: its title and count over its items; with none, one quiet line instead. */
function TodaySection({ title, count, empty, children }: { title: string; count: number; empty: string; children: ReactNode }) {
  if (!count) {
    return (
      <section aria-label={title} className="flex items-baseline gap-2 px-1 text-sm">
        <h2 className="font-semibold text-muted-foreground">{title}</h2>
        <p className="min-w-0 truncate text-xs text-dimmer">{empty}</p>
      </section>
    )
  }
  return (
    <section aria-label={title}>
      <h2 className="mb-1.5 flex items-baseline gap-2 px-1 text-sm font-semibold">
        {title} <span className="text-xs font-normal text-dimmer tabular-nums">{count}</span>
      </h2>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

/** One live session of a task: status dot + title (→ the session) and what it is doing. */
function TaskSession({ session: s }: { session: Session }) {
  const key = statusMeta(s.status).key
  return (
    <span className="flex min-w-0 items-center gap-1">
      <PrSessionLink session={s} className="text-foreground" />
      <span className={cn('shrink-0 truncate text-xs', STATUS_TEXT[key])}>{statusLabel(s)}</span>
    </span>
  )
}

/** A task with live sessions: the task (→ its first session; ↗ Productive), every session, and its PRs. */
function TaskInProgressCard({ item: { task: t, activity, prs } }: { item: TaskInProgress }) {
  const first = activity.sessions[0]
  return (
    <div className={cn('relative', TASK_CARD, TASK_ACTIVITY_CARD)}>
      <Link
        href={sessionHref(first)}
        title={`Open the session on #${t.number ?? t.id} — ${statusLabel(first)}`}
        className={cn('block px-3 pt-2 pb-1.5 outline-none hover:bg-fill-hover focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset', TASK_CARD_INNER_TOP)}
      >
        <div className="mb-0.5 flex min-w-0 items-center gap-1.5 pr-9 text-xs text-muted-foreground lg:pr-7">
          <TaskBadge task={t} />
          {t.status ? <span className="shrink-0">{t.status}</span> : null}
          {t.project ? <span className="min-w-0 truncate">· {t.project}</span> : null}
        </div>
        <div className="line-clamp-2 font-medium text-foreground">{t.title}</div>
      </Link>
      <CornerLink href={t.url} label={`Open #${t.number ?? t.id} in Productive`} title="Open in Productive" />
      <div className="flex flex-col gap-0.5 border-t px-2 py-1.5">
        {activity.sessions.map((s) => (
          <TaskSession key={`${s.host}/${s.session_id}`} session={s} />
        ))}
        {prs.length ? (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {prs.map((p) => (
              <PrLinkChip key={p.url} pr={p} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
