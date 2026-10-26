import { BotIcon } from 'lucide-react'

import type { Session } from '@/api/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { runningSubagents, subagentJob, subagentsCountLabel, subagentsTooltip } from '@/lib/subagents'
import { CHIP } from '@/lib/styles'
import { cn } from '@/lib/utils'

/**
 * The session's running subagents (`subagents`): bot icon + how many, each one's job in a tooltip
 * (and the native title, for touch). Nothing when none run. Not a link — rows and cards are links already.
 */
export function SubagentsChip({ session: s, className }: { session: Pick<Session, 'subagents'>; className?: string }) {
  const list = runningSubagents(s)
  if (!list.length) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={subagentsTooltip(list)}
          title={subagentsTooltip(list)}
          className={cn(
            CHIP,
            'gap-0.5 bg-status-busy/12 text-[color:var(--tone-status-busy,var(--status-busy))] tabular-nums',
            className,
          )}
        >
          <BotIcon className="size-3 shrink-0" aria-hidden />
          {list.length}
        </span>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-start gap-0.5">
        <span className="font-semibold">{subagentsCountLabel(list.length)}</span>
        {list.map((a) => (
          <span key={a.id} className="max-w-full truncate">
            {subagentJob(a)}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
  )
}
