import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowLeftIcon, ArrowRightIcon, ChevronLeftIcon, RotateCcwIcon, TargetIcon, WindIcon, XIcon } from 'lucide-react'
import { useLocation } from 'wouter'

import { ScreenHeader } from '@/components/ScreenHeader'
import { Button } from '@/components/ui/button'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import {
  HITS_PER_LEVEL,
  MAX_LIVES,
  POWER_ORDER,
  POWERS,
  SHOT_PX,
  START_LIVES,
  WIND_ACCEL,
  clamp,
  comboMultiplier,
  fan,
  geometry,
  hitPoints,
  launch,
  levelOf,
  levelSpec,
  pickPower,
  powerCap,
  rollWind,
  type Aim,
  type Geometry,
  type LevelSpec,
  type PowerId,
} from '@/lib/pelt'
import { storage } from '@/lib/storage'

const BEST_KEY = 'fleet.peltBest'
const DOTS = 12
const SPLAT_MS = 4200
const PICKUP_R = 22
const KEEPER_R = 20

type Phase = 'ready' | 'playing' | 'over'
type Powers = Partial<Record<PowerId, number>>
type Shot = { el: HTMLSpanElement; x: number; y: number; vx: number; vy: number; rot: number; size: number; gold: boolean; volley: number; dead: boolean }
type Pickup = { el: HTMLSpanElement; id: PowerId; x: number; y: number; baseY: number; vx: number; t: number }
type Splat = { id: number; x: number; y: number; rot: number; scale: number }
type Hud = { phase: Phase; score: number; best: number; newBest: boolean; lives: number; streak: number; bestStreak: number; hits: number; level: number; powers: Powers; wind: number }
type Flash = { id: number; kind: 'miss' | 'power' | 'var' }

