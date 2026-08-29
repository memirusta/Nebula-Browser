import assert from 'node:assert/strict'
import test from 'node:test'
import { computeAdaptiveLunarSize } from '../src/core/lunarSizing.ts'
import {
  BROWSING_LUNAR_CHROME_PADDING,
  browsingChromeBelowTitlePx,
} from '../src/core/windowChrome.ts'

test('adaptive Semi-Lunar grows substantially for large tab sessions', () => {
  assert.deepEqual(computeAdaptiveLunarSize(10, 1100, 152), {
    width: 1100,
    height: 152,
  })
  assert.deepEqual(computeAdaptiveLunarSize(50, 1100, 152), {
    width: 1420,
    height: 392,
  })
  assert.deepEqual(computeAdaptiveLunarSize(100, 1100, 152), {
    width: 1780,
    height: 692,
  })
  assert.deepEqual(computeAdaptiveLunarSize(200, 1100, 152), {
    width: 1780,
    height: 720,
  })
})

test('expanded native hitbox tracks every adaptive height increase', () => {
  let previousHeight = computeAdaptiveLunarSize(10, 1100, 152).height

  for (let shortcutCount = 11; shortcutCount <= 120; shortcutCount += 1) {
    const lunar = computeAdaptiveLunarSize(shortcutCount, 1100, 152)
    const hitboxHeight = browsingChromeBelowTitlePx(true, lunar.height, false)

    assert.equal(hitboxHeight, lunar.height + BROWSING_LUNAR_CHROME_PADDING)
    assert.ok(lunar.height >= previousHeight)
    if (previousHeight < 720) {
      assert.ok(lunar.height > previousHeight)
    }
    previousHeight = lunar.height
  }
})
