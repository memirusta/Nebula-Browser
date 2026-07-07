import { LEGACY_PREVIEW_ON_HOVER_KEY, SEMI_LUNAR_SETTINGS_KEY } from './semiLunarSettings'
import { isTauri } from '../platform/runtime'
import { TITLE_BAR_HEIGHT, SEMI_LUNAR_HIT_ZONE_HEIGHT } from './windowChrome'

export const NEBULA_SETTINGS_KEY = 'nebula-settings-v1'

export type NebulaTheme = 'forest' | 'dark' | 'light'
export type SearchEngine = 'google' | 'duckduckgo' | 'bing'

export interface AppearanceSettings {
  theme: NebulaTheme
  glassBlurPx: number
  glassSaturate: number
  glassOpacity: number
  accentColor: string
  goldColor: string
  lunarGlassRgb: string
  lunarGlassOpacity: number
  lunarGlassBlurPx: number
}

export type ClockFontFamily = 'system' | 'serif' | 'mono' | 'light'

export const CLOCK_FONT_FAMILIES: Record<ClockFontFamily, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"JetBrains Mono", "Consolas", "Courier New", monospace',
  light: '"Segoe UI Light", "Helvetica Neue", "Arial", sans-serif',
}

export type ModuleSize = 's' | 'm' | 'l'

export interface HomeSettings {
  showSystemWidgets: boolean
  showRamWidget: boolean
  showCpuWidget: boolean
  showClock: boolean
  clockFontSize: number
  clockFontWeight: number
  clockShowDate: boolean
  clockFontFamily: ClockFontFamily
  showGreeting: boolean
  showProfile: boolean
  showPinnedStrip: boolean
  pinnedStripSize: ModuleSize
  searchSize: ModuleSize
  searchOffsetX: number
  searchOffsetY: number
  profileOffsetX: number
  profileOffsetY: number
  showToolbar: boolean
  userDisplayName: string
  searchEngine: SearchEngine
}

export interface SemiLunarSettings {
  homeAlwaysOpen: boolean
  browsingHoverOpen: boolean
  /** Delay before semi-lunar opens on hover in browsing mode. */
  browsingOpenDelayMs: number
  previewOnHover: boolean
  closeDelayMs: number
  previewDelayMs: number
  closeBtnDelayMs: number
  folderMergeHoldMs: number
  mergeAnimMs: number
  openDurationMs: number
  closeDurationMs: number
  scaleX: number
  scaleY: number
  iconSizePx: number
  lunarWidthPx: number
  lunarHeightPx: number
  reducedMotion: boolean
}

export interface BrowsingSettings {
  overlayBlurPx: number
  overlayBrightnessPercent: number
}

export interface PrivacySettings {
  blockTrackers: boolean
  strictCookies: boolean
  httpsOnly: boolean
}

export interface NotificationSettings {
  focusModeAlerts: boolean
  siteNotifications: boolean
  showToolbarBadge: boolean
  toolbarBadgeCount: number
}

export interface NebulaSettings {
  appearance: AppearanceSettings
  home: HomeSettings
  semiLunar: SemiLunarSettings
  browsing: BrowsingSettings
  privacy: PrivacySettings
  notifications: NotificationSettings
}

export const DEFAULT_NEBULA_SETTINGS: NebulaSettings = {
  appearance: {
    theme: 'forest',
    glassBlurPx: 22,
    glassSaturate: 1.4,
    glassOpacity: 9,
    accentColor: '#7ec8e3',
    goldColor: '#d4c48a',
    lunarGlassRgb: '235, 242, 250',
    lunarGlassOpacity: 38,
    lunarGlassBlurPx: 160,
  },
  home: {
    showSystemWidgets: true,
    showRamWidget: true,
    showCpuWidget: true,
    showClock: true,
    clockFontSize: 36,
    clockFontWeight: 300,
    clockShowDate: true,
    clockFontFamily: 'system',
    showGreeting: true,
    showProfile: true,
    showPinnedStrip: true,
    pinnedStripSize: 'm',
    searchSize: 'm',
    searchOffsetX: 0,
    searchOffsetY: 0,
    profileOffsetX: 0,
    profileOffsetY: 0,
    showToolbar: true,
    userDisplayName: 'memir',
    searchEngine: 'google',
  },
  semiLunar: {
    homeAlwaysOpen: true,
    browsingHoverOpen: true,
    browsingOpenDelayMs: 500,
    previewOnHover: true,
    closeDelayMs: 200,
    previewDelayMs: 1000,
    closeBtnDelayMs: 300,
    folderMergeHoldMs: 650,
    mergeAnimMs: 420,
    openDurationMs: 260,
    closeDurationMs: 140,
    scaleX: 0.2,
    scaleY: 0.14,
    iconSizePx: 44,
    lunarWidthPx: 1100,
    lunarHeightPx: 152,
    reducedMotion: false,
  },
  browsing: {
    overlayBlurPx: 24,
    overlayBrightnessPercent: 45,
  },
  privacy: {
    blockTrackers: false,
    strictCookies: false,
    httpsOnly: false,
  },
  notifications: {
    focusModeAlerts: true,
    siteNotifications: true,
    showToolbarBadge: true,
    toolbarBadgeCount: 2,
  },
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function clampFloat(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function hexColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) return fallback
  return value
}

