import { useState } from 'react'
import { Trash2Icon, TrophyIcon } from 'lucide-react'

import { usePrs } from '@/hooks/usePrs'
import { useSquad } from '@/hooks/useSquad'
import { useTheme } from '@/hooks/useTheme'
import { hash, playerSlug, SQUAD, type Legend } from '@/lib/squad'
import { cn } from '@/lib/utils'

export { pinLegend, SQUAD, type Legend } from '@/lib/squad'
export { useSquad } from '@/hooks/useSquad'

const portraitSrc = (name: string) => `/players/${playerSlug(name)}.jpg`

function useSquadPlayer(key: string): Legend {
  return useSquad().get(key) ?? SQUAD[hash(key) % SQUAD.length]
}

export function useMadrid(): boolean {
  return useTheme().palette === 'madrid'
}

export function Jersey({ playerKey, always = false, numbered = false, className }: { playerKey: string; always?: boolean; numbered?: boolean; className?: string }) {
  const madrid = useMadrid()
  const legend = useSquadPlayer(playerKey)
  const pr = usePrs().links.bySession.get(playerKey)
  if (!madrid && !always) return null
  const red = pr?.checks === 'failure' || pr?.checks === 'error'
  return (
    <span className={cn('relative inline-flex size-5 shrink-0', className)}>
      <Portrait legend={legend} numbered={numbered} className="size-full" />
      {red ? <span aria-label="Red card: CI failing" title={`Red card: ${pr.repo}#${pr.number} CI failing`} className="madrid-red-card absolute -right-[12%] -bottom-[4%]" /> : null}
    </span>
  )
}

export function Portrait({ legend, numbered = false, className }: { legend: Legend; numbered?: boolean; className?: string }) {
  const [number, name] = legend
  const src = portraitSrc(name)
  const [failed, setFailed] = useState<string | null>(null)
  if (failed === src) return <Shirt legend={legend} className={className} />
  return (
    <span
      role="img"
      aria-label={`${name}, #${number}`}
      title={`${name} · #${number}`}
      className={cn('madrid-portrait relative inline-flex size-5 shrink-0 rounded-full bg-muted ring-1 ring-primary', numbered && 'ring-2', className)}
    >
      <img src={src} alt="" draggable={false} onError={() => setFailed(src)} className="size-full rounded-full object-cover select-none" />
      {numbered ? (
        <span aria-hidden className="madrid-portrait-number absolute -bottom-1.5 left-1/2 h-3.5 min-w-3.5 -translate-x-1/2 rounded-full bg-primary px-1 text-center text-primary-foreground tabular-nums">
          {number}
        </span>
      ) : null}
    </span>
  )
}

export function Shirt({ legend: [number, name], className }: { legend: Legend; className?: string }) {
  return (
    <span role="img" aria-label={`${name}, #${number}`} title={`${name} · #${number}`} className={cn('madrid-jersey inline-flex size-5 shrink-0', className)}>
      <svg viewBox="0 0 24 24" className="size-full">
        <path
          d="M8 2.5 3.8 4.6 1.2 9.6l3.3 1.7 1.4-1.6V21.5h12.2V9.7l1.4 1.6 3.3-1.7-2.6-5L16 2.5c-.9 1.6-2.3 2.4-4 2.4s-3.1-.8-4-2.4Z"
          className="madrid-jersey-shirt"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <path d="M8 2.5c.9 1.6 2.3 2.4 4 2.4s3.1-.8 4-2.4" className="madrid-jersey-trim" fill="none" strokeWidth="1.4" />
        <path d="M1.6 8.8l3.3 1.7M22.4 8.8l-3.3 1.7" className="madrid-jersey-trim" strokeWidth="1.4" />
        <text x="12" y="17.6" textAnchor="middle" className="madrid-jersey-number" fontSize={number > 9 ? 7.5 : 9} fontWeight="800">
          {number}
        </text>
      </svg>
    </span>
  )
}

