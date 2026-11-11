import { useState, type ReactNode } from 'react'
import { DEFAULT_ACCENT_COLOR, type NebulaSettings } from '../../core/nebulaSettings'
import type { AmbientWallpaperPreset, WallpaperConfig } from '../../core/wallpaperConfig'
import { ColorSpectrum } from './ColorSpectrum'
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

/** The detail colour (the welcome text, the window buttons): the first is what every install started with. */
const DETAILS = ['#d4c48a', '#fcd34d', '#fb923c', '#f472b6', '#a3e635', '#94a3b8']

interface Props {
  title: { theme: string; wallpaper: string; accent: string; detail: string; detailHint: string }
  themeLabels: Record<Theme, string>
  ownImage: string
  ownVideo: string
  accentDefault: string
  customColor: string
  spectrumLabels: { shade: string; hue: string; hex: string }
  theme: Theme
  onTheme: (theme: Theme) => void
  wallpaper: WallpaperConfig
  onWallpaper: (patch: Partial<WallpaperConfig>) => void
  onPickImage: () => void
  onPickVideo: () => void
  accentColor: string
  onAccent: (color: string) => void
  detailColor: string
  onDetail: (color: string) => void
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
 * A row of colours to choose from and, after them, a plain "+" circle that opens the colour picker under the row. When
 * the colour is none of the choices, that circle is filled with it.
 */
function ColorChoice({
  title,
  hint,
  colors,
  firstLabel,
  value,
  onChange,
  customColor,
  spectrumLabels,
}: {
  title: string
  hint?: string
  colors: readonly string[]
  /** The name of the first colour, when it is the theme's own. */
  firstLabel?: string
  value: string
  onChange: (color: string) => void
  customColor: string
  spectrumLabels: { shade: string; hue: string; hex: string }
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const customChosen = !colors.some((color) => color.toLowerCase() === value.toLowerCase())

  return (
    <Section title={title}>
      {hint && <p className={styles.sectionHint}>{hint}</p>}
      <div className={styles.accents} role="group" aria-label={title}>
        {colors.map((color, index) => {
          const selected = value.toLowerCase() === color.toLowerCase()
          const name = index === 0 && firstLabel ? firstLabel : color
          return (
            <button
              key={color}
              type="button"
              className={styles.swatch}
              data-selected={selected}
              aria-pressed={selected}
              aria-label={name}
              title={name}
              style={{ background: color }}
              onClick={() => onChange(color)}
            />
          )
        })}
        <button
          type="button"
          className={`${styles.swatch} ${styles.customSwatch}`}
          data-selected={customChosen}
          aria-pressed={customChosen}
          aria-expanded={pickerOpen}
          aria-label={customColor}
          title={customColor}
          style={customChosen ? { background: value, borderStyle: 'solid', borderColor: 'transparent' } : undefined}
          onClick={() => setPickerOpen((current) => !current)}
        >
          {!customChosen && (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
        </button>
      </div>
      {pickerOpen && (
        <div className={styles.picker}>
          <ColorSpectrum value={value} onChange={onChange} labels={spectrumLabels} />
        </div>
      )}
    </Section>
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

      <ColorChoice
        title={props.title.accent}
        colors={ACCENTS}
        firstLabel={props.accentDefault}
        value={props.accentColor}
        onChange={props.onAccent}
        customColor={props.customColor}
        spectrumLabels={props.spectrumLabels}
      />

      <ColorChoice
        title={props.title.detail}
        hint={props.title.detailHint}
        colors={DETAILS}
        value={props.detailColor}
        onChange={props.onDetail}
        customColor={props.customColor}
        spectrumLabels={props.spectrumLabels}
      />
    </div>
  )
}
