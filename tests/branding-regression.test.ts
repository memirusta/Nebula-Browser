import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('detailed and small-size Nebula marks are reused by the right branding surfaces', () => {
  assert.equal(existsSync(new URL('../public/nebula-app-logo.png', import.meta.url)), true)
  assert.equal(existsSync(new URL('../public/nebula-simple-logo.png', import.meta.url)), true)
  assert.equal(existsSync(new URL('../public/nebula-thumbnail.png', import.meta.url)), true)
  assert.equal(existsSync(new URL('../public/favicon.png', import.meta.url)), true)
  assert.equal(existsSync(new URL('../src-tauri/resources/branding/nebula-app-logo-128.base64', import.meta.url)), true)

  const index = read('../index.html')
  const onboarding = read('../src/components/Onboarding/OnboardingWelcomeStep.tsx')
  const about = read('../src/components/SettingsPanel/AboutUpdateSection.tsx')
  const appDialog = read('../src/components/AppDialog/AppDialogHost.tsx')
  const sitePrompt = read('../src/components/SiteUiPrompt/SiteUiPrompt.tsx')
  const errorPage = read('../src-tauri/src/tab_error_page.rs')

  assert.match(index, /type="image\/png" href="\/favicon\.png"/)
  assert.match(onboarding, /src="\/nebula-app-logo\.png"/)
  assert.doesNotMatch(onboarding, /src-tauri\/icons\/icon\.png/)
  assert.match(about, /src="\/nebula-app-logo\.png"/)
  assert.match(appDialog, /src="\/nebula-app-logo\.png"/)
  assert.match(sitePrompt, /src="\/nebula-app-logo\.png"/)
  assert.match(errorPage, /include_str!\("\.\.\/resources\/branding\/nebula-app-logo-128\.base64"\)/)
  assert.match(errorPage, /data:image\/png;base64,\{nebula_mark\}/)
  assert.doesNotMatch(errorPage, /class="glyph">N</)
})

test('Windows executable and installer branding use the canonical icon bundle', () => {
  const config = JSON.parse(read('../src-tauri/tauri.conf.json')) as {
    productName: string
    identifier: string
    bundle: { icon: string[] }
  }

  assert.equal(config.productName, 'Nebula')
  assert.equal(config.identifier, 'com.nebula.browser')
  assert.deepEqual(config.bundle.icon, [
    'icons/32x32.png',
    'icons/128x128.png',
    'icons/128x128@2x.png',
    'icons/icon.icns',
    'icons/icon.ico',
  ])
  for (const icon of config.bundle.icon) {
    assert.equal(existsSync(new URL(`../src-tauri/${icon}`, import.meta.url)), true)
  }
})
