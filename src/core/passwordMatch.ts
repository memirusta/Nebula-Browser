/** Hostname helpers and vault URL matching for password autofill. */

export function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, '').toLowerCase()
  } catch {
    return null
  }
}

export function hostsMatchForPassword(siteUrl: string, entryUrl: string): boolean {
  const siteHost = hostnameFromUrl(siteUrl)
  const entryHost = hostnameFromUrl(entryUrl)
  if (!siteHost || !entryHost) return false
  if (siteHost === entryHost) return true
  return siteHost.endsWith(`.${entryHost}`) || entryHost.endsWith(`.${siteHost}`)
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
