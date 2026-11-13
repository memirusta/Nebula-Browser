import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { PASSWORD_FIELD_DETECTION_SOURCE } from '../src/core/passwordFieldDetection.ts'
import {
  buildPasswordSaveScript,
  buildPasswordSuggestScript,
  entryForPickedAccount,
  suggestionAccounts,
} from '../src/core/passwordSuggest.ts'
import type { SavedPassword } from '../src/core/passwordVault.ts'

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const squash = (text: string) => text.replace(/\s+/g, ' ').trim()

interface View {
  open: boolean
  rows: { name: string; at: number; length: number }[]
  active: number
}
interface Step extends View {
  pick: string | null
  consumed: boolean
}
interface Engine {
  suggestionRows(accounts: string[], typed: string): View['rows']
  nextView(view: View, event: string, accounts: string[], typed: string): Step
  VISIBLE_ROWS: number
}

const scriptSource = read('../src-tauri/src/site_scripts/password_suggest.js')
const sandbox = { module: { exports: {} as unknown } }
vm.runInNewContext(scriptSource, sandbox)
const engine = sandbox.module.exports as Engine

const ACCOUNTS = ['me@example.com', 'is@example.com', 'ayse.k@example.com', 'kemal.kaya@example.com']
const CLOSED: View = { open: false, rows: [], active: -1 }
// The engine runs in its own realm; plain JSON copies compare by value.
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const names = (view: View) => plain(view.rows.map((row) => row.name))

test('a click on an empty box opens the whole list', () => {
  const view = engine.nextView(CLOSED, 'open', ACCOUNTS, '')
  assert.equal(view.open, true)
  assert.deepEqual(names(view), ACCOUNTS)
  assert.equal(view.active, -1)
})

test('typing the start of a saved account narrows the list to it', () => {
  const opened = engine.nextView(CLOSED, 'open', ACCOUNTS, '')
  const narrowed = engine.nextView(opened, 'input', ACCOUNTS, 'ay')
  // The account that starts with the text comes first; one that only contains it follows.
  assert.deepEqual(names(narrowed), ['ayse.k@example.com', 'kemal.kaya@example.com'])
  assert.equal(narrowed.open, true)
  assert.deepEqual(plain(narrowed.rows[0]), { name: 'ayse.k@example.com', at: 0, length: 2 })
  assert.equal(narrowed.rows[1].at, 'kemal.kaya@example.com'.indexOf('ay'))
  // Accents and capitals do not matter.
  assert.deepEqual(names(engine.nextView(CLOSED, 'input', ['Işık@example.com'], 'ISIK')), ['Işık@example.com'])
})

test('typing something that is none of the accounts closes the list, and emptying the box does not bring it back by itself', () => {
  const opened = engine.nextView(CLOSED, 'open', ACCOUNTS, '')
  const foreign = engine.nextView(opened, 'input', ACCOUNTS, 'zz')
  assert.equal(foreign.open, false)
  assert.deepEqual(plain(foreign.rows), [])

  // Deleting all of it: still closed while the person is typing or deciding...
  const emptied = engine.nextView(foreign, 'input', ACCOUNTS, '')
  assert.equal(emptied.open, false)
  // ...and the next click on the empty box opens the whole list again.
  const clicked = engine.nextView(emptied, 'open', ACCOUNTS, '')
  assert.equal(clicked.open, true)
  assert.deepEqual(names(clicked), ACCOUNTS)

  // A box that still holds something that is none of the accounts stays closed when clicked.
  assert.equal(engine.nextView(CLOSED, 'open', ACCOUNTS, 'zz').open, false)
})

test('backspacing from a foreign text into the start of an account opens the list again', () => {
  const foreign = engine.nextView(CLOSED, 'input', ACCOUNTS, 'ayx')
  assert.equal(foreign.open, false)
  assert.deepEqual(names(engine.nextView(foreign, 'input', ACCOUNTS, 'ay')), ['ayse.k@example.com', 'kemal.kaya@example.com'])
})

