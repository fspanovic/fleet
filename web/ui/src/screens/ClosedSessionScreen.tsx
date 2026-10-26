import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeftIcon, CircleAlertIcon, HistoryIcon, Loader2Icon, MessageSquareDashedIcon, MoonIcon, PlayIcon, XIcon } from 'lucide-react'
import { useLocation } from 'wouter'
import { toast } from 'sonner'

import { ApiError, api, isAbortError } from '@/api/client'
import type { PastMessagesResponse } from '@/api/types'
import { HostBadge } from '@/components/HostBadge'
import { ChatView } from '@/components/session/ChatView'
import { Button } from '@/components/ui/button'
import { useDormant } from '@/hooks/useDormant'
import { useFleet } from '@/hooks/useFleet'
import { useNow } from '@/hooks/useNow'
import { usePoller } from '@/hooks/usePoller'
import { usePrefs } from '@/hooks/usePrefs'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { CHAT_LIMITS, nextChatLimit } from '@/lib/chat'
import { findPastEntry, pastErrorText, pastMarker, pastRecord, pastTitle, pastWhen } from '@/lib/dormant'
import { shortCwd } from '@/lib/format'
import { harnessLabel } from '@/lib/harness'
import { findSession, sessionHref } from '@/lib/sessions'
import { cn } from '@/lib/utils'

/** A stopped session's transcript changes rarely (a lingering one, a resume elsewhere): look again now and then. */
const PAST_POLL_MS = 30_000
/** After Resume: how long to wait for the session to register before giving up on following it. */
const RESUME_FOLLOW_MS = 60_000

export interface ClosedSessionScreenProps {
  host: string
  id: string
  /** `screen` (mobile, default): fixed full-screen page. `pane`: the desktop detail pane. */
  layout?: 'screen' | 'pane'
  /** Pane only: a close button in the header (the Board view's flyout). */
  onClose?: () => void
}

/**
 * `#/closed/:host/:id` — the conversation of a recently closed or dormant session, read only:
 * GET …/dormant/sessions/:id/messages rendered by the live chat's ChatView, without a composer,
 * key chips, terminal or any action that types into a session. The header says what it is
 * ("Closed — read only"), where and when it stopped, and offers Resume; once the resumed session
 * registers, the live session screen replaces this one.
 */
