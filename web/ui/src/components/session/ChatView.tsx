import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRightIcon, ChevronsUpIcon, ClipboardIcon, ClockIcon, HandIcon, Loader2Icon, MessageSquareDashedIcon, SendHorizontalIcon, SquareSlashIcon, TerminalIcon } from 'lucide-react'

import type { Message } from '@/api/types'
import { LatestButton } from '@/components/session/LatestButton'
import { QuestionCard, type QuestionActions } from '@/components/session/QuestionCard'
import { Linkified, Markdown } from '@/components/Markdown'
import { Button } from '@/components/ui/button'
import { FileLinksContext, type FileStats } from '@/hooks/useFileLinks'
import { useFollowScroll } from '@/hooks/useFollowScroll'
import { useNow } from '@/hooks/useNow'
import { clockTime } from '@/lib/format'
import { SpeakButton } from '@/components/SpeakButton'
import { msgKind, queuedPrompts, sameGroup, sendNowLabel, splitPasted, visibleMessages } from '@/lib/chat'
import { pendingQuestion } from '@/lib/questions'
import { pathCandidates } from '@/lib/paths'
import { CHAT_FONT_REM } from '@/lib/prefs'
import { BUBBLE_MINE, BUBBLE_MINE_PENDING, BUBBLE_THEIRS } from '@/lib/styles'
import { cn } from '@/lib/utils'

export interface ChatViewProps {
  /** null = not loaded yet. */
  messages: Message[] | null
  /** No transcript on disk (404 from /messages). */
  noTranscript: boolean
  /** The session no longer exists. */
  gone?: boolean
  hideNotes: boolean
  status: string
  waitingFor?: string | null
  /** Older messages exist and a bigger limit is available. */
  canLoadOlder: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  /** Bumped by the parent to jump to the bottom (after a send). */
  jumpSignal: number
  /** Desktop pane: a wider (still readable) column. */
  wide?: boolean
  /** Link file paths in Claude's messages that exist on the session's host (click → preview). */
  fileLinks?: FileStats
  /** The outbox's optimistic bubbles, after the transcript; `outboxKey` changes when they do (keeps the tail followed). */
  outbox?: React.ReactNode
  outboxKey?: string
  /** Answer / dismiss Claude's pending question from its card; absent = the card is read-only. */
  questionActions?: QuestionActions | null
  /** The live terminal shows below the chat (what Claude waits on is there, not in the transcript). */
  terminalShown?: boolean
  /** Hand Claude Code's queued prompts to Claude now; absent = no "Send now" on queued bubbles. */
  onSendNow?: (() => Promise<void>) | null
}

/** Longer pastes start collapsed. */
const PASTE_OPEN_LINES = 6

/** A user prompt: typed text, with `<pasted_content>` blocks shown as collapsible quotes. */
function UserText({ text }: { text: string }) {
  const parts = splitPasted(text)
  if (parts.length === 1 && !parts[0].pasted) return <Linkified text={text} />
  return (
    <div className="flex flex-col gap-1.5">
      {parts.map((part, i) => {
        if (!part.pasted)
          return (
            <div key={i}>
              <Linkified text={part.text} />
            </div>
          )
        const lines = part.text.split('\n').length
        return (
          <details key={i} open={lines <= PASTE_OPEN_LINES} className="group rounded-lg border border-primary/20 bg-background/40 text-[0.9em]">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 text-[0.8em] text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon className="size-3 transition-transform group-open:rotate-90" />
              <ClipboardIcon className="size-3" />
              Pasted · {lines} {lines === 1 ? 'line' : 'lines'}
            </summary>
            <div className="max-h-80 overflow-y-auto border-t border-primary/15 px-2 py-1.5">
              <Linkified text={part.text} />
            </div>
          </details>
        )
      })}
    </div>
  )
}

/** A slash command, skill or `!` shell command, as a chip. */
function CommandChip({ name, shell }: { name: string; shell: boolean }) {
  const Icon = shell ? TerminalIcon : SquareSlashIcon
  return (
    <span className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 font-mono text-2xs text-status-waiting/90">
      <Icon className="size-3" />
      {shell ? 'shell' : name}
    </span>
  )
}

