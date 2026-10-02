import { useCallback, useEffect, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '../platform/runtime'
import {
  addPasswordEntry,
  editPasswordEntry,
  loadPasswordVault,
  removePasswordEntry,
  PASSWORD_VAULT_CHANGED_EVENT,
  type SavedPassword,
} from '../core/passwordVault'
import { mergeImportedPasswords } from '../core/passwordImport'

export function usePasswordVault() {
  const [entries, setEntries] = useState<SavedPassword[]>([])
  const reloadVersion = useRef(0)
  const mounted = useRef(true)

  const reload = useCallback(async () => {
    const version = ++reloadVersion.current
    const next = await loadPasswordVault()
    if (mounted.current && version === reloadVersion.current) setEntries(next)
  }, [])

  useEffect(() => {
    mounted.current = true
    let disposed = false
    let unlisten: (() => void) | undefined
    const onChanged = () => {
      void reload().catch(() => undefined)
    }
    void reload().catch(() => undefined)
    window.addEventListener(PASSWORD_VAULT_CHANGED_EVENT, onChanged)
    if (isTauri) {
      void listen(PASSWORD_VAULT_CHANGED_EVENT, onChanged).then((stop) => {
        if (disposed) stop()
        else {
          unlisten = stop
          onChanged()
        }
      }).catch(() => undefined)
    }
    return () => {
      disposed = true
      mounted.current = false
      unlisten?.()
      window.removeEventListener(PASSWORD_VAULT_CHANGED_EVENT, onChanged)
    }
  }, [reload])

  const addEntry = useCallback(async (draft: Omit<SavedPassword, 'id' | 'updatedAt'>) => {
    await addPasswordEntry(draft)
    await reload()
  }, [reload])

  const mergeEntries = useCallback(async (drafts: Array<Omit<SavedPassword, 'id' | 'updatedAt'>>) => {
    await mergeImportedPasswords(drafts)
    await reload()
  }, [reload])

  const removeEntry = useCallback(async (id: string) => {
    await removePasswordEntry(id)
    await reload()
  }, [reload])

  const editEntry = useCallback(async (
    id: string,
    expectedUpdatedAt: number,
    draft: Pick<SavedPassword, 'label' | 'url' | 'username' | 'password'>,
  ) => {
    const result = await editPasswordEntry(id, expectedUpdatedAt, draft)
    await reload()
    return result.updated
  }, [reload])

  return { entries, addEntry, mergeEntries, removeEntry, editEntry, reload }
}
