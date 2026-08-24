import assert from 'node:assert/strict'
import test from 'node:test'

import type { BrowserTab } from '../src/core/browserTab.ts'
import {
  createBrowserSessionSnapshot,
  CURRENT_SESSION_KEY,
  loadBrowserSessionSnapshot,
  serializeBrowserSessionSnapshot,
} from '../src/core/browserSessionSnapshot.ts'
import {
  applyTabHistoryTarget,
  createTabNavigationState,
  recordTabNavigation,
  tabHistoryTarget,
} from '../src/core/tabNavigation.ts'

class MemoryStorage {
  readonly values: Map<string, string>

  constructor(entries: Iterable<readonly [string, string]> = []) {
    this.values = new Map(entries)
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

function tabWithHistory(
  id: string,
  urls: string[],
  index = urls.length - 1,
): BrowserTab {
  let navigation = createTabNavigationState(urls[0]!, `Title 0`)
  for (const [entryIndex, url] of urls.slice(1).entries()) {
    navigation = recordTabNavigation(navigation, url, `Title ${entryIndex + 1}`)
  }
  navigation = applyTabHistoryTarget(navigation, index)
  const current = navigation.entries[navigation.index]!
  return {
    id,
    shortcutId: id,
    initialUrl: urls[0]!,
    url: current.url,
    title: current.title,
    favicon: `https://icons.example/${id}.png`,
    navigation,
  }
}

test('A -> B -> C survives restart and falls back Back to B then A', () => {
  const tab = tabWithHistory('tab-main', [
    'https://example.com/a',
    'https://example.com/b',
    'https://example.com/c',
  ])
  const snapshot = createBrowserSessionSnapshot('window-stable', [tab], tab.shortcutId)
  const storage = new MemoryStorage([
    [CURRENT_SESSION_KEY, serializeBrowserSessionSnapshot(snapshot)],
  ])

  const restored = loadBrowserSessionSnapshot(storage)
  const restoredTab = restored?.windows[0]?.tabs[0]
  assert.ok(restoredTab)
  assert.equal(restored?.windows[0]?.windowId, 'window-stable')
  assert.equal(restoredTab.tabId, 'tab-main')

  const backToB = tabHistoryTarget(restoredTab.navigation, -1)
  assert.equal(backToB?.entry.url, 'https://example.com/b')
  const atB = applyTabHistoryTarget(restoredTab.navigation, backToB!.index)
  const backToA = tabHistoryTarget(atB, -1)
  assert.equal(backToA?.entry.url, 'https://example.com/a')
})

test('Forward mirrors Back after restore', () => {
  const tab = tabWithHistory('tab-forward', [
    'https://example.com/a',
    'https://example.com/b',
    'https://example.com/c',
  ])
  const backTarget = tabHistoryTarget(tab.navigation, -1)!
  const atB = applyTabHistoryTarget(tab.navigation, backTarget.index)
  const forwardTarget = tabHistoryTarget(atB, 1)

  assert.equal(forwardTarget?.entry.url, 'https://example.com/c')
  const atC = applyTabHistoryTarget(atB, forwardTarget!.index)
  assert.equal(atC.index, 2)
})

test('new navigation after Back truncates the Forward branch', () => {
  const tab = tabWithHistory('tab-branch', [
    'https://example.com/a',
    'https://example.com/b',
    'https://example.com/c',
  ])
  const atB = applyTabHistoryTarget(tab.navigation, 1)
  const branched = recordTabNavigation(atB, 'https://example.com/d', 'Page D')

  assert.deepEqual(
    branched.entries.map((entry) => entry.url),
    [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/d',
    ],
  )
  assert.equal(tabHistoryTarget(branched, 1), null)
})

test('multiple tabs restore independent navigation stacks and active tab identity', () => {
  const first = tabWithHistory('tab-first', [
    'https://first.example/a',
    'https://first.example/b',
  ])
  const second = tabWithHistory('tab-second', [
    'https://second.example/1',
    'https://second.example/2',
    'https://second.example/3',
  ], 1)
  const snapshot = createBrowserSessionSnapshot(
    'window-independent',
    [first, second],
    second.shortcutId,
  )
  const restored = loadBrowserSessionSnapshot(new MemoryStorage([
    [CURRENT_SESSION_KEY, serializeBrowserSessionSnapshot(snapshot)],
  ]))
  const restoredWindow = restored?.windows[0]

  assert.equal(restoredWindow?.activeTabId, second.id)
  assert.deepEqual(
    restoredWindow?.tabs.map((tab) => [tab.tabId, tab.navigation.entries.length, tab.navigation.index]),
    [
      ['tab-first', 2, 1],
      ['tab-second', 3, 1],
    ],
  )
})

test('repeated title snapshots update metadata without duplicating history entries', () => {
  const initial = createTabNavigationState('https://title.example/page', 'Loading')
  const updated = recordTabNavigation(
    initial,
    'https://title.example/page',
    'Final title',
  )

  assert.equal(updated.entries.length, 1)
  assert.equal(updated.entries[0]?.title, 'Final title')
})

test('malformed data is ignored and legacy v1 session migrates safely', () => {
  const corrupt = new MemoryStorage([
    [CURRENT_SESSION_KEY, '{not-json'],
    ['nebula-current-browser-session-v1', '{also-broken'],
  ])
  assert.doesNotThrow(() => loadBrowserSessionSnapshot(corrupt))
  assert.equal(loadBrowserSessionSnapshot(corrupt), null)

  const legacy = new MemoryStorage([
    ['nebula-current-browser-session-v1', JSON.stringify({
      id: 'legacy-session',
      savedAt: 123,
      activeTabId: 'legacy-tab',
      tabs: [{
        id: 'legacy-tab',
        url: 'https://legacy.example/current',
        title: 'Legacy',
        favicon: '',
      }, { id: 'broken-tab', url: 'javascript:alert(1)' }],
    })],
  ])
  const migrated = loadBrowserSessionSnapshot(legacy)

  assert.equal(migrated?.schemaVersion, 2)
  assert.equal(migrated?.windows[0]?.windowId, 'legacy-window-legacy-session')
  assert.equal(migrated?.windows[0]?.tabs.length, 1)
  assert.deepEqual(
    migrated?.windows[0]?.tabs[0]?.navigation.entries.map((entry) => entry.url),
    ['https://legacy.example/current'],
  )
  assert.equal(
    legacy.getItem(CURRENT_SESSION_KEY),
    migrated ? serializeBrowserSessionSnapshot(migrated) : null,
  )
})
