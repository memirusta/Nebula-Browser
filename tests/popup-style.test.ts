import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

/** The pop-ups that take their look from the theme and the palette (styles/popup.module.css); the list grows with each batch. */
const THEMED = [
  'src/components/SiteUiPrompt/SiteUiPrompt.module.css',
  'src/components/PasswordFillPrompt/PasswordFillPrompt.module.css',
  'src/components/SiteInfoPanel/SiteInfoPanel.module.css',
  'src/components/DownloadManager/DownloadManager.module.css',
  'src/components/NotificationPanel/NotificationPanel.module.css',
  'src/components/ExtensionsPanel/ExtensionsPanel.module.css',
  'src/components/TabSearch/TabSearch.module.css',
  'src/components/PrivateBrowsingPanel/PrivateBrowsingPanel.module.css',
  'src/components/SiteContextMenu/SiteContextMenu.module.css',
  'src/components/AppUpdatePrompt/AppUpdatePrompt.module.css',
  'src/components/GoogleAccountSetupModal/GoogleAccountSetupModal.module.css',
  'src/components/StoreRecoveryNotice/StoreRecoveryNotice.module.css',
  'src/components/CrashRecoveryPrompt/CrashRecoveryPrompt.module.css',
  'src/components/PrintDialog/PrintDialog.module.css',
  'src/components/GuidedTutorial/GuidedTutorial.module.css',
  'src/components/HistoryPanel/HistoryPanel.module.css',
]

