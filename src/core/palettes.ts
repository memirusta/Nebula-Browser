/**
 * The ready palettes: an accent (a lighter variant for the dark themes, a deeper one for the light theme), a detail
 * colour, and the tint of the neutrals (the backgrounds and cards). "Default" is the colours each theme brings, nothing
 * written; "Indigo" is a palette like the others. Choosing one sets the accent, the detail colour and the neutral tint; any of them can be
 * changed afterwards.
 *
 * Kept free of imports so tests can read it as it is.
 */

export type PaletteId = 'default' | 'indigo' | 'ocean' | 'emerald' | 'rose' | 'amber' | 'graphite'

export interface PaletteDef {
  id: PaletteId
  /** Null: the theme's own accent (the default). */
  dark: string | null
  light: string | null
  /** Null: the default detail colour. */
  gold: string | null
  /** Hue of the neutrals in degrees; -1 is the theme's own neutrals. */
  hue: number
  /** Colourfulness of the neutrals, 0 (grey) to 0.6. */
  sat: number
}

export const PALETTES: readonly PaletteDef[] = [
  { id: 'default', dark: null, light: null, gold: null, hue: -1, sat: 0.35 },
  { id: 'indigo', dark: '#8b8ffb', light: '#4f46e5', gold: null, hue: 233, sat: 0.35 },
  { id: 'ocean', dark: '#38bdf8', light: '#0284c7', gold: '#fcd34d', hue: 205, sat: 0.38 },
  { id: 'emerald', dark: '#34d399', light: '#059669', gold: '#fbbf24', hue: 160, sat: 0.32 },
  { id: 'rose', dark: '#fb7185', light: '#e11d48', gold: '#fcd34d', hue: 345, sat: 0.3 },
  { id: 'amber', dark: '#fbbf24', light: '#d97706', gold: '#fde68a', hue: 35, sat: 0.3 },
  { id: 'graphite', dark: '#a1a1aa', light: '#52525b', gold: '#d4c48a', hue: 240, sat: 0.06 },
]

/** What a palette writes to the settings for a theme. Null stands for "the default". */
export function paletteValues(def: PaletteDef, theme: 'dark' | 'light' | 'forest') {
  return {
    accent: theme === 'light' ? def.light : def.dark,
    gold: def.gold,
    hue: def.hue,
    sat: def.sat,
  }
}

/** Whether the settings are this palette (either variant of its accent counts, whichever theme is on). */
export function paletteMatches(
  def: PaletteDef,
  settings: { accentColor: string; goldColor: string; neutralHue: number },
  defaults: { accentColor: string; goldColor: string },
): boolean {
  const same = (a: string, b: string | null) => a.toLowerCase() === (b ?? '').toLowerCase()
  const accentOk = def.dark === null
    ? same(settings.accentColor, defaults.accentColor)
    : same(settings.accentColor, def.dark) || same(settings.accentColor, def.light)
  const goldOk = same(settings.goldColor, def.gold ?? defaults.goldColor)
  return accentOk && goldOk && settings.neutralHue === def.hue
}
