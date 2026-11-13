import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { clipTutorialTarget, tutorialAvoidArea, tutorialCardPosition, tutorialCardsFit, tutorialStatementCard, tutorialStepIndex, TUTORIAL_BUBBLE_WIDTH } from '../src/core/tutorialLayout.ts'

test('tutorial clips partial targets and does not highlight missing screen areas', () => {
  const target = { left: 780, top: 560, width: 60, height: 100, radius: 20 }
  assert.deepEqual(clipTutorialTarget(target, 800, 600), { ...target, width: 20, height: 40 })
  assert.equal(clipTutorialTarget({ ...target, left: 900 }, 800, 600), null)
})

test('tutorial card uses measured height and leaves all navigation inside the viewport', () => {
  for (const width of [320, 600, 1280]) {
    for (const height of [320, 500, 900]) {
      for (const measured of [240, 440, 680]) {
        const card = tutorialCardPosition({ left: width - 70, top: 40, width: 50, height: 200, radius: 24 }, { width, height }, measured)
        assert(card.left >= 16 && card.left + card.width <= width - 16)
        assert(card.top >= 16 && card.top + Math.min(measured, card.maxHeight) <= height - 16)
      }
    }
  }
  const target = { left: 1100, top: 40, width: 50, height: 200, radius: 24 }
  const card = tutorialCardPosition(target, { width: 1280, height: 900 }, 450)
  assert(card.left + card.width < target.left, 'a toolbar with room on the left stays visible')
})

test('invalid or interrupted tutorial steps always select a real step', () => {
  for (const value of [NaN, Infinity, -1]) assert.equal(tutorialStepIndex(value, 4), 0)
  assert.equal(tutorialStepIndex(2.9, 4), 2)
  assert.equal(tutorialStepIndex(20, 4), 3)
})

test('tutorial stays below the native menu even when its contents need scrolling', () => {
  for (const height of [360, 500, 900]) {
    const clearance = Math.floor(height * .72)
    const card = tutorialCardPosition({ left: 0, top: 0, width: 1280, height: 28, radius: 12 },
      { width: 1280, height }, 450, clearance)
    assert(card.top >= clearance + 18)
    assert(card.top + Math.min(450, card.maxHeight) <= height - 16)
  }
})

test('the tutorial bubble says which side of its target it sits on and where its pointer touches it', () => {
  const viewport = { width: 1280, height: 900 }
  // Under the menu at the top: the bubble is below the target, pointing up at its middle.
  const dome = { left: 340, top: 0, width: 600, height: 152, radius: 60 }
  const below = tutorialCardPosition(dome, viewport, 260, 152, 340)
  assert.equal(below.side, 'below')
  assert.equal(below.width, 340)
  assert(below.arrow >= 22 && below.arrow <= below.width - 22)
  assert(Math.abs(below.left + below.arrow - (dome.left + dome.width / 2)) <= 1, 'the pointer is under the middle of the target')
  // A toolbar at the right edge: the bubble sits to its left, pointing right at its middle.
  const toolbar = { left: 1220, top: 40, width: 40, height: 200, radius: 20 }
  const left = tutorialCardPosition(toolbar, viewport, 260, 0, 340)
  assert.equal(left.side, 'left')
  assert(Math.abs(left.top + left.arrow - (toolbar.top + toolbar.height / 2)) <= 1)
  // Where there is no room beside or below, it goes above; with no target it is centred and points at nothing.
  assert.equal(tutorialCardPosition({ left: 100, top: 700, width: 200, height: 160, radius: 20 }, { width: 600, height: 900 }, 300, 0, 340).side, 'above')
  assert.equal(tutorialCardPosition(null, viewport, 260, 0, 340).side, 'free')
  // A narrow window shrinks the bubble instead of overflowing.
  assert.equal(tutorialCardPosition(dome, { width: 300, height: 700 }, 260, 0, 340).width, 268)
})

test('under the menu the bubble sits below it, in the middle, however wide the window is', () => {
  // On a wide window there is room beside the menu, but there the bubble would land on the widgets and aim under the menu.
  for (const width of [1280, 1920, 2560]) {
    const menuWidth = Math.min(width, 1100)
    const menu = { left: (width - menuWidth) / 2, top: 0, width: menuWidth, height: 152, radius: 60 }
    for (const target of [menu, { ...menu, height: 28, radius: 12 }]) {
      const card = tutorialCardPosition(target, { width, height: 1080 }, 260, 152, 340)
      assert.equal(card.side, 'below', `${width}`)
      assert(card.top >= 152 + 18)
      assert(Math.abs(card.left + card.arrow - width / 2) <= 1, 'the pointer is under the middle of the menu')
    }
  }
  // Beside is still right for the toolbar, which has nothing above it.
  assert.equal(tutorialCardPosition({ left: 1830, top: 40, width: 50, height: 200, radius: 24 }, { width: 1920, height: 1080 }, 260, 0, 340).side, 'left')
})

