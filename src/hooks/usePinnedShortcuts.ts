import { useCallback, useEffect, useMemo, useState } from 'react'

import type { Shortcut } from '../core/types'

import { persistLocalStorage, useStorageSync } from '../core/storageSync'

import {

  loadPinnedShortcutIds,

  MAX_PINNED_SHORTCUTS,

  PINNED_SHORTCUTS_KEY,

} from '../core/pinnedShortcuts'



export {

  PINNED_SHORTCUTS_KEY,

  MAX_PINNED_SHORTCUTS,

  loadPinnedShortcutIds as loadPinnedShortcutIds,

}



/** Home pinned strip starts empty; user pins shortcuts manually. */

export const DEFAULT_PINNED_IDS: string[] = []



export function usePinnedShortcuts(

  allShortcuts: Shortcut[],

  visibleShortcuts: Shortcut[],

) {

  const [pinnedIds, setPinnedIds] = useState(loadPinnedShortcutIds)



  const reloadPinnedIds = useCallback(() => {

    setPinnedIds(loadPinnedShortcutIds())

  }, [])



  useStorageSync(PINNED_SHORTCUTS_KEY, reloadPinnedIds)



  const catalogIds = useMemo(

    () => new Set(allShortcuts.map((s) => s.id)),

    [allShortcuts],

  )



  const visibleIds = useMemo(

    () => new Set(visibleShortcuts.map((s) => s.id)),

    [visibleShortcuts],

  )



  useEffect(() => {

    persistLocalStorage(PINNED_SHORTCUTS_KEY, JSON.stringify(pinnedIds))

  }, [pinnedIds])



  useEffect(() => {

    setPinnedIds((prev) => {

      const filtered = prev.filter((id) => catalogIds.has(id))

      return filtered.length === prev.length ? prev : filtered

    })

  }, [catalogIds])



  const pinnedShortcuts = useMemo(() => {

    const byId = new Map(allShortcuts.map((s) => [s.id, s]))

    return pinnedIds

      .filter((id) => byId.has(id))

      .map((id) => byId.get(id)!)

  }, [pinnedIds, allShortcuts])



  const isPinned = useCallback((id: string) => pinnedIds.includes(id), [pinnedIds])



  const canPinMore = pinnedIds.length < MAX_PINNED_SHORTCUTS



  const pinShortcut = useCallback(

    (id: string) => {

      if (!visibleIds.has(id)) return false

      setPinnedIds((prev) => {

        if (prev.includes(id)) return prev

        if (prev.length >= MAX_PINNED_SHORTCUTS) return prev

        return [...prev, id]

      })

      return true

    },

    [visibleIds],

  )



  const unpinShortcut = useCallback((id: string) => {

    setPinnedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev))

  }, [])



  const togglePin = useCallback(

    (id: string) => {

      if (isPinned(id)) {

        unpinShortcut(id)

        return true

      }

      return pinShortcut(id)

    },

    [isPinned, pinShortcut, unpinShortcut],

  )



  const reorderPins = useCallback((fromIndex: number, toIndex: number) => {

    setPinnedIds((prev) => {

      if (

        fromIndex < 0 ||

        toIndex < 0 ||

        fromIndex >= prev.length ||

        toIndex >= prev.length ||

        fromIndex === toIndex

      ) {

        return prev

      }

      const next = [...prev]

      const [moved] = next.splice(fromIndex, 1)

      next.splice(toIndex, 0, moved)

      return next

    })

  }, [])



  const resetPins = useCallback(() => {

    setPinnedIds([])

  }, [])



  const pinShortcuts = useCallback(

    (ids: string[]) => {

      if (ids.length === 0) return

      setPinnedIds((prev) => {

        const next = [...prev]

        for (const id of ids) {

          if (!visibleIds.has(id)) continue

          if (next.includes(id)) continue

          if (next.length >= MAX_PINNED_SHORTCUTS) break

          next.push(id)

        }

        return next

      })

    },

    [visibleIds],

  )



  return {

    pinnedShortcuts,

    pinnedIds,

    isPinned,

    canPinMore,

    pinShortcut,

    unpinShortcut,

    togglePin,

    reorderPins,

    resetPins,

    pinShortcuts,

    reloadPinnedIds,

  }

}


