import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  addPinnedShortcut,
  loadPinnedShortcuts,
  PINNED_SHORTCUTS_KEY,
  PINNED_SHORTCUTS_SCHEMA_VERSION,
  removePinnedShortcut,
  serializePinnedShortcuts,
  type PinnedShortcutsSnapshot,
} from '../src/core/pinnedShortcuts.ts'
import {
  MAX_CUSTOM_SHORTCUTS,
  trimCustomShortcuts,
} from '../src/core/shortcutFromUrl.ts'
import type { Shortcut } from '../src/core/types.ts'

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

function shortcut(id: string, url: string, label = id): Shortcut {
  return {
    id,
    url,
    label,
    favicon: `https://icons.example/${id}.png`,
  }
}

function snapshotWith(...shortcuts: Shortcut[]): PinnedShortcutsSnapshot {
  let pins: PinnedShortcutsSnapshot['pins'] = []
  for (const candidate of shortcuts) {
    pins = addPinnedShortcut(pins, candidate).pins
  }
  return {
    schemaVersion: PINNED_SHORTCUTS_SCHEMA_VERSION,
    pins,
    unresolvedLegacyIds: [],
  }
}

test('pinning after A -> B captures B including path, query, and redirect result', () => {
  const tabId = 'visit-example-com'
  const pageA = shortcut(tabId, 'https://example.com/a', 'Page A')
  const pageB = shortcut(tabId, 'https://example.com/final/path?from=redirect#section', 'Page B')

  const result = addPinnedShortcut([], pageB)

  assert.equal(result.accepted, true)
  assert.equal(result.pins.length, 1)
  assert.equal(result.pins[0]?.id, pageA.id)
  assert.equal(
    result.pins[0]?.url,
    'https://example.com/final/path?from=redirect#section',
  )
  assert.notEqual(result.pins[0]?.url, pageA.url)

  const shell = readFileSync(
    new URL('../src/components/BrowserShell/BrowserShell.tsx', import.meta.url),
    'utf8',
  )
  assert.match(shell, /await readBrowseTabCurrentUrl\(/)
  assert.match(shell, /togglePin\(\{[\s\S]*?url:\s*currentUrl/)
})

test('pin owns its data and survives transient cache pruning and unrelated browsing', () => {
  const pinned = shortcut('visit-pinned-example', 'https://pinned.example/deep/path?q=1')
  const transient = Array.from(
    { length: MAX_CUSTOM_SHORTCUTS + 10 },
    (_, index) => shortcut(`visit-${index}`, `https://site-${index}.example/page`),
  )
  const catalog = [pinned, ...transient]
  const pruned = trimCustomShortcuts(catalog, new Set([pinned.id]))

  assert.equal(pruned.some((entry) => entry.id === pinned.id), true)
  assert.equal(
    pruned.filter((entry) => entry.id !== pinned.id).length,
    MAX_CUSTOM_SHORTCUTS,
  )

  const storage = new MemoryStorage()
  storage.setItem(PINNED_SHORTCUTS_KEY, serializePinnedShortcuts(snapshotWith(pinned)))
  const afterBrowsing = loadPinnedShortcuts(pruned.slice(-4), storage)
  assert.deepEqual(afterBrowsing.pins, snapshotWith(pinned).pins)
})

test('persisted pins survive a new application storage reader', () => {
  const pinned = shortcut('visit-restart', 'https://restart.example/account?tab=security')
  const firstProcess = new MemoryStorage()
  firstProcess.setItem(PINNED_SHORTCUTS_KEY, serializePinnedShortcuts(snapshotWith(pinned)))

  const restartedProcess = new MemoryStorage(firstProcess.values.entries())
  const restored = loadPinnedShortcuts([], restartedProcess)

  assert.equal(restored.pins.length, 1)
  assert.equal(restored.pins[0]?.url, pinned.url)
  assert.equal(restored.pins[0]?.title, pinned.label)
  assert.equal(restored.pins[0]?.favicon, pinned.favicon)
})

test('duplicate pins deterministically refresh one record instead of multiplying', () => {
  const original = shortcut('visit-duplicate', 'https://duplicate.example/path', 'Old title')
  const refreshed = shortcut('visit-duplicate', 'https://duplicate.example/path', 'New title')
  const alias = shortcut('different-id', 'https://duplicate.example/path', 'Alias title')

  const once = addPinnedShortcut([], original).pins
  const twice = addPinnedShortcut(once, refreshed).pins
  const aliased = addPinnedShortcut(twice, alias).pins

  assert.equal(twice.length, 1)
  assert.equal(twice[0]?.title, 'New title')
  assert.deepEqual(aliased, [
    {
      id: alias.id,
      url: alias.url,
      title: alias.label,
      favicon: alias.favicon,
    },
  ])
})

test('explicit unpin removes the owned pin record', () => {
  const first = shortcut('first', 'https://first.example/')
  const second = shortcut('second', 'https://second.example/')
  const pins = snapshotWith(first, second).pins

  assert.deepEqual(removePinnedShortcut(pins, first.id).map((pin) => pin.id), [second.id])
  assert.equal(removePinnedShortcut(pins, 'unrelated'), pins)
})

test('legacy id pins migrate when metadata exists and remain pending otherwise', () => {
  const storage = new MemoryStorage([
    ['nebula-pinned-shortcuts-v4', JSON.stringify(['known', 'not-in-catalog'])],
  ])
  const known = shortcut('known', 'https://known.example/path')

  const migrated = loadPinnedShortcuts([known], storage)

  assert.equal(migrated.pins[0]?.url, known.url)
  assert.deepEqual(migrated.unresolvedLegacyIds, ['not-in-catalog'])
  assert.equal(storage.getItem(PINNED_SHORTCUTS_KEY), serializePinnedShortcuts(migrated))
})
