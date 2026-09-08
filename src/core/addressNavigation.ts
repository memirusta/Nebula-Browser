function parseIpv4(hostname: string): number[] | null {
  const parts = hostname.split('.')
  if (parts.length !== 4) return null

  const octets = parts.map((part) => {
    if (!/^\d{1,3}$/.test(part)) return Number.NaN
    return Number(part)
  })

  return octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    ? octets
    : null
}

export function isLocalNetworkHostname(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')

  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local') ||
    normalized === '::1' ||
    normalized === '::'
  ) {
    return true
  }

  if (/^(?:fc|fd)[0-9a-f]{2}:/i.test(normalized)) return true
  if (/^fe[89ab][0-9a-f]:/i.test(normalized)) return true

  const ipv4 = parseIpv4(normalized)
  if (!ipv4) return false

  const [first, second] = ipv4
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

export function resolveNavigationInput(
  value: string,
  fallbackSearchUrl: string,
): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null

  if (trimmed.includes(' ')) return fallbackSearchUrl

  const hasHttpScheme = /^https?:\/\//i.test(trimmed)
  const candidate = hasHttpScheme ? trimmed : `http://${trimmed}`

  try {
    const parsed = new URL(candidate)
    if (!['http:', 'https:'].includes(parsed.protocol)) return fallbackSearchUrl

    const localNetworkHost = isLocalNetworkHostname(parsed.hostname)
    if (!parsed.hostname.includes('.') && !localNetworkHost) return fallbackSearchUrl

    if (!hasHttpScheme) {
      parsed.protocol = localNetworkHost ? 'http:' : 'https:'
    }

    return parsed.href
  } catch {
    return fallbackSearchUrl
  }
}
