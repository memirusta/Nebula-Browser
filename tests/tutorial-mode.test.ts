import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { TUTORIAL_TARGETS, tutorialSurfaces, tutorialTargetAt } from '../src/core/tutorialMode.ts'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

test('with the tour closed nothing is changed, whatever step it was left on', () => {
  for (const step of [0, 1, 2, 3, 99, NaN]) {
    const surfaces = tutorialSurfaces({ open: false, step, menuShown: true })
    assert.equal(surfaces.active, false)
    assert.equal(surfaces.target, null)
    assert.deepEqual(surfaces.semiLunar, { expansion: null, hoverOpen: false, demoTab: false, highlight: null, dimmed: false, slowOpen: false, sweep: false, homeAlwaysOpen: null })
    assert.equal(surfaces.intro, null)
    assert.equal(surfaces.together, false)
    assert.equal(surfaces.toolbarVisible, false)
  }
})

test('the first step lets the pointer open the menu, or its button; the home setting is put aside; it is shown alone', () => {
  const byPointer = tutorialSurfaces({ open: true, step: 0 })
  assert.equal(byPointer.target, 'top-edge')
  assert.deepEqual(byPointer.semiLunar, { expansion: null, hoverOpen: true, demoTab: false, highlight: 'edge', dimmed: false, slowOpen: false, sweep: false, homeAlwaysOpen: false })
  assert.equal(tutorialSurfaces({ open: true, step: 0, menuShown: true }).semiLunar.expansion, true)
  assert.equal(byPointer.together, false)
  assert.equal(byPointer.toolbarVisible, false)
})

test('the other steps are on the screen together: the menu stays open with sample tabs and the buttons stay shown; only the current step is lit', () => {
  for (const step of [1, 2, 3, 4, 5]) {
    const surfaces = tutorialSurfaces({ open: true, step })
    assert.equal(surfaces.together, true, `step ${step}`)
    assert.equal(surfaces.semiLunar.expansion, true, `step ${step}`)
    assert.equal(surfaces.semiLunar.demoTab, true, `step ${step}`)
    assert.equal(surfaces.semiLunar.hoverOpen, false, `step ${step}`)
    assert.equal(surfaces.toolbarVisible, true, `step ${step}`)
    // The menu is a webview of its own, which the window's dimming cannot reach: it dims itself when the step is not about it.
    assert.equal(surfaces.semiLunar.dimmed, surfaces.target !== 'semi-lunar', `step ${step}`)
  }
  assert.equal(tutorialSurfaces({ open: true, step: 1 }).semiLunar.highlight, 'content')
  assert.equal(tutorialSurfaces({ open: true, step: 2 }).semiLunar.highlight, null)
  assert.deepEqual([2, 3, 4, 5].map((step) => tutorialSurfaces({ open: true, step }).target), ['home-search', 'home-widgets', 'home-toolbar', 'shield'])
})

test('the opening scene waits for the pointer, then holds the menu open while it opens slowly and a light runs along it', () => {
  const waiting = tutorialSurfaces({ open: true, step: 0, intro: 'waiting' })
  assert.equal(waiting.intro, 'waiting')
  assert.equal(waiting.semiLunar.hoverOpen, true, 'the pointer at the top still opens the menu')
  assert.equal(waiting.semiLunar.expansion, null)
  assert.equal(waiting.semiLunar.slowOpen, true)
  assert.equal(waiting.semiLunar.sweep, false)
  // Its button opens the menu too, for someone who cannot use the pointer.
  assert.equal(tutorialSurfaces({ open: true, step: 0, intro: 'waiting', menuShown: true }).semiLunar.expansion, true)

  const opening = tutorialSurfaces({ open: true, step: 0, intro: 'opening' })
  assert.equal(opening.intro, 'opening')
  assert.equal(opening.semiLunar.expansion, true)
  assert.equal(opening.semiLunar.slowOpen, true)
  assert.equal(opening.semiLunar.sweep, true)

  // The scene belongs to the first step and to an open tour only.
  assert.equal(tutorialSurfaces({ open: true, step: 1, intro: 'opening' }).intro, null)
  assert.equal(tutorialSurfaces({ open: true, step: 1, intro: 'opening' }).semiLunar.sweep, false)
  assert.equal(tutorialSurfaces({ open: false, step: 0, intro: 'waiting' }).intro, null)
  // Without it, the first step is as it always was.
  assert.equal(tutorialSurfaces({ open: true, step: 0 }).semiLunar.slowOpen, false)
})

test('a step that is not a real one selects the nearest real step', () => {
  assert.equal(tutorialTargetAt(NaN), 'top-edge')
  assert.equal(tutorialTargetAt(-4), 'top-edge')
  assert.equal(tutorialTargetAt(2.9), 'home-search')
  assert.equal(tutorialTargetAt(40), 'shield')
})

