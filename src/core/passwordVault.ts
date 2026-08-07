import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../platform/runtime'

export const PASSWORD_VAULT_KEY = 'nebula-password-vault-v1'
export const PASSWORD_VAULT_CHANGED_EVENT = 'nebula-password-vault-changed'

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

function parseVault(raw: string | null): SavedPassword[] {
  try {
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map(parseEntry).filter((entry): entry is SavedPassword => entry !== null)
  } catch {
    return []
  }
}

let volatileVault: SavedPassword[] = []
let initialization: Promise<SavedPassword[]> | null = null
let mutationChain: Promise<void> = Promise.resolve()

async function initializePasswordVault(): Promise<SavedPassword[]> {
  if (!isTauri) return volatileVault
  if (initialization) return initialization

  initialization = (async () => {
    const stored = await invoke<string | null>('password_vault_load')
    if (stored) {
      localStorage.removeItem(PASSWORD_VAULT_KEY)
      return parseVault(stored)
    }

    const legacy = parseVault(localStorage.getItem(PASSWORD_VAULT_KEY))
    if (legacy.length > 0) {
      await invoke('password_vault_save', { json: JSON.stringify(legacy) })
    }
    localStorage.removeItem(PASSWORD_VAULT_KEY)
    return legacy
  })().catch((error) => {
    initialization = null
    throw error
  })

  return initialization
}

export async function loadPasswordVault(): Promise<SavedPassword[]> {
  await mutationChain.catch(() => undefined)
  if (!isTauri) return [...volatileVault]
  await initializePasswordVault()
  return parseVault(await invoke<string | null>('password_vault_load'))
}

export async function savePasswordVault(entries: SavedPassword[]): Promise<void> {
  if (!isTauri) {
    volatileVault = [...entries]
    window.dispatchEvent(new Event(PASSWORD_VAULT_CHANGED_EVENT))
    return
  }
  await initializePasswordVault()
  await invoke('password_vault_save', { json: JSON.stringify(entries) })
  localStorage.removeItem(PASSWORD_VAULT_KEY)
  window.dispatchEvent(new Event(PASSWORD_VAULT_CHANGED_EVENT))
}

export async function updatePasswordVault(
  transform: (entries: SavedPassword[]) => SavedPassword[],
): Promise<SavedPassword[]> {
  let result: SavedPassword[] = []
  const mutation = mutationChain.catch(() => undefined).then(async () => {
    await initializePasswordVault()
    const current = isTauri
      ? parseVault(await invoke<string | null>('password_vault_load'))
      : [...volatileVault]
    result = transform(current)
    await savePasswordVault(result)
  })
  mutationChain = mutation.then(() => undefined, () => undefined)
  await mutation
  return result
}

export async function addPasswordEntry(
  draft: Omit<SavedPassword, 'id' | 'updatedAt'>,
): Promise<SavedPassword[]> {
  const entry: SavedPassword = {
    ...draft,
    id: crypto.randomUUID(),
    updatedAt: Date.now(),
  }
  return updatePasswordVault((vault) => [entry, ...vault])
}

export async function removePasswordEntry(id: string): Promise<SavedPassword[]> {
  return updatePasswordVault((vault) => vault.filter((entry) => entry.id !== id))
}

export async function upsertPasswordEntry(
  draft: Omit<SavedPassword, 'id' | 'updatedAt'>,
): Promise<SavedPassword[]> {
  return updatePasswordVault((vault) => {
    const normalizedUser = draft.username.trim().toLowerCase()
    const draftUrl = draft.url?.trim().toLowerCase() ?? ''

    const existingIndex = vault.findIndex((entry) => {
      const sameUser = entry.username.trim().toLowerCase() === normalizedUser
      const sameUrl = (entry.url?.trim().toLowerCase() ?? '') === draftUrl
      return sameUser && sameUrl
    })

    if (existingIndex >= 0) {
      const existing = vault[existingIndex]
      const next = [...vault]
      next[existingIndex] = { ...existing, ...draft, updatedAt: Date.now() }
      return next
    }

    return [{ ...draft, id: crypto.randomUUID(), updatedAt: Date.now() }, ...vault]
  })
}
