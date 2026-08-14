import {
  useMemo,
  useRef,
  type PointerEvent,
} from 'react'
import type {
  AmbientWallpaperPreset,
  WallpaperConfig,
  WallpaperFit,
  WallpaperMode,
} from '../../core/wallpaperConfig'
import {
  videoWallpaperFileName,
  videoWallpaperUrl,
} from '../../platform/wallpaperMedia'
import { useLocale } from '../../hooks/useLocale'
import styles from './WallpaperSettingsSection.module.css'

interface WallpaperSettingsSectionProps {
  config: WallpaperConfig
  onChange: (
    patch:
      Partial<WallpaperConfig>,
  ) => void
  onPickImage: () => void
  onPickVideo: () => void
  onReset: () => void
}

const MODE_OPTIONS:
  WallpaperMode[] = [
    'image',
    'video',
    'ambient',
  ]

const AMBIENT_PRESETS:
  AmbientWallpaperPreset[] = [
    'nebula',
    'aurora',
    'midnight',
    'liquid',
  ]

const COPY = {
  en: {
    wallpaper:
      'Wallpaper',
    hint:
      'Image, animated video, or a lightweight ambient background.',
    image:
      'Image',
    video:
      'Animated',
    ambient:
      'Ambient',
    chooseImage:
      'Choose image',
    chooseVideo:
      'Choose video',
    noVideo:
      'No video selected',
    videoHint:
      '4K / 60 FPS files are accepted. Playback pauses outside Home.',
    fit:
      'Fit',
    cover:
      'Fill',
    contain:
      'Fit inside',
    position:
      'Position',
    positionHint:
      'Drag the preview to choose which part stays centered when the window changes shape.',
    ambientPreset:
      'Preset',
    intensity:
      'Intensity',
    speed:
      'Speed',
    reset:
      'Reset wallpaper',
  },

  tr: {
    wallpaper:
      'Duvar kağıdı',
    hint:
      'Görsel, hareketli video veya hafif bir ambient arka plan.',
    image:
      'Görsel',
    video:
      'Hareketli',
    ambient:
      'Ambient',
    chooseImage:
      'Görsel seç',
    chooseVideo:
      'Video seç',
    noVideo:
      'Video seçilmedi',
    videoHint:
      '4K / 60 FPS dosyalar kabul edilir. Home dışında oynatma durur.',
    fit:
      'Yerleşim',
    cover:
      'Doldur',
    contain:
      'Sığdır',
    position:
      'Konum',
    positionHint:
      'Pencere şekli değiştiğinde hangi kısmın merkezde kalacağını seçmek için önizlemeyi sürükle.',
    ambientPreset:
      'Preset',
    intensity:
      'Yoğunluk',
    speed:
      'Hız',
    reset:
      'Duvar kağıdını sıfırla',
  },
} as const

function percentageFromPointer(
  event:
    PointerEvent<HTMLDivElement>,
): {
  x: number
  y: number
} {
  const rect =
    event.currentTarget
      .getBoundingClientRect()

  const x =
    (
      (
        event.clientX -
        rect.left
      ) /
      Math.max(
        1,
        rect.width,
      )
    ) *
    100

  const y =
    (
      (
        event.clientY -
        rect.top
      ) /
      Math.max(
        1,
        rect.height,
      )
    ) *
    100

  return {
    x:
      Math.min(
        100,
        Math.max(
          0,
          x,
        ),
      ),

    y:
      Math.min(
        100,
        Math.max(
          0,
          y,
        ),
      ),
  }
}

