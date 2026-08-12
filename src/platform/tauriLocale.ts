import { invoke } from '@tauri-apps/api/core'
import type { NebulaLocale } from '../core/locale'
import { isTauri } from './runtime'

export async function syncNativeUiLocale(locale: NebulaLocale): Promise<void> {
  if (!isTauri) return
  try {
    await invoke('webview_set_ui_locale', { locale })
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn('[nebula] Failed to sync native UI locale', error)
    }
  }
}
