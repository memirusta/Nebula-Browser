import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { chromeClipRegion } from '../src/core/chromeOverlayLayout.ts'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

const bubble = { x: 1500, y: 18, width: 40, height: 34 }
const idle = { bubbles: [bubble], fullHeight: false, logicalHeight: 10, minimumLogicalHeight: 78, stripLogicalHeight: 10 }

test('while only the strip and a bubble need the overlay, only they belong to it', () => {
  const region = chromeClipRegion(idle, 1.5)
  assert.ok(region)
  assert.equal(region.length, 2)
  // The strip spans the window at the scaled height of the collapsed menu.
  assert.deepEqual(region[0], { x: 0, y: 0, width: 32_000, height: 15 })
  // The bubble is converted to physical pixels and rounded outwards.
  assert.deepEqual(region[1], { x: 2250, y: 27, width: 60, height: 51 })
})

test('anything else that needs the overlay lifts the clip', () => {
  assert.equal(chromeClipRegion({ ...idle, bubbles: [] }, 1), null, 'no bubble: no clip')
  assert.equal(chromeClipRegion({ ...idle, fullHeight: true }, 1), null, 'a preview')
  assert.equal(chromeClipRegion({ ...idle, logicalHeight: 160 }, 1), null, 'the menu is open')
  assert.equal(chromeClipRegion({ ...idle, minimumLogicalHeight: 650 }, 1), null, 'a panel')
  assert.equal(chromeClipRegion(idle, 0), null, 'an unusable scale')
  assert.equal(chromeClipRegion(idle, Number.NaN), null)
})

test('empty bubbles are ignored and the region never has more rectangles than the native side takes', () => {
  const region = chromeClipRegion({ ...idle, bubbles: [{ x: 0, y: 0, width: 0, height: 30 }, bubble] }, 1)
  assert.equal(region?.length, 2)
  const many = chromeClipRegion({ ...idle, bubbles: Array.from({ length: 20 }, () => bubble) }, 1)
  assert.equal(many?.length, 8)
})

test('the clip command is registered and permitted, the chrome applies it after every bounds sync, and a failure leaves the overlay whole', () => {
  assert.match(read('src-tauri/src/lib.rs'), /chrome_clip::webview_set_chrome_clip,/)
  assert.ok(read('src-tauri/permissions/webview-commands.toml').includes('"webview_set_chrome_clip"'))
  const chrome = read('src/platform/tauriChromeWebview.ts')
  const sync = chrome.slice(chrome.indexOf('async function syncChromeBounds'), chrome.indexOf('function unbindResizeListeners'))
  assert.ok(sync.includes('await applyChromeClip()'))
  const apply = chrome.slice(chrome.indexOf('async function applyChromeClip'), chrome.indexOf('export async function setChromeBubbleRects'))
  assert.match(apply, /catch[\s\S]*lastChromeClipKey = ''/)
  // The native side lifts the region when asked for none.
  const native = read('src-tauri/src/chrome_clip.rs')
  assert.ok(native.includes('SetWindowRgn(host, None, true)'))
})

test('the bubble shows in full when something starts being used, shrinks by itself, and opens again on hover or focus', () => {
  const app = read('src/ChromeApp.tsx')
  assert.ok(app.includes('const USAGE_BUBBLE_FULL_MS'))
  assert.match(app, /setUsageExpanded\(true\)\s*\n\s*scheduleUsageCollapse\(USAGE_BUBBLE_FULL_MS\)/)
  for (const handler of ['onPointerEnter={holdUsageExpanded}', 'onFocus={holdUsageExpanded}', 'onPointerLeave=', 'onBlur=']) {
    assert.ok(app.includes(handler), handler)
  }
  // The bubble is reachable and named for assistive technology in its small form.
  assert.ok(app.includes('aria-label={usageBubbleLabel}'))
  const css = read('src/ChromeApp.module.css')
  for (const color of ['privacyIconCamera', 'privacyIconMicrophone']) assert.ok(css.includes(`.${color}`), color)
  assert.match(css, /\.privacyIconCamera \{\s*--privacy-color: #ff6b6b/)
  assert.match(css, /\.privacyIconMicrophone \{\s*--privacy-color: #67e8a5/)
  assert.match(css, /prefers-reduced-motion[\s\S]*\.privacyIcon::after \{\s*animation: none/)
})