test('an account that is exactly what is typed is not offered again', () => {
  assert.equal(engine.nextView(CLOSED, 'open', ACCOUNTS, 'me@example.com').open, false)
  assert.equal(engine.nextView(CLOSED, 'input', ACCOUNTS, 'ME@example.com').open, false)
  assert.deepEqual(names(engine.nextView(CLOSED, 'input', ACCOUNTS, 'me@')), ['me@example.com'])
})

test('the keyboard moves through the list, and Enter only chooses a row that was moved to', () => {
  const opened = engine.nextView(CLOSED, 'open', ACCOUNTS, '')
  const enterFirst = engine.nextView(opened, 'enter', ACCOUNTS, '')
  assert.equal(enterFirst.pick, null, 'Enter submits the form as usual')
  assert.equal(enterFirst.consumed, false)
  assert.equal(enterFirst.open, true)

  const down = engine.nextView(opened, 'down', ACCOUNTS, '')
  assert.equal(down.active, 0)
  assert.equal(down.consumed, true)
  const second = engine.nextView(down, 'down', ACCOUNTS, '')
  assert.equal(second.active, 1)
  const chosen = engine.nextView(second, 'enter', ACCOUNTS, '')
  assert.equal(chosen.pick, 'is@example.com')
  assert.equal(chosen.open, false)

  // Up from the first row wraps to the last; down from the last wraps to the first.
  assert.equal(engine.nextView(down, 'up', ACCOUNTS, '').active, ACCOUNTS.length - 1)
  const last = { ...opened, active: ACCOUNTS.length - 1 }
  assert.equal(engine.nextView(last, 'down', ACCOUNTS, '').active, 0)

  // Down on a closed list opens it with the first row ready; Escape closes it and is used up only when open.
  const fromClosed = engine.nextView(CLOSED, 'down', ACCOUNTS, '')
  assert.equal(fromClosed.open, true)
  assert.equal(fromClosed.active, 0)
  assert.equal(engine.nextView(opened, 'escape', ACCOUNTS, '').open, false)
  assert.equal(engine.nextView(CLOSED, 'escape', ACCOUNTS, '').consumed, false)
})

test('the list follows accounts that arrive or change while it is open', () => {
  const opened = engine.nextView(CLOSED, 'open', ACCOUNTS, '')
  const fewer = engine.nextView(opened, 'accounts', ['me@example.com'], '')
  assert.deepEqual(names(fewer), ['me@example.com'])
  assert.equal(engine.nextView(opened, 'accounts', [], '').open, false)
  // A closed list stays closed when accounts arrive: opening is the page's decision.
  assert.equal(engine.nextView(CLOSED, 'accounts', ACCOUNTS, '').open, false)
  assert.equal(engine.nextView(opened, 'blur', ACCOUNTS, '').open, false)
})

