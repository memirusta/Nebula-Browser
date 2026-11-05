import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { windowHandlesNewWindowRequest } from '../src/core/siteNewWindowOwnership.ts'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const tab = { isTabLabel: true, isPopupLabel: false, ownsPopup: false }

test('a link clicked in one window opens its tab in that window only', () => {
  // The same announcement reaches both windows; each asks "is the page that asked one of mine?".
  const announcedFromWindowA = { ...tab }
  assert.equal(windowHandlesNewWindowRequest({ ...announcedFromWindowA, ownsTab: true }), true, 'window A owns the page')
  assert.equal(windowHandlesNewWindowRequest({ ...announcedFromWindowA, ownsTab: false }), false, 'window B does not')
})

test('a tab moved to another window is answered by its new window, not the one it came from', () => {
  // Its webview label still carries the old window id, so the owner is whoever has the tab now.
  assert.equal(windowHandlesNewWindowRequest({ ...tab, ownsTab: false }), false, 'the window it left')
  assert.equal(windowHandlesNewWindowRequest({ ...tab, ownsTab: true }), true, 'the window it joined')
})

test('a page inside a site popup is answered by the window that created that popup', () => {
  const popup = { isTabLabel: false, isPopupLabel: true, ownsTab: false }
  assert.equal(windowHandlesNewWindowRequest({ ...popup, ownsPopup: true }), true)
  assert.equal(windowHandlesNewWindowRequest({ ...popup, ownsPopup: false }), false)
})

test('an opener that is neither a tab nor a popup is handled as before', () => {
  assert.equal(
    windowHandlesNewWindowRequest({ isTabLabel: false, isPopupLabel: false, ownsTab: false, ownsPopup: false }),
    true,
  )
})

test('the shell checks who owns the page before it opens a tab or a popup', () => {
  const shell = read('../src/components/BrowserShell/BrowserShell.tsx')
  const popup = read('../src/platform/tauriPopup.ts')
  const listener = shell.slice(shell.indexOf('() => listenSiteNewWindows('), shell.indexOf('() => listenSiteCloseWindows('))

  assert.ok(listener.includes('windowHandlesNewWindowRequest('), 'the listener asks the ownership question')
  assert.ok(
    listener.indexOf('windowHandlesNewWindowRequest(') < listener.indexOf('openUrlInNewTab('),
    'and asks it before it opens a tab',
  )
  assert.ok(
    listener.indexOf('windowHandlesNewWindowRequest(') < listener.indexOf('openSitePopup('),
    'and before it opens a popup',
  )
  // The page must be one of this window's own tabs, not merely a label that looks like one.
  assert.ok(listener.includes('tabsRef.current.some('))
  assert.ok(popup.includes('export function ownsSitePopupContent('))
})
