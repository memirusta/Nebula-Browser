import { loadWallpaper } from './wallpaperStorage'

export type WallpaperMode =
  | 'image'
  | 'video'
  | 'ambient'

export type WallpaperFit =
  | 'cover'
  | 'contain'

export type AmbientWallpaperPreset =
  | 'nebula'
  | 'aurora'
  | 'midnight'
  | 'liquid'

export interface WallpaperPosition {
  x: number
  y: number
}

export interface WallpaperConfig {
  version: 2
  mode: WallpaperMode
  fit: WallpaperFit
  position: WallpaperPosition
  imageUrl: string | null
  videoPath: string | null
  ambientPreset: AmbientWallpaperPreset
  ambientIntensity: number
  ambientSpeed: number
}

export const WALLPAPER_CONFIG_KEY =
  'nebula-wallpaper-config-v2'

export const DEFAULT_WALLPAPER_CONFIG:
  WallpaperConfig = {
    version: 2,
    mode: 'image',
    fit: 'cover',
    position: {
      x: 50,
      y: 50,
    },
    imageUrl: null,
    videoPath: null,
    ambientPreset: 'nebula',
    ambientIntensity: 0.72,
    ambientSpeed: 1,
  }

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(
    max,
    Math.max(
      min,
      value,
    ),
  )
}

function isWallpaperMode(
  value: unknown,
): value is WallpaperMode {
  return (
    value === 'image' ||
    value === 'video' ||
    value === 'ambient'
  )
}

function isWallpaperFit(
  value: unknown,
): value is WallpaperFit {
  return (
    value === 'cover' ||
    value === 'contain'
  )
}

function isAmbientPreset(
  value: unknown,
): value is AmbientWallpaperPreset {
  return (
    value === 'nebula' ||
    value === 'aurora' ||
    value === 'midnight' ||
    value === 'liquid'
  )
}

export function normalizeWallpaperConfig(
  input:
    Partial<WallpaperConfig> |
    null |
    undefined,
): WallpaperConfig {
  const base =
    DEFAULT_WALLPAPER_CONFIG

  return {
    version: 2,

    mode:
      isWallpaperMode(
        input?.mode,
      )
        ? input.mode
        : base.mode,

    fit:
      isWallpaperFit(
        input?.fit,
      )
        ? input.fit
        : base.fit,

    position: {
      x:
        clamp(
          input?.position?.x ??
            base.position.x,
          0,
          100,
        ),

      y:
        clamp(
          input?.position?.y ??
            base.position.y,
          0,
          100,
        ),
    },

    imageUrl:
      typeof input?.imageUrl ===
        'string'
        ? input.imageUrl
        : null,

    videoPath:
      typeof input?.videoPath ===
        'string'
        ? input.videoPath
        : null,

    ambientPreset:
      isAmbientPreset(
        input?.ambientPreset,
      )
        ? input.ambientPreset
        : base.ambientPreset,

    ambientIntensity:
      clamp(
        input?.ambientIntensity ??
          base.ambientIntensity,
        0.25,
        1,
      ),

    ambientSpeed:
      clamp(
        input?.ambientSpeed ??
          base.ambientSpeed,
        0.25,
        2,
      ),
  }
}

export function loadWallpaperConfig():
  WallpaperConfig {
  try {
    const raw =
      localStorage.getItem(
        WALLPAPER_CONFIG_KEY,
      )

    if (raw) {
      return normalizeWallpaperConfig(
        JSON.parse(
          raw,
        ) as Partial<WallpaperConfig>,
      )
    }
  } catch {
    // Fall through to legacy migration/default.
  }

  /*
   * Legacy Nebula stored one compressed image data URL under
   * `nebula-wallpaper`. Keep it exactly as-is and migrate only
   * the surrounding metadata.
   */
  const legacyImage =
    loadWallpaper()

  return {
    ...DEFAULT_WALLPAPER_CONFIG,
    imageUrl:
      legacyImage,
  }
}

export function persistWallpaperConfig(
  config: WallpaperConfig,
): boolean {
  try {
    localStorage.setItem(
      WALLPAPER_CONFIG_KEY,
      JSON.stringify(
        normalizeWallpaperConfig(
          config,
        ),
      ),
    )

    return true
  } catch {
    return false
  }
}

export function clearWallpaperConfig():
  void {
  try {
    localStorage.removeItem(
      WALLPAPER_CONFIG_KEY,
    )
  } catch {
    // Ignore storage failures.
  }
}
