import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ChevronLeftIcon, ShirtIcon, XIcon } from 'lucide-react'
import { useLocation } from 'wouter'

import type { Session, Task } from '@/api/types'
import { Jersey, pinLegend, Portrait, SQUAD, useSquad, type Legend } from '@/components/Madrid'
import { NewSessionDialog, NewSessionDrawer } from '@/components/NewSessionDrawer'
import { Ancelotti, Scoreboard, useMatch, useQuietFleet } from '@/components/MadridMatch'
import { ScreenHeader } from '@/components/ScreenHeader'
import { StatusDot } from '@/components/StatusDot'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useFleet } from '@/hooks/useFleet'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { useTasks, useWatchTasks } from '@/hooks/useTasks'
import { useSessionTitle } from '@/hooks/useTitles'
import { allSessions, sessionHref, statusLabel, statusMeta } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { storage } from '@/lib/storage'
import { STATUS_TEXT } from '@/lib/styles'
import { cn } from '@/lib/utils'

const LINEUP_KEY = 'fleet.squadLineup'
const DRAG_TYPE = 'text/fleet-player'
// Present alongside DRAG_TYPE when a free legend is dragged: dragover cannot read the data, only the types.
const LEGEND_TYPE = 'text/fleet-legend'
const LEGEND = 'legend:'

const FORMATION_KEY = 'fleet.squadFormation'

type Position = { id: string; label: string; x: number; y: number }

const BACK_FOUR: readonly Position[] = [
  { id: 'lb', label: 'LB', x: 12, y: 68 },
  { id: 'lcb', label: 'CB', x: 36, y: 73 },
  { id: 'rcb', label: 'CB', x: 64, y: 73 },
  { id: 'rb', label: 'RB', x: 88, y: 68 },
]
const GK: Position = { id: 'gk', label: 'GK', x: 50, y: 90 }

// Ids shared across formations keep their player when the formation changes.
const FORMATIONS: Record<string, readonly Position[]> = {
  '4-3-3': [
    { id: 'lw', label: 'LW', x: 17, y: 20 },
    { id: 'st', label: 'ST', x: 50, y: 14 },
    { id: 'rw', label: 'RW', x: 83, y: 20 },
    { id: 'lcm', label: 'CM', x: 25, y: 44 },
    { id: 'cm', label: 'CM', x: 50, y: 49 },
    { id: 'rcm', label: 'CM', x: 75, y: 44 },
    ...BACK_FOUR,
    GK,
  ],
  '4-4-2': [
    { id: 'st', label: 'ST', x: 36, y: 15 },
    { id: 'st2', label: 'ST', x: 64, y: 15 },
    { id: 'lw', label: 'LM', x: 12, y: 40 },
    { id: 'lcm', label: 'CM', x: 37, y: 46 },
    { id: 'rcm', label: 'CM', x: 63, y: 46 },
    { id: 'rw', label: 'RM', x: 88, y: 40 },
    ...BACK_FOUR,
    GK,
  ],
  '4-2-3-1': [
    { id: 'st', label: 'ST', x: 50, y: 12 },
    { id: 'lw', label: 'LW', x: 15, y: 29 },
    { id: 'cm', label: 'CAM', x: 50, y: 31 },
    { id: 'rw', label: 'RW', x: 85, y: 29 },
    { id: 'lcm', label: 'DM', x: 34, y: 51 },
    { id: 'rcm', label: 'DM', x: 66, y: 51 },
    ...BACK_FOUR,
    GK,
  ],
  '3-5-2': [
    { id: 'st', label: 'ST', x: 36, y: 14 },
    { id: 'st2', label: 'ST', x: 64, y: 14 },
    { id: 'lw', label: 'LWB', x: 10, y: 42 },
    { id: 'lcm', label: 'CM', x: 30, y: 47 },
    { id: 'cm', label: 'CAM', x: 50, y: 33 },
    { id: 'rcm', label: 'CM', x: 70, y: 47 },
    { id: 'rw', label: 'RWB', x: 90, y: 42 },
    { id: 'lcb', label: 'CB', x: 25, y: 72 },
    { id: 'cb', label: 'CB', x: 50, y: 75 },
    { id: 'rcb', label: 'CB', x: 75, y: 72 },
    GK,
  ],
}

