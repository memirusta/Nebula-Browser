import assert from 'node:assert/strict'
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
