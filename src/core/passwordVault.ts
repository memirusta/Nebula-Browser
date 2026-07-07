import { persistLocalStorage } from './storageSync'

export const PASSWORD_VAULT_KEY = 'nebula-password-vault-v1'

export interface SavedPassword {
  id: string
  label: string
  url?: string
  username: string
  password: string
  updatedAt: number
}

function parseEntry(raw: unknown): SavedPassword | null {
  if (!raw || typeof raw !== 'object') return null
  const entry = raw as Partial<SavedPassword>
  if (typeof entry.id !== 'string' || typeof entry.label !== 'string') return null
  if (typeof entry.username !== 'string' || typeof entry.password !== 'string') return null
  return {
    id: entry.id,
    label: entry.label.trim().slice(0, 80),
    url: typeof entry.url === 'string' && entry.url.trim() ? entry.url.trim().slice(0, 300) : undefined,
    username: entry.username.trim().slice(0, 120),
    password: entry.password.slice(0, 256),
    updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : Date.now(),
  }
}

export function loadPasswordVault(): SavedPassword[] {
  try {
    const raw = localStorage.getItem(PASSWORD_VAULT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(parseEntry).filter((entry): entry is SavedPassword => entry !== null)
  } catch {
    return []
  }
}

export function savePasswordVault(entries: SavedPassword[]): void {
  persistLocalStorage(PASSWORD_VAULT_KEY, JSON.stringify(entries))
}

export function addPasswordEntry(
  draft: Omit<SavedPassword, 'id' | 'updatedAt'>,
): SavedPassword[] {
  const entry: SavedPassword = {
    ...draft,
    id: crypto.randomUUID(),
    updatedAt: Date.now(),
  }
  const next = [entry, ...loadPasswordVault()]
  savePasswordVault(next)
  return next
}

export function removePasswordEntry(id: string): SavedPassword[] {
  const next = loadPasswordVault().filter((entry) => entry.id !== id)
  savePasswordVault(next)
  return next
}

export function upsertPasswordEntry(
  draft: Omit<SavedPassword, 'id' | 'updatedAt'>,
): SavedPassword[] {
  const vault = loadPasswordVault()
  const normalizedUser = draft.username.trim().toLowerCase()
  const draftUrl = draft.url?.trim().toLowerCase() ?? ''

  const existingIndex = vault.findIndex((entry) => {
    const sameUser = entry.username.trim().toLowerCase() === normalizedUser
    const sameUrl = (entry.url?.trim().toLowerCase() ?? '') === draftUrl
    return sameUser && sameUrl
  })

  if (existingIndex >= 0) {
    const existing = vault[existingIndex]
    const updated: SavedPassword = {
      ...existing,
      label: draft.label,
      url: draft.url,
      username: draft.username,
      password: draft.password,
      updatedAt: Date.now(),
    }
    const next = [...vault]
    next[existingIndex] = updated
    savePasswordVault(next)
    return next
  }

  return addPasswordEntry(draft)
}
