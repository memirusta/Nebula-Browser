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

  // The page shows no prompt of its own: the native side only emits the request when the page's button asks.
  assert.equal(native.split('emit_compatibility_request(').length - 1, 3, 'its definition, the one place that asks for it and nothing else')
  assert.doesNotMatch(native, /emit_compatibility_request\(\s+&app_for_handler/)
  // A page has no channel to the app (window.chrome.webview is masked from every page, error pages included), so the button is a
  // navigation to an address that cannot exist, with the code of its page, seen and cancelled when it starts.
  assert.doesNotMatch(native, /nebula-compat-retry|WebMessageReceived/, 'no message channel that a page could never use')
  assert.match(native, /COMPAT_RETRY_URL: &str = "https:\/\/nebula-compat\.invalid\/retry\?code="/)
  assert.match(native, /location\.href = \{compat_url_js\}/)
  assert.match(native, /let Some\(\(url, status\)\) = compat_page_for\(code\)/, 'the failed address comes from Nebula, not from the address')
  const privacy = read('src-tauri/src/webview_privacy.rs')
  const at = privacy.indexOf('handle_compat_navigation(')
  assert.ok(at > 0)
  assert.match(privacy.slice(at, at + 400), /args\.SetCancel\(true\)\?;\s*return Ok\(\(\)\);/, 'the navigation is always cancelled')

  // The window turns the protections off, loads the site again, and decides from what the tab shows.
  assert.match(shell, /void runCompatibilityTrial\(\{/)
  assert.match(shell, /await waitForTabLoadToFinish\(shortcutId\)/)
  assert.match(shell, /await readBrowseTabCurrentUrl\(shortcutId\)/)
  assert.doesNotMatch(shell, /now - promptedAt < 5 \* 60_000/)
})
