export interface Shortcut {
  id: string
  label: string
  url: string
  favicon?: string
}

export interface ShortcutFolder {
  id: string
  name: string
  members: string[]
}

export const FOLDER_ID_PREFIX = 'folder:'

export function isFolderDockId(id: string): boolean {
  return id.startsWith(FOLDER_ID_PREFIX)
}

export function folderDockId(folderId: string): string {
  return `${FOLDER_ID_PREFIX}${folderId}`
}

export function parseFolderDockId(dockId: string): string {
  return dockId.slice(FOLDER_ID_PREFIX.length)
}

export interface SystemStats {
  ramPercent: number
  ramUsedGb: number
  ramTotalGb: number
  cpuPercent: number
  ramHistory: number[]
  cpuHistory: number[]
}

export interface UserProfile {
  name: string
  avatarUrl?: string
}

export type WallpaperSource = string | 'default'
