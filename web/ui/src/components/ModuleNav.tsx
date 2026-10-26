import type { ReactNode } from 'react'
import { AudioLinesIcon, CalendarClockIcon, GaugeIcon, GitPullRequestIcon, ListTodoIcon, NotebookPenIcon, NotebookTextIcon, Settings2Icon, ShirtIcon, SunriseIcon, TargetIcon } from 'lucide-react'

import { useLocation } from 'wouter'

import { useMadrid } from '@/components/Madrid'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Kbd } from '@/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useNotesHosts } from '@/hooks/useNotes'
import { useScratchpadOpen } from '@/hooks/useScratchpad'
import { useSettings } from '@/hooks/useSettings'
import { scratchpad } from '@/lib/scratchpad'
import { ariaShortcut, shortcutHint, type ShortcutAction } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'
import { screenOf } from '@/lib/viewTransition'

export type ModuleId = 'scratchpad' | 'operator' | 'squad' | 'tasks' | 'today' | 'prs' | 'notes' | 'jobs' | 'pelt' | 'usage' | 'settings'

export interface Module {
  id: ModuleId
  label: string
  icon: ReactNode
  /** A screen (`#/…`), or an action (the scratchpad panel). */
  href?: string
  run?: () => void
  hint?: ShortcutAction
  /** `work`: the modules you work in; `utility`: the helper screens (usage, settings). */
  group: 'work' | 'utility'
}

/**
 * The app's modules — the screens and panels next to the session list — in one order, for every
 * place that lists them: the desktop sidebar's module row, the collapsed rail, the mobile ⋯ menu.
 * Modules this server doesn't offer (no notes, no operator) are left out.
 */
function useModules(): Module[] {
  const notesHosts = useNotesHosts()
  const settings = useSettings()
  const madrid = useMadrid()
  const all: (Module | null)[] = [
    settings.operator ? { id: 'operator', label: 'Operator', icon: <AudioLinesIcon />, href: '#/operator', hint: 'operator', group: 'work' } : null,
    { id: 'tasks', label: 'My tasks', icon: <ListTodoIcon />, href: '#/tasks', group: 'work' },
    madrid ? { id: 'squad', label: 'Squad', icon: <ShirtIcon />, href: '#/squad', group: 'work' } : null,
    { id: 'prs', label: 'Pull requests', icon: <GitPullRequestIcon />, href: '#/prs', hint: 'prs', group: 'work' },
    { id: 'today', label: 'Today', icon: <SunriseIcon />, href: '#/today', group: 'work' },
    { id: 'scratchpad', label: 'Scratchpad', icon: <NotebookPenIcon />, run: () => (scratchpad.isOpen() ? scratchpad.hide() : scratchpad.show()), hint: 'scratchpad', group: 'work' },
    notesHosts.length ? { id: 'notes', label: 'Notes', icon: <NotebookTextIcon />, href: '#/notes', hint: 'notes', group: 'work' } : null,
    { id: 'jobs', label: 'Scheduled jobs', icon: <CalendarClockIcon />, href: '#/jobs', hint: 'jobs', group: 'work' },
    madrid ? { id: 'pelt', label: 'Pelt Barça', icon: <TargetIcon />, href: '#/pelt', group: 'work' } : null,
    { id: 'usage', label: 'Usage limits', icon: <GaugeIcon />, href: '#/usage', hint: 'usage', group: 'utility' },
    { id: 'settings', label: 'Settings', icon: <Settings2Icon />, href: '#/settings', hint: 'settings', group: 'utility' },
  ]
  return all.filter((m): m is Module => m !== null)
}

/** One icon button per module (the sidebar row, the rail), each with a tooltip: the label + its shortcut. */
export function ModuleButtons({
  size = 'icon',
  className,
  exclude = [],
  group,
  side = 'top',
}: {
  size?: 'icon' | 'icon-sm'
  className?: string
  exclude?: ModuleId[]
  /** Only this group (absent: all). */
  group?: Module['group']
  /** Where the tooltips open. */
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  const modules = useModules().filter((m) => !exclude.includes(m.id) && (!group || m.group === group))
  const scratchOpen = useScratchpadOpen()
  // The screen open in the pane: its module stays lit (the session list stays beside it).
  const [location] = useLocation()
  const screen = screenOf(location)
  return (
    <>
      {modules.map((m) => {
        const current = !!m.href && screenOf(m.href) === screen
        const hint = m.hint ? shortcutHint(m.hint) : ''
        const keys = m.hint ? ariaShortcut(m.hint) || undefined : undefined
        const cls = cn('text-dimmer hover:text-foreground', ((m.id === 'scratchpad' && scratchOpen) || current) && 'text-foreground', current && 'bg-fill', className)
        return (
          <Tooltip key={m.id}>
            <TooltipTrigger asChild>
              {m.href ? (
                <Button asChild variant="ghost" size={size} className={cls}>
                  <a href={m.href} aria-label={m.label} aria-keyshortcuts={keys} aria-current={current ? 'page' : undefined}>
                    {m.icon}
                  </a>
                </Button>
              ) : (
                <Button variant="ghost" size={size} aria-label={m.label} aria-keyshortcuts={keys} aria-pressed={m.id === 'scratchpad' ? scratchOpen : undefined} onClick={m.run} className={cls}>
                  {m.icon}
                </Button>
              )}
            </TooltipTrigger>
            <TooltipContent side={side}>
              {m.label}
              {hint ? <Kbd>{hint}</Kbd> : null}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </>
  )
}

/** The modules as dropdown items (the mobile ⋯ menu). */
export function ModuleMenuItems({ exclude = [] }: { exclude?: ModuleId[] }) {
  const modules = useModules().filter((m) => !exclude.includes(m.id))
  return (
    <>
      {modules.map((m) =>
        m.href ? (
          <DropdownMenuItem key={m.id} asChild>
            <a href={m.href}>
              {m.icon}
              {m.label}
            </a>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem key={m.id} onSelect={m.run}>
            {m.icon}
            {m.label}
          </DropdownMenuItem>
        ),
      )}
    </>
  )
}
