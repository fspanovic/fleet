// After a spawn: poll /api/fleet until Claude registers the new session, then hand it
// over (the caller navigates to it). One watch at a time; a new spawn replaces the old one.
// A fleet body fetched elsewhere (the app's own poll) counts too: whichever shows the session first finds it.
import { api } from '@/api/client'
import type { FleetResponse, Session, SpawnResponse } from '@/api/types'
import { findSpawned } from '@/lib/sessions'

export interface SpawnWatchHandlers {
  /** Every fresh fleet body (so the list updates too). */
  onFleet: (fleet: FleetResponse) => void
  onFound: (session: Session) => void
  onTimeout: () => void
}

let current: { stop: () => void; check: (fleet: FleetResponse) => void } | null = null

/**
 * Every fleet body the app records (useFleet().applyFleet): the watched session found in the same tick
 * the list first shows it, so whatever the finder sets for it (a signed legend) is there from its first render.
 */
export function noticeFleet(fleet: FleetResponse) {
  current?.check(fleet)
}

export function watchForSpawned(
  spawned: Pick<SpawnResponse, 'host' | 'name' | 'tmuxSession'>,
  handlers: SpawnWatchHandlers,
  { intervalMs = 1500, timeoutMs = 45_000 } = {},
): () => void {
  current?.stop()
  const deadline = Date.now() + timeoutMs
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const ctl = new AbortController()

  const check = (fleet: FleetResponse) => {
    if (stopped) return
    const found = findSpawned(fleet, spawned.host, spawned)
    if (!found) return
    stop()
    handlers.onFound(found)
  }

  const tick = async () => {
    try {
      const fleet = await api.fleet({ signal: ctl.signal })
      if (stopped) return
      handlers.onFleet(fleet)
      check(fleet)
      if (stopped) return
    } catch {
      if (stopped) return // keep trying otherwise
    }
    if (Date.now() > deadline) {
      stop()
      handlers.onTimeout()
      return
    }
    timer = setTimeout(tick, intervalMs)
  }

  function stop() {
    stopped = true
    clearTimeout(timer)
    ctl.abort()
    if (current === watch) current = null
  }

  const watch = { stop, check }
  current = watch
  timer = setTimeout(tick, intervalMs)
  return stop
}
