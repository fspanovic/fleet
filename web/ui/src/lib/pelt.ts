// Pelt Barça (#/pelt): the game's pure rules — levels and their twists, power-ups, combo scoring and the throw physics.
// The screen (PeltScreen) owns the DOM and the loop; everything here is plain math.

export const HITS_PER_LEVEL = 5
export const START_LIVES = 3
export const MAX_LIVES = 5
export const SHOT_PX = 30
/** Wind pushes a poop sideways by this share of the arena width per second², at full strength. */
export const WIND_ACCEL = 0.3

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export type LevelSpec = {
  level: number
  name: string
  /** One line on the level banner: what this level adds. */
  twist: string
  /** Multiplier on the crest's base lane speed. */
  speed: number
  /** Vertical bobbing, as a share of the arena height (0: none). */
  bob: number
  /** Strongest wind this level can roll (0: calm). */
  wind: number
  /** Sudden direction flips. */
  zigzag: boolean
  /** Fades out and reappears somewhere else. */
  blink: boolean
  /** The crest's scale. */
  scale: number
  /** The keeper glove's speed (0: no keeper). */
  keeper: number
}

const STAGES = [
  { name: 'Kick-off', twist: 'Left, right, repeat' },
  { name: 'La Masia bounce', twist: 'The crest bobs up and down' },
  { name: 'Wind from the Camp Nou', twist: 'Wind bends every throw' },
  { name: 'Cruyff turns', twist: 'Sudden direction flips' },
  { name: 'Tiki-taka blink', twist: 'Now you see it…' },
  { name: 'Pulling the levers', twist: 'The crest shrinks' },
  { name: 'The wall', twist: 'A keeper glove guards the lane' },
]
const OVERTIME = ['Remontada', 'Extra time', 'Penalty shootout']

/** What a level plays like: each of the first seven adds one twist and keeps the earlier ones; after that it all speeds up. */
export function levelSpec(level: number): LevelSpec {
  const n = Math.max(1, Math.floor(level))
  const extra = Math.max(0, n - STAGES.length)
  const stage = extra ? { name: OVERTIME[Math.min(extra, OVERTIME.length) - 1], twist: 'Everything at once, faster' } : STAGES[n - 1]
  return {
    level: n,
    name: extra > OVERTIME.length ? `${OVERTIME[OVERTIME.length - 1]} ${extra - OVERTIME.length + 1}` : stage.name,
    twist: stage.twist,
    speed: 1 + 0.1 * (n - 1),
    bob: n >= 2 ? Math.min(0.065, 0.045 + 0.004 * extra) : 0,
    wind: n >= 3 ? Math.min(1.3, 0.75 + 0.08 * (n - 3)) : 0,
    zigzag: n >= 4,
    blink: n >= 5,
    scale: n >= 6 ? Math.max(0.6, 0.8 - 0.04 * (n - 6)) : 1,
    keeper: n >= 7 ? 1 + 0.12 * (n - 7) : 0,
  }
}

export const levelOf = (hits: number) => 1 + Math.floor(hits / HITS_PER_LEVEL)

/** A fresh wind for a level: never a dead calm once wind is on, left or right at random. */
export function rollWind(spec: LevelSpec, rand = Math.random): number {
  if (!spec.wind) return 0
  const sign = rand() < 0.5 ? -1 : 1
  return sign * spec.wind * (0.35 + 0.65 * rand())
}

export type PowerId = 'ucl' | 'gold' | 'triple' | 'slow' | 'big' | 'var'

export type PowerDef = {
  id: PowerId
  name: string
  blurb: string
  icon: string
  /** A small label on the token, for the poop-shaped ones. */
  badge?: string
  /** instant: applied on pickup · throws: lasts that many throws · seconds: a timer · charges: used up by misses. */
  kind: 'instant' | 'throws' | 'seconds' | 'charges'
  amount: number
  weight: number
}