/** Colours that are not the theme's: the black of a shadow, the dimming layer behind a dialog, brand logos. */
const ALLOWED = [
  /^rgba\(0,\s*0,\s*0,/, /^rgba\(4, 7, 14, /, /^rgba\(15, 19, 48, /, /^rgba\(31, 41, 90, /,
  // The logos of Instagram and WhatsApp in the notification panel keep their own colours.
  /^#(6954d8|c33c9e|f39a42|176a46|20ad68|fff|e8fff1)$/i, /^rgba\((255, 156, 105|103, 236, 158), /,
]

/** The sheet of paper in the print preview keeps paper colours; everything around it is the theme's. */
function withoutPaper(path: string, css: string): string {
  if (!path.includes('PrintDialog')) return css
  const from = css.indexOf('.previewDocument {')
  const to = css.indexOf('.previewNote {')
  assert.ok(from > 0 && to > from, 'the paper block of the print preview is where it was')
  return css.slice(0, from) + css.slice(to)
}

function colourLiterals(css: string): string[] {
  return (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) ?? []).filter(
    (literal) => !ALLOWED.some((allowed) => allowed.test(literal)),
  )
}

test('the shared pop-up look is made of theme tokens, with no colour of its own beyond shadow and dimming', () => {
  const css = read('src/styles/popup.module.css')
  assert.deepEqual(colourLiterals(css), [])
  for (const token of ['--nebula-pop', '--nebula-glass-border', '--nebula-text', '--nebula-gradient', '--nebula-on-accent', '--nebula-danger', '--nebula-soft']) {
    assert.ok(css.includes(`var(${token}`), token)
  }
  assert.match(css, /\.surface \{[^}]*border-radius: var\(--ui-radius, 14px\);/)
  assert.match(css, /@keyframes popRise/)
  // Light theme: a lighter shadow and a lighter dimming layer.
  assert.match(css, /:global\(\[data-theme='light'\]\) \.surface/)
  assert.match(css, /:global\(\[data-theme='light'\]\) \.scrim/)
  // No blur behind a dialog: it is a pause, not a window onto the page.
  assert.doesNotMatch(css, /backdrop-filter/)
})

test('the pop-ups that have been moved to the shared look carry no fixed colours', () => {
  for (const path of THEMED) assert.deepEqual(colourLiterals(withoutPaper(path, read(path))), [], path)
})

test('the prompt, the app dialog and the password prompts compose the shared surface, scrim and buttons', () => {
  const css = read('src/components/SiteUiPrompt/SiteUiPrompt.module.css')
  assert.match(css, /\.backdrop \{\n\s+composes: scrim from '\.\.\/\.\.\/styles\/popup\.module\.css';/)
  assert.match(css, /\.card \{\n\s+composes: surface from /)
  assert.match(css, /\.primary \{\n\s+composes: btn btnPrimary from /)
  assert.match(css, /\.secondary \{\n\s+composes: btn from /)
  // The app dialog and the "save password" prompt use this stylesheet, so they follow too.
  assert.match(read('src/components/AppDialog/AppDialogHost.tsx'), /from '\.\.\/SiteUiPrompt\/SiteUiPrompt\.module\.css'/)
  assert.match(read('src/components/PasswordSavePrompt/PasswordSavePrompt.tsx'), /from '\.\.\/SiteUiPrompt\/SiteUiPrompt\.module\.css'/)
})

test('the panels and menus use the card, the borders and the status colours of the theme, and no glass blur', () => {
  for (const path of THEMED.slice(2)) {
    const css = read(path)
    assert.ok(css.includes('var(--nebula-pop)') || css.includes('composes: surface'), `${path} is a card of the theme`)
    assert.doesNotMatch(css, /backdrop-filter/, `${path} has no blur of its own`)
  }
  // Status colours come from tokens, so they are right in the light theme too.
  assert.match(read('src/styles/tokens.css'), /--nebula-warning: #f4b95f;/)
  assert.match(read('src/styles/global.css'), /--nebula-warning: #b45309;/)
})

test('accessibility floor of the pop-ups: readable sizes, real hit areas, a ring for the keyboard, a success colour that reads on white', () => {
  for (const path of THEMED) {
    const css = withoutPaper(path, read(path))
    for (const match of css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      assert.ok(Number(match[1]) >= 10.5, `${path} has text of ${match[1]} px`)
    }
  }
  // The progress dots of the tour are small to look at but 24 px high to hit (WCAG 2.2 target size).
  const tour = read('src/components/GuidedTutorial/GuidedTutorial.module.css')
  assert.match(tour, /\.dots button \{[^}]*width: 20px; height: 24px;/)
  assert.match(tour, /\.backButton:disabled \{ opacity: \.4;/)
  // A field gets a ring when the keyboard is in it, not only a tinted border.
  assert.match(read('src/styles/popup.module.css'), /\.field:focus-visible \{\s+outline: 2px solid var\(--nebula-accent\);/)
  // The success colour of the light theme is text on white: at least 4.5:1.
  const light = /--nebula-success: (#[0-9a-f]{6});/.exec(read('src/styles/global.css').slice(read('src/styles/global.css').indexOf("[data-theme='light']")))![1]
  const channel = (hex: string, at: number) => {
    const v = parseInt(hex.slice(at, at + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(light, 1) + 0.7152 * channel(light, 3) + 0.0722 * channel(light, 5)
  assert.ok(1.05 / (luminance + 0.05) >= 4.5, `${light} on white`)
})

test('buttons, fields and keys take the page font instead of the system one, and no pop-up asks for the system font', () => {
  const global = read('src/styles/global.css')
  assert.match(global, /button,\s+input,\s+select,\s+textarea,\s+kbd \{\s+font-family: inherit;\s+\}/)
  for (const path of THEMED) assert.doesNotMatch(read(path), /system-ui/, path)
})

test('the site information panel is not capped at a height of its own: the window is its only limit', () => {
  assert.match(read('src/components/SiteInfoPanel/SiteInfoPanel.tsx'), /'--panel-height': '1100px'/)
})

test('every theme starts in the same font, and Settings offers the typefaces that ship with Nebula for the interface and the clock', () => {
  const tokens = read('src/styles/tokens.css')
  assert.match(tokens, /--nebula-font: 'Plus Jakarta Sans', 'Segoe UI'/)
  assert.doesNotMatch(tokens, /--nebula-font: 'Segoe UI', 'Inter'/)

  // Each bundled typeface has its files, its @font-face and its licence next to it.
  const fonts = [
    ['Inter', 'inter', 'Inter-OFL.txt'], ['Manrope', 'manrope', 'Manrope-OFL.txt'], ['DM Sans', 'dm-sans', 'DMSans-OFL.txt'],
    ['Space Grotesk', 'space-grotesk', 'SpaceGrotesk-OFL.txt'], ['Lexend', 'lexend', 'Lexend-OFL.txt'], ['JetBrains Mono', 'jetbrains-mono', 'JetBrainsMono-OFL.txt'],
  ] as const
  for (const [family, stem, licence] of fonts) {
    assert.ok(tokens.includes(`font-family: '${family}';`), family)
    assert.ok(tokens.includes(`../assets/fonts/${stem}-latin-wght-normal.woff2`), `${family} latin`)
    assert.ok(tokens.includes(`../assets/fonts/${stem}-latin-ext-wght-normal.woff2`), `${family} latin-ext (Turkish)`)
    assert.match(read(`src/assets/fonts/${licence}`), /SIL Open Font License, Version 1\.1/, `${family} licence`)
  }

  const settings = read('src/core/nebulaSettings.ts')
  assert.match(settings, /export type InterfaceFont = 'nebula' \| 'inter' \| 'manrope' \| 'dm-sans' \| 'space-grotesk' \| 'lexend' \| 'jetbrains-mono' \| 'system'/)
  assert.match(settings, /fontFamily: 'nebula',/)
  assert.match(settings, /\(INTERFACE_FONT_IDS as string\[\]\)\.includes\(a\.fontFamily\)/)
  // Only a choice other than Nebula's own is written to the page; Nebula's is what the themes already bring.
  assert.match(settings, /if \(a\.fontFamily === 'nebula'\) root\.style\.removeProperty\('--nebula-font'\)\s+else root\.style\.setProperty\('--nebula-font', INTERFACE_FONTS\[a\.fontFamily\]\.stack\)/)

  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /label=\{groupCopy\.fontFamily\}/)
  assert.match(panel, /options=\{INTERFACE_FONT_IDS\.map\(/)
  assert.match(panel, /\{ value: 'interface', label: groupCopy\.clockFontInterface \}/)
  const copy = read('src/components/SettingsPanel/settingsGroupCopy.ts')
  for (const key of ['fontFamily', 'fontFamilyHint', 'fontSystem', 'clockFontInterface']) {
    assert.equal(copy.split(`    ${key}: `).length - 1, 9, `${key} in nine languages`)
  }
})

test('the clock follows the interface font by default and any font of the list can be chosen; older choices keep a meaning', () => {
  const settings = read('src/core/nebulaSettings.ts')
  assert.match(settings, /export type ClockFontFamily = 'interface' \| Exclude<InterfaceFont, 'system'> \| 'serif' \| 'light'/)
  assert.match(settings, /interface: 'var\(--nebula-font\)'/)
  assert.match(settings, /clockFontFamily: 'interface',/)
  // The old default ("system") now follows the interface, so the clock does not stay in another font; "mono" is JetBrains Mono.
  assert.match(settings, /if \(value === 'system'\) return 'interface'\n\s+if \(value === 'mono'\) return 'jetbrains-mono'/)
  assert.match(settings, /clockFontFamily: clockFontFamily\(h\?\.clockFontFamily, d\.home\.clockFontFamily\)/)
})

test('the address bar of the Semi-Lunar overlay is a card of the theme, not a fixed blue-grey', () => {
  const css = read('src/components/HomeCenter/HomeCenter.module.css')
  const rule = css.slice(css.indexOf(':global(html[data-nebula-overlay-tauri]) .searchBarOverlay {'))
  const body = rule.slice(0, rule.indexOf('}'))
  assert.match(body, /background: var\(--nebula-pop\);/)
  assert.match(body, /border-color: var\(--nebula-glass-border\);/)
  assert.doesNotMatch(body, /rgba\(16, 22, 30/)
})
