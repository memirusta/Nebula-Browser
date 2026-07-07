import { BROWSE_SESSIONS_KEY } from './browseSession'
import { PINNED_SHORTCUTS_KEY } from '../hooks/usePinnedShortcuts'

const HOME_MENU_RESET_KEY = 'nebula-home-menu-reset-v1'

const LEGACY_PIN_KEYS = [
  'nebula-pinned-shortcuts-v1',
  'nebula-pinned-shortcuts-v2',
  'nebula-pinned-shortcuts-v3',
] as const

const LEGACY_SESSION_KEYS = ['nebula-browse-sessions-v1'] as const

/** One-time wipe of stored home pins and browse sessions (user-requested clean slate). */
export function resetHomeMenuStorageOnce(): void {
  if (localStorage.getItem(HOME_MENU_RESET_KEY)) return

  for (const key of LEGACY_PIN_KEYS) {
    localStorage.removeItem(key)
  }
  localStorage.setItem(PINNED_SHORTCUTS_KEY, '[]')

  for (const key of LEGACY_SESSION_KEYS) {
    localStorage.removeItem(key)
  }
  localStorage.setItem(BROWSE_SESSIONS_KEY, '{}')

  localStorage.setItem(HOME_MENU_RESET_KEY, '1')
}
