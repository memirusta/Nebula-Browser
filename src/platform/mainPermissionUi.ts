import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'
import { currentBrowserWindowLabel } from './browserWindowScope'

let configured = false
let configuring: Promise<void> | null = null

export async function ensureMainPermissionUi(): Promise<void> {
  if (!isTauri || configured) return

  if (!configuring) {
    configuring = invoke<void>(
      'webview_setup_main_site_permissions',
      {
        label: currentBrowserWindowLabel(),
      },
    ).then(() => {
      configured = true
    }).finally(() => {
      configuring = null
    })
  }

  await configuring
}