test('cards that would land on one another are told apart from cards that fit together', () => {
  const card = (left: number, top: number) => ({ left, top, width: 340, height: 240 })
  assert.equal(tutorialCardsFit([card(100, 100), card(500, 100), card(100, 400)]), true)
  assert.equal(tutorialCardsFit([card(100, 100), card(300, 200)]), false, 'overlapping')
  assert.equal(tutorialCardsFit([card(100, 100), card(444, 100)]), false, 'closer than the gap')
  assert.equal(tutorialCardsFit([card(100, 100)]), true)
  assert.equal(tutorialCardsFit([]), true)
})

test('the three steps after the first sit apart from one another, and from what the others point at, so that all are on the screen at once', () => {
  for (const [width, height] of [[1680, 1050], [1920, 1080], [2560, 1440]] as const) {
    const menuWidth = Math.min(width, 1100)
    const menu = { left: (width - menuWidth) / 2, top: 0, width: menuWidth, height: 152, radius: 60 }
    const search = { left: width / 2 - 270, top: height * 0.42, width: 540, height: 56, radius: 28 }
    const toolbar = { left: width - 72, top: 40, width: 56, height: 160, radius: 28 }
    const viewport = { width, height }
    const placed = [
      tutorialCardPosition(menu, viewport, 230, 152, 340),
      tutorialCardPosition(search, viewport, 230, 0, 340),
      tutorialCardPosition(toolbar, viewport, 230, 0, 340),
    ]
    const targets = [tutorialAvoidArea(menu, true), search, toolbar]
    const boxes = placed.map((card, index) => ({
      left: card.left, top: card.top, width: card.width, height: 230,
      avoid: targets.filter((_, other) => other !== index),
    }))
    assert.equal(tutorialCardsFit(boxes), true, `${width}x${height}`)
  }
  // The round corners of the menu are not counted, but its body is.
  const body = tutorialAvoidArea({ left: 100, top: 0, width: 1000, height: 152, radius: 60 }, true)
  assert.deepEqual([body.left, body.width], [220, 760])
  assert.deepEqual(tutorialAvoidArea({ left: 100, top: 0, width: 1000, height: 152, radius: 60 }, false).width, 1000)
  // Narrower than that the bubbles would be on the menu or on the field: only the current one is shown.
  {
    const width = 1440
    const menu = { left: 170, top: 0, width: 1100, height: 152, radius: 60 }
    const toolbar = { left: width - 72, top: 40, width: 56, height: 160, radius: 28 }
    const card = tutorialCardPosition(toolbar, { width, height: 900 }, 230, 0, 340)
    assert.equal(tutorialCardsFit([{ left: card.left, top: card.top, width: card.width, height: 230, avoid: [tutorialAvoidArea(menu, true)] }]), false)
  }
  // On a short window the bubble of the menu would cover the search field: then only the current bubble is shown.
  const short = { width: 1280, height: 720 }
  const menu = { left: 90, top: 0, width: 1100, height: 152, radius: 60 }
  const search = { left: 362, top: 296, width: 556, height: 72, radius: 28 }
  const menuCard = tutorialCardPosition(menu, short, 230, 152, 340)
  assert.equal(tutorialCardsFit([{ left: menuCard.left, top: menuCard.top, width: menuCard.width, height: 230, avoid: [search] }]), false)
})

