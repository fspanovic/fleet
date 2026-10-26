import { useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, CornerDownLeftIcon, Loader2Icon, MicIcon, PaperclipIcon, SendHorizontalIcon, SquareIcon } from 'lucide-react'

import type { QuickReply, SessionKey } from '@/api/types'
import { CompletionPopup } from '@/components/session/CompletionPopup'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAttach } from '@/hooks/useAttach'
import { useCompletions } from '@/hooks/useCompletions'
import { useSettings } from '@/hooks/useSettings'
import type { PermissionToggle } from '@/hooks/usePermissionToggle'
import { useVoice } from '@/hooks/useVoice'
import { MAX_SEND_CHARS } from '@/lib/chat'
import { applySuggestion, findTrigger, rankSuggestions, toSuggestions, type Suggestion } from '@/lib/complete'
import { saveDraft, takeDraft } from '@/lib/drafts'
import { swipeIntent } from '@/lib/gestures'
import { restoreText } from '@/lib/outbox'
import { cn } from '@/lib/utils'
import { appendTranscript, formatElapsed } from '@/lib/voice'

/** Built-in key chips (not configurable). */
const KEY_CHIPS: { key: SessionKey; label: string; icon?: ReactNode; text?: string }[] = [
  { key: 'Escape', label: 'Esc' },
  { key: 'Enter', label: 'Enter', icon: <CornerDownLeftIcon /> },
  { key: 'Up', label: 'Up', icon: <ArrowUpIcon /> },
  { key: 'Down', label: 'Down', icon: <ArrowDownIcon /> },
  { key: 'Left', label: 'Left', icon: <ArrowLeftIcon /> },
  { key: 'Right', label: 'Right', icon: <ArrowRightIcon /> },
  { key: 'Tab', label: 'Tab', text: 'Tab' },
  { key: 'BTab', label: 'Shift+Tab', text: '⇧Tab' },
  { key: 'Space', label: 'Space', text: 'Space' },
]

// Visually 40px, with the hit area stretched to 44px.
const chipClass = cn(
  'relative h-10 shrink-0 rounded-full border border-transparent bg-fill px-3.5 text-sm font-medium text-muted-foreground transition-[color,background-color,box-shadow]',
  'after:absolute after:inset-x-0 after:-inset-y-0.5 active:bg-fill-strong active:text-foreground disabled:opacity-50',
  'hover:text-foreground',
)

export interface ComposerProps {
  quickReplies: QuickReply[]
  /** Why steering is impossible (gone / unknown backend); null = enabled. */
  lockedReason: string | null
  /**
   * Hands the text to the outbox; true = accepted (the textarea clears at once — delivery, the
   * undo window and errors show in the chat, never as a busy composer).
   */
  onSend: (text: string) => boolean
  onKey: (key: SessionKey) => void
  /**
   * Desktop pane: Enter (or ⌘/Ctrl+Enter) always sends, even on touch-capable laptops;
   * Shift+Enter is a newline; wider column. Mobile (false): Enter sends only on hardware keyboards.
   */
  desktop?: boolean
  /** The textarea, for "reply" shortcuts. */
  inputRef?: React.Ref<HTMLTextAreaElement>
  /** The session's host: attached files are uploaded there. */
  host: string
  /** Receives `attach(files)`, for drop zones around the composer (the session pane). */
  attachRef?: React.Ref<(files: File[]) => void>
  /** `host/id`: keys the unsent draft kept across sessions and restarts (lib/drafts.ts). */
  draftKey?: string
  /** Receives the composer's API: put a cancelled / failed message back (lib/outbox.ts restoreText). */
  apiRef?: React.Ref<ComposerApi>
  /** Who the message goes to, for the placeholder ("Claude", "Codex", "pi"). */
  agent?: string
  /** Words the voice transcriber should expect (session name, repo). */
  voiceHint?: string
  /** The session's id: `@file` / `brain:note` autocomplete (lib/complete.ts) lists on its host. */
  sessionId?: string
  /** `/skill` autocomplete too (Claude sessions). */
  slashCommands?: boolean
  /** Claude's permission mode: a shield beside the paperclip (hooks/usePermissionToggle.tsx); null = none. */
  permission?: PermissionToggle | null
}

