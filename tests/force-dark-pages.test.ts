import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const settings = readFileSync(
  new URL('../src/core/nebulaSettings.ts', import.meta.url),
  'utf8',
)
const settingsPanel = readFileSync(
  new URL('../src/components/SettingsPanel/SettingsPanel.tsx', import.meta.url),
  'utf8',
)
const sitePanel = readFileSync(
  new URL('../src/components/SiteInfoPanel/SiteInfoPanel.tsx', import.meta.url),
  'utf8',
)
const shell = readFileSync(
  new URL('../src/components/BrowserShell/BrowserShell.tsx', import.meta.url),
  'utf8',
)
const platform = readFileSync(
  new URL('../src/platform/tauriBrowser.ts', import.meta.url),
  'utf8',
)
const native = readFileSync(
  new URL('../src-tauri/src/force_dark_pages.rs', import.meta.url),
  'utf8',
)
const siteUi = readFileSync(
  new URL('../src-tauri/src/site_ui.rs', import.meta.url),
  'utf8',
)

test('webpage darkening persists Off, Auto, Always, and bounded per-site overrides', () => {
  assert.match(settings, /DarkenWebpagesMode = 'off' \| 'auto' \| 'always'/)
  assert.match(settings, /darkenWebpages: 'off'/)
  assert.match(settings, /darkenWebpagesSiteOverrides: \{\}/)
  assert.match(settings, /Object\.keys\(normalized\)\.length >= 256/)
  assert.match(settingsPanel, /label=\{t\('darkenWebpages'\)\}/)
  assert.match(settingsPanel, /value: 'auto'/)
  assert.match(settingsPanel, /value: 'always'/)
})

test('force dark prefers native site theming before algorithmic DOM darkening', () => {
  assert.match(native, /Emulation\.setEmulatedMedia/)
  assert.match(native, /prefers-color-scheme/)
  assert.match(native, /nativeDarkPage\(\)/)
  assert.match(native, /data-nebula-force-dark=\"algorithm\"/)
  assert.match(native, /new MutationObserver/)
  assert.doesNotMatch(native, /filter:\s*invert/)
  assert.match(native, /img,video,canvas,svg,picture,iframe,object,embed/)
  assert.doesNotMatch(native, /background-image:\s*none/)
  assert.match(native, /nebula-force-dark-status/)
  assert.match(siteUi, /claimed_origin == source_origin/)
  assert.match(siteUi, /"stage": "force-dark\.result"/)
})

test('force dark follows each tab navigation and cleans its native handlers', () => {
  assert.match(native, /add_NavigationStarting/)
  assert.match(native, /add_NavigationCompleted/)
  assert.match(native, /remove_NavigationStarting/)
  assert.match(native, /remove_NavigationCompleted/)
  assert.match(platform, /browser\.webview\.apply-force-dark/)
  assert.match(platform, /browser\.webview\.adopt\.apply-force-dark/)
  assert.match(platform, /configurePopupBrowseWebview[\s\S]*?applyForceDarkToLabel/)
})

test('site info owns a deterministic default, off, or always override', () => {
  assert.match(sitePanel, /Sayfa koyulaştırma/)
  assert.match(sitePanel, /\['default',[\s\S]*?\['off',[\s\S]*?\['always'/)
  assert.match(shell, /case 'set-site-darkening'/)
  assert.match(shell, /delete overrides\[site\.hostname\]/)
  assert.match(shell, /darkenWebpagesSiteOverrides/)
})
