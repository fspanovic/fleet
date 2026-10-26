import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { KeyboardIcon, Loader2Icon, SquareTerminalIcon } from 'lucide-react'
import { toast } from 'sonner'

import { api, isAbortError, sessionErrorMessage } from '@/api/client'
import { Linkified } from '@/components/Markdown'
import { usePoller } from '@/hooks/usePoller'
import { termFontRem } from '@/lib/prefs'
import { DIALOG_OPEN, TERMINAL_KEYS, inputFromKey, pushInput, type TerminalInput } from '@/lib/terminalKeys'
import { cn } from '@/lib/utils'

/** The live screen refreshes this often while it shows (a dialog moves with every key). */
const SCREEN_POLL_MS = 1000
/** Enough of the pane's bottom for Claude's tallest dialogs (`/mcp`, `/model`, `/config`). */
const SCREEN_LINES = 60

export interface TerminalDialogProps {
  host: string
  id: string
  /** Show the live screen (the chat view); the terminal view already shows it — keys only. */
  screen: boolean
  /** The session waits on this (the registry's `waiting_for`), or null. */
  waitingFor: string | null
  waiting: boolean
  /** Gone / unknown backend: nothing can be pressed. */
  locked: boolean
  desktop: boolean
  /** Terminal text size, px (`fleet.termFont`). */
  fontSize: number
  /** A key went out: refresh what shows the result (the terminal view, the chat). */
  onSteered: () => void
}

const keyClass = cn(
  'relative inline-flex h-9 shrink-0 items-center justify-center rounded-lg bg-fill px-2.5 font-mono text-body-sm text-foreground/85 transition-colors',
  'after:absolute after:inset-x-0 after:-inset-y-1 hover:bg-muted hover:text-foreground active:bg-muted disabled:opacity-50',
)

/**
 * The session's terminal when it waits on something the chat cannot show — one of Claude's own
 * dialogs (`/mcp`, `/model`, `/config`, `/resume`…), a permission prompt — and the keys to operate
 * it: buttons, or the keyboard while the panel has focus (arrows, Tab, Space, Enter, Esc, letters
 * for a filter; ⌘ / Ctrl shortcuts stay with Fleet). Keys go out one at a time, in order.
 */
