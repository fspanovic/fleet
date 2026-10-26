import { EllipsisIcon, InboxIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { BoardColumn, GroupEdit } from '@/lib/groups'
import { cn } from '@/lib/utils'

/** The marker on the default group's header, with its tooltip. */
export function DefaultGroupMark({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span role="img" aria-label="Default group" className={cn('flex shrink-0 text-dimmer', className)}>
          <InboxIcon aria-hidden className="size-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Default group: new sessions land here</TooltipContent>
    </Tooltip>
  )
}

/** ⋯ on a group column / section header: make it the default group (new sessions land there), or unset that. */
export function GroupColumnMenu({ column: c, onEdit, className }: { column: BoardColumn; onEdit: (e: GroupEdit) => void; className?: string }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Group ${c.label}: actions`}
          onClick={(e) => e.stopPropagation()}
          className={cn('size-7 shrink-0 rounded-md text-muted-foreground', className)}
        >
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onSelect={() => onEdit({ op: 'default', id: c.isDefault ? null : c.id })}>
          <InboxIcon />
          {c.isDefault ? 'Unset default' : 'Make default'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
