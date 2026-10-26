import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ChevronLeftIcon,
  CircleAlertIcon,
  EllipsisIcon,
  MessageSquareTextIcon,
  PanelRightIcon,
  SquareTerminalIcon,
  WifiOffIcon,
  XIcon,
} from 'lucide-react'
import { useLocation } from 'wouter'
import { toast } from 'sonner'

import { ApiError, api, isAbortError, isSessionGone, sendErrorMessage, sessionErrorMessage } from '@/api/client'
import type { FileStat, Message, SessionKey } from '@/api/types'
import { ContextMeter } from '@/components/ContextMeter'
import { DropOverlay } from '@/components/DropOverlay'
import { EditableTitle } from '@/components/EditableTitle'
import { HostBadge } from '@/components/HostBadge'
import { ModelChip } from '@/components/ModelChip'
import { PrChip } from '@/components/PrChip'
import { TaskChip } from '@/components/TaskChip'
import { NewSessionDialog, NewSessionDrawer, type SpawnPrefill } from '@/components/NewSessionDrawer'
import { SessionStyleChip } from '@/components/SessionStyleChip'
import { StatusDot } from '@/components/StatusDot'
import { StackBar } from '@/components/stack/StackBar'
import { ChatView } from '@/components/session/ChatView'
import { Composer, type ComposerApi } from '@/components/session/Composer'
import { FilePreview } from '@/components/session/FilePreview'
import { OutboxBubbles } from '@/components/session/OutboxBubbles'
import type { QuestionActions } from '@/components/session/QuestionCard'
import { DetailsDrawer, DetailsPanel, type DetailsPanelProps } from '@/components/session/DetailsPanel'
import { TermView } from '@/components/session/TermView'
import { TerminalDialog } from '@/components/session/TerminalDialog'
import { ScratchpadButton } from '@/components/Scratchpad'
import { TldrButton } from '@/components/TldrButton'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useFileDrop } from '@/hooks/useAttach'
import { useBrief } from '@/hooks/useBrief'
import { useDetailsRequest } from '@/hooks/useDetailsRequest'
import { useFileStats } from '@/hooks/useFileLinks'
import { useFleet } from '@/hooks/useFleet'
import { useNow } from '@/hooks/useNow'
import { useOutbox } from '@/hooks/useOutbox'
import { usePersistentState } from '@/hooks/usePersistentState'
import { usePermissionToggle } from '@/hooks/usePermissionToggle'
import { usePoller } from '@/hooks/usePoller'
import { usePrefs } from '@/hooks/usePrefs'
import { useSettings } from '@/hooks/useSettings'
import { openSiblingSpawn, openStackSheet } from '@/hooks/useStackUi'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { useSessionTitle } from '@/hooks/useTitles'
import { CHAT_LIMITS, CHAT_POLL_MS, PEEK_POLL_MS, TERM_LINES, nextChatLimit, parseMode, parseSize, type DetailMode } from '@/lib/chat'
import { continueDraft } from '@/lib/brief'
import { relTime, shortCwd } from '@/lib/format'
import { harnessLabel } from '@/lib/harness'
import { tailAnchor } from '@/lib/outbox'
import { findSession, statusMeta, withoutSession } from '@/lib/sessions'
import { stacksKnown } from '@/lib/stacks'
import { isUndoBackspace, withHint } from '@/lib/shortcuts'
import { sessionCardTone } from '@/lib/cardTone'
import { HEAD_CHIP, HEAD_META_TEXT, HEAD_SURFACE, STATUS_TEXT } from '@/lib/styles'
import { isDialogHeld, isDialogOpen, needsTerminal } from '@/lib/terminalKeys'
import { cn } from '@/lib/utils'

interface ChatState {
  messages: Message[]
  truncated: boolean
  status: string
  name: string | null
  at: number
  /** JSON of the payload, to skip re-renders when a poll brings nothing new. */
  key: string
}
interface PeekState {
  text: string
  at: number
}

/** What the desktop shell's shortcuts can ask of the open pane. */
export interface PaneApi {
  setMode: (m: DetailMode) => void
  /** Chat ⇄ Terminal (⌘J). */
  toggleMode: () => void
  focusComposer: () => void
}

