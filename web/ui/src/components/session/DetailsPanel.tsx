import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  BotIcon,
  CodeXmlIcon,
  CopyIcon,
  GitForkIcon,
  LayersIcon,
  Link2Icon,
  Loader2Icon,
  MessageSquareTextIcon,
  PowerIcon,
  SparklesIcon,
  SquareTerminalIcon,
  XIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import { api, sessionErrorMessage } from '@/api/client'
import type { AutoNameRun, Session } from '@/api/types'
import { BriefSection, type BriefSectionProps } from '@/components/session/BriefSection'
import { TaskChip } from '@/components/TaskChip'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useNow } from '@/hooks/useNow'
import { openTaskPicker } from '@/hooks/useSessionActions'
import { useSessionTask, useTasks } from '@/hooks/useTasks'
import { useSessionTitle } from '@/hooks/useTitles'
import { autoNameSummary, autoNameToast } from '@/lib/autoname'
import { editorLabel } from '@/lib/brief'
import { canAttachInApp, copyWithToast, sessionAttachCommand, sessionAttachLink } from '@/lib/clipboard'
import type { DetailMode } from '@/lib/chat'
import { ctxLevel, ctxSummary, relTime, shortCwd } from '@/lib/format'
import { harnessLabel } from '@/lib/harness'
import { withHint } from '@/lib/shortcuts'
import { runningSubagents, subagentJob, subagentMeta, subagentsCountLabel } from '@/lib/subagents'
import { CTX_TEXT, INSET_GROUP, SECTION_LABEL } from '@/lib/styles'
import { cn } from '@/lib/utils'

// Last naming pass per host seen by this tab (a peer's /api/health is not reachable
// through the proxy, so for peers this is only what "Run now" returned).
const lastRuns = new Map<string, AutoNameRun>()

export interface DetailsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  host: string
  id: string
  session: Session | null
  isSelfHost: boolean
  mode: DetailMode
  onMode: (m: DetailMode) => void
  termLines: number
  onTermLines: (n: number) => void
  /** Called after a successful close (navigate away). */
  onClosed: () => void
  /** The brief at the top of the panel. */
  brief: Omit<BriefSectionProps, 'desktop' | 'cancelEditRef'>
  /** "Open in VS Code / Cursor" for the session's checkout (Brief.editorUrl, else the fleet row's). */
  editor?: { url: string | null | undefined; kind?: string | null }
  /** Desktop panel: the ✕ in the top-right corner. */
  onClose?: () => void
  /**
   * Session stacks (absent: the host predates them): in a stack → StackBrief (the sheet);
   * not in one → Spawn sibling… (creates the stack).
   */
  stack?: { label: string | null; onOpen: () => void } | { label: null; onSpawnSibling: () => void } | null
}

const segItem =
  'h-9 flex-1 gap-1.5 rounded-full px-3 text-body-sm text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:bg-seg data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_0_var(--shadow-tint-2),0_0_0_0.5px_var(--edge-strong)]'

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint ? <div className="truncate text-xs text-dimmer">{hint}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  )
}

/** Session → Task: the task chip (a pin when linked by hand) and "Link task…" (the app-wide picker). */
function TaskRow({ session: s, onPick }: { session: Session; onPick: () => void }) {
  const { notConfigured, links } = useTasks()
  const task = useSessionTask(s)
  if (notConfigured) return null
  const hint =
    s.manualTask?.id === null
      ? 'Unlinked by hand — no automatic link'
      : task
        ? `${links.manualSessions.has(`${s.host}/${s.session_id}`) ? 'Linked by hand' : 'Linked automatically'}: ${task.title}`
        : 'Not linked — the first prompt or the most mentioned task links it'
  return (
    <Row label="Task" hint={hint}>
      <TaskChip session={s} />
      <Button variant="outline" className="h-9 px-3" onClick={onPick}>
        <Link2Icon />
        {task ? 'Change…' : 'Link task…'}
      </Button>
    </Row>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="pt-4">
      <h3 className={cn(SECTION_LABEL, 'px-1 pb-2')}>{title}</h3>
      <div className={cn(INSET_GROUP, 'divide-y divide-hairline px-3.5')}>{children}</div>
    </section>
  )
}

