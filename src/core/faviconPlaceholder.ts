/**
 * What stands in for a site's icon until a real one is kept: a coloured square with the site's first
 * letter, drawn here. Nothing is asked from anyone for it, so opening a site never tells a third party
 * (a favicon service, an ad network) which site it was.
 *
 * The real icon comes from the page itself, or from the site's own `/favicon.ico` (see faviconCache).
 * A site that has neither keeps its letter.
 *
 * Older versions stored the address of a favicon service with shortcuts, pins and history entries.
 * `usableStoredFavicon` treats such an address (and a placeholder, which is cheap to draw again) as
 * "no icon", so what was stored before never puts the service back on a page.
 */

const PALETTE = ['#6366f1', '#8b5cf6', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6']

const PLACEHOLDER_PREFIX = 'data:image/svg+xml;charset=utf-8,'
const PLACEHOLDER_MARK = 'data-nebula-placeholder'

function hostOf(value: string): string {
  const trimmed = value.trim()
  try {
    return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname
      .replace(/\.$/, '')
      .replace(/^www\./i, '')
      .toLowerCase()
  } catch {
    return trimmed.replace(/^www\./i, '').toLowerCase()
  }
}

function hashOf(text: string): number {
  let hash = 0
  for (const character of text) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return hash
}

/** A small coloured square with the first letter of the site, as an image address. */
export function placeholderFavicon(hostOrUrl: string): string {
  const host = hostOf(hostOrUrl)
  const letter = (host.match(/[a-z0-9]/i)?.[0] ?? '?').toUpperCase().replace('?', '•')
  const color = PALETTE[hashOf(host) % PALETTE.length]
  const svg =
    `<svg ${PLACEHOLDER_MARK}="1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">` +
    `<rect width="128" height="128" rx="30" fill="${color}"/>` +
    `<text x="64" y="68" font-family="Segoe UI, Arial, sans-serif" font-size="70" font-weight="700" fill="#ffffff" ` +
    `text-anchor="middle" dominant-baseline="central">${letter}</text></svg>`
  return PLACEHOLDER_PREFIX + encodeURIComponent(svg)
}

export function isPlaceholderFavicon(source: string): boolean {
  return source.startsWith(PLACEHOLDER_PREFIX) && source.includes(encodeURIComponent(PLACEHOLDER_MARK))
}

/** The address of a favicon service of a third party, which older versions stored as an icon. */
export function isFaviconServiceAddress(source: string): boolean {
  try {
    const url = new URL(source.trim())
    const host = url.hostname.toLowerCase()
    return (
      (host === 'www.google.com' && url.pathname.startsWith('/s2/')) ||
      (host.endsWith('.gstatic.com') && url.pathname.startsWith('/favicon'))
    )
  } catch {
    return false
  }
}

/**
 * A stored icon that is worth showing: one the page or the site gave. Not a service address from an
 * older version, not a placeholder (that is drawn again from the address), not empty.
 */
export function usableStoredFavicon(source: string | null | undefined): string | null {
  const trimmed = source?.trim()
  if (!trimmed || isFaviconServiceAddress(trimmed) || isPlaceholderFavicon(trimmed)) return null
  return trimmed
}
