import { persistLocalStorage } from './storageSync'

export const PINNED_SHORTCUTS_KEY = 'nebula-pinned-shortcuts-v4'
export const MAX_PINNED_SHORTCUTS = 12

const LEGACY_PINNED_KEYS = [
  'nebula-pinned-shortcuts-v3',
  'nebula-pinned-shortcuts-v2',
  'nebula-pinned-shortcuts-v1',
] as const

export function loadPinnedShortcutIds(): string[] {
  for (const key of [PINNED_SHORTCUTS_KEY, ...LEGACY_PINNED_KEYS]) {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) continue

      const ids = parsed.slice(0, MAX_PINNED_SHORTCUTS)
      if (key !== PINNED_SHORTCUTS_KEY) {
        localStorage.removeItem(key)
        persistLocalStorage(PINNED_SHORTCUTS_KEY, JSON.stringify(ids))
      }
      return ids
    } catch {
      /* try next key */
    }
  }
  return []
}
