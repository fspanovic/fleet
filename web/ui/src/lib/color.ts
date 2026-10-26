// Colour maths on #rrggbb hexes — WCAG contrast and CSS `color-mix(in oklab, …)` — for picking ink colours and for
// the contrast tests of the card tones (lib/cardTone.ts).

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const fromLinear = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex).map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

function fromOklab([L, A, B]: [number, number, number]): string {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return `#${rgb.map((v) => Math.round(Math.min(1, Math.max(0, fromLinear(v))) * 255).toString(16).padStart(2, '0')).join('')}`
}

/**
 * `color-mix(in oklab, oklab(from <color> <lightness> a b) pct%, <base>)` as the screen shows it (clipped to sRGB):
 * the colour's hue and chroma at a set oklab lightness, mixed into a base.
 */
export function pinnedMix(color: string, lightness: number, pct: number, base: string): string {
  const x = toOklab(color)
  const y = toOklab(base)
  const p = pct / 100
  return fromOklab([lightness * p + y[0] * (1 - p), x[1] * p + y[1] * (1 - p), x[2] * p + y[2] * (1 - p)])
}

/** `color-mix(in oklab, a pct%, b)`. */
export function mixOklab(a: string, pct: number, b: string): string {
  const x = toOklab(a)
  const y = toOklab(b)
  const p = pct / 100
  return fromOklab([0, 1, 2].map((i) => x[i] * p + y[i] * (1 - p)) as [number, number, number])
}

export const INK_DARK = '#111318'
export const INK_LIGHT = '#ffffff'

/** The ink (near-black or white) that reads best on a background. */
export const inkOn = (bg: string) => (contrast(INK_DARK, bg) >= contrast(INK_LIGHT, bg) ? INK_DARK : INK_LIGHT)

/**
 * A solid label background in `bg` and its ink: the ink that reads best, and the background pushed away from the ink
 * (2% steps, in oklab) until the pair holds `min` (4.5:1 — small text).
 */
export function labelColors(bg: string, min = 4.5): { bg: string; ink: string } {
  const ink = inkOn(bg)
  const away = ink === INK_DARK ? '#ffffff' : '#000000'
  let out = bg
  for (let p = 2; contrast(ink, out) < min && p <= 100; p += 2) out = mixOklab(away, p, bg)
  return { bg: out, ink }
}

/** Euclidean distance in oklab (~0.02 is a just-noticeable difference). */
export function oklabDistance(a: string, b: string): number {
  const x = toOklab(a)
  const y = toOklab(b)
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}