function readBest(): number {
  try {
    const n = Number(storage.get(BEST_KEY))
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

function writeBest(n: number) {
  try {
    storage.set(BEST_KEY, String(n))
  } catch {
    /* ignore */
  }
}

function newState() {
  const best = readBest()
  return {
    w: 0,
    h: 0,
    time: 0,
    phase: 'ready' as Phase,
    score: 0,
    best,
    startBest: best,
    hits: 0,
    streak: 0,
    bestStreak: 0,
    lives: START_LIVES,
    level: 1,
    // The crest: lane position, bobbing centre, direction, visibility (blink), and the twists' timers.
    tx: 0,
    cy: 0,
    dir: 1,
    alpha: 1,
    zigT: 0.8,
    blinkPhase: 0 as 0 | 1 | 2,
    blinkT: 2,
    keeperT: 0,
    keeperX: 0,
    wind: 0,
    windT: 7,
    shots: [] as Shot[],
    volleys: new Map<number, { pending: number; hit: boolean }>(),
    volleyId: 0,
    aim: null as Aim | null,
    splatId: 0,
    pickups: [] as Pickup[],
    nextPickup: 5,
    powers: {} as Powers,
    powerMax: {} as Powers,
  }
}

type Game = ReturnType<typeof newState>

const snapshot = (g: Game): Hud => ({
  phase: g.phase,
  score: g.score,
  best: g.best,
  newBest: g.score > g.startBest,
  lives: g.lives,
  streak: g.streak,
  bestStreak: g.bestStreak,
  hits: g.hits,
  level: g.level,
  powers: { ...g.powers },
  wind: g.wind,
})

/** A brown splat, left on the crest after a hit. */
function SplatMark({ splat, size }: { splat: Splat; size: number }) {
  const s = size * 0.62 * splat.scale
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden
      className="pelt-splat pointer-events-none absolute"
      style={{ width: s, height: s, left: `calc(50% + ${splat.x}px - ${s / 2}px)`, top: `calc(50% + ${splat.y}px - ${s / 2}px)`, rotate: `${splat.rot}deg` }}
    >
      <path
        fill="#6b3f1d"
        d="M20 7c3 0 4 3 6 4s6-1 7 2-2 5-1 7 4 4 2 7-5 1-7 3-1 6-5 6-3-4-5-5-6 1-7-2 2-5 1-7-4-3-3-6 5-2 6-4 2-5 6-5z"
      />
      <path fill="#8a5428" d="M18 13c2-1 5 0 6 2s-1 4-3 4-4-1-4-3 0-2 1-3z" />
      <circle cx="35" cy="8" r="2" fill="#6b3f1d" />
      <circle cx="5" cy="31" r="1.6" fill="#6b3f1d" />
      <circle cx="33" cy="34" r="1.3" fill="#6b3f1d" />
      <path fill="#6b3f1d" d="M17 32c1 0 1.4 2 1.4 4s-.6 2.6-1.4 2.6-1.4-.8-1.4-2.6.4-4 1.4-4z" />
    </svg>
  )
}

/** The power-up's icon: the golden poop is the plain one, gilded. */
function PowerIcon({ id, className = '' }: { id: PowerId; className?: string }) {
  return <span className={`leading-none ${id === 'gold' ? 'pelt-gold' : ''} ${className}`}>{POWERS[id].icon}</span>
}

/**
 * `#/pelt` (Madrid only): pelt the Barça crest with 💩. The crest runs along a lane at the top; drag back from anywhere
 * and let go to throw from the bottom (slingshot), or click to lob onto that spot. Three lives: a throw that hits nothing
 * costs one. Hits in a row build a combo multiplier, every 5 hits starts a level with a new twist (see `levelSpec`), and
 * power-ups float across for you to hit. The best score is this browser's (localStorage).
 * The loop runs on requestAnimationFrame, moves positioned DOM directly, and re-renders React only on game events; it
 * stops while the screen is gone or the tab hidden.
 */
export function PeltScreen({ layout = 'screen' }: { layout?: 'screen' | 'pane' }) {
  const pane = layout === 'pane'
  const [, navigate] = useLocation()
  const game = useRef<Game>(null as unknown as Game)
  if (!game.current) game.current = newState()
  const [hud, setHud] = useState<Hud>(() => snapshot(game.current))
  const [crestSize, setCrestSize] = useState(72)
  const [splats, setSplats] = useState<Splat[]>([])
  const [banner, setBanner] = useState(0)
  const [flash, setFlash] = useState<Flash>({ id: 0, kind: 'miss' })

  const areaRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const shotsRef = useRef<HTMLDivElement>(null)
  const pickupsRef = useRef<HTMLDivElement>(null)
  const fxRef = useRef<HTMLDivElement>(null)
  const crestRef = useRef<HTMLDivElement>(null)
  const shakeRef = useRef<HTMLDivElement>(null)
  const keeperRef = useRef<HTMLSpanElement>(null)
  const ammoRef = useRef<HTMLSpanElement>(null)
  const dotRefs = useRef<(HTMLSpanElement | null)[]>([])
  const barRefs = useRef<Partial<Record<PowerId, HTMLSpanElement | null>>>({})
  const slowTextRef = useRef<HTMLSpanElement>(null)
  const api = useRef<{ start: () => void; release: (aim: Aim) => void; newGame: (phase: Phase) => void } | null>(null)

  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    const g = game.current
    const ro = new ResizeObserver(() => {
      g.w = area.clientWidth
      g.h = area.clientHeight
      const geo = geometry(g.w, g.h)
      g.tx = g.tx ? clamp(g.tx, geo.crest / 2, g.w - geo.crest / 2) : g.w / 2
      setCrestSize(geo.crest)
    })
    ro.observe(area)
    // The mobile swipe-back listens on the screen: a drag in here is a throw, never a back.
    const stop = (e: TouchEvent) => e.stopPropagation()
    area.addEventListener('touchstart', stop, { passive: true })
    return () => {
      ro.disconnect()
      area.removeEventListener('touchstart', stop)
    }
  }, [])

  useEffect(() => {
    const g = game.current
    const timers = new Set<number>()
    const later = (fn: () => void, ms: number) => {
      const id = window.setTimeout(() => {
        timers.delete(id)
        fn()
      }, ms)
      timers.add(id)
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const publish = () => setHud(snapshot(g))
    const flashOnce = (kind: Flash['kind']) => setFlash((f) => ({ id: f.id + 1, kind }))

    /** A floating label that rises and fades: points, power-up names, "Miss", "Saved!". */
    const floatText = (text: string, x: number, y: number, className: string, size = 18) => {
      const layer = fxRef.current
      if (!layer) return
      const el = document.createElement('span')
      el.textContent = text
      el.className = `pointer-events-none absolute whitespace-nowrap font-extrabold drop-shadow-[0_1px_0_var(--background)] ${className}`
      el.style.left = `${clamp(x, 48, g.w - 48)}px`
      el.style.top = `${y}px`
      el.style.fontSize = `${size}px`
      layer.appendChild(el)
      el.animate(
        [
          { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
          { transform: 'translate(-50%, -60%) scale(1.12)', opacity: 1, offset: 0.18 },
          { transform: 'translate(-50%, calc(-50% - 42px)) scale(1)', opacity: 0 },
        ],
        { duration: 900, easing: 'ease-out' },
      ).finished.then(
        () => el.remove(),
        () => el.remove(),
      )
    }

    const shake = (mag: number) => {
      if (reducedMotion) return
      stageRef.current?.animate(
        [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${-mag}px, ${mag * 0.6}px)` },
          { transform: `translate(${mag * 0.8}px, ${-mag * 0.5}px)` },
          { transform: `translate(${-mag * 0.4}px, ${mag * 0.3}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 260, easing: 'ease-out' },
      )
    }

    const levelTo = (n: number) => {
      g.level = n
      g.wind = rollWind(levelSpec(n))
      g.windT = 7
      setBanner((b) => b + 1)
    }

    const keepBest = () => {
      if (g.score <= g.best) return
      g.best = g.score
      writeBest(g.best)
    }

    const hit = (shot: Shot, geo: Geometry, spec: LevelSpec) => {
      g.hits += 1
      g.streak += 1
      g.bestStreak = Math.max(g.bestStreak, g.streak)
      const pts = hitPoints(g.streak, shot.gold)
      g.score += pts
      keepBest()
      const level = levelOf(g.hits)
      if (level > g.level) levelTo(level)

      const id = ++g.splatId
      const r = geo.crest * 0.3
      const s = spec.scale
      setSplats((list) => [
        ...list.slice(-7),
        {
          id,
          x: clamp((shot.x - g.tx) / s, -r, r),
          y: clamp((shot.y - g.cy) / s, -r, r),
          rot: Math.random() * 360,
          scale: (shot.size > SHOT_PX ? 1.45 : 1) * (0.8 + Math.random() * 0.4),
        },
      ])
      later(() => setSplats((list) => list.filter((sp) => sp.id !== id)), SPLAT_MS)
      shakeRef.current?.animate(
        [
          { transform: 'translateX(0) rotate(0)' },
          { transform: 'translateX(-7px) rotate(-9deg)' },
          { transform: 'translateX(6px) rotate(7deg)' },
          { transform: 'translateX(-4px) rotate(-4deg)' },
          { transform: 'translateX(2px) rotate(2deg)' },
          { transform: 'translateX(0) rotate(0)' },
        ],
        { duration: 420, easing: 'ease-out' },
      )
      shake(pts >= 4 ? 6 : 3)
      floatText(`+${pts}`, g.tx, g.cy - (geo.crest * s) / 2 - 8, shot.gold ? 'pelt-gold-text' : 'text-primary', 18 + Math.min(pts, 10) * 2.4)
      publish()
    }

    const gameOver = () => {
      g.phase = 'over'
      g.aim = null
      for (const s of g.shots) s.el.remove()
      for (const p of g.pickups) p.el.remove()
      g.shots = []
      g.pickups = []
      g.volleys.clear()
      g.powers = {}
      publish()
    }

    const miss = (x: number) => {
      if (g.phase !== 'playing') return
      if (g.powers.var) {
        g.powers.var -= 1
        if (!g.powers.var) delete g.powers.var
        floatText('VAR: overturned', x, g.h - 90, 'text-primary', 17)
        flashOnce('var')
        publish()
        return
      }
      g.lives -= 1
      g.streak = 0
      floatText('Miss', x, g.h - 90, 'text-destructive', 22)
      flashOnce('miss')
      shake(4)
      if (g.lives <= 0) gameOver()
      else publish()
    }

    /** A shot is done (hit something, or left the play area); the throw costs a life once all its poops missed. */
    const resolve = (shot: Shot, hitSomething: boolean) => {
      const v = g.volleys.get(shot.volley)
      if (!v) return
      if (hitSomething) v.hit = true
      v.pending -= 1
      if (v.pending > 0) return
      g.volleys.delete(shot.volley)
      if (!v.hit) miss(shot.x)
    }

    const spawnPickup = (forced?: PowerId, x?: number, y?: number, vx?: number) => {
      const layer = pickupsRef.current
      if (!layer || !g.w) return
      const id = forced ?? pickPower(g.lives)
      const def = POWERS[id]
      const el = document.createElement('span')
      el.className =
        'pelt-pickup pointer-events-none absolute top-0 left-0 grid size-11 place-items-center rounded-full border-2 border-primary/60 bg-background/90 will-change-transform'
      el.setAttribute('aria-hidden', 'true')
      const icon = document.createElement('span')
      icon.textContent = def.icon
      icon.className = `text-[24px] leading-none ${id === 'gold' ? 'pelt-gold' : ''}`
      el.appendChild(icon)
      if (def.badge) {
        const badge = document.createElement('span')
        badge.textContent = def.badge
        badge.className = 'absolute -right-1.5 -bottom-1 rounded-full bg-primary px-1 text-[10px] leading-4 font-bold text-primary-foreground'
        el.appendChild(badge)
      }
      layer.appendChild(el)
      const fromLeft = Math.random() < 0.5
      const baseY = y ?? g.h * (0.36 + Math.random() * 0.18)
      g.pickups.push({
        el,
        id,
        x: x ?? (fromLeft ? -PICKUP_R * 2 : g.w + PICKUP_R * 2),
        y: baseY,
        baseY,
        vx: vx ?? (fromLeft ? 1 : -1) * g.w * (0.1 + Math.random() * 0.05),
        t: Math.random() * 6,
      })
    }

    const collect = (p: Pickup) => {
      g.pickups = g.pickups.filter((q) => q !== p)
      g.nextPickup = g.time + 8 + Math.random() * 6
      p.el.animate(
        [
          { transform: `translate3d(${p.x - PICKUP_R}px, ${p.y - PICKUP_R}px, 0) scale(1)`, opacity: 1 },
          { transform: `translate3d(${p.x - PICKUP_R}px, ${p.y - PICKUP_R}px, 0) scale(1.8)`, opacity: 0 },
        ],
        { duration: 320, easing: 'ease-out' },
      ).finished.then(
        () => p.el.remove(),
        () => p.el.remove(),
      )
      const def = POWERS[p.id]
      if (def.kind === 'instant') {
        if (g.lives < MAX_LIVES) {
          g.lives += 1
          floatText('🏆 +1 life', p.x, p.y - 26, 'text-primary', 18)
        } else {
          g.score += 5
          keepBest()
          floatText('🏆 +5 · cabinet full', p.x, p.y - 26, 'text-primary', 16)
        }
      } else {
        g.powers[p.id] = def.kind === 'seconds' ? def.amount : Math.min(powerCap(p.id), (g.powers[p.id] ?? 0) + def.amount)
        g.powerMax[p.id] = g.powers[p.id]
        floatText(`${def.name}!`, p.x, p.y - 26, 'text-primary', 17)
      }
      flashOnce('power')
      publish()
    }

    const step = (rdt: number) => {
      if (!g.w || !g.h) return
      const geo = geometry(g.w, g.h)
      const spec = levelSpec(g.level)

      // Bernabéu time slows the crest, the keeper and the pickups; your poops keep their real speed.
      let ts = 1
      if (g.powers.slow) {
        g.powers.slow -= rdt
        if (g.powers.slow <= 0) {
          delete g.powers.slow
          publish()
        } else ts = 0.4
      }
      const dt = rdt * ts
      g.time += dt

      if (spec.wind && g.phase === 'playing') {
        g.windT -= rdt
        if (g.windT <= 0) {
          g.wind = rollWind(spec)
          g.windT = 7
          publish()
        }
      }

      // The crest: lane run, with this level's twists on top.
      const half = geo.crest / 2
      const reachHalf = half * spec.scale
      if (spec.zigzag) {
        g.zigT -= dt
        if (g.zigT <= 0) {
          if (Math.random() < 0.75) g.dir *= -1
          g.zigT = 0.35 + Math.random() * 0.8
        }
      }
      g.tx += g.dir * g.w * 0.22 * spec.speed * dt
      if (g.tx > g.w - reachHalf) {
        g.tx = g.w - reachHalf
        g.dir = -1
      } else if (g.tx < reachHalf) {
        g.tx = reachHalf
        g.dir = 1
      }
      if (spec.blink) {
        g.blinkT -= dt
        if (g.blinkPhase === 0) {
          g.alpha = 1
          if (g.blinkT <= 0) {
            g.blinkPhase = 1
            g.blinkT = 0.22
          }
        } else if (g.blinkPhase === 1) {
          g.alpha = Math.max(0.06, g.blinkT / 0.22)
          if (g.blinkT <= 0) {
            const lo = reachHalf
            const hi = g.w - reachHalf
            let nx = lo + Math.random() * (hi - lo)
            if (Math.abs(nx - g.tx) < g.w * 0.25) nx = g.tx < g.w / 2 ? Math.min(hi, g.tx + g.w * 0.4) : Math.max(lo, g.tx - g.w * 0.4)
            g.tx = nx
            g.dir = Math.random() < 0.5 ? -1 : 1
            g.blinkPhase = 2
            g.blinkT = 0.22
          }
        } else {
          g.alpha = Math.min(1, 1 - g.blinkT / 0.22)
          if (g.blinkT <= 0) {
            g.blinkPhase = 0
            g.blinkT = 1.8 + Math.random() * 1.6
          }
        }
      } else g.alpha = 1
      g.cy = geo.ty + spec.bob * g.h * Math.sin(g.time * 2.4)
      const crest = crestRef.current
      if (crest) {
        crest.style.transform = `translate3d(${g.tx - half}px, ${g.cy - half}px, 0) scale(${spec.scale})`
        crest.style.opacity = String(g.alpha)
      }

      if (spec.keeper) {
        g.keeperT += dt * spec.keeper
        const t = g.keeperT
        g.keeperX = g.w / 2 + (g.w / 2 - 44) * (0.8 * Math.sin(1.3 * t) + 0.2 * Math.sin(3.1 * t))
        if (keeperRef.current) keeperRef.current.style.transform = `translate3d(${g.keeperX - 22}px, ${geo.keeperY - 22}px, 0)`
      }

      if (g.phase === 'playing' && !g.pickups.length && g.time >= g.nextPickup) spawnPickup()
      g.pickups = g.pickups.filter((p) => {
        p.t += dt
        p.x += p.vx * dt
        p.y = p.baseY + Math.sin(p.t * 2.2) * 10
        if (p.x < -PICKUP_R * 3 || p.x > g.w + PICKUP_R * 3) {
          p.el.remove()
          g.nextPickup = g.time + 6 + Math.random() * 6
          return false
        }
        p.el.style.transform = `translate3d(${p.x - PICKUP_R}px, ${p.y - PICKUP_R}px, 0)`
        return true
      })

      const kept = g.shots.filter((s) => {
        s.vy += geo.gravity * rdt
        s.vx += WIND_ACCEL * g.w * g.wind * rdt
        s.x += s.vx * rdt
        s.y += s.vy * rdt
        s.rot += s.vx * rdt * 0.8
        const r = s.size * 0.4
        if (!s.dead) {
          if (g.alpha > 0.5 && Math.hypot(s.x - g.tx, s.y - g.cy) < reachHalf * 0.9 + r) {
            s.el.remove()
            hit(s, geo, spec)
            resolve(s, true)
            return false
          }
          const p = g.pickups.find((q) => Math.hypot(s.x - q.x, s.y - q.y) < PICKUP_R + r)
          if (p) {
            s.el.remove()
            collect(p)
            resolve(s, true)
            return false
          }
          if (spec.keeper && Math.hypot(s.x - g.keeperX, s.y - geo.keeperY) < KEEPER_R + r * 0.9) {
            s.dead = true
            s.vy = Math.abs(s.vy) * 0.3 + 80
            s.vx = -s.vx * 0.35
            s.el.style.opacity = '0.55'
            floatText('Saved!', g.keeperX, geo.keeperY - 34, 'text-muted-foreground', 15)
            keeperRef.current?.animate([{ scale: '1' }, { scale: '1.35' }, { scale: '1' }], { duration: 240, easing: 'ease-out' })
          }
        }
        if (s.y > g.h + s.size || s.x < -s.size * 2 || s.x > g.w + s.size * 2) {
          s.el.remove()
          resolve(s, false)
          return false
        }
        s.el.style.transform = `translate3d(${s.x - s.size / 2}px, ${s.y - s.size / 2}px, 0) rotate(${s.rot}deg)`
        return true
      })
      if (g.phase === 'over') for (const s of kept) s.el.remove()
      g.shots = g.phase === 'over' ? [] : kept

      // The power-up timers in the HUD.
      for (const id of POWER_ORDER) {
        const bar = barRefs.current[id]
        const left = g.powers[id]
        if (bar && left) bar.style.width = `${clamp(left / (g.powerMax[id] || 1), 0, 1) * 100}%`
      }
      if (slowTextRef.current && g.powers.slow) slowTextRef.current.textContent = `${Math.ceil(g.powers.slow)}s`

      // The aim: the ammo pulled back, and the dotted path it would fly (wind not included: that's the twist).
      const t = g.aim && g.phase !== 'over' ? launch(g.aim, g.w, g.h) : null
      const ammo = ammoRef.current
      if (ammo) ammo.style.transform = `translate(-50%, -50%) translate(${t ? -t.pull.x * 0.25 : 0}px, ${t ? -t.pull.y * 0.25 : 0}px)`
      dotRefs.current.forEach((dot, i) => {
        if (!dot) return
        if (!t) {
          dot.style.opacity = '0'
          return
        }
        const tt = (i + 1) * 0.055
        const x = geo.origin.x + t.vx * tt
        const y = geo.origin.y + t.vy * tt + 0.5 * geo.gravity * tt * tt
        dot.style.opacity = String(0.85 - (i / DOTS) * 0.7)
        dot.style.transform = `translate3d(${x - 3}px, ${y - 3}px, 0)`
      })
    }

    const release = (aim: Aim) => {
      if (g.phase !== 'playing' || !g.w || !g.h) return
      const { vx, vy } = launch(aim, g.w, g.h)
      const { origin } = geometry(g.w, g.h)
      const gold = !!g.powers.gold
      const big = !!g.powers.big
      const triple = !!g.powers.triple
      for (const id of ['gold', 'big', 'triple'] as const) {
        if (!g.powers[id]) continue
        g.powers[id] -= 1
        if (!g.powers[id]) delete g.powers[id]
      }
      const size = big ? Math.round(SHOT_PX * 1.7) : SHOT_PX
      const throws = triple ? fan(vx, vy) : [{ vx, vy }]
      const volley = ++g.volleyId
      g.volleys.set(volley, { pending: throws.length, hit: false })
      for (const v of throws) {
        const el = document.createElement('span')
        el.textContent = '💩'
        el.className = `pointer-events-none absolute top-0 left-0 grid place-items-center leading-none will-change-transform ${gold ? 'pelt-gold' : ''}`
        el.style.width = el.style.height = `${size}px`
        el.style.fontSize = `${size - 4}px`
        el.style.transform = `translate3d(${origin.x - size / 2}px, ${origin.y - size / 2}px, 0)`
        shotsRef.current?.appendChild(el)
        g.shots.push({ el, x: origin.x, y: origin.y, vx: v.vx, vy: v.vy, rot: 0, size, gold, volley, dead: false })
      }
      publish()
    }

    const start = () => {
      if (g.phase !== 'ready') return
      g.phase = 'playing'
      g.nextPickup = g.time + 5
      publish()
    }

    const newGame = (phase: Phase) => {
      for (const s of g.shots) s.el.remove()
      for (const p of g.pickups) p.el.remove()
      g.shots = []
      g.pickups = []
      g.volleys.clear()
      g.aim = null
      Object.assign(g, {
        phase,
        score: 0,
        startBest: g.best,
        hits: 0,
        streak: 0,
        bestStreak: 0,
        lives: START_LIVES,
        level: 1,
        alpha: 1,
        blinkPhase: 0,
        blinkT: 2,
        wind: 0,
        windT: 7,
        powers: {},
        powerMax: {},
        nextPickup: g.time + 5,
      })
      setSplats([])
      publish()
    }

    api.current = { start, release, newGame }

    // A test hook for driving the game from a headless browser; only there when the page set `__peltTest` first.
    const testWindow = window as unknown as { __peltTest?: boolean; __pelt?: unknown }
    if (testWindow.__peltTest) {
      testWindow.__pelt = {
        spawn: (id: PowerId, x: number, y: number, vx = 0) => spawnPickup(id, x, y, vx),
        level: (n: number) => {
          g.hits = Math.max(g.hits, (n - 1) * HITS_PER_LEVEL)
          levelTo(n)
          publish()
        },
        state: () => ({ ...snapshot(g), tx: g.tx, cy: g.cy, dir: g.dir, alpha: g.alpha, w: g.w, h: g.h, pickups: g.pickups.length, shots: g.shots.length }),
      }
    }

    let raf = 0
    let last = 0
    const frame = (now: number) => {
      const dt = last ? Math.min((now - last) / 1000, 0.05) : 0
      last = now
      step(dt)
      raf = requestAnimationFrame(frame)
    }
    const resume = () => {
      if (raf || document.hidden) return
      last = 0
      raf = requestAnimationFrame(frame)
    }
    const pause = () => {
      cancelAnimationFrame(raf)
      raf = 0
    }
    const onVisibility = () => (document.hidden ? pause() : resume())
    document.addEventListener('visibilitychange', onVisibility)
    resume()
    return () => {
      pause()
      document.removeEventListener('visibilitychange', onVisibility)
      for (const id of timers) window.clearTimeout(id)
      timers.clear()
      for (const s of g.shots) s.el.remove()
      for (const p of g.pickups) p.el.remove()
      g.shots = []
      g.pickups = []
      g.volleys.clear()
      api.current = null
      if (testWindow.__peltTest) delete testWindow.__pelt
    }
  }, [])

  const point = (e: ReactPointerEvent) => {
    const r = areaRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = game.current
    if (e.button !== 0 || g.aim || g.phase === 'over') return
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* a synthetic or already-gone pointer: the throw still works without capture */
    }
    api.current?.start()
    const p = point(e)
    g.aim = { id: e.pointerId, sx: p.x, sy: p.y, x: p.x, y: p.y }
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const aim = game.current.aim
    if (!aim || aim.id !== e.pointerId) return
    const p = point(e)
    aim.x = p.x
    aim.y = p.y
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = game.current
    const aim = g.aim
    if (!aim || aim.id !== e.pointerId) return
    g.aim = null
    const p = point(e)
    aim.x = p.x
    aim.y = p.y
    api.current?.release(aim)
  }
  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (game.current.aim?.id === e.pointerId) game.current.aim = null
  }

  const spec = levelSpec(hud.level)
  const windArrows = Math.max(1, Math.min(3, Math.ceil(Math.abs(hud.wind) / 0.45)))
  const WindArrow = hud.wind < 0 ? ArrowLeftIcon : ArrowRightIcon
  const activePowers = POWER_ORDER.filter((id) => hud.powers[id])

  const arena = (
    <div
      ref={areaRef}
      role="application"
      aria-label="Pelt Barça: drag back and let go to throw, or click to lob"
      className={`pelt-arena relative size-full touch-none overflow-hidden rounded-2xl bg-card shadow-pane select-none ${hud.phase === 'over' ? '' : 'cursor-crosshair'}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div ref={stageRef} className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-6 top-[22%] border-t-2 border-dashed border-primary/15" />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-primary/8 to-transparent" />
        {spec.keeper ? <div className="absolute inset-x-6 top-[52%] border-t border-dotted border-primary/15" /> : null}

        {spec.wind && hud.wind
          ? [14, 31, 47, 63, 79].map((top, i) => (
              <span
                key={top}
                aria-hidden
                data-dir={hud.wind < 0 ? 'left' : 'right'}
                className="pelt-wind-streak"
                style={{ top: `${top}%`, animationDuration: `${(2.6 / Math.max(0.3, Math.abs(hud.wind))).toFixed(2)}s`, animationDelay: `${-i * 0.53}s` }}
              />
            ))
          : null}

        <div ref={crestRef} className="absolute top-0 left-0 will-change-transform" style={{ width: crestSize, height: crestSize, transform: 'translate3d(-200px, 0, 0)' }}>
          <div ref={shakeRef} className="relative size-full">
            <img src="/barca-crest.svg" alt="" draggable={false} className="size-full object-contain drop-shadow-[0_6px_10px_rgb(0_0_0/0.25)]" />
            {splats.map((s) => (
              <SplatMark key={s.id} splat={s} size={crestSize} />
            ))}
          </div>
        </div>

        {spec.keeper ? (
          <span
            ref={keeperRef}
            aria-hidden
            className="absolute top-0 left-0 grid size-11 place-items-center text-[34px] leading-none drop-shadow-[0_4px_6px_rgb(0_0_0/0.25)] will-change-transform"
            style={{ transform: 'translate3d(-200px, 0, 0)' }}
          >
            🧤
          </span>
        ) : null}

        <div ref={pickupsRef} className="absolute inset-0" />

        {Array.from({ length: DOTS }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              dotRefs.current[i] = el
            }}
            className="absolute top-0 left-0 size-1.5 rounded-full bg-primary opacity-0"
          />
        ))}

        <div className="absolute left-1/2" style={{ bottom: 'clamp(44px, 10%, 72px)', transform: 'translate(-50%, 50%)' }}>
          <span className="block size-14 rounded-full border-2 border-dashed border-primary/45 bg-background/60" />
          <span
            ref={ammoRef}
            className={`absolute top-1/2 left-1/2 leading-none transition-[font-size] ${hud.powers.gold ? 'pelt-gold' : ''}`}
            style={{ transform: 'translate(-50%, -50%)', fontSize: hud.powers.big ? 38 : 26 }}
          >
            💩
          </span>
          {hud.powers.triple ? (
            <span className="absolute -top-1 -right-2 rounded-full bg-primary px-1 text-[10px] leading-4 font-bold text-primary-foreground">×3</span>
          ) : null}
        </div>

        <div ref={shotsRef} className="absolute inset-0" />
        <div ref={fxRef} className="absolute inset-0" />
      </div>

      {hud.powers.slow ? <div aria-hidden className="pelt-slowmo pointer-events-none absolute inset-0 rounded-2xl" /> : null}
      {flash.id ? <div key={flash.id} aria-hidden className={`pelt-flash pelt-flash-${flash.kind} pointer-events-none absolute inset-0 rounded-2xl`} /> : null}

      <div className="pointer-events-none absolute top-3 left-4 flex flex-col">
        <span className="text-4xl leading-none font-extrabold text-primary tabular-nums" aria-live="polite" aria-label={`Score ${hud.score}`}>
          {hud.score}
        </span>
        <span className="mt-1 text-xs font-medium text-muted-foreground tabular-nums">Best {hud.best}</span>
        <div className="mt-2 flex items-center gap-1" role="img" aria-label={`${hud.lives} ${hud.lives === 1 ? 'life' : 'lives'} left`}>
          {Array.from({ length: Math.max(START_LIVES, hud.lives) }, (_, i) => (
            <img
              key={`${i}-${i < hud.lives}`}
              src="/real-madrid-crest.svg"
              alt=""
              draggable={false}
              className={i < hud.lives ? 'pelt-pop h-5 w-auto drop-shadow-[0_1px_1.5px_rgb(0_0_0/0.25)]' : 'pelt-life-out h-5 w-auto opacity-25 grayscale'}
            />
          ))}
        </div>
      </div>

      <div className="pointer-events-none absolute top-3 right-4 flex flex-col items-end gap-1">
        <span className="rounded-full border border-border bg-background/70 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">Level {hud.level}</span>
        <span className="max-w-40 truncate text-[11px] font-medium text-muted-foreground/80">{spec.name}</span>
        {spec.wind && hud.wind ? (
          <span
            className="mt-0.5 flex items-center gap-1 rounded-full border border-border bg-background/80 px-2 py-0.5 text-xs font-semibold text-muted-foreground"
            aria-label={`Wind ${hud.wind < 0 ? 'to the left' : 'to the right'}, strength ${windArrows}`}
          >
            <WindIcon className="size-3.5" />
            <span className="flex text-primary">
              {Array.from({ length: windArrows }, (_, i) => (
                <WindArrow key={i} className="-mx-0.5 size-3.5" strokeWidth={2.75} />
              ))}
            </span>
          </span>
        ) : null}
      </div>

      {activePowers.length ? (
        <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1.5">
          {activePowers.map((id) => {
            const def = POWERS[id]
            const left = hud.powers[id] ?? 0
            return (
              <div key={id} className="pelt-pop flex w-44 max-w-[42vw] flex-col gap-1 rounded-xl border border-border bg-background/85 px-2 py-1.5 shadow-sm">
                <div className="flex items-center gap-1.5 text-xs font-semibold">
                  <PowerIcon id={id} className="text-base" />
                  <span className="min-w-0 flex-1 truncate">{def.name}</span>
                  <span ref={id === 'slow' ? slowTextRef : undefined} className="text-muted-foreground tabular-nums">
                    {def.kind === 'seconds' ? `${Math.ceil(left)}s` : def.kind === 'charges' ? `${left}×` : `${left} left`}
                  </span>
                </div>
                <span className="h-1 overflow-hidden rounded-full bg-primary/15">
                  <span
                    ref={(el) => {
                      barRefs.current[id] = el
                    }}
                    className="block h-full rounded-full bg-primary"
                    style={{ width: '100%' }}
                  />
                </span>
              </div>
            )
          })}
        </div>
      ) : null}

      {hud.streak >= 2 && hud.phase === 'playing' ? (
        <div key={hud.streak} className="pelt-pop pointer-events-none absolute right-4 bottom-3 flex flex-col items-end" aria-live="polite">
          <span className="text-3xl leading-none font-extrabold text-primary tabular-nums">×{comboMultiplier(hud.streak)}</span>
          <span className="text-xs font-medium text-muted-foreground tabular-nums">{hud.streak} in a row</span>
        </div>
      ) : null}

      {banner ? (
        <div key={banner} className="pelt-banner pointer-events-none absolute inset-x-0 top-[36%] flex justify-center px-4">
          <div className="flex flex-col items-center rounded-2xl bg-background/80 px-5 py-2.5 text-center shadow-sm backdrop-blur-sm">
            <span className="text-[11px] font-bold tracking-[0.2em] text-muted-foreground uppercase">Level {spec.level}</span>
            <span className="text-2xl font-extrabold tracking-(--tracking-display) text-primary">{spec.name}</span>
            <span className="text-sm font-medium text-foreground/80">{spec.twist}</span>
          </div>
        </div>
      ) : null}

      {hud.phase === 'ready' ? (
        <div className="pointer-events-none absolute inset-x-4 top-[33%] mx-auto max-w-xs rounded-2xl border border-border bg-background/90 p-4 shadow-pane backdrop-blur-sm">
          <p className="text-center text-lg font-extrabold tracking-(--tracking-display) text-primary">Pelt the crest</p>
          <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
            <li>🎯 Drag back and let go, or click to lob</li>
            <li>🤍 {START_LIVES} lives: a throw that hits nothing costs one</li>
            <li>🔥 Hits in a row multiply your points</li>
            <li>✨ Hit the floating power-ups with a poop</li>
            <li>⚽ Every {HITS_PER_LEVEL} hits: a new level, a new twist</li>
          </ul>
          <p className="mt-3 text-center text-xs font-semibold text-foreground">Throw to kick off</p>
        </div>
      ) : null}

      {hud.phase === 'over' ? (
        <div className="absolute inset-0 grid place-items-center bg-background/55 backdrop-blur-[2px]" onPointerDown={(e) => e.stopPropagation()}>
          <div className="pelt-pop w-[min(20rem,calc(100%-2rem))] rounded-2xl border border-border bg-card p-5 text-center shadow-pane">
            <p className="text-[11px] font-bold tracking-[0.2em] text-muted-foreground uppercase">Full time</p>
            <p className="mt-1 text-5xl leading-none font-extrabold text-primary tabular-nums">{hud.score}</p>
            {hud.newBest ? (
              <p className="mt-2 inline-block rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-primary-foreground">New best!</p>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground tabular-nums">Best {hud.best}</p>
            )}
            <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-background/60 py-2 text-center">
              <div>
                <dt className="text-[11px] text-muted-foreground">Level</dt>
                <dd className="text-lg font-bold tabular-nums">{hud.level}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Hits</dt>
                <dd className="text-lg font-bold tabular-nums">{hud.hits}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-muted-foreground">Best combo</dt>
                <dd className="text-lg font-bold tabular-nums">{hud.bestStreak}</dd>
              </div>
            </dl>
            <Button className="mt-5 w-full" size="lg" autoFocus onClick={() => api.current?.newGame('playing')}>
              <RotateCcwIcon /> Play again
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )

  const back = () => {
    if (!pane && window.history.length > 1) window.history.back()
    else navigate('/', { replace: !pane })
  }
  const screenRef = useRef<HTMLDivElement>(null)
  useSwipeBack(screenRef, back, !pane)

  const title = (
    <>
      <TargetIcon className="size-4 text-muted-foreground" /> Pelt Barça
    </>
  )
  const resetButton = (
    <Button variant="ghost" size="sm" onClick={() => api.current?.newGame('ready')} disabled={hud.phase === 'ready'} className="text-muted-foreground">
      <RotateCcwIcon /> Restart
    </Button>
  )

  if (pane) {
    return (
      <section aria-label="Pelt Barça" className="flex h-full min-w-0 flex-1 flex-col bg-background">
        <header data-tauri-drag-region="deep" className="titlebar titlebar-lead flex shrink-0 items-center gap-2 py-2 pr-3 pl-5 [--titlebar-pad:1.25rem]">
          <h1 className="flex shrink-0 items-center gap-2 text-lg font-bold tracking-(--tracking-display)">{title}</h1>
          <div className="ml-auto flex items-center gap-3">{resetButton}</div>
          <Button variant="ghost" size="icon" aria-label="Close" title="Close (Esc)" onClick={() => navigate('/')} className="size-9 shrink-0 rounded-full text-muted-foreground">
            <XIcon className="size-5" />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 justify-center px-6 pt-2 pb-6">
          <div className="h-full w-full max-w-3xl">{arena}</div>
        </div>
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
          {resetButton}
        </div>
      </ScreenHeader>
      <div className="mx-auto flex w-full max-w-lg flex-col px-gutter pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="h-[72vh]">{arena}</div>
      </div>
    </div>
  )
}
