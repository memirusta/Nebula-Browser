import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

test('the shell reads the theme and the palette as plain colours and sends them with the list and the bubble', () => {
  const theme = read('src/core/popupTheme.ts')
  for (const token of ['--nebula-pop', '--nebula-text', '--nebula-text-muted', '--nebula-glass-border', '--nebula-field-border', '--nebula-surface-2', '--nebula-accent', '--nebula-accent-strong', '--nebula-accent-ink', '--nebula-on-accent', '--nebula-soft', '--nebula-soft-border']) {
    assert.ok(theme.includes(`'${token}'`), token)
  }
  // A custom property holds text such as color-mix(...), so each token is resolved through the colour of a probe element.
  assert.match(theme, /probe\.style\.color = `var\(\$\{variable\}\)`/)
  assert.match(theme, /getComputedStyle\(probe\)\.color/)

  const bridge = read('src/platform/tauriPasswordBridge.ts')
  assert.match(bridge, /buildPasswordSuggestScript\(\{ \.\.\.payload, theme: readPopupTheme\(\) \}\)/)
  assert.match(bridge, /buildPasswordSaveScript\(bubble \? \{ \.\.\.bubble, theme: readPopupTheme\(\) \} : null\)\)/)
  const suggest = read('src/core/passwordSuggest.ts')
  assert.equal(suggest.split('theme?: PopupTheme').length - 1, 2, 'both payloads can carry it')
})

test('the page script draws the account list and the save bubble in those colours, and only takes colours', () => {
  const script = read('src-tauri/src/site_scripts/password_suggest.js')
  // Every surface colour is a custom property with the old colour as its fallback.
  for (const token of ['--nb-card', '--nb-text', '--nb-muted', '--nb-border', '--nb-ink', '--nb-soft', '--nb-accent', '--nb-strong', '--nb-on', '--nb-shadow']) {
    assert.ok(script.includes(`var(${token}, `), token)
  }
  // The main button is the accent gradient, like every other button of Nebula.
  assert.match(script, /\.primary \{ border: 0; background: linear-gradient\(135deg, var\(--nb-strong, #4338ca\), var\(--nb-accent, #4f46e5\)\); color: var\(--nb-on, #ffffff\); \}/)
  // Without colours from the shell the page's own dark preference still decides; with them it does not.
  assert.equal(script.split(':host(:not([data-themed]))').length - 1 >= 8, true)
  assert.doesNotMatch(script, /\n\s+'\s\s\.(panel|card|badge|primary|head|row\.active|kind) \{/, 'no dark rule that ignores the themed colours')
  // Both messages hand the colours over, and a colour is a short value made of the characters a colour is written with.
  assert.match(script, /if \(data && data\.theme\) setTheme\(data\.theme\);/)
  assert.match(script, /if \(data\.theme\) setTheme\(data\.theme\);/)
  assert.match(script, /function colourValue\(value\) \{\s+return typeof value === 'string' && value\.length <= 120 && \/\^\[a-zA-Z0-9#\(\),\.%\\s\\\/-\]\+\$\/\.test\(value\) \? value : ''/)
})
