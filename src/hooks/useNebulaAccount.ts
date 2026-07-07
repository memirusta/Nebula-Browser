import { useCallback, useState } from 'react'
import {
  accountDisplayName,
  loadNebulaAccount,
  saveNebulaAccount,
  NEBULA_ACCOUNT_KEY,
  type NebulaAccount,
} from '../core/nebulaAccount'
import { useStorageSync } from '../core/storageSync'

export function useNebulaAccount(fallbackName: string) {
  const [account, setAccount] = useState<NebulaAccount | null>(() => loadNebulaAccount())

  const reloadAccount = useCallback(() => {
    setAccount(loadNebulaAccount())
  }, [])

  useStorageSync(NEBULA_ACCOUNT_KEY, reloadAccount)

  const setAccountAndPersist = useCallback((next: NebulaAccount | null) => {
    saveNebulaAccount(next)
    setAccount(next)
  }, [])

  const displayName = accountDisplayName(account, fallbackName)

  return {
    account,
    displayName,
    setAccount: setAccountAndPersist,
  }
}
