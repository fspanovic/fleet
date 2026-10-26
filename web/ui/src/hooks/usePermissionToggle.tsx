import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2Icon, RotateCcwIcon, ShieldIcon } from 'lucide-react'
import { toast } from 'sonner'

import { api, sessionErrorMessage } from '@/api/client'
import type { Session } from '@/api/types'
import { usePermissionMode } from '@/hooks/usePermissionMode'
import { bypassUnavailable, canRestartInPlace, canSwitchMode, modeHeld, modeName, modeSwitchToast, switchTarget } from '@/lib/terminalKeys'

/** The composer's permission-mode button: props in the shape of the paperclip's (`attachProps`) + its tint. */
export interface PermissionToggle {
  'aria-label': string
  title: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
  /** `bypass`: the warning accent; `armed`: the restart waits for its second click (destructive); `plain`: muted like the paperclip. */
  tone: 'bypass' | 'armed' | 'plain'
}

/**
 * Claude's permission mode for the composer's shield button, read from the pane every 5 s while
 * `enabled` (the Chat view of a live Claude session with a usable composer). A click switches
 * bypass ↔ auto (Shift+Tab until the status line shows it, `api.switchMode`). When bypass is not
 * in the session's cycle (started without a skip-permissions flag) the button becomes the
 * two-click "Restart in bypass": the TUI ends and the same conversation resumes in the same tmux
 * pane with --dangerously-skip-permissions (`api.restartBypass`). null = no button.
 */
export function usePermissionToggle({ session: s, host, id, enabled, desktop }: { session: Session | null | undefined; host: string; id: string; enabled: boolean; desktop: boolean }): PermissionToggle | null {
  const on = enabled && !!s && canSwitchMode(s)
  const { mode, setMode, refresh } = usePermissionMode(host, id, on)
  const [working, setWorking] = useState<'switch' | 'restart' | null>(null)
  const [restartFor, setRestartFor] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const armTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(armTimer.current), [])
  const key = `${host}/${id}`

  if (!on || !s) return null

  const waiting = s.status === 'waiting'
  const target = switchTarget(mode)
  const name = mode === undefined ? 'Reading the permission mode…' : (modeName(mode) ?? 'No permission mode on screen')
  const targetName = target === 'bypass' ? 'bypass' : 'auto'

  const doSwitch = async () => {
    if (working) return
    setWorking('switch')
    try {
      const res = await api.switchMode(host, id, target)
      setMode(res.mode)
      toast.success(modeSwitchToast(res))
    } catch (err) {
      if (bypassUnavailable(err)) {
        setRestartFor(key)
        toast.error("Bypass is not in this session's ⇧Tab cycle", { description: 'It was started without a skip-permissions flag — restart it in bypass instead.' })
      } else if (modeHeld(err)) {
        toast.error('Answer the session first', { description: sessionErrorMessage(err) })
      } else {
        toast.error('Mode switch failed', { description: sessionErrorMessage(err) })
      }
      refresh()
    } finally {
      setWorking(null)
    }
  }

  const doRestart = async () => {
    if (working) return
    if (!armed) {
      setArmed(true)
      clearTimeout(armTimer.current)
      armTimer.current = setTimeout(() => setArmed(false), 5000)
      return
    }
    clearTimeout(armTimer.current)
    setArmed(false)
    setWorking('restart')
    try {
      const res = await api.restartBypass(host, id)
      setMode(res.mode ?? null)
      setRestartFor(null)
      refresh()
      toast.success(res.already ? 'Already in bypass permissions' : 'Restarted in bypass permissions', { description: res.restarted?.command ?? undefined })
    } catch (err) {
      toast.error('Restart failed', { description: sessionErrorMessage(err) })
      refresh()
    } finally {
      setWorking(null)
    }
  }

  const spinner = <Loader2Icon className="animate-spin" />

  if (restartFor === key && mode?.id !== 'bypass' && canRestartInPlace(s)) {
    const idle = s.status === 'idle'
    const label = !idle
      ? `${name} — bypass is not in its ⇧Tab cycle; a restart waits until the session is idle`
      : armed
        ? `${desktop ? 'Click' : 'Tap'} again to restart in bypass — ends the TUI (a running turn is lost) and resumes this conversation with --dangerously-skip-permissions`
        : `${name} — bypass is not in its ⇧Tab cycle; click to restart in bypass (asks again)`
    return {
      'aria-label': label,
      title: label,
      disabled: working !== null || !idle,
      onClick: () => void doRestart(),
      children: working === 'restart' ? spinner : <RotateCcwIcon />,
      tone: armed ? 'armed' : 'plain',
    }
  }

  const label = waiting
    ? `${name} — waiting on you: answer the prompt first`
    : !mode
      ? name
      : `${name} — click for ${targetName}`
  return {
    'aria-label': label,
    title: label,
    disabled: working !== null || waiting || !mode,
    onClick: () => void doSwitch(),
    children: working === 'switch' ? spinner : <ShieldIcon />,
    tone: mode?.id === 'bypass' ? 'bypass' : 'plain',
  }
}
