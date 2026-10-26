/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { CARD_WASHES, STYLE_WASH, STYLE_WASHES, sessionCardTone, styleWash, type WashMix } from './cardTone'
import { contrast, mixOklab, oklabDistance, pinnedMix } from './color'
import { PALETTES, type PaletteMode } from './palettes'
import { sessionStyle } from './sessionStyle'
import { TASK_COLORS } from './tasks'

const watcher = { label: 'Watcher', color: 'yellow' }

describe('sessionCardTone', () => {
  it('working: a green wash and a green bottom line', () => {
    const t = sessionCardTone({ status: 'busy' })
    expect(t.wash).toBe('busy')
    expect(t.dataWash).toBe('busy')
    expect(t.head).toContain('[--wash:var(--status-busy)]')
    expect(t.head).toContain('border-b-2 border-b-[color:var(--tone-status-busy,var(--status-busy))]')
    expect(t.style).toMatchObject({ '--wash-pl': `${CARD_WASHES.busy.light.wash}%`, '--wash-pd': `${CARD_WASHES.busy.dark.wash}%` })
  })

  it('needs you: an amber bottom line and the strongest status wash', () => {
    const t = sessionCardTone({ status: 'waiting' })
    expect(t.wash).toBe('waiting')
    expect(t.head).toContain('[--wash:var(--status-waiting)]')
    expect(t.head).toContain('var(--status-waiting)')
    for (const m of ['light', 'dark'] as const) expect(CARD_WASHES.waiting[m].wash).toBeGreaterThan(CARD_WASHES.busy[m].wash)
  })

  it('idle and a background task: a grey bottom line, no wash', () => {
    for (const status of ['idle', 'shell']) {
      const t = sessionCardTone({ status })
      expect([t.wash, t.dataWash, t.style]).toEqual([null, undefined, undefined])
      expect(t.head).toBe('border-b-2 border-b-[color:var(--tone-status-idle,var(--status-idle))]')
    }
  })

  it('unknown (or no session): no line, no wash', () => {
    for (const s of [{ status: 'unknown' }, { status: 'nonsense' }, null]) {
      const t = sessionCardTone(s)
      expect([t.wash, t.head, t.style]).toEqual([null, '', undefined])
    }
  })

  it('a styled session: the style owns the wash (no frame), the bottom line still shows the status', () => {
    for (const status of ['idle', 'busy', 'waiting'] as const) {
      const t = sessionCardTone({ status, style: watcher })
      expect(t.wash).toBe('style')
      expect(t.head).toContain('[--wash:var(--st)]')
      expect(t.head).toContain(`var(--status-${status})`)
      expect(t.head).not.toContain('border-[color-mix')
      expect(t.style).toMatchObject({ ...sessionStyle({ style: watcher })?.vars, '--wash-pl': `${STYLE_WASHES.yellow.light.wash}%` })
    }
  })

  it('a style with an unknown colour keeps the status wash', () => {
    const t = sessionCardTone({ status: 'busy', style: { label: 'Watcher', color: 'violet' } })
    expect(t.wash).toBe('busy')
  })

  it('draws yellow stronger than the default style wash', () => {
    expect(styleWash('yellow')).toBe(STYLE_WASHES.yellow)
    expect(styleWash('electric')).toBe(STYLE_WASH)
    expect(styleWash('toString')).toBe(STYLE_WASH)
    for (const m of ['light', 'dark'] as const) expect(STYLE_WASHES.yellow[m].wash).toBeGreaterThan(STYLE_WASH[m].wash)
  })
})

// Contrast on every palette, in both modes — read from index.css like palettes.test.ts.
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
function block(id: string, mode: PaletteMode): string {
  const sel = id === 'default' ? (mode === 'dark' ? '.dark' : ':root') : `:root[data-palette="${id}"]${mode === 'dark' ? '.dark' : ''}`
  const start = css.indexOf(`\n${sel} {`)
  expect(start, sel).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}
const token = (b: string, name: string) => {
  const v = b.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))?.[1]
  expect(v, name).toBeDefined()
  return v as string
}
// The tokens index.css pulls toward the ink inside a washed element (`--tone-<token>`; all but the two foregrounds
// take `pull`).
const washBlock = css.slice(css.indexOf('\n  [data-wash] {'), css.indexOf('}', css.indexOf('\n  [data-wash] {')))
const pulled = [...washBlock.matchAll(/--tone-([a-z0-9-]+): color-mix/g)].map((m) => m[1]).map((n) => (n === 'fg' ? 'foreground' : n === 'cfg' ? 'card-foreground' : n))
const accents = pulled.filter((n) => n !== 'foreground' && n !== 'card-foreground')

