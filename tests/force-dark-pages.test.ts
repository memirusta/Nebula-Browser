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

test('force dark prefers native or Chromium rendering before algorithmic DOM fallback', () => {
  assert.match(native, /Emulation\.setEmulatedMedia/)
  assert.match(native, /Emulation\.setAutoDarkModeOverride/)
  assert.match(native, /prefers-color-scheme/)
  assert.match(native, /nativeDarkPage\(assessment\)/)
  assert.match(native, /document\.elementFromPoint\(x, y\)/)
  assert.match(native, /darkRatio >= 0\.65 && lightRatio <= 0\.08/)
  assert.match(native, /algorithm-already-active/)
  assert.match(native, /chromium-auto-dark/)
  assert.match(native, /function apply\(options, browserAutoDark = false\)/)
  assert.match(native, /apply_runtime\(&callback_core, &latest, supported && latest_enabled\)/)
  assert.match(native, /nativeObserver = new MutationObserver/)
  assert.match(native, /Math\.max\(120, 1000 - elapsed\)/)
  assert.match(native, /data-nebula-dark-gradient/)
  assert.match(native, /data-nebula-force-dark=\"algorithm\"/)
  assert.match(native, /const TEXT_CONTROL_SELECTOR/)
  assert.match(native, /isTextBearingControl\(element\)/)
  assert.match(native, /function renderedSurfaceLuminance\(element\)/)
  assert.match(native, /const hasText = isTextBearingControl\(element\)/)
  assert.match(native, /parseColor\(style\.webkitTextFillColor\) \|\| parseColor\(style\.color\)/)
  assert.match(native, /const renderedSurface = renderedSurfaceLuminance\(element\)/)
  assert.match(native, /luminance\(foreground\) < 0\.48 &&[\s\S]*?renderedSurface < 0\.42/)
  assert.match(native, /-webkit-text-fill-color: #e8e6e3 !important/)
  assert.match(native, /caret-color: #e8e6e3 !important/)
  assert.match(native, /\[data-nebula-dark-text\]::placeholder/)
  assert.match(native, /-webkit-text-fill-color: #a9a49c !important/)
  assert.match(native, /\['focusin', 'focusout', 'input', 'change'\]/)
  assert.match(native, /removeEventListener\(eventName, controlStateHandler, true\)/)
  assert.match(native, /new MutationObserver/)
  assert.doesNotMatch(native, /filter:\s*invert/)
  assert.match(native, /img,video,canvas,svg,picture,iframe,object,embed/)
  assert.doesNotMatch(native, /background-image:\s*none/)
  assert.match(native, /nebula-force-dark-status/)
  assert.match(native, /location\.protocol === 'http:' \|\| location\.protocol === 'https:'/)
  assert.match(native, /const postToHost = canReportToHost &&/)
  assert.match(siteUi, /claimed_origin == source_origin/)
  assert.match(siteUi, /"browser"/)
  assert.match(siteUi, /"chromium-auto-dark"/)
  assert.match(siteUi, /"stage": "force-dark\.result"/)
  assert.match(siteUi, /"themeReason": theme_reason/)
  assert.match(siteUi, /"lightSampleRatio": light_sample_ratio/)
})

test('embedded force-dark runtime remains valid JavaScript', () => {
  const runtime = native.match(
    /const FORCE_DARK_RUNTIME: &str = r###"([\s\S]*?)"###;/,
  )?.[1]
  assert.ok(runtime)
  assert.doesNotThrow(() => new Function(runtime))
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
