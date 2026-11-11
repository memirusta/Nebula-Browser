import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { clipTutorialTarget, tutorialCardPosition, tutorialStepIndex } from '../src/core/tutorialLayout.ts'

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

test('the tutorial is a bubble with a ring, dots and a plain skip, in the colours of the theme; the hooks of the smoke test remain', () => {
  const tsx = readFileSync(new URL('../src/components/GuidedTutorial/GuidedTutorial.tsx', import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))
  assert.match(tsx, /className=\{styles\.bubble\}/)
  assert.match(tsx, /data-side=\{card\.side\}/)
  assert.match(tsx, /data-tutorial-step=\{safeStep\}/)
  assert.match(tsx, /data-target=\{current\.target\}/)
  assert.match(tsx, /<nav className=\{styles\.dots\}/)
  assert.doesNotMatch(tsx, /styles\.scrim/)
})
