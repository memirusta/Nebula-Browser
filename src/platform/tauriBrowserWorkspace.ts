import { invoke } from '@tauri-apps/api/core'
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { cursorPosition, getAllWindows } from '@tauri-apps/api/window'
import type { BrowserTab } from '../core/browserTab.ts'
import {
  transferredBrowserTabFromBrowserTab,
  browserWindowLabel,
  type BrowserTabTransfer,
} from '../core/browserWorkspace.ts'
import { tabWebviewLabel } from '../core/browserTab.ts'
import {
  parseBrowserWindowDropTarget,
  type BrowserWindowDropTarget,
} from '../core/browserDropTarget.ts'
import { isTauri } from './runtime.ts'

const BROWSER_TAB_TRANSFER_READY_EVENT = 'nebula-browser-tab-transfer-ready'
const TRANSFER_FALLBACK_POLL_MS = 120
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
  const persisted = transferredBrowserTabFromBrowserTab(tab)
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

const volatileTransfers = new Map<string, BrowserTabTransfer>()

async function listBrowserTabTransfers(): Promise<BrowserTabTransfer[]> {
  if (isTauri) return invoke<BrowserTabTransfer[]>('browser_tab_transfer_store', { action: 'list' })
  return [...volatileTransfers.values()]
}

export async function saveBrowserTabTransfer(transfer: BrowserTabTransfer): Promise<void> {
  if (isTauri) {
    await invoke('browser_tab_transfer_store', { action: 'set', transfer })
  } else if (!volatileTransfers.has(transfer.id)) {
    volatileTransfers.set(transfer.id, structuredClone(transfer))
  }
}

export async function loadBrowserTabTransfer(transferId: string): Promise<BrowserTabTransfer | null> {
  if (isTauri) return invoke<BrowserTabTransfer | null>('browser_tab_transfer_store', { action: 'get', id: transferId })
  const transfer = volatileTransfers.get(transferId)
  return transfer ? structuredClone(transfer) : null
}

export async function updateBrowserTabTransfer(
  transfer: BrowserTabTransfer,
  state: BrowserTabTransfer['state'],
): Promise<BrowserTabTransfer> {
  const next = await advanceBrowserTabTransfer(transfer.id, state, transfer.targetWindowId)
  if (!next) throw new Error(`Browser tab transfer '${transfer.id}' is no longer available for this target.`)
  const alreadyFurther =
    (state === 'target-ready' && (next.state === 'ready' || next.state === 'claimed')) ||
    (state === 'ready' && next.state === 'claimed')
  if (next.state !== state && !alreadyFurther) {
    throw new Error(`Browser tab transfer '${transfer.id}' cannot move from '${next.state}' to '${state}'.`)
  }
  return next
}

async function advanceBrowserTabTransfer(
  transferId: string,
  state: BrowserTabTransfer['state'],
  targetWindowId: string,
): Promise<BrowserTabTransfer | null> {
  if (isTauri) {
    return invoke<BrowserTabTransfer | null>('browser_tab_transfer_store', {
      action: 'advance', id: transferId, state, targetWindowId,
    })
  }
  // This synchronous read/change is the web equivalent of the native mutex.
  const current = volatileTransfers.get(transferId)
  if (!current || current.targetWindowId !== targetWindowId) return null
  const allowed =
    (current.state === 'pending' && ['target-ready', 'ready', 'cancelled'].includes(state)) ||
    (current.state === 'target-ready' && ['ready', 'cancelled'].includes(state)) ||
    (current.state === 'ready' && ['claimed', 'cancelled'].includes(state))
  const next = allowed ? { ...current, state } : current
  if (allowed) volatileTransfers.set(transferId, next)
  return structuredClone(next)
}

export async function clearBrowserTabTransfer(transferId: string): Promise<void> {
  if (isTauri) await invoke('browser_tab_transfer_store', { action: 'remove', id: transferId })
  else volatileTransfers.delete(transferId)
}

export async function pruneBrowserTabTransfers(now = Date.now()): Promise<number> {
  let removed = 0
  for (const transfer of await listBrowserTabTransfers()) {
    const age = now - transfer.createdAt
    const finished = transfer.state === 'claimed' || transfer.state === 'cancelled'
    if (!Number.isFinite(age) || age < -60_000 || age > ACTIVE_TRANSFER_MAX_AGE_MS ||
        (finished && age > FINISHED_TRANSFER_MAX_AGE_MS)) {
      await clearBrowserTabTransfer(transfer.id)
      removed += 1
    }
  }
  return removed
}

export async function markBrowserTabTransferTargetReady(
  transferId: string,
  targetWindowId: string,
): Promise<BrowserTabTransfer | null> {
  const transfer = await advanceBrowserTabTransfer(transferId, 'target-ready', targetWindowId)
  return transfer?.state === 'cancelled' ? null : transfer
}

