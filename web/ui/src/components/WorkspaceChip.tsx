import { FolderGit2Icon } from 'lucide-react'

import type { Session } from '@/api/types'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { workspaceHandle, workspaceTooltip } from '@/lib/workspace'
import { CHIP, CHIP_QUIET } from '@/lib/styles'
import { cn } from '@/lib/utils'

/**
 * A session in a worktree fleet made for it (`workspace`): the handle (`ballyhoo`) — the
 * worktree's folder name, kept when the title is renamed after the work — with the branch in a
 * tooltip. Nothing for any other session. Not a link — rows and cards are links already.
 */
export function WorkspaceChip({ session: s, className }: { session: Pick<Session, 'workspace'>; className?: string }) {
  const handle = workspaceHandle(s)
  if (!handle) return null
  const tip = workspaceTooltip(s)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={tip}
          className={cn(
            CHIP,
            CHIP_QUIET,
            'max-w-[40%] min-w-0 shrink font-normal',
            className,
          )}
        >
          <FolderGit2Icon className="size-3 shrink-0" />
          <span className="min-w-0 truncate">{handle}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}