export function WallpaperSettingsSection({
  config,
  onChange,
  onPickImage,
  onPickVideo,
  onReset,
}: WallpaperSettingsSectionProps) {
  const { locale } =
    useLocale()

  const copy =
    COPY[locale]

  const draggingRef =
    useRef(false)

  const videoUrl =
    useMemo(
      () =>
        videoWallpaperUrl(
          config.videoPath,
        ),
      [
        config.videoPath,
      ],
    )

  const position =
    `${config.position.x}% ${config.position.y}%`

  const updatePosition =
    (
      event:
        PointerEvent<HTMLDivElement>,
    ) => {
      const next =
        percentageFromPointer(
          event,
        )

      onChange({
        position:
          next,
      })
    }

  const previewStyle =
    config.mode ===
      'image' &&
    config.imageUrl
      ? {
          backgroundImage:
            `url(${config.imageUrl})`,
          backgroundSize:
            config.fit,
          backgroundPosition:
            position,
        }
      : undefined

  return (
    <section
      className={
        styles.section
      }
    >
      <div
        className={
          styles.heading
        }
      >
        <div>
          <div
            className={
              styles.title
            }
          >
            {
              copy.wallpaper
            }
          </div>

          <div
            className={
              styles.hint
            }
          >
            {copy.hint}
          </div>
        </div>

        <button
          type="button"
          className={
            styles.resetButton
          }
          onClick={
            onReset
          }
        >
          {copy.reset}
        </button>
      </div>

      <div
        className={
          styles.modeTabs
        }
      >
        {MODE_OPTIONS.map(
          (mode) => (
            <button
              key={
                mode
              }
              type="button"
              className={[
                styles.modeButton,

                config.mode ===
                  mode
                  ? styles.modeButtonActive
                  : '',
              ]
                .filter(
                  Boolean,
                )
                .join(
                  ' ',
                )}
              onClick={() =>
                onChange({
                  mode,
                })
              }
            >
              {
                mode ===
                'image'
                  ? copy.image
                  : mode ===
                      'video'
                    ? copy.video
                    : copy.ambient
              }
            </button>
          ),
        )}
      </div>

      <div
        className={
          styles.preview
        }
        style={
          previewStyle
        }
        data-mode={
          config.mode
        }
        data-preset={
          config.ambientPreset
        }
        onPointerDown={(
          event,
        ) => {
          if (
            config.mode ===
            'ambient'
          ) {
            return
          }

          draggingRef.current =
            true

          event.currentTarget
            .setPointerCapture(
              event.pointerId,
            )

          updatePosition(
            event,
          )
        }}
        onPointerMove={(
          event,
        ) => {
          if (
            !draggingRef.current ||
            config.mode ===
              'ambient'
          ) {
            return
          }

          updatePosition(
            event,
          )
        }}
        onPointerUp={(
          event,
        ) => {
          draggingRef.current =
            false

          if (
            event.currentTarget
              .hasPointerCapture(
                event.pointerId,
              )
          ) {
            event.currentTarget
              .releasePointerCapture(
                event.pointerId,
              )
          }
        }}
      >
        {config.mode ===
          'video' &&
          videoUrl && (
            <video
              className={
                styles.previewVideo
              }
              src={
                videoUrl
              }
              muted
              playsInline
              preload="metadata"
              style={{
                objectFit:
                  config.fit,

                objectPosition:
                  position,
              }}
            />
          )}

        {config.mode ===
          'ambient' && (
            <>
              <span
                className={
                  styles.previewAmbientA
                }
              />

              <span
                className={
                  styles.previewAmbientB
                }
              />

              <span
                className={
                  styles.previewAmbientC
                }
              />
            </>
          )}

        {config.mode !==
          'ambient' && (
          <span
            className={
              styles.focalPoint
            }
            style={{
              left:
                `${config.position.x}%`,

              top:
                `${config.position.y}%`,
            }}
          />
        )}
      </div>

      {config.mode ===
        'image' && (
        <button
          type="button"
          className={
            styles.primaryAction
          }
          onClick={
            onPickImage
          }
        >
          {
            copy.chooseImage
          }
        </button>
      )}

      {config.mode ===
        'video' && (
        <div
          className={
            styles.videoRow
          }
        >
          <div
            className={
              styles.videoText
            }
          >
            <strong>
              {config.videoPath
                ? videoWallpaperFileName(
                    config.videoPath,
                  )
                : copy.noVideo}
            </strong>

            <span>
              {
                copy.videoHint
              }
            </span>
          </div>

          <button
            type="button"
            className={
              styles.primaryAction
            }
            onClick={
              onPickVideo
            }
          >
            {
              copy.chooseVideo
            }
          </button>
        </div>
      )}

      {config.mode !==
        'ambient' && (
        <>
          <div
            className={
              styles.controlRow
            }
          >
            <span>
              {copy.fit}
            </span>

            <div
              className={
                styles.fitButtons
              }
            >
              {(
                [
                  'cover',
                  'contain',
                ] as WallpaperFit[]
              ).map(
                (fit) => (
                  <button
                    key={
                      fit
                    }
                    type="button"
                    className={[
                      styles.fitButton,

                      config.fit ===
                        fit
                        ? styles.fitButtonActive
                        : '',
                    ]
                      .filter(
                        Boolean,
                      )
                      .join(
                        ' ',
                      )}
                    onClick={() =>
                      onChange({
                        fit,
                      })
                    }
                  >
                    {fit ===
                    'cover'
                      ? copy.cover
                      : copy.contain}
                  </button>
                ),
              )}
            </div>
          </div>

          <div
            className={
              styles.positionHint
            }
          >
            <strong>
              {
                copy.position
              }
            </strong>

            <span>
              {
                copy.positionHint
              }
            </span>
          </div>
        </>
      )}

      {config.mode ===
        'ambient' && (
        <>
          <div
            className={
              styles.ambientPresets
            }
          >
            <span>
              {
                copy.ambientPreset
              }
            </span>

            <div>
              {AMBIENT_PRESETS.map(
                (
                  preset,
                ) => (
                  <button
                    key={
                      preset
                    }
                    type="button"
                    className={[
                      styles.presetButton,

                      config.ambientPreset ===
                        preset
                        ? styles.presetButtonActive
                        : '',
                    ]
                      .filter(
                        Boolean,
                      )
                      .join(
                        ' ',
                      )}
                    onClick={() =>
                      onChange({
                        ambientPreset:
                          preset,
                      })
                    }
                  >
                    {
                      preset[0]
                        .toUpperCase() +
                      preset.slice(
                        1,
                      )
                    }
                  </button>
                ),
              )}
            </div>
          </div>

          <label
            className={
              styles.rangeRow
            }
          >
            <span>
              {
                copy.intensity
              }
            </span>

            <input
              type="range"
              min="25"
              max="100"
              step="1"
              value={
                Math.round(
                  config.ambientIntensity *
                    100,
                )
              }
              onChange={(
                event,
              ) =>
                onChange({
                  ambientIntensity:
                    Number(
                      event.target
                        .value,
                    ) /
                    100,
                })
              }
            />
          </label>

          <label
            className={
              styles.rangeRow
            }
          >
            <span>
              {copy.speed}
            </span>

            <input
              type="range"
              min="25"
              max="200"
              step="5"
              value={
                Math.round(
                  config.ambientSpeed *
                    100,
                )
              }
              onChange={(
                event,
              ) =>
                onChange({
                  ambientSpeed:
                    Number(
                      event.target
                        .value,
                    ) /
                    100,
                })
              }
            />
          </label>
        </>
      )}
    </section>
  )
}