export async function waitForBrowserTabTransferTargetReady(
  transferId: string,
  targetWindowId: string,
  timeoutMs = 8_000,
): Promise<BrowserTabTransfer> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const transfer = await loadBrowserTabTransfer(transferId)
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
    await new Promise((resolve) => globalThis.setTimeout(resolve, TRANSFER_FALLBACK_POLL_MS))
  }
  throw new Error(`Browser tab transfer '${transferId}' target window did not become ready in time.`)
}

export async function browserTabTransferIdsForTarget(
  targetWindowId: string,
): Promise<string[]> {
  return (await listBrowserTabTransfers())
    .filter((transfer) => transfer.targetWindowId === targetWindowId &&
      ['pending', 'target-ready', 'ready'].includes(transfer.state))
    .map((transfer) => transfer.id)
}

export async function reparentBrowserTab(
  transfer: BrowserTabTransfer,
): Promise<BrowserTabTransfer> {
  await reparentBrowserTabToWindow(transfer, transfer.targetWindowId)
  const ready = await updateBrowserTabTransfer(transfer, 'ready')
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

    const transfer = await loadBrowserTabTransfer(transferId)
    if (transfer && transfer.targetWindowId !== targetWindowId) {
      throw new Error(
        `Browser tab transfer '${transferId}' targets '${transfer.targetWindowId}', not '${targetWindowId}'.`,
      )
    }
    if (transfer?.state === 'ready' || transfer?.state === 'claimed') return transfer
    if (transfer?.state === 'cancelled') {
      throw new Error(`Browser tab transfer '${transferId}' was cancelled by the source window.`)
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, TRANSFER_FALLBACK_POLL_MS))
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
    const transfer = await loadBrowserTabTransfer(transferId)
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

    await new Promise((resolve) => globalThis.setTimeout(resolve, TRANSFER_FALLBACK_POLL_MS))
  }
  throw new Error(`Browser tab transfer '${transferId}' was not claimed in time.`)
}

export interface BrowserDropDiagnostics {
  cursor: { x: number; y: number } | null
  windows: Array<{
    label: string
    x: number
    y: number
    width: number
    height: number
    cursorInside: boolean
  }>
}

/**
 * Diagnostic-only: physical OS cursor against every Nebula window rectangle.
 * It separates "the cursor really left Nebula" from "the native hit-test
 * returned no window while the cursor was inside one".
 */
export async function describeBrowserDropDiagnostics(): Promise<BrowserDropDiagnostics> {
  if (!isTauri) return { cursor: null, windows: [] }
  const cursor = await cursorPosition()
    .then((point) => ({ x: point.x, y: point.y }))
    .catch(() => null)
  const windows = await getAllWindows().catch(() => [])
  const entries = await Promise.all(windows.map(async (window) => {
    if (window.label !== 'main' && !window.label.startsWith('nebula-window-')) {
      return null
    }
    try {
      const [position, size] = await Promise.all([
        window.outerPosition(),
        window.outerSize(),
      ])
      return {
        label: window.label,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
        cursorInside:
          cursor !== null &&
          cursor.x >= position.x && cursor.y >= position.y &&
          cursor.x < position.x + size.width && cursor.y < position.y + size.height,
      }
    } catch {
      return null
    }
  }))
  return {
    cursor,
    windows: entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null),
  }
}

export async function browserWindowAtScreenPoint(
  screenX: number,
  screenY: number,
): Promise<BrowserWindowDropTarget> {
  if (!isTauri) return { kind: 'unknown' }
  try {
    // Windows resolves the physical OS cursor and topmost root HWND together.
    // DOM screenX/Y are logical pixels and are only used by the fallback below.
    return parseBrowserWindowDropTarget(await invoke<unknown>('browser_window_at_cursor'))
  } catch {
    // Compatibility with an older native binary during frontend hot reload.
  }
  // Geometry alone can find a window but can never prove the cursor is outside
  // Nebula, so a miss here stays `unknown` instead of creating a window.
  const pointer = await cursorPosition().catch(() => ({ x: screenX, y: screenY }))
  const windows = await getAllWindows().catch(() => [])
  const candidates = await Promise.all(windows.map(async (window) => {
    if (window.label !== 'main' && !window.label.startsWith('nebula-window-')) {
      return null
    }
    const [position, size] = await Promise.all([
      window.outerPosition(),
      window.outerSize(),
    ])
    return pointer.x >= position.x && pointer.y >= position.y &&
      pointer.x < position.x + size.width && pointer.y < position.y + size.height
      ? window.label
      : null
  }))
  const label = candidates.find((candidate): candidate is string => candidate !== null)
  return label ? { kind: 'window', label } : { kind: 'unknown' }
}
