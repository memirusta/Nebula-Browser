import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createBrowserTab, type BrowserTab } from '../src/core/browserTab.ts'
import { browserTabsReducer, initialBrowserTabsState } from '../src/core/browserTabsReducer.ts'
import * as session from '../src/core/browserSessionSnapshot.ts'
import {
  createBrowserWorkspace,
  transferredBrowserTabFromBrowserTab,
  transferWorkspaceTab,
} from '../src/core/browserWorkspace.ts'
import { recordTabNavigation } from '../src/core/tabNavigation.ts'

function makeTab(id: string, isPrivate = false): BrowserTab {
  const tab = createBrowserTab({
    id,
    label: `${id} title`,
    url: `https://${id}.example/start`,
    favicon: `https://${id}.example/icon.png`,
  }, { isPrivate })
  tab.navigation = recordTabNavigation(tab.navigation, `https://${id}.example/secret?token=${id}`, `${id} next`)
  const current = tab.navigation.entries[tab.navigation.index]!
  return { ...tab, url: current.url, title: current.title }
}

class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function loadModule(relativePath: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports: Record<string, unknown> = {}
  vm.runInNewContext(output, {
    exports,
    module: { exports },
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    URL,
    crypto,
    localStorage: new MemoryStorage(),
  })
  return exports
}

test('tab privacy belongs to creation and survives reload and global-setting changes', () => {
  const shortcut = { id: 'private-tab', label: 'Private', url: 'https://private.example/start' }
  let state = browserTabsReducer(initialBrowserTabsState, {
    type: 'open-or-switch', shortcut, reload: false, activate: true, isPrivate: true,
  })
  assert.equal(state.tabs[0]?.isPrivate, true)
  for (const reload of [false, true]) {
    state = browserTabsReducer(state, {
      type: 'open-or-switch', shortcut, reload, activate: true, isPrivate: false,
    })
    assert.equal(state.tabs[0]?.isPrivate, true)
  }

  const normalShortcut = { ...shortcut, id: 'normal-tab' }
  state = browserTabsReducer(state, {
    type: 'open-or-switch', shortcut: normalShortcut, reload: false, activate: true,
  })
  assert.equal(state.tabs[1]?.isPrivate, false)
  state = browserTabsReducer(state, {
    type: 'open-or-switch', shortcut: normalShortcut, reload: true, activate: true, isPrivate: true,
  })
  assert.equal(state.tabs[1]?.isPrivate, false)
})

test('mixed sessions persist normal tabs and never persist private URL, metadata, or navigation', () => {
  const normal = makeTab('normal')
  const privateTab = makeTab('private-marker', true)
  const snapshot = session.createBrowserSessionSnapshot('main', [normal, privateTab], privateTab.shortcutId)
  assert.deepEqual(snapshot.windows[0]?.tabs.map((tab) => tab.tabId), ['normal'])
  assert.equal(snapshot.windows[0]?.activeTabId, normal.id)
  assert.equal(session.persistedBrowserTabFromBrowserTab(privateTab), null)
  const stored = session.serializeBrowserSessionSnapshot(snapshot)
  assert.doesNotMatch(stored, /private-marker/)
  assert.match(stored, /normal\.example/)

  const privateOnly = session.createBrowserSessionSnapshot('private-window', [privateTab], privateTab.shortcutId)
  const storage = new MemoryStorage()
  storage.setItem(session.CURRENT_SESSION_KEY, session.serializeBrowserSessionSnapshot(privateOnly))
  assert.doesNotMatch(storage.getItem(session.CURRENT_SESSION_KEY)!, /private-marker/)
  assert.equal(session.loadBrowserSessionSnapshot(storage), null)
})

test('session parsing and serialization drop tagged private records in v2 and legacy data', () => {
  const normal = session.persistedBrowserTabFromBrowserTab(makeTab('normal'))!
  const privateTab = transferredBrowserTabFromBrowserTab(makeTab('private-marker', true))!
  const snapshot: session.BrowserSessionSnapshot = {
    schemaVersion: 2,
    id: 'synthetic-session',
    savedAt: 1,
    windows: [{ windowId: 'main', activeTabId: privateTab.tabId, tabs: [normal, privateTab] }],
  }
  assert.doesNotMatch(session.serializeBrowserSessionSnapshot(snapshot), /private-marker/)
  const storage = new MemoryStorage()
  storage.setItem(session.CURRENT_SESSION_KEY, JSON.stringify(snapshot))
  const restored = session.loadBrowserSessionSnapshot(storage)
  assert.deepEqual(restored?.windows[0]?.tabs.map((tab) => tab.tabId), ['normal'])
  assert.equal(restored?.windows[0]?.activeTabId, normal.tabId)

  const legacy = new MemoryStorage()
  legacy.setItem(session.LEGACY_CURRENT_SESSION_KEYS[0], JSON.stringify({
    id: 'legacy', savedAt: 1, activeTabId: privateTab.tabId, tabs: [privateTab, normal],
  }))
  const migrated = session.loadBrowserSessionSnapshot(legacy)
  assert.deepEqual(migrated?.windows[0]?.tabs.map((tab) => tab.tabId), ['normal'])
  assert.doesNotMatch(legacy.getItem(session.CURRENT_SESSION_KEY)!, /private-marker/)
})

test('transient workspace transfers preserve private identity and navigation', () => {
  const privateTab = transferredBrowserTabFromBrowserTab(makeTab('private-marker', true))!
  assert.equal(privateTab.isPrivate, true)
  assert.equal(privateTab.navigation.entries.length, 2)
  const workspace = createBrowserWorkspace([
    { windowId: 'main', activeTabId: privateTab.tabId, tabs: [privateTab] },
    { windowId: 'target', activeTabId: null, tabs: [] },
  ])
  const moved = transferWorkspaceTab(workspace, 'main', 'target', privateTab.tabId)
  const movedTab = moved.windows[1]?.tabs[0] as typeof privateTab
  assert.equal(movedTab.isPrivate, true)
  assert.equal(movedTab.url, privateTab.url)
  assert.deepEqual(movedTab.navigation, privateTab.navigation)
  assert.doesNotMatch(session.serializeBrowserSessionSnapshot({
    schemaVersion: 2, id: 'after-transfer', savedAt: 1, windows: moved.windows,
  }), /private-marker/)
})

test('private visits never replace normal history, closed-tab, or last-page records', () => {
  const storageSync = { persistLocalStorage() {} }
  const history = loadModule('../src/core/browsingHistory.ts', {
    './storageSync': storageSync,
    './browserSessionSnapshot': session,
  }) as typeof import('../src/core/browsingHistory.ts')
  const browse = loadModule('../src/core/browseSession.ts', {
    './storageSync': storageSync,
    './locale': {},
  }) as typeof import('../src/core/browseSession.ts')
  const normal = makeTab('normal')
  const privateTab = makeTab('private-marker', true)
  const visits = history.addHistoryEntry([], normal.url, normal.title)
  assert.equal(history.addHistoryEntry(visits, privateTab.url, privateTab.title, true), visits)
  assert.ok(history.closedTabFromBrowserTab(normal))
  assert.equal(history.closedTabFromBrowserTab(privateTab), null)
  const lastPages = browse.upsertBrowseSession({}, normal.url, normal.title)
  assert.equal(browse.upsertBrowseSession(lastPages, privateTab.url, privateTab.title, true), lastPages)
  // A private visit to the same host must not overwrite its prior normal path.
  assert.equal(browse.upsertBrowseSession(lastPages, 'https://normal.example/private', 'Private', true), lastPages)
})
