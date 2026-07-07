import { useCallback, useEffect, useMemo, useState } from 'react'

import {

  findShortcutByHost,

  hostKeyForShortcut,

  isSearchShortcutId,

  mergeShortcutLists,

  shortcutFromUrl,

  trimCustomShortcuts,

} from '../core/shortcutFromUrl'

import type { Shortcut } from '../core/types'

import { persistLocalStorage, useStorageSync } from '../core/storageSync'

import { applyImportedShortcutsSync } from '../core/shortcutImport'

import {

  importShortcutsToPreferences,

  loadShortcutPreferences,

  migrateToEmptySemiLunarDockOnce,

  SHORTCUT_PREFERENCES_KEY,

  type ShortcutPreferences,

} from '../core/shortcutPreferences'



export {

  migrateToEmptySemiLunarDockOnce,

  SHORTCUT_PREFERENCES_KEY,

  loadShortcutPreferences,

  importShortcutsToPreferences,

}



function emptyDockPreferences(defaultShortcuts: Shortcut[]): ShortcutPreferences {

  return {

    muted: [],

    removed: defaultShortcuts.map((shortcut) => shortcut.id),

    custom: [],

  }

}



export function useShortcutPreferences(defaultShortcuts: Shortcut[]) {

  const [prefs, setPrefs] = useState<ShortcutPreferences>(() =>

    loadShortcutPreferences(defaultShortcuts),

  )



  const reloadPreferences = useCallback(() => {

    setPrefs(loadShortcutPreferences(defaultShortcuts))

  }, [defaultShortcuts])



  useStorageSync(SHORTCUT_PREFERENCES_KEY, reloadPreferences)



  useEffect(() => {

    persistLocalStorage(SHORTCUT_PREFERENCES_KEY, JSON.stringify(prefs))

  }, [prefs])



  const mutedSet = useMemo(() => new Set(prefs.muted), [prefs.muted])

  const removedSet = useMemo(() => new Set(prefs.removed), [prefs.removed])



  const allShortcuts = useMemo(

    () => mergeShortcutLists(defaultShortcuts, prefs.custom),

    [defaultShortcuts, prefs.custom],

  )



  const visibleShortcuts = useMemo(

    () => allShortcuts.filter((s) => !removedSet.has(s.id)),

    [allShortcuts, removedSet],

  )



  const addVisitedShortcut = useCallback(

    (rawUrl: string) => {

      const shortcut = shortcutFromUrl(rawUrl)

      if (!shortcut) return



      setPrefs((prev) => {

        const merged = mergeShortcutLists(defaultShortcuts, prev.custom)



        if (isSearchShortcutId(shortcut.id)) {

          const existing = merged.find((s) => s.id === shortcut.id)

          if (existing && !prev.removed.includes(existing.id)) return prev



          const removed = prev.removed.filter((id) => id !== shortcut.id)

          const custom = trimCustomShortcuts([

            ...prev.custom.filter((c) => c.id !== shortcut.id),

            shortcut,

          ])

          return { ...prev, removed, custom }

        }



        const visitHost = hostKeyForShortcut(shortcut.url)

        const existing = findShortcutByHost(merged, visitHost)



        if (existing) {

          if (!prev.removed.includes(existing.id)) return prev

          return {

            ...prev,

            removed: prev.removed.filter((id) => id !== existing.id),

          }

        }



        const removed = prev.removed.filter((id) => {

          const s = merged.find((x) => x.id === id)

          return !(s && hostKeyForShortcut(s.url) === visitHost)

        })

        const custom = trimCustomShortcuts([

          ...prev.custom.filter((c) => c.id !== shortcut.id),

          shortcut,

        ])

        return { ...prev, removed, custom }

      })

    },

    [defaultShortcuts],

  )



  const toggleMute = useCallback((id: string) => {

    setPrefs((prev) => {

      const muted = new Set(prev.muted)

      if (muted.has(id)) muted.delete(id)

      else muted.add(id)

      return { ...prev, muted: [...muted] }

    })

  }, [])



  const removeShortcut = useCallback((id: string) => {

    setPrefs((prev) =>

      prev.removed.includes(id) ? prev : { ...prev, removed: [...prev.removed, id] },

    )

  }, [])



  const isMuted = useCallback((id: string) => mutedSet.has(id), [mutedSet])



  const resetShortcuts = useCallback(() => {

    setPrefs(emptyDockPreferences(defaultShortcuts))

  }, [defaultShortcuts])



  const importShortcuts = useCallback(

    (incoming: Shortcut[]) => {

      if (incoming.length === 0) return []

      setPrefs((prev) => importShortcutsToPreferences(prev, defaultShortcuts, incoming))

      const merged = mergeShortcutLists(defaultShortcuts, incoming)

      return incoming.map((shortcut) => {

        const visitHost = hostKeyForShortcut(shortcut.url)

        const existing = findShortcutByHost(merged, visitHost)

        return existing?.id ?? shortcut.id

      })

    },

    [defaultShortcuts],

  )



  const applyImportedShortcuts = useCallback(

    (incoming: Shortcut[]) => {

      const { importedIds } = applyImportedShortcutsSync(defaultShortcuts, incoming)

      reloadPreferences()

      return importedIds

    },

    [defaultShortcuts, reloadPreferences],

  )



  return {

    visibleShortcuts,

    allShortcuts,

    toggleMute,

    removeShortcut,

    addVisitedShortcut,

    isMuted,

    resetShortcuts,

    importShortcuts,

    applyImportedShortcuts,

    reloadPreferences,

  }

}


