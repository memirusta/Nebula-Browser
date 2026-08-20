export interface SiteCompatibilityTarget {
  url: string
  hostname: string
}

export function siteCompatibilityTarget(
  value: string,
): SiteCompatibilityTarget | null {
  try {
    const parsed = new URL(value)
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !parsed.hostname
    ) {
      return null
    }

    return {
      url: parsed.toString(),
      hostname: parsed.hostname.toLowerCase(),
    }
  } catch {
    return null
  }
}

export function siteExceptionHosts(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((item) => {
      const candidate = item.trim()
      if (!candidate) return ''

      try {
        const parsed = new URL(candidate)
        return parsed.hostname.toLowerCase()
      } catch {
        return candidate.replace(/^\*\./, '').toLowerCase()
      }
    })
    .filter(Boolean)
}

export function hostHasSiteException(
  hostname: string,
  siteExceptions: string,
): boolean {
  const host = hostname.toLowerCase()
  return siteExceptionHosts(siteExceptions).some(
    (exception) =>
      host === exception ||
      host.endsWith(`.${exception}`),
  )
}

export function addSiteException(
  siteExceptions: string,
  hostname: string,
): string {
  if (hostHasSiteException(hostname, siteExceptions)) {
    return siteExceptions
  }

  const entries = siteExceptionHosts(siteExceptions)
  return [...entries, hostname.toLowerCase()].join(', ')
}

export function removeSiteException(
  siteExceptions: string,
  hostname: string,
): string {
  const target = hostname.toLowerCase()
  return siteExceptionHosts(siteExceptions)
    .filter((entry) => entry !== target)
    .join(', ')
}
