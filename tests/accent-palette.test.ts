import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

import {
  CARD_COLOR,
  contrastRatio,
  deriveAccentSet,
  hexToRgb,
  luminance,
  onColor,
  readableInk,
} from '../src/core/accentPalette.ts'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

test('the set worked out from an accent: strong end, soft tones, text on it and the "r, g, b" for rgba()', () => {
  const set = deriveAccentSet('#8b8ffb', 'dark')
  assert.equal(set.accent, '#8b8ffb')
  assert.equal(set.rgb, '139, 143, 251')
  assert.equal(set.dim, 'rgba(139, 143, 251, 0.35)')
  assert.equal(set.glow, 'rgba(139, 143, 251, 0.55)')
  assert.equal(set.soft, 'rgba(139, 143, 251, 0.14)')
  assert.equal(set.border, 'rgba(139, 143, 251, 0.42)')
  // The strong end is darker than the accent, and the gradient runs from it to the accent.
  assert.ok(luminance(set.strong) < luminance(set.accent))
  assert.equal(set.gradient, `linear-gradient(135deg, ${set.strong}, ${set.accent})`)
})

test('text on a fill is white or near-black, whichever reads', () => {
  assert.equal(onColor('#31347c'), '#ffffff')
  assert.equal(onColor('#fde68a'), '#0b0f1a')
  for (const fill of ['#31347c', '#4f46e5', '#fbbf24', '#e11d48']) {
    assert.ok(contrastRatio(fill, onColor(fill)) >= 4.5, fill)
  }
})

test('a deep accent that makes a good button still reads as a ring, an icon or a link: its ink is moved until it does', () => {
  const deep = deriveAccentSet('#31347c', 'dark')
  assert.ok(contrastRatio(deep.accent, CARD_COLOR.dark) < 2, 'the accent itself is too dark to be a line')
  assert.ok(contrastRatio(deep.ink, CARD_COLOR.dark) >= 4.5, 'its ink reads on a dark card')
  // The hue is kept: the ink is the same colour, lighter.
  const [r, g, b] = hexToRgb(deep.ink)
  assert.ok(b > r && b > g, 'still a blue')

  // On the light theme a pale accent is moved the other way.
  const pale = deriveAccentSet('#fde68a', 'light')
  assert.ok(contrastRatio(pale.accent, CARD_COLOR.light) < 2)
  assert.ok(contrastRatio(pale.ink, CARD_COLOR.light) >= 4.5)

  // An accent that already reads is not touched.
  assert.equal(readableInk('#8b8ffb', 'dark'), '#8b8ffb')
  assert.equal(readableInk('#4f46e5', 'light'), '#4f46e5')
})

test('the secondary colour is a neighbour of the accent in hue and reads as a chart line on the theme', () => {
  for (const mode of ['dark', 'light', 'forest'] as const) {
    for (const accent of ['#8b8ffb', '#31347c', '#4f46e5', '#fb7185', '#34d399']) {
      const set = deriveAccentSet(accent, mode)
      assert.notEqual(set.secondary.toLowerCase(), set.accent.toLowerCase(), `${mode} ${accent}`)
      assert.ok(contrastRatio(set.secondary, CARD_COLOR[mode]) >= 3, `${mode} ${accent} secondary reads`)
    }
  }
})

