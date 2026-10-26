import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import type { PullRequest, Session } from '@/api/types'
import { InBottomLeft } from '@/components/CornerStack'
import { Portrait, useMadrid, useSquad, type Legend } from '@/components/Madrid'
import { callMourinho } from '@/components/MourinhoAlert'
import { useFleet } from '@/hooks/useFleet'
import { usePrs } from '@/hooks/usePrs'
import { prRef } from '@/lib/prs'
import { allSessions, sessionHref, statusMeta } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { storage } from '@/lib/storage'
import { sessionTitle } from '@/lib/title'
import { cn } from '@/lib/utils'

const MATCH_KEY = 'fleet.match'
const EVENT = 'fleet:madrid'
const GOAL_MS = 4200
const SUB_MS = 4800
/** The substitution board's exit (`.madrid-sub-leaving`), the tail end of `SUB_MS`. */
const SUB_EXIT_MS = 400

/** Today's match: CI turning green on a PR is a goal for Real Madrid (credited to the PR's sessions), red one for the Bugs. */
export interface Match {
  day: string
  home: number
  away: number
  goals: Record<string, number>
}

type Goal = { kind: 'goal'; legend: Legend | null; who: string; what: string }
type Sub = { kind: 'sub'; out: { legend: Legend; who: string }[]; in: { legend: Legend; who: string }[] }
export type MatchEvent = Goal | Sub

const today = () => new Date().toLocaleDateString('sv')
const fresh = (): Match => ({ day: today(), home: 0, away: 0, goals: {} })

const listeners = new Set<() => void>()
let match: Match = (() => {
  try {
    const v = JSON.parse(storage.get(MATCH_KEY) ?? 'null') as Match | null
    return v && v.day === today() ? v : fresh()
  } catch {
    return fresh()
  }
})()

function setMatch(next: (m: Match) => Match) {
  match = next(match.day === today() ? match : fresh())
  storage.set(MATCH_KEY, JSON.stringify(match))
  listeners.forEach((l) => l())
}

export const useMatch = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => match,
  )

/** Show a goal / substitution (the Settings test buttons; the score is left alone). */
export const showMatchEvent = (e: MatchEvent) => window.dispatchEvent(new CustomEvent(EVENT, { detail: e }))

const failing = (c: PullRequest['checks']) => c === 'failure' || c === 'error'

/** A session's PR is failing CI: it plays on with a red card. */
export function useRedCard(key: string): PullRequest | null {
  const pr = usePrs().links.bySession.get(key)
  return pr && failing(pr.checks) ? pr : null
}

/**
 * Real Madrid palette, app-wide: PR checks turning green score a goal (¡GOOOL!), turning red concede one (Mourinho
 * prefers not to speak), sessions ending / starting are substitutions on the fourth official's board.
 */
export function MadridMatch() {
  const madrid = useMadrid()
  const { fleet } = useFleet()
  const prs = usePrs()
  const squad = useSquad()
  const [shown, setShown] = useState<MatchEvent | null>(null)
  const [leaving, setLeaving] = useState(false)

  const checks = useRef<{ host: string | null; byRef: Map<string, PullRequest['checks']> } | null>(null)
  const squadRef = useRef(squad)
  squadRef.current = squad
  const seen = useRef<Map<string, { legend: Legend; who: string }> | null>(null)

  useEffect(() => {
    const show = (e: Event) => {
      setLeaving(false)
      setShown((e as CustomEvent<MatchEvent>).detail)
    }
    window.addEventListener(EVENT, show)
    return () => window.removeEventListener(EVENT, show)
  }, [])

  useEffect(() => {
    if (!shown) return
    const ms = shown.kind === 'goal' ? GOAL_MS : SUB_MS
    // The board walks off before it unmounts, so whatever stacks above it glides down into an empty spot.
    const out = shown.kind === 'sub' ? setTimeout(() => setLeaving(true), ms - SUB_EXIT_MS) : undefined
    const t = setTimeout(() => setShown(null), ms)
    return () => {
      clearTimeout(out)
      clearTimeout(t)
    }
  }, [shown])

  useEffect(() => {
    const data = prs.data
    if (!data) return
    const byRef = new Map(data.prs.map((p) => [prRef(p), p.checks]))
    const prev = checks.current?.host === data.host ? checks.current.byRef : null
    checks.current = { host: data.host, byRef }
    if (!prev || !madrid) return
    for (const p of data.prs) {
      const was = prev.get(prRef(p))
      if (was === undefined || was === p.checks) continue
      const sessions = prs.links.byPr.get(p.url) ?? []
      const scorer = sessions[0]
      if (p.checks === 'success') {
        setMatch((m) => {
          const goals = { ...m.goals }
          for (const s of sessions) goals[sessionKey(s)] = (goals[sessionKey(s)] ?? 0) + 1
          return { ...m, home: m.home + 1, goals }
        })
        showMatchEvent({
          kind: 'goal',
          legend: scorer ? (squadRef.current.get(sessionKey(scorer)) ?? null) : null,
          who: scorer ? sessionTitle(scorer) : prRef(p),
          what: `${p.repo}#${p.number} · CI green`,
        })
      } else if (failing(p.checks) && !failing(was)) {
        setMatch((m) => ({ ...m, away: m.away + 1 }))
        callMourinho({
          key: `conceded:${prRef(p)}`,
          headline: '“I prefer not to speak.”',
          who: `${p.repo}#${p.number}`,
          line: scorer ? `CI failed — ${sessionTitle(scorer)} gets a red card.` : 'CI failed.',
          body: p.title,
          href: scorer ? sessionHref(scorer) : p.url,
        })
      }
    }
  }, [prs.data, prs.links, madrid])

  useEffect(() => {
    if (!fleet) return
    const live = new Map<string, Session>(allSessions(fleet).map((s) => [sessionKey(s), s]))
    const okHosts = new Set(fleet.hosts.filter((h) => h.ok).map((h) => h.name))
    const prev = seen.current
    const now = new Map<string, { legend: Legend; who: string }>()
    for (const [k, s] of live) {
      const legend = squadRef.current.get(k)
      if (legend) now.set(k, { legend, who: sessionTitle(s) })
    }
    seen.current = now
    if (!prev || !madrid) return
    const out = [...prev].filter(([k]) => !live.has(k) && okHosts.has(k.slice(0, k.indexOf('/')))).map(([, v]) => v)
    const into = [...now].filter(([k]) => !prev.has(k)).map(([, v]) => v)
    if (out.length || into.length) showMatchEvent({ kind: 'sub', out, in: into })
  }, [fleet, madrid])

  if (!madrid || !shown) return null
  return shown.kind === 'goal' ? <GoalOverlay goal={shown} /> : <SubBoard sub={shown} leaving={leaving} />
}

