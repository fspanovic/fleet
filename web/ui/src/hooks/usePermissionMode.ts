import { useCallback, useState } from 'react'

import { api } from '@/api/client'
import type { PermissionMode } from '@/api/types'
import { usePoller } from '@/hooks/usePoller'

/**
 * Claude's permission mode for one session, read from its pane (`peek` → `mode`, the bottom 40
 * lines) every 5 s while `enabled`. `mode`: undefined until the first read, null when no mode line
 * is on screen. `setMode` takes the mode a switch answered with, `refresh` reads now.
 */
export function usePermissionMode(host: string, id: string, enabled: boolean) {
  const key = `${host}/${id}`
  const [state, setState] = useState<{ key: string; mode: PermissionMode | null | undefined }>({ key, mode: undefined })
  const refresh = usePoller(
    async (signal) => {
      const res = await api.peek(host, id, 40, { signal })
      setState({ key, mode: res.mode ?? null })
    },
    5000,
    { enabled },
  )
  const setMode = useCallback((mode: PermissionMode | null) => setState({ key, mode }), [key])
  return { mode: state.key === key ? state.mode : undefined, setMode, refresh }
}
