/**
 * The theme a new profile starts with: the one the device is set to (light or dark), so the app looks like the rest of
 * Windows until the person chooses. Forest stays a choice, it is no longer the default. A profile that already has a theme
 * keeps it; this only fills in where none was stored.
 */
export function deviceTheme(
  matchMedia: ((query: string) => { matches: boolean }) | undefined = typeof window === 'undefined' ? undefined : window.matchMedia?.bind(window),
): 'dark' | 'light' {
  try {
    return matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}
