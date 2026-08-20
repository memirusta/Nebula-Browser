import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

test('desktop Google Sync authorization opens inside a Nebula popup window', () => {
  const oauth = source('../src-tauri/src/google_oauth.rs')
  const syncStart = oauth.indexOf('pub async fn google_sync_enable_loopback(')
  const syncEnd = oauth.indexOf('\n#[cfg(test)]', syncStart)
  const syncBody = oauth.slice(syncStart, syncEnd)

  assert.match(oauth, /fn open_google_oauth_popup\(/)
  assert.match(oauth, /WebviewWindowBuilder::new/)
  assert.match(oauth, /WebviewUrl::External/)
  assert.match(oauth, /\.minimizable\(false\)/)
  assert.match(oauth, /\.maximizable\(false\)/)
  assert.match(oauth, /\.theme\(Some\(tauri::Theme::Dark\)\)/)
  assert.match(oauth, /\.incognito\(false\)/)
  assert.match(syncBody, /open_google_oauth_popup\(&app, &auth_url\)/)
  assert.doesNotMatch(syncBody, /open_in_system_browser\(&auth_url\)/)
  assert.match(syncBody, /let _ = popup\.close\(\);/)
})

test('successful Google sign-in embeds the existing Sync restore UI on profile', () => {
  const wizard = source('../src/components/Onboarding/OnboardingWizard.tsx')
  const onboarding = source('../src/core/onboarding.ts')

  assert.match(wizard, /googleLinked/)
  assert.match(wizard, /googleAccountCard/)
  assert.match(wizard, /<OnboardingSyncRestoreStep/)
  assert.match(wizard, /email=\{\s*googleEmail\s*\}/)
  assert.match(wizard, /account=\{\s*accountRef\.current\s*\}/)
  assert.doesNotMatch(onboarding, /\n\s*'googleLink',/)
  assert.doesNotMatch(onboarding, /\n\s*'syncRestore',/)
})