test('a long list is scrolled, not stretched', () => {
  assert.equal(engine.VISIBLE_ROWS, 5)
  const many = Array.from({ length: 30 }, (_, index) => `user${index}@example.com`)
  const view = engine.nextView(CLOSED, 'open', many, '')
  assert.equal(view.rows.length, 30, 'every account is reachable')
  assert.equal(engine.nextView(CLOSED, 'input', many, 'user2').rows.length, 11, 'user2, user20..user29')
  assert.match(scriptSource, /max-height: ' \+ VISIBLE_ROWS \* 44/)
})

test('the page script carries the shared field detection verbatim and keeps passwords out of the page', () => {
  assert.ok(squash(scriptSource).includes(squash(PASSWORD_FIELD_DETECTION_SOURCE)))
  // Text typed into a password box is never read for matching.
  assert.match(scriptSource, /fieldKind === 'username' \? String\(field\.value/)
  // The page can neither replace the function that receives the accounts nor read the list.
  assert.match(scriptSource, /define\('__nebulaPasswordSuggest', receive\)/)
  assert.match(scriptSource, /configurable: false/)
  assert.match(scriptSource, /mode: 'closed'/)
  // Only real clicks and keys choose an account.
  assert.match(scriptSource, /if \(event\.isTrusted\) choose\(/)
  assert.match(scriptSource, /keydown', function \(event\) \{\s*if \(!event\.isTrusted/)
  // The web view's own "Saved info" list is kept away by marking the form, never the field the detection reads.
  assert.match(scriptSource, /form\.setAttribute\('autocomplete', 'off'\)/)
  assert.match(scriptSource, /else if \(!element\.getAttribute\('autocomplete'\)\)/)
  // The list is drawn with text nodes only, and a style sheet that a page's content security policy cannot block.
  assert.doesNotMatch(scriptSource, /innerHTML|insertAdjacentHTML|outerHTML/)
  assert.match(scriptSource, /adoptedStyleSheets/)
})

const entry = (id: string, username: string, updatedAt: number): SavedPassword => ({
  id,
  label: 'example.com',
  url: 'https://example.com/',
  username,
  password: `secret-${id}`,
  updatedAt,
})

test('the accounts handed to the page are the user names only, most recently used first, each once', () => {
  const matches = [
    entry('a', 'old@example.com', 100),
    entry('b', 'new@example.com', 300),
    entry('c', 'Old@Example.com', 200),
    entry('d', '  ', 400),
  ]
  assert.deepEqual(suggestionAccounts(matches), ['new@example.com', 'Old@Example.com'])

  const script = buildPasswordSuggestScript({
    accounts: suggestionAccounts(matches),
    labels: { all: '{count} accounts', filtered: '{count} matching' },
  })
  assert.ok(script.includes('window.__nebulaPasswordSuggest'))
  assert.ok(!script.includes('secret-'), 'no password goes into the page')
  // The text is one call with one string argument that parses back to the payload.
  const call = /return f\((".*")\);\}\)\(\)$/s.exec(script)
  assert.ok(call)
  assert.deepEqual(JSON.parse(JSON.parse(call[1])), {
    accounts: ['new@example.com', 'Old@Example.com'],
    labels: { all: '{count} accounts', filtered: '{count} matching' },
  })
})

test('a pick names a saved login only among the accounts offered for that tab', () => {
  const offered = [entry('a', 'me@example.com', 100), entry('b', 'is@example.com', 200)]
  assert.equal(entryForPickedAccount(offered, 'IS@example.com')?.id, 'b')
  assert.equal(entryForPickedAccount(offered, ' me@example.com ')?.id, 'a')
  assert.equal(entryForPickedAccount(offered, 'someone@else.com'), null, 'a page cannot ask for an account that was not offered')
  assert.equal(entryForPickedAccount(offered, ''), null)
})

test('the shell asks the page for its list first and falls back to its own prompt only when the page has none', () => {
  const hook = read('../src/hooks/usePasswordBridge.ts')
  assert.match(hook, /await showSuggestions\(tabId, poll\.docId \?\? null,/)
  assert.ok(
    hook.indexOf('await showSuggestions(') < hook.indexOf("mode: 'fill',\n          shortcutId: tabId"),
    'the prompt over the page is built after the page list was tried',
  )
  assert.match(hook, /result === 'missing'\) return false/)
  // A pick is checked against the origin of the offered page, then filled from the shell's own copy.
  assert.match(hook, /passwordOriginFromUrl\(event\.url\) !== passwordOriginFromUrl\(offered\.pageUrl\)/)
  assert.match(hook, /entryForPickedAccount\(offered\.matches, event\.username\)/)

  const rust = read('../src-tauri/src/site_ui.rs')
  assert.match(rust, /include_str!\("site_scripts\/password_suggest\.js"\)/)
  assert.match(rust, /"nebula-password-suggest"/)
})

test('the save bubble is told the site and the account, never the password, and its answers are acted on from the shell copy', () => {
  const labels = { title: 'Save?', site: 'Site', account: 'Account', password: 'Password', save: 'Save', dismiss: 'Not now' }
  const script = buildPasswordSaveScript({ site: 'example.com', username: 'me@example.com', labels })
  assert.ok(script.includes('window.__nebulaPasswordSave'))
  const call = /return f\((".*")\);\}\)\(\)$/s.exec(script)
  assert.ok(call)
  assert.deepEqual(JSON.parse(JSON.parse(call[1])), { site: 'example.com', username: 'me@example.com', labels })
  const hide = /return f\((".*")\);\}\)\(\)$/s.exec(buildPasswordSaveScript(null))
  assert.ok(hide)
  assert.deepEqual(JSON.parse(JSON.parse(hide[1])), { hide: true })

  // The page script shows dots, defines the function the page cannot replace, and only trusted clicks answer.
  assert.match(scriptSource, /define\('__nebulaPasswordSave', receiveBubble\)/)
  assert.match(scriptSource, /if \(event\.isTrusted\) answerBubble\('save'\)/)
  assert.doesNotMatch(scriptSource, /\bpassword: (?!')/i, 'no message of the page carries a password')

  const hook = read('../src/hooks/usePasswordBridge.ts')
  // The offer is made in the page first; the prompt over the page is only the fallback.
  assert.ok(hook.indexOf('await showSaveBubble(tabId, saveOffer') < hook.indexOf('setOffer(saveOffer)'))
  // A save answer saves the offer the shell kept (not text from the page) and only while the bubble is shown.
  assert.match(hook, /current\.mode !== 'save' \|\| !inlineSaveRef\.current/)
  assert.match(hook, /password: current\.password/)
})

