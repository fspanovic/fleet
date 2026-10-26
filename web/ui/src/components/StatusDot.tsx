import { statusMeta } from '@/lib/sessions'
import { STATUS_DOT, STATUS_DOT_BACKGROUND, STATUS_DOT_MOTION } from '@/lib/styles'
import { cn } from '@/lib/utils'

export function StatusDot({ status, className }: { status: string | null | undefined; className?: string }) {
  const meta = statusMeta(status)
  return (
    <span
      role="img"
      aria-label={meta.label}
      data-status={meta.key}
      className={cn('inline-block size-2.5 shrink-0 rounded-full', STATUS_DOT_MOTION, STATUS_DOT[meta.key], meta.background && STATUS_DOT_BACKGROUND, className)}
    />
  )
}
