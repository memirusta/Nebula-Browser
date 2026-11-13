import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { toRedirectResources, toResources } from '../scripts/build-shield-resources.mjs'

function pruneScriptlet() {
  return function jsonPrune() {
    return 1
  }
}

test('a scriptlet becomes a resource with its source, its aliases, its helpers as dependencies and its trust', () => {
  const fn = pruneScriptlet()
  const { resources, missing } = toResources([
    { name: 'safe-self.fn', fn: function safeSelf() { return 2 } },
    { name: 'json-prune.js', aliases: ['jp.js'], fn, dependencies: ['safe-self.fn'], requiresTrust: true },
  ])
  assert.deepEqual(missing, [])
  const [helper, scriptlet] = resources
  assert.deepEqual(helper.kind, { mime: 'fn/javascript' }, 'a helper is not itself injected')
  assert.deepEqual(scriptlet.kind, { mime: 'application/javascript' })
  assert.deepEqual(scriptlet.aliases, ['jp.js'])
  assert.deepEqual(scriptlet.dependencies, ['safe-self.fn'])
  assert.equal(scriptlet.permission, 1, 'only a trusted list may ask for it')
  assert.equal(Buffer.from(scriptlet.content, 'base64').toString('utf8'), fn.toString())
  assert.equal(helper.permission, undefined)
})

test('a scriptlet that uBlock Origin runs in its isolated world is kept: here every scriptlet runs in the page itself; a missing helper is reported', () => {
  const { resources, missing } = toResources([
    { name: 'set-cookie.js', fn: function setCookie() {}, world: 'ISOLATED' },
    { name: 'set-constant.js', fn: function setConstant() {}, dependencies: ['no-such-helper.fn'] },
  ])
  assert.deepEqual(resources.map((resource) => resource.name), ['set-cookie.js', 'set-constant.js'])
  assert.deepEqual(missing, ['set-constant.js -> no-such-helper.fn'])
})

test('a stand-in becomes a resource with the type of its file and all its names; a page with parameters is left out', () => {
  const files: Record<string, string> = { 'noop.js': '// nothing', '1x1.gif': 'GIF', empty: '', 'click2load.html': '<p>' }
  const resources = toRedirectResources(
    new Map<string, { alias?: string | string[]; params?: string[] }>([
      ['noop.js', {}],
      ['1x1.gif', { alias: '1x1-transparent.gif' }],
      ['empty', {}],
      ['click2load.html', { params: ['url'] }],
    ]),
    (name: string) => Buffer.from(files[name]),
  )
  assert.deepEqual(resources.map((resource: { name: string }) => resource.name), ['noop.js', '1x1.gif', 'empty'])
  assert.deepEqual(resources[0].kind, { mime: 'application/javascript' })
  assert.deepEqual(resources[1].aliases, ['1x1-transparent.gif'])
  assert.deepEqual(resources[2].kind, { mime: 'text/plain' }, 'a file without an extension is text')
  assert.equal(Buffer.from(resources[1].content, 'base64').toString(), 'GIF')
})

test('the scriptlets that ship with the app are all there: the ones YouTube\'s rules ask for, with the helpers they need', () => {
  const resources = JSON.parse(readFileSync(new URL('../src-tauri/resources/shield/ubo-scriptlets.json', import.meta.url), 'utf8')) as Array<{
    name: string
    aliases?: string[]
    dependencies?: string[]
  }>
  const names = new Set(resources.map((resource) => resource.name))
  for (const asked of ['trusted-replace-xhr-response.js', 'trusted-replace-fetch-response.js', 'json-prune.js', 'set-constant.js', 'json-edit-fetch-response.js']) {
    assert.ok(names.has(asked), asked)
  }
  for (const resource of resources) for (const dependency of resource.dependencies ?? []) assert.ok(names.has(dependency), `${resource.name} -> ${dependency}`)
  // Every list that ships with the app asks only for scriptlets that exist (by name or by alias).
  const known = new Set(resources.flatMap((resource) => [resource.name, ...(resource.aliases ?? [])]))
  const lists = ['ubo-filters', 'ubo-privacy', 'ubo-unbreak', 'ubo-badware']
  const unknown = new Map<string, number>()
  for (const list of lists) {
    const text = readFileSync(new URL(`../src-tauri/resources/shield/lists/${list}.txt`, import.meta.url), 'utf8')
    for (const match of text.matchAll(/##\+js\(([^,)\s]+)/g)) {
      const name = match[1].endsWith('.js') ? match[1] : `${match[1]}.js`
      if (!known.has(name)) unknown.set(name, (unknown.get(name) ?? 0) + 1)
    }
  }
  assert.deepEqual([...unknown.keys()], [], 'scriptlets the lists ask for that are not shipped')
})
