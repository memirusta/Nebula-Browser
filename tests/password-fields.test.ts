import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PASSWORD_FIELD_DETECTION_SOURCE } from '../src/core/passwordFieldDetection.ts'
import {
  PASSWORD_HOOK_VERSION,
  buildPasswordBridgeTickScript,
  buildPasswordFillScript,
} from '../src/core/passwordBridgeScript.ts'
import { accountForPasswordChange } from '../src/core/passwordMatch.ts'
import {
  SAVE_FORM_GONE_TICKS,
  SAVE_SETTLE_MS,
  settleSaveDraft,
} from '../src/core/passwordSaveSettle.ts'

const squash = (text: string) => text.replace(/\s+/g, ' ').trim()
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('every injected script finds credential fields with the same source text', () => {
  const rust = squash(read('../src-tauri/src/site_ui.rs'))
  assert.ok(
    rust.includes(squash(PASSWORD_FIELD_DETECTION_SOURCE)),
    'site_ui.rs must carry PASSWORD_FIELD_DETECTION_SOURCE verbatim',
  )
  assert.ok(squash(buildPasswordBridgeTickScript()).includes(squash(PASSWORD_FIELD_DETECTION_SOURCE)))
  assert.ok(
    squash(buildPasswordFillScript('user', 'secret')).includes(squash(PASSWORD_FIELD_DETECTION_SOURCE)),
  )
  // The text has to fit a TypeScript template literal and a Rust raw string.
  assert.doesNotMatch(PASSWORD_FIELD_DETECTION_SOURCE, /[\\"`]|\$\{/)
  assert.ok(PASSWORD_HOOK_VERSION >= 9, 'a changed bridge script needs a new hook version to be re-injected')
})

test('the native submit capture no longer has detection rules of its own', () => {
  const rust = read('../src-tauri/src/site_ui.rs')
  assert.doesNotMatch(rust, /function isVisibleInput/)
  assert.match(rust, /const passwordInput = findPasswordToSave\(\)/)
  assert.match(rust, /findUsernameFor\(passwordInput\)/)
})

test('a login is offered for saving only after the sign-in form is gone', () => {
  const staged = { stagedAt: 1_000, formGoneTicks: 0 }

  // The form is still on screen right after the submit: wait.
  assert.deepEqual(settleSaveDraft(staged, true, 3_000), { action: 'wait', formGoneTicks: 0 })

  // Gone once is not enough (the page may only be reloading), gone twice in a row is.
  const first = settleSaveDraft(staged, false, 5_000)
  assert.equal(first.action, 'wait')
  assert.equal(first.formGoneTicks, 1)
  const second = settleSaveDraft({ ...staged, formGoneTicks: first.formGoneTicks }, false, 7_000)
  assert.equal(second.action, 'show')
  assert.equal(SAVE_FORM_GONE_TICKS, 2)

  // The form comes back after a blink: the count starts again.
  assert.equal(settleSaveDraft({ ...staged, formGoneTicks: 1 }, true, 6_000).formGoneTicks, 0)

  // A form that never went away was a failed sign-in: nothing is offered.
  assert.equal(settleSaveDraft(staged, true, 1_000 + SAVE_SETTLE_MS).action, 'drop')
  assert.equal(settleSaveDraft(staged, true, 1_000 + SAVE_SETTLE_MS - 1).action, 'wait')
})

test('a password change without an account field belongs to the one saved account of the site', () => {
  const entry = (id: string, username: string, url = 'https://shop.example.com/login') => ({
    id,
    label: 'Shop',
    url,
    username,
    password: 'old',
  })
  assert.equal(
    accountForPasswordChange([entry('a', 'me@example.com')], 'https://shop.example.com/account/password'),
    'me@example.com',
  )
  // Two accounts: there is no way to tell which one changed.
  assert.equal(
    accountForPasswordChange(
      [entry('a', 'me@example.com'), entry('b', 'other@example.com')],
      'https://shop.example.com/account/password',
    ),
    null,
  )
  // Another site's account is never used.
  assert.equal(
    accountForPasswordChange([entry('a', 'me@example.com', 'https://other.example.org/')], 'https://shop.example.com/'),
    null,
  )
  assert.equal(accountForPasswordChange([], 'https://shop.example.com/'), null)
})

test('the password bridge hook keeps dismissals per site and stays out of private tabs', () => {
  const hook = read('../src/hooks/usePasswordBridge.ts')
  const shell = read('../src/components/BrowserShell/BrowserShell.tsx')

  // Dismissed per tab and site, and not wiped when the address or the tab changes.
  assert.match(hook, /function dismissKey\(tabId: string, pageUrl: string\)/)
  assert.doesNotMatch(hook, /dismissedFillRef\.current\.set\(pageUrl/)
  assert.doesNotMatch(hook, /dismissedFillRef\.current\.get\(pageUrl/)
  assert.match(hook, /\[activeTabId\]\)/)
  const tabEffect = hook.slice(hook.indexOf('}, [activeTabId])') - 400, hook.indexOf('}, [activeTabId])'))
  assert.doesNotMatch(tabEffect, /dismissedFillRef\.current\.clear\(\)/)

  // A filled document is not offered again, but a reload (a new document id) brings the offer back; only a
  // dismissal is remembered across reloads.
  assert.ok(hook.includes('filledDocRef.current.set(shortcutId, docIdRef.current)'))
  assert.ok(hook.includes('filledDocRef.current.get(tabId) === poll.docId'))
  assert.doesNotMatch(hook, /dismissedFillRef.current.delete/)
  assert.match(read('../src/core/passwordBridgeScript.ts'), /var DOC_ID = /)

  // The save offer waits for the settle decision.
  assert.match(hook, /settleSaveDraft\(/)
  assert.doesNotMatch(
    hook,
    /if \(!nextOffer && saveDraftRef\.current\)/,
    'a staged login must not turn into an offer before the sign-in form is gone',
  )

  // Private tabs: nothing is staged.
  assert.match(hook, /if \(!savingAllowedRef\.current\) return false/)
  assert.match(shell, /savingAllowed:\s*activeTab\?\.isPrivate !==\s*true/)
})
