// "Open details" from outside the session screen (the TL;DR popover on a row, card or header):
// the caller navigates to the session and leaves a request here; the SessionScreen for that
// session consumes it and opens its Details (the desktop column, or the mobile ⋯ drawer).
// A tiny module store (useSyncExternalStore), like useStackUi.
import { useEffect, useRef, useSyncExternalStore } from 'react'

/** A request nobody consumed within this long (the navigation went elsewhere) is dropped. */
const REQUEST_TTL_MS = 10_000

let pending: { key: string; at: number } | null = null
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => void listeners.delete(l)
}
const snapshot = () => pending

/** Ask the screen of `host/id` to open its Details (now if it is shown, else once it mounts). */
export function requestDetails(host: string, id: string) {
  pending = { key: `${host}/${id}`, at: Date.now() }
  emit()
}

/** In the session screen: run `open` when Details were requested for this session. */
export function useDetailsRequest(host: string, id: string, open: () => void) {
  const key = `${host}/${id}`
  const req = useSyncExternalStore(subscribe, snapshot, snapshot)
  const openRef = useRef(open)
  useEffect(() => {
    openRef.current = open
  })
  useEffect(() => {
    if (!req || req.key !== key) return
    pending = null
    emit()
    if (Date.now() - req.at <= REQUEST_TTL_MS) openRef.current()
  }, [req, key])
}
