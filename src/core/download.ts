import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri } from '../platform/runtime'

export type DownloadState =
  | 'in_progress'
  | 'paused'
  | 'completed'
  | 'interrupted'
  | 'cancelled'

export interface DownloadItem {
  id: string
  tabLabel: string
  sourceUrl: string
  fileName: string
  filePath: string
  mimeType: string
  totalBytes: number
  receivedBytes: number
  state: DownloadState
  interruptReason: number
  canResume: boolean
  paused: boolean
  dangerReason: 'dangerous_file_type' | null
  requiresConfirmation: boolean
  startedAtMs: number
  /** False for a tab that never showed a page: it was opened for the download and only that. */
  tabShownPage?: boolean
}

export type DownloadAction =
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'retry'
  | 'keep'
  | 'delete'
  | 'open'
  | 'reveal'

export function listenDownloads(
  onUpdate: (download: DownloadItem) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {})
  return listen<DownloadItem>('nebula-download-updated', ({ payload }) => onUpdate(payload))
}

export async function controlDownload(id: string, action: DownloadAction): Promise<void> {
  if (!isTauri) return
  await invoke('download_control', { id, action })
}

export async function startDownloadDrag(id: string): Promise<void> {
  if (!isTauri) return
  await invoke('download_start_drag', { id })
}

export function isDownloadActive(download: DownloadItem): boolean {
  return download.state === 'in_progress' || download.state === 'paused'
}

export function canRemoveDownloadFromList(download: DownloadItem): boolean {
  return !isDownloadActive(download) && !download.requiresConfirmation
}

export function downloadProgress(download: DownloadItem): number | null {
  if (download.totalBytes <= 0) return null
  return Math.max(0, Math.min(100, (download.receivedBytes / download.totalBytes) * 100))
}
