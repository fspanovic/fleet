import { useEffect, useRef, useState } from 'react'
import { XIcon } from 'lucide-react'

import { InBottomLeft, STACK_MOVED } from '@/components/CornerStack'
import { useMadrid } from '@/components/Madrid'
import { useFleet } from '@/hooks/useFleet'
import { allSessions } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { sessionTitle } from '@/lib/title'
import { cn } from '@/lib/utils'

const CALL_EVENT = 'fleet:simeone'
const SHOW_MS = 8000
/** Moved in the stack (the substitution board below him walked off and he glided down), he stays at least this long after. */
const SETTLED_MS = 2500
/** His exit (`.madrid-simeone-leaving`) before he unmounts. */
const EXIT_MS = 400

interface Loss {
  id: number
  who: string[]
  leaving?: boolean
}

/** Simeone cries over `who` (the Settings test button). */
export const callSimeone = (who: string[] = ['test']) => window.dispatchEvent(new CustomEvent(CALL_EVENT, { detail: who }))

/**
 * Madrid: a session gone from a host that still answers (it ended, or you deleted it) → a crying Simeone at the
 * bottom left, "We lost again", for a few seconds. Sessions lost together cry once.
 */
export function SimeoneAlert() {
  const madrid = useMadrid()
  const { fleet } = useFleet()
  const [loss, setLoss] = useState<Loss | null>(null)
  const prev = useRef<{ hosts: Map<string, Set<string>>; titles: Map<string, string> } | null>(null)

  useEffect(() => {
    const call = (e: Event) => setLoss({ id: Date.now(), who: (e as CustomEvent<string[]>).detail })
    window.addEventListener(CALL_EVENT, call)
    return () => window.removeEventListener(CALL_EVENT, call)
  }, [])

  useEffect(() => {
    if (!fleet) return
    const hosts = new Map<string, Set<string>>()
    for (const h of fleet.hosts ?? []) if (h.ok) hosts.set(h.name, new Set())
    const titles = new Map<string, string>()
    for (const s of allSessions(fleet)) {
      hosts.get(s.host)?.add(sessionKey(s))
      titles.set(sessionKey(s), sessionTitle(s))
    }
    const before = prev.current
    prev.current = { hosts, titles }
    if (!before || !madrid) return
    const who: string[] = []
    for (const [host, keys] of before.hosts) {
      const now = hosts.get(host)
      if (!now) continue
      for (const k of keys) if (!now.has(k)) who.push(before.titles.get(k) ?? k)
    }
    if (who.length) setLoss({ id: Date.now(), who })
  }, [fleet, madrid])

  const leave = (id: number) => setLoss((l) => (l?.id === id ? { ...l, leaving: true } : l))
  const id = loss?.id
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (id === undefined) return
    let until = Date.now() + SHOW_MS
    const moved = (e: Event) => {
      until = Math.max(until, Date.now() + (e as CustomEvent<number>).detail + SETTLED_MS)
    }
    const el = root.current
    el?.addEventListener(STACK_MOVED, moved)
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      const left = until - Date.now()
      if (left > 0) t = setTimeout(tick, left)
      else leave(id)
    }
    t = setTimeout(tick, SHOW_MS)
    return () => {
      clearTimeout(t)
      el?.removeEventListener(STACK_MOVED, moved)
    }
  }, [id])

  useEffect(() => {
    if (!loss?.leaving) return
    const { id } = loss
    const t = setTimeout(() => setLoss((l) => (l?.id === id ? null : l)), EXIT_MS)
    return () => clearTimeout(t)
  }, [loss])

  if (!madrid || !loss) return null
  const [first, ...more] = loss.who
  return (
    <InBottomLeft>
      <div
        key={loss.id}
        ref={root}
        className={cn('madrid-simeone pointer-events-none order-first -mb-4 -ml-2 flex items-end', loss.leaving && 'madrid-simeone-leaving')}
        role="status"
      >
        <div className="madrid-simeone-sob relative z-10 mb-3 size-48 shrink-0 overflow-hidden rounded-full border-4 border-primary bg-popover shadow-overlay">
          <img
            src="/simeone.jpg"
            alt="Diego Simeone crying"
            title="Diego Simeone · photo: Barcex, 25th Laureus World Sports Awards 2024, CC BY-SA 4.0, Wikimedia Commons"
            draggable={false}
            className="size-full object-cover select-none"
          />
          <SimeoneTears />
        </div>
        <div className="pointer-events-auto relative mb-36 -ml-4 max-w-60">
          <div className="madrid-bubble madrid-bubble-tail-left rounded-2xl bg-popover px-4 py-3 text-popover-foreground shadow-overlay">
            <span className="block text-lg leading-tight font-extrabold text-primary">We lost again…</span>
            <span className="mt-0.5 block text-sm font-semibold">kmeeeeeee 😭</span>
            <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{first}</span> {more.length ? `and ${more.length} more are` : 'is'} off the pitch.
            </span>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => leave(loss.id)}
            className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-popover text-muted-foreground shadow-overlay hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        </div>
      </div>
    </InBottomLeft>
  )
}

/** Lower lids in `simeone.jpg`'s 400×400 pixels: the tears start here. */
const EYES = [
  { x: 114, y: 217 },
  { x: 201, y: 217 },
]

/** Tears over the photo: a stream down each cheek and a drop falling from each eye. */
function SimeoneTears() {
  return (
    <svg viewBox="0 0 400 400" aria-hidden className="pointer-events-none absolute inset-0 size-full">
      {EYES.map(({ x, y }, i) => (
        <g key={x}>
          <path
            d={`M${x} ${y} q ${i ? 6 : -6} 45 ${i ? 2 : -2} 95`}
            className="madrid-simeone-stream"
            fill="none"
            stroke="#8fd3ff"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray="14 8"
          />
          <path
            d={`M${x} ${y} c 9 14 11 21 0 27 c -11 -6 -9 -13 0 -27 z`}
            className="madrid-simeone-drop"
            style={{ animationDelay: `${i * 0.55}s` }}
            fill="#a8ddff"
            stroke="#ffffff"
            strokeWidth="2.5"
          />
        </g>
      ))}
    </svg>
  )
}
