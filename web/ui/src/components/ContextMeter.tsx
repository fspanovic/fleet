import type { ContextUsage } from '@/api/types'
import { ctxLevel, ctxSummary, fmtTokens } from '@/lib/format'
import { CTX_FILL, CTX_TEXT } from '@/lib/styles'
import { cn } from '@/lib/utils'

/**
 * Context-window meter: a 4-cell-wide bar plus text, coloured by band.
 * `pct`: `62%`. `tokens`: `124k · 62%`, the count only once the nearest `@container` is ≥ 14rem.
 * `full`: `124k / 200k · 62%`, never shrunk by its neighbours (truncated only past its line's width); the session
 * header shows the model beside it (ModelChip).
 */
export function ContextMeter({
  context: c,
  variant = 'pct',
  className,
}: {
  context?: ContextUsage | null
  variant?: 'pct' | 'tokens' | 'full'
  className?: string
}) {
  if (!c || !Number.isFinite(c.pct)) return null
  const pct = Math.max(0, Math.round(c.pct))
  const level = ctxLevel(pct)
  const title = [`Context ${ctxSummary(c)}`, c.model].filter(Boolean).join(' · ')
  const used = Number.isFinite(c.used) ? fmtTokens(c.used) : null
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 tabular-nums', variant === 'full' && 'max-w-full', CTX_TEXT[level], className)}
      title={title}
      aria-label={title}
    >
      <span className="relative h-1.5 w-5 shrink-0 overflow-hidden rounded-full bg-fill-strong" aria-hidden>
        <span className={cn('absolute inset-y-0 left-0 rounded-full', CTX_FILL[level])} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      {variant === 'full' ? (
        <span className="min-w-0 truncate">{ctxSummary(c) || `${pct}%`}</span>
      ) : (
        <span>
          {variant === 'tokens' && used ? <span className="hidden @[14rem]:inline">{used} · </span> : null}
          {pct}%
        </span>
      )}
    </span>
  )
}
