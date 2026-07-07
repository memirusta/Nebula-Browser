import { WALLPAPER_STORAGE_KEY } from './constants'

const ENCODE_ATTEMPTS = [
  { maxDim: 1920, quality: 0.85 },
  { maxDim: 1280, quality: 0.75 },
  { maxDim: 960, quality: 0.65 },
  { maxDim: 720, quality: 0.55 },
] as const

export function loadWallpaper(): string | null {
  try {
    return localStorage.getItem(WALLPAPER_STORAGE_KEY)
  } catch {
    return null
  }
}

export function clearWallpaper(): void {
  try {
    localStorage.removeItem(WALLPAPER_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

function encodeBitmap(
  bitmap: ImageBitmap,
  maxDim: number,
  quality: number,
): string {
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', quality)
}

function tryPersist(dataUrl: string): boolean {
  try {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, dataUrl)
    return true
  } catch {
    return false
  }
}

export async function fileToStorableWallpaper(file: File): Promise<string | null> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return null
  }

  try {
    for (const { maxDim, quality } of ENCODE_ATTEMPTS) {
      const dataUrl = encodeBitmap(bitmap, maxDim, quality)
      if (tryPersist(dataUrl)) return dataUrl
    }
    return null
  } finally {
    bitmap.close()
  }
}

export function persistWallpaper(url: string | null): boolean {
  if (!url) {
    clearWallpaper()
    return true
  }
  return tryPersist(url)
}
