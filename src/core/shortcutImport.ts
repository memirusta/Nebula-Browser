import {
  findShortcutByHost,
  hostKeyForShortcut,
  mergeShortcutLists,
} from './shortcutFromUrl'
import type { Shortcut } from './types'
import { persistLocalStorage } from './storageSync'
import {
  importShortcutsToPreferences,
  loadShortcutPreferences,
  SHORTCUT_PREFERENCES_KEY,
} from './shortcutPreferences'
import {
  addPinnedShortcut,
  loadPinnedShortcuts,
  MAX_PINNED_SHORTCUTS,
  PINNED_SHORTCUTS_KEY,
  serializePinnedShortcuts,
} from './pinnedShortcuts'

export function applyImportedShortcutsSync(
  defaultShortcuts: Shortcut[],
  incoming: Shortcut[],
  pinFirst = 8,
): { importedIds: string[] } {
  if (incoming.length === 0) {
    return { importedIds: [] }
  }

  const prev = loadShortcutPreferences(defaultShortcuts)
  const previousPins = loadPinnedShortcuts(
    mergeShortcutLists(defaultShortcuts, prev.custom),
  )
  const protectedIds = new Set([
    ...previousPins.pins.map((pin) => pin.id),
    ...previousPins.unresolvedLegacyIds,
  ])
  const prefs = importShortcutsToPreferences(
    prev,
    defaultShortcuts,
    incoming,
    protectedIds,
  )
  persistLocalStorage(SHORTCUT_PREFERENCES_KEY, JSON.stringify(prefs))

  const merged = mergeShortcutLists(defaultShortcuts, prefs.custom)
  const removedSet = new Set(prefs.removed)
  const visibleIds = new Set(
    merged.filter((shortcut) => !removedSet.has(shortcut.id)).map((shortcut) => shortcut.id),
  )

  const importedIds: string[] = []
  for (const shortcut of incoming) {
    const visitHost = hostKeyForShortcut(shortcut.url)
    const existing = findShortcutByHost(merged, visitHost)
    const id = existing?.id ?? shortcut.id
    if (visibleIds.has(id)) importedIds.push(id)
  }

  if (pinFirst > 0 && importedIds.length > 0) {
    let pins = loadPinnedShortcuts(merged)
    for (const id of importedIds.slice(0, pinFirst)) {
      if (!visibleIds.has(id)) continue
      const shortcut = merged.find((candidate) => candidate.id === id)
      if (!shortcut) continue
      const result = addPinnedShortcut(pins.pins, shortcut)
      if (!result.accepted && pins.pins.length >= MAX_PINNED_SHORTCUTS) break
      pins = { ...pins, pins: result.pins }
    }
    persistLocalStorage(PINNED_SHORTCUTS_KEY, serializePinnedShortcuts(pins))
  }

  return { importedIds }
}
