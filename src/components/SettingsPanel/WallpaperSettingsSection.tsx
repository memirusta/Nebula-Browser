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
import { getLocaleCopy } from '../../core/locale'
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
  es: {
    wallpaper: 'Fondo de pantalla',
    hint: 'Imagen, vídeo animado o fondo ambiental ligero.',
    image: 'Imagen',
    video: 'Animado',
    ambient: 'Ambiental',
    chooseImage: 'Elegir imagen',
    chooseVideo: 'Elegir vídeo',
    noVideo: 'No se ha seleccionado ningún vídeo',
    videoHint: 'Se admiten archivos 4K / 60 FPS. La reproducción se pausa fuera de Inicio.',
    fit: 'Ajuste',
    cover: 'Rellenar',
    contain: 'Encajar',
    position: 'Posición',
    positionHint: 'Arrastra la vista previa para elegir qué parte permanecerá centrada cuando la ventana cambie de forma.',
    ambientPreset: 'Preajuste',
    intensity: 'Intensidad',
    speed: 'Velocidad',
    reset: 'Restablecer fondo',
  },
  de: {
    wallpaper: 'Hintergrundbild',
    hint: 'Bild, animiertes Video oder ein ressourcenschonender Ambient-Hintergrund.',
    image: 'Bild',
    video: 'Animiert',
    ambient: 'Ambient',
    chooseImage: 'Bild auswählen',
    chooseVideo: 'Video auswählen',
    noVideo: 'Kein Video ausgewählt',
    videoHint: '4K-/60-FPS-Dateien werden unterstützt. Außerhalb der Startseite wird die Wiedergabe pausiert.',
    fit: 'Anpassung',
    cover: 'Ausfüllen',
    contain: 'Einpassen',
    position: 'Position',
    positionHint: 'Ziehe die Vorschau, um festzulegen, welcher Bereich bei einer Größenänderung des Fensters zentriert bleibt.',
    ambientPreset: 'Voreinstellung',
    intensity: 'Intensität',
    speed: 'Geschwindigkeit',
    reset: 'Hintergrund zurücksetzen',
  },
  fr: {
    wallpaper: 'Fond d’écran',
    hint: 'Image, vidéo animée ou arrière-plan d’ambiance léger.',
    image: 'Image',
    video: 'Animé',
    ambient: 'Ambiance',
    chooseImage: 'Choisir une image',
    chooseVideo: 'Choisir une vidéo',
    noVideo: 'Aucune vidéo sélectionnée',
    videoHint: 'Les fichiers 4K / 60 FPS sont acceptés. La lecture est mise en pause hors de l’Accueil.',
    fit: 'Ajustement',
    cover: 'Remplir',
    contain: 'Adapter',
    position: 'Position',
    positionHint: 'Faites glisser l’aperçu pour choisir la zone qui reste centrée lorsque la fenêtre change de forme.',
    ambientPreset: 'Préréglage',
    intensity: 'Intensité',
    speed: 'Vitesse',
    reset: 'Réinitialiser le fond d’écran',
  },
  id: {
    wallpaper: 'Wallpaper',
    hint: 'Gambar, video animasi, atau latar ambient yang ringan.',
    image: 'Gambar',
    video: 'Animasi',
    ambient: 'Ambient',
    chooseImage: 'Pilih gambar',
    chooseVideo: 'Pilih video',
    noVideo: 'Tidak ada video yang dipilih',
    videoHint: 'File 4K / 60 FPS didukung. Pemutaran dijeda saat di luar Beranda.',
    fit: 'Penyesuaian',
    cover: 'Penuhi',
    contain: 'Sesuaikan',
    position: 'Posisi',
    positionHint: 'Seret pratinjau untuk memilih bagian yang tetap di tengah saat bentuk jendela berubah.',
    ambientPreset: 'Preset',
    intensity: 'Intensitas',
    speed: 'Kecepatan',
    reset: 'Atur ulang wallpaper',
  },
  ru: {
    wallpaper: 'Фоновое изображение',
    hint: 'Изображение, анимированное видео или лёгкий динамический фон.',
    image: 'Изображение',
    video: 'Анимация',
    ambient: 'Динамический',
    chooseImage: 'Выбрать изображение',
    chooseVideo: 'Выбрать видео',
    noVideo: 'Видео не выбрано',
    videoHint: 'Поддерживаются файлы 4K / 60 FPS. Вне главной страницы воспроизведение приостанавливается.',
    fit: 'Размещение',
    cover: 'Заполнить',
    contain: 'Вместить',
    position: 'Положение',
    positionHint: 'Перетаскивайте предпросмотр, чтобы выбрать область, которая останется по центру при изменении формы окна.',
    ambientPreset: 'Предустановка',
    intensity: 'Интенсивность',
    speed: 'Скорость',
    reset: 'Сбросить фон',
  },
  it: {
    wallpaper: 'Sfondo',
    hint: 'Immagine, video animato o uno sfondo ambient leggero.',
    image: 'Immagine',
    video: 'Animato',
    ambient: 'Ambient',
    chooseImage: 'Scegli immagine',
    chooseVideo: 'Scegli video',
    noVideo: 'Nessun video selezionato',
    videoHint: 'Sono supportati file 4K / 60 FPS. La riproduzione viene sospesa fuori dalla Home.',
    fit: 'Adattamento',
    cover: 'Riempi',
    contain: 'Adatta',
    position: 'Posizione',
    positionHint: 'Trascina l’anteprima per scegliere l’area che resta centrata quando cambia la forma della finestra.',
    ambientPreset: 'Preimpostazione',
    intensity: 'Intensità',
    speed: 'Velocità',
    reset: 'Reimposta sfondo',
  },
  ja: {
    wallpaper: '壁紙',
    hint: '画像、アニメーション動画、軽量なアンビエント背景。',
    image: '画像',
    video: 'アニメーション',
    ambient: 'アンビエント',
    chooseImage: '画像を選択',
    chooseVideo: '動画を選択',
    noVideo: '動画が選択されていません',
    videoHint: '4K / 60 FPS ファイルに対応しています。ホーム以外では再生を一時停止します。',
    fit: '表示方法',
    cover: '全面表示',
    contain: '全体表示',
    position: '位置',
    positionHint: 'プレビューをドラッグして、ウィンドウの形が変わっても中央に保つ領域を選択します。',
    ambientPreset: 'プリセット',
    intensity: '強度',
    speed: '速度',
    reset: '壁紙をリセット',
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
    getLocaleCopy(COPY, locale)

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
