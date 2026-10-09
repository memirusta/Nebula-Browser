import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { applyTabHistoryTarget, tabCanGoForward, tabHistoryTarget, type TabNavigationState } from '../src/core/tabNavigation.ts'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

const entry = (url: string) => ({ url, title: url, favicon: null, visitedAt: 0 })
const stack = (urls: string[], index: number): TabNavigationState =>
  ({ entries: urls.map(entry), index }) as unknown as TabNavigationState

test('there is a page to go forward to only after going back', () => {
  const fresh = stack(['https://a.example/', 'https://b.example/'], 1)
  assert.equal(tabHistoryTarget(fresh, 1), null, 'at the newest page there is nothing ahead')
  const back = applyTabHistoryTarget(fresh, 0)
  assert.equal(tabHistoryTarget(back, 1)?.entry.url, 'https://b.example/')
  assert.equal(tabHistoryTarget(back, -1), null, 'at the oldest page there is nothing behind')
})

test('the forward button is offered by the chrome only when the active tab has a page ahead, and it asks the shell to go forward', () => {
  const chrome = read('src/ChromeApp.tsx')
  assert.ok(chrome.includes('tabCanGoForward(active)'))
  assert.ok(chrome.includes("emitChromeAction({ type: 'go-forward' })"))
  assert.ok(chrome.includes('viewMode !== \'home\' && canGoForward'))
  assert.ok(read('src/core/nebulaBridge.ts').includes("{ type: 'go-forward' }"))
  // The shell answers the chrome's request with the same function the keyboard shortcut uses.
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  const caseAt = shell.indexOf("case 'go-forward':\n            goForwardInPage()", shell.indexOf("case 'toggle-history-panel':"))
  assert.ok(caseAt > 0, 'the chrome action is handled')
})

test('the button sits after Back, counts as a control for the shortcut layout, and has a label in every language', () => {
  const menu = read('src/components/SemiLunarMenu/SemiLunarMenu.tsx')
  assert.ok(menu.indexOf("t('goForward')") > menu.indexOf("t('goBack')"))
  assert.ok(menu.includes('Number(isBrowsing && Boolean(onForwardClick))'))
  for (const file of ['ts', 'de.ts', 'es.ts', 'it-ja.ts', 'additional.ts']) {
    const source = read(`src/core/localeMessages${file === 'ts' ? '' : '.' + file.replace('.ts', '')}.ts`)
    assert.match(source, /goForward\b/, file)
    assert.match(source, /goForwardAria/, file)
  }
})

test('Forward is offered when WebView2 has a page ahead (Back made by the page or the mouse) or the tab list has one', () => {
  const atNewest = stack(['https://a.example/', 'https://b.example/'], 1)
  assert.equal(tabCanGoForward({ navigation: atNewest }), false)
  assert.equal(tabCanGoForward({ navigation: atNewest, canGoForward: false }), false)
  // The page went back by itself: the list does not know, WebView2 does.
  assert.equal(tabCanGoForward({ navigation: atNewest, canGoForward: true }), true)
  // After a restart WebView2 has no history, the list does (Forward opens that address).
  assert.equal(tabCanGoForward({ navigation: stack(['https://a.example/', 'https://b.example/'], 0), canGoForward: false }), true)
})

test('the native snapshot says whether the page can go forward once the navigation has settled, and the shell keeps it on the tab', () => {
  const native = read('src-tauri/src/tab_metadata.rs')
  assert.ok(native.includes('can_go_forward: bool'))
  assert.ok(native.includes('webview.CanGoForward(&mut forward)'))
  // At navigation completion the session history is settled; a snapshot is sent then too.
  const completed = native.slice(native.indexOf('NavigationCompletedEventHandler::create'), native.indexOf('FaviconChangedEventHandler::create'))
  assert.ok(completed.includes('emit_snapshot('))
  assert.ok(read('src/platform/tauriBrowser.ts').includes('canGoForward: payload.canGoForward'))
  assert.ok(read('src/components/BrowserShell/BrowserShell.tsx').includes('{ canGoForward: snapshot.canGoForward }'))
})
