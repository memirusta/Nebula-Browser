import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

test('closing a panel of the overlay menu does not bring Semi-Lunar back over the menu', () => {
  // The overlay menu hides Semi-Lunar's surface on purpose, so it cannot cover the menu's buttons.
  const mode = read('src/platform/tauriBrowsingMode.ts')
  const overlay = mode.slice(mode.indexOf('async function applyOverlayMode'), mode.indexOf('async function applyViewMode'))
  assert.ok(overlay.includes('setOverlayModeActive(true)'))
  assert.ok(overlay.includes('await hideChromeWebview()'))

  // Notifications and history suppress the surface while they are open; lifting that must respect the overlay.
  const chrome = read('src/platform/tauriChromeWebview.ts')
  const suppress = chrome.slice(chrome.indexOf('export async function setChromeWebviewSuppressed'), chrome.indexOf('export async function hideChromeWebview'))
  const lifted = suppress.slice(suppress.indexOf('if (chromeVisibilitySuppressed) {'))
  const guard = lifted.indexOf('if (isOverlayModeActive()) return')
  assert.ok(guard > 0, 'the overlay is checked')
  assert.ok(guard < lifted.indexOf('await showChromeWebview('), 'before the surface is created')
  assert.ok(guard < lifted.indexOf('await webview.show()'), 'before the surface is shown')

  const stack = read('src/platform/tauriWebviewStack.ts')
  assert.ok(stack.includes('export function isOverlayModeActive(): boolean'))
  assert.ok(chrome.includes("import { isOverlayModeActive, stackBrowsingChromeAboveBrowser } from './tauriWebviewStack'"))
})
