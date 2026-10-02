import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../platform/runtime'
import {
  hostsMatchForPassword,
  normalizePasswordOrigins,
  passwordOriginFromUrl,
} from './passwordMatch'
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
      const saved = await invoke<boolean>('password_vault_save', {
        json: serializePasswordVault(legacy), expectedJson: null,
      })
      if (!saved) {
        const current = parsePasswordVault(await invoke<string | null>('password_vault_load'))
        localStorage.removeItem(PASSWORD_VAULT_KEY)
        return current
      }
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

async function savePasswordVault(entries: SavedPassword[], expectedJson: string | null): Promise<boolean> {
  if (!isTauri) {
    volatileVault = [...entries]
    window.dispatchEvent(new Event(PASSWORD_VAULT_CHANGED_EVENT))
    return true
  }
  await initializePasswordVault()
  const saved = await invoke<boolean>('password_vault_save', {
    json: serializePasswordVault(entries), expectedJson,
  })
  if (!saved) return false
  localStorage.removeItem(PASSWORD_VAULT_KEY)
  window.dispatchEvent(new Event(PASSWORD_VAULT_CHANGED_EVENT))
  return true
}

/** The transform may run again if another window commits before this one. */
export async function updatePasswordVault(
  transform: (entries: SavedPassword[]) => SavedPassword[],
): Promise<SavedPassword[]> {
  let result: SavedPassword[] = []
  const mutation = mutationChain.catch(() => undefined).then(async () => {
    await initializePasswordVault()
    for (let attempt = 0; attempt < 8; attempt++) {
      const raw = isTauri ? await invoke<string | null>('password_vault_load') : null
      const current = isTauri ? parsePasswordVault(raw) : [...volatileVault]
      result = transform(current)
      if (await savePasswordVault(result, raw)) return
    }
    throw new Error('Password vault changed repeatedly. Please try again.')
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

/**
 * Replaces one credential only if it has not changed since the user completed
 * Windows Hello. Moving a credential to another origin revokes learned origins.
 */
export async function editPasswordEntry(
  id: string,
  expectedUpdatedAt: number,
  draft: Pick<SavedPassword, 'label' | 'url' | 'username' | 'password'>,
): Promise<{ entries: SavedPassword[]; updated: boolean }> {
  let updated = false
  const entries = await updatePasswordVault((vault) => {
    updated = false
    return vault.map((entry) => {
      if (entry.id !== id || entry.updatedAt !== expectedUpdatedAt) return entry
      updated = true
      const sameOrigin = passwordOriginFromUrl(entry.url ?? '') !== null &&
        passwordOriginFromUrl(entry.url ?? '') === passwordOriginFromUrl(draft.url ?? '')
      const unchangedUrl = entry.url === draft.url
      return {
        ...entry, ...draft,
        usernameOrigins: sameOrigin || unchangedUrl ? entry.usernameOrigins : undefined,
        passwordOrigins: sameOrigin || unchangedUrl ? entry.passwordOrigins : undefined,
        updatedAt: Math.max(Date.now(), entry.updatedAt + 1),
      }
    })
  })
  return { entries, updated }
}

export async function upsertPasswordEntry(
  draft: Omit<SavedPassword, 'id' | 'updatedAt'>,
): Promise<SavedPassword[]> {
  return updatePasswordVault((vault) => {
    const normalizedUser = draft.username.trim().toLowerCase()
    const draftUrl = draft.url?.trim() ?? ''

    const existingIndex = vault.findIndex((entry) => {
      const sameUser = entry.username.trim().toLowerCase() === normalizedUser
      const sameSite = Boolean(
        draftUrl &&
        entry.url &&
        hostsMatchForPassword(draftUrl, entry.url),
      )
      return sameUser && sameSite
    })

    if (existingIndex >= 0) {
      const existing = vault[existingIndex]
      const next = [...vault]
      const usernameOrigins = normalizePasswordOrigins([
        ...(existing.usernameOrigins ?? []),
        ...(draft.usernameOrigins ?? []),
      ])
      const passwordOrigins = normalizePasswordOrigins([
        ...(existing.passwordOrigins ?? []),
        ...(draft.passwordOrigins ?? []),
      ])
      next[existingIndex] = {
        ...existing,
        ...draft,
        usernameOrigins: usernameOrigins.length > 0 ? usernameOrigins : undefined,
        passwordOrigins: passwordOrigins.length > 0 ? passwordOrigins : undefined,
        updatedAt: Math.max(Date.now(), existing.updatedAt + 1),
      }
      return next
    }

    const usernameOrigins = normalizePasswordOrigins(draft.usernameOrigins)
    const passwordOrigins = normalizePasswordOrigins(draft.passwordOrigins)
    return [{
      ...draft,
      usernameOrigins: usernameOrigins.length > 0 ? usernameOrigins : undefined,
      passwordOrigins: passwordOrigins.length > 0 ? passwordOrigins : undefined,
      id: crypto.randomUUID(),
      updatedAt: Date.now(),
    }, ...vault]
  })
}
