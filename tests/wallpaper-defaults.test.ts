import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

test('a new person starts with the moving Nebula background', () => {
  const source = read('src/core/wallpaperConfig.ts')
  const defaults = source.slice(source.indexOf('export const DEFAULT_WALLPAPER_CONFIG'), source.indexOf('function clamp'))
  assert.match(defaults, /mode: 'ambient'/)
  assert.match(defaults, /ambientPreset: 'nebula'/)
})

test('a picture the person chose stays the background, also when no mode was stored with it', () => {
  const source = read('src/core/wallpaperConfig.ts')
  // Without a stored mode, a stored picture means image; only without one the default mode applies.
  assert.match(source, /: input\?\.imageUrl\s+\? 'image'\s+: base\.mode/)
})

test('a picture from a version before the wallpaper settings is migrated as an image background', () => {
  const source = read('src/core/wallpaperConfig.ts')
  assert.match(source, /\.\.\.\(legacyImage \? \{ mode: 'image' as const \} : \{\}\)/)
})

test('the home screen step offers the four moving backgrounds and a picture or video of one\'s own, in every language', () => {
  const picker = read('src/components/Onboarding/OnboardingWallpaperPicker.tsx')
  for (const preset of ['nebula', 'aurora', 'midnight', 'liquid']) {
    assert.ok(picker.includes(`id: '${preset}'`), preset)
  }
  assert.match(picker, /onChange\(\{ mode: 'ambient', ambientPreset: preset\.id \}\)/)
  assert.match(picker, /onClick=\{onPickImage\}/)
  assert.match(picker, /onClick=\{onPickVideo\}/)

  const home = read('src/components/Onboarding/OnboardingHomeStep.tsx')
  assert.match(home, /<OnboardingWallpaperPicker/)

  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  assert.match(shell, /wallpaper=\{wallpaper\}\n\s+onUpdateWallpaper=\{updateWallpaper\}\n\s+onPickWallpaper=\{pickWallpaper\}\n\s+onPickVideoWallpaper=\{pickVideoWallpaper\}/)

  const copy = read('src/components/Onboarding/onboardingCopy.ts')
  for (const key of ['wallpaperLabel', 'wallpaperOwnImage', 'wallpaperOwnVideo', 'wallpaperHint']) {
    assert.equal(copy.split(`${key}:`).length - 1, 9, `${key} in nine languages`)
  }
})

test('the summary at the end of the first run names the chosen background', () => {
  const done = read('src/components/Onboarding/OnboardingDoneStep.tsx')
  assert.match(done, /\[copy\.wallpaperLabel, wallpaperChoiceLabel\(wallpaper, copy\)\]/)

  const picker = read('src/components/Onboarding/OnboardingWallpaperPicker.tsx')
  assert.match(picker, /export function wallpaperChoiceLabel/)
  // Own picture and video are named as such; a moving background by its own name.
  assert.match(picker, /config\.mode === 'image' && config\.imageUrl\) return text\.wallpaperOwnImage/)
  assert.match(picker, /config\.mode === 'video' && config\.videoPath\) return text\.wallpaperOwnVideo/)

  const wizard = read('src/components/Onboarding/OnboardingWizard.tsx')
  assert.match(wizard, /weatherLabel=\{\s+weatherLabel\s+\}\s+wallpaper=\{wallpaper\}/)
})