test('the page gets the whole set only for a colour the person chose; the default is each theme\'s own', () => {
  const settings = read('src/core/nebulaSettings.ts')
  assert.match(settings, /import \{ deriveAccentSet, readableInk \} from '\.\/accentPalette'/)
  for (const name of ['--nebula-accent-dim', '--nebula-accent-glow', '--nebula-accent-rgb', '--nebula-accent-strong', '--nebula-accent-ink', '--nebula-on-accent', '--nebula-secondary']) {
    assert.ok(settings.includes(`'${name}'`), name)
  }
  assert.match(settings, /if \(usesThemeAccent\(a\.accentColor\)\) \{\s+for \(const name of accentVars\) root\.style\.removeProperty\(name\)/)
  assert.match(settings, /deriveAccentSet\(a\.accentColor, a\.theme\)/)
  // The gold as text is moved until it reads, on either theme.
  assert.match(settings, /'--nebula-gold-ink', readableInk\(a\.goldColor, a\.theme\)/)

  // Each theme has the same set for its own accent, so the default and a custom colour behave the same.
  const tokens = read('src/styles/tokens.css')
  const global = read('src/styles/global.css')
  for (const css of [tokens, global.slice(global.indexOf("[data-theme='dark']")), global.slice(global.indexOf("[data-theme='light']"))]) {
    for (const name of ['--nebula-accent-rgb:', '--nebula-accent-strong:', '--nebula-accent-ink:', '--nebula-on-accent:', '--nebula-secondary:']) {
      assert.ok(css.includes(name), name)
    }
  }
  assert.match(tokens, /--nebula-gradient: linear-gradient\(135deg, var\(--nebula-accent-strong\), var\(--nebula-accent\)\);/)
})

test('the places follow the accent as chosen: flat fills for controls, ink for lines and rings, the gradient for the avatar', () => {
  // Controls: a flat accent fill.
  const settings = read('src/components/SettingsPanel/SettingsPanel.module.css')
  assert.match(settings, /\.toggleOn \{\s+border-color: transparent;\s+background: var\(--nebula-accent\);/)
  const global = read('src/styles/global.css')
  for (const theme of ["[data-theme='dark']", "[data-theme='light']"]) {
    const rules = global.slice(global.indexOf(theme), global.indexOf('\n}', global.indexOf(theme)))
    assert.match(rules, /--nebula-badge-bg: var\(--nebula-accent\);/)
    assert.match(rules, /--nebula-badge-ink: var\(--nebula-on-accent\);/)
    assert.match(rules, /--nebula-avatar: var\(--nebula-gradient\);/)
  }

  // Lines, icons and rings: the readable ink.
  assert.match(settings, /\.navItemActive \.navIcon \{\s+color: var\(--nebula-accent-ink\);/)
  assert.match(global, /outline: 2px solid var\(--nebula-accent-ink\);/)
  assert.match(read('src/components/SettingsPanel/AppearanceHero.module.css'), /border-color: var\(--nebula-accent-ink\);/)

  // The avatar ring is a flat accent; the avatar the gradient.
  const home = read('src/components/HomeCenter/HomeCenter.module.css')
  assert.match(home, /\.avatarRing \{[^}]*background: var\(--nebula-accent\);/)
  assert.match(home, /background: var\(--nebula-avatar, var\(--nebula-gradient\)\);/)

  // The charts: the first line the accent's ink, the second the secondary colour; no fixed white or purple.
  assert.match(read('src/components/widgets/RamWidget.tsx'), /color="var\(--nebula-accent-ink\)"/)
  assert.match(read('src/components/widgets/CpuWidget.tsx'), /color="var\(--nebula-secondary\)"/)
  assert.doesNotMatch(read('src/components/PerformanceChart/Sparkline.tsx'), /rgba\(255,255,255/)
  assert.doesNotMatch(read('src/components/widgets/widgets.module.css'), /#c18cff/)
})

test('no component writes the old blue accent out any more: it follows the accent', () => {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (name.endsWith('.css') && !path.replace(/\\/g, '/').endsWith('styles/tokens.css')) {
        if (/rgba\(\s*126\s*,\s*200\s*,\s*227/.test(readFileSync(path, 'utf8'))) found.push(path)
      }
    }
  }
  walk(new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  assert.deepEqual(found, [])
})

test('the accent is picked in Settings with a colour picker - a square of shades, a rainbow bar and the hex - applied as it is dragged', () => {
  const picker = read('src/components/SettingsPanel/ColorSpectrum.tsx')
  // The shade square, the hue bar and the hex field, each named for assistive technology.
  assert.match(picker, /role="slider"[\s\S]*?aria-label=\{labels\.shade\}/)
  assert.match(picker, /type="range"[\s\S]*?aria-label=\{labels\.hue\}/)
  assert.match(picker, /aria-label=\{labels\.hex\}/)
  assert.match(picker, /setPointerCapture\(event\.pointerId\)/)
  // At most one change per frame, so dragging does not flood the settings.
  assert.match(picker, /requestAnimationFrame/)
  // Keyboard: the arrows move through the shades.
  assert.match(picker, /ArrowLeft[\s\S]*?ArrowRight[\s\S]*?ArrowUp[\s\S]*?ArrowDown/)
  // Only a complete hex is taken from the field.
  assert.match(picker, /\/\^#\[0-9a-fA-F\]\{6\}\$\/\.test\(text\)/)

  // The Appearance card has a plain "+" circle after the colours that opens the picker; the colour rows left Advanced.
  const hero = read('src/components/SettingsPanel/AppearanceHero.tsx')
  assert.match(hero, /<ColorSpectrum value=\{value\} onChange=\{onChange\}/)
  assert.match(hero, /const customChosen = !colors\.some/)
  assert.match(hero, /<path d="M12 5v14M5 12h14" \/>/)
  // The same choice is used twice: the accent, and the detail colour (the former gold: welcome text, window buttons).
  assert.match(hero, /<ColorChoice\s+title=\{props\.title\.accent\}/)
  assert.match(hero, /<ColorChoice\s+title=\{props\.title\.detail\}[\s\S]*?onChange=\{props\.onDetail\}/)
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /onDetail=\{\(v\) => onUpdate\('appearance', 'goldColor', v\)\}/)
  const advanced = panel.slice(panel.indexOf('<SettingAdvanced'), panel.indexOf('</SettingAdvanced>'))
  assert.doesNotMatch(advanced, /label=\{t\('accentColor'\)\}/)
  assert.doesNotMatch(advanced, /label=\{t\('goldColor'\)\}/)
  // No rainbow ring any more: a dashed, plain circle.
  assert.doesNotMatch(read('src/components/SettingsPanel/AppearanceHero.module.css'), /conic-gradient/)

  // Any colour row opens the same picker under its swatch.
  assert.match(read('src/components/SettingsPanel/SettingControls.tsx'), /\{open && \(\s+<div className=\{styles\.colorPickerBody\}>\s+<ColorSpectrum/)

  const copy = read('src/components/SettingsPanel/settingsGroupCopy.ts')
  for (const key of ['customColor', 'colorShade', 'colorHue', 'colorHex', 'detailColor', 'detailColorHint']) assert.equal(copy.split(`    ${key}: `).length - 1, 9, `${key} in nine languages`)
})

test('the small dot of a widget header is the readable ink, so a deep accent does not make it vanish', () => {
  const cell = read('src/components/SpatialGrid/GridCell.module.css')
  const dot = cell.slice(cell.indexOf('.tabDot {'), cell.indexOf('.tabTitle'))
  assert.match(dot, /background: var\(--nebula-accent-ink\);/)
  assert.doesNotMatch(dot, /background: var\(--nebula-accent\);/)
})
