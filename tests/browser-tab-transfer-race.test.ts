import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { BrowserTabTransfer } from '../src/core/browserWorkspace.ts'
import { createTabNavigationState } from '../src/core/tabNavigation.ts'
import {
  browserTabTransferIdsForTarget,
  loadBrowserTabTransfer,
  markBrowserTabTransferTargetReady,
  pruneBrowserTabTransfers,
  saveBrowserTabTransfer,
  updateBrowserTabTransfer,
  waitForBrowserTabTransferReady,
  waitForBrowserTabTransferTargetReady,
} from '../src/platform/tauriBrowserWorkspace.ts'

class MemoryStorage {
  readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

function transfer(state: BrowserTabTransfer['state']): BrowserTabTransfer {
  const url = 'https://example.com/transferred'
  return {
    id: 'transfer-race',
    sourceWindowId: 'main',
    targetWindowId: 'nebula-window-target',
    webviewLabel: 'nebula-tab-main-transferred',
    createdAt: Date.now(),
    state,
    tab: {
      tabId: 'transferred',
      shortcutId: 'transferred',
      url,
      title: 'Transferred',
      favicon: 'https://example.com/favicon.ico',
      navigation: createTabNavigationState(url, 'Transferred'),
    },
  }
}

test('new target keeps watching a pending transfer until reparent marks it ready', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })

  try {
    const pending = transfer('pending')
    saveBrowserTabTransfer(pending)
    globalThis.setTimeout(() => {
      updateBrowserTabTransfer(pending, 'ready')
    }, 5)

    const ready = await waitForBrowserTabTransferReady(
      pending.id,
      pending.targetWindowId,
      250,
    )
    assert.equal(ready.state, 'ready')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})


