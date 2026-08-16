import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string): string {
  return readFileSync(
    new URL(path, import.meta.url),
    'utf8',
  )
}

test('onboarding keeps Google sign-in and Sync restore on one profile step', () => {
  const onboarding =
    source('../src/core/onboarding.ts')

  const wizard =
    source('../src/components/Onboarding/OnboardingWizard.tsx')

  const profileIndex =
    onboarding.indexOf("'profile'")

  const defaultIndex =
    onboarding.indexOf("'defaultBrowser'")

  const doneIndex =
    onboarding.indexOf("'done'")

  assert.ok(profileIndex >= 0)
  assert.ok(defaultIndex > profileIndex)
  assert.ok(doneIndex > defaultIndex)
  assert.doesNotMatch(onboarding, /\n\s*'googleLink',/)
  assert.doesNotMatch(onboarding, /\n\s*'syncRestore',/)
  assert.match(wizard, /step ===\s*'profile'/)
  assert.match(wizard, /<OnboardingSyncRestoreStep/)
  assert.match(wizard, /setStep\(\s*'defaultBrowser'/)
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

test('external HTTP links are queued and opened as dedicated new tabs', () => {
  const cargo =
    source('../src-tauri/Cargo.toml')

  const lib =
    source('../src-tauri/src/lib.rs')

  const external =
    source('../src-tauri/src/external_open.rs')

  const frontend =
    source('../src/platform/externalOpen.ts')

  const shell =
    source('../src/components/BrowserShell/BrowserShell.tsx')

  const main =
    source('../src/main.tsx')

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
    /PENDING_EXTERNAL_URLS/,
  )

  assert.match(
    external,
    /nebula-external-url-pending/,
  )

  assert.doesNotMatch(
    external,
    /nebula-chrome-action/,
  )

  assert.match(
    frontend,
    /take_pending_open_urls/,
  )

  assert.match(
    frontend,
    /nebula-external-url-pending/,
  )

  assert.match(
    shell,
    /listenExternalUrlPending/,
  )

  assert.match(
    shell,
    /takePendingExternalUrls/,
  )

  assert.match(
    shell,
    /openUrlInNewTab\s*\(\s*url/,
  )

  assert.doesNotMatch(
    main,
    /flushPendingExternalUrls/,
  )
})