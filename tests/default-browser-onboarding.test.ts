import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string): string {
  return readFileSync(
    new URL(path, import.meta.url),
    'utf8',
  )
}

test('onboarding restores sync before offering default-browser setup', () => {
  const onboarding =
    source('../src/core/onboarding.ts')

  const syncIndex =
    onboarding.indexOf("'syncRestore'")

  const defaultIndex =
    onboarding.indexOf("'defaultBrowser'")

  const doneIndex =
    onboarding.indexOf("'done'")

  assert.ok(syncIndex >= 0)
  assert.ok(defaultIndex > syncIndex)
  assert.ok(doneIndex > defaultIndex)
})

test('Windows installer registers Nebula as a browser candidate without touching UserChoice', () => {
  const config =
    source('../src-tauri/tauri.conf.json')

  const hooks =
    source('../src-tauri/windows/hooks.nsh')

  assert.match(
    config,
    /"installMode"\s*:\s*"currentUser"/,
  )

  assert.match(
    config,
    /"installerHooks"\s*:\s*"\.\/windows\/hooks\.nsh"/,
  )

  assert.match(
    hooks,
    /Software\\RegisteredApplications/,
  )

  assert.match(
    hooks,
    /Nebula\.Url\.Http/,
  )

  assert.match(
    hooks,
    /Nebula\.Url\.Https/,
  )

  assert.doesNotMatch(
    hooks,
    /UserChoice/,
  )
})

test('external HTTP links use single-instance and the existing shell open-tab bridge', () => {
  const cargo =
    source('../src-tauri/Cargo.toml')

  const lib =
    source('../src-tauri/src/lib.rs')

  const external =
    source('../src-tauri/src/external_open.rs')

  const frontend =
    source('../src/platform/externalOpen.ts')

  assert.match(
    cargo,
    /tauri-plugin-single-instance/,
  )

  assert.match(
    lib,
    /tauri_plugin_single_instance::init/,
  )

  assert.match(
    external,
    /nebula-chrome-action/,
  )

  assert.match(
    external,
    /"open-tab"/,
  )

  assert.match(
    frontend,
    /take_pending_open_urls/,
  )
})