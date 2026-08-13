import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'

export async function openDefaultBrowserSettings(): Promise<void> {
  if (!isTauri) {
    throw new Error('Default browser settings are only available in the desktop app.')
  }

  await invoke('open_default_browser_settings')
}