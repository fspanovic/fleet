import { LoaderCircleIcon, SparklesIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { GroupsState } from '@/hooks/useGroups'
import { groupsStatusText } from '@/lib/groups'
import { cn } from '@/lib/utils'

/** Last-run note ("grouped 3m ago · 1 model call" / "fallback: by repo") + "Regroup now". */
export function GroupsStatus({ state, now, size = 'sm', className }: { state: GroupsState; now: number; size?: 'sm' | 'lg'; className?: string }) {
  const { groups, running, run, error } = state
  const enabled = !!groups?.enabled
  const text = error ? 'groups unavailable — by repo' : groupsStatusText(groups, now)
  const failed = !!groups?.lastRun && groups.lastRun.ok === false
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <span
        className={cn('min-w-0 truncate text-2xs tabular-nums', failed || error ? 'text-destructive' : 'text-dimmer')}
        title={groups?.lastRun?.error || groups?.lastRun?.note || (groups?.host ? `grouping runs on ${groups.host}` : undefined)}
        aria-live="polite"
      >
        {text}
      </span>
      {enabled ? (
        <Button
          variant="ghost"
          size={size === 'lg' ? 'icon' : 'sm'}
          onClick={() => void run()}
          disabled={running}
          aria-label="Regroup now"
          title="Regroup now"
          className={cn('shrink-0 text-muted-foreground hover:text-foreground', size === 'lg' ? 'size-10' : 'h-7 px-2 text-xs')}
        >
          {running ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
          {size === 'lg' ? null : 'Regroup'}
        </Button>
      ) : null}
    </span>
  )
}

/**
 * The desktop board header's quiet meta: the last grouping run and the fleet's "updated Xs ago" inline
 * from 2xl, below that in the Regroup button's tooltip (an icon button). A failure (grouping failed,
 * groups unavailable, the fleet offline) stays inline at every width, and so does "fallback: by repo"
 * when grouping is off (no button to hang it on).
 */
export function BoardMeta({ state, now, note, className }: { state: GroupsState; now: number; note: { text: string; error?: boolean }; className?: string }) {
  const { groups, running, run, error } = state
  const enabled = !!groups?.enabled
  const text = error ? 'groups unavailable — by repo' : groupsStatusText(groups, now)
  const groupsAlert = (!!groups?.lastRun && groups.lastRun.ok === false) || !!error
  const detail = groups?.lastRun?.error || groups?.lastRun?.note || (groups?.host ? `grouping runs on ${groups.host}` : '')
  return (
    <span className={cn('flex min-w-0 items-center gap-2', className)}>
      <span
        className={cn(
          'min-w-0 truncate text-2xs tabular-nums',
          groupsAlert ? 'text-destructive' : 'text-dimmer',
          !groupsAlert && enabled && 'hidden 2xl:inline',
        )}
        title={[detail, enabled ? '' : note.text].filter(Boolean).join('\n') || undefined}
        aria-live="polite"
      >
        {text}
      </span>
      {note.text ? (
        <span className={cn('min-w-0 truncate text-2xs tabular-nums', note.error ? 'text-destructive' : 'hidden text-dimmer 2xl:inline')}>{note.text}</span>
      ) : null}
      {enabled ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void run()}
              disabled={running}
              aria-label="Regroup now"
              className="shrink-0 rounded-full text-muted-foreground hover:text-foreground"
            >
              {running ? <LoaderCircleIcon className="animate-spin" /> : <SparklesIcon />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{['Regroup now', text, detail, note.text].filter(Boolean).join('\n')}</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  )
}
