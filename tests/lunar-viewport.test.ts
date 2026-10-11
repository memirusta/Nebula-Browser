import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { computeViewportLunarSize, isUsableLunarViewport } from '../src/core/lunarSizing.ts'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

test('a minimized or half-restored client size is not one to fit the dome to', () => {
  assert.equal(isUsableLunarViewport(0, 0), false, 'minimized')
  assert.equal(isUsableLunarViewport(160, 28), false, 'the collapsed window frame')
  assert.equal(isUsableLunarViewport(1920, 10), false, 'the height of the strip is not the height of the window')
  assert.equal(isUsableLunarViewport(Number.NaN, 900), false)
  assert.equal(isUsableLunarViewport(1920, 1032), true)
  assert.equal(isUsableLunarViewport(1000, 700), true)
  // What using such a size does: the dome shrinks to a sliver.
  const sliver = computeViewportLunarSize(1, 1, 560, 160)
  assert.ok(sliver.width <= 1 && sliver.height <= 1)
})

test('the dome keeps the last real size: only the newest answer counts and unusable sizes are skipped', () => {
  const menu = read('src/components/SemiLunarMenu/SemiLunarMenu.tsx')
  const start = menu.indexOf('const syncTauriViewport = async')
  assert.ok(start > 0)
  const body = menu.slice(start, menu.indexOf('if (!isTauri) {', start))
  assert.ok(body.includes('request !== latestRequest'), 'out-of-order answers are dropped')
  assert.ok(body.includes('isUsableLunarViewport(width, height)'), 'unusable sizes are skipped')
  // It looks again after a restore settles and when the window gets focus back.
  const effect = menu.slice(start, menu.indexOf('const { width: lunarWidthPx', start))
  assert.ok(effect.includes('onFocusChanged'))
  assert.ok(effect.includes('setTimeout(() => void syncTauriViewport(), 350)'))
  // The chrome strip's own DOM height must not be used as the window's height.
  assert.ok(body.includes('usesDedicatedChromeSurface'))
})
