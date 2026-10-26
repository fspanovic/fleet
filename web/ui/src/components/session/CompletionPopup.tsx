import { useEffect, useRef } from 'react'

import type { CompleteKind } from '@/api/types'
import type { Suggestion } from '@/lib/complete'
import { cn } from '@/lib/utils'

const TITLES: Record<CompleteKind, string> = { skills: 'Skills & commands', files: 'Files', brain: 'Brain' }

export interface CompletionPopupProps {
  id: string
  kind: CompleteKind
  items: Suggestion[]
  active: number
  /** Why the list is empty: still loading, an error, nothing matches. */
  status: string | null
  desktop: boolean
  onHover: (index: number) => void
  onPick: (s: Suggestion) => void
}

/** The suggestions above the composer input; the textarea keeps focus (and the keyboard). */
export function CompletionPopup({ id, kind, items, active, status, desktop, onHover, onPick }: CompletionPopupProps) {
  const list = useRef<HTMLUListElement>(null)
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, items])

  return (
    <div
      className="absolute inset-x-0 bottom-full z-20 mb-2 animate-in overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-overlay duration-(--dur-base) ease-out fade-in-0 slide-in-from-bottom-1"
      // Keep the caret in the textarea (and a touch keyboard up) while tapping a row.
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span className="font-medium">{TITLES[kind]}</span>
        {desktop ? <span className="text-dimmer">↑↓ to move · Tab or Enter to pick · Esc to close</span> : null}
      </div>
      {items.length === 0 ? (
        <div className="px-3 py-2.5 text-sm text-muted-foreground" role="status">
          {status ?? 'No matches'}
        </div>
      ) : (
        <ul ref={list} id={id} role="listbox" aria-label={TITLES[kind]} className="max-h-72 overflow-y-auto py-1">
          {items.map((s, i) => (
            <li
              key={s.insert}
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={i === active}
              className={cn('flex cursor-pointer flex-col gap-0.5 px-3 py-1.5', desktop ? '' : 'py-2', i === active && 'bg-accent')}
              onMouseMove={() => i !== active && onHover(i)}
              onClick={() => onPick(s)}
            >
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate font-mono text-body-sm text-foreground">{s.label}</span>
                {s.hint ? <span className="shrink-0 truncate text-2xs text-dimmer">{s.hint}</span> : null}
              </span>
              {s.detail ? <span className="truncate text-xs text-muted-foreground">{s.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
