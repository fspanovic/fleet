import { useState, type SyntheticEvent } from 'react'
import { ArrowRightIcon, CircleAlertIcon, Loader2Icon, RefreshCwIcon, ScrollTextIcon, SquareCheckBigIcon } from 'lucide-react'
import { useLocation } from 'wouter'

import type { Session } from '@/api/types'
import { Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { requestDetails } from '@/hooks/useDetailsRequest'
import { useNow } from '@/hooks/useNow'
import { useTldr } from '@/hooks/useTldr'
import { briefTime, briefTodos, todoProgress } from '@/lib/brief'
import { sessionHref } from '@/lib/sessions'
import { recap, recapAt, recapStale, todosLabel, updatedLabel } from '@/lib/tldr'
import { cn } from '@/lib/utils'

/** Rows and cards are links: nothing in the button or the (portalled, but React-bubbling) popover may reach them. */
const stop = (e: SyntheticEvent) => e.stopPropagation()

export interface TldrButtonProps {
  session: Pick<Session, 'host' | 'session_id' | 'updated_at'>
  /**
   * `row` / `card`: a small icon shown on hover / focus (always on touch); `header`: the session header's icon
   * button; `inline`: the same small icon, always shown (beside a session's name on a My tasks card).
   */
  variant: 'row' | 'card' | 'header' | 'inline'
  /** The button's accessible name (default `TL;DR`), e.g. naming the session where several sit side by side. */
  label?: string
  className?: string
}

/**
 * TL;DR: a short recap of what is going on in a session — its brief's Summary (first sentences,
 * "More in Details"), todo progress, "updated 4 min ago", Open details, and Refresh (the manual
 * brief regenerate) when there is no brief or it is older than the session's latest activity.
 * The brief is fetched only while the popover is open (useTldr; cached briefly per session).
 */
export function TldrButton({ session, variant, label = 'TL;DR', className }: TldrButtonProps) {
  const [open, setOpen] = useState(false)
  const header = variant === 'header'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          title={label}
          onPointerDown={stop}
          onPointerUp={stop}
          onContextMenu={stop}
          onClick={(e) => {
            // The row / card link must not navigate; Radix's own toggle is skipped (defaultPrevented), so toggle here.
            e.preventDefault()
            e.stopPropagation()
            setOpen((o) => !o)
          }}
          className={cn(
            header
              ? 'size-11 shrink-0 rounded-full text-muted-foreground lg:size-9'
              : cn(
                  '-my-1 size-6 shrink-0 rounded-md text-dimmer hover:text-foreground pointer-coarse:size-8',
                  variant !== 'inline' &&
                    'pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:focus-visible:opacity-100 pointer-fine:data-[state=open]:opacity-100',
                ),
            className,
          )}
        >
          <ScrollTextIcon className={header ? 'size-5 lg:size-[1.125rem]' : 'size-3.5'} />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="TL;DR"
        align="end"
        collisionPadding={12}
        className="w-80 max-w-[calc(100vw-2rem)] gap-2 p-3"
        onClick={stop}
        onPointerDown={stop}
        onPointerUp={stop}
        onContextMenu={stop}
        onDoubleClick={stop}
        onDragStart={stop}
      >
        <TldrPanel session={session} onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

/** The popover's body: mounted only while open, so the fetch, the clock and any poll run only then. */
function TldrPanel({ session, onDone }: { session: TldrButtonProps['session']; onDone: () => void }) {
  const { host, session_id: id } = session
  const [location, navigate] = useLocation()
  const now = useNow(15_000)
  const t = useTldr(host, id)
  const b = t.brief
  const summary = b?.parsed.summary?.trim() ?? ''
  const { text, more } = recap(summary)
  const todos = todosLabel(todoProgress(briefTodos(b?.parsed)))
  const busy = t.generating || t.requesting
  const stale = !!b && recapStale(b, session.updated_at)
  // The Summary's own time: the brief's `updated` also moves on model-free resource extraction.
  const at = recapAt(b) ?? (summary ? briefTime(b?.updated) : null)
  const updated = busy ? 'writing a new recap…' : b ? (updatedLabel(at, now) ?? 'not written yet') : t.error ? null : 'loading…'

  const openDetails = () => {
    onDone()
    const href = sessionHref(session)
    if (location !== href) navigate(href)
    requestDetails(host, id)
  }

  let body
  if (!b) {
    body = t.error ? null : (
      <div className="space-y-2 py-0.5" aria-hidden>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    )
  } else if (text) {
    body = (
      <div className={cn('space-y-1', busy && 'opacity-60')}>
        <Markdown text={text} className="text-sm leading-relaxed [overflow-wrap:anywhere]" />
        {more ? (
          <button type="button" onClick={openDetails} className="text-xs text-primary underline-offset-2 outline-none hover:underline focus-visible:underline">
            More in Details
          </button>
        ) : null}
      </div>
    )
  } else {
    body = (
      <p className="text-sm text-muted-foreground">
        {busy ? 'Writing a recap…' : `No recap yet.${b.enabled ? '' : ' Automatic briefs are off on this host.'} Refresh writes one now.`}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-2" aria-busy={busy || undefined}>
      <div className="flex items-baseline gap-2">
        <h3 className="text-2xs font-semibold tracking-wider text-dimmer uppercase">TL;DR</h3>
        {updated ? <span className="min-w-0 flex-1 truncate text-right text-xs text-dimmer tabular-nums">{updated}</span> : null}
      </div>
      {body}
      {todos || (stale && text) ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {todos ? (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <SquareCheckBigIcon className="size-3.5 text-dimmer" />
              {todos}
            </span>
          ) : null}
          {stale && text && !busy ? <span className="text-dimmer">The session has moved on since.</span> : null}
        </div>
      ) : null}
      {t.error ? (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <CircleAlertIcon className="mt-px size-3.5 shrink-0" />
          <span className="break-words">{t.error}</span>
        </p>
      ) : t.note ? (
        <p className="text-xs text-dimmer">{t.note}</p>
      ) : null}
      <div className="flex items-center justify-end gap-1.5 pt-0.5">
        {stale || busy || (!b && t.error) ? (
          <Button variant="outline" size="sm" className="h-8 px-2.5" disabled={busy} onClick={() => void t.refresh()}>
            {busy ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            {busy ? 'Refreshing…' : 'Refresh'}
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" className="h-8 px-2.5" onClick={openDetails}>
          Open details
          <ArrowRightIcon />
        </Button>
      </div>
    </div>
  )
}