function rgbTriplet(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !/^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(value)) {
    return fallback
  }
  return value
}

const LEGACY_LUNAR_GLASS_RGB = '100, 100, 105'

function migrateLunarGlassRgb(value: unknown, fallback: string): string {
  const rgb = rgbTriplet(value, fallback)
  if (rgb === LEGACY_LUNAR_GLASS_RGB) return fallback
  return rgb
}

function migrateLunarGlassOpacity(value: unknown, fallback: number, rgb: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const opacity = clampNum(value, 20, 100, fallback)
  if (rgb === LEGACY_LUNAR_GLASS_RGB && opacity >= 75) return fallback
  return opacity
}

function migrateLunarGlassBlur(value: unknown, fallback: number, rgb: string): number {
  const blur = clampNum(value, 0, 160, fallback)
  if (rgb === LEGACY_LUNAR_GLASS_RGB && blur < 100) return fallback
  return blur
}

export function normalizeNebulaSettings(
  partial: Partial<NebulaSettings> | null | undefined,
): NebulaSettings {
  const d = DEFAULT_NEBULA_SETTINGS
  const a = partial?.appearance
  const h = partial?.home
  const s = partial?.semiLunar
  const b = partial?.browsing
  const p = partial?.privacy
  const n = partial?.notifications

  const lunarGlassRgb = migrateLunarGlassRgb(a?.lunarGlassRgb, d.appearance.lunarGlassRgb)

  return {
    appearance: {
      theme:
        a?.theme === 'dark' || a?.theme === 'light' || a?.theme === 'forest'
          ? a.theme
          : d.appearance.theme,
      glassBlurPx: clampNum(a?.glassBlurPx, 0, 80, d.appearance.glassBlurPx),
      glassSaturate: clampFloat(a?.glassSaturate, 0.5, 3, d.appearance.glassSaturate),
      glassOpacity: clampNum(a?.glassOpacity, 0, 40, d.appearance.glassOpacity),
      accentColor: hexColor(a?.accentColor, d.appearance.accentColor),
      goldColor: hexColor(a?.goldColor, d.appearance.goldColor),
      lunarGlassRgb,
      lunarGlassOpacity: migrateLunarGlassOpacity(
        a?.lunarGlassOpacity,
        d.appearance.lunarGlassOpacity,
        lunarGlassRgb,
      ),
      lunarGlassBlurPx: migrateLunarGlassBlur(
        a?.lunarGlassBlurPx,
        d.appearance.lunarGlassBlurPx,
        lunarGlassRgb,
      ),
    },
    home: {
      showSystemWidgets:
        typeof h?.showSystemWidgets === 'boolean'
          ? h.showSystemWidgets
          : d.home.showSystemWidgets,
      showRamWidget:
        typeof h?.showRamWidget === 'boolean' ? h.showRamWidget : d.home.showRamWidget,
      showCpuWidget:
        typeof h?.showCpuWidget === 'boolean' ? h.showCpuWidget : d.home.showCpuWidget,
      showClock: typeof h?.showClock === 'boolean' ? h.showClock : d.home.showClock,
      clockFontSize: clampNum(h?.clockFontSize, 24, 72, d.home.clockFontSize),
      clockFontWeight: clampNum(h?.clockFontWeight, 300, 600, d.home.clockFontWeight),
      clockShowDate:
        typeof h?.clockShowDate === 'boolean' ? h.clockShowDate : d.home.clockShowDate,
      clockFontFamily:
        h?.clockFontFamily === 'serif' ||
        h?.clockFontFamily === 'mono' ||
        h?.clockFontFamily === 'light' ||
        h?.clockFontFamily === 'system'
          ? h.clockFontFamily
          : d.home.clockFontFamily,
      showGreeting:
        typeof h?.showGreeting === 'boolean' ? h.showGreeting : d.home.showGreeting,
      showProfile:
        typeof h?.showProfile === 'boolean' ? h.showProfile : d.home.showProfile,
      showPinnedStrip:
        typeof h?.showPinnedStrip === 'boolean' ? h.showPinnedStrip : d.home.showPinnedStrip,
      pinnedStripSize:
        h?.pinnedStripSize === 's' || h?.pinnedStripSize === 'l' || h?.pinnedStripSize === 'm'
          ? h.pinnedStripSize
          : d.home.pinnedStripSize,
      searchSize:
        h?.searchSize === 's' || h?.searchSize === 'l' || h?.searchSize === 'm'
          ? h.searchSize
          : d.home.searchSize,
      searchOffsetX: clampNum(h?.searchOffsetX, -420, 420, d.home.searchOffsetX),
      searchOffsetY: clampNum(h?.searchOffsetY, -320, 320, d.home.searchOffsetY),
      profileOffsetX: clampNum(h?.profileOffsetX, -420, 420, d.home.profileOffsetX),
      profileOffsetY: clampNum(h?.profileOffsetY, -320, 320, d.home.profileOffsetY),
      showToolbar:
        typeof h?.showToolbar === 'boolean' ? h.showToolbar : d.home.showToolbar,
      userDisplayName:
        typeof h?.userDisplayName === 'string' && h.userDisplayName.trim()
          ? h.userDisplayName.trim().slice(0, 32)
          : d.home.userDisplayName,
      searchEngine:
        h?.searchEngine === 'duckduckgo' ||
        h?.searchEngine === 'bing' ||
        h?.searchEngine === 'google'
          ? h.searchEngine
          : d.home.searchEngine,
    },
    semiLunar: {
      homeAlwaysOpen:
        typeof s?.homeAlwaysOpen === 'boolean' ? s.homeAlwaysOpen : d.semiLunar.homeAlwaysOpen,
      browsingHoverOpen:
        typeof s?.browsingHoverOpen === 'boolean'
          ? s.browsingHoverOpen
          : d.semiLunar.browsingHoverOpen,
      browsingOpenDelayMs: clampNum(
        s?.browsingOpenDelayMs,
        0,
        5000,
        d.semiLunar.browsingOpenDelayMs,
      ),
      previewOnHover:
        typeof s?.previewOnHover === 'boolean' ? s.previewOnHover : d.semiLunar.previewOnHover,
      closeDelayMs: clampNum(s?.closeDelayMs, 0, 800, d.semiLunar.closeDelayMs),
      previewDelayMs: clampNum(s?.previewDelayMs, 200, 3000, d.semiLunar.previewDelayMs),
      closeBtnDelayMs: clampNum(s?.closeBtnDelayMs, 0, 1200, d.semiLunar.closeBtnDelayMs),
      folderMergeHoldMs: clampNum(s?.folderMergeHoldMs, 200, 2000, d.semiLunar.folderMergeHoldMs),
      mergeAnimMs: clampNum(s?.mergeAnimMs, 100, 1200, d.semiLunar.mergeAnimMs),
      openDurationMs: clampNum(s?.openDurationMs, 0, 600, d.semiLunar.openDurationMs),
      closeDurationMs: clampNum(s?.closeDurationMs, 0, 400, d.semiLunar.closeDurationMs),
      scaleX: clampFloat(s?.scaleX, 0.05, 0.5, d.semiLunar.scaleX),
      scaleY: clampFloat(s?.scaleY, 0.05, 0.5, d.semiLunar.scaleY),
      iconSizePx: clampNum(s?.iconSizePx, 32, 64, d.semiLunar.iconSizePx),
      lunarWidthPx: clampNum(s?.lunarWidthPx, 600, 1400, d.semiLunar.lunarWidthPx),
      lunarHeightPx: clampNum(s?.lunarHeightPx, 100, 220, d.semiLunar.lunarHeightPx),
      reducedMotion:
        typeof s?.reducedMotion === 'boolean' ? s.reducedMotion : d.semiLunar.reducedMotion,
    },
    browsing: {
      overlayBlurPx: clampNum(b?.overlayBlurPx, 0, 40, d.browsing.overlayBlurPx),
      overlayBrightnessPercent: clampNum(
        b?.overlayBrightnessPercent,
        20,
        100,
        d.browsing.overlayBrightnessPercent,
      ),
    },
    privacy: {
      blockTrackers:
        typeof p?.blockTrackers === 'boolean' ? p.blockTrackers : d.privacy.blockTrackers,
      strictCookies:
        typeof p?.strictCookies === 'boolean' ? p.strictCookies : d.privacy.strictCookies,
      httpsOnly: typeof p?.httpsOnly === 'boolean' ? p.httpsOnly : d.privacy.httpsOnly,
    },
    notifications: {
      focusModeAlerts:
        typeof n?.focusModeAlerts === 'boolean'
          ? n.focusModeAlerts
          : d.notifications.focusModeAlerts,
      siteNotifications:
        typeof n?.siteNotifications === 'boolean'
          ? n.siteNotifications
          : d.notifications.siteNotifications,
      showToolbarBadge:
        typeof n?.showToolbarBadge === 'boolean'
          ? n.showToolbarBadge
          : d.notifications.showToolbarBadge,
      toolbarBadgeCount: clampNum(n?.toolbarBadgeCount, 0, 99, d.notifications.toolbarBadgeCount),
    },
  }
}

