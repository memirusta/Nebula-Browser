/** Hostname helpers and vault URL matching for password autofill. */

const MICROSOFT_LOGIN_HOSTS = new Set([
  'login.live.com',
  'login.microsoftonline.com',
])

export type PasswordCredentialRole = 'username' | 'password' | 'either'

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

/**
 * Credential matching is origin-scoped by default. A very small explicit realm
 * allowlist remains for legacy entries from identity providers that split one
 * sign-in flow across multiple first-party origins. New split-login origins are
 * learned per credential and persisted role-by-role instead of broad suffix
 * matching, so unrelated subdomains never inherit a password automatically.
 */
export function passwordCredentialRealmFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    const hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase()

    if (
      parsed.protocol === 'https:' &&
      !parsed.port &&
      MICROSOFT_LOGIN_HOSTS.has(hostname)
    ) {
      return 'nebula-password-realm:microsoft-account'
    }

    return `${parsed.protocol}//${hostname}${parsed.port ? `:${parsed.port}` : ''}`
  } catch {
    return null
  }
}

export function hostsMatchForPassword(siteUrl: string, entryUrl: string): boolean {
  const siteRealm = passwordCredentialRealmFromUrl(siteUrl)
  const entryRealm = passwordCredentialRealmFromUrl(entryUrl)
  if (!siteRealm || !entryRealm) return false
  return siteRealm === entryRealm
}

export function normalizePasswordOrigins(values: readonly string[] | undefined): string[] {
  if (!values) return []
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values) {
    const origin = passwordOriginFromUrl(value)
    if (!origin || seen.has(origin)) continue
    seen.add(origin)
    normalized.push(origin)
    if (normalized.length >= 16) break
  }
  return normalized
}

function originListMatches(pageUrl: string, origins: readonly string[] | undefined): boolean {
  if (!origins?.length) return false
  return origins.some((origin) => hostsMatchForPassword(pageUrl, origin))
}

export interface PasswordMatchEntry {
  id: string
  label: string
  url?: string
  username: string
  password: string
  usernameOrigins?: string[]
  passwordOrigins?: string[]
}

export function passwordEntryMatchesUrl(
  pageUrl: string,
  entry: PasswordMatchEntry,
  role: PasswordCredentialRole = 'either',
): boolean {
  // Legacy / manually-added entries keep their primary URL as a safe fallback.
  if (entry.url && hostsMatchForPassword(pageUrl, entry.url)) return true

  if (
    (role === 'username' || role === 'either') &&
    originListMatches(pageUrl, entry.usernameOrigins)
  ) {
    return true
  }

  if (
    (role === 'password' || role === 'either') &&
    originListMatches(pageUrl, entry.passwordOrigins)
  ) {
    return true
  }

  return false
}

export function matchPasswordsForUrl<T extends PasswordMatchEntry>(
  pageUrl: string,
  entries: T[],
  role: PasswordCredentialRole = 'either',
): T[] {
  return entries.filter((entry) => passwordEntryMatchesUrl(pageUrl, entry, role))
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
        passwordEntryMatchesUrl(url, entry, 'password') &&
        entry.username.trim().toLowerCase() === normalizedUser,
    ) ?? null
  )
}

export function labelFromUrl(url: string): string {
  const hostname = hostnameFromUrl(url)
  if (hostname && MICROSOFT_LOGIN_HOSTS.has(hostname)) return 'Microsoft'
  return hostname ?? url
}