test('all five bubbles after the first fit on a wide window: the menu, the field, the widgets, the buttons and the statement', () => {
  for (const [width, height] of [[1920, 1080], [2560, 1440]] as const) {
    const viewport = { width, height }
    const menuWidth = Math.min(width, 1100)
    const menu = { left: (width - menuWidth) / 2, top: 0, width: menuWidth, height: 152, radius: 60 }
    const search = { left: width / 2 - 278, top: height * 0.41 - 8, width: 556, height: 72, radius: 28 }
    const widgets = { left: 16, top: 210, width: 226, height: 295, radius: 18 }
    const toolbar = { left: width - 76, top: 17, width: 60, height: 175, radius: 28 }
    const places = [
      tutorialCardPosition(menu, viewport, 270, 152, TUTORIAL_BUBBLE_WIDTH),
      tutorialCardPosition(search, viewport, 270, 0, TUTORIAL_BUBBLE_WIDTH, { prefer: 'below' }),
      tutorialCardPosition(widgets, viewport, 270, 0, TUTORIAL_BUBBLE_WIDTH),
      tutorialCardPosition(toolbar, viewport, 270, 0, TUTORIAL_BUBBLE_WIDTH),
    ]
    assert.deepEqual(places.map((card) => card.side), ['below', 'below', 'right', 'left'], `${width}`)
    const statement = tutorialStatementCard(tutorialCardPosition(null, viewport, 270, 0, TUTORIAL_BUBBLE_WIDTH), viewport, 270)
    assert.equal(statement.side, 'free')
    assert(statement.top + 300 <= height - 24 + 1 && statement.left + statement.width === width - 24, 'lower right corner')
    const targets = [tutorialAvoidArea(menu, true), search, widgets, toolbar]
    const boxes = [...places, statement].map((card, index) => ({
      left: card.left, top: card.top, width: card.width, height: 270,
      avoid: targets.filter((_, other) => other !== index),
    }))
    assert.equal(tutorialCardsFit(boxes), true, `${width}x${height}`)
  }
  // Beside the widgets at the left edge the pointer touches the bubble on its left edge, level with the middle of the widgets.
  const widgets = { left: 16, top: 210, width: 226, height: 295, radius: 18 }
  const card = tutorialCardPosition(widgets, { width: 1920, height: 1080 }, 270, 0, TUTORIAL_BUBBLE_WIDTH)
  assert.equal(card.side, 'right')
  assert.equal(card.left, widgets.left + widgets.width + 18)
  assert(Math.abs(card.top + card.arrow - (widgets.top + widgets.height / 2)) <= 1)
})

test('the tutorial is a bubble with a ring, dots and a plain skip, in the colours of the theme; the hooks of the smoke test remain', () => {
  const tsx = readFileSync(new URL('../src/components/GuidedTutorial/GuidedTutorial.tsx', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  assert.match(tsx, /className=\{styles\.bubble\}/)
  assert.match(tsx, /data-side=\{card\?\.side\}/)
  assert.match(tsx, /data-tutorial-step=\{safeStep\}/)
  assert.match(tsx, /data-target=\{current\.target\}/)
  assert.match(tsx, /<nav className=\{styles\.dots\}/)
  assert.doesNotMatch(tsx, /styles\.scrim/)
  // The screen is dimmed except for the target (a hole cast by the spotlight), and wholly when a step has no target.
  assert.match(tsx, /styles\.veil/)
  const css = readFileSync(new URL('../src/components/GuidedTutorial/GuidedTutorial.module.css', import.meta.url), 'utf8')
  assert.match(css, /box-shadow: 0 0 0 100vmax var\(--tour-dim\)/)
  assert.match(css, /--tour-dim: rgba\(0, 0, 0, 0\.7\)/, 'the dimming is neutral, with no colour in it')
  const lunarCss = readFileSync(new URL('../src/components/SemiLunarMenu/SemiLunarMenu.module.css', import.meta.url), 'utf8')
  assert.doesNotMatch(lunarCss, /tutorialEdgeDust/, 'no sparkles on the edge')
  // A filter on an ancestor of the glass's backdrop-filter shows the glass as a lighter rectangle: the tour dims and lights the
  // menu with layers, never with a filter on the menu or on its glass.
  assert.doesNotMatch(lunarCss, /\.tutorialContentHighlight \.lunarGlass\s*\{/)
  assert.doesNotMatch(lunarCss, /\.tutorialDimmed\s*\{[^}]*filter:/)
  assert.match(lunarCss, /\.tutorialDimmed::after\s*\{[^}]*border-radius: 0 0 50% 50% \/ 0 0 100% 100%/)
})

test('the first step of the tour has a button that opens the menu, for someone who cannot hover the top edge', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  const tour = read('src/components/GuidedTutorial/GuidedTutorial.tsx')
  assert.match(tour, /current\.target === 'top-edge' && onToggleMenu && \(\s+<button type="button" className=\{styles\.showButton\} aria-pressed=\{menuShown\} onClick=\{onToggleMenu\}>\{copy\.showMenu\}<\/button>/)
  // The two windows share it: the shell keeps it (and forgets it when the step changes), the chrome overlay opens the menu for it.
  assert.match(read('src/core/nebulaBridge.ts'), /menuShown\?: boolean/)
  assert.ok(read('src/core/tutorialMode.ts').includes("expansion: together || (onEdge && (state.menuShown === true || intro === 'opening')) ? true : null"))
  const copy = read('src/core/tutorial.ts')
  assert.equal(copy.split('showMenu: ').length - 1, 10, 'the type and the nine languages')
})