type Lineup = Record<string, string>
type Signing = { pos: string; label: string; legend: Legend }

function readLineup(): Lineup {
  try {
    const v = JSON.parse(storage.get(LINEUP_KEY) ?? '{}')
    return v && typeof v === 'object' ? (v as Lineup) : {}
  } catch {
    return {}
  }
}

const keyFromHref = (href: string) => {
  const [, , host, id] = href.split('/')
  return host && id ? `${decodeURIComponent(host)}/${decodeURIComponent(id)}` : null
}

/**
 * `#/squad`: the live sessions as a 4-3-3 — every live session takes a position on its own (the next free one), and
 * dragging between positions swaps them. The free legends are the squad list: drag one onto an empty position
 * (or tap it, then the position) to start a new session there, wearing that shirt. A click on a player opens its
 * session. The lineup is this browser's (localStorage).
 */
export function SquadScreen({ layout = 'screen' }: { layout?: 'screen' | 'pane' }) {
  const pane = layout === 'pane'
  const [, navigate] = useLocation()
  const { fleet } = useFleet()
  useWatchTasks()
  const tasks = useTasks()
  const squad = useSquad()
  const [stored, setStored] = useState<Lineup>(readLineup)
  const [picked, setPicked] = useState<string | null>(null)
  const [signing, setSigning] = useState<Signing | null>(null)
  const [formationId, setFormationId] = usePersistentState<string>(FORMATION_KEY, '4-3-3')
  const FORMATION = FORMATIONS[formationId] ?? FORMATIONS['4-3-3']
  const match = useMatch()
  const quiet = useQuietFleet()

  const sessions = useMemo(() => allSessions(fleet), [fleet])
  const byKey = useMemo(() => new Map(sessions.map((s) => [sessionKey(s), s])), [sessions])
  const tasksBySession = useMemo(() => {
    const out = new Map<string, Task[]>()
    for (const t of tasks.data?.tasks ?? []) {
      for (const s of tasks.links.sessionsByTask.get(t.id) ?? []) {
        const k = sessionKey(s)
        out.set(k, [...(out.get(k) ?? []), t])
      }
    }
    return out
  }, [tasks.data?.tasks, tasks.links])

  const lineup = useMemo(() => {
    const out: Lineup = {}
    const used = new Set<string>()
    for (const p of FORMATION) {
      const k = stored[p.id]
      if (k && byKey.has(k) && !used.has(k)) {
        out[p.id] = k
        used.add(k)
      }
    }
    const rest = sessions.map(sessionKey).filter((k) => !used.has(k))
    for (const p of FORMATION) if (!out[p.id] && rest.length) out[p.id] = rest.shift()!
    return out
  }, [stored, byKey, sessions, FORMATION])
  const placed = new Set(Object.values(lineup))
  const subs = sessions.filter((s) => !placed.has(sessionKey(s)))
  const taken = new Set([...squad.values()].map(([n]) => n))
  const free = SQUAD.filter(([n]) => !taken.has(n))

  const save = (next: Lineup) => {
    setStored(next)
    storage.set(LINEUP_KEY, JSON.stringify(next))
  }
  const place = (key: string, pos: string) => {
    const next = { ...lineup }
    const from = Object.keys(next).find((p) => next[p] === key)
    const there = next[pos]
    if (from) delete next[from]
    if (from && there) next[from] = there
    next[pos] = key
    save(next)
    setPicked(null)
  }
  const sign = (number: number, pos: string) => {
    setPicked(null)
    const legend = free.find(([n]) => n === number)
    const slot = FORMATION.find((p) => p.id === pos)
    if (legend && slot && !lineup[pos]) setSigning({ pos, label: slot.label, legend })
  }
  const drop = (data: string, pos: string) => {
    if (data.startsWith(LEGEND)) sign(Number(data.slice(LEGEND.length)), pos)
    else place(data, pos)
  }
  const signed = (target: Signing) => (href: string) => {
    const key = keyFromHref(href)
    if (!key) return
    pinLegend(key, target.legend[0])
    const next = { ...readLineup(), [target.pos]: key }
    save(next)
  }

  const back = () => {
    if (!pane && window.history.length > 1) window.history.back()
    else navigate('/', { replace: !pane })
  }
  const screenRef = useRef<HTMLDivElement>(null)
  useSwipeBack(screenRef, back, !pane)

  const pitch = (
    <div className="squad-pitch relative mx-auto aspect-[68/105] h-full max-h-full w-auto max-w-full rounded-2xl shadow-pane">
      <PitchLines />
      {FORMATION.map((p) => {
        const s = byKey.get(lineup[p.id] ?? '')
        const pickedLegend = picked?.startsWith(LEGEND)
        return (
          <Slot key={p.id} x={p.x} y={p.y} empty={!s} onDropData={(d) => drop(d, p.id)} onTap={picked && (!pickedLegend || !s) ? () => drop(picked, p.id) : undefined}>
            {s ? (
              <Player session={s} tasks={tasksBySession.get(sessionKey(s)) ?? []} position={p.label} goals={match.goals[sessionKey(s)] ?? 0} onOpen={() => navigate(sessionHref(s))} />
            ) : (
              <span className={cn('squad-empty grid size-12 place-items-center rounded-full text-xs font-bold', picked && 'squad-empty-ready')}>{p.label}</span>
            )}
          </Slot>
        )
      })}
    </div>
  )

  const side = (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto pb-2">
      {subs.length ? (
        <section aria-label="Substitutes" className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
            Substitutes <span className="text-xs font-normal text-dimmer tabular-nums">{subs.length}</span>
          </h2>
          <p className="px-1 text-xs text-dimmer">More live sessions than positions. Drag one onto a player to swap them.</p>
          {subs.map((s) => (
            <BenchPlayer
              key={sessionKey(s)}
              session={s}
              tasks={tasksBySession.get(sessionKey(s)) ?? []}
              picked={picked === sessionKey(s)}
              onPick={() => setPicked((p) => (p === sessionKey(s) ? null : sessionKey(s)))}
            />
          ))}
        </section>
      ) : null}
      <section aria-label="Squad list" className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
          Squad list <span className="text-xs font-normal text-dimmer tabular-nums">{free.length}</span>
        </h2>
        <p className="px-1 text-xs text-dimmer">Drag a legend onto an empty position to sign them: a new session starts there.</p>
        <div className="grid grid-cols-2 gap-2">
          {free.map((l) => (
            <FreeAgent key={l[0]} legend={l} picked={picked === `${LEGEND}${l[0]}`} onPick={() => setPicked((p) => (p === `${LEGEND}${l[0]}` ? null : `${LEGEND}${l[0]}`))} />
          ))}
        </div>
      </section>
    </div>
  )

  const title = (
    <>
      <ShirtIcon className="size-4 text-muted-foreground" /> Squad
    </>
  )
  const controls = (
    <>
      <ToggleGroup type="single" size="sm" variant="outline" value={formationId} onValueChange={(v) => v && setFormationId(v)} aria-label="Formation">
        {Object.keys(FORMATIONS).map((f) => (
          <ToggleGroupItem key={f} value={f} className="px-2.5 text-xs tabular-nums">
            {f}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Scoreboard />
    </>
  )
  const coach = quiet ? <Ancelotti className="mt-auto pt-4" /> : null

  const NewSession = pane ? NewSessionDialog : NewSessionDrawer
  const form = (
    <NewSession
      open={signing != null}
      onOpenChange={(o) => !o && setSigning(null)}
      onOpenSession={signing ? signed(signing) : () => {}}
      prefill={signing ? { title: `Sign ${signing.legend[1]} #${signing.legend[0]} · ${signing.label}`, legend: signing.legend } : null}
    />
  )

  if (pane) {
    return (
      <section aria-label="Squad" className="flex h-full min-w-0 flex-1 flex-col bg-background">
        <header data-tauri-drag-region="deep" className="titlebar titlebar-lead flex shrink-0 items-center gap-2 py-2 pr-3 pl-5 [--titlebar-pad:1.25rem]">
          <h1 className="flex shrink-0 items-center gap-2 text-lg font-bold tracking-(--tracking-display)">{title}</h1>
          <div className="ml-auto flex items-center gap-3">{controls}</div>
          <Button variant="ghost" size="icon" aria-label="Close" title="Close (Esc)" onClick={() => navigate('/')} className="size-9 shrink-0 rounded-full text-muted-foreground">
            <XIcon className="size-5" />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 gap-6 px-6 pt-2 pb-6">
          <div className="flex min-w-0 flex-1 justify-center">{pitch}</div>
          <div className="flex w-80 shrink-0 flex-col">
            {side}
            {coach}
          </div>
        </div>
        {form}
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
          <h1 className="flex flex-1 items-center gap-2 text-2xl font-bold tracking-(--tracking-display)">{title}</h1>
        </div>
      </ScreenHeader>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-5 px-gutter pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-wrap items-center justify-between gap-2">{controls}</div>
        <div className="h-[70vh]">{pitch}</div>
        {side}
        {coach}
      </div>
      {form}
    </div>
  )
}

function Slot({ x, y, empty, onDropData, onTap, children }: { x: number; y: number; empty: boolean; onDropData: (data: string) => void; onTap?: () => void; children: ReactNode }) {
  const [over, setOver] = useState(false)
  return (
    <div
      style={{ left: `${x}%`, top: `${y}%` }}
      className={cn('absolute z-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center', over && 'squad-slot-over')}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE) || (!empty && e.dataTransfer.types.includes(LEGEND_TYPE))) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false)
        const d = e.dataTransfer.getData(DRAG_TYPE)
        if (d) onDropData(d)
      }}
      onClick={onTap}
    >
      {children}
    </div>
  )
}

