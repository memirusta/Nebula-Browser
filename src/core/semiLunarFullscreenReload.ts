const SEMI_LUNAR_FULLSCREEN_RELOAD_KEY =
  'nebula-semi-lunar-fullscreen-reload-v1'

export interface SemiLunarSessionStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function currentSessionStorage(): SemiLunarSessionStorage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** Preserve the current runtime layout across the Chrome WebView's F11 reload. */
export function markSemiLunarFullscreenReload(
  storage: SemiLunarSessionStorage | null = currentSessionStorage(),
): void {
  try {
    storage?.setItem(SEMI_LUNAR_FULLSCREEN_RELOAD_KEY, '1')
  } catch {
    // A blocked storage surface must not prevent the native fullscreen toggle.
  }
}

/**
 * A fullscreen compositor reload is not an application restart. Restore the
 * live layout once even when ordinary startup session restoration is disabled.
 */
export function shouldRestoreSemiLunarLayout(
  rememberLayout: boolean,
  storage: SemiLunarSessionStorage | null = currentSessionStorage(),
): boolean {
  if (rememberLayout) return true

  try {
    return storage?.getItem(SEMI_LUNAR_FULLSCREEN_RELOAD_KEY) === '1'
  } catch {
    return false
  }
}

export function clearSemiLunarFullscreenReload(
  storage: SemiLunarSessionStorage | null = currentSessionStorage(),
): void {
  try {
    storage?.removeItem(SEMI_LUNAR_FULLSCREEN_RELOAD_KEY)
  } catch {
    // The marker is best-effort and scoped to this WebView session.
  }
}
