import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { chromeOverlayMinimumHeight } from '../src/core/chromeOverlayLayout.ts'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

const browsing = { siteInfoOpen: false, privateInfoOpen: false, tabSearchOpen: false, isBrowsing: true, hasZoom: false, hasSensitiveUsage: false }

test('only a tab a page opened is announced: the shell passes that on', () => {
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  assert.ok(shell.includes('spawnedByPage = false'), 'the user\'s own actions do not announce')
  assert.ok(shell.includes('if (spawnedByPage && isTauri) void emitTabSpawned(id)'))
  // A site's new target and a protocol handler it triggered are the page's doing.
  assert.match(shell, /openUrlInNewTab\(\s*payload\.uri,\s*payload\.privateMode,\s*true,\s*\)/)
  assert.match(shell, /openUrlInNewTab\(\s*handlerUrl,\s*sourceIsPrivate,\s*true,\s*\)/)
  // An address another app handed over, or a pinned shortcut, is not.
  assert.doesNotMatch(shell, /openUrlInNewTab\(\s*url,\s*(?:undefined,\s*)?true\s*\)/)

  const bridge = read('src/core/nebulaBridge.ts')
  assert.ok(bridge.includes("const TAB_SPAWNED_EVENT = 'nebula-tab-spawned'"))
  assert.ok(bridge.includes('export async function emitTabSpawned'))
  assert.ok(bridge.includes('export function listenTabSpawned'))
})

test('the menu opens by itself for a moment and highlights the new tab\'s icon, and the lost-hover checks do not close it', () => {
  const chrome = read('src/ChromeApp.tsx')
  assert.ok(chrome.includes('listenTabSpawned((shortcutId)'))
  assert.ok(chrome.includes('spawnedTabId={spawnedTab?.shortcutId ?? null}'))
  assert.ok(chrome.includes('spawnedTabKey={spawnedTab?.key ?? 0}'))
  // No floating chip any more.
  assert.doesNotMatch(chrome, /spawnedTabChip|hasSpawnedTabChip/)

  const menu = read('src/components/SemiLunarMenu/SemiLunarMenu.tsx')
  assert.ok(menu.includes('const SPAWN_PEEK_MS = 2_400'))
  const peek = menu.slice(menu.indexOf('if (spawnedTabKey === 0 || !spawnedTabId) return'), menu.indexOf('const spawnHighlightDockId = useMemo'))
  assert.ok(peek.includes('setStage(\'expanded\')'), 'it opens')
  assert.ok(peek.includes('setSpawnHighlightTabId(spawnedTabId)'))
  assert.ok(peek.includes('SPAWN_PEEK_MS'), 'for a short time')
  // It does not open over the overlay menu or in fullscreen, and it closes unless the pointer is in it.
  assert.ok(peek.includes("shellViewMode === 'overlay'"))
  assert.ok(peek.includes('browserFullscreenActive'))
  assert.ok(peek.includes('!menuHoverRef.current && !shouldDeferClose()'))
  // While it is open for the peek, the checks that close a menu the pointer left are held off.
  const defer = menu.slice(menu.indexOf('const shouldDeferClose = useCallback'), menu.indexOf('const rejectStaleBrowsingHover'))
  assert.ok(defer.includes('if (peekActiveRef.current) return true'))
  // The new tab becoming the active one does not close the menu that is showing it.
  const switched = menu.slice(menu.indexOf('const prevActiveTabIdRef'), menu.indexOf('shellBoundedLayoutResyncRef.current ='))
  assert.ok(switched.indexOf('if (peekActiveRef.current) return') < switched.indexOf('closeMenuImmediately()'))
  // The icon of that tab is the one drawn highlighted.
  assert.ok(menu.includes('isSpawned={spawnHighlightDockId === dockId}'))
  assert.ok(menu.includes('isSpawned ? styles.shortcutSpawned'))
})

test('the highlight pops the icon in and glows, and respects reduced motion', () => {
  const css = read('src/components/SemiLunarMenu/SemiLunarMenu.module.css')
  for (const name of ['shortcutSpawnedPop', 'shortcutSpawnedGlow']) assert.ok(css.includes(`@keyframes ${name}`), name)
  assert.match(css, /\.shortcutSpawned \{[\s\S]*?animation:/)
  assert.match(css, /prefers-reduced-motion[\s\S]*?\.shortcutSpawned \{\s*animation: none/)
})

test('the overlay keeps the room of the full bubble even when the bubble is small, so shrinking never cuts it off', () => {
  assert.equal(chromeOverlayMinimumHeight(browsing), 0)
  assert.equal(chromeOverlayMinimumHeight({ ...browsing, hasSensitiveUsage: true }), 78)
  assert.equal(chromeOverlayMinimumHeight({ ...browsing, hasZoom: true, hasSensitiveUsage: true }), 138)
  assert.equal(chromeOverlayMinimumHeight({ ...browsing, siteInfoOpen: true, hasSensitiveUsage: true }), 650)
})
