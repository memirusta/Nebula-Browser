/**
 * The wallpaper in the Nebula Sync backup.
 *
 * What goes: the moving background (which of the four, how strong, how fast) and a picture the person chose
 * (already scaled down when it was picked, so it is a few hundred kilobytes).
 *
 * What does not: a video. A video wallpaper is a file on this computer, kept by path; the path means nothing on
 * another computer and the file is large. A device on a video puts the default background (the Indigo one every new
 * person starts with) into the backup instead, so a new device still opens with a background, and restoring that on
 * a device that has its own video keeps the video (see `wallpaperToRestore`).
 *
 * Kept free of imports so it can be read by the Sync code and by tests alike.
 */

/** The same key as `WALLPAPER_CONFIG_KEY` in wallpaperConfig.ts (a test keeps them equal). */
export const WALLPAPER_SYNC_KEY = 'nebula-wallpaper-config-v2'

/** A picture bigger than this stays on the device: the whole backup may not pass 8 MB. */
export const MAX_SYNCED_IMAGE_CHARS = 3_000_000

const FROM_VIDEO = 'syncedFromVideo'

/** The default wallpaper settings, as in DEFAULT_WALLPAPER_CONFIG in wallpaperConfig.ts (a test keeps them equal). */
const DEFAULT_BACKGROUND = {
  version: 2,
  mode: 'ambient',
  fit: 'cover',
  position: { x: 50, y: 50 },
  imageUrl: null,
  videoPath: null,
  ambientPreset: 'nebula',
  ambientIntensity: 0.72,
  ambientSpeed: 1,
} as const

function parseConfig(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** What to put in the backup for this device's wallpaper settings, or nothing when there are none. */
export function wallpaperForBackup(raw: string | null | undefined): string | null {
  const config = parseConfig(raw)
  if (!config) return null

  // A video stays on this device; the backup gets the default background in its place, marked as a stand-in.
  if (config.mode === 'video') return JSON.stringify({ ...DEFAULT_BACKGROUND, [FROM_VIDEO]: true })

  const next: Record<string, unknown> = { ...config, videoPath: null }
  delete next[FROM_VIDEO]
  if (typeof next.imageUrl === 'string' && next.imageUrl.length > MAX_SYNCED_IMAGE_CHARS) {
    next.imageUrl = null
    if (next.mode === 'image') next.mode = 'ambient'
  }
  return JSON.stringify(next)
}

/**
 * What to write on this device for the wallpaper settings of a backup. A backup made on a device that used a video
 * does not replace this device's own video.
 */
export function wallpaperToRestore(remoteRaw: string, localRaw: string | null | undefined): string | null {
  const remote = parseConfig(remoteRaw)
  if (!remote) return null

  if (remote[FROM_VIDEO] === true) {
    const local = parseConfig(localRaw)
    if (local && local.mode === 'video' && typeof local.videoPath === 'string' && local.videoPath) {
      return localRaw ?? null
    }
  }

  const next: Record<string, unknown> = { ...remote, videoPath: null }
  delete next[FROM_VIDEO]
  return JSON.stringify(next)
}
