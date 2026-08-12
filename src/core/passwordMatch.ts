/** Hostname helpers and vault URL matching for password autofill. */

export function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return null
  }
}

export function passwordOriginFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase()
    return `${parsed.protocol}//${hostname}${parsed.port ? `:${parsed.port}` : ''}`
  } catch {
    return null
  }
}

export function hostsMatchForPassword(siteUrl: string, entryUrl: string): boolean {
  const siteOrigin = passwordOriginFromUrl(siteUrl)
  const entryOrigin = passwordOriginFromUrl(entryUrl)
  if (!siteOrigin || !entryOrigin) return false
  return siteOrigin === entryOrigin
}

export interface PasswordMatchEntry {
  id: string
  label: string
  url?: string
  username: string
  password: string
}

export function matchPasswordsForUrl<T extends PasswordMatchEntry>(
  pageUrl: string,
  entries: T[],
): T[] {
  return entries.filter((entry) => entry.url && hostsMatchForPassword(pageUrl, entry.url))
}

export function findExistingPassword(
  entries: PasswordMatchEntry[],
  url: string,
  username: string,
): PasswordMatchEntry | null {
  const normalizedUser = username.trim().toLowerCase()
  return (
    entries.find(
      (entry) =>
        entry.url &&
        hostsMatchForPassword(url, entry.url) &&
        entry.username.trim().toLowerCase() === normalizedUser,
    ) ?? null
  )
}

export function labelFromUrl(url: string): string {
  return hostnameFromUrl(url) ?? url
}