function GoalOverlay({ goal }: { goal: Goal }) {
  return (
    <div role="status" className="madrid-goal-scrim pointer-events-none fixed inset-0 z-[60] grid place-items-center">
      <div className="madrid-goal flex flex-col items-center gap-3">
        <img src="/madrid-ball.svg" alt="" className="madrid-goal-ball size-20 drop-shadow-xl" />
        <span className="madrid-goal-text text-7xl font-black tracking-tight italic">¡GOOOOL!</span>
        <span className="flex items-center gap-2 rounded-full bg-popover/95 px-4 py-2 text-popover-foreground shadow-overlay">
          {goal.legend ? <Portrait legend={goal.legend} numbered className="size-9" /> : null}
          <span className="flex flex-col leading-tight">
            <span className="text-sm font-bold">{goal.legend ? `${goal.legend[1]} · ${goal.who}` : goal.who}</span>
            <span className="text-xs text-muted-foreground">{goal.what}</span>
          </span>
        </span>
      </div>
    </div>
  )
}

function SubBoard({ sub, leaving }: { sub: Sub; leaving: boolean }) {
  return (
    <InBottomLeft>
      <div role="status" className={cn('madrid-sub pointer-events-none order-last flex items-stretch gap-3', leaving && 'madrid-sub-leaving')}>
        <div className="madrid-sub-board flex flex-col gap-1.5 rounded-lg px-4 py-3">
          {sub.out.map((p) => (
            <SubRow key={`o${p.legend[0]}`} kind="out" p={p} />
          ))}
          {sub.in.map((p) => (
            <SubRow key={`i${p.legend[0]}`} kind="in" p={p} />
          ))}
        </div>
      </div>
    </InBottomLeft>
  )
}

function SubRow({ kind, p }: { kind: 'in' | 'out'; p: { legend: Legend; who: string } }) {
  return (
    <span className="flex items-center gap-3">
      <span className={cn('madrid-sub-arrow text-xs font-black', kind === 'in' ? 'madrid-sub-in' : 'madrid-sub-out')}>{kind === 'in' ? '▲ IN' : '▼ OUT'}</span>
      <span className={cn('madrid-sub-number w-12 text-right font-mono text-3xl font-black tabular-nums', kind === 'in' ? 'madrid-sub-in' : 'madrid-sub-out')}>{p.legend[0]}</span>
      <Portrait legend={p.legend} className="size-9 ring-[#febe10]" />
      <span className="flex flex-col leading-tight text-white">
        <span className="text-sm font-bold">{p.legend[1]}</span>
        <span className="max-w-48 truncate text-xs opacity-70">{p.who}</span>
      </span>
    </span>
  )
}

/** Real Madrid 3 : 1 Bugs — today's match. */
export function Scoreboard({ className }: { className?: string }) {
  const m = useMatch()
  return (
    <span className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-fill px-3 text-sm font-semibold tabular-nums', className)} title="Today: CI turning green scores, CI turning red concedes">
      <img src="/real-madrid-crest.svg" alt="" className="h-4" />
      <span>RMA</span>
      <span className="madrid-score-digits px-0.5">
        {m.home} : {m.away}
      </span>
      <span className="text-muted-foreground">BUGS</span>
    </span>
  )
}

/** Nothing needs you and nothing is working: Carlo, eyebrow up. */
export function useQuietFleet(): boolean {
  const { fleet } = useFleet()
  const sessions = allSessions(fleet)
  return !!fleet && sessions.every((s) => !['waiting', 'busy'].includes(statusMeta(s.status).key))
}

export function Ancelotti({ className }: { className?: string }) {
  return (
    <div className={cn('madrid-ancelotti flex items-end gap-1', className)}>
      <img
        src="/ancelotti.png"
        alt="Carlo Ancelotti"
        title="Carlo Ancelotti · photo: Fotografías Archimadrid.es, CC BY 2.0, Wikimedia Commons"
        draggable={false}
        className="madrid-ancelotti-figure w-28 drop-shadow-xl select-none"
      />
      <span className="madrid-bubble-left mb-16 rounded-2xl bg-popover px-3 py-2 text-sm font-semibold text-popover-foreground shadow-overlay">
        Calma.
        <span className="block text-xs font-normal text-muted-foreground">Nothing needs you.</span>
      </span>
    </div>
  )
}
