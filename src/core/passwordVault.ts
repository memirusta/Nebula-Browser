import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../platform/runtime'
import {
  parsePasswordVault,
  serializePasswordVault,
  type SavedPassword,
} from './passwordVaultSchema'

export type { SavedPassword } from './passwordVaultSchema'

export const PASSWORD_VAULT_KEY = 'nebula-password-vault-v1'
export const PASSWORD_VAULT_CHANGED_EVENT = 'nebula-password-vault-changed'

let volatileVault: SavedPassword[] = []
let initialization: Promise<SavedPassword[]> | null = null
let mutationChain: Promise<void> = Promise.resolve()

async function initializePasswordVault(): Promise<SavedPassword[]> {
  if (!isTauri) return volatileVault
  if (initialization) return initialization

  initialization = (async () => {
    const stored = await invoke<string | null>('password_vault_load')
    if (stored !== null) {
      const vault = parsePasswordVault(stored)
      localStorage.removeItem(PASSWORD_VAULT_KEY)
      return vault
    }

    const legacy = parsePasswordVault(localStorage.getItem(PASSWORD_VAULT_KEY))
    if (legacy.length > 0) {
      await invoke('password_vault_save', { json: serializePasswordVault(legacy) })
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
  return parsePasswordVault(await invoke<string | null>('password_vault_load'))
}

export async function savePasswordVault(entries: SavedPassword[]): Promise<void> {
  if (!isTauri) {
    volatileVault = [...entries]
    window.dispatchEvent(new Event(PASSWORD_VAULT_CHANGED_EVENT))
    return
  }
  await initializePasswordVault()
  await invoke('password_vault_save', { json: serializePasswordVault(entries) })
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
      ? parsePasswordVault(await invoke<string | null>('password_vault_load'))
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
