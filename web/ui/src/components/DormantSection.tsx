import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2Icon, MoonIcon, PlayIcon } from 'lucide-react'
import { useLocation, useRoute } from 'wouter'

import type { DormantView } from '@/api/types'
import { HostBadge } from '@/components/HostBadge'
import { Button } from '@/components/ui/button'
import { useDormant } from '@/hooks/useDormant'
import { closedHref, dormantMeta, dormantTitles, previewSessionId, searchDormant } from '@/lib/dormant'
import { cn } from '@/lib/utils'

/**
 * Two clicks, like Close session / Delete stack: the first arms for 5 s ("Confirm …"), the
 * second runs `onConfirm`. For Forget and Resume all.
 */
export function ArmButton({
  children,
  confirm,
  onConfirm,
  busy = false,
  className,
  variant = 'ghost',
  size = 'sm',
  title,
}: {
  children: ReactNode
  confirm: string
  onConfirm: () => void
  busy?: boolean
  className?: string
  variant?: 'ghost' | 'outline'
  size?: 'sm' | 'lg'
  title?: string
}) {
  const [armed, setArmed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={busy}
      title={title}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        clearTimeout(timer.current)
        if (!armed) {
          setArmed(true)
          timer.current = setTimeout(() => setArmed(false), 5000)
          return
        }
        setArmed(false)
        onConfirm()
      }}
      className={cn(armed && 'text-destructive hover:text-destructive', className)}
    >
      {busy ? <Loader2Icon className="animate-spin" /> : null}
      {armed ? confirm : children}
    </Button>
  )
}

/**
 * A dormant / recently closed entry: the row itself opens its read-only chat (`#/closed/<host>/<id>`,
 * `id` = its first Claude session; null = none, the row is plain). `actions` (Resume, Forget) sit in
 * the row but never open it. `selected`: that chat is open now.
 */
export function PreviewLink({
  host,
  id,
  selected = false,
  className,
  actions,
  children,
}: {
  host: string
  id: string | null
  selected?: boolean
  className?: string
  actions: ReactNode
  children: ReactNode
}) {
  const [, navigate] = useLocation()
  const href = id ? closedHref(host, id) : null
  const open = () => {
    if (href) navigate(href)
  }
  return (
    <div
      onClick={href ? open : undefined}
      data-selected={selected || undefined}
      className={cn(
        className,
        href && 'cursor-pointer transition-colors hover:border-border hover:bg-muted/40',
        selected && 'border-solid border-ring/60 bg-muted/60',
      )}
    >
      {href ? (
        <a
          href={`#${href}`}
          title="Show its conversation (read only)"
          aria-current={selected ? 'page' : undefined}
          onClick={(e) => {
            e.stopPropagation()
            // A new tab / window keeps the browser's own handling.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
            e.preventDefault()
            open()
          }}
          className="block min-w-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {children}
        </a>
      ) : (
        children
      )}
      <div className="mt-1.5 flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {actions}
      </div>
    </div>
  )
}

/**
 * Sessions a reboot left dormant, per host: what they were (tmux name, Claude titles, panes, how
 * long ago) with Resume (brings the tmux session back and resumes its Claude sessions), Forget
 * (two clicks) and Resume all (two clicks). Nothing when no host has dormant sessions.
 * `host`: only that host (the list's host filter). `query`: the session search — only matching entries. `desktop`: the denser sidebar / board sizes.
 */
export function DormantSection({ now, host = null, query = '', desktop = false, className }: { now: number; host?: string | null; query?: string; desktop?: boolean; className?: string }) {
  const { hosts, busy, resume, resumeAll, forget } = useDormant()
  // The entry whose read-only chat is open (`#/closed/<host>/<id>`) is highlighted.
  const [previewing, pp] = useRoute('/closed/:host/:id')
  const shown = (host ? hosts.filter((h) => h.host === host) : hosts).map((h) => searchDormant(h, query)).filter((h) => h.views.length > 0)
  if (!shown.length) return null
  const size = desktop ? 'sm' : 'lg'
  return (
    <section aria-label="Dormant sessions" className={cn('flex flex-col gap-2', className)}>
      <header className="flex items-center gap-1.5 px-1 text-xs font-semibold text-muted-foreground">
        <MoonIcon className="size-3.5" />
        Dormant
        <span className="font-normal text-dimmer">· stopped by a reboot</span>
      </header>
      {shown.map((h) => (
        <div key={h.host} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 px-1">
            <HostBadge host={h.host} />
            <span className="text-xs text-dimmer tabular-nums">{h.views.length}</span>
            {h.views.length > 1 ? (
              <ArmButton
                confirm="Resume all?"
                onConfirm={() => void resumeAll(h.host)}
                busy={busy.has(`${h.host}/*`)}
                size={size}
                className="ml-auto text-muted-foreground"
                title={`Bring back every dormant session on ${h.host}`}
              >
                <PlayIcon /> Resume all
              </ArmButton>
            ) : null}
          </div>
          {h.views.map((v) => (
            <DormantRow
              key={`${v.kind}/${v.target}`}
              host={h.host}
              selected={previewing && pp.host === h.host && (v.sessions ?? []).some((x) => x?.sessionId === pp.id)}
              view={v}
              now={now}
              size={size}
              busy={busy.has(`${h.host}/${v.target}`) || busy.has(`${h.host}/*`)}
              onResume={() => void resume(h.host, v.target)}
              onForget={() => void forget(h.host, v.target)}
            />
          ))}
        </div>
      ))}
    </section>
  )
}

function DormantRow({
  host,
  selected,
  view: v,
  now,
  size,
  busy,
  onResume,
  onForget,
}: {
  host: string
  selected: boolean
  view: DormantView
  now: number
  size: 'sm' | 'lg'
  busy: boolean
  onResume: () => void
  onForget: () => void
}) {
  const titles = dormantTitles(v)
  return (
    <PreviewLink
      host={host}
      id={previewSessionId(v)}
      selected={selected}
      className="rounded-2xl bg-fill-hover px-3.5 py-2.5"
      actions={
        <>
          <ArmButton confirm="Forget?" onConfirm={onForget} busy={false} size={size} className="text-dimmer" title="Drop it without resuming">
            Forget
          </ArmButton>
          <Button type="button" variant="outline" size={size} disabled={busy} onClick={onResume} title="Recreate the tmux session and resume its Claude sessions">
            {busy ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
            Resume
          </Button>
        </>
      }
    >
      <div className="min-w-0 opacity-75">
        <p className="truncate text-sm font-semibold" title={v.name}>
          {v.name}
        </p>
        {titles && titles !== v.name ? <p className="line-clamp-2 text-xs break-words text-muted-foreground">{titles}</p> : null}
        <p className="mt-0.5 truncate text-2xs text-dimmer tabular-nums">{dormantMeta(v, now)}</p>
      </div>
    </PreviewLink>
  )
}
