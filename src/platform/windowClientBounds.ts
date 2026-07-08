import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** Client area in physical pixels (avoids logical round-trip gaps on Windows). */
export async function windowClientPhysicalSize(): Promise<PhysicalSize> {
  return getCurrentWindow().innerSize()
}

export function logicalHeightToPhysical(
  logicalHeight: number,
  scaleFactor: number,
): number {
  return Math.ceil(logicalHeight * scaleFactor)
}

/** Site webview fills the client area; semi-lunar overlays on the shell webview. */
export async function browserWebviewPhysicalBounds(): Promise<{
  position: PhysicalPosition
  size: PhysicalSize
}> {
  const size = await windowClientPhysicalSize()
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
