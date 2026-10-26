import { CalendarClockIcon } from 'lucide-react'

import type { Session } from '@/api/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { StatusFilter } from '@/lib/sessions'
import { CHIP, CHIP_QUIET } from '@/lib/styles'
import { cn } from '@/lib/utils'

/**
 * A session started by a scheduled job (`origin`): clock icon + the job name, the run id in a
 * tooltip. Nothing for a session started by hand. Not a link — rows and cards are links already.
 */
export function JobChip({ session: s, className }: { session: Pick<Session, 'origin'>; className?: string }) {
  const o = s.origin
  if (!o?.job) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={`Started by job ${o.job}, run ${o.run}`}
          className={cn(
            CHIP,
            CHIP_QUIET,
            'max-w-[40%] min-w-0 shrink font-normal',
            className,
          )}
        >
          <CalendarClockIcon className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{o.job}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        Job {o.job} · run {o.run}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * A status filter chip's label: the "Scheduled" filter is just the job icon (the chip row is
 * crowded), every other filter its name.
 */
export function StatusFilterLabel({ filter }: { filter: StatusFilter }) {
  if (filter.id !== 'scheduled') return <>{filter.label}</>
  return (
    <>
      <CalendarClockIcon className="size-3.5" aria-hidden />
      <span className="sr-only">{filter.label}</span>
    </>
  )
}
