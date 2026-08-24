import { invoke } from '@tauri-apps/api/core'
import { cursorPosition, getAllWindows } from '@tauri-apps/api/window'
import type { BrowserTab } from '../core/browserTab.ts'
import {
  browserTransferStorageKey,
  browserWindowLabel,
  type BrowserTabTransfer,
} from '../core/browserWorkspace.ts'
import { persistedBrowserTabFromBrowserTab } from '../core/browserSessionSnapshot.ts'
import { tabWebviewLabel } from '../core/browserTab.ts'
import { isTauri } from './runtime'

export function createBrowserWindowId(): string {
  return `nebula-window-${crypto.randomUUID()}`
}

export async function createNebulaBrowserWindow(
  windowId = createBrowserWindowId(),
  transferId?: string,
): Promise<string> {
  if (!isTauri) return windowId
  return invoke<string>('browser_create_window', {
    windowId: browserWindowLabel(windowId),
    transferId: transferId ?? null,
  })
}

export async function markBrowserWindowActive(windowLabel: string): Promise<void> {
  if (!isTauri) return
  await invoke('browser_mark_window_active', { windowLabel })
}

export function createBrowserTabTransfer(
  sourceWindowId: string,
  targetWindowId: string,
  tab: BrowserTab,
): BrowserTabTransfer {
  const persisted = persistedBrowserTabFromBrowserTab(tab)
  if (!persisted) throw new Error('Only HTTP(S) tabs can move between Nebula windows.')
  return {
    id: crypto.randomUUID(),
    sourceWindowId,
    targetWindowId,
    tab: persisted,
    webviewLabel: tabWebviewLabel(tab.shortcutId),
    createdAt: Date.now(),
    state: 'pending',
  }
}

export function saveBrowserTabTransfer(transfer: BrowserTabTransfer): void {
  localStorage.setItem(
    browserTransferStorageKey(transfer.id),
    JSON.stringify(transfer),
  )
}

export function loadBrowserTabTransfer(transferId: string): BrowserTabTransfer | null {
  try {
    const raw = localStorage.getItem(browserTransferStorageKey(transferId))
    if (!raw) return null
    const transfer = JSON.parse(raw) as Partial<BrowserTabTransfer>
    if (
      transfer.id !== transferId ||
      typeof transfer.sourceWindowId !== 'string' ||
      typeof transfer.targetWindowId !== 'string' ||
      typeof transfer.webviewLabel !== 'string' ||
      !transfer.tab ||
      typeof transfer.tab !== 'object'
    ) return null
    return transfer as BrowserTabTransfer
  } catch {
    return null
  }
}

export function updateBrowserTabTransfer(
  transfer: BrowserTabTransfer,
  state: BrowserTabTransfer['state'],
): BrowserTabTransfer {
  const next = { ...transfer, state }
  saveBrowserTabTransfer(next)
  return next
}

export function clearBrowserTabTransfer(transferId: string): void {
  localStorage.removeItem(browserTransferStorageKey(transferId))
}

export async function reparentBrowserTab(
  transfer: BrowserTabTransfer,
): Promise<BrowserTabTransfer> {
  await reparentBrowserTabToWindow(transfer, transfer.targetWindowId)
  return updateBrowserTabTransfer(transfer, 'ready')
}

export async function reparentBrowserTabToWindow(
  transfer: BrowserTabTransfer,
  windowId: string,
): Promise<void> {
  if (isTauri) {
    const targetWindowLabel = browserWindowLabel(windowId)
    const confirmedParentLabel = await invoke<string>('browser_reparent_tab', {
      tabLabel: transfer.webviewLabel,
      targetWindowLabel,
    })
    if (confirmedParentLabel !== targetWindowLabel) {
      throw new Error(
        `Transferred webview '${transfer.webviewLabel}' has parent '${confirmedParentLabel}', expected '${targetWindowLabel}'.`,
      )
    }
  }
}

export async function waitForBrowserTabTransferClaim(
  transferId: string,
  timeoutMs = 8_000,
): Promise<BrowserTabTransfer> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const transfer = loadBrowserTabTransfer(transferId)
    if (transfer?.state === 'claimed') return transfer
    if (transfer?.state === 'cancelled') {
      throw new Error(`Browser tab transfer '${transferId}' was cancelled by the target window.`)
    }
    await new Promise((resolve) => window.setTimeout(resolve, 40))
  }
  throw new Error(`Browser tab transfer '${transferId}' was not claimed in time.`)
}

export async function browserWindowAtScreenPoint(
  screenX: number,
  screenY: number,
): Promise<string | null> {
  if (!isTauri) return null
  const pointer = await cursorPosition().catch(() => ({
    x: screenX,
    y: screenY,
  }))
  const windows = await getAllWindows()
  for (const window of windows) {
    if (window.label !== 'main' && !window.label.startsWith('nebula-window-')) {
      continue
    }
    const [position, size] = await Promise.all([
      window.outerPosition(),
      window.outerSize(),
    ])
    if (
      pointer.x >= position.x &&
      pointer.y >= position.y &&
      pointer.x < position.x + size.width &&
      pointer.y < position.y + size.height
    ) {
      return window.label
    }
  }
  return null
}
