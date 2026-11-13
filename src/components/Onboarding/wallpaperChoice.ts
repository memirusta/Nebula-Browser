import type { AmbientWallpaperPreset, WallpaperConfig } from '../../core/wallpaperConfig'

/** The four moving backgrounds Nebula draws itself, as the first run offers them. */
export const WALLPAPER_PRESETS: Array<{ id: AmbientWallpaperPreset; name: string }> = [
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
  return WALLPAPER_PRESETS.find((preset) => preset.id === config.ambientPreset)?.name ?? WALLPAPER_PRESETS[0].name
}
