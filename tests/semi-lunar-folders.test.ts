import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSemiLunarShortcutCatalog,
  canCreateShortcutFolder,
} from '../src/core/semiLunarCatalog.ts'

test('two runtime tabs on the same domain remain independently folderable', () => {
  const first = {
    shortcutId: 'youtube',
    title: 'YouTube Home',
    url: 'https://www.youtube.com/',
    favicon: 'youtube-home.png',
  }
  const second = {
    shortcutId: 'tab-watch',
    title: 'YouTube Video',
    url: 'https://www.youtube.com/watch?v=nebula',
    favicon: 'youtube-video.png',
  }
  const catalog = buildSemiLunarShortcutCatalog(
    [{ id: 'youtube', label: 'YouTube', url: 'https://www.youtube.com/' }],
    [first, second],
  )

  assert.deepEqual(catalog.map((shortcut) => shortcut.id), [
    'youtube',
    'tab-watch',
  ])

  const folderableIds = new Set(catalog.map((shortcut) => shortcut.id))
  assert.equal(
    canCreateShortcutFolder('tab-watch', 'youtube', folderableIds, new Set()),
    true,
  )

  assert.equal(catalog[0]?.url, 'https://www.youtube.com/')
  assert.equal(catalog[1]?.url, 'https://www.youtube.com/watch?v=nebula')
})

test('folder creation still rejects missing or already grouped runtime ids', () => {
  const folderableIds = new Set(['tab-a', 'tab-b'])

  assert.equal(
    canCreateShortcutFolder('tab-a', 'tab-missing', folderableIds, new Set()),
    false,
  )
  assert.equal(
    canCreateShortcutFolder('tab-a', 'tab-b', folderableIds, new Set(['tab-b'])),
    false,
  )
})