// The shield's tint over the paperclip's classes: bypass in the warning accent, an armed restart destructive.
const PERMISSION_TONE: Record<PermissionToggle['tone'], string> = {
  plain: '',
  bypass: 'text-status-waiting hover:text-status-waiting',
  armed: 'bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive',
}
const PERMISSION_CHIP_TONE: Record<PermissionToggle['tone'], string> = {
  plain: '',
  bypass: 'text-status-waiting hover:text-status-waiting',
  armed: 'border-destructive bg-destructive text-white hover:text-white',
}

/**
 * The shield's hover tooltip (the app's Radix tooltip). The trigger is a bare inline-flex span — no
 * margin or padding, so the row's own gap stays the spacing — because a disabled button gets no hover.
 */
function PermissionTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export interface ComposerApi {
  /** Put `text` back (before anything typed since), focus, caret at the end. */
  restore: (text: string) => void
}

const MAX_TEXTAREA_PX = 21 * 5 + 22 // ~5 rows + padding

export function Composer({
  quickReplies,
  lockedReason,
  onSend,
  onKey,
  desktop = false,
  inputRef,
  host,
  attachRef,
  draftKey,
  apiRef,
  agent = 'Claude',
  voiceHint = '',
  sessionId,
  slashCommands = false,
  permission = null,
}: ComposerProps) {
  const [text, setText] = useState(() => takeDraft(draftKey))
  useEffect(() => saveDraft(draftKey, text), [draftKey, text])
  const ta = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(inputRef, () => ta.current as HTMLTextAreaElement, [])
  // Dropped / pasted / picked files: uploaded to the session's host, paths typed at the caret.
  const { attach, onPaste, progress } = useAttach({ host, textarea: ta, setValue: setText, disabledReason: lockedReason })
  useImperativeHandle(attachRef, () => (files: File[]) => void attach(files), [attach])
  const picker = useRef<HTMLInputElement>(null)
  // restore(): the caret goes to the end once the restored text is rendered.
  const caretToEnd = useRef(false)
  useImperativeHandle(
    apiRef,
    () => ({
      restore: (t: string) => {
        caretToEnd.current = true
        setText((cur) => restoreText(t, cur))
      },
    }),
    [],
  )
  // Voice prompts: the mic records, the server transcribes, the text is appended.
  const { voice: voiceEnabled } = useSettings()
  const voice = useVoice({
    hint: voiceHint,
    onText: (t) => {
      caretToEnd.current = true
      setText((cur) => appendTranscript(cur, t))
    },
  })
  const recording = voice.state === 'recording'
  const transcribing = voice.state === 'transcribing'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!recording) return
    const t = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(t)
  }, [recording])
  const locked = lockedReason != null
  const empty = text.trim().length === 0
  const tooLong = text.length > MAX_SEND_CHARS

  // Autocomplete: `/skill`, `@file`, `brain:note` at the caret → a popup above the input.
  const [caret, setCaret] = useState(0)
  const pendingCaret = useRef<number | null>(null)
  // Esc closes the popup for this word only (until the text leaves it).
  const [dismissed, setDismissed] = useState<string | null>(null)
  const trigger = sessionId && !locked ? findTrigger(text, caret, { skills: slashCommands }) : null
  const triggerKey = trigger ? `${trigger.kind}:${trigger.start}` : null
  const candidate = trigger != null && triggerKey !== dismissed ? trigger : null
  const completeKind = candidate?.kind ?? null
  const completions = useCompletions(host, sessionId, completeKind)
  const allSuggestions = useMemo(() => (completeKind ? toSuggestions(completeKind, completions.data) : []), [completeKind, completions.data])
  const suggestions = useMemo(() => rankSuggestions(allSuggestions, candidate?.query ?? ''), [allSuggestions, candidate?.query])
  // A mid-sentence `/` that matches nothing is probably a path: no popup.
  const completing = candidate?.inline && !completions.loading && suggestions.length === 0 ? null : candidate
  const [activeState, setActiveState] = useState<{ key: string; index: number } | null>(null)
  const activeKey = completing ? `${triggerKey}:${completing.query}` : ''
  const active = activeState?.key === activeKey ? Math.min(activeState.index, Math.max(0, suggestions.length - 1)) : 0
  const setActive = (index: number) => setActiveState({ key: activeKey, index })
  const completionStatus = completions.loading
    ? 'Loading…'
    : completions.error
      ? `Couldn't list: ${completions.error}`
      : completing?.kind === 'brain' && completions.data?.available === false
        ? `No brain on ${host} (no brain_root in ~/.brainrc)`
        : null
  const popupId = useId()
  const pick = (s: Suggestion) => {
    if (!completing) return
    const r = applySuggestion(text, completing, s.insert)
    pendingCaret.current = r.caret
    setText(r.text)
  }
  // Mobile: quick replies + keys live in a mini drawer above the input, hidden until swiped up.
  const [chipsOpen, setChipsOpen] = useState(false)
  // Desktop has no quick-reply / key chips: its keys are the terminal panel (TerminalDialog).
  const showChips = !desktop && chipsOpen
  const touchY = useRef<number | null>(null)
  const onTouchStart = (e: TouchEvent) => {
    // The textarea keeps its own gestures (scrolling, selection).
    touchY.current = e.target instanceof HTMLTextAreaElement ? null : e.touches[0].clientY
  }
  const onTouchEnd = (e: TouchEvent, onHandle: boolean) => {
    if (touchY.current == null) return
    const intent = swipeIntent(e.changedTouches[0].clientY - touchY.current)
    touchY.current = null
    if (intent === 'open') setChipsOpen(true)
    else if (intent === 'close') setChipsOpen(false)
    else if (intent === 'tap' && onHandle) setChipsOpen((o) => !o)
  }

  // Auto-grow up to ~5 rows, then scroll inside.
  useLayoutEffect(() => {
    const el = ta.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(MAX_TEXTAREA_PX, Math.max(44, el.scrollHeight))}px`
    if (caretToEnd.current) {
      caretToEnd.current = false
      el.focus()
      el.setSelectionRange(el.value.length, el.value.length)
      el.scrollTop = el.scrollHeight
      setCaret(el.value.length)
    }
    if (pendingCaret.current != null) {
      const at = pendingCaret.current
      pendingCaret.current = null
      el.focus()
      el.setSelectionRange(at, at)
      setCaret(at)
    }
  }, [text])

  const submit = () => {
    if (locked || empty || tooLong) return
    if (onSend(text)) setText('')
  }

  // Attach + mic: inline beside the input on desktop; on mobile they live in the chips drawer
  // so the input keeps its width (recording state also shows under the input, with Done/Cancel).
  const attachProps = {
    'aria-label': 'Attach files',
    title: desktop ? 'Attach files (or drop / paste them)' : 'Attach files',
    disabled: locked || progress != null,
    onClick: () => picker.current?.click(),
    children: progress ? <Loader2Icon className="animate-spin" /> : <PaperclipIcon />,
  }
  const micProps = {
    'aria-label': recording ? 'Stop recording and transcribe' : transcribing ? 'Transcribing' : 'Record a voice message',
    'aria-pressed': recording,
    title: recording ? 'Stop and transcribe (Esc cancels)' : 'Voice input: speak, the text is added to the message',
    disabled: locked || transcribing,
    onClick: () => (recording ? voice.stop() : void voice.start()),
    children: transcribing ? <Loader2Icon className="animate-spin" /> : recording ? <SquareIcon className="size-4 fill-current" /> : <MicIcon />,
  }
  const iconChip = cn(chipClass, 'flex items-center px-3 [&_svg]:size-4')
  // The tooltip says it; no native `title` on top of it.
  const { tone: permissionTone = 'plain', title: permissionTip = '', ...permissionProps } = permission ?? {}

  // Hardware keyboards send on Enter; touch keyboards keep Enter as a newline.
  const isTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0

  return (
    <div
      className="shrink-0 bg-background pb-safe px-safe"
      onTouchStart={desktop ? undefined : onTouchStart}
      onTouchEnd={desktop ? undefined : (e) => onTouchEnd(e, false)}
    >
      {desktop ? null : (
        <button
          type="button"
          aria-label={chipsOpen ? 'Hide quick replies' : 'Show quick replies'}
          aria-expanded={chipsOpen}
          className="flex h-5 w-full touch-none items-center justify-center outline-none"
          onTouchStart={(e) => {
            e.stopPropagation()
            touchY.current = e.touches[0].clientY
          }}
          onTouchEnd={(e) => {
            e.stopPropagation()
            e.preventDefault() // no synthetic click after a touch — the touch already decided
            onTouchEnd(e, true)
          }}
          onClick={() => setChipsOpen((o) => !o)}
        >
          <span className={cn('h-1 w-9 rounded-full transition-colors', chipsOpen ? 'bg-muted-foreground/60' : 'bg-muted-foreground/30')} />
        </button>
      )}
      <form
        className={cn(desktop ? 'mx-auto w-full max-w-4xl px-6 pt-0 pb-3' : 'mx-auto w-full max-w-3xl px-3 pb-2', locked && 'opacity-60')}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        {desktop ? null : (
        <div
          className={cn('grid transition-[grid-template-rows] duration-200 ease-out', showChips ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}
          inert={!showChips}
        >
        <div className="min-h-0 overflow-hidden">
        <div className="no-scrollbar -mx-3 flex gap-1.5 overflow-x-auto px-3 pt-0.5 pb-2" role="toolbar" aria-label="Attach, voice, quick replies and keys">
          <button type="button" className={iconChip} {...attachProps} />
          {permission ? (
            <PermissionTip label={permissionTip}>
              <button type="button" {...permissionProps} className={cn(iconChip, PERMISSION_CHIP_TONE[permissionTone])} />
            </PermissionTip>
          ) : null}
          {voiceEnabled ? (
            <button
              type="button"
              {...micProps}
              className={cn(iconChip, recording && 'animate-pulse border-destructive bg-destructive text-white hover:text-white')}
            />
          ) : null}
          <span aria-hidden className="mx-0.5 my-2.5 w-px shrink-0 bg-hairline" />
          {quickReplies.map((q) => (
            <button
              key={`${q.label}\u0000${q.text}`}
              type="button"
              className={chipClass}
              disabled={locked}
              title={q.text}
              onClick={() => void onSend(q.text)}
            >
              {q.label}
            </button>
          ))}
          <span aria-hidden className="mx-0.5 my-2.5 w-px shrink-0 bg-hairline" />
          {KEY_CHIPS.map((k) => (
            <button
              key={k.key}
              type="button"
              aria-label={`Press ${k.label}`}
              title={`Press ${k.label}`}
              className={cn(
                chipClass,
                'flex items-center px-3 font-mono text-body-sm text-status-waiting/90 [&_svg]:size-4',
              )}
              disabled={locked}
              onClick={() => onKey(k.key)}
            >
              {k.icon ?? k.text ?? k.label}
            </button>
          ))}
        </div>
        </div>
        </div>
        )}

        <div
          className={cn(
            'relative flex items-end gap-1 rounded-[1.625rem] bg-card p-1 shadow-dock transition-shadow duration-(--dur-base)',
            'focus-within:shadow-[0_0_0_1px_color-mix(in_oklab,var(--ring)_70%,transparent),0_0_0_4px_color-mix(in_oklab,var(--ring)_22%,transparent),0_12px_32px_-12px_var(--shadow-tint-3)]',
            tooLong && 'shadow-[0_0_0_1.5px_var(--destructive),0_12px_32px_-12px_var(--shadow-tint-3)]',
          )}
        >
          {completing ? (
            <CompletionPopup
              id={popupId}
              kind={completing.kind}
              items={suggestions}
              active={active}
              status={completionStatus}
              desktop={desktop}
              onHover={setActive}
              onPick={pick}
            />
          ) : null}
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            tabIndex={-1}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? [])
              e.target.value = '' // the same file can be picked again
              void attach(files)
            }}
          />
          {desktop ? (
            // Paperclip + shield as one pair: no gap, each 32 px wide (full height), icon centres ~32 px apart.
            <div className="flex shrink-0 items-end">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                {...attachProps}
                className={cn('shrink-0 rounded-full text-muted-foreground [&_svg:not([class*=size-])]:size-5', permission ? 'h-11 w-8' : 'size-11')}
              />
              {permission ? (
                <PermissionTip label={permissionTip}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    {...permissionProps}
                    className={cn('h-11 w-8 shrink-0 rounded-full text-muted-foreground [&_svg:not([class*=size-])]:size-5', PERMISSION_TONE[permissionTone])}
                  />
                </PermissionTip>
              ) : null}
            </div>
          ) : null}
          <textarea
            ref={ta}
            rows={1}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setCaret(e.target.selectionStart)
              if (dismissed) {
                const t = findTrigger(e.target.value, e.target.selectionStart, { skills: slashCommands })
                if (!t || `${t.kind}:${t.start}` !== dismissed) setDismissed(null)
              }
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
            onPaste={onPaste}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && voice.state !== 'idle') {
                e.preventDefault()
                voice.cancel()
                return
              }
              if (completing && !e.nativeEvent.isComposing) {
                const n = suggestions.length
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setDismissed(triggerKey)
                  return
                }
                if (n > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'n' || e.key === 'p')))) {
                  e.preventDefault()
                  setActive((active + (e.key === 'ArrowDown' || e.key === 'n' ? 1 : n - 1)) % n)
                  return
                }
                // Enter on a word that is already the pick (`/compact`) sends, as without the popup.
                const done = suggestions[active]?.insert === text.slice(completing.start, completing.end)
                if (n > 0 && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !done))) {
                  e.preventDefault()
                  pick(suggestions[active])
                  return
                }
              }
              if (isTouch && !desktop) return
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                submit()
              }
            }}
            disabled={locked}
            placeholder={locked ? 'Read-only' : desktop ? `Message ${agent}…  (Enter to send, Shift+Enter for a new line)` : `Message ${agent}…`}
            aria-label="Message"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={completing != null && suggestions.length > 0}
            aria-controls={completing ? popupId : undefined}
            aria-activedescendant={completing && suggestions.length > 0 ? `${popupId}-${active}` : undefined}
            autoCapitalize="sentences"
            autoComplete="off"
            spellCheck={false}
            className={cn(
              'min-h-11 min-w-0 flex-1 resize-none rounded-[1.375rem] border-0 bg-transparent py-[0.6875rem] text-base leading-[1.3125rem]',
              desktop ? 'px-1.5' : 'px-3.5',
              'outline-none placeholder:text-dimmer',
              'disabled:cursor-not-allowed',
            )}
          />
          {desktop && voiceEnabled ? (
            <Button
              type="button"
              variant={recording ? 'destructive' : 'ghost'}
              size="icon"
              {...micProps}
              className={cn(
                'size-11 shrink-0 rounded-full [&_svg:not([class*=size-])]:size-5',
                !recording && 'text-muted-foreground',
                recording && 'animate-pulse',
              )}
            />
          ) : null}
          <Button
            type="submit"
            size="icon"
            aria-label="Send"
            disabled={locked || empty || tooLong}
            className="size-11 shrink-0 rounded-full shadow-[0_4px_12px_-4px_color-mix(in_oklab,var(--primary)_70%,transparent)] disabled:shadow-none [&_svg:not([class*='size-'])]:size-5"
          >
            <SendHorizontalIcon />
          </Button>
        </div>
        {voice.state !== 'idle' ? (
          <div className="flex min-w-0 items-center gap-1.5 px-2 pt-1.5 text-xs text-muted-foreground" role="status">
            {recording ? (
              <>
                <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-destructive" />
                <span className="tabular-nums">Recording {formatElapsed(voice.startedAt ? now - voice.startedAt : 0)}</span>
              </>
            ) : (
              <span>Transcribing…</span>
            )}
            {recording ? (
              <button type="button" className="ml-1 font-medium text-foreground underline-offset-2 hover:underline" onClick={voice.stop}>
                Done
              </button>
            ) : null}
            <button type="button" className="ml-1 underline-offset-2 hover:text-foreground hover:underline" onClick={voice.cancel}>
              Cancel
            </button>
          </div>
        ) : progress ? (
          <div className="flex min-w-0 items-center gap-1.5 px-2 pt-1.5 text-xs text-muted-foreground" role="status">
            <span className="truncate">
              Uploading {progress.name}
              {progress.total > 1 ? ` (${progress.index}/${progress.total})` : ''}…
            </span>
          </div>
        ) : lockedReason || text.length > MAX_SEND_CHARS - 1000 ? (
          <div className={cn('px-2 pt-1.5 text-xs', tooLong ? 'text-destructive' : 'text-dimmer')}>
            {lockedReason ?? `${text.length} / ${MAX_SEND_CHARS}`}
          </div>
        ) : null}
      </form>
    </div>
  )
}
