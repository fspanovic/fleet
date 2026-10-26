// Colour palettes (Settings → Theme) — orthogonal to the light/dark mode (useTheme). A palette is
// `data-palette` on <html> (none = Default); its tokens live in index.css, one block per mode.
// Two groups: fleet's own palettes and popular editor themes (official colours where they exist).
// Pure helpers, unit-tested in palettes.test.ts (which also checks these hexes against index.css
// and the index.html pre-paint script).

export type PaletteId =
  | 'default'
  | 'earth'
  | 'dusk'
  | 'forest'
  | 'ocean'
  | 'sand'
  | 'rose'
  | 'mono'
  | 'high-contrast'
  | 'madrid'
  | 'ayu'
  | 'catppuccin'
  | 'cobalt2'
  | 'dracula'
  | 'everforest'
  | 'flexoki'
  | 'github'
  | 'gruvbox'
  | 'horizon'
  | 'iceberg'
  | 'kanagawa'
  | 'material'
  | 'monokai'
  | 'moonlight'
  | 'night-owl'
  | 'nightfox'
  | 'nord'
  | 'oceanic-next'
  | 'one'
  | 'oxocarbon'
  | 'papercolor'
  | 'poimandres'
  | 'rose-pine'
  | 'selenized'
  | 'solarized'
  | 'sonokai'
  | 'synthwave'
  | 'tokyo-night'
  | 'tomorrow'
  | 'vesper'
  | 'zenburn'
export type PaletteMode = 'light' | 'dark'
export type PaletteGroup = 'fleet' | 'editor'

/** Picker sections, in order. */
export const PALETTE_GROUPS: readonly { id: PaletteGroup; label: string }[] = [
  { id: 'fleet', label: 'Fleet' },
  { id: 'editor', label: 'Editor themes' },
]

export const PALETTE_KEY = 'fleet.palette'
export const DEFAULT_PALETTE: PaletteId = 'default'

/** The three tokens a picker swatch previews: page, card, primary. `background` is also the
 *  PWA status-bar colour (meta theme-color). */
export interface Swatch {
  background: string
  card: string
  primary: string
}

export interface Palette {
  id: PaletteId
  group: PaletteGroup
  label: string
  hint: string
  swatch: Record<PaletteMode, Swatch>
}

