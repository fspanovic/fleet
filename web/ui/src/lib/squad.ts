// The Madrid palette's squad: which legend each live session wears, and which one a new session gets.
// A session spawned in Madrid is named `<player> <n>` (the server's counter), so its name says its legend
// on every device; the browser that spawned it also pins it.
import type { Session } from '@/api/types'
import { sessionKey } from '@/lib/shortcuts'
import { storage } from '@/lib/storage'
import { sessionTitle } from '@/lib/title'

export type Legend = readonly [number, string]

export const SQUAD: readonly Legend[] = [
  [1, 'Navas'],
  [2, 'Carvajal'],
  [3, 'Pepe'],
  [4, 'Ramos'],
  [5, 'Varane'],
  [6, 'Nacho'],
  [7, 'Ronaldo'],
  [8, 'Kroos'],
  [9, 'Benzema'],
  [10, 'Modrić'],
  [11, 'Bale'],
  [12, 'Marcelo'],
  [13, 'Casilla'],
  [14, 'Casemiro'],
  [15, 'Theo'],
  [16, 'Kovačić'],
  [17, 'Lucas Vázquez'],
  [18, 'Mariano'],
  [19, 'Achraf'],
  [20, 'Asensio'],
  [21, 'Morata'],
  [22, 'Isco'],
  [23, 'Danilo'],
  [24, 'Ceballos'],
]

/** `Lucas Vázquez 27` → `lucas-vazquez-27`. */
export const playerSlug = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const hash = (key: string) => {
  let h = 0
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

const BY_SLUG = new Map(SQUAD.map((l) => [playerSlug(l[1]), l]))

/** The legend a Madrid-named session carries in its title or tmux name (`Kovačić 27`, `kovacic-27`). */
export function legendFromNames(names: readonly (string | null | undefined)[]): Legend | null {
  for (const n of names) {
    const m = n ? /^([a-z-]+?)-\d+$/.exec(playerSlug(n)) : null
    const l = m ? BY_SLUG.get(m[1]) : undefined
    if (l) return l
  }
  return null
}

const PINS_KEY = 'fleet.squadPins'
const pinListeners = new Set<() => void>()
let pins: Record<string, number> = (() => {
  try {
    const v = JSON.parse(storage.get(PINS_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
})()

/** A session keeps the legend it was signed or spawned as. */
export function pinLegend(key: string, number: number) {
  pins = { ...pins, [key]: number }
  storage.set(PINS_KEY, JSON.stringify(pins))
  pinListeners.forEach((l) => l())
}

export const subscribePins = (l: () => void) => {
  pinListeners.add(l)
  return () => {
    pinListeners.delete(l)
  }
}
export const currentPins = () => pins

/** Each live session its own legend: pinned, else named after one, else by hash, the next free shirt on a clash (keys in a stable order). */
export function assignSquad(sessions: readonly Session[], pinned: Record<string, number>): Map<string, Legend> {
  const taken = new Set<number>()
  const out = new Map<string, Legend>()
  const sorted = sessions.map((s) => ({ key: sessionKey(s), s })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  for (const { key, s } of sorted) {
    const n = pinned[key] ?? legendFromNames([sessionTitle(s), s.tmux_session])?.[0]
    const i = SQUAD.findIndex(([x]) => x === n)
    if (i < 0 || taken.has(i)) continue
    taken.add(i)
    out.set(key, SQUAD[i])
  }
  for (const { key } of sorted) {
    if (out.has(key)) continue
    let i = hash(key) % SQUAD.length
    for (let n = 0; n < SQUAD.length && taken.has(i); n++) i = (i + 1) % SQUAD.length
    taken.add(i)
    out.set(key, SQUAD[i])
  }
  return out
}

// Legends handed to spawns that have not shown up yet (number → when): two quick spawns never get the same one.
// A claim lapses after the spawn watch would have given up, also when a newer watch replaced its own.
const claimed = new Map<number, number>()
const CLAIM_MS = 60_000

/** A new session's legend: the signed one, else the first nobody wears or is about to. Null when the squad is full. */
export function claimLegend(worn: ReadonlySet<number>, signed?: Legend | null, now = Date.now()): Legend | null {
  const held = (n: number) => now - (claimed.get(n) ?? -Infinity) < CLAIM_MS
  const l = signed ?? SQUAD.find(([n]) => !worn.has(n) && !held(n)) ?? null
  if (l) claimed.set(l[0], now)
  return l
}

/** The spawn settled: pin its session (`key`) when it showed up, and free the claim. */
export function settleLegend(legend: Legend | null | undefined, key?: string) {
  if (!legend) return
  if (key) pinLegend(key, legend[0])
  claimed.delete(legend[0])
}
