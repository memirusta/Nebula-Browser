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

export async function pickAndImportVideoWallpaper():
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

export async function clearImportedVideoWallpapers():
  Promise<void> {
  if (!isTauri) {
    return
  }

  await invoke<void>(
    'wallpaper_clear_videos',
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