export const PALETTES: readonly Palette[] = [
  {
    id: 'default',
    group: 'fleet',
    label: 'Default',
    hint: 'Neutral grey, blue accent',
    swatch: {
      light: { background: '#ffffff', card: '#f5f6f8', primary: '#2563eb' },
      dark: { background: '#0b0c0e', card: '#131519', primary: '#6aa6ff' },
    },
  },
  {
    id: 'earth',
    group: 'fleet',
    label: 'Earth',
    hint: 'Warm paper and walnut, terracotta accent',
    swatch: {
      light: { background: '#f7f2ea', card: '#efe7da', primary: '#a14a2a' },
      dark: { background: '#1a1512', card: '#221c17', primary: '#e39a6f' },
    },
  },
  {
    id: 'dusk',
    group: 'fleet',
    label: 'Dusk',
    hint: 'Soft violet-grey, violet accent',
    swatch: {
      light: { background: '#faf9fc', card: '#f2f0f7', primary: '#6547c2' },
      dark: { background: '#121119', card: '#1a1823', primary: '#b3a0ff' },
    },
  },
  {
    id: 'forest',
    group: 'fleet',
    label: 'Forest',
    hint: 'Moss and pine, leaf-green accent',
    swatch: {
      light: { background: '#f4f7f1', card: '#eaf0e6', primary: '#2f6b3f' },
      dark: { background: '#0f1511', card: '#151d17', primary: '#86c99a' },
    },
  },
  {
    id: 'ocean',
    group: 'fleet',
    label: 'Ocean',
    hint: 'Deep navy and sea glass, teal accent',
    swatch: {
      light: { background: '#f3f8fa', card: '#e7f0f4', primary: '#0a6a8a' },
      dark: { background: '#0a1620', card: '#0f1e2a', primary: '#5cc6e0' },
    },
  },
  {
    id: 'sand',
    group: 'fleet',
    label: 'Sand',
    hint: 'Dune beige and driftwood, teal accent',
    swatch: {
      light: { background: '#faf6ec', card: '#f2ecdc', primary: '#2a6b6e' },
      dark: { background: '#1a1813', card: '#221f18', primary: '#72c2bd' },
    },
  },
  {
    id: 'rose',
    group: 'fleet',
    label: 'Rose',
    hint: 'Blush and plum, rose accent',
    swatch: {
      light: { background: '#fdf7f8', card: '#f7ecef', primary: '#ad2f5a' },
      dark: { background: '#1a1215', card: '#22181c', primary: '#f28bab' },
    },
  },
  {
    id: 'mono',
    group: 'fleet',
    label: 'Mono',
    hint: 'Greyscale; colour only for status',
    swatch: {
      light: { background: '#fafafa', card: '#f2f2f2', primary: '#262626' },
      dark: { background: '#0f0f0f', card: '#171717', primary: '#e5e5e5' },
    },
  },
  {
    id: 'high-contrast',
    group: 'fleet',
    label: 'High contrast',
    hint: 'Maximum legibility, AAA text',
    swatch: {
      light: { background: '#ffffff', card: '#f2f2f2', primary: '#0039b3' },
      dark: { background: '#000000', card: '#0d0d0d', primary: '#8cc8ff' },
    },
  },
  {
    id: 'madrid',
    group: 'fleet',
    label: 'Real Madrid',
    hint: 'Bernabéu white and gold, royal purple, the crest',
    swatch: {
      light: { background: '#ffffff', card: '#f7f5f0', primary: '#5b2a86' },
      dark: { background: '#110d1d', card: '#18142a', primary: '#febe10' },
    },
  },
  {
    id: 'ayu',
    group: 'editor',
    label: 'Ayu',
    hint: 'Ayu Light and Mirage',
    swatch: {
      light: { background: '#fcfcfc', card: '#f3f4f5', primary: '#b85100' },
      dark: { background: '#1f2430', card: '#242936', primary: '#ffcc66' },
    },
  },
  {
    id: 'catppuccin',
    group: 'editor',
    label: 'Catppuccin',
    hint: 'Latte and Mocha, mauve accent',
    swatch: {
      light: { background: '#eff1f5', card: '#e6e9ef', primary: '#8737ee' },
      dark: { background: '#1e1e2e', card: '#232334', primary: '#cba6f7' },
    },
  },
  {
    id: 'cobalt2',
    group: 'editor',
    label: 'Cobalt2',
    hint: 'Cobalt blue, yellow accent; light derived',
    swatch: {
      light: { background: '#f2f6fa', card: '#e6eef6', primary: '#0060c7' },
      dark: { background: '#193549', card: '#1d3c52', primary: '#ffc600' },
    },
  },
  {
    id: 'dracula',
    group: 'editor',
    label: 'Dracula',
    hint: 'Dracula; light derived (Alucard-style)',
    swatch: {
      light: { background: '#fbf8ef', card: '#f3efe2', primary: '#644ac9' },
      dark: { background: '#282a36', card: '#2d2f3d', primary: '#bd93f9' },
    },
  },
  {
    id: 'everforest',
    group: 'editor',
    label: 'Everforest',
    hint: 'Soft forest greens and warm paper',
    swatch: {
      light: { background: '#fdf6e3', card: '#f4f0d9', primary: '#627400' },
      dark: { background: '#2d353b', card: '#343f44', primary: '#a7c080' },
    },
  },
  {
    id: 'flexoki',
    group: 'editor',
    label: 'Flexoki',
    hint: 'Inky paper, warm accents',
    swatch: {
      light: { background: '#fffcf0', card: '#f2f0e5', primary: '#205ea6' },
      dark: { background: '#100f0f', card: '#1c1b1a', primary: '#4789c2' },
    },
  },
  {
    id: 'github',
    group: 'editor',
    label: 'GitHub',
    hint: 'GitHub light and dark, blue accent',
    swatch: {
      light: { background: '#ffffff', card: '#f6f8fa', primary: '#0969da' },
      dark: { background: '#0d1117', card: '#151b23', primary: '#4493f8' },
    },
  },
  {
    id: 'gruvbox',
    group: 'editor',
    label: 'Gruvbox',
    hint: 'Retro warm browns, muted blue accent',
    swatch: {
      light: { background: '#fbf1c7', card: '#f2e5bc', primary: '#076678' },
      dark: { background: '#282828', card: '#32302f', primary: '#83a598' },
    },
  },
  {
    id: 'horizon',
    group: 'editor',
    label: 'Horizon',
    hint: 'Horizon Bright and Dark, warm pink accent',
    swatch: {
      light: { background: '#fdf0ed', card: '#f9e4de', primary: '#d10038' },
      dark: { background: '#1c1e26', card: '#232530', primary: '#ed577c' },
    },
  },
  {
    id: 'iceberg',
    group: 'editor',
    label: 'Iceberg',
    hint: 'Cool indigo-grey, blue accent',
    swatch: {
      light: { background: '#e8e9ec', card: '#dcdfe7', primary: '#2d539e' },
      dark: { background: '#161821', card: '#1e2132', primary: '#84a0c6' },
    },
  },
  {
    id: 'kanagawa',
    group: 'editor',
    label: 'Kanagawa',
    hint: 'Lotus and Wave, ink and woodblock',
    swatch: {
      light: { background: '#f2ecbc', card: '#e7dba0', primary: '#446091' },
      dark: { background: '#1f1f28', card: '#2a2a37', primary: '#7e9cd8' },
    },
  },
  {
    id: 'material',
    group: 'editor',
    label: 'Material',
    hint: 'Material Lighter and Palenight',
    swatch: {
      light: { background: '#fafafa', card: '#f0f0f0', primary: '#4e6ea2' },
      dark: { background: '#292d3e', card: '#2f3447', primary: '#82aaff' },
    },
  },
  {
    id: 'monokai',
    group: 'editor',
    label: 'Monokai Pro',
    hint: 'Monokai Pro and its Light filter',
    swatch: {
      light: { background: '#faf4f2', card: '#ede7e5', primary: '#a25300' },
      dark: { background: '#2d2a2e', card: '#353236', primary: '#ffd866' },
    },
  },
  {
    id: 'moonlight',
    group: 'editor',
    label: 'Moonlight',
    hint: 'Moonlight II; light derived',
    swatch: {
      light: { background: '#f5f6fc', card: '#eceef9', primary: '#3b64d3' },
      dark: { background: '#222436', card: '#272a3e', primary: '#82aaff' },
    },
  },
  {
    id: 'night-owl',
    group: 'editor',
    label: 'Night Owl',
    hint: 'Light Owl and Night Owl',
    swatch: {
      light: { background: '#fbfbfb', card: '#f0f0f0', primary: '#3c68c7' },
      dark: { background: '#011627', card: '#0b2942', primary: '#82aaff' },
    },
  },
  {
    id: 'nightfox',
    group: 'editor',
    label: 'Nightfox',
    hint: 'Dayfox and Nightfox',
    swatch: {
      light: { background: '#f6f2ee', card: '#efe8e2', primary: '#2848a9' },
      dark: { background: '#192330', card: '#1e2a38', primary: '#719cd6' },
    },
  },
  {
    id: 'nord',
    group: 'editor',
    label: 'Nord',
    hint: 'Arctic blue-grey; Snow Storm light',
    swatch: {
      light: { background: '#eceff4', card: '#e5e9f0', primary: '#486b94' },
      dark: { background: '#2e3440', card: '#343b48', primary: '#88c0d0' },
    },
  },
  {
    id: 'oceanic-next',
    group: 'editor',
    label: 'Oceanic Next',
    hint: 'Oceanic Next; light derived',
    swatch: {
      light: { background: '#f5f7fa', card: '#e9edf2', primary: '#2e6ead' },
      dark: { background: '#1b2b34', card: '#22333d', primary: '#6a9dd0' },
    },
  },
  {
    id: 'one',
    group: 'editor',
    label: 'One',
    hint: 'Atom One Light and One Dark',
    swatch: {
      light: { background: '#fafafa', card: '#f0f0f1', primary: '#3066df' },
      dark: { background: '#282c34', card: '#2c313a', primary: '#61afef' },
    },
  },
  {
    id: 'oxocarbon',
    group: 'editor',
    label: 'Oxocarbon',
    hint: 'IBM Carbon greys, pink and blue',
    swatch: {
      light: { background: '#ffffff', card: '#f2f4f8', primary: '#0f62fe' },
      dark: { background: '#161616', card: '#1f1f1f', primary: '#78a9ff' },
    },
  },
  {
    id: 'papercolor',
    group: 'editor',
    label: 'PaperColor',
    hint: 'Material-inspired paper and charcoal',
    swatch: {
      light: { background: '#eeeeee', card: '#e4e4e4', primary: '#005faf' },
      dark: { background: '#1c1c1c', card: '#262626', primary: '#5fafd7' },
    },
  },
  {
    id: 'poimandres',
    group: 'editor',
    label: 'Poimandres',
    hint: 'Poimandres; light derived',
    swatch: {
      light: { background: '#f4f6fb', card: '#e9edf6', primary: '#2c6db2' },
      dark: { background: '#1b1e28', card: '#212530', primary: '#add7ff' },
    },
  },
  {
    id: 'rose-pine',
    group: 'editor',
    label: 'Rosé Pine',
    hint: 'Dawn and main, iris accent',
    swatch: {
      light: { background: '#faf4ed', card: '#f2e9e1', primary: '#76608e' },
      dark: { background: '#191724', card: '#1f1d2e', primary: '#c4a7e7' },
    },
  },
  {
    id: 'selenized',
    group: 'editor',
    label: 'Selenized',
    hint: 'Solarized, re-balanced for contrast',
    swatch: {
      light: { background: '#fbf3db', card: '#ece3cc', primary: '#0064c5' },
      dark: { background: '#103c48', card: '#184956', primary: '#66b5ff' },
    },
  },
  {
    id: 'solarized',
    group: 'editor',
    label: 'Solarized',
    hint: 'Solarized light and dark, blue accent',
    swatch: {
      light: { background: '#fdf6e3', card: '#eee8d5', primary: '#006cb1' },
      dark: { background: '#002b36', card: '#073642', primary: '#3f9fe8' },
    },
  },
  {
    id: 'sonokai',
    group: 'editor',
    label: 'Sonokai',
    hint: 'Sonokai; light derived',
    swatch: {
      light: { background: '#f7f7f8', card: '#ececef', primary: '#067495' },
      dark: { background: '#2c2e34', card: '#33353f', primary: '#76cce0' },
    },
  },
  {
    id: 'synthwave',
    group: 'editor',
    label: "Synthwave '84",
    hint: "Synthwave '84; light derived",
    swatch: {
      light: { background: '#fbf6ff', card: '#f2e9fa', primary: '#b0198c' },
      dark: { background: '#262335', card: '#2a2139', primary: '#ff7edb' },
    },
  },
  {
    id: 'tokyo-night',
    group: 'editor',
    label: 'Tokyo Night',
    hint: 'Tokyo Night Day and Night',
    swatch: {
      light: { background: '#e1e2e7', card: '#d6d8df', primary: '#005ac3' },
      dark: { background: '#1a1b26', card: '#1f2030', primary: '#7aa2f7' },
    },
  },
  {
    id: 'tomorrow',
    group: 'editor',
    label: 'Tomorrow',
    hint: 'Tomorrow and Tomorrow Night',
    swatch: {
      light: { background: '#ffffff', card: '#f5f5f5', primary: '#4271ae' },
      dark: { background: '#1d1f21', card: '#232528', primary: '#81a2be' },
    },
  },
  {
    id: 'vesper',
    group: 'editor',
    label: 'Vesper',
    hint: 'Vesper peach and mint; light derived',
    swatch: {
      light: { background: '#fafaf9', card: '#f1f0ee', primary: '#a35a14' },
      dark: { background: '#101010', card: '#161616', primary: '#ffc799' },
    },
  },
  {
    id: 'zenburn',
    group: 'editor',
    label: 'Zenburn',
    hint: 'Low-contrast warm grey; light derived',
    swatch: {
      light: { background: '#f5f5ec', card: '#ebebdf', primary: '#387376' },
      dark: { background: '#3f3f3f', card: '#464646', primary: '#8cd0d3' },
    },
  },
]

/** A stored `fleet.palette` value → a known palette (anything else → Default). */
export function parsePalette(v: string | null | undefined): PaletteId {
  return PALETTES.some((p) => p.id === v) ? (v as PaletteId) : DEFAULT_PALETTE
}

export function paletteById(id: PaletteId): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}

/** Folds case and accents, so "rose" finds Rosé Pine. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** The picker's filter: palettes whose label, hint or id contain every word of `query` (any order). */
export function filterPalettes(query: string, list: readonly Palette[] = PALETTES): Palette[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return [...list]
  return list.filter((p) => {
    const text = fold(`${p.label} ${p.hint} ${p.id}`)
    return words.every((w) => text.includes(w))
  })
}

/** meta theme-color for a palette + mode: its page background. */
export const themeColor = (id: PaletteId, mode: PaletteMode) => paletteById(id).swatch[mode].background
