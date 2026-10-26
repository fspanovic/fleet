import { LayersIcon } from 'lucide-react'

import type { Session } from '@/api/types'
import { useStackLabel } from '@/hooks/useStackLabels'
import { openStackSheet } from '@/hooks/useStackUi'
import { stackHome } from '@/lib/stacks'
import { CHIP } from '@/lib/styles'
import { cn } from '@/lib/utils'

/**
 * The session's stack on a list row: layers icon + label (truncated). A click opens the Stack
 * sheet — never the row (the row is a link around it).
 */
export function StackChip({ session: s, className }: { session: Session; className?: string }) {
  const st = s.stack
  const home = stackHome(s)
  // A rename in flight shows here at once (hooks/useStackLabels.ts).
  const { label } = useStackLabel(home, st?.id, st?.label || st?.id || '')
  if (!st?.id) return null
  return (
    <button
      type="button"
      title={`Session stack: ${label}`}
      aria-label={`Session stack ${label}: open its StackBrief`}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        openStackSheet(home, st.id)
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      className={cn(
        CHIP,
        'relative max-w-[45%] min-w-0 shrink bg-primary/10 text-[color-mix(in_oklab,var(--color-primary),var(--color-foreground)_30%)]',
        'outline-none after:absolute after:-inset-1.5 hover:bg-primary/16 focus-visible:ring-2 focus-visible:ring-ring/50',
        className,
      )}
    >
      <LayersIcon className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  )
}
