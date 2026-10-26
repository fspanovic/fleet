// "Needs you" alerts: which sessions just started waiting on you (pure, unit-tested in notify.test.ts),
// and how this viewer is told — Fleet.app's native notifications (`fleet://notify`), else the browser's
// Notification API. hooks/useWaitingAlerts.ts drives it from the fleet poll.
import type { FleetResponse, Session } from '@/api/types'
import { allSessions, sessionHref, statusMeta } from '@/lib/sessions'
import { sessionTitle } from '@/lib/title'

/** Settings → Notifications: system notifications when a session needs you (`'1'` / `'0'`, default on). */
export const NOTIFY_KEY = 'fleet.notifyWaiting'

const keyOf = (s: Pick<Session, 'host' | 'session_id'>) => `${s.host}/${s.session_id}`

/**
 * The `host/session_id` keys of the sessions waiting on you. A host that did not answer this time keeps
 * the keys it had in `prev`: a blip in the connection is not a transition when it comes back.
 */
export function waitingKeys(fleet: FleetResponse | null | undefined, prev: ReadonlySet<string> | null = null): Set<string> {
  const out = new Set<string>()
  for (const s of allSessions(fleet)) if (statusMeta(s.status).key === 'waiting') out.add(keyOf(s))
  if (prev) {
    const down = new Set((fleet?.hosts ?? []).filter((h) => h.ok === false).map((h) => h.name))
    for (const k of prev) {
      const host = k.slice(0, k.indexOf('/'))
      if (down.has(host)) out.add(k)
    }
  }
  return out
}

export interface WaitingTransition {
  /** The waiting set now: the `prev` of the next call. */
  keys: Set<string>
  /** Sessions that are waiting now and were not before, in fleet order. Empty on the first call (`prev` null). */
  entered: Session[]
}

/**
 * One poll's transitions into `waiting`. `prev` null = the first fleet this page has seen: it only sets
 * the baseline, so sessions already waiting when the page loads never alert. A session alerts once per
 * transition — it must leave `waiting` (or disappear) before it can alert again.
 */
export function waitingTransition(prev: ReadonlySet<string> | null, fleet: FleetResponse | null | undefined): WaitingTransition {
  const keys = waitingKeys(fleet, prev)
  if (!prev) return { keys, entered: [] }
  const entered = allSessions(fleet).filter((s) => keys.has(keyOf(s)) && !prev.has(keyOf(s)))
  return { keys, entered }
}

/** The session the viewer is looking at right now: open (`#/s/…` in `hash`) in a focused, visible page. */
export function isWatching(s: Pick<Session, 'host' | 'session_id'>, view: { hash: string; focused: boolean; visible: boolean }): boolean {
  return view.focused && view.visible && view.hash.replace(/^#/, '') === sessionHref(s)
}

export interface WaitingAlert {
  /** `<session name> needs you` */
  title: string
  /** What it waits for (`waiting_for`), else the host. */
  body: string
  /** The session's route (`/s/<host>/<id>`): a click opens it. */
  path: string
  /** One alert per session: a newer one replaces it. */
  tag: string
}

export function waitingAlert(s: Session): WaitingAlert {
  const why = typeof s.waiting_for === 'string' ? s.waiting_for.trim() : ''
  return { title: `${sessionTitle(s)} needs you`, body: why || `waiting on you · ${s.host}`, path: sessionHref(s), tag: `fleet-waiting:${keyOf(s)}` }
}

/** The `fleet://notify` link Fleet.app turns into a native notification (crates/fleet-desktop links.rs). */
export function nativeNotifyLink(a: WaitingAlert): string {
  return `fleet://notify?${new URLSearchParams({ title: a.title, body: a.body, path: a.path })}`
}

/** `(2) ` — the title prefix counting the sessions waiting on you ('' for none); Fleet.app's dock badge reads it. */
export const waitingTitlePrefix = (n: number) => (n > 0 ? `(${n}) ` : '')

/** How this viewer can be notified: Fleet.app's native notifications, the browser's, or not at all. */
export type NotifyChannel = 'native' | 'browser' | 'blocked' | 'ask' | 'none'

/** Inside a Fleet.app that takes `fleet://notify` links (its initialization script sets `data-notify`). */
export const hasNativeNotify = () => typeof document !== 'undefined' && document.documentElement.dataset.notify === 'native'

export function notifyChannel(): NotifyChannel {
  if (hasNativeNotify()) return 'native'
  if (typeof Notification === 'undefined') return 'none'
  if (Notification.permission === 'granted') return 'browser'
  return Notification.permission === 'denied' ? 'blocked' : 'ask'
}

/** Ask the browser for permission (call it from a click). Resolves to the channel afterwards. */
export async function requestNotifyPermission(): Promise<NotifyChannel> {
  if (notifyChannel() !== 'ask') return notifyChannel()
  try {
    await Notification.requestPermission()
  } catch {
    // Older Safari: callback form only; the permission stays as it was.
  }
  return notifyChannel()
}

// A navigation started before the last one was decided can cancel it: Fleet.app gets one link at a time.
const NATIVE_GAP_MS = 250
const nativeQueue: string[] = []
let nativeDraining = false
const drainNative = () => {
  const link = nativeQueue.shift()
  nativeDraining = link != null
  if (link == null) return
  window.location.assign(link)
  setTimeout(drainNative, NATIVE_GAP_MS)
}

/** Show one alert on this viewer's channel; `open` runs when it is clicked (browser — Fleet.app opens it itself). */
export function deliverAlert(a: WaitingAlert, open: (path: string) => void): boolean {
  const channel = notifyChannel()
  if (channel === 'native') {
    nativeQueue.push(nativeNotifyLink(a))
    if (!nativeDraining) drainNative()
    return true
  }
  if (channel !== 'browser') return false
  try {
    const n = new Notification(a.title, { body: a.body, tag: a.tag, icon: '/icon-192.png' })
    n.onclick = () => {
      window.focus()
      open(a.path)
      n.close()
    }
    return true
  } catch {
    // Chrome on Android only notifies from a service worker: no system notification there.
    return false
  }
}
