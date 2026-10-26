import { describe, expect, it } from 'vitest'

import { contrast, inkOn, INK_DARK, INK_LIGHT, luminance, mixOklab, oklabDistance } from './color'

describe('color', () => {
  it('measures WCAG luminance and contrast', () => {
    expect(luminance('#000000')).toBe(0)
    expect(luminance('#ffffff')).toBeCloseTo(1)
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21)
    expect(contrast('#767676', '#ffffff')).toBeCloseTo(4.54, 1)
  })

  it('mixes like color-mix(in oklab)', () => {
    expect(mixOklab('#ff0000', 100, '#0000ff')).toBe('#ff0000')
    expect(mixOklab('#ff0000', 0, '#0000ff')).toBe('#0000ff')
    // Chrome: color-mix(in oklab, #000 50%, #fff) → rgb(99 99 99)
    expect(mixOklab('#000000', 50, '#ffffff')).toBe('#636363')
  })

  it('picks the ink that reads on a background', () => {
    expect(inkOn('#fbdf0a')).toBe(INK_DARK)
    expect(inkOn('#8554d4')).toBe(INK_LIGHT)
  })

  it('measures oklab distance', () => {
    expect(oklabDistance('#123456', '#123456')).toBe(0)
    expect(oklabDistance('#000000', '#ffffff')).toBeCloseTo(1, 2)
  })
})