test('passkeys follow the accounts in the list and match what is typed the same way', () => {
  const keys = [
    { id: 'cred-1', name: 'me@example.com' },
    { id: 'cred-2', name: 'work@corp.example' },
  ]
  const opened = engine.nextView(CLOSED, 'open', ['is@example.com'], '', keys)
  assert.deepEqual(plain(opened.rows.map((row) => [row.name, row.passkey ?? null])), [
    ['is@example.com', null],
    ['me@example.com', 'cred-1'],
    ['work@corp.example', 'cred-2'],
  ])

  // Typing narrows both; a passkey whose name is exactly the typed text is still offered (an account is not).
  const typed = engine.nextView(opened, 'input', ['me@example.com'], 'me@example.com', keys)
  assert.deepEqual(plain(typed.rows.map((row) => row.passkey ?? null)), ['cred-1'])
  assert.equal(engine.nextView(CLOSED, 'input', ['me@example.com'], 'zz', keys).open, false)

  // The keyboard reaches a passkey row and Enter hands back the row, so the page knows it is a passkey.
  const second = engine.nextView(engine.nextView(opened, 'down', ['is@example.com'], '', keys), 'down', ['is@example.com'], '', keys)
  const chosen = engine.nextView(second, 'enter', ['is@example.com'], '', keys)
  assert.equal(chosen.pickRow?.passkey, 'cred-1')
  assert.equal(chosen.pick, 'me@example.com')

  // A site with passkeys and no saved account still gets a list.
  assert.equal(engine.nextView(CLOSED, 'open', [], '', keys).rows.length, 2)
})

