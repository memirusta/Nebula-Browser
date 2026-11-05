import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DEV_CONFIG, withDevIdentity } from '../scripts/tauri-cli.mjs'

const json = (path: string) =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')) as Record<string, unknown>

test('the dev build has its own app identity, so resetting it cannot reach the installed browser', () => {
  const main = json('src-tauri/tauri.conf.json')
  const dev = json(DEV_CONFIG)

  assert.equal(main.identifier, 'com.nebula.browser')
  assert.equal(dev.identifier, 'com.nebula.browser.dev')
  assert.notEqual(dev.identifier, main.identifier)

  // Not the identity of the other test builds either: each one resets its own folders.
  for (const other of ['tauri.perf.conf.json', 'tauri.extensionlab.conf.json']) {
    assert.notEqual(dev.identifier, json(`src-tauri/${other}`).identifier)
  }

  // The window and taskbar say which one it is.
  assert.equal(dev.productName, 'Nebula Dev')
})

test('npm run tauri dev uses the dev identity unless a config is given', () => {
  const pkg = json('package.json') as { scripts: Record<string, string> }
  assert.equal(pkg.scripts.tauri, 'node scripts/tauri-cli.mjs')

  assert.deepEqual(withDevIdentity(['dev']), ['dev', '--config', DEV_CONFIG])

  // Arguments for cargo or the app stay where they were.
  assert.deepEqual(withDevIdentity(['dev', '--', '--features', 'x']), ['dev', '--config', DEV_CONFIG, '--', '--features', 'x'])

  // An explicit config wins, in every spelling; so do builds and other commands, which are not touched.
  assert.deepEqual(withDevIdentity(['dev', '--config', 'a.json']), ['dev', '--config', 'a.json'])
  assert.deepEqual(withDevIdentity(['dev', '-c', 'a.json']), ['dev', '-c', 'a.json'])
  assert.deepEqual(withDevIdentity(['dev', '--config=a.json']), ['dev', '--config=a.json'])
  assert.deepEqual(withDevIdentity(['build']), ['build'])
  assert.deepEqual(withDevIdentity(['info']), ['info'])

  // A --config that only appears after `--` is for the app, not for the CLI.
  assert.deepEqual(withDevIdentity(['dev', '--', '--config', 'x']), ['dev', '--config', DEV_CONFIG, '--', '--config', 'x'])
})
