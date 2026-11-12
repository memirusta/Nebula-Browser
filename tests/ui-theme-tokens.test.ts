import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`)
  assert.ok(start >= 0, `${selector} block`)
  return css.slice(start, css.indexOf('\n}', start))
}

test('the light theme carries the Indigo look and the dark theme is a neutral black; both have a popover, a main button and the font', () => {
  const css = read('src/styles/global.css')

  for (const theme of ["[data-theme='dark']", "[data-theme='light']"]) {
    const rules = block(css, theme)
    for (const token of ['--nebula-primary:', '--nebula-pop:', '--nebula-shell-bg:', '--nebula-font:', '--nebula-field-border:']) {
      assert.ok(rules.includes(token), `${theme} sets ${token}`)
    }
    assert.match(rules, /--nebula-font: 'Plus Jakarta Sans'/)
  }

  // The light theme has an accent of its own (indigo); the dark theme uses the cyan accent set of tokens.css, like Forest.
  const light = block(css, "[data-theme='light']")
  for (const token of ['--nebula-accent:', '--nebula-accent-dim:', '--nebula-accent-glow:']) assert.ok(light.includes(token), `light sets ${token}`)
  const dark = block(css, "[data-theme='dark']")
  assert.doesNotMatch(dark, /--nebula-accent:/)
  // Black: a neutral zinc, with no blue or purple in the background, the cards or the glass.
  assert.match(dark, /--nebula-void: #09090b;/)
  assert.match(dark, /--nebula-pop: #18181b;/)
  assert.match(dark, /--nebula-deep: rgba\(10, 10, 13, 0\.82\);/)
  assert.doesNotMatch(dark, /#0c0e19|#1b1e2b|24, 27, 44/)

  // Forest keeps what it had: no accent, no font of its own (the defaults in tokens.css apply).
  const forest = block(css, "[data-theme='forest']")
  assert.doesNotMatch(forest, /--nebula-accent|--nebula-font|--nebula-primary/)

  assert.match(css, /font-family: var\(--nebula-font\);/)
})

test('the defaults every theme falls back on are defined once, and the font is bundled', () => {
  const tokens = read('src/styles/tokens.css')

  for (const token of ['--nebula-surface-2:', '--nebula-field-border:', '--nebula-soft:', '--nebula-soft-border:', '--nebula-primary:', '--nebula-pop:', '--nebula-shell-bg:', '--nebula-font:']) {
    assert.ok(tokens.includes(token), `tokens.css defines ${token}`)
  }

  // The shell is not painted forest green any more regardless of the theme.
  assert.doesNotMatch(tokens, /background: #1a2e22;/)
  assert.match(tokens, /var\(--nebula-shell-bg\)/)

  for (const file of ['plus-jakarta-sans-latin-wght-normal.woff2', 'plus-jakarta-sans-latin-ext-wght-normal.woff2']) {
    assert.equal(existsSync(new URL(`../src/assets/fonts/${file}`, import.meta.url)), true, file)
    assert.ok(tokens.includes(`../assets/fonts/${file}`), `${file} is loaded from tokens.css`)
  }
})

test('the default accent means "the theme\'s own"; only a colour the person chose is written to the page', () => {
  const settings = read('src/core/nebulaSettings.ts')

  assert.match(settings, /export const DEFAULT_ACCENT_COLOR = '#7ec8e3'/)
  assert.match(settings, /export function usesThemeAccent\(accentColor: string\): boolean/)

  const apply = settings.slice(settings.indexOf('export function applyNebulaCssVars'))
  // Nothing is written for the default: every variable of the set is removed, so the theme's own values apply.
  const branch = apply.slice(apply.indexOf('if (usesThemeAccent(a.accentColor))'), apply.indexOf("root.style.setProperty('--nebula-gold'"))
  assert.match(branch, /for \(const name of accentVars\) root\.style\.removeProperty\(name\)/)
  for (const name of ['--nebula-accent', '--nebula-accent-dim', '--nebula-accent-glow']) {
    assert.ok(apply.includes(`'${name}',`), `${name} is in the list that is removed`)
  }
  // A chosen colour is written with everything worked out from it (see accent-palette.test.ts).
  assert.match(branch, /setProperty\('--nebula-accent', set\.accent\)/)
})

test('the settings controls use the shared tokens instead of fixed white tints', () => {
  const css = read('src/components/SettingsPanel/SettingsPanel.module.css')

  // A flat fill of the accent (the places and what they follow: accent-palette.test.ts).
  assert.match(block(css, '.toggleOn'), /var\(--nebula-accent\)/)
  assert.match(block(css, '.actionBtn'), /var\(--nebula-field-border\)/)
  assert.match(css, /\.select option,\n\.select optgroup \{\n  background: var\(--nebula-pop\);/)
  assert.match(block(css, '.rangeInput'), /var\(--fill\)/)

  // The slider's fill comes from the value.
  assert.match(read('src/components/SettingsPanel/SettingControls.tsx'), /'--fill':/)
})

test('the home screen follows the theme: readable greeting, toolbar, widget bar and window buttons in the light theme', () => {
  const global = read('src/styles/global.css')
  const tokens = read('src/styles/tokens.css')

  // The gold as text is its own colour on dark surfaces and darkened on the light theme.
  assert.match(tokens, /--nebula-gold-ink: var\(--nebula-gold\);/)
  assert.match(block(global, "[data-theme='light']"), /--nebula-gold-ink: color-mix\(in srgb, var\(--nebula-gold\) 38%, #1c1a10\);/)
  // The avatar is the main button gradient in the Indigo themes; Forest keeps its own.
  for (const theme of ["[data-theme='dark']", "[data-theme='light']"]) {
    assert.match(block(global, theme), /--nebula-avatar: var\(--nebula-gradient\);/)
    // The count on the bell is white on the main button gradient; the dark ink stays for Forest's light blue.
    assert.match(block(global, theme), /--nebula-badge-bg: var\(--nebula-accent\);\s+--nebula-badge-ink: var\(--nebula-on-accent\);/)
  }
  assert.doesNotMatch(block(global, "[data-theme='forest']"), /--nebula-avatar|--nebula-badge/)
  assert.match(block(read('src/components/RightToolbar/RightToolbar.module.css'), '.badge'), /background: var\(--nebula-badge-bg, var\(--nebula-accent\)\);\s+color: var\(--nebula-badge-ink, #0a1420\);/)

  const home = read('src/components/HomeCenter/HomeCenter.module.css')
  assert.match(block(home, '.greeting'), /color: var\(--nebula-gold-ink\)/)
  assert.match(block(home, '.greeting'), /text-shadow:\s+0 1px 3px rgba\(0, 0, 0, 0\.45\)/)
  assert.match(block(home, '.avatar'), /var\(--nebula-avatar,/)

  // No fixed white or fixed dark colours that vanish on the other theme.
  assert.match(block(read('src/components/RightToolbar/RightToolbar.module.css'), '.actionBtn'), /color: var\(--nebula-text\)/)
  assert.match(block(read('src/components/SpatialGrid/GridCell.module.css'), '.chrome'), /color-mix\(in srgb, var\(--nebula-void\) 55%, transparent\)/)
  const lunar = read('src/components/SemiLunarMenu/SemiLunarMenu.module.css')
  assert.match(block(lunar, '.evBtn'), /color: var\(--nebula-gold-ink\)/)
  assert.match(block(lunar, '.evBtn'), /border: 1px solid var\(--nebula-glass-border\)/)
})

test('a profile picture that cannot be loaded falls back to the person icon instead of a broken image', () => {
  const home = read('src/components/HomeCenter/HomeCenter.tsx')
  assert.match(home, /const \[failedAvatarUrl, setFailedAvatarUrl\] = useState<string \| null>\(null\)/)
  assert.match(home, /\{avatarUrl && failedAvatarUrl !== avatarUrl \? \(/)
  assert.match(home, /onError=\{\(\) => setFailedAvatarUrl\(avatarUrl\)\}/)
  assert.match(home, /referrerPolicy="no-referrer"/)
})
