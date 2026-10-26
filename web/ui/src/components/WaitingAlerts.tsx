import { useWaitingAlerts } from '@/hooks/useWaitingAlerts'

/** Mounts the app-wide "needs you" alerts (hooks/useWaitingAlerts.ts); renders nothing. */
export function WaitingAlerts({ desktop }: { desktop: boolean }) {
  useWaitingAlerts(desktop)
  return null
}
