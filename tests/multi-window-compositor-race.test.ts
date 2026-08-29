import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('z-order coalescing keeps the newest active tab request', () => {
  const stack = readFileSync('src/platform/tauriWebviewStack.ts', 'utf8')

  assert.match(stack, /pendingStackActiveTabId = activeTabId \?\? null[\s\S]*if \(stackTimer\) return/)
  assert.match(stack, /const latestActiveTabId = pendingStackActiveTabId[\s\S]*stackBrowsingChromeAboveBrowser\(latestActiveTabId\)/)
})

test('relinquishing an active transferred tab cancels delayed source-window restacks', () => {
  const browser = readFileSync('src/platform/tauriBrowser.ts', 'utf8')

  assert.match(
    browser,
    /if \(activeTabId === shortcutId\) \{[\s\S]*cancelScheduledStack\(\)[\s\S]*activeTabId = null/,
  )
})

test('native compositor refuses an active tab owned by another window', () => {
  const native = readFileSync('src-tauri/src/lib.rs', 'utf8')

  assert.match(
    native,
    /get_webview\(label\)[\s\S]*webview\.window\(\)\.label\(\) == window_label/,
  )
})
