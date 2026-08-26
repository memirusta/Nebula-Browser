import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { fitContextMenuPosition } from '../src/core/contextMenuPosition.ts'

test('Semi-Lunar context menu flips and clamps inside the visual viewport', () => {
  assert.deepEqual(
    fitContextMenuPosition({
      anchorX: 790,
      anchorY: 590,
      menuWidth: 246,
      menuHeight: 250,
      viewportWidth: 800,
      viewportHeight: 600,
    }),
    { left: 544, top: 340 },
  )

  assert.deepEqual(
    fitContextMenuPosition({
      anchorX: 90,
      anchorY: 70,
      menuWidth: 246,
      menuHeight: 250,
      viewportWidth: 120,
      viewportHeight: 100,
    }),
    { left: 8, top: 8 },
  )
})

test('a replacement right-click keeps the native menu surface mounted', () => {
  const menuSource = readFileSync(
    new URL('../src/components/SemiLunarMenu/ShortcutContextMenu.tsx', import.meta.url),
    'utf8',
  )
  const lunarSource = readFileSync(
    new URL('../src/components/SemiLunarMenu/SemiLunarMenu.tsx', import.meta.url),
    'utf8',
  )

  assert.match(menuSource, /if \(e\.button === 2\) return/)
  assert.match(menuSource, /window\.visualViewport/)
  assert.match(menuSource, /new ResizeObserver\(positionMenu\)/)
  assert.match(lunarSource, /requestId: contextMenuRequestIdRef\.current/)

  const expansionEffect = lunarSource.slice(
    lunarSource.indexOf('contextMenu.y + 200') - 260,
    lunarSource.indexOf('contextMenu.y + 200') + 620,
  )
  assert.doesNotMatch(expansionEffect, /return \(\) =>/)
})
