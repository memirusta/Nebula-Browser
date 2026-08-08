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
  startedAtMs: number
}

export type DownloadAction = 'pause' | 'resume' | 'cancel' | 'open' | 'reveal'

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

export function isDownloadActive(download: DownloadItem): boolean {
  return download.state === 'in_progress' || download.state === 'paused'
}

export function downloadProgress(download: DownloadItem): number | null {
  if (download.totalBytes <= 0) return null
  return Math.max(0, Math.min(100, (download.receivedBytes / download.totalBytes) * 100))
}
