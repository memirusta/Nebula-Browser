const HOME_MENU_RESET_KEY = 'nebula-home-menu-reset-v1'

const LEGACY_SESSION_KEYS = ['nebula-browse-sessions-v1'] as const

interface HomeMenuStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

/**
 * Historical one-time cleanup. Never overwrite the current pin/session keys:
 * a missing migration marker can happen after profile repair or partial
 * storage restore and must not erase otherwise valid user data.
 */
export function resetHomeMenuStorageOnce(
  storage: HomeMenuStorage = localStorage,
): void {
  if (storage.getItem(HOME_MENU_RESET_KEY)) return

  for (const key of LEGACY_SESSION_KEYS) {
    storage.removeItem(key)
  }

  storage.setItem(HOME_MENU_RESET_KEY, '1')
}
