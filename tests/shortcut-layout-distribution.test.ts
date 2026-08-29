import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDefaultPositions,
  createLunarMetrics,
  getMinCenterDist,
  mergeShortcutPositions,
  type ShortcutPosition,
} from '../src/core/shortcutLayout.ts'
import { isIconDiscInsideLunarDome } from '../src/core/lunarShape.ts'

const iconSize = 44
const metrics = createLunarMetrics(1780, 692)
const ids = Array.from({ length: 100 }, (_, index) => `tab-${index}`)

function assertSpreadAcrossLunar(positions: ShortcutPosition[]) {
  const minimumDistance = getMinCenterDist(iconSize) - 1

  assert.equal(positions.length, ids.length)
  for (const position of positions) {
    assert.equal(
      isIconDiscInsideLunarDome(position.x, position.y, iconSize / 2, metrics),
      true,
    )
  }

  for (let index = 0; index < positions.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < positions.length; otherIndex += 1) {
      const distance = Math.hypot(
        positions[index].x - positions[otherIndex].x,
        positions[index].y - positions[otherIndex].y,
      )
      assert.ok(distance >= minimumDistance - 0.01)
    }
  }

  const xs = positions.map((position) => position.x)
  const ys = positions.map((position) => position.y)
  assert.ok(Math.min(...xs) < metrics.w * 0.2)
  assert.ok(Math.max(...xs) > metrics.w * 0.8)
  assert.ok(Math.min(...ys) < metrics.h * 0.25)
  assert.ok(Math.max(...ys) > metrics.h * 0.75)
}

function assertCompactPair(positions: ShortcutPosition[]) {
  assert.equal(positions.length, 2)
  const distance = Math.hypot(
    positions[0].x - positions[1].x,
    positions[0].y - positions[1].y,
  )
  const minimumDistance = getMinCenterDist(iconSize) - 1
  assert.ok(distance >= minimumDistance - 0.01)
  assert.ok(distance <= getMinCenterDist(iconSize) * 1.5)
}

test('a second tab opens in the nearest safe slot instead of the far edge', () => {
  const first = buildDefaultPositions(['tab-0'], metrics, iconSize)

  assertCompactPair(
    mergeShortcutPositions(['tab-0', 'tab-1'], first, iconSize, metrics),
  )
  assertCompactPair(buildDefaultPositions(['tab-0', 'tab-1'], metrics, iconSize))
})

test('one hundred overlapping tabs spread across the adaptive Semi-Lunar', () => {
  const stored = ids.map((id) => ({
    id,
    x: metrics.cx,
    y: metrics.h,
  }))

  assertSpreadAcrossLunar(mergeShortcutPositions(ids, stored, iconSize, metrics))
})

test('one hundred freshly restored tabs start with a collision-free spread', () => {
  assertSpreadAcrossLunar(buildDefaultPositions(ids, metrics, iconSize))
})