function migrateLegacySemiLunar(partial: Partial<SemiLunarSettings>): Partial<SemiLunarSettings> {
  try {
    const raw = localStorage.getItem(SEMI_LUNAR_SETTINGS_KEY)
    if (raw) return { ...partial, ...(JSON.parse(raw) as Partial<SemiLunarSettings>) }
  } catch {
    /* ignore */
  }
  try {
    const legacy = localStorage.getItem(LEGACY_PREVIEW_ON_HOVER_KEY)
    if (legacy !== null) {
      return { ...partial, previewOnHover: JSON.parse(legacy) as boolean }
    }
  } catch {
    /* ignore */
  }
  return partial
}

export function loadNebulaSettings(): NebulaSettings {
  try {
    const raw = localStorage.getItem(NEBULA_SETTINGS_KEY)
    if (raw) {
      return normalizeNebulaSettings(JSON.parse(raw) as Partial<NebulaSettings>)
    }
  } catch {
    /* ignore */
  }

  return normalizeNebulaSettings({
    semiLunar: migrateLegacySemiLunar({}),
  } as Partial<NebulaSettings>)
}

export function applyNebulaCssVars(settings: NebulaSettings): void {
  const root = document.documentElement
  const { appearance: a, semiLunar: s, browsing: b } = settings

  const motion = s.reducedMotion
  const openMs = motion ? 0 : s.openDurationMs
  const closeMs = motion ? 0 : s.closeDurationMs

  root.style.setProperty('--title-bar-height', isTauri ? `${TITLE_BAR_HEIGHT}px` : '0px')
  root.style.setProperty('--semi-lunar-hit-zone-height', `${SEMI_LUNAR_HIT_ZONE_HEIGHT}px`)
  root.style.setProperty('--browsing-chrome-height', `${SEMI_LUNAR_HIT_ZONE_HEIGHT}px`)
  root.dataset.theme = a.theme
  root.style.setProperty('--glass-blur', `${a.glassBlurPx}px`)
  root.style.setProperty('--glass-saturate', String(a.glassSaturate))
  root.style.setProperty('--nebula-glass', `rgba(255, 255, 255, ${a.glassOpacity / 100})`)
  root.style.setProperty('--nebula-accent', a.accentColor)
  root.style.setProperty('--nebula-gold', a.goldColor)
  root.style.setProperty('--lunar-width', `${s.lunarWidthPx}px`)
  root.style.setProperty('--lunar-height', `${s.lunarHeightPx}px`)
  root.style.setProperty('--lunar-glass-saturate', '1.75')
  root.style.setProperty('--lunar-glass-rgb', a.lunarGlassRgb)
  root.style.setProperty('--lunar-glass-opacity', String(a.lunarGlassOpacity / 100))
  const lunarFill = a.lunarGlassOpacity / 100
  const lunarFillEffective = isTauri
    ? Math.min(0.94, lunarFill * 2.4 + 0.14)
    : lunarFill
  root.style.setProperty('--lunar-glass-fill', String(lunarFillEffective))
  root.style.setProperty('--lunar-glass-blur', `${a.lunarGlassBlurPx}px`)

  const overlayFrost = Math.min(
    0.9,
    0.18 + (b.overlayBlurPx / 40) * 0.52 + ((100 - b.overlayBrightnessPercent) / 100) * 0.32,
  )
  root.style.setProperty('--overlay-frost', String(overlayFrost))
  root.style.setProperty('--overlay-blur', `${b.overlayBlurPx}px`)
  root.style.setProperty('--overlay-brightness', String(b.overlayBrightnessPercent / 100))
  root.style.setProperty('--lunar-duration-open', `${openMs}ms`)
  root.style.setProperty('--lunar-duration-close', `${closeMs}ms`)
  root.style.setProperty('--lunar-duration', `${closeMs}ms`)
  root.style.setProperty('--lunar-scale-x', String(s.scaleX))
  root.style.setProperty('--lunar-scale-y', String(s.scaleY))
  root.style.setProperty('--shortcut-icon-size', `${s.iconSizePx}px`)
}

export function buildSearchUrl(query: string, engine: SearchEngine): string {
  const q = encodeURIComponent(query)
  switch (engine) {
    case 'duckduckgo':
      return `https://duckduckgo.com/?q=${q}`
    case 'bing':
      return `https://www.bing.com/search?q=${q}`
    default:
      return `https://www.google.com/search?q=${q}`
  }
}
