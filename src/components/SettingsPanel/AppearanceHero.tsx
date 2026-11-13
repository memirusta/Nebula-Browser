import type { ReactNode } from 'react'
import { DEFAULT_ACCENT_COLOR, type NebulaSettings } from '../../core/nebulaSettings'
import type { AmbientWallpaperPreset, WallpaperConfig } from '../../core/wallpaperConfig'
import styles from './AppearanceHero.module.css'

type Theme = NebulaSettings['appearance']['theme']

/** What a theme looks like, drawn small: its background, its card and its accent. */
const THEMES: Array<{ id: Theme; bg: string; card: string; accent: string }> = [
  { id: 'dark', bg: '#0c0e19', card: '#1b1e2b', accent: '#8b8ffb' },
  { id: 'light', bg: '#f2f3fb', card: '#ffffff', accent: '#4f46e5' },
  { id: 'forest', bg: '#07110c', card: '#12241a', accent: '#7ec8e3' },
]

const PRESETS: Array<{ id: AmbientWallpaperPreset; name: string }> = [
  { id: 'nebula', name: 'Nebula' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'midnight', name: 'Midnight' },
  { id: 'liquid', name: 'Liquid' },
]

/** The first colour is the theme's own (what the default accent means); the rest are the person's choice. */
const ACCENTS = [DEFAULT_ACCENT_COLOR, '#8b8ffb', '#a78bfa', '#f472b6', '#fb7185', '#fbbf24', '#34d399']

interface Props {
  title: { theme: string; wallpaper: string; accent: string }
  themeLabels: Record<Theme, string>
  ownImage: string
  ownVideo: string
  accentDefault: string
  theme: Theme
  onTheme: (theme: Theme) => void
  wallpaper: WallpaperConfig
  onWallpaper: (patch: Partial<WallpaperConfig>) => void
  onPickImage: () => void
  onPickVideo: () => void
  accentColor: string
  onAccent: (color: string) => void
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

/**
 * The settings people change most, at the top of Appearance and chosen by looking, not by reading a list: the
 * theme as three small pictures of itself, the wallpaper as tiles that move, the accent as colours.
 */
export function AppearanceHero(props: Props) {
  const { wallpaper } = props
  const imageChosen = wallpaper.mode === 'image' && Boolean(wallpaper.imageUrl)
  const videoChosen = wallpaper.mode === 'video' && Boolean(wallpaper.videoPath)

  return (
    <div className={styles.hero}>
      <Section title={props.title.theme}>
        <div className={styles.themes} role="group" aria-label={props.title.theme}>
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={styles.themeTile}
              data-selected={props.theme === item.id}
              aria-pressed={props.theme === item.id}
              onClick={() => props.onTheme(item.id)}
            >
              <span className={styles.themeShot} style={{ background: item.bg }} aria-hidden="true">
                <span className={styles.themeCard} style={{ background: item.card }}>
                  <i style={{ background: item.accent }} />
                  <b style={{ background: item.accent }} />
                </span>
              </span>
              <span className={styles.tileName}>{props.themeLabels[item.id]}</span>
            </button>
          ))}
        </div>
      </Section>

      <Section title={props.title.wallpaper}>
        <div className={styles.wallpapers} role="group" aria-label={props.title.wallpaper}>
          {PRESETS.map((preset) => {
            const selected = wallpaper.mode === 'ambient' && wallpaper.ambientPreset === preset.id
            return (
              <button
                key={preset.id}
                type="button"
                className={styles.wallpaperTile}
                data-preset={preset.id}
                data-selected={selected}
                aria-pressed={selected}
                onClick={() => props.onWallpaper({ mode: 'ambient', ambientPreset: preset.id })}
              >
                <span className={styles.blobs} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
                <span className={styles.tileName}>{preset.name}</span>
              </button>
            )
          })}
          <button
            type="button"
            className={styles.ownTile}
            data-selected={imageChosen}
            aria-pressed={imageChosen}
            onClick={props.onPickImage}
          >
            {props.ownImage}
          </button>
          <button
            type="button"
            className={styles.ownTile}
            data-selected={videoChosen}
            aria-pressed={videoChosen}
            onClick={props.onPickVideo}
          >
            {props.ownVideo}
          </button>
        </div>
      </Section>

      <Section title={props.title.accent}>
        <div className={styles.accents} role="group" aria-label={props.title.accent}>
          {ACCENTS.map((color, index) => {
            const selected = props.accentColor.toLowerCase() === color.toLowerCase()
            return (
              <button
                key={color}
                type="button"
                className={styles.swatch}
                data-selected={selected}
                aria-pressed={selected}
                aria-label={index === 0 ? props.accentDefault : color}
                title={index === 0 ? props.accentDefault : color}
                style={{ background: color }}
                onClick={() => props.onAccent(color)}
              />
            )
          })}
        </div>
      </Section>
    </div>
  )
}
