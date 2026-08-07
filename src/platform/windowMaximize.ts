import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from './runtime'
import { syncTauriBrowserBounds } from './tauriBrowser'

export async function isWindowMaximized(): Promise<boolean> {
  if (!isTauri) return false
  return getCurrentWindow().isMaximized()
}

export async function toggleWindowMaximize(): Promise<boolean> {
  if (!isTauri) return false

  const appWindow = getCurrentWindow()
  await appWindow.toggleMaximize()
  const maximized = await appWindow.isMaximized()
  await syncTauriBrowserBounds()
  return maximized
}