export function ClosedSessionScreen({ host, id, layout = 'screen', onClose }: ClosedSessionScreenProps) {
  const pane = layout === 'pane'
  const [, navigate] = useLocation()
  const now = useNow(30_000)
  const { fleet, refresh: refreshFleet } = useFleet()
  const dormant = useDormant()
  const { hideNotes } = usePrefs()

  const [data, setData] = useState<PastMessagesResponse | null>(null)
  const [err, setErr] = useState<ApiError | Error | null>(null)
  const [limit, setLimit] = useState<number>(CHAT_LIMITS[0])
  const [loadingOlder, setLoadingOlder] = useState(false)

  const poll = useCallback(
    async (signal: AbortSignal) => {
      try {
        const d = await api.dormantMessages(host, id, limit, { signal })
        setData(d)
        setErr(null)
      } catch (e) {
        if (isAbortError(e)) throw e
        setErr(e as Error)
      } finally {
        if (!signal.aborted) setLoadingOlder(false)
      }
    },
    [host, id, limit],
  )
  const refresh = usePoller(poll, PAST_POLL_MS)
  // Load older = a bigger limit, polled at once (the poller always calls the latest fn).
  const firstLimit = useRef(true)
  useEffect(() => {
    if (firstLimit.current) {
      firstLimit.current = false
      return
    }
    refresh()
  }, [limit, refresh])
  const loadOlder = () => {
    const next = nextChatLimit(limit)
    if (!next) return
    setLoadingOlder(true)
    setLimit(next)
  }

  // What it is: the server's record, else the sidebar's entry (before the first answer, or after a 404).
  const record = pastRecord(data?.record, findPastEntry(dormant.hosts, host, id))
  const title = pastTitle(record, id)
  const when = pastWhen(record, now)
  const live = findSession(fleet, host, id)

  // --- Resume: the CLI brings it back; follow it to the live session screen once it registers.
  const [following, setFollowing] = useState(false)
  const target = record?.target ?? null
  const busyKey = record && target ? `${host}/${record.pool === 'closed' ? 'closed/' : ''}${target}` : null
  const resuming = (busyKey != null && dormant.busy.has(busyKey)) || following
  const resume = async () => {
    if (!record || !target || resuming) return
    const ok = record.pool === 'closed' ? await dormant.resumeClosed(host, target) : await dormant.resume(host, target)
    if (!ok) return
    setFollowing(true)
    refreshFleet()
  }
  useEffect(() => {
    if (following && live) navigate(sessionHref(live), { replace: true })
  }, [following, live, navigate])
  useEffect(() => {
    if (!following) return
    const t = setTimeout(() => {
      setFollowing(false)
      toast(`“${title}” hasn't shown up yet`, { description: 'It will appear in the session list once it registers.' })
    }, RESUME_FOLLOW_MS)
    return () => clearTimeout(t)
  }, [following, title])

  const back = () => {
    if (window.history.length > 1) window.history.back()
    else navigate('/', { replace: true })
  }
  // Mobile: swipe right anywhere = Back, like the session screen.
  const screenRef = useRef<HTMLDivElement>(null)
  useSwipeBack(screenRef, back, !pane)

  const errText = pastErrorText(err)
  const Icon = record?.pool === 'dormant' ? MoonIcon : HistoryIcon
  const harness = record?.harness && record.harness !== 'claude' ? harnessLabel(record.harness) : null

  const column = (
    <>
      <header
        data-tauri-drag-region={pane ? 'deep' : undefined}
        className="z-20 shrink-0 border-b bg-background/90 pt-safe px-safe backdrop-blur-md backdrop-saturate-150"
      >
        <div
          className={
            pane
              ? 'titlebar titlebar-lead flex w-full items-center gap-1 py-2.5 pr-3 pl-6 [--titlebar-pad:1.5rem]'
              : 'mx-auto flex w-full max-w-3xl items-center gap-1 py-1.5 pr-2 pl-1'
          }
        >
          {pane ? null : (
            <Button variant="ghost" size="icon" aria-label="Back" onClick={back} className="size-11 shrink-0 rounded-full">
              <ChevronLeftIcon className="size-6" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-md leading-tight font-semibold" title={title}>
              {title}
            </h1>
            <div className={cn('mt-0.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap', !pane && 'flex-wrap gap-y-0.5')}>
              <span
                data-past-marker
                className="inline-flex shrink-0 items-center gap-1 rounded-[5px] border border-dashed border-border px-1 text-2xs font-medium text-muted-foreground"
              >
                <Icon className="size-3" aria-hidden />
                {pastMarker(record)}
              </span>
              <HostBadge host={host} className="h-4 px-1 text-3xs" />
              {harness ? <span className="shrink-0 text-dimmer">{harness}</span> : null}
              {record?.cwd ? (
                <span className="min-w-0 shrink-[100] truncate font-mono text-2xs text-dimmer" title={record.cwd}>
                  · {shortCwd(record.cwd, 60)}
                </span>
              ) : null}
              {when ? <span className="shrink-[10] truncate text-dimmer tabular-nums">· {when}</span> : null}
            </div>
          </div>
          {live && !following ? (
            <Button type="button" size={pane ? 'sm' : 'lg'} onClick={() => navigate(sessionHref(live), { replace: true })} title="It is running again: open the live session">
              Open live
            </Button>
          ) : target ? (
            <Button
              type="button"
              variant="outline"
              size={pane ? 'sm' : 'lg'}
              disabled={resuming}
              onClick={() => void resume()}
              title={record?.pool === 'dormant' ? 'Recreate its tmux session and resume it' : 'Resume it (a new tmux session, or a new window of the one it ran in)'}
              className="shrink-0"
            >
              {resuming ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
              {following ? 'Starting…' : 'Resume'}
            </Button>
          ) : null}
          {pane && onClose ? (
            <Button variant="ghost" size="icon" aria-label="Close preview" title="Close (Esc)" onClick={onClose} className="size-11 shrink-0 rounded-full">
              <XIcon className="size-5" />
            </Button>
          ) : null}
        </div>
      </header>

      <main className="relative flex min-h-0 flex-1 flex-col">
        {data ? (
          <ChatView
            messages={data.messages ?? []}
            noTranscript={false}
            hideNotes={hideNotes}
            status="idle"
            canLoadOlder={data.truncated === true && limit < CHAT_LIMITS[CHAT_LIMITS.length - 1]}
            loadingOlder={loadingOlder}
            onLoadOlder={loadOlder}
            jumpSignal={0}
            wide={pane}
            questionActions={null}
            onSendNow={null}
          />
        ) : errText ? (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center text-sm text-dimmer">
            <MessageSquareDashedIcon className="size-6" />
            {errText}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-14 text-center text-sm text-dimmer">
            <Loader2Icon className="size-5 animate-spin" />
            Loading conversation…
          </div>
        )}
        {data && errText ? (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center px-3">
            <div className="flex max-w-full items-center gap-2 rounded-full border border-destructive/40 bg-popover/95 px-3 py-1.5 text-xs text-destructive shadow-overlay backdrop-blur-sm">
              <CircleAlertIcon className="size-3.5 shrink-0" />
              <span className="truncate">{errText}</span>
            </div>
          </div>
        ) : null}
      </main>
    </>
  )

  if (pane) {
    return (
      <section aria-label={`${pastMarker(record)}: ${title}`} className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden bg-background">
        {column}
      </section>
    )
  }
  return (
    <div ref={screenRef} className="fixed-app flex flex-col overflow-hidden bg-background">
      {column}
    </div>
  )
}