const sendNowClass =
  'relative inline-flex h-7 items-center gap-1 rounded-full px-2 font-medium text-foreground/80 hover:bg-muted hover:text-foreground disabled:opacity-60 after:absolute after:inset-x-0 after:-inset-y-2 [&_svg]:size-3.5'
/** After a send-now the bubble stays queued until the next poll; the button waits this long before it can be pressed again. */
const SEND_NOW_SETTLE_MS = 8000

/** "Send now" on the last queued prompt: Claude Code's send-now, which hands over the whole queue. */
function SendNowButton({ count, run }: { count: number; run: () => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle')
  useEffect(() => {
    if (state !== 'sent') return
    const t = setTimeout(() => setState('idle'), SEND_NOW_SETTLE_MS)
    return () => clearTimeout(t)
  }, [state])
  const click = async () => {
    setState('busy')
    try {
      await run()
      setState('sent')
    } catch {
      setState('idle')
    }
  }
  return (
    <button
      type="button"
      className={sendNowClass}
      disabled={state !== 'idle'}
      onClick={() => void click()}
      title="Claude takes it now: a running command moves to the background, an answer being written stops"
    >
      {state === 'idle' ? <SendHorizontalIcon aria-hidden /> : <Loader2Icon className="animate-spin motion-reduce:animate-none" aria-hidden />}
      {state === 'idle' ? sendNowLabel(count) : 'Sending…'}
    </button>
  )
}

// A message's time (and read-aloud): out of the flow, in the gap under the message's group, so it never takes a row of
// its own; shown on hover with a fine pointer, always (small) on touch.
const CAPTION =
  'absolute top-full mt-0.5 flex items-center gap-1 text-3xs leading-4 whitespace-nowrap text-dimmer tabular-nums transition-opacity pointer-fine:opacity-0 pointer-fine:group-hover/msg:opacity-100 pointer-fine:focus-within:opacity-100'

const Bubble = memo(function Bubble({
  m,
  caption,
  actions,
  sendNow,
  queuedCount = 0,
}: {
  m: Message
  caption: string
  actions?: QuestionActions | null
  /** Only on the last queued prompt. */
  sendNow?: (() => Promise<void>) | null
  queuedCount?: number
}) {
  const kind = msgKind(m)
  const text = typeof m.text === 'string' ? m.text : ''
  if (kind === 'question' && Array.isArray(m.questions)) {
    return (
      <div className="group/msg relative">
        <QuestionCard m={m} actions={actions} />
        {caption ? <div className={cn(CAPTION, 'left-1')}>{caption}</div> : null}
      </div>
    )
  }
  if (kind === 'command' && m.name && m.args?.trim()) {
    // A command with arguments is a prompt in disguise: a user bubble headed by the command.
    const shell = m.name === '!'
    return (
      <div className="group/msg relative flex w-full flex-col items-end">
        <div className={cn(BUBBLE_MINE, 'flex flex-col gap-1 whitespace-pre-wrap')}>
          <div>
            <CommandChip name={m.name} shell={shell} />
          </div>
          <div className={shell ? 'font-mono text-[0.9em]' : undefined}>{shell ? m.args.trim() : <UserText text={m.args.trim()} />}</div>
        </div>
        {caption ? <div className={cn(CAPTION, 'right-1')}>{caption}</div> : null}
      </div>
    )
  }
  if (kind === 'command') {
    return (
      <div className="self-center text-center">
        <span className="inline-block rounded-full bg-fill px-3 py-1 font-mono text-2xs text-status-waiting/90 [overflow-wrap:anywhere]">
          {text}
        </span>
      </div>
    )
  }
  if (kind === 'system') {
    return <div className="max-w-[92%] self-center text-center text-2xs text-dimmer [overflow-wrap:anywhere]">{text}</div>
  }
  const cap = caption ? <div className={cn(CAPTION, 'right-1')}>{caption}</div> : null
  if (kind === 'user') {
    // Queued: typed while Claude works; Claude Code hands it over between steps or at the turn's end.
    const queued = m.queued === true
    return (
      <div className="group/msg relative flex w-full animate-enter flex-col items-end" data-queued={queued || undefined}>
        <div
          className={cn(queued ? BUBBLE_MINE_PENDING : BUBBLE_MINE, 'whitespace-pre-wrap')}
        >
          <UserText text={text} />
        </div>
        {queued ? (
          <div className="flex flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5 px-1 pt-0.5 text-2xs text-dimmer">
            <span className="flex items-center gap-1">
              <ClockIcon className="size-3" aria-hidden />
              Queued · Claude reads it when it finishes the current step
            </span>
            {sendNow ? <SendNowButton count={queuedCount} run={sendNow} /> : null}
          </div>
        ) : (
          cap
        )}
      </div>
    )
  }
  // Agent text: the caption row carries a read-aloud button.
  const speakId = `${m.ts ?? ''}:${text.length}:${text.slice(0, 24)}`
  const agentCap = (
    <div className={cn(CAPTION, 'left-1')}>
      {caption ? <span>{caption}</span> : null}
      <SpeakButton text={text} id={speakId} className="-my-1" />
    </div>
  )
  if (m.final === false) {
    return (
      <div className="group/msg relative flex w-full animate-enter flex-col items-start">
        <Markdown text={text} className="space-y-1.5 border-l-2 border-fill-strong pl-3 text-[0.86em] leading-normal text-muted-foreground" />
        {agentCap}
      </div>
    )
  }
  return (
    <div className="group/msg relative flex w-full animate-enter flex-col items-start">
      <div className={BUBBLE_THEIRS}>
        <Markdown text={text} className="space-y-2" />
      </div>
      {agentCap}
    </div>
  )
})

// Rhythm: one speaker's burst stays grouped, each message its own bubble 12px apart; Claude's messages each carry a
// caption row (read-aloud, always shown on touch) in the gap, so theirs are 20px apart to fit it (18px); a speaker change
// opens 28px, room for the previous group's caption and clearly more than inside a burst.
function gapClass(prev: Message, m: Message): string {
  if (!sameGroup(prev, m)) return 'mt-7'
  return msgKind(prev) === 'assistant' ? 'mt-5' : 'mt-3'
}

function Typing({ status, waitingFor, asking, below }: { status: string; waitingFor?: string | null; asking: boolean; below: boolean }) {
  if (status === 'busy') {
    return (
      <div className="flex items-center gap-2 px-1 pt-5 text-xs text-dimmer" aria-live="polite">
        <span className="inline-flex gap-[3px]" aria-hidden>
          {[0, 0.18, 0.36].map((d) => (
            <i key={d} className="size-[5px] animate-dot rounded-full bg-status-busy motion-reduce:animate-none" style={{ animationDelay: `${d}s` }} />
          ))}
        </span>
        Claude is working…
      </div>
    )
  }
  if (status === 'waiting') {
    return (
      <div className="flex items-center gap-2 px-1 pt-5 text-xs font-medium text-status-waiting" aria-live="polite">
        <HandIcon className="size-3.5" />
        {asking
          ? 'Needs you · answer the question above'
          : `Needs you${waitingFor?.trim() ? ` · ${waitingFor.trim()}` : ' — Claude is waiting for an answer'}${below ? ' — the terminal is below' : ''}`}
      </div>
    )
  }
  return null
}

/** Conversation view: bubbles, markdown, "Load older", follow-scroll with "↓ latest". */
export function ChatView(p: ChatViewProps) {
  const { ref, following, setFollow, setTop, stick, jump, onScroll } = useFollowScroll<HTMLDivElement>(60)
  const list = visibleMessages(p.messages, p.hideNotes)
  // Only the prompt Claude waits on right now takes answers.
  const asking = p.status === 'waiting' ? pendingQuestion(p.messages) : null
  const queued = queuedPrompts(list)
  const now = useNow(60_000) // captions: "today" vs a date

  // Remember the scroll geometry of the last commit, so "Load older" (which prepends)
  // can keep the same message under the thumb.
  const lastHeight = useRef(0)
  const anchorPending = useRef(false)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (p.loadingOlder) anchorPending.current = true
    else if (anchorPending.current) {
      anchorPending.current = false
      setFollow(false)
      setTop(el.scrollTop + (el.scrollHeight - lastHeight.current))
    } else stick()
    lastHeight.current = el.scrollHeight
  }, [p.messages, p.hideNotes, p.status, p.loadingOlder, p.outboxKey, ref, setFollow, setTop, stick])

  useEffect(() => {
    if (p.jumpSignal) jump()
  }, [p.jumpSignal, jump])

  // Ask the host which of the paths Claude mentioned exist (batched, cached per session).
  const requestStats = p.fileLinks?.request
  useEffect(() => {
    if (!requestStats || !p.messages) return
    const candidates: string[] = []
    for (const m of p.messages) if (msgKind(m) === 'assistant' && typeof m.text === 'string') candidates.push(...pathCandidates(m.text))
    if (candidates.length) requestStats(candidates)
  }, [p.messages, requestStats])

  let body
  if (p.messages === null) {
    body = p.gone ? (
      <Empty icon={<MessageSquareDashedIcon className="size-6" />} text="This session has ended" />
    ) : p.noTranscript ? (
      <Empty icon={<MessageSquareDashedIcon className="size-6" />} text="No transcript for this session yet" />
    ) : (
      <Empty icon={<Loader2Icon className="size-5 animate-spin" />} text="Loading conversation…" />
    )
  } else if (list.length === 0) {
    body = (
      <Empty
        icon={<MessageSquareDashedIcon className="size-6" />}
        text={p.messages.length ? 'Only progress notes here — show them from the ⋯ menu' : 'No messages yet'}
      />
    )
  } else {
    body = (
      <div className="flex flex-col">
        {list.map((m, i) => (
          <div key={i} className={i === 0 ? undefined : gapClass(list[i - 1], m)}>
          <Bubble
            m={m}
            caption={sameGroup(m, list[i + 1]) ? '' : clockTime(m.ts, now)}
            actions={m === asking ? p.questionActions : null}
            sendNow={m === queued.last ? p.onSendNow : null}
            queuedCount={m === queued.last ? queued.count : 0}
          />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={ref}
        onScroll={onScroll}
        tabIndex={0}
        aria-label="Conversation"
        className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-contain px-safe outline-none [overflow-anchor:none]"
        style={{ fontSize: CHAT_FONT_REM, lineHeight: 1.5 }}
      >
        <div className={p.wide ? 'mx-auto w-full max-w-4xl px-6 pt-3 pb-6' : 'mx-auto w-full max-w-3xl px-4 pt-3 pb-6'}>
          {p.canLoadOlder || p.loadingOlder ? (
            <div className="flex justify-center pb-3">
              <Button variant="secondary" size="sm" className="h-8 rounded-full px-3.5" disabled={p.loadingOlder} onClick={p.onLoadOlder}>
                {p.loadingOlder ? <Loader2Icon className="animate-spin" /> : <ChevronsUpIcon />}
                {p.loadingOlder ? 'Loading…' : 'Load older'}
              </Button>
            </div>
          ) : null}
          {p.fileLinks ? <FileLinksContext.Provider value={p.fileLinks.api}>{body}</FileLinksContext.Provider> : body}
          {p.outbox}
          {p.messages ? <Typing status={p.status} waitingFor={p.waitingFor} asking={!!asking && !!p.questionActions} below={!!p.terminalShown} /> : null}
        </div>
      </div>
      <LatestButton show={!following} onClick={jump} />
    </div>
  )
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className={cn('flex flex-col items-center gap-2 px-4 py-14 text-center text-sm text-dimmer')}>
      {icon}
      {text}
    </div>
  )
}
