import assert from 'node:assert/strict'
import test from 'node:test'
import { panelColumns, panelLeft, panelWidth, primaryExtensionAction } from '../src/core/extensionTile.ts'

const base = { enabled: true, primaryView: null, needsActionHost: false, hasSidePanel: false, hasOptions: false } as const

test('an icon click runs the extension the way its toolbar icon would', () => {
  assert.equal(primaryExtensionAction({ ...base, primaryView: 'popup', hasOptions: true }), 'popup')
  assert.equal(primaryExtensionAction({ ...base, primaryView: 'side-panel', needsActionHost: true }), 'side-panel')
  // Claude: an action without a popup and without a packaged side panel.
  assert.equal(primaryExtensionAction({ ...base, needsActionHost: true }), 'click')
  assert.equal(primaryExtensionAction({ ...base, hasSidePanel: true, hasOptions: true }), 'side-panel')
  assert.equal(primaryExtensionAction({ ...base, hasOptions: true }), 'options')
})

test('a disabled extension or one with nothing to open has no primary action', () => {
  assert.equal(primaryExtensionAction({ ...base, enabled: false, primaryView: 'popup' }), null)
  assert.equal(primaryExtensionAction({ ...base, enabled: false, needsActionHost: true }), null)
  assert.equal(primaryExtensionAction(base), null)
})

test('the box starts small and widens with each extension, then grows downward', () => {
  assert.equal(panelColumns(0), 1)
  assert.equal(panelColumns(3), 3)
  assert.equal(panelColumns(40), 6)
  const widths = [0, 1, 2, 3, 4, 5, 6, 7, 40].map(count => panelWidth(count))
  for (let index = 1; index < widths.length; index++) assert.ok(widths[index] >= widths[index - 1], `${widths}`)
  assert.equal(panelWidth(0), 150, 'never narrower than its header buttons need')
  assert.equal(panelWidth(6), panelWidth(40), 'width stops at six columns')
  assert.ok(panelWidth(40) < 260, 'a handful of logos stays a small box')
  assert.ok(panelWidth(13) > panelWidth(3), 'more extensions, wider box')
})

test('open details give the box room for their text, then it shrinks back', () => {
  assert.equal(panelWidth(3, true), 280)
  assert.equal(panelWidth(3, false), 150)
  assert.ok(panelWidth(40, true) >= panelWidth(40, false))
})

test('the box sits under its button and stays inside the window', () => {
  assert.equal(panelLeft(500, 300, 1900), 500)
  assert.equal(panelLeft(1800, 300, 1900), 1588, 'pushed back inside the right edge')
  assert.equal(panelLeft(-40, 300, 1900), 12, 'pushed inside the left edge')
  assert.equal(panelLeft(null, 300, 1000), 350, 'centred without an anchor')
  assert.equal(panelLeft(500, 900, 600), 12, 'a box wider than the window starts at the margin')
})
