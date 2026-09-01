import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildBrowsingVisibleDockItemIds,
  buildOpenTabIdByDockId,
  openTabIdForDockId,
} from '../src/core/browsingDock.ts'
import { folderDockId, type Shortcut, type ShortcutFolder } from '../src/core/types.ts'

function shortcut(id: string, url: string): Shortcut {
  return { id, label: id, url, favicon: '' }
}

test('precomputed dock tab lookup preserves exact ids and host aliases', () => {
  const shortcuts = [
    shortcut('pinned-nebula', 'https://nebula.example/home'),
    shortcut('visit-nebula-1', 'https://nebula.example/one'),
    shortcut('visit-nebula-2', 'https://nebula.example/two'),
    shortcut('pinned-other', 'https://other.example/'),
  ]
  const shortcutMap = new Map(shortcuts.map((item) => [item.id, item]))
  const openTabIds = ['visit-nebula-1', 'visit-nebula-2']
  const lookup = buildOpenTabIdByDockId(openTabIds, shortcutMap)

  for (const dockId of shortcutMap.keys()) {
    assert.equal(
      lookup.get(dockId) ?? null,
      openTabIdForDockId(dockId, openTabIds, shortcutMap),
    )
  }

  assert.equal(lookup.get('visit-nebula-2'), 'visit-nebula-2')
  assert.equal(lookup.get('pinned-nebula'), 'visit-nebula-1')
  assert.equal(lookup.has('pinned-other'), false)
})

test('visible dock keeps same-host runtime tabs separate and aliases only unambiguous folders', () => {
  const shortcuts = [
    shortcut('pinned-nebula', 'https://nebula.example/home'),
    shortcut('visit-nebula-1', 'https://nebula.example/one'),
    shortcut('visit-nebula-2', 'https://nebula.example/two'),
  ]
  const shortcutMap = new Map(shortcuts.map((item) => [item.id, item]))
  const folder: ShortcutFolder = {
    id: 'nebula-folder',
    name: 'Nebula',
    members: ['pinned-nebula'],
  }
  const dockIds = [folderDockId(folder.id), 'pinned-nebula']

  assert.deepEqual(
    buildBrowsingVisibleDockItemIds(
      dockIds,
      ['visit-nebula-1', 'visit-nebula-2'],
      [folder],
      shortcutMap,
    ),
    ['visit-nebula-1', 'visit-nebula-2'],
  )

  assert.deepEqual(
    buildBrowsingVisibleDockItemIds(
      dockIds,
      ['visit-nebula-1'],
      [folder],
      shortcutMap,
    ),
    [folderDockId(folder.id)],
  )
})
