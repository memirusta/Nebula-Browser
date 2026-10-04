import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('text typed in the address field survives the window losing focus', () => {
  const home = read('src/components/HomeCenter/HomeCenter.tsx')
  // When only the window loses focus (Alt+Tab, another app) the field stays the document's active element;
  // editing must not end then, or the sync effect puts the page address over what was typed.
  assert.match(home, /document\.activeElement === input/)
  assert.match(home, /windowLostFocusWhileEditingRef/)
  // Coming back must not select the text: the next key would replace it.
  const onFocus = home.slice(home.indexOf('onFocus={(event)'), home.indexOf('onBlur={(event)'))
  assert.ok(onFocus.indexOf('windowLostFocusWhileEditingRef.current') < onFocus.indexOf('.select()'))
  // Moving focus inside the page still ends editing.
  assert.match(home, /setIsEditing\(false\)/)
})
