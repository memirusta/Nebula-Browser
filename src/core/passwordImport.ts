import type { SavedPassword } from './passwordVault'
import { updatePasswordVault } from './passwordVault'

export { parsePasswordCsv, type ImportedPassword } from './passwordCsv'

function entryKey(entry: { url?: string; username: string }): string {
  return `${(entry.url ?? '').toLowerCase()}\0${entry.username.toLowerCase()}`
}

export async function mergeImportedPasswords(
  imported: Array<Omit<SavedPassword, 'id' | 'updatedAt'>>,
): Promise<SavedPassword[]> {
  return updatePasswordVault((vault) => {
    const map = new Map<string, SavedPassword>()
    for (const entry of vault) {
      map.set(entryKey(entry), entry)
    }

    const now = Date.now()
    for (const draft of imported) {
      const key = entryKey(draft)
      const existing = map.get(key)
      map.set(key, {
        id: existing?.id ?? crypto.randomUUID(),
        label: draft.label,
        url: draft.url,
        username: draft.username,
        password: draft.password,
        updatedAt: now,
      })
    }

    return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  })
}
