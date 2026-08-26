import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Shortcut } from '../core/types'
import { persistLocalStorage, useStorageSync } from '../core/storageSync'
import {
  addPinnedShortcut,
  LEGACY_PINNED_SHORTCUT_KEYS,
  loadPinnedShortcutIds,
  loadPinnedShortcuts,
  MAX_PINNED_SHORTCUTS,
  PINNED_SHORTCUTS_KEY,
  PINNED_SHORTCUTS_SCHEMA_VERSION,
  reconcilePinnedShortcuts,
  removePinnedShortcut,
  serializePinnedShortcuts,
  shortcutFromPinnedShortcut,
  updatePinnedShortcutFavicon,
  type PinnedShortcutsSnapshot,
} from '../core/pinnedShortcuts'

export {
  PINNED_SHORTCUTS_KEY,
  MAX_PINNED_SHORTCUTS,
  loadPinnedShortcutIds,
}

/** Home pinned strip starts empty; user pins shortcuts manually. */
export function usePinnedShortcuts(allShortcuts: Shortcut[]) {
  const [snapshot, setSnapshot] = useState<PinnedShortcutsSnapshot>(() =>
    loadPinnedShortcuts(allShortcuts),
  )

  const reloadPinnedShortcuts = useCallback(() => {
    const next = loadPinnedShortcuts(allShortcuts)
    setSnapshot((prev) =>
      JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
    )
  }, [allShortcuts])

  useStorageSync(PINNED_SHORTCUTS_KEY, reloadPinnedShortcuts)
  useStorageSync(LEGACY_PINNED_SHORTCUT_KEYS[0], reloadPinnedShortcuts)
  useStorageSync(LEGACY_PINNED_SHORTCUT_KEYS[1], reloadPinnedShortcuts)
  useStorageSync(LEGACY_PINNED_SHORTCUT_KEYS[2], reloadPinnedShortcuts)
  useStorageSync(LEGACY_PINNED_SHORTCUT_KEYS[3], reloadPinnedShortcuts)

  useEffect(() => {
    setSnapshot((prev) => reconcilePinnedShortcuts(prev, allShortcuts))
  }, [allShortcuts])

  useEffect(() => {
    persistLocalStorage(PINNED_SHORTCUTS_KEY, serializePinnedShortcuts(snapshot))
  }, [snapshot])

  const pinnedShortcuts = useMemo(
    () => snapshot.pins.map(shortcutFromPinnedShortcut),
    [snapshot.pins],
  )
  const pinnedIds = useMemo(
    () => snapshot.pins.map((pin) => pin.id),
    [snapshot.pins],
  )
  const isPinned = useCallback(
    (id: string) => snapshot.pins.some((pin) => pin.id === id),
    [snapshot.pins],
  )
  const canPinMore = snapshot.pins.length < MAX_PINNED_SHORTCUTS

  const pinShortcut = useCallback(
    (shortcut: Shortcut) => {
      const result = addPinnedShortcut(snapshot.pins, shortcut)
      if (!result.accepted) return false
      setSnapshot((prev) => ({
        ...prev,
        pins: addPinnedShortcut(prev.pins, shortcut).pins,
      }))
      return true
    },
    [snapshot.pins],
  )

  const unpinShortcut = useCallback((id: string) => {
    setSnapshot((prev) => ({
      ...prev,
      pins: removePinnedShortcut(prev.pins, id),
      unresolvedLegacyIds: prev.unresolvedLegacyIds.filter((legacyId) => legacyId !== id),
    }))
  }, [])

  const togglePin = useCallback(
    (shortcut: Shortcut) => {
      if (isPinned(shortcut.id)) {
        unpinShortcut(shortcut.id)
        return true
      }
      return pinShortcut(shortcut)
    },
    [isPinned, pinShortcut, unpinShortcut],
  )

  const refreshPinnedFavicon = useCallback(
    (id: string, currentUrl: string, favicon: string) => {
      setSnapshot((prev) => {
        const pins = updatePinnedShortcutFavicon(
          prev.pins,
          id,
          currentUrl,
          favicon,
        )
        return pins === prev.pins ? prev : { ...prev, pins }
      })
    },
    [],
  )

  const reorderPins = useCallback((fromIndex: number, toIndex: number) => {
    setSnapshot((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.pins.length ||
        toIndex >= prev.pins.length ||
        fromIndex === toIndex
      ) {
        return prev
      }
      const pins = [...prev.pins]
      const [moved] = pins.splice(fromIndex, 1)
      if (!moved) return prev
      pins.splice(toIndex, 0, moved)
      return { ...prev, pins }
    })
  }, [])

  const resetPins = useCallback(() => {
    setSnapshot({
      schemaVersion: PINNED_SHORTCUTS_SCHEMA_VERSION,
      pins: [],
      unresolvedLegacyIds: [],
    })
  }, [])

  const pinShortcuts = useCallback((shortcuts: Shortcut[]) => {
    if (shortcuts.length === 0) return
    setSnapshot((prev) => {
      let pins = prev.pins
      for (const shortcut of shortcuts) {
        pins = addPinnedShortcut(pins, shortcut).pins
      }
      return pins === prev.pins ? prev : { ...prev, pins }
    })
  }, [])

  return {
    pinnedShortcuts,
    pinnedIds,
    isPinned,
    canPinMore,
    pinShortcut,
    unpinShortcut,
    togglePin,
    refreshPinnedFavicon,
    reorderPins,
    resetPins,
    pinShortcuts,
    reloadPinnedIds: reloadPinnedShortcuts,
    reloadPinnedShortcuts,
  }
}
