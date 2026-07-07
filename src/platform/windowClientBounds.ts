import { PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getBrowsingChromeLogicalHeight } from './browsingLayout'

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

/** Site webview sits below the chrome strip (title bar + semi-lunar). */
export async function browserWebviewPhysicalBounds(): Promise<{
  position: PhysicalPosition
  size: PhysicalSize
}> {
  const appWindow = getCurrentWindow()
  const [windowSize, scale] = await Promise.all([
    windowClientPhysicalSize(),
    appWindow.scaleFactor(),
  ])
  const topOffset = logicalHeightToPhysical(getBrowsingChromeLogicalHeight(), scale)

  return {
    position: new PhysicalPosition(0, topOffset),
    size: new PhysicalSize(
      windowSize.width,
      Math.max(1, windowSize.height - topOffset),
    ),
  }
}