/** Every wash the session header can wear in a palette + mode: its colour and strengths. */
function washes(id: string, mode: PaletteMode): { name: string; color: string; mix: WashMix }[] {
  const b = block(id, mode)
  const out = (['busy', 'waiting'] as const).map((k): { name: string; color: string; mix: WashMix } => ({ name: k, color: token(b, `status-${k}`), mix: CARD_WASHES[k][mode] }))
  for (const color of Object.keys(TASK_COLORS)) {
    const v = sessionStyle({ style: { label: 'x', color } })?.vars as Record<string, string>
    const m = mode === 'light' ? 'l' : 'd'
    out.push({ name: `style ${color}`, color: v[`--st-${m}`] ?? v[`--tc-${m}`], mix: styleWash(color)[mode] })
  }
  return out
}

describe('card tone contrast', () => {
  it('pulls the text tokens index.css lists', () => {
    expect(pulled).toEqual(expect.arrayContaining(['foreground', 'card-foreground', 'muted-foreground', 'dimmer', 'status-busy', 'status-waiting', 'status-idle', 'host-0', 'primary']))
  })

  it('text and the status line hold their contrast on every wash (foregrounds and status labels 4.5:1; the rest 4.5:1 or what it has on a plain card)', () => {
    const low: string[] = []
    for (const p of PALETTES) {
      for (const mode of ['light', 'dark'] as const) {
        const b = block(p.id, mode)
        const card = token(b, 'card')
        const ink = mode === 'light' ? '#000000' : '#ffffff'
        for (const w of washes(p.id, mode)) {
          const bg = pinnedMix(w.color, w.mix.lightness, w.mix.wash, card)
          for (const fg of ['foreground', 'card-foreground']) {
            const r = contrast(mixOklab(ink, w.mix.pullFg, token(b, fg)), bg)
            if (r < 4.5) low.push(`${p.id} ${mode} ${w.name} ${fg}: ${r.toFixed(2)}`)
          }
          for (const n of accents) {
            const plain = token(b, n)
            // A status colour is the label (text, 4.5:1) and the bottom line; the rest keep what they had on a plain card.
            const want = /^status-(busy|waiting|idle)$/.test(n) ? 4.5 : Math.min(4.5, contrast(plain, card))
            const r = contrast(mixOklab(ink, w.mix.pull, plain), bg)
            if (r < want - 0.005) low.push(`${p.id} ${mode} ${w.name} ${n}: ${r.toFixed(2)} < ${want.toFixed(2)}`)
          }
        }
      }
    }
    expect(low).toEqual([])
  })

  // Past a just-noticeable difference (~0.02) on the wash alone; the watcher's solid chip carries the rest.
  it('the waiting wash and the watcher wash read apart (and the watcher reads as itself on a busy card too)', () => {
    const close: string[] = []
    for (const p of PALETTES) {
      for (const mode of ['light', 'dark'] as const) {
        const b = block(p.id, mode)
        const card = token(b, 'card')
        const all = washes(p.id, mode)
        const at = (name: string) => {
          const w = all.find((x) => x.name === name)!
          return pinnedMix(w.color, w.mix.lightness, w.mix.wash, card)
        }
        for (const k of ['waiting', 'busy']) {
          const d = oklabDistance(at(k), at('style yellow'))
          if (d < 0.03) close.push(`${p.id} ${mode} ${k}: ${d.toFixed(3)}`)
        }
      }
    }
    expect(close).toEqual([])
  })

  // Past a just-noticeable difference everywhere; the muted palettes (zenburn, kanagawa: low-chroma status colours) stay
  // closest, by design, while the fleet palettes sit far above (default light busy ~0.09).
  it('washes are visible: every status and style wash stands off the plain card', () => {
    const faint: string[] = []
    for (const p of PALETTES) {
      for (const mode of ['light', 'dark'] as const) {
        const card = token(block(p.id, mode), 'card')
        for (const w of washes(p.id, mode).filter((x) => x.name === 'busy' || x.name === 'waiting' || x.name === 'style yellow')) {
          const d = oklabDistance(pinnedMix(w.color, w.mix.lightness, w.mix.wash, card), card)
          if (d < 0.025) faint.push(`${p.id} ${mode} ${w.name}: ${d.toFixed(3)}`)
        }
      }
    }
    expect(faint).toEqual([])
  })
})
