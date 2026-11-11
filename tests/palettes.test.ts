import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { contrastRatio, deriveAccentSet, neutralSet, toneColor, toneFromColor } from '../src/core/accentPalette.ts'
import { PALETTES, paletteMatches, paletteValues } from '../src/core/palettes.ts'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

const DEFAULTS = { accentColor: '#7ec8e3', goldColor: '#d4c48a' }

test('six ready palettes; the first is the default, which writes nothing of its own', () => {
  assert.deepEqual(PALETTES.map((p) => p.id), ['indigo', 'ocean', 'emerald', 'rose', 'amber', 'graphite'])
  const indigo = PALETTES[0]
  assert.equal(indigo.dark, null)
  assert.equal(indigo.light, null)
  assert.equal(indigo.gold, null)
  assert.equal(indigo.hue, -1)
  for (const palette of PALETTES.slice(1)) {
    for (const colour of [palette.dark, palette.light, palette.gold]) assert.match(colour ?? '', /^#[0-9a-f]{6}$/i, palette.id)
    assert.ok(palette.hue >= 0 && palette.hue <= 360, palette.id)
    assert.ok(palette.sat >= 0 && palette.sat <= 0.6, palette.id)
  }
})

test('what a palette writes depends on the theme: the lighter accent on the dark themes, the deeper on the light', () => {
  const ocean = PALETTES.find((p) => p.id === 'ocean')!
  assert.equal(paletteValues(ocean, 'dark').accent, '#38bdf8')
  assert.equal(paletteValues(ocean, 'forest').accent, '#38bdf8')
  assert.equal(paletteValues(ocean, 'light').accent, '#0284c7')
  assert.equal(paletteValues(PALETTES[0], 'light').accent, null)
})

test('a palette is selected when the accent, the detail colour and the neutrals are its own, in either variant', () => {
  const ocean = PALETTES.find((p) => p.id === 'ocean')!
  const settings = { accentColor: '#38bdf8', goldColor: '#fcd34d', neutralHue: 205 }
  assert.equal(paletteMatches(ocean, settings, DEFAULTS), true)
  assert.equal(paletteMatches(ocean, { ...settings, accentColor: '#0284c7' }, DEFAULTS), true)
  assert.equal(paletteMatches(ocean, { ...settings, accentColor: '#112233' }, DEFAULTS), false)
  assert.equal(paletteMatches(ocean, { ...settings, neutralHue: -1 }, DEFAULTS), false)
  // The default palette is the untouched settings.
  assert.equal(paletteMatches(PALETTES[0], { accentColor: '#7ec8e3', goldColor: '#d4c48a', neutralHue: -1 }, DEFAULTS), true)
  assert.equal(paletteMatches(PALETTES[0], { accentColor: '#38bdf8', goldColor: '#d4c48a', neutralHue: -1 }, DEFAULTS), false)
})

test('every palette keeps the interface readable: text and muted text on its neutrals, and its accent as ink on its cards', () => {
  for (const palette of PALETTES.slice(1)) {
    const dark = neutralSet(palette.hue, palette.sat, 'dark')!
    assert.ok(contrastRatio('#f2f4fc', dark.void) >= 12, `${palette.id} text on the dark background`)
    assert.ok(contrastRatio(dark.textMuted, dark.pop) >= 4.5, `${palette.id} muted text on the dark card`)

    const light = neutralSet(palette.hue, palette.sat, 'light')!
    assert.ok(contrastRatio('#0f1330', light.void) >= 12, `${palette.id} text on the light background`)
    assert.ok(contrastRatio(light.textMuted, light.void) >= 4.5, `${palette.id} muted text on the light background`)

    assert.ok(contrastRatio(deriveAccentSet(palette.dark!, 'dark').ink, '#1b1e2b') >= 4.5, `${palette.id} dark ink`)
    assert.ok(contrastRatio(deriveAccentSet(palette.light!, 'light').ink, '#ffffff') >= 4.5, `${palette.id} light ink`)
  }
})

test('the neutrals are the dark theme\'s shapes, tinted: very dark backgrounds, a lighter card, a tint for the glass; none for forest', () => {
  const set = neutralSet(205, 0.38, 'dark')!
  assert.match(set.void, /^#[0-9a-f]{6}$/)
  assert.equal(set.void, set.shellBg)
  assert.match(set.glassTintRgb, /^\d+, \d+, \d+$/)
  assert.equal(set.deep, `rgba(${set.glassTintRgb}, 0.86)`)
  assert.equal(neutralSet(205, 0.38, 'forest'), null)
  // Grey really is grey: no tint when the colourfulness is zero.
  const grey = neutralSet(240, 0, 'dark')!
  assert.equal(grey.void.slice(1, 3), grey.void.slice(3, 5))
})

test('the neutral tint is a setting, written to the page only for a palette that has one, and chosen from tiles', () => {
  const settings = read('src/core/nebulaSettings.ts')
  assert.match(settings, /neutralHue: -1,\s+neutralSat: 0\.35,/)
  assert.match(settings, /neutralHue: clampNum\(a\?\.neutralHue, -1, 360, d\.appearance\.neutralHue\)/)
  assert.match(settings, /const neutrals = a\.neutralHue >= 0 \? neutralSet\(a\.neutralHue, a\.neutralSat, a\.theme\) : null/)
  for (const name of ['--nebula-void', '--nebula-shell-bg', '--nebula-pop', '--nebula-glass-tint-rgb', '--nebula-deep', '--nebula-surface-2', '--nebula-text-muted']) {
    assert.ok(settings.includes(`'${name}'`), name)
  }
  assert.match(settings, /for \(const name of neutralVars\) root\.style\.removeProperty\(name\)/)

  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  for (const key of ['accentColor', 'goldColor', 'neutralHue', 'neutralSat']) {
    assert.ok(panel.includes(`onUpdate('appearance', '${key}'`), `choosing a palette writes ${key}`)
  }
  const hero = read('src/components/SettingsPanel/AppearanceHero.tsx')
  assert.match(hero, /props\.palettes\.map\(\(palette\) =>/)
  assert.match(hero, /onClick=\{\(\) => props\.onPalette\(palette\.id\)\}/)

  const copy = read('src/components/SettingsPanel/settingsGroupCopy.ts')
  for (const key of ['palette', 'paletteIndigo', 'paletteOcean', 'paletteEmerald', 'paletteRose', 'paletteAmber', 'paletteGraphite']) {
    assert.equal(copy.split(`    ${key}: `).length - 1, 9, `${key} in nine languages`)
  }
})

test('a tone is shown as a colour and read back from one: hue and colourfulness, never brightness', () => {
  const ocean = PALETTES.find((p) => p.id === 'ocean')!
  const back = toneFromColor(toneColor(ocean.hue, ocean.sat))
  assert.ok(Math.abs(back.hue - ocean.hue) <= 1)
  assert.ok(Math.abs(back.sat - ocean.sat) <= 0.02)
  assert.equal(toneFromColor('#808080').sat, 0)
  assert.ok(toneFromColor('#ff0000').sat <= 0.6)
  // Each palette's tone shows differently, so the row of tones can be told apart.
  const shown = PALETTES.slice(1).map((p) => toneColor(p.hue, p.sat))
  assert.equal(new Set(shown).size, shown.length)
})

test('the background tone has its own section: the theme\'s own, each palette\'s tone and a picker; not for forest, which has none', () => {
  const hero = read('src/components/SettingsPanel/AppearanceHero.tsx')
  assert.match(hero, /props\.theme !== 'forest' && \(\s+<ToneChoice/)
  assert.match(hero, /const TONES = \[OWN_TONE, \.\.\.PALETTES\.slice\(1\)/)
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /onTone=\{\(hue, sat\) => chooseColours\(\{ neutralHue: hue, neutralSat: sat \}\)\}/)
  const copy = read('src/components/SettingsPanel/settingsGroupCopy.ts')
  assert.equal(copy.split('    surfaceTone: ').length - 1, 9, 'surfaceTone in nine languages')
})

test('a colour dragged in a picker is only shown on the page; it is saved when the drag ends, not on every frame', () => {
  const spectrum = read('src/components/SettingsPanel/ColorSpectrum.tsx')
  assert.match(spectrum, /\(onPreview \?\? onChange\)\(hex\)/)
  assert.match(spectrum, /onPointerUp=\{endDrag\}/)
  assert.match(spectrum, /emit\(latest\.current, true\)/)
  assert.match(spectrum, /dragging \|\| hsvToHex\(picked\)/)
  const hero = read('src/components/SettingsPanel/AppearanceHero.tsx')
  assert.match(hero, /onPreview=\{onPreview\}/)
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /applyNebulaCssVars\(\{ \.\.\.settings, appearance: \{ \.\.\.appearance, \.\.\.patch \} \}\)/)
  for (const key of ['accent', 'detail', 'tone']) assert.ok(panel.includes(`${key}: (`), key)
})

test('a chosen colour is shown on the page before it is saved, and saved as a transition, so the redraw does not freeze Settings', () => {
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /const chooseColours = \(patch: [^\n]+\) => \{\n\s+previewAppearance\(patch\)/)
  for (const colour of ['accentColor', 'goldColor', 'neutralHue', 'neutralSat']) {
    assert.ok(panel.includes(`onUpdate('appearance', '${colour}', patch.${colour})`), colour)
  }
  const hook = read('src/hooks/useNebulaSettings.ts')
  assert.match(hook, /COLOUR_KEYS: ReadonlySet<PropertyKey> = new Set\(\['accentColor', 'goldColor', 'neutralHue', 'neutralSat'\]\)/)
  assert.match(hook, /if \(category === 'appearance' && COLOUR_KEYS\.has\(key\)\) startTransition\(save\)/)
})

test('the colour picker steps the Settings panel aside while it is dragged, hue bar and shade square alike, so the colour is seen on the real screen', () => {
  assert.match(read('src/components/SettingsPanel/ColorSpectrum.tsx'), /role="slider"\n\s+data-peek\n/)
  assert.match(read('src/components/SettingsPanel/SettingsPanel.tsx'), /closest\?\.\('input\[type="range"\]'\) \|\| target\.closest\?\.\('\[data-peek\]'\)\) setPeeking\(true\)/)
  assert.match(read('src/components/SettingsPanel/SettingsPanel.module.css'), /\.panelPeek \.groupBody > \*:has\(\[data-peek\]:active\),\n\.panelPeek \.groupBody > \*:has\(input\[type='range'\]:active\) \{/)
})

test('a drag of the shade square is not ended by the hue bar losing focus: only the pointer ends a drag', () => {
  const spectrum = read('src/components/SettingsPanel/ColorSpectrum.tsx')
  // Pressing the square moves focus to it, and the hue bar (or the hex field) that had it is blurred at that moment.
  assert.doesNotMatch(spectrum, /onBlur=\{endDrag\}/)
  assert.match(spectrum, /onPointerUp=\{endDrag\}\n\s+onPointerCancel=\{endDrag\}\n\s+onChange=\{\(event\) => emitMove/)
})
