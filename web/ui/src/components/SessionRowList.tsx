import { useState, type DragEvent } from 'react'

import type { Session } from '@/api/types'
import { SessionRow } from '@/components/SessionRow'
import type { MoveRow } from '@/hooks/useListOrder'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { cardDropBefore } from '@/lib/groups'
import { ROW_DRAG_TYPE, isRowDrag } from '@/lib/listOrder'
import { sessionKey } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

/**
 * A drag shared by several lists (the desktop sidebar's sections): the row being dragged lives with
 * the owner, so a row from another list can land here too — where `accepts` says it may.
 */
export interface SharedRowDrag {
  key: string | null
  onDrag: (key: string | null) => void
  /** May row `key` of another list be dropped here? */
  accepts: (key: string) => boolean
}

/** A row's landing spot: before row `before` (null: the end); `y` = the drop line's offset in the list. */
type Slot = { before: string | null; y: number }

/**
 * Where row `key` dragged over `list` would land, from the pointer's height against the drawn
 * rows' midpoints (cardDropBefore, like a board card); undefined when it would stay where it is.
 */
function rowSlot(list: HTMLElement, clientY: number, key: string): Slot | undefined {
  const rows = [...list.querySelectorAll<HTMLElement>(':scope > [data-row-key]')]
  if (!rows.length) return undefined
  const shown = rows.map((el) => el.dataset.rowKey ?? '')
  const mids = rows.map((el) => {
    const r = el.getBoundingClientRect()
    return r.top + r.height / 2
  })
  const before = cardDropBefore(shown, mids, clientY, key)
  if (before === undefined) return undefined
  const i = before == null ? rows.length : shown.indexOf(before)
  const bottom = (el: HTMLElement) => el.offsetTop + el.offsetHeight
  const gap = rows.length > 1 ? rows[1].offsetTop - bottom(rows[0]) : 6
  // The 2px line centred in the gap between two rows, half a gap outside the first / last one.
  const y = i === 0 ? rows[0].offsetTop - gap / 2 : i < rows.length ? (bottom(rows[i - 1]) + rows[i].offsetTop) / 2 : bottom(rows[i - 1]) + gap / 2
  return { before, y: y - 1 }
}

export interface SessionRowListProps {
  sessions: Session[]
  now: number
  /** Drop a dragged row into place (useSessionList's moveRow); omitted → no drag. With `shared`, also a row from another list. */
  onMove?: MoveRow
  /** The drag spans several lists (omitted → this list's rows only). */
  shared?: SharedRowDrag
  selectedKey?: string | null
  cursorKey?: string | null
  /** A `<nav>` with this label (desktop sidebar); else a `<div>`. */
  label?: string
  className?: string
}

/**
 * The session list's rows. On pointer devices a row can be dragged up or down into place (a line
 * shows where it lands; `onMove` remembers it) — with `shared`, into another list too; touch
 * screens keep tap / long press as they are.
 */
export function SessionRowList({ sessions, now, onMove, shared, selectedKey, cursorKey, label, className }: SessionRowListProps) {
  const fine = useMediaQuery('(pointer: fine)')
  const [ownKey, setOwnKey] = useState<string | null>(null)
  const dragKey = shared ? shared.key : ownKey
  const setDragKey = shared ? shared.onDrag : setOwnKey
  const [slot, setSlot] = useState<Slot | null>(null)
  const on = fine && !!onMove
  const end = () => {
    setDragKey(null)
    setSlot(null)
  }
  const ours = (e: DragEvent) =>
    dragKey != null && isRowDrag(e.dataTransfer) && (sessions.some((s) => sessionKey(s) === dragKey) || !!shared?.accepts(dragKey))

  const listProps = on
    ? {
        onDragOver(e: DragEvent<HTMLElement>) {
          if (!ours(e) || dragKey == null) return
          const t = rowSlot(e.currentTarget, e.clientY, dragKey)
          if (!t) {
            // Back over the row's own spot: no drop line.
            if (slot) setSlot(null)
            return
          }
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          if (slot?.before !== t.before || slot?.y !== t.y) setSlot(t)
        },
        onDragLeave(e: DragEvent<HTMLElement>) {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSlot(null)
        },
        onDrop(e: DragEvent<HTMLElement>) {
          if (!ours(e) || dragKey == null) return
          e.preventDefault()
          const t = rowSlot(e.currentTarget, e.clientY, dragKey)
          if (t) onMove(sessions, dragKey, t.before)
          end()
        },
      }
    : {}

  const rows = sessions.map((s) => {
    const key = sessionKey(s)
    return (
      <SessionRow
        key={key}
        session={s}
        now={now}
        selected={selectedKey != null && key === selectedKey}
        cursor={cursorKey != null && key === cursorKey && key !== selectedKey}
        drag={
          on
            ? {
                dragging: key === dragKey,
                onStart: (e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData(ROW_DRAG_TYPE, key)
                  setDragKey(key)
                },
                onEnd: end,
              }
            : undefined
        }
      />
    )
  })
  const line = on && slot && dragKey != null ? <div aria-hidden className="pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary" style={{ top: slot.y }} /> : null
  const cls = cn(className, on && 'relative')
  return label ? (
    <nav aria-label={label} className={cls} {...listProps}>
      {line}
      {rows}
    </nav>
  ) : (
    <div className={cls} {...listProps}>
      {line}
      {rows}
    </div>
  )
}
