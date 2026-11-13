import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { shareUnchanged } from '../src/core/shareUnchanged.ts'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

test('what did not change keeps its identity; only the path to what changed is new', () => {
  const before = { appearance: { accent: '#111111', overrides: { 'a.com': 'on' } }, privacy: { sites: ['x', 'y'], mode: 'ask' }, n: 1 }
  const after = { appearance: { accent: '#222222', overrides: { 'a.com': 'on' } }, privacy: { sites: ['x', 'y'], mode: 'ask' }, n: 1 }
  const merged = shareUnchanged(before, after)
  assert.notEqual(merged, before)
  assert.notEqual(merged.appearance, before.appearance)
  assert.equal(merged.appearance.accent, '#222222')
  assert.equal(merged.appearance.overrides, before.appearance.overrides)
  assert.equal(merged.privacy, before.privacy)
  assert.equal(merged.privacy.sites, before.privacy.sites)
})

test('equal settings give back the very same object, so nothing is rendered or saved again', () => {
  const before = { a: { b: [1, 2, { c: 3 }] }, d: 'x' }
  assert.equal(shareUnchanged(before, JSON.parse(JSON.stringify(before))), before)
})

test('added, removed and reordered values count as changes', () => {
  const before = { list: ['a', 'b'], map: { one: 1 } }
  assert.deepEqual(shareUnchanged(before, { list: ['b', 'a'], map: { one: 1 } }).list, ['b', 'a'])
  assert.deepEqual(shareUnchanged(before, { list: ['a'], map: { one: 1 } }).list, ['a'])
  assert.equal(shareUnchanged(before, { list: ['a', 'b'], map: { one: 1 } }), before)
  const grown = shareUnchanged(before, { list: ['a', 'b'], map: { one: 1, two: 2 } })
  assert.deepEqual(grown.map, { one: 1, two: 2 })
  assert.equal(grown.list, before.list)
  const shrunk = shareUnchanged({ a: 1, b: 2 }, { a: 1 } as { a: number; b?: number })
  assert.deepEqual(shrunk, { a: 1 })
  // An array is never mistaken for an object, nor null for one.
  assert.deepEqual(shareUnchanged({ x: [1] } as { x: unknown }, { x: { 0: 1 } }).x, { 0: 1 })
  assert.equal(shareUnchanged({ x: null } as { x: unknown }, { x: { a: 1 } }).x !== null, true)
})

test('the settings hook shares what did not change, and darkening is not sent to every tab again for a colour', () => {
  const hook = read('src/hooks/useNebulaSettings.ts')
  assert.equal(hook.split('shareUnchanged(').length - 1, 6)
  assert.doesNotMatch(hook, /JSON\.stringify\(prev\) === JSON\.stringify\(next\)/)

  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  assert.match(shell, /appearance\.darkenWebpages,\s+appearance\.theme,\s+appearance\.darkenWebpagesSiteOverrides,\s+openTabIds,\s+systemPrefersDark,/)
  assert.doesNotMatch(shell, /\}, \[appearance, openTabIds, systemPrefersDark\]\)/)
})