test('new target publishes receiver readiness before source reparents the live webview', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })

  try {
    const pending = transfer('pending')
    saveBrowserTabTransfer(pending)

    const marked = markBrowserTabTransferTargetReady(
      pending.id,
      pending.targetWindowId,
    )
    assert.equal(marked?.state, 'target-ready')

    const ready = await waitForBrowserTabTransferTargetReady(
      pending.id,
      pending.targetWindowId,
      250,
    )
    assert.equal(ready.state, 'target-ready')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

test('new window can discover a pending transfer by destination without a transfer query id', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })

  try {
    const pending = transfer('pending')
    saveBrowserTabTransfer(pending)
    saveBrowserTabTransfer({
      ...pending,
      id: 'target-ready',
      state: 'target-ready',
    })
    saveBrowserTabTransfer({
      ...pending,
      id: 'other-target',
      targetWindowId: 'nebula-window-other',
    })
    saveBrowserTabTransfer({
      ...pending,
      id: 'already-claimed',
      state: 'claimed',
    })

    assert.deepEqual(
      browserTabTransferIdsForTarget(pending.targetWindowId),
      [pending.id, 'target-ready'],
    )
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

test('stale and finished tab-transfer records are pruned without touching live work', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  })

  try {
    const now = Date.now()
    const pending = { ...transfer('pending'), id: 'recent-pending', createdAt: now - 5_000 }
    saveBrowserTabTransfer(pending)
    saveBrowserTabTransfer({ ...pending, id: 'stale-pending', createdAt: now - 180_000 })
    saveBrowserTabTransfer({ ...pending, id: 'old-claimed', state: 'claimed', createdAt: now - 45_000 })
    storage.setItem('nebula-browser-tab-transfer-v1:invalid', '{not-json')

    assert.equal(pruneBrowserTabTransfers(now), 3)
    assert.equal(loadBrowserTabTransfer(pending.id)?.state, 'pending')
    assert.equal(storage.length, 1)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

test('window transfer uses targeted events plus the new-window ready watcher', () => {
  const workspace = readFileSync('src/platform/tauriBrowserWorkspace.ts', 'utf8')
  const shell = readFileSync('src/components/BrowserShell/BrowserShell.tsx', 'utf8')
  const browser = readFileSync('src/platform/tauriBrowser.ts', 'utf8')

  assert.match(workspace, /emitTo\([\s\S]*BROWSER_TAB_TRANSFER_READY_EVENT/)
  assert.match(shell, /listenBrowserTabTransferReady\([\s\S]*tryClaim\(transferId\)/)
  assert.match(
    shell,
    /browserTabTransferIdsForTarget\([\s\S]*browserWindowIdRef\.current/,
  )
  assert.match(
    shell,
    /waitForBrowserTabTransferReady\([\s\S]*transferId[\s\S]*browserWindowIdRef\.current/,
  )
  assert.doesNotMatch(shell, /closeNebulaBrowserWindow\(targetWindowId\)/)
  assert.match(
    shell,
    /waitForBrowserTabTransferClaim\([\s\S]*targetWindowId/,
  )
  assert.match(
    shell,
    /waitForBrowserTabTransferTargetReady\([\s\S]*transfer\.id[\s\S]*targetWindowId/,
  )
  assert.match(
    shell,
    /markBrowserTabTransferTargetReady\([\s\S]*browserWindowIdRef\.current/,
  )
  assert.match(
    shell,
    /if \(adopted\) relinquishBrowseTabOwnership\(shortcutId\)[\s\S]*updateBrowserTabTransfer\(transfer, 'cancelled'\)/,
  )
  assert.match(
    shell,
    /reparentBrowserTabToWindow\(transfer, sourceWindowId\)[\s\S]*adoptReparentedBrowseTab\([\s\S]*shortcutId[\s\S]*transfer\.webviewLabel/,
  )
  assert.match(
    workspace,
    /waitForBrowserTabTransferClaim\([\s\S]*nextReadySignalAt[\s\S]*emitTo\(/,
  )
  assert.match(
    browser,
    /adoptReparentedBrowseTab[\s\S]*try \{[\s\S]*configureTabWebview[\s\S]*catch \(error\)[\s\S]*webviewCache\.delete\(shortcutId\)[\s\S]*releaseTabWebviewLabel\(shortcutId\)/,
  )
})


test('a single-tab window can transfer its last tab and returns the source to Home', () => {
  const shell = readFileSync('src/components/BrowserShell/BrowserShell.tsx', 'utf8')

  assert.doesNotMatch(shell, /blocked-only-tab/)
  assert.match(
    shell,
    /const sourceWillBeEmpty =[\s\S]*tabsRef\.current\.length === 1[\s\S]*tabsRef\.current\[0\]\?\.shortcutId === shortcutId/,
  )
  assert.match(
    shell,
    /if \(sourceWillBeEmpty\) \{[\s\S]*setActiveUrl\(null\)[\s\S]*setViewMode\('home'\)[\s\S]*applyTauriViewModeNow\('home', null\)/,
  )
  assert.doesNotMatch(
    shell,
    /remaining\.length === 0[\s\S]*getCurrentWindow\(\)\.close\(\)/,
  )
})

test('dropping a tab outside the Semi-Lunar retries the deferred menu close after drag end', () => {
  const menu = readFileSync(
    'src/components/SemiLunarMenu/SemiLunarMenu.tsx',
    'utf8',
  )

  assert.match(
    menu,
    /const handleMenuLeave = useCallback\(\(\) => \{[\s\S]*menuHoverRef\.current = false[\s\S]*scheduleClose\(\)/,
  )
  assert.match(
    menu,
    /const handleDragEnd = useCallback\(\(\) => \{[\s\S]*isDraggingRef\.current = false[\s\S]*if \(!menuHoverRef\.current\) scheduleClose\(\)/,
  )
  assert.match(menu, /onMouseLeave=\{handleMenuLeave\}/)
})

test('native reparent atomically resets a transferred tab to the target client origin', () => {
  const native = readFileSync('src-tauri/src/browser_workspace.rs', 'utf8')
  const reparent = native.slice(native.indexOf('pub fn reparent_tab'))

  assert.match(
    reparent,
    /tab\.reparent\(&target\)[\s\S]*tab\.set_auto_resize\(false\)[\s\S]*target\.inner_size\(\)[\s\S]*tab\.set_bounds\(tauri::Rect/,
  )
  assert.match(
    reparent,
    /position: tauri::PhysicalPosition::new\(0, 0\)\.into\(\)/,
  )
})

test('transferred tab layout uses one complete bounds update instead of stale-parent split calls', () => {
  const browser = readFileSync('src/platform/tauriBrowser.ts', 'utf8')
  const native = readFileSync('src-tauri/src/lib.rs', 'utf8')
  const permissions = readFileSync(
    'src-tauri/permissions/webview-commands.toml',
    'utf8',
  )

  const applyBounds = browser.slice(
    browser.indexOf('async function applyBrowserBounds'),
    browser.indexOf('async function syncBrowserBounds'),
  )
  assert.match(
    applyBounds,
    /invoke\('webview_set_browser_bounds',[\s\S]*windowLabel: currentBrowserWindowLabel\(\)[\s\S]*width: size\.width[\s\S]*height: size\.height/,
  )
  assert.match(
    applyBounds,
    /await webview\.setSize\(size\)[\s\S]*await webview\.setPosition\(position\)/,
  )

  const syncBounds = browser.slice(
    browser.indexOf('async function syncBrowserBounds'),
    browser.indexOf('function unbindResizeListeners'),
  )
  assert.match(syncBounds, /applyBrowserBounds\(webview, position, size\)/)
  assert.doesNotMatch(syncBounds, /webview\.setPosition|webview\.setSize/)

  assert.match(
    native,
    /fn webview_set_browser_bounds\([\s\S]*actual_window_label != window_label[\s\S]*webview[\s\S]*\.set_bounds\(tauri::Rect/,
  )
  assert.match(
    native,
    /generate_handler!\[[\s\S]*webview_set_browser_bounds/,
  )
  assert.match(permissions, /"webview_set_browser_bounds"/)
})
