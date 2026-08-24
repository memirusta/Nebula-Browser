import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  PRIMARY_BROWSER_WINDOW_ID,
  browserChromeLabel,
} from '../core/browserWorkspace.ts'
import { isTauri } from './runtime'

export const BROWSER_WINDOW_ID_QUERY = 'nebulaWindowId'
export const BROWSER_TRANSFER_ID_QUERY = 'nebulaTransferId'

export function currentBrowserWindowId(): string {
  const requested = new URLSearchParams(window.location.search).get(
    BROWSER_WINDOW_ID_QUERY,
  )
  if (requested) return requested
  if (isTauri) return getCurrentWindow().label
  return PRIMARY_BROWSER_WINDOW_ID
}

export function currentBrowserWindowLabel(): string {
  return isTauri ? getCurrentWindow().label : PRIMARY_BROWSER_WINDOW_ID
}

export function currentChromeWebviewLabel(): string {
  return browserChromeLabel(currentBrowserWindowId())
}

export function currentTransferId(): string | null {
  return new URLSearchParams(window.location.search).get(
    BROWSER_TRANSFER_ID_QUERY,
  )
}

export function scopedBrowserEvent(base: string): string {
  return `${base}:${currentBrowserWindowId()}`
}