export function Pitch({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 105 68" preserveAspectRatio="xMidYMid meet" aria-hidden className={cn('madrid-pitch pointer-events-none', className)} fill="none" stroke="currentColor" strokeWidth="0.45">
      <rect x="1" y="1" width="103" height="66" rx="0.6" />
      <path d="M52.5 1v66" />
      <circle cx="52.5" cy="34" r="9.15" />
      <circle cx="52.5" cy="34" r="0.6" fill="currentColor" />
      <path d="M1 13.85h16.5v40.3H1M104 13.85H87.5v40.3H104" />
      <path d="M1 24.85h5.5v18.3H1M104 24.85h-5.5v18.3H104" />
      <circle cx="12" cy="34" r="0.5" fill="currentColor" />
      <circle cx="93" cy="34" r="0.5" fill="currentColor" />
      <path d="M17.5 26.7a9.15 9.15 0 0 1 0 14.6M87.5 26.7a9.15 9.15 0 0 0 0 14.6" />
      <path d="M1 2.5A1.5 1.5 0 0 0 2.5 1M102.5 1A1.5 1.5 0 0 0 104 2.5M1 65.5A1.5 1.5 0 0 1 2.5 67M102.5 67a1.5 1.5 0 0 1 1.5-1.5" />
    </svg>
  )
}

/** A small yellow / red card (time-wasting, sent off, CI failing). */
export function MiniCard({ tone, className }: { tone: 'yellow' | 'red'; className?: string }) {
  return <span aria-hidden className={cn('madrid-mini-card inline-block shrink-0', tone === 'red' ? 'madrid-mini-card-red' : 'madrid-mini-card-yellow', className)} />
}

/** A task's due date as a fixture: kick-off today, matchday tomorrow, added time when it is late. */
export function fixtureLabel(due: { label: string; tone: 'overdue' | 'soon' | null }, dueDate: string, now: number): string {
  const [y, m, d] = dueDate.split('-').map(Number)
  const days = Math.round((new Date(y, m - 1, d).getTime() - new Date(new Date(now).toDateString()).getTime()) / 86_400_000)
  if (days < 0) return `Added time +${-days}d`
  if (days === 0) return 'Kick-off today'
  if (days === 1) return 'Matchday tomorrow'
  return `Matchday ${due.label}`
}

/** A PR's size as how long the match runs. */
export const MATCH_LENGTH: Record<'XS' | 'S' | 'M' | 'L' | 'XL', string> = { XS: "15'", S: "45'", M: "90'", L: "120' ET", XL: 'Penalties' }

const COMPETITIONS = ['La Liga', 'Champions League', 'Copa del Rey', 'Supercopa', 'Club World Cup', 'UEFA Super Cup'] as const

/** A task group as a competition (the same group, the same competition). */
export function Competition({ name, className }: { name: string; className?: string }) {
  const comp = COMPETITIONS[hash(name) % COMPETITIONS.length]
  return (
    <span className={cn('madrid-competition inline-flex min-w-0 items-center gap-1 text-2xs font-medium', className)} title={comp}>
      <TrophyIcon aria-hidden className="madrid-stage-icon size-3 shrink-0" />
      <span className="truncate">{comp}</span>
    </span>
  )
}

const MATCH_STATE = { notStarted: 'Upcoming', started: 'In play', closed: 'FT' } as const

/** A task's workflow category as where its match is. */
export function MatchState({ category, className }: { category: keyof typeof MATCH_STATE | null; className?: string }) {
  if (!category) return null
  return <span className={cn('madrid-match-state shrink-0 rounded px-1 text-3xs font-semibold tracking-wider uppercase', `madrid-match-${category}`, className)}>{MATCH_STATE[category]}</span>
}

/** The delete icon: a bin, or in Madrid the rival's crest (into the bin with it). */
export function BinIcon({ className }: { className?: string }) {
  const madrid = useMadrid()
  if (!madrid) return <Trash2Icon className={className} />
  return <img src="/barca-crest.svg" alt="" aria-hidden draggable={false} className={cn('size-4 shrink-0 select-none', className)} />
}