const startDrag = (e: DragEvent, data: string) => {
  e.dataTransfer.setData(DRAG_TYPE, data)
  if (data.startsWith(LEGEND)) e.dataTransfer.setData(LEGEND_TYPE, '')
  e.dataTransfer.effectAllowed = 'move'
}

function Player({ session: s, tasks, position, goals, onOpen }: { session: Session; tasks: Task[]; position: string; goals: number; onOpen: () => void }) {
  const { title } = useSessionTitle(s)
  const key = statusMeta(s.status).key
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => startDrag(e, sessionKey(s))}
      onClick={(e) => {
        e.stopPropagation()
        onOpen()
      }}
      title={`${title} — ${statusLabel(s)}`}
      className="group flex w-32 cursor-grab flex-col items-center outline-none active:cursor-grabbing"
    >
      <span className="relative">
        <Jersey playerKey={sessionKey(s)} always numbered className="size-12 drop-shadow-md transition-transform group-hover:-translate-y-0.5" />
        <StatusDot status={s.status} className="absolute -top-0.5 -right-1 size-2.5" />
        {goals ? (
          <span title={`${goals} goal${goals > 1 ? 's' : ''} today`} className="squad-goals absolute -bottom-1 -left-3 flex items-center gap-0.5 rounded-full px-1 text-3xs font-bold tabular-nums">
            <img src="/madrid-ball.svg" alt="" className="size-3" />
            {goals > 1 ? goals : null}
          </span>
        ) : null}
      </span>
      <span className="squad-name mt-1 max-w-full truncate rounded-md px-1.5 py-0.5 text-xs font-bold">
        <span className="mr-1 opacity-70">{position}</span>
        {title}
      </span>
      {tasks.length ? (
        <span className="squad-tasks mt-1 flex max-w-full flex-col gap-0.5 rounded-md px-1.5 py-1 text-left text-3xs leading-tight">
          {tasks.slice(0, 2).map((t) => (
            <span key={t.id} className="line-clamp-2">
              {t.number ? <span className="font-mono opacity-70">#{t.number} </span> : null}
              {t.title}
            </span>
          ))}
          {tasks.length > 2 ? <span className="opacity-70">+{tasks.length - 2} more</span> : null}
        </span>
      ) : (
        <span className={cn('mt-0.5 text-3xs font-medium', STATUS_TEXT[key], 'squad-status')}>{statusLabel(s)}</span>
      )}
    </button>
  )
}