/** The session's running subagents: each one's job, then type · model · running for · background / foreground. */
function SubagentsSection({ session }: { session: Session | null }) {
  const now = useNow(10_000)
  const list = runningSubagents(session)
  if (!list.length) return null
  return (
    <Section title={subagentsCountLabel(list.length)}>
      {list.map((a) => (
        <div key={a.id} className="flex min-w-0 items-start gap-2 py-2">
          <BotIcon className="mt-0.5 size-3.5 shrink-0 text-status-busy" aria-hidden />
          <div className="min-w-0">
            <div className="text-sm break-words">{subagentJob(a)}</div>
            <div className="truncate text-xs text-dimmer tabular-nums">{subagentMeta(a, now)}</div>
          </div>
        </div>
      ))}
    </Section>
  )
}

/** ⋯ on mobile: the Details panel as a bottom drawer. Esc while editing the brief cancels the edit, not the drawer. */
export function DetailsDrawer(p: DetailsPanelProps) {
  const cancelEdit = useRef<(() => void) | null>(null)
  // Closing the drawer unmounts the body, which disarms "Close session".
  return (
    <Drawer open={p.open} onOpenChange={p.onOpenChange}>
      <DrawerContent
        className="px-safe"
        onEscapeKeyDown={(e) => {
          if (!cancelEdit.current) return
          e.preventDefault()
          cancelEdit.current()
        }}
      >
        <DetailsPanel {...p} variant="drawer" cancelEditRef={cancelEdit} />
      </DrawerContent>
    </Drawer>
  )
}

/**
 * Details: header (name, host · cwd, context, open in editor), running subagents, the Brief (summary, todos,
 * resources, continue), View (chat / terminal, scrollback), Session (attach,
 * auto-name, ids, close). `drawer` = inside the mobile drawer; `panel` = the desktop
 * details column (click-to-confirm wording, ✕ to close, no drawer chrome).
 */