test('the page script answers passkey requests itself, falls back to the web view and never trusts the page for the origin', () => {
  // The conditional request is answered by Nebula; any other kind of request is the web view's own.
  assert.match(scriptSource, /options\.mediation === 'conditional' && options\.publicKey/)
  assert.match(scriptSource, /Object\.defineProperty\(container, 'get', \{ value: wrapped, writable: false, configurable: false/)
  // With nothing to offer, or no answer in time, the web view's request runs.
  assert.match(scriptSource, /if \(found\.length === 0\) \{\s*request\.native\(\);/)
  assert.match(scriptSource, /\}, 4000\);/)
  // The page script sends the challenge and the credential, never an origin that the native side would use.
  assert.match(scriptSource, /kind: 'sign'/)
  assert.match(scriptSource, /define\('__nebulaPasskeys', receivePasskeys\)/)

  const rust = read('../src-tauri/src/site_ui.rs')
  assert.match(rust, /"nebula-passkeys"/)
  assert.match(rust, /crate::passkeys::rp_id_allowed\(rp_id, source_origin\)/)
  assert.match(rust, /crate::passkeys::client_data_json\(challenge, origin\)/)
  // The credential must be one Windows lists for the site.
  assert.match(rust, /passkey\.credential_id == credential_id/)
})

test('the passkey list can be switched off: the setting reaches the native side, which then offers no passkeys', () => {
  const settings = read('../src/core/nebulaSettings.ts')
  assert.match(settings, /passkeyList: boolean/)
  assert.match(settings, /passkeyList: true,/, 'on by default')
  assert.match(settings, /passkeyList: typeof p\?\.passkeyList === 'boolean'/)

  const browser = read('../src/platform/tauriBrowser.ts')
  assert.match(browser, /passkeyList: boolean/)

  const privacy = read('../src-tauri/src/webview_privacy.rs')
  assert.match(privacy, /#\[serde\(default = "default_true"\)\]\s*pub passkey_list: bool/)
  assert.match(privacy, /pub fn passkey_list_enabled\(label: &str\) -> bool/)

  // Off: no list is offered (so the page's request goes to the web view) and nothing is signed.
  const rust = read('../src-tauri/src/site_ui.rs')
  const list = rust.slice(rust.indexOf('fn list_passkeys('), rust.indexOf('fn sign_with_passkey('))
  assert.match(list, /passkey_list_enabled\(tab_label\)/)
  const sign = rust.slice(rust.indexOf('fn sign_with_passkey('))
  assert.ok(sign.indexOf('passkey_list_enabled(tab_label)') < sign.indexOf('SIGNING.swap'))

  const panel = read('../src/components/SettingsPanel/SettingsPanel.tsx')
  assert.match(panel, /onUpdate\('privacy', 'passkeyList', !privacy\.passkeyList\)/)
})

test('the heading of the list names the site as the site calls itself, or by its domain name with a capital', () => {
  // What the site says wins (og:site_name, application-name), unless it is long or empty.
  assert.equal(engine.siteNameFrom('Lichess', 'lichess.org'), 'Lichess')
  assert.equal(engine.siteNameFrom('  The   Guardian ', 'www.theguardian.com'), 'The Guardian')
  assert.equal(engine.siteNameFrom('x'.repeat(41), 'chess.com'), 'Chess')
  assert.equal(engine.siteNameFrom('', 'chess.com'), 'Chess')
  assert.equal(engine.siteNameFrom(null, 'lichess.org'), 'Lichess')
  // Otherwise the name of the domain: without "www." and the suffix, also a two-part one.
  assert.equal(engine.siteNameFrom(null, 'www.lichess.org'), 'Lichess')
  assert.equal(engine.siteNameFrom(null, 'accounts.google.com'), 'Google')
  assert.equal(engine.siteNameFrom(null, 'www.bbc.co.uk'), 'Bbc')
  assert.equal(engine.siteNameFrom(null, 'sahibinden.com.tr'), 'Sahibinden')
  assert.equal(engine.siteNameFrom(null, 'localhost'), 'Localhost')
  // An address is not a name.
  assert.equal(engine.siteNameFrom(null, '192.168.1.5'), '192.168.1.5')
  assert.equal(engine.siteNameFrom(null, ''), '')
  // The heading uses it instead of "Nebula".
  assert.match(scriptSource, /brand\.textContent = pageSiteName\(\) \|\| 'Nebula';/)
  // A key before the name says the list is Nebula's.
  assert.match(scriptSource, /var mark = keyIcon\(\);\s+mark\.setAttribute\('width', '13'\);/)
})
