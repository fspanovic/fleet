import { useState, type ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'
import { toast } from 'sonner'

import { api, sendErrorMessage } from '@/api/client'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { modelLabel } from '@/lib/format'
import { readSwitchScreen, targetMatches, type SwitchScreen } from '@/lib/modelSwitch'
import { cn } from '@/lib/utils'

/** The session the picker steers: its host and id, harness, context window and why it can't be steered. */
export interface ModelPickerTarget {
  host: string
  id: string
  harness?: string | null
  /** `context.window`: tells `opus` from `opus[1m]`, which share one model id. */
  window?: number | null
  /** The composer's lock (gone / backend unknown): no picker then. */
  lockedReason?: string | null
}

interface Choice {
  alias: string
  family: string
  oneM: boolean
}

/** Claude Code's `/model` aliases (2.1.306: `sonnet`, `opus`, `haiku`, `fable` and the `[1m]` ones; no `haiku[1m]`). */
const CHOICES: Choice[] = [
  { alias: 'fable', family: 'fable', oneM: false },
  { alias: 'fable[1m]', family: 'fable', oneM: true },
  { alias: 'opus', family: 'opus', oneM: false },
  { alias: 'opus[1m]', family: 'opus', oneM: true },
  { alias: 'sonnet', family: 'sonnet', oneM: false },
  { alias: 'sonnet[1m]', family: 'sonnet', oneM: true },
  { alias: 'haiku', family: 'haiku', oneM: false },
]

const WINDOW_1M = 1_000_000

/** A live Claude Code session the composer could steer: the only kind `/model` can be typed into. */
export function canPickModel(t: ModelPickerTarget): boolean {
  return (t.harness || 'claude') === 'claude' && !t.lockedReason
}

function familyOf(model: string | null | undefined): string | null {
  return model?.match(/^claude-([a-z]+)-/i)?.[1].toLowerCase() ?? null
}

/** `Opus 5.5` for the family the session runs, else `Opus`; ` 1M` for the 1M variant. */
function choiceLabel(c: Choice, model: string | null | undefined): string {
  const base = familyOf(model) === c.family ? modelLabel(model).replace(/ 1M$/, '') : c.family.charAt(0).toUpperCase() + c.family.slice(1)
  return c.oneM ? `${base} 1M` : base
}

const POLL_MS = 400
/** How long `/model` gets to show its answer: the "Switch model?" question or "Set model to …". */
const ANSWER_WAIT_MS = 8000
/** How long Claude gets to take the confirmation. */
const CONFIRM_WAIT_MS = 6000

/** switchModel stopped on what the pane showed (nothing pressed, or no confirmation): its own words for the toast. */
class SwitchRefused extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Read the pane until `/model <alias>` shows something past `skip` (or `ms` runs out: `none`). */
async function waitForScreen(t: ModelPickerTarget, alias: string, ms: number, skip: SwitchScreen['kind'][]): Promise<SwitchScreen> {
  const until = Date.now() + ms
  for (;;) {
    const s = readSwitchScreen((await api.peek(t.host, t.id, 40)).text, alias)
    if (!skip.includes(s.kind)) return s
    if (Date.now() >= until) return { kind: 'none' }
    await sleep(POLL_MS)
  }
}

/**
 * Type `/model <alias>` (`send`, never forced) and answer Claude's own "Switch model?" question: only that
 * question, focus on "Yes, switch to <the picked family>", read again right before the Enter. Anything else →
 * nothing pressed. Resolves with Claude's "Set model to …" label, or throws a message for the toast.
 */
async function switchModel(t: ModelPickerTarget, alias: string): Promise<string> {
  await api.send(t.host, t.id, `/model ${alias}`)
  let s = await waitForScreen(t, alias, ANSWER_WAIT_MS, ['none'])
  if (s.kind === 'confirm') {
    if (!targetMatches(s.target, alias)) throw new SwitchRefused(`Claude asks to switch to ${s.target}, not ${alias} — nothing pressed; check the terminal`)
    const again = readSwitchScreen((await api.peek(t.host, t.id, 40)).text, alias)
    if (again.kind !== 'confirm' || again.target !== s.target) throw new SwitchRefused('The switch question changed on screen — nothing pressed; check the terminal')
    await api.keys(t.host, t.id, 'Enter')
    s = await waitForScreen(t, alias, CONFIRM_WAIT_MS, ['none', 'confirm'])
    if (s.kind === 'none') throw new SwitchRefused('Enter sent, but Claude did not confirm the switch — check the terminal')
  }
  if (s.kind === 'switched') return s.label
  if (s.kind === 'other') throw new SwitchRefused(s.text)
  throw new SwitchRefused(`Claude showed no answer to /model ${alias} — nothing pressed; check the terminal`)
}

interface Pending {
  key: string
  family: string
  label: string
}

/**
 * The model chip as a menu of Claude Code's model aliases. A pick types `/model <alias>` at once and answers Claude's "Switch model?" question (switchModel; a dialog that holds the send toasts
 * the server's reason). `context.model` only moves with the next reply, so until then the chip shows `→ Haiku`.
 * Only for `canPickModel` sessions.
 */
export function ModelPicker({
  target: t,
  model,
  label,
  className,
  children,
}: {
  target: ModelPickerTarget
  model: string | null | undefined
  /** The chip's label (`Opus 5.5`). */
  label: string
  className?: string
  children: ReactNode
}) {
  const [sending, setSending] = useState(false)
  const [pending, setPending] = useState<Pending | null>(null)
  const key = `${t.host}/${t.id}`
  const family = familyOf(model)
  if (pending && (pending.key !== key || pending.family === family)) setPending(null)
  const shownPending = pending && pending.key === key && pending.family !== family ? pending : null

  const current = (c: Choice) => c.family === family && c.oneM === (t.window != null && t.window >= WINDOW_1M)
  const pick = async (c: Choice) => {
    const next = choiceLabel(c, model)
    setSending(true)
    const toastId = toast.loading(`Switching to ${next}…`)
    try {
      const label = await switchModel(t, c.alias)
      if (c.family !== family) setPending({ key, family: c.family, label: next })
      toast.success(`Model set to ${label}`, { id: toastId, description: 'The chip follows with the next reply.', duration: 3000 })
    } catch (err) {
      toast.error(err instanceof SwitchRefused ? err.message : sendErrorMessage(err), { id: toastId, duration: 6000 })
    } finally {
      setSending(false)
    }
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={`Model: ${model} — click to change`}
          aria-label={`Model ${label}: change the model`}
          className={cn(className, 'outline-none hover:ring-1 hover:ring-border focus-visible:ring-2 focus-visible:ring-ring/50')}
        >
          {children}
          {shownPending ? <span className="font-normal text-muted-foreground">→ {shownPending.label}</span> : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Switch model (/model)</DropdownMenuLabel>
        {CHOICES.map((c) => (
          <DropdownMenuItem key={c.alias} disabled={sending} onSelect={() => void pick(c)} className="min-h-8 pointer-coarse:min-h-10">
            <span className="min-w-0 flex-1 truncate">{choiceLabel(c, model)}</span>
            <span className="font-mono text-2xs text-dimmer">{c.alias}</span>
            {current(c) ? <CheckIcon className="size-3.5 text-dimmer" aria-label="current" /> : <span aria-hidden className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
