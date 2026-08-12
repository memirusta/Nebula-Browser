export interface SavedPassword {
  id: string
  label: string
  url?: string
  username: string
  password: string
  updatedAt: number
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