export interface SessionScreenProps {
  host: string
  id: string
  /** `screen` (mobile, default): fixed full-screen page. `pane`: the desktop detail pane. */
  layout?: 'screen' | 'pane'
  /** Pane only: show the details column (brief + session details; the header button toggles it). */
  inspector?: boolean
  onToggleInspector?: () => void
  /** Pane only: filled with the pane's API while mounted. */
  paneRef?: React.RefObject<PaneApi | null>
  /** Pane only: focus the composer on mount (opened with Enter). */
  autoFocusComposer?: boolean
  /** Pane only: a close button in the header (the Board view's flyout). */
  onClose?: () => void
  /** Pane only: the pane is too narrow for a details column — lay it over the chat instead. */
  detailsOverlay?: boolean
}

/**
 * Session detail — `#/s/:host/:id`: Chat (transcript, polls `messages` every 3s) or Term
 * (pane capture, polls `peek` every 2s) — exactly one loop runs, the other is disabled.
 * Shared composer with quick replies + key chips; ⋯ opens the session menu (drawer).
 */
export function SessionScreen({
  host,
  id,
  layout = 'screen',
  inspector = false,
  onToggleInspector,
  paneRef,
  autoFocusComposer = false,
  onClose,
  detailsOverlay = false,
}: SessionScreenProps) {
  const pane = layout === 'pane'
  const { fleet, refresh: refreshFleet, applyFleet } = useFleet()
  const settings = useSettings()
  const [, navigate] = useLocation()
  const now = useNow(1000)
  const session = findSession(fleet, host, id)
  const hostEntry = fleet?.hosts.find((h) => h.name === host) ?? null

  // View prefs (localStorage). Text size, terminal text and
  // progress notes are global (the Settings screen).
  const [mode, setMode] = usePersistentState<DetailMode>('fleet.detailMode', 'chat', parseMode)
  const [termLines, setTermLines] = usePersistentState<number>('fleet.termLines', 200, parseSize(TERM_LINES))
  const { termFont, hideNotes, sendDelay } = usePrefs()

  const [menuOpen, setMenuOpen] = useState(false)
  const [jumpSignal, setJumpSignal] = useState(0)
  // Paths in Claude's messages that exist on the host → links → this preview.
  const sessionKey = `${host}/${id}`
  const [previewOf, setPreviewOf] = useState<{ key: string; file: FileStat } | null>(null)
  const preview = previewOf?.key === sessionKey ? previewOf.file : null
  const openPreview = useCallback((file: FileStat) => setPreviewOf({ key: sessionKey, file }), [sessionKey])
  const fileLinks = useFileStats(host, id, openPreview)

  // Brief: the top of the Details panel — the desktop column (open state owned by the shell)
  // or the mobile drawer (⋯). Polled only while it shows.
  const brief = useBrief(host, id, pane ? inspector : menuOpen)
  // "Open details" from a TL;DR popover (row, card or this header): the column, or the mobile drawer.
  useDetailsRequest(host, id, () => {
    if (!pane) setMenuOpen(true)
    else if (!inspector) onToggleInspector?.()
  })
  // "Continue in new session" → the New session form, prefilled (host, this cwd, the brief's prompt).
  const [continueWith, setContinueWith] = useState<SpawnPrefill | null>(null)

  const composerRef = useRef<HTMLTextAreaElement>(null)
  const modeRef = useRef(mode)
  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  useEffect(() => {
    if (!paneRef) return
    paneRef.current = {
      setMode,
      toggleMode: () => setMode(modeRef.current === 'chat' ? 'term' : 'chat'),
      focusComposer: () => composerRef.current?.focus(),
    }
    return () => {
      paneRef.current = null
    }
  }, [paneRef, setMode])
  useEffect(() => {
    if (autoFocusComposer) composerRef.current?.focus()
  }, [autoFocusComposer])

  // --- chat loop -----------------------------------------------------------
  const [chat, setChat] = useState<ChatState | null>(null)
  const [chatErr, setChatErr] = useState<ApiError | Error | null>(null)
  const [chatLimit, setChatLimit] = useState<number>(CHAT_LIMITS[0])
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [msgBackend, setMsgBackend] = useState<string | null>(null)

  // --- term loop -----------------------------------------------------------
  const [peek, setPeek] = useState<PeekState | null>(null)
  const [peekErr, setPeekErr] = useState<ApiError | Error | null>(null)
  const [peekBackend, setPeekBackend] = useState<string | null>(null)

  const [gone, setGone] = useState(false)
  const [held, setHeld] = useState<string | null>(null)
  const holdMessage = (text: string) => setHeld((cur) => (cur ? `${cur}\n\n${text}` : text))

  const pollChat = useCallback(
    async (signal: AbortSignal) => {
      try {
        const data = await api.messages(host, id, chatLimit, { signal })
        const messages = Array.isArray(data.messages) ? data.messages : []
        const truncated = data.truncated === true
        const status = String(data.status || 'unknown')
        const name = typeof data.name === 'string' && data.name ? data.name : null
        const key = JSON.stringify([messages, truncated, status, name])
        const at = data.capturedAt || Date.now()
        setChat((prev) => (prev?.key === key ? { ...prev, at } : { messages, truncated, status, name, at, key }))
        if (data.backend) setMsgBackend(String(data.backend))
        setChatErr(null)
        setGone(false)
      } catch (err) {
        if (isAbortError(err)) throw err
        // 404 is usually "no transcript on disk yet"; "unknown session" means it is gone.
        setChatErr(err as Error)
        if (isSessionGone(err)) setGone(true)
      } finally {
        if (!signal.aborted) setLoadingOlder(false)
      }
    },
    [host, id, chatLimit],
  )

  const pollPeek = useCallback(
    async (signal: AbortSignal) => {
      try {
        const data = await api.peek(host, id, termLines, { signal })
        const text = typeof data.text === 'string' ? data.text : ''
        const at = data.capturedAt || Date.now()
        setPeek((prev) => (prev && prev.text === text ? { ...prev, at } : { text, at }))
        setPeekBackend(String(data.backend || 'unknown'))
        setPeekErr(null)
        setGone(false)
      } catch (err) {
        if (isAbortError(err)) throw err
        setPeekErr(err as Error)
        if (err instanceof ApiError && err.status === 404) setGone(true)
        if (err instanceof ApiError && err.status === 409) setPeekBackend('unknown')
      }
    },
    [host, id, termLines],
  )

  const refreshChat = usePoller(pollChat, CHAT_POLL_MS, { enabled: mode === 'chat' })
  const refreshPeek = usePoller(pollPeek, PEEK_POLL_MS, { enabled: mode === 'term' })
  const refreshActive = mode === 'chat' ? refreshChat : refreshPeek

  // Limit / lines changes re-poll now (the poller always calls the latest fn).
  const firstLimit = useRef(true)
  useEffect(() => {
    if (firstLimit.current) {
      firstLimit.current = false
      return
    }
    refreshChat()
  }, [chatLimit, refreshChat])
  const firstLines = useRef(true)
  useEffect(() => {
    if (firstLines.current) {
      firstLines.current = false
      return
    }
    setPeek(null)
    refreshPeek()
  }, [termLines, refreshPeek])

  // Follow-up polls after steering, so the answer shows up quickly.
  const followUps = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    const timers = followUps.current
    return () => {
      for (const t of timers) clearTimeout(t)
      timers.clear()
    }
  }, [])
  const refreshActiveRef = useRef(refreshActive)
  useEffect(() => {
    refreshActiveRef.current = refreshActive
  }, [refreshActive])
  const scheduleFollowUps = () => {
    for (const delay of [800, 2000]) {
      const t = setTimeout(() => {
        followUps.current.delete(t)
        refreshActiveRef.current()
      }, delay)
      followUps.current.add(t)
    }
  }

  // --- derived -------------------------------------------------------------
  const backend = (() => {
    if (peekBackend === 'unknown' || (peekErr instanceof ApiError && peekErr.status === 409)) return 'unknown'
    return peekBackend || msgBackend || (session?.backend ? String(session.backend) : null)
  })()
  const status = gone ? 'unknown' : mode === 'chat' && chat ? chat.status : String(session?.status || 'unknown')
  const meta = statusMeta(status)
  const updatedAt = mode === 'chat' ? chat?.at : peek?.at
  const lockedReason = gone
    ? 'Session is gone — nothing to steer.'
    : backend === 'unknown'
      ? "Backend is unknown — this session can't be steered."
      : null
  // Claude's permission mode: the shield beside the composer's paperclip (Chat view only, pane read every 5 s).
  const permission = usePermissionToggle({ session, host, id, enabled: mode === 'chat' && !lockedReason, desktop: pane })
  // Waiting on something the transcript can't show (one of Claude's dialogs, a permission
  // prompt): the screen shows the live terminal and its keys. A message typed while one of
  // Claude's own dialogs is open would go into it — it is held (`held`) instead.
  // A primitive copy: handing `session` fields to a helper as-is makes the React Compiler give up on this screen.
  const waitingFor = session?.waiting_for ? String(session.waiting_for) : null
  const dialogOpen = !gone && isDialogOpen(status, waitingFor)
  const showTerminal = !gone && !lockedReason && (needsTerminal(status, chat?.messages) || (pane && mode === 'term'))

  // Files dropped anywhere on the session go through the composer (upload → path at the caret).
  const attachRef = useRef<(files: File[]) => void>(null)
  const drop = useFileDrop((files) => attachRef.current?.(files), lockedReason == null)

  const activeErr = mode === 'chat' ? chatErr : peekErr
  const noTranscript = mode === 'chat' && chatErr instanceof ApiError && chatErr.status === 404 && !isSessionGone(chatErr)
  const errText = !activeErr || gone ? null : noTranscript ? (chat ? 'No transcript for this session yet' : null) : sessionErrorMessage(activeErr)
  const hostDown = hostEntry?.ok === false
  const missing = !!fleet && !hostDown && !session

  // --- actions -------------------------------------------------------------
  const afterSteer = () => {
    setJumpSignal((n) => n + 1)
    scheduleFollowUps()
  }
  const steerError = (err: unknown) => {
    if (isAbortError(err)) return
    if (err instanceof ApiError && err.status === 404) setGone(true)
    toast.error(sendErrorMessage(err))
  }

  // Messages go through the outbox (lib/outbox.ts): an undo window (Settings → Send delay), then
  // one POST at a time; the composer never waits. Keys stay immediate.
  const composerApi = useRef<ComposerApi>(null)
  const chatRef = useRef(chat)
  useEffect(() => {
    chatRef.current = chat
  }, [chat])
  const { box, items: outbox } = useOutbox({
    host,
    id,
    onSent: () => {
      // The terminal view has no bubble to turn into "Sent".
      if (modeRef.current !== 'chat') toast.success('Sent', { duration: 1500 })
      afterSteer()
    },
    onError: (err, _item, mounted) => {
      if (isAbortError(err)) return
      if (mounted && err instanceof ApiError && err.status === 404) setGone(true)
      // The server held it: a dialog opened before it went out. Keep it with the held message.
      if (mounted && isDialogHeld(err)) {
        const text = box.discard(_item.id)
        if (text != null) holdMessage(text)
        return
      }
      // In the chat the bubble says it (Retry / Edit); elsewhere only a toast can.
      if (!mounted || modeRef.current !== 'chat') toast.error(`Not sent: ${sendErrorMessage(err)}`)
    },
  })
  // The real message arrived → drop its optimistic bubble.
  useEffect(() => {
    if (chat) box.reconcile(chat.messages)
  }, [chat, box])
  const hasPending = outbox.some((it) => it.state === 'pending')

  const send = (text: string): boolean => {
    if (lockedReason || !text.trim()) return false
    if (dialogOpen) {
      holdMessage(text)
      return true
    }
    box.add(text, sendDelay, tailAnchor(chatRef.current?.messages))
    setJumpSignal((n) => n + 1)
    return true
  }
  // Held while a dialog is open: send it anyway (force), send it once the dialog is gone, or
  // take it back into the composer.
  const sendHeld = async (force: boolean) => {
    const text = held
    if (!text) return
    setHeld(null)
    if (!force) {
      box.add(text, 0, tailAnchor(chatRef.current?.messages))
      setJumpSignal((n) => n + 1)
      return
    }
    try {
      await api.send(host, id, text, { force: true })
      afterSteer()
    } catch (err) {
      setHeld(text)
      steerError(err)
    }
  }
  const editHeld = () => {
    if (held) composerApi.current?.restore(held)
    setHeld(null)
  }
  const undo = () => {
    const it = box.cancel()
    if (it) composerApi.current?.restore(it.text)
  }
  const editFailed = (itemId: number) => {
    const text = box.discard(itemId)
    if (text != null) composerApi.current?.restore(text)
  }
  const retryFailed = (itemId: number) => box.retry(itemId, tailAnchor(chatRef.current?.messages))

  // Backspace cancels the pending message (not while it edits text: in a non-empty field it
  // deletes as usual) — capture phase, only while one counts down, not over a dialog.
  const undoRef = useRef(undo)
  useEffect(() => {
    undoRef.current = undo
  })
  useEffect(() => {
    if (!hasPending) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isUndoBackspace(e, e.target) || e.defaultPrevented) return
      if (document.querySelector('[role="dialog"][data-state="open"], [data-vaul-drawer][data-state="open"]')) return
      e.preventDefault()
      e.stopPropagation()
      undoRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [hasPending])

  const sendKey = async (key: SessionKey) => {
    if (lockedReason) return
    try {
      await api.keys(host, id, key)
      toast.success(`${key} sent`, { duration: 1200 })
      afterSteer()
    } catch (err) {
      steerError(err)
    }
  }

  // Claude Code's queued prompts, handed to Claude now (its send-now); the next poll shows them as
  // ordinary prompts. A 409 = nothing queued any more (Claude took it) or a dialog is open.
  const sendNow = async () => {
    try {
      const r = await api.sendNow(host, id)
      toast.success(r.queued > 1 ? `${r.queued} queued messages sent now` : 'Sent now', { duration: 1500 })
      afterSteer()
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast(sendErrorMessage(err))
        afterSteer()
      } else steerError(err)
      throw err
    }
  }

  const questionActions: QuestionActions | null = lockedReason
    ? null
    : {
        answer: async (toolUseId, answers) => {
          try {
            await api.answer(host, id, toolUseId, answers)
            afterSteer()
          } catch (err) {
            steerError(err)
            throw err
          }
        },
        dismiss: async () => {
          try {
            await api.keys(host, id, 'Escape')
            afterSteer()
            composerRef.current?.focus()
          } catch (err) {
            steerError(err)
            throw err
          }
        },
      }

  const outboxView = (variant: 'chat' | 'strip') => (
    <OutboxBubbles items={outbox} desktop={pane} onUndo={undo} onRetry={retryFailed} onEdit={editFailed} variant={variant} />
  )

  const back = () => {
    if (window.history.length > 1) window.history.back()
    else navigate('/', { replace: true })
  }
  // Mobile: swipe right anywhere on the screen = Back (the installed PWA has no native back swipe).
  const screenRef = useRef<HTMLDivElement>(null)
  useSwipeBack(screenRef, back, !pane && !menuOpen && !continueWith)

  const loadOlder = () => {
    const next = nextChatLimit(chatLimit)
    if (!next) return
    setLoadingOlder(true)
    setChatLimit(next)
  }

  const titleKey = `${host}/${id}`
  const { title: shownTitle } = useSessionTitle(session, titleKey)
  const name = session ? shownTitle : chat?.name || id.slice(0, 8)

  const continueInNew = (prompt: string) => {
    const prefill: SpawnPrefill = { host, dir: session?.cwd ?? null, prompt: continueDraft(prompt) }
    if (pane) return setContinueWith(prefill)
    // One drawer at a time: Details closes, then the New session form opens.
    setMenuOpen(false)
    setTimeout(() => setContinueWith(prefill), 300)
  }

  // Session stacks: open the sheet / the sibling form (mobile: the Details drawer closes first).
  const fromMenu = (fn: () => void) => {
    if (pane) return fn()
    setMenuOpen(false)
    setTimeout(fn, 300)
  }
  const stackRef = session?.stack ?? null
  const stackMenu: DetailsPanelProps['stack'] = !session || !stacksKnown(session)
    ? null
    : stackRef
      ? { label: stackRef.label, onOpen: () => fromMenu(() => openStackSheet(stackRef.host || host, stackRef.id)) }
      : {
          label: null,
          onSpawnSibling: () =>
            fromMenu(() => openSiblingSpawn({ host, sessionId: id, cwd: session.cwd ?? null, label: shownTitle, creates: true })),
        }

  const menuProps: DetailsPanelProps = {
    open: menuOpen,
    onOpenChange: setMenuOpen,
    host,
    id,
    session,
    isSelfHost: settings.self != null && settings.self === host,
    mode,
    onMode: setMode,
    termLines,
    onTermLines: setTermLines,
    brief: { host, brief, fileLinks, onContinue: continueInNew },
    editor: { url: brief.brief?.editorUrl ?? session?.editorUrl, kind: brief.brief?.editor },
    onClose: pane ? onToggleInspector : undefined,
    stack: stackMenu,
    onClosed: () => {
      // Drop it from the list now; the next polls confirm (discovery caches ~2s).
      if (fleet) applyFleet(withoutSession(fleet, host, id))
      setTimeout(refreshFleet, 2500)
      navigate('/', { replace: true })
    },
  }

  const NewSession = pane ? NewSessionDialog : NewSessionDrawer
  const continueForm = (
    <NewSession
      open={continueWith != null}
      onOpenChange={(o) => !o && setContinueWith(null)}
      onOpenSession={(href) => navigate(href)}
      prefill={continueWith}
    />
  )

  // The card's tone (lib/cardTone.ts): the status as the bottom line, the wash — status, or a `web.sessionStyles`
  // match's (the chip carries the label) — over the page background.
  const tone = sessionCardTone(session ? { status, style: session.style } : null)
  const column = (
    <>
      <header
        data-tauri-drag-region={pane ? 'deep' : undefined}
        data-wash={tone.dataWash}
        style={tone.style}
        className={cn('z-20 shrink-0 pt-safe px-safe backdrop-blur-xl backdrop-saturate-150', HEAD_SURFACE, tone.head)}
      >
        <div
          className={
            pane
              ? 'titlebar titlebar-lead flex w-full items-center gap-1.5 py-2 pr-3 pl-5 [--titlebar-pad:1.25rem]'
              : 'mx-auto flex w-full max-w-3xl items-center gap-1 py-1.5 pr-2 pl-1'
          }
        >
          {pane ? null : (
            <Button variant="ghost" size="icon" aria-label="Back" onClick={back} className="size-11 shrink-0 rounded-full">
              <ChevronLeftIcon className="size-6" />
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <div className={cn('flex min-w-0 leading-tight font-semibold tracking-(--tracking-heading)', pane ? 'text-lg' : 'text-md')}>
              {session ? <EditableTitle session={session} scope="header" tapToEdit className={cn('font-semibold', pane ? 'text-lg' : 'text-md')} /> : <span className="truncate">{name}</span>}
            </div>
            <div className={cn('mt-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs whitespace-nowrap', HEAD_META_TEXT, !pane && 'flex-wrap gap-y-0.5')}>
              <StatusDot status={status} className="size-2" />
              <span className={cn('shrink-0 font-medium transition-colors duration-(--dur-slow)', STATUS_TEXT[meta.key])}>{gone ? 'gone' : meta.label}</span>
              <HostBadge host={host} className={HEAD_CHIP} />
              {session ? <SessionStyleChip session={session} /> : null}
              {session?.session_id ? <PrChip session={{ host, session_id: session.session_id }} /> : null}
              {session?.session_id ? <TaskChip session={{ host, session_id: session.session_id }} /> : null}
              <ModelChip model={session?.context?.model} className={HEAD_CHIP} picker={{ host, id, harness: session?.harness, window: session?.context?.window, lockedReason }} />
              <ContextMeter context={session?.context} variant="full" />
              {pane && session?.cwd ? (
                <span className="min-w-0 shrink-[100] truncate font-mono text-2xs text-dimmer" title={session.cwd}>
                  · {shortCwd(session.cwd, 60)}
                </span>
              ) : null}
              <span className={cn('truncate text-dimmer tabular-nums', pane ? 'shrink-0' : 'min-w-0 flex-[1_0_0]')}>
                {updatedAt ? `· ${relTime(updatedAt, now)} ago` : '· connecting…'}
              </span>
            </div>
          </div>
          {/* Mobile switches view from the ⋯ menu; the header keeps its width for the title. */}
          {pane ? (
            <ToggleGroup
              type="single"
              value={mode}
              onValueChange={(v) => v && setMode(v as DetailMode)}
              spacing={0.5}
              aria-label="View mode"
              className="shrink-0 rounded-full bg-fill p-0.5"
            >
              <ToggleGroupItem value="chat" aria-label="Chat view" title={pane ? withHint('Chat', 'mode') : undefined} className={modeItem}>
                <MessageSquareTextIcon />
              </ToggleGroupItem>
              <ToggleGroupItem value="term" aria-label="Terminal view" title={pane ? withHint('Terminal', 'mode') : undefined} className={modeItem}>
                <SquareTerminalIcon />
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
          <TldrButton session={{ host, session_id: id, updated_at: session?.updated_at }} variant="header" />
          {pane ? (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Details panel"
              title={withHint('Details', 'inspector')}
              aria-pressed={inspector}
              onClick={onToggleInspector}
              className={cn('size-9 shrink-0 rounded-full text-muted-foreground', inspector && 'bg-fill-strong text-foreground')}
            >
              <PanelRightIcon className="size-[1.125rem]" />
            </Button>
          ) : (
            <>
            <ScratchpadButton className="size-11 shrink-0 rounded-full text-muted-foreground [&_svg:not([class*='size-'])]:size-5" />
            <Button
              variant="ghost"
              size="icon"
              aria-label="More"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
              className="size-11 shrink-0 rounded-full"
            >
              <EllipsisIcon className="size-5" />
            </Button>
            </>
          )}
          {pane && onClose ? (
            <Button variant="ghost" size="icon" aria-label="Close session" title="Close (Esc)" onClick={onClose} className="size-9 shrink-0 rounded-full text-muted-foreground">
              <XIcon className="size-[1.125rem]" />
            </Button>
          ) : null}
        </div>
      </header>

      {session?.stack ? <StackBar session={session} pane={pane} /> : null}

      {hostDown || missing ? (
        <div className="shrink-0 px-3 px-safe">
          <div
            className={cn(
              pane
                ? 'mx-auto mt-2 flex max-w-4xl items-start gap-2 rounded-lg border px-3 py-2 text-xs'
                : 'mx-auto mt-2 flex max-w-3xl items-start gap-2 rounded-lg border px-3 py-2 text-xs',
              hostDown ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-border bg-card text-muted-foreground',
            )}
          >
            {hostDown ? <WifiOffIcon className="mt-px size-3.5 shrink-0" /> : <CircleAlertIcon className="mt-px size-3.5 shrink-0" />}
            <span className="break-words">
              {hostDown
                ? `${host} unreachable: ${hostEntry?.error || 'no response'}`
                : gone
                  ? 'This session has ended.'
                  : 'Not in the fleet list right now — it may have ended.'}
            </span>
          </div>
        </div>
      ) : null}

      <main className="relative flex min-h-0 flex-1 flex-col">
        {mode === 'chat' ? (
          <ChatView
            messages={chat?.messages ?? null}
            noTranscript={noTranscript}
            gone={gone}
            hideNotes={hideNotes}
            status={status}
            waitingFor={session?.waiting_for}
            canLoadOlder={!!chat?.truncated && chatLimit < CHAT_LIMITS[CHAT_LIMITS.length - 1]}
            loadingOlder={loadingOlder}
            onLoadOlder={loadOlder}
            jumpSignal={jumpSignal}
            wide={pane}
            fileLinks={fileLinks}
            outbox={outboxView('chat')}
            outboxKey={outbox.map((it) => `${it.id}:${it.state}`).join(',')}
            questionActions={questionActions}
            terminalShown={showTerminal}
            onSendNow={lockedReason ? null : sendNow}
          />
        ) : (
          <TermView text={peek?.text ?? null} failed={!!peekErr} fontSize={termFont} jumpSignal={jumpSignal} />
        )}
        {pane && inspector && detailsOverlay ? (
          // A narrow pane: the details lie over the chat (header and composer stay usable).
          <aside
            aria-label="Session details"
            className="absolute inset-y-0 right-0 z-30 w-80 max-w-[90%] animate-in border-l border-hairline bg-background shadow-2xl duration-(--dur-slow) ease-out fade-in-0 slide-in-from-right-6 xl:w-96"
          >
            <DetailsPanel {...menuProps} open variant="panel" />
          </aside>
        ) : null}
        {errText ? (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center px-3">
            <div className="flex max-w-full animate-in items-center gap-2 rounded-full border border-destructive/40 bg-popover/95 px-3 py-1.5 text-xs text-destructive shadow-overlay backdrop-blur-sm duration-(--dur-slow) ease-out fade-in-0 slide-in-from-top-1">
              <CircleAlertIcon className="size-3.5 shrink-0" />
              <span className="truncate">{errText}</span>
            </div>
          </div>
        ) : null}
      </main>

      {showTerminal ? (
        <TerminalDialog
          host={host}
          id={id}
          screen={mode === 'chat'}
          waitingFor={waitingFor}
          waiting={status === 'waiting'}
          locked={lockedReason != null}
          desktop={pane}
          fontSize={termFont}
          onSteered={() => {
            refreshFleet()
            scheduleFollowUps()
            refreshActiveRef.current()
          }}
        />
      ) : null}
      {held ? (
        <div className={cn('shrink-0 px-safe', pane ? 'mx-auto w-full max-w-4xl px-4 pt-2' : 'mx-auto w-full max-w-3xl px-3 pt-2')}>
          <div role="status" className="flex min-w-0 animate-enter flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-status-waiting/10 px-3.5 py-2.5 text-xs ring-1 ring-status-waiting/25">
            <CircleAlertIcon className="size-3.5 shrink-0 text-status-waiting" />
            <span className="min-w-0 flex-1 basis-48">
              {dialogOpen ? 'Not sent: Claude has a dialog open, and the message would be typed into it. Close it (Esc), or send anyway.' : 'Not sent yet: it was held while a dialog was open.'}
              <span className="block truncate text-dimmer" title={held}>
                “{held}”
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <Button size="sm" variant={dialogOpen ? 'outline' : 'default'} className="h-7 rounded-full px-3 text-xs" onClick={() => void sendHeld(dialogOpen)}>
                {dialogOpen ? 'Send anyway' : 'Send'}
              </Button>
              <Button size="sm" variant="ghost" className="h-7 rounded-full px-3 text-xs" onClick={editHeld}>
                Edit
              </Button>
            </span>
          </div>
        </div>
      ) : null}
      {mode === 'term' && outbox.some((it) => it.state !== 'sent') ? (
        <div className={cn('shrink-0 px-safe', pane ? 'mx-auto w-full max-w-4xl px-4 pt-2' : 'mx-auto w-full max-w-3xl px-3 pt-2')}>
          {outboxView('strip')}
        </div>
      ) : null}
      <Composer
        quickReplies={settings.quickReplies}
        lockedReason={lockedReason}
        onSend={send}
        onKey={sendKey}
        desktop={pane}
        inputRef={composerRef}
        host={host}
        attachRef={attachRef}
        draftKey={sessionKey}
        apiRef={composerApi}
        agent={harnessLabel(session?.harness)}
        voiceHint={[name, session?.cwd?.split('/').pop()].filter(Boolean).join(', ')}
        sessionId={id}
        slashCommands={(session?.harness || 'claude') === 'claude'}
        permission={permission}
      />
      <DropOverlay show={drop.dragging} hint={`Uploaded to ${host}; the path goes into the message`} />
      <FilePreview host={host} id={id} file={preview} onClose={() => setPreviewOf(null)} desktop={pane} />
    </>
  )

  if (pane) {
    return (
      <div className="flex h-full min-w-0 flex-1 animate-fade overflow-hidden bg-background">
        <section aria-label={`Session ${name}`} className="relative flex min-w-0 flex-1 flex-col" {...drop.bind}>
          {column}
        </section>
        {inspector && !detailsOverlay ? (
          <aside aria-label="Session details" className="w-80 shrink-0 border-l border-hairline bg-frame/60 xl:w-96">
            <DetailsPanel {...menuProps} open variant="panel" />
          </aside>
        ) : null}
        {continueForm}
      </div>
    )
  }

  return (
    <div ref={screenRef} className="fixed-app flex flex-col overflow-hidden bg-background" {...drop.bind}>
      {column}
      <DetailsDrawer {...menuProps} />
      {continueForm}
    </div>
  )
}

const modeItem =
  'size-8 rounded-full text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-seg data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_0_var(--shadow-tint-2),0_0_0_0.5px_var(--edge-strong)] [&_svg:not([class*=size-])]:size-4'
