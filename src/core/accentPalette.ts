/**
 * Everything coloured in Nebula that follows the accent is worked out here, from the one colour the person picks.
 *
 * - the strong end (the darker end of the accent gradient, and the pressed or hovered look),
 * - the soft background, the border and the glow of the accent,
 * - the text that sits on the accent (white or dark, whichever reads),
 * - the "ink": the accent as a line, an icon or text, moved lighter on a dark theme and darker on a light one until it
 *   reads (4.5:1) on the cards of that theme, so a deep accent that makes a good button still shows as a ring or a link,
 * - the secondary colour (a neighbour of the accent in hue), used for the second line of a chart.
 *
 * Kept free of imports so tests can read it as it is.
 */

export type PaletteMode = 'dark' | 'light' | 'forest'

/** What text and lines have to read on, per theme: the colour of a card. */
export const CARD_COLOR: Record<PaletteMode, string> = {
  dark: '#1b1e2b',
  light: '#ffffff',
  forest: '#12241a',
}

export interface AccentSet {
  accent: string
  strong: string
  /** "r, g, b" of the accent, for `rgba(var(--nebula-accent-rgb), 0.3)`. */
  rgb: string
  dim: string
  glow: string
  soft: string
  border: string
  /** Text or an icon on a fill of the accent. */
  on: string
  /** The accent as a line, an icon or text: it reads on a card of the theme. */
  ink: string
  secondary: string
  gradient: string
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function hexToRgb(hex: string): [number, number, number] {
  let value = hex.trim().replace('#', '')
  if (value.length === 3) value = [...value].map((c) => c + c).join('')
  const n = Number.parseInt(value.slice(0, 6), 16)
  if (!Number.isFinite(n)) return [126, 200, 227]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255
  g /= 255
  b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return [h, s, l]
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (hue < 60) [r, g, b] = [c, x, 0]
  else if (hue < 120) [r, g, b] = [x, c, 0]
  else if (hue < 180) [r, g, b] = [0, c, x]
  else if (hue < 240) [r, g, b] = [0, x, c]
  else if (hue < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function hsl(h: number, s: number, l: number): string {
  return rgbToHex(...hslToRgb(h, clamp(s, 0, 1), clamp(l, 0, 1)))
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** White or near-black, whichever reads better on this fill. */
export function onColor(fill: string): string {
  return contrastRatio(fill, '#ffffff') >= contrastRatio(fill, '#0b0f1a') ? '#ffffff' : '#0b0f1a'
}

/**
 * The colour as a line, an icon or text on a card of the theme: unchanged when it already reads, else moved lighter
 * (dark theme) or darker (light theme) in small steps, keeping its hue and saturation.
 */
export function readableInk(color: string, mode: PaletteMode, target = 4.5): string {
  const card = CARD_COLOR[mode]
  if (contrastRatio(color, card) >= target) return color
  const [h, s, l] = rgbToHsl(...hexToRgb(color))
  const step = mode === 'light' ? -0.01 : 0.01
  let next = color
  let lightness = l
  for (let i = 0; i < 100 && contrastRatio(next, card) < target; i += 1) {
    lightness = clamp(lightness + step, 0.04, 0.96)
    next = hsl(h, s, lightness)
  }
  return next
}

export function deriveAccentSet(accent: string, mode: PaletteMode): AccentSet {
  const [r, g, b] = hexToRgb(accent)
  const [h, s, l] = rgbToHsl(r, g, b)
  const strong = hsl(h, s, l * (mode === 'light' ? 0.86 : 0.8))
  const rgb = `${r}, ${g}, ${b}`
  return {
    accent,
    strong,
    rgb,
    dim: `rgba(${rgb}, 0.35)`,
    glow: `rgba(${rgb}, 0.55)`,
    soft: `rgba(${rgb}, 0.14)`,
    border: `rgba(${rgb}, 0.42)`,
    on: onColor(accent),
    ink: readableInk(accent, mode),
    secondary: readableInk(hsl(h + 42, s, l), mode, 3),
    gradient: `linear-gradient(135deg, ${strong}, ${accent})`,
  }
}
