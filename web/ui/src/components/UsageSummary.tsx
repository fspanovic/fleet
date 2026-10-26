import { TriangleAlertIcon } from 'lucide-react'

import type { UsageLimit } from '@/api/types'
import { HostDot } from '@/components/HostBadge'
import { useFleet } from '@/hooks/useFleet'
import { useNow } from '@/hooks/useNow'
import { useUsage } from '@/hooks/useUsage'
import { relTime } from '@/lib/format'
import { USAGE_FILL, USAGE_TEXT } from '@/lib/styles'
import { compactLimits, extraUsageText, resetsLabel, shortLimitLabel, splitAccounts, usageLevel, type AccountUsage } from '@/lib/usage'
import { cn } from '@/lib/utils'

/**
 * Always-on subscription usage, a link to `#/usage`: the current account's session and weekly
 * limits (per-model weekly and extra usage only when they count), every other account on one
 * line. `rows`: one limit per row (the desktop sidebar); `strip`: two limits per row (the mobile
 * list header). Nothing until a host has answered.
 */
export function UsageSummary({ layout, className }: { layout: 'rows' | 'strip'; className?: string }) {
  const { accounts } = useUsage()
  const { fleet } = useFleet()
  const now = useNow(30_000)
  const { main, others } = splitAccounts(accounts, fleet?.self)
  if (!main) return null
  const u = main.usage
  const x = u.extra_usage?.enabled ? u.extra_usage : null
  const who = main.account?.email ?? main.account?.organization ?? 'Claude account'
  return (
    <a
      href="#/usage"
      aria-label="Usage limits"
      title={`Usage limits — ${who}`}
      className={cn('block rounded-lg text-2xs text-dimmer outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/50', className)}
    >
      <div className={cn('grid items-center gap-x-2 gap-y-1', layout === 'rows' ? 'grid-cols-[auto_minmax(2rem,1fr)_auto_auto]' : 'grid-cols-2 gap-x-4')}>
        {compactLimits(u.limits).map((l) =>
          layout === 'rows' ? <LimitRow key={`${l.kind}-${l.label}`} limit={l} now={now} /> : <LimitCell key={`${l.kind}-${l.label}`} limit={l} now={now} />,
        )}
        {x ? (
          <div className={cn('flex items-baseline gap-2', layout === 'rows' ? 'col-span-4' : 'col-span-1')}>
            <span>Extra</span>
            <span className="ml-auto truncate text-foreground tabular-nums">{extraUsageText(x)}</span>
          </div>
        ) : null}
      </div>
      {u.stale ? (
        <div className="mt-1 flex items-center gap-1 text-status-waiting">
          <TriangleAlertIcon className="size-3 shrink-0" />
          <span className="truncate">As of {relTime(Date.parse(u.fetched_at), now) || 'earlier'} ago</span>
        </div>
      ) : null}
      {others.map((a) => (
        <OtherAccount key={a.key} account={a} />
      ))}
    </a>
  )
}

function Bar({ limit: l, className }: { limit: UsageLimit; className?: string }) {
  const pct = Math.max(0, Math.round(l.percent))
  return (
    <span className={cn('relative h-1.5 overflow-hidden rounded-full bg-fill-strong', className)} aria-hidden>
      <span className={cn('absolute inset-y-0 left-0 rounded-full', USAGE_FILL[usageLevel(l)])} style={{ width: `${Math.min(100, pct)}%` }} />
    </span>
  )
}

function Pct({ limit: l }: { limit: UsageLimit }) {
  return <span className={cn('font-medium tabular-nums', USAGE_TEXT[usageLevel(l)])}>{Math.max(0, Math.round(l.percent))}%</span>
}

/** Label | bar | pct | resets — four cells of the parent grid. */
function LimitRow({ limit: l, now }: { limit: UsageLimit; now: number }) {
  const resets = resetsLabel(l.resets_at, now)
  return (
    <>
      <span className="truncate" title={l.label}>
        {shortLimitLabel(l)}
      </span>
      <Bar limit={l} className="w-full" />
      <span className="text-right">
        <Pct limit={l} />
      </span>
      <span className="text-right tabular-nums" title={resets ? `Resets ${resets}` : undefined}>
        {resets ?? ''}
      </span>
    </>
  )
}

/** One grid cell: label, bar, pct, resets on one line. */
function LimitCell({ limit: l, now }: { limit: UsageLimit; now: number }) {
  const resets = resetsLabel(l.resets_at, now)
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={resets ? `${l.label} · resets ${resets}` : l.label}>
      <span className="shrink-0">{shortLimitLabel(l)}</span>
      <Bar limit={l} className="w-8 shrink-0" />
      <Pct limit={l} />
      {resets ? <span className="min-w-0 truncate tabular-nums">{resets}</span> : null}
    </div>
  )
}

function OtherAccount({ account: a }: { account: AccountUsage }) {
  const who = a.account?.email ?? a.account?.organization ?? a.hosts.join(', ')
  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5" title={`${who} — ${a.hosts.join(', ')}`}>
      {a.hosts.map((h) => (
        <HostDot key={h} host={h} />
      ))}
      <span className="min-w-0 truncate">{who}</span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {a.usage.limits
          .filter((l) => l.kind === 'session' || l.kind === 'weekly_all')
          .map((l) => (
            <span key={l.kind}>
              {shortLimitLabel(l)} <Pct limit={l} />
            </span>
          ))}
      </span>
    </div>
  )
}
