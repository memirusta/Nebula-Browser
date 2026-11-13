import type { WallpaperConfig, AmbientWallpaperPreset } from '../../core/wallpaperConfig'
import styles from './OnboardingWizard.module.css'

interface Props {
  config: WallpaperConfig
  /** The label, own-image, own-video and hint texts, in the person's language. */
  text: {
    wallpaperLabel: string
    wallpaperOwnImage: string
    wallpaperOwnVideo: string
    wallpaperHint: string
  }
  onChange: (patch: Partial<WallpaperConfig>) => void
  onPickImage: () => void
  onPickVideo: () => void
}

const PRESETS: Array<{ id: AmbientWallpaperPreset; name: string }> = [
  { id: 'nebula', name: 'Nebula' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'liquid', name: 'Liquid' },
]

/** The words for what is chosen, for the summary at the end: the moving background's name, or the person's own. */
export function wallpaperChoiceLabel(
  config: WallpaperConfig,
  text: { wallpaperOwnImage: string; wallpaperOwnVideo: string },
): string {
  if (config.mode === 'image' && config.imageUrl) return text.wallpaperOwnImage
  if (config.mode === 'video' && config.videoPath) return text.wallpaperOwnVideo
  return PRESETS.find((preset) => preset.id === config.ambientPreset)?.name ?? PRESETS[0].name
}

/**
 * The background of the home screen, chosen on the first run: the four moving backgrounds Nebula draws itself,
 * or a picture or video of the person's own. The choice is applied at once, the same way Settings applies it.
 */
export function OnboardingWallpaperPicker({ config, text, onChange, onPickImage, onPickVideo }: Props) {
  const imageChosen = config.mode === 'image' && Boolean(config.imageUrl)
  const videoChosen = config.mode === 'video' && Boolean(config.videoPath)

  return (
    <div className={styles.wallpaperPicker} role="group" aria-label={text.wallpaperLabel}>
      <span className={styles.wallpaperLabel}>{text.wallpaperLabel}</span>
      <div className={styles.wallpaperTiles}>
        {PRESETS.map((preset) => {
          const selected = config.mode === 'ambient' && config.ambientPreset === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              className={styles.wallpaperTile}
              data-preset={preset.id}
              data-selected={selected}
              aria-pressed={selected}
              onClick={() => onChange({ mode: 'ambient', ambientPreset: preset.id })}
            >
              <span className={styles.wallpaperBlobs} aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              <span className={styles.wallpaperName}>{preset.name}</span>
            </button>
          )
        })}
      </div>
      <div className={styles.wallpaperOwn}>
        <button
          type="button"
          className={styles.wallpaperOwnBtn}
          data-selected={imageChosen}
          aria-pressed={imageChosen}
          onClick={onPickImage}
        >
          {text.wallpaperOwnImage}
        </button>
        <button
          type="button"
          className={styles.wallpaperOwnBtn}
          data-selected={videoChosen}
          aria-pressed={videoChosen}
          onClick={onPickVideo}
        >
          {text.wallpaperOwnVideo}
        </button>
      </div>
      <p className={styles.wallpaperHint}>{text.wallpaperHint}</p>
    </div>
  )
}
