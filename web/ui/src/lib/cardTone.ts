import type { CSSProperties } from 'react'

import type { Session } from '@/api/types'
import type { PaletteMode } from '@/lib/palettes'
import { sessionStyle } from '@/lib/sessionStyle'
import { statusMeta } from '@/lib/sessions'
import { CARD_WASH_COLOR, HEAD_EDGE, HEAD_WASH, TASK_COLOR } from '@/lib/styles'

/**
 * A wash in one mode. Its colour is the source colour's hue and chroma at a set oklab `lightness` (near a light card's
 * in light mode, a little above a dark card's in dark mode), so it stays vivid — a dark status colour mixed in as it
 * is only greys the header — and costs text little contrast. Then, in %: `wash` of it mixed into the background,
 * `pull` of the mode's ink (black / white) mixed into the text tokens inside (muted, dimmer, status, host, primary)
 * and `pullFg` into the foreground — enough that every palette keeps its text contrast on the wash (cardTone.test.ts
 * checks them all).
 */
export interface WashMix {
  lightness: number
  wash: number
  pull: number
  pullFg: number
}
export type Wash = 'busy' | 'waiting' | 'style'
export type WashMixes = Record<PaletteMode, WashMix>

/**
 * Status washes: working green, needs-you the strongest, amber (it needs the user); idle, background task and unknown
 * stay plain so the coloured ones stand out.
 */
export const CARD_WASHES: Record<'busy' | 'waiting', WashMixes> = {
  busy: {
    light: { lightness: 0.88, wash: 55, pull: 14, pullFg: 0 },
    dark: { lightness: 0.42, wash: 40, pull: 24, pullFg: 0 },
  },
  waiting: {
    light: { lightness: 0.88, wash: 65, pull: 20, pullFg: 0 },
    dark: { lightness: 0.42, wash: 50, pull: 28, pullFg: 0 },
  },
}

/** A session style's wash (the style owns the background): its palette colour, per colour where it differs. */
export const STYLE_WASH: WashMixes = {
  light: { lightness: 0.88, wash: 50, pull: 22, pullFg: 0 },
  dark: { lightness: 0.42, wash: 40, pull: 26, pullFg: 0 },
}
export const STYLE_WASHES: Readonly<Record<string, WashMixes>> = {
  // Lemon: lighter and stronger than the rest, so it reads as yellow — not the waiting amber, not khaki — in both modes.
  yellow: {
    light: { lightness: 0.93, wash: 70, pull: 14, pullFg: 0 },
    dark: { lightness: 0.52, wash: 55, pull: 50, pullFg: 12 },
  },
}

export const styleWash = (color: string | undefined): WashMixes =>
  color && Object.hasOwn(STYLE_WASHES, color) ? STYLE_WASHES[color] : STYLE_WASH

/** The session header's look: the wash (status, or the style's), the status line, and what the element carries. */
export interface CardTone {
  wash: Wash | null
  /** `data-wash` on the element (index.css picks the mode's strengths and pulls the text tokens). */
  dataWash: Wash | undefined
  /** Session header classes: the wash over the page background, the status as its bottom line. */
  head: string
  /** Inline vars: the session style's colours and the wash strengths per mode. */
  style: CSSProperties | undefined
}

const pct = (n: number) => `${n}%`

function washVars(m: WashMixes): Record<string, string> {
  return {
    '--wash-ll': String(m.light.lightness),
    '--wash-ld': String(m.dark.lightness),
    '--wash-pl': pct(m.light.wash),
    '--wash-pd': pct(m.dark.wash),
    '--pull-l': pct(m.light.pull),
    '--pull-d': pct(m.dark.pull),
    '--pull-fgl': pct(m.light.pullFg),
    '--pull-fgd': pct(m.dark.pullFg),
  }
}

/**
 * The session header's tone (list rows and board cards stay plain). The bottom line is the status for every session
 * (working green, needs-you amber, idle and background-task grey, none for unknown). The background is the session
 * style's wash when a `web.sessionStyles` rule with a known colour matched (it owns the background), else the status's
 * wash (working, needs you) or none.
 */
export function sessionCardTone(s: Pick<Session, 'status' | 'style'> | null | undefined): CardTone {
  const key = statusMeta(s?.status).key
  const st = sessionStyle(s)
  const wash: Wash | null = st?.vars ? 'style' : key === 'busy' || key === 'waiting' ? key : null
  const mixes = wash === 'style' ? styleWash(st?.color) : wash ? CARD_WASHES[wash] : null
  const styled = wash === 'style' ? [TASK_COLOR, CARD_WASH_COLOR.style] : wash ? [CARD_WASH_COLOR[wash]] : []
  return {
    wash,
    dataWash: wash ?? undefined,
    head: [...(wash ? [...styled, HEAD_WASH] : []), HEAD_EDGE[key]].filter(Boolean).join(' '),
    style: mixes || st?.vars ? ({ ...st?.vars, ...(mixes ? washVars(mixes) : {}) } as CSSProperties) : undefined,
  }
}
