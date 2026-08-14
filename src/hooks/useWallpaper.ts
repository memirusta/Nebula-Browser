import {
  useCallback,
  useState,
} from 'react'
import {
  clearWallpaper,
  fileToStorableWallpaper,
} from '../core/wallpaperStorage'
import {
  DEFAULT_WALLPAPER_CONFIG,
  clearWallpaperConfig,
  loadWallpaperConfig,
  normalizeWallpaperConfig,
  persistWallpaperConfig,
  type WallpaperConfig,
} from '../core/wallpaperConfig'
import {
  clearImportedVideoWallpapers,
  pickAndImportVideoWallpaper,
} from '../platform/wallpaperMedia'
import { showAppAlert } from '../core/appDialog'
import { loadLocale } from '../core/locale'

function wallpaperError(
  tr: string,
  en: string,
): void {
  void showAppAlert(
    loadLocale() ===
      'tr'
      ? tr
      : en,
  )
}

export function useWallpaper() {
  const [
    wallpaper,
    setWallpaperState,
  ] =
    useState<WallpaperConfig>(
      loadWallpaperConfig,
    )

  const commit =
    useCallback(
      (
        next:
          WallpaperConfig,
      ) => {
        const normalized =
          normalizeWallpaperConfig(
            next,
          )

        if (
          !persistWallpaperConfig(
            normalized,
          )
        ) {
          return false
        }

        setWallpaperState(
          normalized,
        )

        return true
      },
      [],
    )

  const updateWallpaper =
    useCallback(
      (
        patch:
          Partial<WallpaperConfig>,
      ) => {
        let committed =
          true

        setWallpaperState(
          (current) => {
            const next =
              normalizeWallpaperConfig({
                ...current,
                ...patch,

                position:
                  patch.position
                    ? {
                        ...current.position,
                        ...patch.position,
                      }
                    : current.position,
              })

            committed =
              persistWallpaperConfig(
                next,
              )

            return committed
              ? next
              : current
          },
        )

        return committed
      },
      [],
    )

  const pickWallpaper =
    useCallback(() => {
      const input =
        document.createElement(
          'input',
        )

      input.type =
        'file'

      input.accept =
        'image/*'

      input.onchange =
        async () => {
          const file =
            input.files?.[0]

          if (!file) {
            return
          }

          const stored =
            await fileToStorableWallpaper(
              file,
            )

          if (!stored) {
            wallpaperError(
              'Duvar kağıdı kaydedilemedi. Daha küçük bir görsel deneyin.',
              'The wallpaper could not be saved. Try a smaller image.',
            )

            return
          }

          setWallpaperState(
            (current) => {
              const next =
                normalizeWallpaperConfig({
                  ...current,
                  mode:
                    'image',
                  imageUrl:
                    stored,
                })

              if (
                !persistWallpaperConfig(
                  next,
                )
              ) {
                wallpaperError(
                  'Duvar kağıdı ayarları kaydedilemedi.',
                  'Wallpaper settings could not be saved.',
                )

                return current
              }

              return next
            },
          )
        }

      input.click()
    }, [])

  const pickVideoWallpaper =
    useCallback(
      async () => {
        try {
          const path =
            await pickAndImportVideoWallpaper()

          if (!path) {
            return
          }

          setWallpaperState(
            (current) => {
              const next =
                normalizeWallpaperConfig({
                  ...current,
                  mode:
                    'video',
                  videoPath:
                    path,
                })

              if (
                !persistWallpaperConfig(
                  next,
                )
              ) {
                wallpaperError(
                  'Hareketli duvar kağıdı ayarları kaydedilemedi.',
                  'Animated wallpaper settings could not be saved.',
                )

                return current
              }

              return next
            },
          )
        } catch (error) {
          if (
            import.meta.env.DEV
          ) {
            console.error(
              '[nebula wallpaper] video import failed',
              error,
            )
          }

          wallpaperError(
            'Video duvar kağıdı içe aktarılamadı.',
            'The animated wallpaper could not be imported.',
          )
        }
      },
      [],
    )

  const resetWallpaper =
    useCallback(() => {
      clearWallpaper()
      clearWallpaperConfig()

      setWallpaperState({
        ...DEFAULT_WALLPAPER_CONFIG,
      })

      void clearImportedVideoWallpapers()
        .catch(
          (error) => {
            if (
              import.meta.env.DEV
            ) {
              console.warn(
                '[nebula wallpaper] video cleanup failed',
                error,
              )
            }
          },
        )
    }, [])

  return {
    wallpaper,
    setWallpaper:
      commit,
    updateWallpaper,
    pickWallpaper,
    pickVideoWallpaper,
    resetWallpaper,
  }
}
