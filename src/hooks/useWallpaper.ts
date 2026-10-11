import { useCallback, useEffect, useRef, useState } from 'react'
import { clearWallpaper, fileToStorableWallpaper } from '../core/wallpaperStorage'
import {
  DEFAULT_WALLPAPER_CONFIG,
  WALLPAPER_CONFIG_KEY,
  loadWallpaperConfig,
  normalizeWallpaperConfig,
  persistWallpaperConfig,
  type WallpaperConfig,
} from '../core/wallpaperConfig'
import {
  clearImportedVideoWallpapers,
  pickAndImportVideoWallpaper,
  WALLPAPER_SELECTION_KEY,
  withWallpaperMutation,
} from '../platform/wallpaperMedia'
import { showAppAlert } from '../core/appDialog'
import { loadLocale } from '../core/locale'

function wallpaperError(tr: string, en: string): void {
  void showAppAlert(loadLocale() === 'tr' ? tr : en)
}

async function cleanupVideo(path: string | null, keep: string | null): Promise<void> {
  if (!path || path === keep) return
  // A failed cleanup may leave an unused file, but must not undo a saved choice.
  await clearImportedVideoWallpapers([path]).catch(() => undefined)
}

export function useWallpaper() {
  const [wallpaper, setWallpaperState] = useState<WallpaperConfig>(loadWallpaperConfig)
  const selectionRef = useRef<string | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    const onStorage = (event: StorageEvent) => {
      if (event.key === WALLPAPER_CONFIG_KEY || event.key === null) {
        setWallpaperState(loadWallpaperConfig())
      }
    }
    window.addEventListener('storage', onStorage)
    return () => {
      mountedRef.current = false
      selectionRef.current = null
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  const isCurrent = useCallback((id: string) => {
    try {
      return mountedRef.current && selectionRef.current === id &&
        localStorage.getItem(WALLPAPER_SELECTION_KEY) === id
    } catch {
      return false
    }
  }, [])

  const beginSelection = useCallback(() => {
    const id = crypto.randomUUID()
    selectionRef.current = id
    const ready = withWallpaperMutation(() => {
      if (mountedRef.current && selectionRef.current === id) {
        try {
          localStorage.setItem(WALLPAPER_SELECTION_KEY, id)
        } catch {
          wallpaperError('Duvar kağıdı ayarları kaydedilemedi.', 'Wallpaper settings could not be saved.')
        }
      }
    })
    return { id, ready }
  }, [])

  const save = useCallback(async (next: WallpaperConfig): Promise<boolean> => {
    const previous = loadWallpaperConfig()
    if (!persistWallpaperConfig(next)) return false
    if (mountedRef.current) setWallpaperState(next)
    await cleanupVideo(previous.videoPath, next.videoPath)
    return true
  }, [])

  const commit = useCallback(async (next: WallpaperConfig): Promise<boolean> => {
    const selection = beginSelection()
    await selection.ready
    return withWallpaperMutation(() =>
      isCurrent(selection.id) ? save(normalizeWallpaperConfig(next)) : false,
    )
  }, [beginSelection, isCurrent, save])

  const updateWallpaper = useCallback(async (patch: Partial<WallpaperConfig>): Promise<boolean> => {
    const changesSource = 'mode' in patch || 'imageUrl' in patch || 'videoPath' in patch
    const selection = changesSource ? beginSelection() : null
    await selection?.ready
    return withWallpaperMutation(() => {
      if (!mountedRef.current || (selection && !isCurrent(selection.id))) return false
      const current = loadWallpaperConfig()
      return save(normalizeWallpaperConfig({
        ...current,
        ...patch,
        position: patch.position ? { ...current.position, ...patch.position } : current.position,
      }))
    })
  }, [beginSelection, isCurrent, save])

  const pickWallpaper = useCallback(() => {
    const selection = beginSelection()
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      await selection.ready
      await withWallpaperMutation(async () => {
        if (!isCurrent(selection.id)) return
        const stored = await fileToStorableWallpaper(file, () => isCurrent(selection.id))
        if (!isCurrent(selection.id)) return
        if (!stored) {
          wallpaperError('Duvar kağıdı kaydedilemedi. Daha küçük bir görsel deneyin.',
            'The wallpaper could not be saved. Try a smaller image.')
          return
        }
        if (!await save(normalizeWallpaperConfig({ ...loadWallpaperConfig(), mode: 'image', imageUrl: stored }))) {
          wallpaperError('Duvar kağıdı ayarları kaydedilemedi.', 'Wallpaper settings could not be saved.')
        }
      })
    }
    input.click()
  }, [beginSelection, isCurrent, save])

  const pickVideoWallpaper = useCallback(async () => {
    const selection = beginSelection()
    await selection.ready
    try {
      if (!isCurrent(selection.id)) return
      const path = await pickAndImportVideoWallpaper(() => isCurrent(selection.id))
      if (!path) return
      await withWallpaperMutation(async () => {
        if (!isCurrent(selection.id)) {
          await cleanupVideo(path, loadWallpaperConfig().videoPath)
          return
        }
        const next = normalizeWallpaperConfig({ ...loadWallpaperConfig(), mode: 'video', videoPath: path })
        if (!await save(next)) {
          await cleanupVideo(path, loadWallpaperConfig().videoPath)
          wallpaperError('Hareketli duvar kağıdı ayarları kaydedilemedi.',
            'Animated wallpaper settings could not be saved.')
        }
      })
    } catch {
      if (isCurrent(selection.id)) {
        wallpaperError('Video duvar kağıdı içe aktarılamadı.', 'The animated wallpaper could not be imported.')
      }
    }
  }, [beginSelection, isCurrent, save])

  const resetWallpaper = useCallback(async () => {
    const selection = beginSelection()
    await selection.ready
    await withWallpaperMutation(async () => {
      if (!isCurrent(selection.id)) return
      // Commit defaults before removing the current file. If storage is full
      // or unavailable, the existing selection and its file remain usable.
      if (!await save(normalizeWallpaperConfig(DEFAULT_WALLPAPER_CONFIG))) {
        wallpaperError('Duvar kağıdı sıfırlanamadı.', 'The wallpaper could not be reset.')
        return
      }
      clearWallpaper()
    })
  }, [beginSelection, isCurrent, save])

  return { wallpaper, setWallpaper: commit, updateWallpaper, pickWallpaper, pickVideoWallpaper, resetWallpaper }
}
