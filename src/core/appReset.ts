import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../platform/runtime'
import { runFactoryReset } from './factoryResetFlow'

const NEBULA_STORAGE_PREFIX = 'nebula-'

/** Remove every Nebula localStorage / sessionStorage entry. */
export function resetNebulaAppData(): void {
  const localKeys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(NEBULA_STORAGE_PREFIX)) {
      localKeys.push(key)
    }
  }
  for (const key of localKeys) {
    localStorage.removeItem(key)
  }

  const sessionKeys: string[] = []
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const key = sessionStorage.key(index)
    if (key?.startsWith(NEBULA_STORAGE_PREFIX)) {
      sessionKeys.push(key)
    }
  }
  for (const key of sessionKeys) {
    sessionStorage.removeItem(key)
  }
}

/** Reload shell without OAuth query params or hash state. */
export function reloadNebulaApp(): void {
  window.location.replace(`${window.location.origin}${window.location.pathname}`)
}

/** Wipe all persisted Nebula state and restart like a fresh install. */
export async function factoryResetNebulaApp(): Promise<void> {
  await runFactoryReset({
    clearBrowserProfiles: () =>
      isTauri ? invoke('webview_factory_reset_profiles') : Promise.resolve(),
    clearPasswordVault: () =>
      isTauri ? invoke('password_vault_clear') : Promise.resolve(),
    clearShellStorage: resetNebulaAppData,
    reloadShell: reloadNebulaApp,
  })
}
