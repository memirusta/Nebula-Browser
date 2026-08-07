import { useCallback, useEffect, useState } from 'react'
import {
  addPasswordEntry,
  loadPasswordVault,
  removePasswordEntry,
  PASSWORD_VAULT_CHANGED_EVENT,
  type SavedPassword,
} from '../core/passwordVault'
import { mergeImportedPasswords } from '../core/passwordImport'

export function usePasswordVault() {
  const [entries, setEntries] = useState<SavedPassword[]>([])

  const reload = useCallback(async () => {
    setEntries(await loadPasswordVault())
  }, [])

  useEffect(() => {
    const onChanged = () => {
      void reload().catch(() => undefined)
    }
    void reload().catch(() => undefined)
    window.addEventListener(PASSWORD_VAULT_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(PASSWORD_VAULT_CHANGED_EVENT, onChanged)
  }, [reload])

  const addEntry = useCallback(async (draft: Omit<SavedPassword, 'id' | 'updatedAt'>) => {
    setEntries(await addPasswordEntry(draft))
  }, [])

  const mergeEntries = useCallback(async (drafts: Array<Omit<SavedPassword, 'id' | 'updatedAt'>>) => {
    setEntries(await mergeImportedPasswords(drafts))
  }, [])

  const removeEntry = useCallback(async (id: string) => {
    setEntries(await removePasswordEntry(id))
  }, [])

  return { entries, addEntry, mergeEntries, removeEntry, reload }
}