test('the words of the tour follow the targets, in every language, and the window asks tutorialSurfaces', () => {
  const copy = read('src/core/tutorial.ts')
  const targets = [...copy.matchAll(/"target": "([a-z-]+)"/g)].map((match) => match[1])
  assert.equal(targets.length, TUTORIAL_TARGETS.length * 9, 'every language has every step')
  for (let index = 0; index < targets.length; index++) {
    assert.equal(targets[index], TUTORIAL_TARGETS[index % TUTORIAL_TARGETS.length], `step ${index % TUTORIAL_TARGETS.length + 1}`)
  }
  // The two windows no longer test step numbers themselves.
  for (const path of ['src/components/BrowserShell/BrowserShell.tsx', 'src/ChromeApp.tsx']) {
    assert.match(read(path), /tutorialSurfaces\(/, path)
    assert.doesNotMatch(read(path), /uided[Tt]utorial(?:Step)?\s*(?:===|>=)\s*\d/, path)
  }
})

test('the opening scene has its sentence in nine languages, starts after the wizard, and is told when the menu opened', () => {
  const copy = read('src/core/tutorial.ts')
  assert.equal(copy.split('introPrompt: ').length - 1, 10, 'the type and the nine languages')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  // It starts when the first-run wizard ends, and only then: the tour started again later has no such scene.
  assert.match(shell, /startGuidedTutorial\(\)\s+setGuidedTutorialStep\(0\)\s+setGuidedTutorialIntro\('waiting'\)/)
  assert.equal(shell.split("setGuidedTutorialIntro('waiting')").length - 1, 1)
  // The menu lives in another webview: it says when it opened, and the shell moves the scene on, then to the tabs.
  assert.match(shell, /case 'tutorial-menu-opened':/)
  assert.match(read('src/ChromeApp.tsx'), /emitChromeAction\(\{ type: 'tutorial-menu-opened' \}\)/)
  assert.match(shell, /setGuidedTutorialIntro\(null\)\s+setGuidedTutorialStep\(1\)/)
  // Skipping or leaving the step ends it, so the tour cannot stay in the scene.
  assert.match(shell, /setGuidedTutorialOpen\(false\)\s+setGuidedTutorialStep\(0\)\s+setGuidedTutorialIntro\(null\)/)
  // The sweep and the slow opening are the menu's; nothing loops and reduced motion turns them off.
  const css = read('src/components/SemiLunarMenu/SemiLunarMenu.module.css')
  assert.match(css, /\.tutorialSweep \{[^}]*animation: tutorialSweep 1300ms/)
  assert.match(css, /prefers-reduced-motion: reduce\) \{[^}]*\.tutorialSweep,\s+\.tutorialSwell \.lunarGlass/)
})

test('a menu that was open when the tour began (the home page keeps it open by default) is closed, so the scene waits for the pointer', () => {
  const menu = read('src/components/SemiLunarMenu/SemiLunarMenu.tsx')
  // Done while rendering, so the check that tells the tour "the menu opened" never sees the open state of before.
  assert.match(menu, /if \(tutorialHoverOpen !== tourWaitsForMenu\) \{\s+setTourWaitsForMenu\(tutorialHoverOpen\)\s+if \(tutorialHoverOpen\) setStage\('closed'\)\s+\}/)
  assert.ok(menu.indexOf('if (tutorialHoverOpen !== tourWaitsForMenu)') < menu.indexOf("if (tutorialHoverOpen && stage === 'expanded') onTutorialMenuOpenedRef"))
})

test('the tour can be started again from Settings > About, from the home page and without the opening scene', () => {
  const about = read('src/components/SettingsPanel/AboutUpdateSection.tsx')
  assert.match(about, /onClick=\{onStartTutorial\}/)
  assert.match(about, /getTutorialCopy\(locale\)/, 'its words are the tour\'s own, in nine languages')
  const panel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /<AboutUpdateSection onStartTutorial=\{onStartTutorial\} \/>/)
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  assert.match(shell, /closeSettings\(\)\s+goHome\(\)\s+startGuidedTutorial\(\)\s+setGuidedTutorialStep\(0\)\s+setGuidedTutorialIntro\(null\)/)
  assert.match(shell, /onStartTutorial=\{\s+handleStartGuidedTutorial\s+\}/)
  // The scene is for the first time only: this is the only place that sets it.
  assert.equal(shell.split("setGuidedTutorialIntro('waiting')").length - 1, 1)
})

test('the sample tabs of the tour can be dragged about inside the menu, and the words of the tour are larger', () => {
  const menu = read('src/components/SemiLunarMenu/SemiLunarMenu.tsx')
  assert.match(menu, /onPointerDown=\{\(event\) => \{\s+event\.currentTarget\.setPointerCapture\(event\.pointerId\)/)
  assert.match(menu, /setDemoOffsets\(/)
  // They stay inside the menu: the offset is limited by the distance from where the tab starts to each edge.
  assert.match(menu, /const limitX = area \? \[24 - startX, area\.width - 24 - startX\]/)
  const css = read('src/components/GuidedTutorial/GuidedTutorial.module.css')
  assert.match(css, /\.body p \{[^}]*font-size: 14\.5px/)
  assert.match(css, /\.actionHint \{[^}]*font-size: 13\.5px/)
})

test('the four sample tabs of the tour carry their own icons: nothing is asked of a favicon service or of the sites', async () => {
  const { TUTORIAL_DEMO_ICONS } = await import('../src/core/tutorialDemoIcons.ts')
  const { isPlaceholderFavicon, usableStoredFavicon } = await import('../src/core/faviconPlaceholder.ts')
  assert.deepEqual(Object.keys(TUTORIAL_DEMO_ICONS).sort(), ['github', 'netflix', 'wikipedia', 'youtube'])
  for (const [name, source] of Object.entries(TUTORIAL_DEMO_ICONS)) {
    assert.ok(source.startsWith('data:image/svg+xml;charset=utf-8,'), name)
    assert.equal(isPlaceholderFavicon(source), false, `${name} is a drawn icon, not the letter that stands in for a missing one`)
    assert.equal(usableStoredFavicon(source), source, `${name} counts as an icon that was given`)
    assert.ok(source.length < 4000, name)
  }
  const menu = read('src/components/SemiLunarMenu/SemiLunarMenu.tsx')
  assert.doesNotMatch(menu, /faviconForUrl/)
  assert.equal(menu.split('TUTORIAL_DEMO_ICONS.').length - 1, 4)
})
