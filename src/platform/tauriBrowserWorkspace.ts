import { invoke } from '@tauri-apps/api/core'
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { cursorPosition, getAllWindows } from '@tauri-apps/api/window'
import type { BrowserTab } from '../core/browserTab.ts'
import {
  browserTransferStorageKey,
  browserWindowLabel,
  type BrowserTabTransfer,
} from '../core/browserWorkspace.ts'
import { persistedBrowserTabFromBrowserTab } from '../core/browserSessionSnapshot.ts'
import { tabWebviewLabel } from '../core/browserTab.ts'
import { isTauri } from './runtime.ts'

const BROWSER_TAB_TRANSFER_READY_EVENT = 'nebula-browser-tab-transfer-ready'
const ACTIVE_TRANSFER_MAX_AGE_MS = 2 * 60_000
const FINISHED_TRANSFER_MAX_AGE_MS = 30_000

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

export function pruneBrowserTabTransfers(now = Date.now()): number {
  const prefix = browserTransferStorageKey('')
  const keys: string[] = []
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (key?.startsWith(prefix)) keys.push(key)
  }

  let removed = 0
  for (const key of keys) {
    const transferId = key.slice(prefix.length)
    const transfer = transferId ? loadBrowserTabTransfer(transferId) : null
    const createdAt = transfer?.createdAt
    const age = typeof createdAt === 'number' ? now - createdAt : Number.POSITIVE_INFINITY
    const invalidTimestamp = !Number.isFinite(age) || age < -60_000
    const finished = transfer?.state === 'claimed' || transfer?.state === 'cancelled'
    if (
      !transfer ||
      invalidTimestamp ||
      age > ACTIVE_TRANSFER_MAX_AGE_MS ||
      (finished && age > FINISHED_TRANSFER_MAX_AGE_MS)
    ) {
      localStorage.removeItem(key)
      removed += 1
    }
  }
  return removed
}

export function markBrowserTabTransferTargetReady(
  transferId: string,
  targetWindowId: string,
): BrowserTabTransfer | null {
  const transfer = loadBrowserTabTransfer(transferId)
  if (!transfer || transfer.targetWindowId !== targetWindowId) return null

  if (transfer.state === 'pending') {
    return updateBrowserTabTransfer(transfer, 'target-ready')
  }

  if (
    transfer.state === 'target-ready' ||
    transfer.state === 'ready' ||
    transfer.state === 'claimed'
  ) {
    return transfer
  }

  return null
}

export async function waitForBrowserTabTransferTargetReady(
  transferId: string,
  targetWindowId: string,
  timeoutMs = 8_000,
): Promise<BrowserTabTransfer> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const transfer = loadBrowserTabTransfer(transferId)
    if (transfer && transfer.targetWindowId !== targetWindowId) {
      throw new Error(
        `Browser tab transfer '${transferId}' targets '${transfer.targetWindowId}', not '${targetWindowId}'.`,
      )
    }
    if (
      transfer?.state === 'target-ready' ||
      transfer?.state === 'ready' ||
      transfer?.state === 'claimed'
    ) {
      return transfer
    }
    if (transfer?.state === 'cancelled') {
      throw new Error(`Browser tab transfer '${transferId}' was cancelled before the target became ready.`)
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 40))
  }
  throw new Error(`Browser tab transfer '${transferId}' target window did not become ready in time.`)
}

export function browserTabTransferIdsForTarget(
  targetWindowId: string,
): string[] {
  const prefix = browserTransferStorageKey('')
  const transferIds: string[] = []

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)
    if (!key?.startsWith(prefix)) continue

    const transferId = key.slice(prefix.length)
    if (!transferId) continue

    const transfer = loadBrowserTabTransfer(transferId)
    if (
      !transfer ||
      transfer.targetWindowId !== targetWindowId ||
      (
        transfer.state !== 'pending' &&
        transfer.state !== 'target-ready' &&
        transfer.state !== 'ready'
      )
    ) {
      continue
    }

    transferIds.push(transferId)
  }

  return transferIds
}

export async function reparentBrowserTab(
  transfer: BrowserTabTransfer,
): Promise<BrowserTabTransfer> {
  await reparentBrowserTabToWindow(transfer, transfer.targetWindowId)
  const ready = updateBrowserTabTransfer(transfer, 'ready')
  if (isTauri) {
    await emitTo(
      browserWindowLabel(transfer.targetWindowId),
      BROWSER_TAB_TRANSFER_READY_EVENT,
      transfer.id,
    ).catch(() => {
      // A newly created target may not have mounted its listener yet. Its
      // transfer-id watcher below remains the authoritative fallback.
    })
  }
  return ready
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

export async function listenBrowserTabTransferReady(
  onReady: (transferId: string) => void,
): Promise<UnlistenFn> {
  if (!isTauri) return () => {}
  return listen<string>(BROWSER_TAB_TRANSFER_READY_EVENT, ({ payload }) => {
    onReady(payload)
  })
}

export async function waitForBrowserTabTransferReady(
  transferId: string,
  targetWindowId: string,
  timeoutMs = 8_000,
  signal?: AbortSignal,
): Promise<BrowserTabTransfer> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error(`Browser tab transfer '${transferId}' ready wait was cancelled.`)
    }

    const transfer = loadBrowserTabTransfer(transferId)
    if (transfer && transfer.targetWindowId !== targetWindowId) {
      throw new Error(
        `Browser tab transfer '${transferId}' targets '${transfer.targetWindowId}', not '${targetWindowId}'.`,
      )
    }
    if (transfer?.state === 'ready' || transfer?.state === 'claimed') return transfer
    if (transfer?.state === 'cancelled') {
      throw new Error(`Browser tab transfer '${transferId}' was cancelled by the source window.`)
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, 40))
  }
  throw new Error(`Browser tab transfer '${transferId}' did not become ready in time.`)
}

export async function waitForBrowserTabTransferClaim(
  transferId: string,
  timeoutMs = 8_000,
  targetWindowId?: string,
): Promise<BrowserTabTransfer> {
  const deadline = Date.now() + timeoutMs
  let nextReadySignalAt = 0

  while (Date.now() < deadline) {
    const transfer = loadBrowserTabTransfer(transferId)
    if (transfer?.state === 'claimed') return transfer
    if (transfer?.state === 'cancelled') {
      throw new Error(`Browser tab transfer '${transferId}' was cancelled by the target window.`)
    }

    // A newly-created window can miss the first targeted ready event while its
    // React tree/listener is still mounting. Re-emit the ready signal while
    // waiting for the claim instead of treating one missed event as failure.
    // Existing-window transfers keep the same behavior; the extra signal is
    // idempotent because the target de-duplicates claims by transfer id.
    if (
      isTauri &&
      targetWindowId &&
      transfer?.state === 'ready' &&
      Date.now() >= nextReadySignalAt
    ) {
      nextReadySignalAt = Date.now() + 250
      await emitTo(
        browserWindowLabel(targetWindowId),
        BROWSER_TAB_TRANSFER_READY_EVENT,
        transferId,
      ).catch(() => {
        // Target may still be mounting; retry until timeout/claim.
      })
    }

    await new Promise((resolve) => globalThis.setTimeout(resolve, 40))
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
