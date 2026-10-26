import { describe, expect, it } from 'vitest'

import { contrast } from './color'
import { sessionStyle } from './sessionStyle'
import { TASK_COLORS } from './tasks'

describe('sessionStyle', () => {
  it('draws the matched rule: its label and its palette colour per mode', () => {
    expect(sessionStyle({ style: { label: 'Watcher', color: 'electric' } })).toEqual({
      label: 'Watcher',
      color: 'electric',
      vars: { '--tc-l': '#8554d4', '--tc-d': '#b7a2d9', '--scb-l': '#8554d4', '--sci-l': '#ffffff', '--scb-d': '#b7a2d9', '--sci-d': '#111318' },
    })
  })

  it('draws yellow as lemon: a lemon wash and chip with dark ink, the palette mustard in the light frame', () => {
    expect(sessionStyle({ style: { label: 'Watcher', color: 'yellow' } })).toEqual({
      label: 'Watcher',
      color: 'yellow',
      vars: { '--tc-l': '#8c6d00', '--tc-d': '#edd207', '--st-l': '#fbdf0a', '--st-d': '#edd207', '--scb-l': '#fbdf0a', '--sci-l': '#111318', '--scb-d': '#edd207', '--sci-d': '#111318' },
    })
  })

  it('gives every palette colour a chip that reads (4.5:1) in both modes, as close to the colour as it can', () => {
    const low: string[] = []
    for (const color of Object.keys(TASK_COLORS)) {
      const v = sessionStyle({ style: { label: 'x', color } })?.vars as Record<string, string>
      for (const m of ['l', 'd']) {
        const r = contrast(v[`--sci-${m}`], v[`--scb-${m}`])
        if (r < 4.5) low.push(`${color} ${m}: ${r.toFixed(2)}`)
      }
    }
    expect(low).toEqual([])
    // Only the mid blues need a darker chip.
    const moved = Object.keys(TASK_COLORS).filter((color) => {
      const v = sessionStyle({ style: { label: 'x', color } })?.vars as Record<string, string>
      return v['--scb-l'] !== (v['--st-l'] ?? v['--tc-l']) || v['--scb-d'] !== (v['--st-d'] ?? v['--tc-d'])
    })
    expect(moved.sort()).toEqual(['azure', 'blue', 'celtic-blue'])
  })

  it('takes no session colour for an inherited object key', () => {
    expect(sessionStyle({ style: { label: 'Watcher', color: 'toString' } })).toEqual({ label: 'Watcher', vars: undefined })
  })

  it('keeps the label of an unknown colour, without a tint', () => {
    expect(sessionStyle({ style: { label: ' Watcher ', color: 'violet' } })).toEqual({ label: 'Watcher', vars: undefined })
  })

  it('is null for no style, an older server or a blank label', () => {
    expect(sessionStyle({})).toBeNull()
    expect(sessionStyle({ style: null })).toBeNull()
    expect(sessionStyle(undefined)).toBeNull()
    expect(sessionStyle({ style: { label: '  ', color: 'electric' } })).toBeNull()
  })
})
