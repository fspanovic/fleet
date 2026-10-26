import type { Session } from '@/api/types'
import { sessionStyle } from '@/lib/sessionStyle'
import { SESSION_STYLE_CHIP, TASK_COLOR } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** The label of the `web.sessionStyles` rule a session matched ("Watcher"), in its colour. Nothing for any other session. */
export function SessionStyleChip({ session, className }: { session: Pick<Session, 'style'>; className?: string }) {
  const st = sessionStyle(session)
  if (!st) return null
  return (
    <span
      style={st.vars}
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full px-2 text-2xs font-semibold whitespace-nowrap',
        st.vars ? [TASK_COLOR, SESSION_STYLE_CHIP] : 'bg-fill text-muted-foreground',
        className,
      )}
    >
      {st.label}
    </span>
  )
}
