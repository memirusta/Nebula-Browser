import {
  findShortcutByHost,
  hostKeyForShortcut,
  mergeShortcutLists,
  trimCustomShortcuts,
} from './shortcutFromUrl'
import type { Shortcut } from './types'
import { persistLocalStorage } from './storageSync'
import { SHORTCUT_POSITIONS_KEY } from './shortcutLayout'

export const SHORTCUT_PREFERENCES_KEY = 'nebula-shortcut-preferences-v2'

export interface ShortcutPreferences {
  muted: string[]
  removed: string[]
  custom: Shortcut[]
}

function emptyDockPreferences(defaultShortcuts: Shortcut[]): ShortcutPreferences {
  return {
    muted: [],
    removed: defaultShortcuts.map((shortcut) => shortcut.id),
    custom: [],
  }
}

function parseStoredPreferences(raw: string): ShortcutPreferences | null {
  try {
    const parsed = JSON.parse(raw) as Partial<ShortcutPreferences>
    return {
      muted: Array.isArray(parsed.muted) ? parsed.muted : [],
      removed: Array.isArray(parsed.removed) ? parsed.removed : [],
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
    }
  } catch {
    return null
  }
}

export function loadShortcutPreferences(defaultShortcuts: Shortcut[]): ShortcutPreferences {
  try {
    const raw = localStorage.getItem(SHORTCUT_PREFERENCES_KEY)
    if (raw) {
      const parsed = parseStoredPreferences(raw)
      if (parsed) return parsed
    }

    const legacy = localStorage.getItem('nebula-shortcut-preferences-v1')
    if (legacy) {
      const parsed = parseStoredPreferences(legacy)
      if (parsed) {
        return { ...parsed, custom: [] }
      }
    }
  } catch {
    /* ignore corrupt storage */
  }

  return emptyDockPreferences(defaultShortcuts)
}

/** Fresh installs and untouched legacy prefs start with an empty semi-lunar dock. */
export function migrateToEmptySemiLunarDockOnce(defaultShortcuts: Shortcut[]): void {
  const migrationKey = 'nebula-semi-lunar-empty-dock-v1'
  if (localStorage.getItem(migrationKey)) return

  const emptyPrefs = emptyDockPreferences(defaultShortcuts)

  try {
    const raw = localStorage.getItem(SHORTCUT_PREFERENCES_KEY)
    if (!raw) {
      persistLocalStorage(SHORTCUT_PREFERENCES_KEY, JSON.stringify(emptyPrefs))
    } else {
      const prefs = parseStoredPreferences(raw)
      if (
        prefs &&
        prefs.muted.length === 0 &&
        prefs.removed.length === 0 &&
        prefs.custom.length === 0
      ) {
        persistLocalStorage(SHORTCUT_PREFERENCES_KEY, JSON.stringify(emptyPrefs))
        localStorage.removeItem(SHORTCUT_POSITIONS_KEY)
      }
    }
  } catch {
    persistLocalStorage(SHORTCUT_PREFERENCES_KEY, JSON.stringify(emptyPrefs))
  }

  localStorage.setItem(migrationKey, '1')
}

export function importShortcutsToPreferences(
  prev: ShortcutPreferences,
  defaultShortcuts: Shortcut[],
  incoming: Shortcut[],
): ShortcutPreferences {
  let custom = [...prev.custom]
  let removed = [...prev.removed]

  for (const shortcut of incoming) {
    const merged = mergeShortcutLists(defaultShortcuts, custom)
    const visitHost = hostKeyForShortcut(shortcut.url)
    const existing = findShortcutByHost(merged, visitHost)

    if (existing) {
      removed = removed.filter((id) => id !== existing.id)
      continue
    }

    custom = trimCustomShortcuts([...custom.filter((c) => c.id !== shortcut.id), shortcut])
    removed = removed.filter((id) => id !== shortcut.id)
  }

  return { ...prev, custom, removed }
}
