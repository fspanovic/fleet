import { useEffect, useMemo, useRef } from 'react'
import { useLocation } from 'wouter'

import { api } from '@/api/client'
import { useFleet } from '@/hooks/useFleet'
import { usePrefs } from '@/hooks/usePrefs'
import { deliverAlert, isWatching, waitingAlert, waitingTitlePrefix, waitingTransition } from '@/lib/notify'
import { statusSummary } from '@/lib/sessions'

/** While the page is hidden the fleet poll pauses: with alerts on, this slower one keeps them coming. */
export const HIDDEN_POLL_MS = 15_000

/**
 * "Needs you" alerts for the whole app: a system notification each time a session moves into `waiting`
 * (lib/notify.ts — once per transition, not for the session open in a focused page, not for sessions
 * already waiting when the page loads), while Settings → Notifications is on. Below the desktop
 * breakpoint it also keeps the `(2) Fleet` title DesktopShell sets on desktop (Fleet.app's dock badge
 * reads it).
 */
export function useWaitingAlerts(desktop: boolean) {
  const { fleet, applyFleet } = useFleet()
  const { notifyWaiting } = usePrefs()
  const [, navigate] = useLocation()

  // The stored snapshot painted before the first poll is not news: the first live fleet is the baseline.
  const initial = useRef(fleet)
  const prev = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (!fleet || fleet === initial.current) return
    const t = waitingTransition(prev.current, fleet)
    prev.current = t.keys
    if (!notifyWaiting || !t.entered.length) return
    const view = { hash: window.location.hash, focused: document.hasFocus(), visible: document.visibilityState === 'visible' }
    for (const s of t.entered) if (!isWatching(s, view)) deliverAlert(waitingAlert(s), (path) => navigate(path))
    // Only a new fleet is a new poll; the toggle and navigate are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet])

  useEffect(() => {
    if (!notifyWaiting) return
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    const tick = async () => {
      if (document.visibilityState === 'hidden') {
        try {
          applyFleet(await api.fleet({ signal: controller.signal }))
        } catch {
          // The next visible poll reports trouble; this one stays quiet.
        }
      }
      if (!controller.signal.aborted) timer = setTimeout(tick, HIDDEN_POLL_MS)
    }
    timer = setTimeout(tick, HIDDEN_POLL_MS)
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [notifyWaiting, applyFleet])

  const waiting = useMemo(() => statusSummary(fleet).waiting, [fleet])
  useEffect(() => {
    if (!desktop) document.title = `${waitingTitlePrefix(waiting)}Fleet`
  }, [desktop, waiting])
}
