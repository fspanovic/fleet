/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

import { PALETTE_GROUPS, PALETTES, filterPalettes, parsePalette, themeColor, type PaletteMode } from './palettes'

test('parsePalette: known ids pass, anything else is Default', () => {
  expect(parsePalette('earth')).toBe('earth')
  expect(parsePalette('dusk')).toBe('dusk')
  expect(parsePalette('default')).toBe('default')
  expect(parsePalette('tokyo-night')).toBe('tokyo-night')
  expect(parsePalette('high-contrast')).toBe('high-contrast')
  expect(parsePalette(null)).toBe('default')
  expect(parsePalette(undefined)).toBe('default')
  expect(parsePalette('')).toBe('default')
  expect(parsePalette('Earth')).toBe('default')
  expect(parsePalette('toString')).toBe('default')
})

test('themeColor: the palette background per mode', () => {
  expect(themeColor('default', 'dark')).toBe('#0b0c0e')
  expect(themeColor('default', 'light')).toBe('#ffffff')
  expect(themeColor('earth', 'light')).toBe('#f7f2ea')
  expect(themeColor('dusk', 'dark')).toBe('#121119')
})

// Read from disk: vitest stubs CSS imports (even `?raw`).
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

/** The token block for a palette + mode in index.css. */
function block(id: string, mode: PaletteMode): string {
  const sel = id === 'default' ? (mode === 'dark' ? '.dark' : ':root') : `:root[data-palette="${id}"]${mode === 'dark' ? '.dark' : ''}`
  const start = css.indexOf(`\n${sel} {`)
  expect(start, sel).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('}', start))
}
const token = (b: string, name: string) => b.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))?.[1]

test('swatches match the index.css tokens', () => {
  for (const p of PALETTES) {
    for (const mode of ['light', 'dark'] as const) {
      const b = block(p.id, mode)
      expect(token(b, 'background'), `${p.id} ${mode}`).toBe(p.swatch[mode].background)
      expect(token(b, 'card'), `${p.id} ${mode}`).toBe(p.swatch[mode].card)
      expect(token(b, 'primary'), `${p.id} ${mode}`).toBe(p.swatch[mode].primary)
    }
  }
})

test('every non-default palette overrides every default token, in both modes', () => {
  const names = (b: string) => [...b.matchAll(/--([a-z0-9-]+):/g)].map((m) => m[1]).filter((n) => n !== 'radius')
  const light = names(block('default', 'light'))
  const dark = names(block('default', 'dark'))
  expect(light.sort()).toEqual(dark.sort())
  for (const p of PALETTES.filter((x) => x.id !== 'default')) {
    expect(names(block(p.id, 'light')).sort(), p.id).toEqual(light)
    expect(names(block(p.id, 'dark')).sort(), p.id).toEqual(light)
  }
})

test('the index.html pre-paint script knows every palette and its theme-colors', () => {
  for (const p of PALETTES) {
    const key = /^[a-z][a-z0-9]*$/.test(p.id) ? p.id : `'${p.id}'`
    expect(html).toContain(`${key}: ['${themeColor(p.id, 'dark')}', '${themeColor(p.id, 'light')}']`)
  }
  const entries = html.match(/^\s+'?[a-z0-9-]+'?: \['#[0-9a-f]{6}', '#[0-9a-f]{6}'\],?$/gm) ?? []
  expect(entries.length).toBe(PALETTES.length)
})

test('ids are unique; every palette sits in a known group, Default first', () => {
  expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length)
  expect(PALETTES[0].id).toBe('default')
  for (const g of PALETTE_GROUPS) expect(PALETTES.some((p) => p.group === g.id), g.id).toBe(true)
  for (const p of PALETTES) expect(PALETTE_GROUPS.map((g) => g.id), p.id).toContain(p.group)
})

test('filterPalettes: every word, any order, case- and accent-insensitive', () => {
  expect(filterPalettes('').length).toBe(PALETTES.length)
  expect(filterPalettes('  ').length).toBe(PALETTES.length)
  expect(filterPalettes('rose').map((p) => p.id)).toEqual(['rose', 'rose-pine'])
  expect(filterPalettes('ROSÉ PINE').map((p) => p.id)).toEqual(['rose-pine'])
  expect(filterPalettes('night tokyo').map((p) => p.id)).toEqual(['tokyo-night'])
  expect(filterPalettes('derived').length).toBeGreaterThan(0)
  expect(filterPalettes('no such theme')).toEqual([])
})

// WCAG 2 contrast, for the floors below.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

test('every palette stays readable: text, status and host colours on background and card', () => {
  // Floors sit just under what Default already meets; High contrast holds AAA (7:1) for text.
  const hosts = (min: number) => Object.fromEntries([0, 1, 2, 3].map((i) => [`host-${i}`, min]))
  const FLOORS: Record<'normal' | 'hc', Record<string, number>> = {
    normal: {
      foreground: 7,
      'muted-foreground': 4.5,
      dimmer: 3.2,
      primary: 4.5,
      'status-waiting': 3.5,
      'status-busy': 4.2,
      'status-idle': 4.5,
      'status-error': 4.4,
      'status-unknown': 2.5,
      ...hosts(4.5),
    },
    hc: {
      foreground: 15,
      'muted-foreground': 7,
      dimmer: 7,
      primary: 7,
      'status-waiting': 7,
      'status-busy': 7,
      'status-idle': 7,
      'status-error': 7,
      'status-unknown': 4.5,
      ...hosts(7),
    },
  }
  for (const p of PALETTES) {
    for (const mode of ['light', 'dark'] as const) {
      const b = block(p.id, mode)
      const t = (n: string) => token(b, n) ?? ''
      for (const [name, min] of Object.entries(FLOORS[p.id === 'high-contrast' ? 'hc' : 'normal'])) {
        for (const surface of ['background', 'card']) {
          expect(contrast(t(name), t(surface)), `${p.id} ${mode} ${name} on ${surface}`).toBeGreaterThanOrEqual(min)
        }
      }
      expect(contrast(t('primary'), t('primary-foreground')), `${p.id} ${mode} primary-foreground`).toBeGreaterThanOrEqual(4.5)
    }
  }
})