export const POWERS: Record<PowerId, PowerDef> = {
  ucl: { id: 'ucl', name: 'La Decimoquinta', blurb: '+1 life', icon: '🏆', kind: 'instant', amount: 1, weight: 1 },
  gold: { id: 'gold', name: 'Golden poop', blurb: 'Double points', icon: '💩', badge: '×2', kind: 'throws', amount: 5, weight: 1.2 },
  triple: { id: 'triple', name: 'Triple shot', blurb: 'Three poops in a fan', icon: '💩', badge: '×3', kind: 'throws', amount: 4, weight: 1.2 },
  slow: { id: 'slow', name: 'Bernabéu time', blurb: 'Everything slows down', icon: '⏳', kind: 'seconds', amount: 7, weight: 1 },
  big: { id: 'big', name: 'Big poop', blurb: 'A much bigger poop', icon: '💩', badge: 'XL', kind: 'throws', amount: 5, weight: 1 },
  var: { id: 'var', name: 'VAR check', blurb: 'Your next miss is overturned', icon: '📺', kind: 'charges', amount: 1, weight: 0.8 },
}

export const POWER_ORDER: PowerId[] = ['gold', 'triple', 'big', 'slow', 'var']

/** The most a stacked power can hold: two pickups' worth. */
export const powerCap = (id: PowerId) => POWERS[id].amount * 2

/** Which power-up floats in next: the trophy is likelier on your last life and rarer when lives are full. */
export function pickPower(lives: number, rand = Math.random): PowerId {
  const weights = (Object.values(POWERS) as PowerDef[]).map((p) => {
    if (p.id !== 'ucl') return p.weight
    return lives <= 1 ? p.weight * 2.4 : lives >= MAX_LIVES ? p.weight * 0.4 : p.weight
  })
  let r = rand() * weights.reduce((a, b) => a + b, 0)
  const ids = Object.keys(POWERS) as PowerId[]
  for (let i = 0; i < ids.length; i++) {
    r -= weights[i]
    if (r < 0) return ids[i]
  }
  return ids[ids.length - 1]
}

/** The combo multiplier for the streak'th hit in a row: x1, x2, x2, x3, x3 … up to x5 from the 8th. */
export const comboMultiplier = (streak: number) => clamp(1 + Math.floor(streak / 2), 1, 5)

/** Points for one hit: the combo multiplier, doubled by a golden poop. */
export const hitPoints = (streak: number, gold: boolean) => comboMultiplier(streak) * (gold ? 2 : 1)

/** The play area's geometry: everything scales with its size. */
export function geometry(w: number, h: number) {
  const crest = clamp(Math.min(w, h) * 0.16, 56, 104)
  const gravity = h * 2.4
  const origin = { x: w / 2, y: h - clamp(h * 0.1, 44, 72) }
  const maxPull = clamp(h * 0.3, 90, 200)
  // A full pull throws just high enough to reach the top edge.
  const power = Math.sqrt(2 * gravity * origin.y) / maxPull
  return { crest, ty: h * 0.22, gravity, origin, maxPull, power, keeperY: h * 0.52 }
}

export type Geometry = ReturnType<typeof geometry>
export type Aim = { id: number; sx: number; sy: number; x: number; y: number }

/** The throw an aim gives: a slingshot pull (drag back, let go), or a lob onto the spot when it was only a click. */
export function launch(aim: Aim, w: number, h: number) {
  const g = geometry(w, h)
  let px = aim.sx - aim.x
  let py = aim.sy - aim.y
  const len = Math.hypot(px, py)
  if (len < 10) {
    const t = 0.75
    return { vx: (aim.x - g.origin.x) / t, vy: (aim.y - g.origin.y - 0.5 * g.gravity * t * t) / t, pull: { x: 0, y: 0 } }
  }
  if (len > g.maxPull) {
    px = (px / len) * g.maxPull
    py = (py / len) * g.maxPull
  }
  return { vx: px * g.power, vy: py * g.power, pull: { x: px, y: py } }
}

/** A triple shot's three velocities: the aimed one and one either side, fanned out by `deg`. */
export function fan(vx: number, vy: number, deg = 11): { vx: number; vy: number }[] {
  const out = [{ vx, vy }]
  for (const s of [-1, 1]) {
    const a = (s * deg * Math.PI) / 180
    out.push({ vx: vx * Math.cos(a) - vy * Math.sin(a), vy: vx * Math.sin(a) + vy * Math.cos(a) })
  }
  return out
}
