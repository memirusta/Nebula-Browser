import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { runCompatibilityTrial, type CompatibilityTrialSteps } from '../src/core/compatibilityTrial.ts'
import { SITE_COMPATIBILITY_LANGUAGES, siteCompatibilityCopy } from '../src/core/siteCompatibilityCopy.ts'

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').split(String.fromCharCode(13, 10)).join(String.fromCharCode(10))

function steps(options: { loads: boolean; keep?: boolean; failNavigate?: boolean }) {
  const log: string[] = []
  const stand: CompatibilityTrialSteps = {
    addException: async () => void log.push('off'),
    removeException: async () => void log.push('on'),
    navigate: async () => {
      log.push('navigate')
      if (options.failNavigate) throw new Error('navigation failed')
    },
    showsTheSite: async () => {
      log.push('wait')
      return options.loads
    },
    askToKeep: async () => {
      log.push('ask')
      return options.keep ?? true
    },
    tellItDidNotHelp: async () => void log.push('told'),
  }
  return { log, stand }
}

test('a site that loads without the protections is kept off only if the person says so', async () => {
  const kept = steps({ loads: true, keep: true })
  assert.equal(await runCompatibilityTrial(kept.stand), 'kept')
  assert.deepEqual(kept.log, ['off', 'navigate', 'wait', 'ask'])

  const declined = steps({ loads: true, keep: false })
  assert.equal(await runCompatibilityTrial(declined.stand), 'reverted')
  assert.deepEqual(declined.log, ['off', 'navigate', 'wait', 'ask', 'on'])
})

test('a site that does not load even without them gets the protections back at once, and the person is told', async () => {
  const failed = steps({ loads: false })
  assert.equal(await runCompatibilityTrial(failed.stand), 'did-not-help')
  assert.deepEqual(failed.log, ['off', 'navigate', 'wait', 'on', 'told'])
})

test('an error during the trial never leaves the protections off', async () => {
  const broken = steps({ loads: true, failNavigate: true })
  await assert.rejects(runCompatibilityTrial(broken.stand), /navigation failed/)
  assert.deepEqual(broken.log, ['off', 'navigate', 'on'])
})

test('the words of the retry are in nine languages and name the site', () => {
  assert.deepEqual([...SITE_COMPATIBILITY_LANGUAGES].sort(), ['de', 'en', 'es', 'fr', 'id', 'it', 'ja', 'ru', 'tr'])
  for (const locale of SITE_COMPATIBILITY_LANGUAGES) {
    const copy = siteCompatibilityCopy(locale, 'chess.com')
    assert.ok(copy.worked.includes('chess.com') && copy.didNotHelp.includes('chess.com'), locale)
    assert.ok(copy.keepOff && copy.backOn, locale)
    assert.doesNotMatch(copy.worked + copy.didNotHelp, /[{}]/, locale)
  }
  assert.equal(siteCompatibilityCopy('xx', 'a.test').keepOff, siteCompatibilityCopy('en', 'a.test').keepOff)
})

test('a connection reset no longer opens a dialog by itself: the error page has a button, and the window runs the trial', () => {
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  const native = read('src-tauri/src/tab_error_page.rs')

  // The page shows no prompt of its own any more: the native side only emits the request when the page's button asks.
  assert.equal(native.split('emit_compatibility_request(').length - 1, 3, 'its definition, the message handler and nothing else')
  assert.doesNotMatch(native, /emit_compatibility_request\(\s+&app_for_handler/)
  assert.match(native, /handle_compat_message\(&message_app, &message_label, &raw\)/)
  // Only a message from the page Nebula built counts, and the address comes from Nebula, not from the message.
  assert.match(native, /!source\.starts_with\("data:text\/html"\)\s+\|\| !top_level\.starts_with\("data:text\/html"\)/)
  assert.match(native, /let Some\(\(url, status\)\) = compat_page_for\(code\)/)

  // The window turns the protections off, loads the site again, and decides from what the tab shows.
  assert.match(shell, /void runCompatibilityTrial\(\{/)
  assert.match(shell, /await waitForTabLoadToFinish\(shortcutId\)/)
  assert.match(shell, /await readBrowseTabCurrentUrl\(shortcutId\)/)
  assert.doesNotMatch(shell, /now - promptedAt < 5 \* 60_000/)
})
