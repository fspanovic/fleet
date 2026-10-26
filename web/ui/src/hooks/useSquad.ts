import { useCallback, useMemo, useSyncExternalStore } from 'react'

import { useFleet } from '@/hooks/useFleet'
import { useTheme } from '@/hooks/useTheme'
import { allSessions } from '@/lib/sessions'
import { assignSquad, claimLegend, currentPins, subscribePins, type Legend } from '@/lib/squad'

/** Every live session's legend, by session key. */
export function useSquad(): Map<string, Legend> {
  const { fleet } = useFleet()
  const pinned = useSyncExternalStore(subscribePins, currentPins)
  return useMemo(() => assignSquad(allSessions(fleet), pinned), [fleet, pinned])
}

/**
 * In Madrid, the legend a spawn starts as (sent as `player`: the server names it `<player> <n>`):
 * the signed one, else the first free. Settle it with `settleLegend` once the spawn shows up or fails.
 * Outside Madrid: null, today's naming.
 */
export function useSquadPick(): (signed?: Legend | null) => Legend | null {
  const madrid = useTheme().palette === 'madrid'
  const squad = useSquad()
  return useCallback((signed) => (madrid ? claimLegend(new Set([...squad.values()].map(([n]) => n)), signed) : null), [madrid, squad])
}
