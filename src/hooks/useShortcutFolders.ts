import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Shortcut, ShortcutFolder } from '../core/types'
import { folderDockId } from '../core/types'
import { persistLocalStorage, useStorageSync } from '../core/storageSync'

export const SHORTCUT_FOLDERS_KEY = 'nebula-shortcut-folders-v1'

interface StoredFolders {
  folders: ShortcutFolder[]
}

function loadFolders(): StoredFolders {
  try {
    const raw = localStorage.getItem(SHORTCUT_FOLDERS_KEY)
    if (raw) return JSON.parse(raw) as StoredFolders
  } catch {
    /* ignore */
  }
  return { folders: [] }
}

function newFolderId(): string {
  return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export type RemoveMemberResult =
  | { action: 'updated' }
  | { action: 'dissolved'; remainingMemberId: string }

export function useShortcutFolders(visibleShortcuts: Shortcut[]) {
  const [folders, setFolders] = useState<ShortcutFolder[]>(() => loadFolders().folders)

  const reloadFolders = useCallback(() => {
    setFolders(loadFolders().folders)
  }, [])

  useStorageSync(SHORTCUT_FOLDERS_KEY, reloadFolders)

  useEffect(() => {
    persistLocalStorage(SHORTCUT_FOLDERS_KEY, JSON.stringify({ folders }))
  }, [folders])

  const visibleIds = useMemo(
    () => new Set(visibleShortcuts.map((s) => s.id)),
    [visibleShortcuts],
  )

  const memberIds = useMemo(() => {
    const set = new Set<string>()
    for (const f of folders) {
      for (const id of f.members) {
        if (visibleIds.has(id)) set.add(id)
      }
    }
    return set
  }, [folders, visibleIds])

  const topLevelShortcutIds = useMemo(
    () => visibleShortcuts.filter((s) => !memberIds.has(s.id)).map((s) => s.id),
    [visibleShortcuts, memberIds],
  )

  const dockItemIds = useMemo(
    () => [...topLevelShortcutIds, ...folders.map((f) => folderDockId(f.id))],
    [topLevelShortcutIds, folders],
  )

  const shortcutById = useMemo(() => {
    const map = new Map<string, Shortcut>()
    for (const s of visibleShortcuts) map.set(s.id, s)
    return map
  }, [visibleShortcuts])

  const folderById = useMemo(() => {
    const map = new Map<string, ShortcutFolder>()
    for (const f of folders) map.set(f.id, f)
    return map
  }, [folders])

  const createFolderFromShortcuts = useCallback(
    (sourceId: string, targetId: string, name?: string): string | null => {
      if (sourceId === targetId) return null
      if (!visibleIds.has(sourceId) || !visibleIds.has(targetId)) return null
      if (memberIds.has(sourceId) || memberIds.has(targetId)) return null

      const folderId = newFolderId()
      const labelA = shortcutById.get(targetId)?.label ?? 'Klasör'
      const folder: ShortcutFolder = {
        id: folderId,
        name: name ?? labelA,
        members: [targetId, sourceId],
      }
      setFolders((prev) => [...prev, folder])
      return folderDockId(folderId)
    },
    [visibleIds, memberIds, shortcutById],
  )

  const addShortcutToFolder = useCallback(
    (folderDockItemId: string, shortcutId: string): boolean => {
      const folderId = folderDockItemId.replace(/^folder:/, '')
      const folder = folderById.get(folderId)
      if (!folder) return false
      if (!visibleIds.has(shortcutId)) return false
      if (memberIds.has(shortcutId)) return false
      if (folder.members.includes(shortcutId)) return false

      setFolders((prev) =>
        prev.map((f) =>
          f.id === folderId ? { ...f, members: [...f.members, shortcutId] } : f,
        ),
      )
      return true
    },
    [folderById, visibleIds, memberIds],
  )

  const removeShortcutFromFolders = useCallback((shortcutId: string) => {
    setFolders((prev) => {
      const next = prev
        .map((f) => ({ ...f, members: f.members.filter((id) => id !== shortcutId) }))
        .filter((f) => f.members.length > 0)
      return next
    })
  }, [])

  const dissolveFolder = useCallback((folderId: string) => {
    setFolders((prev) => prev.filter((f) => f.id !== folderId))
  }, [])

  const renameFolder = useCallback((folderId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    setFolders((prev) =>
      prev.map((f) => (f.id === folderId ? { ...f, name: trimmed } : f)),
    )
  }, [])

  const removeMemberFromFolder = useCallback(
    (folderId: string, shortcutId: string): RemoveMemberResult | null => {
      const folder = folderById.get(folderId)
      if (!folder || !folder.members.includes(shortcutId)) return null

      const nextMembers = folder.members.filter((id) => id !== shortcutId)
      if (nextMembers.length === 0) {
        setFolders((prev) => prev.filter((f) => f.id !== folderId))
        return { action: 'dissolved', remainingMemberId: '' }
      }
      if (nextMembers.length === 1) {
        setFolders((prev) => prev.filter((f) => f.id !== folderId))
        return { action: 'dissolved', remainingMemberId: nextMembers[0] }
      }
      setFolders((prev) =>
        prev.map((f) =>
          f.id === folderId ? { ...f, members: nextMembers } : f,
        ),
      )
      return { action: 'updated' }
    },
    [folderById],
  )

  const resetFolders = useCallback(() => {
    setFolders([])
  }, [])

  return {
    folders,
    dockItemIds,
    topLevelShortcutIds,
    shortcutById,
    folderById,
    createFolderFromShortcuts,
    addShortcutToFolder,
    removeShortcutFromFolders,
    removeMemberFromFolder,
    dissolveFolder,
    renameFolder,
    resetFolders,
  }
}
