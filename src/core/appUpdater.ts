import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { isTauri } from '../platform/runtime'

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'uptodate'
  | 'available'
  | 'downloading'
  | 'error'

export interface AppUpdateStatus {
  phase: AppUpdatePhase
  version?: string
  notes?: string
  progress?: number
  message?: string
}

export function isAppUpdaterAvailable(): boolean {
  return isTauri
}

const DISMISSED_UPDATE_VERSION_KEY = 'nebula-update-dismissed-v1'

export function dismissAppUpdateVersion(version: string): void {
  localStorage.setItem(DISMISSED_UPDATE_VERSION_KEY, version.trim())
}

export function isAppUpdateDismissed(version: string): boolean {
  return localStorage.getItem(DISMISSED_UPDATE_VERSION_KEY) === version.trim()
}

function updaterErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string') return error
  return 'Güncelleme kontrol edilemedi.'
}

export async function checkForAppUpdate(): Promise<{
  update: Update | null
  status: AppUpdateStatus
}> {
  if (!isTauri) {
    return {
      update: null,
      status: {
        phase: 'error',
        message: 'Güncelleme yalnızca masaüstü uygulamasında kullanılabilir.',
      },
    }
  }

  try {
    const update = await check()
    if (!update) {
      return { update: null, status: { phase: 'uptodate' } }
    }

    return {
      update,
      status: {
        phase: 'available',
        version: update.version,
        notes: update.body ?? undefined,
      },
    }
  } catch (error) {
    return {
      update: null,
      status: {
        phase: 'error',
        message: updaterErrorMessage(error),
      },
    }
  }
}

export async function installAppUpdate(
  update: Update,
  onProgress: (percent: number) => void,
): Promise<AppUpdateStatus> {
  try {
    let downloaded = 0
    let contentLength = 0

    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case 'Started':
          contentLength = event.data.contentLength ?? 0
          onProgress(0)
          break
        case 'Progress':
          downloaded += event.data.chunkLength
          onProgress(
            contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 0,
          )
          break
        case 'Finished':
          onProgress(100)
          break
      }
    })

    await relaunch()
    return { phase: 'idle' }
  } catch (error) {
    return {
      phase: 'error',
      message: error instanceof Error ? error.message : 'Güncelleme yüklenemedi.',
    }
  }
}
