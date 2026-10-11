import {
  convertFileSrc,
  invoke,
} from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { isTauri } from './runtime'

const VIDEO_EXTENSIONS = [
  'mp4',
  'webm',
  'm4v',
  'mov',
]

export const WALLPAPER_SELECTION_KEY = 'nebula-wallpaper-selection-v1'
let fallbackMutation: Promise<unknown> = Promise.resolve()

/** One origin-wide queue coordinates wallpaper mutations in every shell window. */
export function withWallpaperMutation<T>(operation: () => T | Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('nebula-wallpaper-mutation', operation)
  }
  const pending = fallbackMutation.catch(() => undefined).then(operation)
  fallbackMutation = pending
  return pending
}

export async function pickAndImportVideoWallpaper(isCurrent: () => boolean = () => true):
  Promise<string | null> {
  if (!isTauri) {
    return null
  }

  const selected =
    await open({
      multiple: false,
      directory: false,
      title:
        'Choose animated wallpaper',
      filters: [
        {
          name:
            'Video',
          extensions:
            VIDEO_EXTENSIONS,
        },
      ],
    })

  if (
    !isCurrent() ||
    !selected ||
    Array.isArray(
      selected,
    )
  ) {
    return null
  }

  return invoke<string>(
    'wallpaper_import_video',
    {
      sourcePath:
        selected,
    },
  )
}

export async function clearImportedVideoWallpapers(paths: string[]):
  Promise<void> {
  if (!isTauri || paths.length === 0) {
    return
  }

  await invoke<void>(
    'wallpaper_clear_videos',
    { paths },
  )
}

export function videoWallpaperUrl(
  filePath:
    string |
    null |
    undefined,
): string | null {
  if (
    !filePath ||
    !isTauri
  ) {
    return null
  }

  return convertFileSrc(
    filePath,
  )
}

export function videoWallpaperFileName(
  filePath:
    string |
    null |
    undefined,
): string {
  if (!filePath) {
    return ''
  }

  return (
    filePath
      .split(
        /[\\/]/,
      )
      .filter(
        Boolean,
      )
      .at(-1) ??
    filePath
  )
}
