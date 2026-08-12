export interface SavedPassword {
  id: string
  label: string
  url?: string
  username: string
  password: string
  updatedAt: number
  /** Origins where this credential's account identifier was observed/filled. */
  usernameOrigins?: string[]
  /** Origins where this credential's password was observed/submitted. */
  passwordOrigins?: string[]
}

function parseOriginList(raw: unknown, index: number, field: string): string[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    throw new Error(`Password vault entry ${index} has an invalid ${field} list.`)
  }

  const seen = new Set<string>()
  const origins: string[] = []
  for (const value of raw) {
    if (typeof value !== 'string') {
      throw new Error(`Password vault entry ${index} has an invalid ${field} origin.`)
    }
    try {
      const parsed = new URL(value)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue
      const origin = parsed.origin
      if (seen.has(origin)) continue
      seen.add(origin)
      origins.push(origin)
      if (origins.length >= 16) break
    } catch {
      continue
    }
  }
  return origins.length > 0 ? origins : undefined
}

function parseEntry(raw: unknown, index: number): SavedPassword {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Password vault entry ${index} is not an object.`)
  }
  const entry = raw as Partial<SavedPassword>
  if (typeof entry.id !== 'string' || typeof entry.label !== 'string') {
    throw new Error(`Password vault entry ${index} has an invalid identity.`)
  }
  if (typeof entry.username !== 'string' || typeof entry.password !== 'string') {
    throw new Error(`Password vault entry ${index} has invalid credentials.`)
  }
  if (
    typeof entry.updatedAt !== 'number' ||
    !Number.isFinite(entry.updatedAt)
  ) {
    throw new Error(`Password vault entry ${index} has an invalid timestamp.`)
  }
  if (entry.url !== undefined && typeof entry.url !== 'string') {
    throw new Error(`Password vault entry ${index} has an invalid URL.`)
  }

  return {
    id: entry.id,
    label: entry.label.trim().slice(0, 80),
    url: entry.url?.trim() ? entry.url.trim().slice(0, 300) : undefined,
    username: entry.username.trim().slice(0, 120),
    // Passwords are opaque secrets. Never normalize or truncate them on load.
    password: entry.password,
    updatedAt: entry.updatedAt,
    usernameOrigins: parseOriginList(entry.usernameOrigins, index, 'usernameOrigins'),
    passwordOrigins: parseOriginList(entry.passwordOrigins, index, 'passwordOrigins'),
  }
}

export function parsePasswordVault(raw: string | null): SavedPassword[] {
  if (raw === null) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error('Password vault contains invalid JSON.', { cause: error })
  }
  if (!Array.isArray(parsed)) {
    throw new Error('Password vault root must be an array.')
  }
  return parsed.map(parseEntry)
}

export function serializePasswordVault(entries: SavedPassword[]): string {
  const json = JSON.stringify(entries)
  parsePasswordVault(json)
  return json
}