export function TerminalDialog({ host, id, screen, waitingFor, waiting, locked, desktop, fontSize, onSteered }: TerminalDialogProps) {
  const [text, setText] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const poll = useCallback(
    async (signal: AbortSignal) => {
      try {
        const data = await api.peek(host, id, SCREEN_LINES, { signal })
        setText(typeof data.text === 'string' ? data.text : '')
        setFailed(false)
      } catch (err) {
        if (isAbortError(err)) throw err
        setFailed(true)
      }
    },
    [host, id],
  )
  const refreshScreen = usePoller(poll, SCREEN_POLL_MS, { enabled: screen })

  // Keys: one request at a time, in order; consecutive characters typed as one.
  const queue = useRef<TerminalInput[]>([])
  const running = useRef(false)
  const [busy, setBusy] = useState(false)
  const steered = useRef(onSteered)
  useEffect(() => {
    steered.current = onSteered
  }, [onSteered])
  const pump = useCallback(async () => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      while (queue.current.length) {
        const next = queue.current[0]
        queue.current = queue.current.slice(1)
        try {
          if ('key' in next) await api.keys(host, id, next.key)
          else await api.type(host, id, next.text)
        } catch (err) {
          queue.current = [] // the rest would land on a screen nobody saw
          toast.error(`Not sent: ${sessionErrorMessage(err)}`)
          break
        }
        refreshScreen()
      }
    } finally {
      running.current = false
      setBusy(false)
      steered.current()
    }
  }, [host, id, refreshScreen])
  const press = (input: TerminalInput) => {
    if (locked) return
    queue.current = pushInput(queue.current, input)
    void pump()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // A focused key button keeps Enter / Space for itself (pressing it).
    if ((e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).closest('button')) return
    const input = inputFromKey(e.nativeEvent)
    if (!input || locked) return
    e.preventDefault()
    e.stopPropagation()
    press(input)
  }
  const [focused, setFocused] = useState(false)
  const panel = useRef<HTMLDivElement>(null)

  // Follow the bottom of the screen, where Claude draws its dialogs.
  const pre = useRef<HTMLPreElement>(null)
  useLayoutEffect(() => {
    const el = pre.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text, fontSize])
  // …also when the box changes size (a window resize changes its max height).
  useEffect(() => {
    const el = pre.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      el.scrollTop = el.scrollHeight
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [screen])

  const dialog = waiting && (waitingFor ?? '').trim() === DIALOG_OPEN
  const heading = dialog ? 'Claude has a dialog open' : waiting ? `Waiting on you${waitingFor?.trim() ? ` · ${waitingFor.trim()}` : ''}` : 'Terminal keys'
  const hint = locked
    ? null
    : focused
      ? 'Your keyboard goes to the terminal (⌘ / Ctrl shortcuts stay here)'
      : desktop
        ? 'Click here to use your keyboard in the terminal'
        : null

  return (
    <div className={cn('shrink-0 px-safe', desktop ? 'mx-auto w-full max-w-4xl px-4 pt-2' : 'mx-auto w-full max-w-3xl px-3 pt-2')}>
      <div
        ref={panel}
        role="group"
        aria-label={`${heading}: terminal keys`}
        tabIndex={locked ? -1 : 0}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false)
        }}
        onMouseDown={(e) => {
          // A key button leaves focus where it is (the composer keeps it, so does the panel);
          // a click anywhere else gives the panel the keyboard.
          if ((e.target as HTMLElement).closest('button')) e.preventDefault()
          else panel.current?.focus()
        }}
        className={cn(
          'overflow-hidden rounded-2xl bg-card/60 shadow-float outline-none transition-shadow',
          waiting ? 'border-status-waiting/50' : 'border-border',
          focused && 'ring-3 ring-ring/40',
        )}
      >
        <div className="flex min-w-0 items-center gap-2 px-3 pt-2 text-xs">
          <SquareTerminalIcon className={cn('size-3.5 shrink-0', waiting ? 'text-status-waiting' : 'text-muted-foreground')} />
          <span className={cn('truncate font-medium', waiting ? 'text-status-waiting' : 'text-muted-foreground')}>{heading}</span>
          {busy ? <Loader2Icon className="size-3.5 shrink-0 animate-spin text-dimmer" aria-label="Sending keys" /> : null}
          {hint ? (
            <span className="ml-auto flex min-w-0 items-center gap-1 truncate text-dimmer">
              <KeyboardIcon className="size-3.5 shrink-0" />
              <span className="truncate">{hint}</span>
            </span>
          ) : null}
        </div>
        {screen ? (
          <pre
            ref={pre}
            aria-label="Terminal screen"
            className="m-2 mb-0 max-h-[min(45vh,28rem)] cursor-text overflow-auto rounded-lg bg-terminal px-3 py-2 font-mono whitespace-pre text-foreground/90 [tab-size:4]"
            style={{ fontSize: termFontRem(fontSize), lineHeight: 1.32 }}
          >
            {text === null ? (
              failed ? (
                <span className="font-sans text-sm text-dimmer">Couldn't read the terminal.</span>
              ) : (
                <span className="flex items-center gap-2 font-sans text-sm text-dimmer">
                  <Loader2Icon className="size-4 animate-spin" /> Connecting…
                </span>
              )
            ) : (
              <Linkified text={text} />
            )}
          </pre>
        ) : null}
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-2 py-2" role="toolbar" aria-label="Keys">
          {TERMINAL_KEYS.map((k) => (
            <button
              key={k.key}
              type="button"
              className={cn(keyClass, k.key === 'Escape' && 'text-status-waiting')}
              aria-label={`Press ${k.title}`}
              title={k.title}
              disabled={locked}
              onClick={() => press({ key: k.key })}
            >
              {k.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
