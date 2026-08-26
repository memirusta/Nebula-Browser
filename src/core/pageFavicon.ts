const MAX_REMOTE_FAVICON_URL_LENGTH = 4_096
const MAX_INLINE_FAVICON_LENGTH = 90_000

const INLINE_IMAGE_PREFIX =
  /^data:image\/(?:png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon);base64,/i

export interface RasterImageSize {
  width: number
  height: number
}

export function inlinePngSize(value: string): RasterImageSize | null {
  const prefix = 'data:image/png;base64,'
  if (!value.startsWith(prefix)) return null

  try {
    const header = atob(value.slice(prefix.length, prefix.length + 44))
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (
      header.length < 24 ||
      !signature.every((byte, index) => header.charCodeAt(index) === byte)
    ) {
      return null
    }
    const readU32 = (offset: number) => (
      header.charCodeAt(offset) * 0x1000000 +
      header.charCodeAt(offset + 1) * 0x10000 +
      header.charCodeAt(offset + 2) * 0x100 +
      header.charCodeAt(offset + 3)
    )
    const width = readU32(16)
    const height = readU32(20)
    return width > 0 && height > 0 ? { width, height } : null
  } catch {
    return null
  }
}

export function isLowResolutionInlineFavicon(value: string): boolean {
  const size = inlinePngSize(value)
  return size !== null && (size.width < 48 || size.height < 48)
}

/**
 * Accept only image sources that are safe and usable from Nebula's chrome
 * WebView. Native WebView2 currently sends a PNG data URL; http(s) support
 * keeps the event contract forwards-compatible without accepting script/file
 * schemes or WebView-local blob URLs.
 */
export function normalizePageFavicon(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const source = value.trim()
  if (!source) return null

  if (source.startsWith('data:')) {
    return source.length <= MAX_INLINE_FAVICON_LENGTH &&
      INLINE_IMAGE_PREFIX.test(source) &&
      !isLowResolutionInlineFavicon(source)
      ? source
      : null
  }

  if (source.length > MAX_REMOTE_FAVICON_URL_LENGTH) return null
  try {
    const parsed = new URL(source)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.href
      : null
  } catch {
    return null
  }
}
