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
]

/** Colours that are not the theme's: the black of a shadow, the dimming layer behind a dialog, brand logos. */
const ALLOWED = [
  /^rgba\(0, 0, 0, /, /^rgba\(4, 7, 14, /, /^rgba\(15, 19, 48, /, /^rgba\(31, 41, 90, /,
  // The logos of Instagram and WhatsApp in the notification panel keep their own colours.
  /^#(6954d8|c33c9e|f39a42|176a46|20ad68|fff|e8fff1)$/i, /^rgba\((255, 156, 105|103, 236, 158), /,
]

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
  for (const path of THEMED) assert.deepEqual(colourLiterals(read(path)), [], path)
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
    assert.ok(css.includes('var(--nebula-pop)'), `${path} is a card of the theme`)
    assert.doesNotMatch(css, /backdrop-filter/, `${path} has no blur of its own`)
  }
  // Status colours come from tokens, so they are right in the light theme too.
  assert.match(read('src/styles/tokens.css'), /--nebula-warning: #f4b95f;/)
  assert.match(read('src/styles/global.css'), /--nebula-warning: #b45309;/)
})
