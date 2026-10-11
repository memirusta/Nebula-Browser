import { invoke } from '@tauri-apps/api/core'
import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { isTauri } from './runtime'

type NativeClientBounds = {
  x: number
  y: number
  width: number
  height: number
}

/** Client area in physical pixels (avoids logical round-trip gaps on Windows). */
export async function windowClientPhysicalSize(): Promise<PhysicalSize> {
  if (isTauri) {
    const { width, height } = await invoke<NativeClientBounds>('window_client_physical_bounds', {
      windowLabel: getCurrentWindow().label,
    })
    return new PhysicalSize(width, height)
  }

  return getCurrentWindow().innerSize()
}

/** Site webview fills the client area; semi-lunar overlays on the shell webview. */
export async function browserWebviewPhysicalBounds(): Promise<{
  position: PhysicalPosition
  size: PhysicalSize
}> {
  if (isTauri) {
    const { x, y, width, height } = await invoke<NativeClientBounds>('window_client_physical_bounds', {
      windowLabel: getCurrentWindow().label,
    })
    return {
      position: new PhysicalPosition(x, y),
      size: new PhysicalSize(width, height),
    }
  }

  const size = await getCurrentWindow().innerSize()
  return {
    position: new PhysicalPosition(0, 0),
    size,
  }
}

/** Full client area for HTML5 site fullscreen (no chrome offset). */
export async function browserWebviewFullscreenPhysicalBounds(): Promise<{
  position: PhysicalPosition
  size: PhysicalSize
}> {
  const size = await windowClientPhysicalSize()
  return {
    position: new PhysicalPosition(0, 0),
    size,
  }
}
