import type { CSSProperties } from 'react'

import type { Session } from '@/api/types'
import { labelColors } from '@/lib/color'
import { taskColor } from '@/lib/tasks'

/** A session's `style`, ready to draw. */
export interface ResolvedSessionStyle {
  label: string
  /** The palette colour name (`yellow`); undefined for an unknown name. */
  color?: string
  /**
   * The palette's two colours (`--tc-l` / `--tc-d`, lib/tasks.ts TASK_COLORS) plus SESSION_COLORS, and the chip's
   * background and ink per mode (`--scb-l` / `--scb-d`, `--sci-l` / `--sci-d`: color.ts labelColors, 4.5:1); undefined
   * for an unknown name — label only, no wash.
   */
  vars?: CSSProperties
}

/**
 * Where a session style draws a palette colour unlike My tasks (lib/styles.ts SESSION_STYLE_*): its wash and chip
 * colour per mode (`--st-l` / `--st-d`, default the palette colour) or its own palette colour (`--tc-l` / `--tc-d`,
 * which the frame leans toward). Its wash strength per mode is lib/cardTone.ts STYLE_WASHES.
 * Yellow: Productive's mustard reads beige / khaki as a wash and sits next to the waiting amber, so it is drawn as
 * lemon — a lemon wash and chip in both modes, a lemon dark-mode frame; the light frame leans to the palette's mustard
 * so it still shows on a light page.
 */
const SESSION_COLORS: Readonly<Record<string, Record<string, string>>> = {
  yellow: { '--tc-d': '#edd207', '--st-l': '#fbdf0a', '--st-d': '#edd207' },
}

/**
 * The `web.sessionStyles` rule the server matched to this session (`style`), with its palette colour as CSS
 * variables; null when there is none (older servers, no rule matched, a blank label).
 */
export function sessionStyle(s: Pick<Session, 'style'> | null | undefined): ResolvedSessionStyle | null {
  const st = s?.style
  const label = typeof st?.label === 'string' ? st.label.trim() : ''
  if (!label) return null
  const color = typeof st?.color === 'string' ? st.color : undefined
  const tc = taskColor(color)
  if (!tc || !color) return { label, vars: undefined }
  const vars: Record<string, string> = { '--tc-l': tc.light, '--tc-d': tc.dark, ...(Object.hasOwn(SESSION_COLORS, color) ? SESSION_COLORS[color] : {}) }
  for (const m of ['l', 'd']) {
    const chip = labelColors(vars[`--st-${m}`] ?? vars[`--tc-${m}`])
    vars[`--scb-${m}`] = chip.bg
    vars[`--sci-${m}`] = chip.ink
  }
  return { label, color, vars: vars as CSSProperties }
}
