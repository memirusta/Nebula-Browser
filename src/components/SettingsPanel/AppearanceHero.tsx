import { useState, type ReactNode } from 'react'
import { DEFAULT_ACCENT_COLOR, type NebulaSettings } from '../../core/nebulaSettings'
import type { AmbientWallpaperPreset, WallpaperConfig } from '../../core/wallpaperConfig'
import { toneColor, toneFromColor } from '../../core/accentPalette'
import { PALETTES } from '../../core/palettes'
import { ColorSpectrum } from './ColorSpectrum'
import styles from './AppearanceHero.module.css'

type Theme = NebulaSettings['appearance']['theme']

/** What a theme looks like, drawn small: its background, its card and its accent. */
const THEMES: Array<{ id: Theme; bg: string; card: string; accent: string }> = [
  { id: 'dark', bg: '#09090b', card: '#18181b', accent: '#7ec8e3' },
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

/** The tones to choose from: the theme's own first (it has no tone of its own), then the tone of each ready palette. */
function tonesFor(theme: Theme) {
  // The dark theme's own neutrals are black (a grey swatch); the light theme's are a pale indigo.
  const own = { hue: -1, sat: 0.35, color: theme === 'dark' ? toneColor(0, 0) : toneColor(233, 0.35) }
  return { own, tones: [own, ...PALETTES.slice(1).map((p) => ({ hue: p.hue, sat: p.sat, color: toneColor(p.hue, p.sat) }))] }
}

export interface PaletteTile {
  id: string
  label: string
  /** What it looks like, in the colours of the theme that is on. */
  accent: string
  detail: string
  neutral: string
  selected: boolean
}

interface Props {
  palettes: PaletteTile[]
  onPalette: (id: string) => void
  title: { theme: string; wallpaper: string; palette: string; accent: string; detail: string; detailHint: string; tone: string }
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
  /** The tint of the backgrounds and cards: a hue in degrees (-1: the theme's own) and a colourfulness. */
  toneHue: number
  toneSat: number
  onTone: (hue: number, sat: number) => void
  /** What the pickers show while they are dragged, before the colour is saved. */
  onPreview: { accent: (color: string) => void; detail: (color: string) => void; tone: (hue: number, sat: number) => void }
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
  onPreview,
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
  /** Shown while the picker is dragged; onChange saves the colour when the drag ends. */
  onPreview?: (color: string) => void
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
          <ColorSpectrum value={value} onChange={onChange} onPreview={onPreview} labels={spectrumLabels} />
        </div>
      )}
    </Section>
  )
}

/**
 * The tint of the backgrounds and cards, chosen apart from the palettes: the theme's own, the tone of each palette, or
 * any colour from the picker (only its hue and colourfulness count). The picker keeps the colour that was picked, so
 * its marker does not jump to the tone's middle brightness while it is dragged.
 */
function ToneChoice(props: Pick<Props, 'toneHue' | 'toneSat' | 'onTone' | 'customColor' | 'spectrumLabels' | 'theme'> & { title: string; ownLabel: string; onPreviewTone: (hue: number, sat: number) => void }) {
  const [picked, setPicked] = useState<string | null>(null)
  const { own: OWN_TONE, tones: TONES } = tonesFor(props.theme)
  const toneOf = (hex: string) => TONES.find((tone) => tone.color === hex) ?? { ...toneFromColor(hex), color: hex }
  const current = props.toneHue < 0 ? OWN_TONE.color : toneColor(props.toneHue, props.toneSat)
  const pickedTone = picked ? toneOf(picked) : null
  const shown =
    picked && pickedTone && pickedTone.hue === props.toneHue && (pickedTone.hue < 0 || pickedTone.sat === props.toneSat) ? picked : current

  return (
    <ColorChoice
      title={props.title}
      colors={TONES.map((tone) => tone.color)}
      firstLabel={props.ownLabel}
      value={shown}
      onChange={(hex) => {
        setPicked(hex)
        const tone = toneOf(hex)
        props.onTone(tone.hue, tone.hue < 0 ? props.toneSat : tone.sat)
      }}
      onPreview={(hex) => {
        const tone = toneOf(hex)
        props.onPreviewTone(tone.hue, tone.hue < 0 ? props.toneSat : tone.sat)
      }}
      customColor={props.customColor}
      spectrumLabels={props.spectrumLabels}
    />
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

      <Section title={props.title.palette}>
        <div className={styles.palettes} role="group" aria-label={props.title.palette}>
          {props.palettes.map((palette) => (
            <button
              key={palette.id}
              type="button"
              className={styles.paletteTile}
              data-selected={palette.selected}
              aria-pressed={palette.selected}
              onClick={() => props.onPalette(palette.id)}
            >
              <span className={styles.paletteShot} style={{ background: palette.neutral }} aria-hidden="true">
                <i style={{ background: palette.accent }} />
                <i style={{ background: palette.detail }} />
              </span>
              <span className={styles.tileName}>{palette.label}</span>
            </button>
          ))}
        </div>
      </Section>

      <ColorChoice
        title={props.title.accent}
        colors={ACCENTS}
        firstLabel={props.accentDefault}
        value={props.accentColor}
        onChange={props.onAccent}
        onPreview={props.onPreview.accent}
        customColor={props.customColor}
        spectrumLabels={props.spectrumLabels}
      />

      <ColorChoice
        title={props.title.detail}
        hint={props.title.detailHint}
        colors={DETAILS}
        value={props.detailColor}
        onChange={props.onDetail}
        onPreview={props.onPreview.detail}
        customColor={props.customColor}
        spectrumLabels={props.spectrumLabels}
      />

      {props.theme !== 'forest' && (
        <ToneChoice
          title={props.title.tone}
          ownLabel={props.accentDefault}
          theme={props.theme}
          toneHue={props.toneHue}
          toneSat={props.toneSat}
          onTone={props.onTone}
          onPreviewTone={props.onPreview.tone}
          customColor={props.customColor}
          spectrumLabels={props.spectrumLabels}
        />
      )}
    </div>
  )
}
