import { useEffect, useRef, useState } from 'react'
import { XIcon } from 'lucide-react'
import { useLocation } from 'wouter'

import type { Session } from '@/api/types'
import { useMadrid } from '@/components/Madrid'
import { useFleet } from '@/hooks/useFleet'
import { isWatching, waitingAlert, waitingTransition } from '@/lib/notify'
import { allSessions, statusMeta } from '@/lib/sessions'
import { sessionKey } from '@/lib/shortcuts'
import { sessionTitle } from '@/lib/title'

const CALL_EVENT = 'fleet:mourinho'

/** What Mourinho says: a headline, a line (`who` in bold first), small print; a click goes to `href` (`#/…` path or an http URL). */
export interface MourinhoCall {
  key: string
  headline: string
  who?: string
  line: string
  body?: string
  href?: string
  /** A waiting session's call: dropped once the session stops waiting. */
  waiting?: boolean
}

/** No call: the first waiting session (else the first session) — the Settings test button. */
export const callMourinho = (call?: MourinhoCall) => window.dispatchEvent(new CustomEvent(CALL_EVENT, { detail: call }))

const waitingCall = (s: Session): MourinhoCall => {
  const alert = waitingAlert(s)
  return { key: sessionKey(s), headline: 'Hey!', who: sessionTitle(s), line: 'needs you.', body: alert.body, href: alert.path, waiting: true }
}

export function MourinhoAlert() {
  const madrid = useMadrid()
  const { fleet } = useFleet()
  const [, navigate] = useLocation()
  const [queue, setQueue] = useState<MourinhoCall[]>([])
  const initial = useRef(fleet)
  const prev = useRef<Set<string> | null>(null)
  const latest = useRef(fleet)
  const called = useRef(new Set<string>())
  latest.current = fleet

  useEffect(() => {
    const call = (e: Event) => {
      let c = (e as CustomEvent<MourinhoCall | undefined>).detail
      if (!c) {
        const sessions = allSessions(latest.current)
        const s = sessions.find((x) => statusMeta(x.status).key === 'waiting') ?? sessions[0]
        if (!s) return
        c = waitingCall(s)
      }
      called.current.add(c.key)
      setQueue((q) => [c, ...q.filter((x) => x.key !== c.key)])
    }
    window.addEventListener(CALL_EVENT, call)
    return () => window.removeEventListener(CALL_EVENT, call)
  }, [])

  useEffect(() => {
    if (!fleet || fleet === initial.current) return
    const t = waitingTransition(prev.current, fleet)
    prev.current = t.keys
    const view = { hash: window.location.hash, focused: document.hasFocus(), visible: document.visibilityState === 'visible' }
    const fresh = madrid ? t.entered.filter((s) => !isWatching(s, view)).map(waitingCall) : []
    setQueue((q) => [...q.filter((c) => !c.waiting || t.keys.has(c.key) || called.current.has(c.key)), ...fresh])
  }, [fleet, madrid])

  if (!madrid || !queue.length) return null
  const c = queue[0]
  const next = () => {
    called.current.delete(c.key)
    setQueue((q) => q.slice(1))
  }
  const open = () => {
    next()
    if (!c.href) return
    if (/^https?:/.test(c.href)) window.open(c.href, '_blank', 'noopener')
    else navigate(c.href)
  }

  return (
    <div key={c.key} className="madrid-mourinho fixed right-2 bottom-0 z-50 flex items-end" role="alert">
      <div className="relative z-10 mb-36 -mr-6 max-w-64">
        <button type="button" onClick={open} className="madrid-bubble w-full rounded-2xl bg-popover px-4 py-3 text-left text-popover-foreground shadow-overlay outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="block text-lg leading-tight font-extrabold text-primary">{c.headline}</span>
          <span className="mt-0.5 block text-sm font-semibold">
            {c.who ? <span className="break-words">{c.who} </span> : null}
            {c.line}
          </span>
          {c.body ? <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{c.body}</span> : null}
          {queue.length > 1 ? <span className="mt-1.5 block text-2xs font-medium text-dimmer">+{queue.length - 1} more on the bench</span> : null}
        </button>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={next}
          className="absolute -top-2 -left-2 grid size-6 place-items-center rounded-full bg-popover text-muted-foreground shadow-overlay hover:text-foreground"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>
      <button type="button" onClick={open} aria-label={c.who ? `Open ${c.who}` : 'Open'} className="madrid-mou-figure -mb-5 w-48 shrink-0 outline-none">
        <Mourinho />
      </button>
    </div>
  )
}

function Mourinho() {
  return (
    <img
      src="/mourinho.png"
      alt="José Mourinho"
      title="José Mourinho · photo: GlobeSoccer Awards 2012, CC BY-SA 3.0, Wikimedia Commons"
      draggable={false}
      className="w-full drop-shadow-xl select-none"
    />
  )
}