function BenchPlayer({ session: s, tasks, picked, onPick }: { session: Session; tasks: Task[]; picked: boolean; onPick: () => void }) {
  const { title } = useSessionTitle(s)
  const key = statusMeta(s.status).key
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => startDrag(e, sessionKey(s))}
      onClick={onPick}
      aria-pressed={picked}
      className={cn(
        'flex cursor-grab items-start gap-2.5 rounded-[0.875rem] bg-card px-3 py-2.5 text-left shadow-float outline-none hover:shadow-float-hover focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing',
        picked && 'ring-2 ring-primary',
      )}
    >
      <Jersey playerKey={sessionKey(s)} always numbered className="size-8" />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <StatusDot status={s.status} className="size-2" />
          <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
        </span>
        <span className={cn('block truncate text-xs', STATUS_TEXT[key])}>{statusLabel(s)}</span>
        {tasks.length ? <span className="mt-0.5 block truncate text-xs text-muted-foreground">{tasks.map((t) => (t.number ? `#${t.number} ${t.title}` : t.title)).join(' · ')}</span> : null}
      </span>
    </button>
  )
}

function FreeAgent({ legend, picked, onPick }: { legend: Legend; picked: boolean; onPick: () => void }) {
  const [number, name] = legend
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => startDrag(e, `${LEGEND}${number}`)}
      onClick={onPick}
      aria-pressed={picked}
      title={`Sign ${name}: start a new session`}
      className={cn(
        'flex cursor-grab items-center gap-2 rounded-[0.875rem] bg-card px-2.5 py-2 text-left shadow-float outline-none hover:shadow-float-hover focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing',
        picked && 'ring-2 ring-primary',
      )}
    >
      <Portrait legend={legend} numbered className="size-8 opacity-80" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{name}</span>
        <span className="block text-3xs text-dimmer tabular-nums">#{number} · free agent</span>
      </span>
    </button>
  )
}

function PitchLines() {
  return (
    <svg viewBox="0 0 68 105" preserveAspectRatio="none" aria-hidden className="pointer-events-none absolute inset-0 size-full" fill="none" stroke="currentColor" strokeWidth="0.35">
      <rect x="2" y="2" width="64" height="101" />
      <path d="M2 52.5h64" />
      <circle cx="34" cy="52.5" r="9.15" />
      <circle cx="34" cy="52.5" r="0.5" fill="currentColor" />
      <path d="M13.85 2v16.5h40.3V2M13.85 103V86.5h40.3V103" />
      <path d="M24.85 2v5.5h18.3V2M24.85 103v-5.5h18.3V103" />
      <path d="M26.7 18.5a9.15 9.15 0 0 0 14.6 0M26.7 86.5a9.15 9.15 0 0 1 14.6 0" />
      <path d="M30.35 2V0.6h7.3V2M30.35 103v1.4h7.3V103" />
    </svg>
  )
}
