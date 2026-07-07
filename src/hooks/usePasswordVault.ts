import { useCallback, useState } from 'react'
import {
  addPasswordEntry,
  loadPasswordVault,
  PASSWORD_VAULT_KEY,
  removePasswordEntry,
  type SavedPassword,
} from '../core/passwordVault'
import { mergeImportedPasswords } from '../core/passwordImport'
import { useStorageSync } from '../core/storageSync'

export function usePasswordVault() {
  const [entries, setEntries] = useState<SavedPassword[]>(() => loadPasswordVault())

  const reload = useCallback(() => {
    setEntries(loadPasswordVault())
  }, [])

  useStorageSync(PASSWORD_VAULT_KEY, reload)

  const addEntry = useCallback((draft: Omit<SavedPassword, 'id' | 'updatedAt'>) => {
    setEntries(addPasswordEntry(draft))
  }, [])

  const mergeEntries = useCallback((drafts: Array<Omit<SavedPassword, 'id' | 'updatedAt'>>) => {
    setEntries(mergeImportedPasswords(drafts))
  }, [])

  const removeEntry = useCallback((id: string) => {
    setEntries(removePasswordEntry(id))
  }, [])

  return { entries, addEntry, mergeEntries, removeEntry }
}
