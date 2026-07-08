import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './runtime'
import { syncTauriBrowserBounds } from './tauriBrowser'

export async function isMonitorCoverMaximized(): Promise<boolean> {
  if (!isTauri) return false
  try {
    return await invoke<boolean>('window_is_monitor_maximized')
  } catch {
    return false
  }
}

export async function toggleMonitorCoverMaximize(): Promise<boolean> {
  if (!isTauri) return false

  const maximized = await invoke<boolean>('window_toggle_monitor_maximize')
  await syncTauriBrowserBounds()
  return maximized
}