export function DetailsPanel(p: DetailsPanelProps & { variant: 'drawer' | 'panel'; cancelEditRef?: React.RefObject<(() => void) | null> }) {
  const panel = p.variant === 'panel'
  const [lastRun, setLastRun] = useState<AutoNameRun | null>(() => lastRuns.get(p.host) ?? null)
  const [autoName, setAutoName] = useState<{ enabled: boolean; intervalMinutes: number } | null>(null)
  const [naming, setNaming] = useState(false)

  // Last run + schedule for this host's server (only answerable for self).
  useEffect(() => {
    if (!p.open || !p.isSelfHost) return
    const ctl = new AbortController()
    api
      .health({ signal: ctl.signal })
      .then((h) => {
        setAutoName({ enabled: h.autoName?.enabled === true, intervalMinutes: h.autoName?.intervalMinutes ?? 5 })
        const run = h.autoName?.lastRun
        if (run) {
          lastRuns.set(p.host, run)
          setLastRun(run)
        }
      })
      .catch(() => {})
    return () => ctl.abort()
  }, [p.open, p.isSelfHost, p.host])

  const runNow = async () => {
    if (naming) return
    setNaming(true)
    try {
      const run = await api.autoname(p.host)
      lastRuns.set(p.host, run)
      setLastRun(run)
      toast(autoNameToast(run))
    } catch (err) {
      toast.error((err as Error)?.message || 'Naming failed')
    } finally {
      setNaming(false)
    }
  }

  // Close: two taps. The first arms (for 5s), the second kills Claude + its terminal.
  const [armed, setArmed] = useState(false)
  const [closing, setClosing] = useState(false)
  const armTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(armTimer.current), [])
  const onOpenChange = (open: boolean) => {
    if (!open && !closing) {
      clearTimeout(armTimer.current)
      setArmed(false)
    }
    p.onOpenChange(open)
  }

  const closeSession = async () => {
    if (closing) return
    if (!armed) {
      setArmed(true)
      clearTimeout(armTimer.current)
      armTimer.current = setTimeout(() => setArmed(false), 5000)
      return
    }
    clearTimeout(armTimer.current)
    setClosing(true)
    try {
      const res = await api.kill(p.host, p.id)
      toast.success(`Closed ${res.name || p.id.slice(0, 8)}`, { description: String(res.terminal || 'done').replace(/-/g, ' ') })
      onOpenChange(false)
      p.onClosed()
    } catch (err) {
      toast.error('Close failed', { description: sessionErrorMessage(err) })
      setClosing(false)
      setArmed(false)
    }
  }

  const s = p.session
  const { title } = useSessionTitle(s, `${p.host}/${p.id}`)
  const attachCmd = sessionAttachCommand(s)
  const attachLink = canAttachInApp() ? sessionAttachLink(s) : null
  const lastRunHint = lastRun?.at
    ? `last run ${relTime(lastRun.at)} ago · ${autoNameSummary(lastRun)}`
    : autoName
      ? autoName.enabled
        ? `every ${autoName.intervalMinutes} min · not run yet`
        : 'scheduled runs off'
      : `on ${p.host}`

  const editorText = editorLabel(p.editor?.kind, p.editor?.url)

  const Header = panel ? 'div' : DrawerHeader
  const Title = panel ? 'h2' : DrawerTitle
  const Description = panel ? 'p' : DrawerDescription

  return (
        <div
          className={
            panel
              ? 'no-scrollbar h-full w-full overflow-y-auto px-4 pb-4'
              : 'no-scrollbar mx-auto w-full max-w-lg overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]'
          }
        >
          <Header className={panel ? 'flex flex-row items-start gap-1 pt-3 pb-1 text-left' : 'flex flex-row items-start gap-1 px-0 pt-3 pb-1 text-left'}>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Title className="truncate text-left text-lg font-semibold tracking-(--tracking-heading)">{s ? title : p.id.slice(0, 8)}</Title>
              <Description className={cn('truncate text-left font-mono text-xs', panel && 'text-muted-foreground')} title={panel ? (s?.cwd ?? undefined) : undefined}>
                {[p.host, s?.cwd ? shortCwd(s.cwd, 60) : null].filter(Boolean).join(' · ')}
              </Description>
              {s?.context ? (
                <p className={cn('truncate text-left text-xs tabular-nums', CTX_TEXT[ctxLevel(s.context.pct)])}>
                  Context {ctxSummary(s.context)}
                  {s.context.model ? <span className="text-dimmer"> · {s.context.model}</span> : null}
                </p>
              ) : null}
            </div>
            {panel && p.onClose ? (
              <Button variant="ghost" size="icon" aria-label="Close details" title={withHint('Close', 'inspector')} onClick={p.onClose} className="-mr-2 size-9 shrink-0 rounded-full text-muted-foreground">
                <XIcon className="size-[1.125rem]" />
              </Button>
            ) : null}
          </Header>

          {/* A desktop editor link makes no sense on a phone: hidden on touch-first screens. */}
          {editorText && p.editor?.url ? (
            <Button asChild variant="outline" className="mt-3 mb-1 h-10 w-full justify-start rounded-xl px-3.5 text-sm pointer-coarse:hidden">
              <a href={p.editor.url} title={p.editor.url}>
                <CodeXmlIcon />
                {editorText}
              </a>
            </Button>
          ) : null}

          <SubagentsSection session={s} />

          <BriefSection {...p.brief} desktop={panel} cancelEditRef={p.cancelEditRef} />

          <Section title="View">
            <div className="py-2">
              <ToggleGroup
                type="single"
                value={p.mode}
                onValueChange={(v) => v && p.onMode(v as DetailMode)}
                spacing={0.5}
                aria-label="View mode"
                className="w-full rounded-full bg-fill p-1"
              >
                <ToggleGroupItem value="chat" className={segItem}>
                  <MessageSquareTextIcon /> Chat
                </ToggleGroupItem>
                <ToggleGroupItem value="term" className={segItem}>
                  <SquareTerminalIcon /> Terminal
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {p.mode === 'term' ? (
              <Row label="Scrollback" hint="Lines captured from the pane">
                <ToggleGroup
                  type="single"
                  value={String(p.termLines)}
                  onValueChange={(v) => v && p.onTermLines(Number(v))}
                  spacing={0.5}
                  className="rounded-full bg-fill p-1"
                >
                  {[200, 600].map((n) => (
                    <ToggleGroupItem key={n} value={String(n)} className={cn(segItem, 'h-8 flex-none px-3 tabular-nums')}>
                      {n}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Row>
            ) : null}
          </Section>

          <Section title="Session">
            {s?.session_id ? (
              <TaskRow
                session={s}
                onPick={() => {
                  // The drawer goes first: the picker is a dialog of its own.
                  if (!panel) p.onOpenChange(false)
                  openTaskPicker(s)
                }}
              />
            ) : null}
            {p.stack ? (
              'onOpen' in p.stack ? (
                <Row label="Session stack" hint={p.stack.label ?? undefined}>
                  <Button variant="outline" className="h-9 px-3" onClick={p.stack.onOpen}>
                    <LayersIcon />
                    StackBrief
                  </Button>
                </Row>
              ) : (
                <Row label="Sibling session" hint="Starts a new stack around this session (one Sonnet call)">
                  <Button variant="outline" className="h-9 px-3" onClick={p.stack.onSpawnSibling}>
                    <GitForkIcon />
                    Spawn sibling…
                  </Button>
                </Row>
              )
            ) : null}
            {s ? (
              <div className="py-1.5">
                <Row
                  label={attachLink ? 'Attach' : 'Attach command'}
                  hint={attachCmd ? (attachLink ? 'Opens an iTerm tab attached to its tmux session' : 'Run in a terminal on any fleet host') : 'Only for tmux sessions — this one is an iTerm tab'}
                >
                  <div className="flex gap-1.5">
                    <Button variant={attachLink ? 'ghost' : 'outline'} className="h-9 px-3" disabled={!attachCmd} aria-label="Copy attach command" title="Copy attach command" onClick={() => attachCmd && void copyWithToast(attachCmd)}>
                      <CopyIcon />
                      Copy
                    </Button>
                    {attachLink ? (
                      <Button asChild className="h-9 px-3">
                        <a href={attachLink} title={attachCmd ?? undefined}>
                          <SquareTerminalIcon />
                          Attach
                        </a>
                      </Button>
                    ) : null}
                  </div>
                </Row>
                {attachCmd ? (
                  <code className="block rounded-md bg-muted px-2.5 py-2 font-mono text-xs break-all text-muted-foreground select-all">{attachCmd}</code>
                ) : null}
              </div>
            ) : null}
            <Row label={`Auto-name (${p.host})`} hint={lastRunHint}>
              <Button variant="outline" className="h-9 px-3" disabled={naming} onClick={runNow}>
                {naming ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
                {naming ? 'Naming…' : 'Run now'}
              </Button>
            </Row>
            {s ? (
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 py-3 text-xs">
                {(
                  [
                    ['agent', s.harness ? harnessLabel(s.harness) : null],
                    ['model', s.model],
                    ['tmux', s.tmux_session],
                    ['backend', s.backend],
                    ['pid', s.pid],
                    ['session', s.session_id],
                  ] as const
                )
                  .filter(([, v]) => v != null && v !== '')
                  .map(([k, v]) => (
                    <div key={k} className="contents">
                      <span className="text-dimmer">{k}</span>
                      <span className="truncate font-mono text-muted-foreground select-all">{String(v)}</span>
                    </div>
                  ))}
              </div>
            ) : null}
            <div className="py-3">
              <Button
                variant="destructive"
                className={cn('h-11 w-full text-sm', armed && 'bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive dark:hover:bg-destructive/90')}
                disabled={closing}
                onClick={closeSession}
              >
                {closing ? <Loader2Icon className="animate-spin" /> : <PowerIcon />}
                {closing ? 'Closing…' : armed ? (panel ? 'Click again to close' : 'Tap again to close') : 'Close session…'}
              </Button>
              <p className="pt-1.5 text-center text-xs text-dimmer">
                Ends {harnessLabel(s?.harness)} and its {s?.backend === 'iterm' ? 'iTerm tab' : 'tmux window'}.
              </p>
            </div>
          </Section>
        </div>
  )
}
