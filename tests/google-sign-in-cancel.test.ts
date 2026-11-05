import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('closing the Google sign-in window ends the wait at once and is not shown as a failure', () => {
  const rust = read('../src-tauri/src/google_oauth.rs')
  // The native side and the shell agree on the answer for a closed window.
  const native = /SIGN_IN_CANCELLED: &str = "([^"]+)"/.exec(rust)
  assert.ok(native)
  const shell = /GOOGLE_SIGN_IN_CANCELLED = '([^']+)'/.exec(read('../src/core/googleSignIn.ts'))
  assert.ok(shell)
  assert.equal(native[1], shell[1])

  // The wait watches the window: a closed window ends it (after a moment for a finished sign-in's own close),
  // and the 180 second limit remains for a window left open.
  const wait = rust.slice(rust.indexOf('async fn wait_for_code_or_window_close('), rust.indexOf('pub async fn google_sync_enable_loopback('))
  assert.match(wait, /WindowEvent::Destroyed/)
  assert.match(wait, /Duration::from_secs\(180\)/)
  assert.match(wait, /timeout\(Duration::from_secs\(2\), &mut wait\)/)
  assert.match(rust, /wait_for_code_or_window_close\(listener, &state, &popup\)/)

  // Both sign-in buttons just go back when the window was closed.
  const onboarding = read('../src/components/Onboarding/OnboardingWizard.tsx')
  assert.match(onboarding, /cancelled,\s*\}\) => \{\s*setGoogleStarting\(\s*false,\s*\)/)
  assert.match(onboarding, /if \(\s*cancelled\s*\) \{\s*return\s*\}/)
  const account = read('../src/components/SettingsPanel/AccountSettingsSection.tsx')
  assert.match(account, /\{ claims, error, cancelled \}/)
  assert.match(account, /if \(cancelled\) return/)

  const signIn = read('../src/core/googleSignIn.ts')
  assert.match(signIn, /message === GOOGLE_SIGN_IN_CANCELLED/)
})
