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

test('the address field completes an address after the typed text and shows what matched in bold', () => {
  const home = read('src/components/HomeCenter/HomeCenter.tsx')
  // The completion belongs to exactly the text it was computed for; anything else ignores it.
  assert.match(home, /completion\.typed === query/)
  // It is shown selected after the typed text, so the next key replaces it and Backspace removes it.
  assert.match(home, /setSelectionRange\(\s*query\.length,\s*query\.length \+ activeCompletion\.rest\.length/)
  // Only characters added at the end complete: never delete, a paste in the middle, or an input method.
  assert.match(home, /inputType\.startsWith\('insert'\)/)
  assert.match(home, /!native\.isComposing/)
  // Enter takes the completion when no row is chosen.
  assert.match(home, /activeCompletion\)\s*\{\s*;\(onSearchNavigate \?\? onNavigate\)\(activeCompletion\.url\)/)
  // The matches are marked in the rows, without styling the title text as a muted subtitle.
  assert.match(home, /<Highlighted/)
  const css = read('src/components/HomeCenter/HomeCenter.module.css')
  assert.match(css, /\.suggestionMatch\s*\{[^}]*font-weight:\s*700/)
})

test('suggestion icons come from the icons sites gave when visited, kept on this machine, never from a third party', () => {
  const home = read('src/components/HomeCenter/HomeCenter.tsx')
  assert.match(home, /cachedFaviconForUrl\(url\)/)
  assert.doesNotMatch(home, /google\.com\/s2\/favicons/)
  // The icon a tab reports is remembered from the same event that updates the tab, and never for a private tab.
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  assert.match(shell, /rememberFavicon\(\s*snapshot\.url,\s*snapshot\.favicon,\s*currentTab\?\.isPrivate === true/)
})
