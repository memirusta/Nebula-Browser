// Runs the password bridge scripts (the polling/save-capture script and the fill script that Nebula injects into
// site tabs, src/core/passwordBridgeScript.ts) in a real Chromium on small login forms of the kinds sites really
// use: which fields get filled, whether the page counts as a login, and which password is remembered after a
// submit. No Nebula window is involved.
//
//   NEBULA_E2E_BROWSER=<chrome.exe> node scripts/password-fill-live.mjs
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { buildPasswordBridgeTickScript, buildPasswordFillScript } from '../src/core/passwordBridgeScript.ts'
import { Cdp } from './e2e-cdp.mjs'

const browser = process.env.NEBULA_E2E_BROWSER
if (!browser) {
  console.error('set NEBULA_E2E_BROWSER to a Chrome/Edge executable')
  process.exit(2)
}

// The bridge ignores about:blank, so the forms are served from a local http page.
const site = createServer((request, response) => {
  response.setHeader('content-type', 'text/html')
  response.end('<!doctype html><title>login</title><body></body>')
})
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${site.address().port}/`

const profile = mkdtempSync(join(tmpdir(), 'nebula-password-'))
const chrome = spawn(browser, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}

const USER = 'me@example.com'
const PASS = 'S3cret!'
/**
 * [name, markup, expected fill result, ids of the fields that must be filled, expected poll]
 * Every input that must be filled carries an id; everything else must stay empty.
 */
const fillCases = [
  ['Moodle: name=username', '<form><input id="u" name="username"><input id="p" type="password" name="password"></form>', 'both', ['u', 'p'], { hasForm: true, hasUsernameField: true, hasPasswordField: true }],
  ['email type', '<form><input id="u" type="email"><input id="p" type="password"></form>', 'both', ['u', 'p'], { hasForm: true, hasUsernameField: true }],
  ['name=userid', '<form><input id="u" name="userid"><input id="p" type="password"></form>', 'both', ['u', 'p'], { hasForm: true, hasUsernameField: true }],
  ['name=user', '<form><input id="u" name="user"><input id="p" type="password"></form>', 'both', ['u', 'p'], { hasForm: true, hasUsernameField: true }],
  ['Turkish: kullanici_adi', '<form><input id="u" type="text" name="kullanici_adi"><input id="p" type="password"></form>', 'both', ['u', 'p'], { hasForm: true, hasUsernameField: true }],
  ['Turkish: txtKullaniciAdi next to a captcha field', '<form><input id="u" type="text" name="txtKullaniciAdi"><input type="text" name="captcha"><input id="p" type="password"></form>', 'both', ['u', 'p'], { hasForm: true, hasUsernameField: true }],
  ['Turkish: placeholder Kullanıcı adı', '<form><input id="u" type="text" placeholder="Kullanıcı adı"><input id="p" type="password"></form>', 'both', ['u', 'p'], { hasForm: true }],
  ['no hints, one text field before the password', '<form><input id="u" type="text"><input id="p" type="password"></form>', 'both', ['u', 'p'], { hasForm: true }],
  ['no hints, two text fields: only the password', '<form><input type="text" name="a"><input type="text" name="b"><input id="p" type="password"></form>', 'password', ['p'], {}],
  ['a search box next to a login form is not the account field', '<input type="text" name="user_search"><form><input id="u" name="email"><input id="p" type="password"></form>', 'both', ['u', 'p'], { hasForm: true }],
  ['password only (second step)', '<form><input id="p" type="password"></form>', 'password', ['p'], { hasPasswordField: true, hasUsernameField: false }],
  ['account field only (first step) with a Next button', '<form><input id="u" name="loginfmt"><button type="submit">Next</button></form>', 'username', ['u'], { hasPasswordField: false, hasUsernameField: true }],
  ['login inside an open shadow root', '<div id="host"></div>', 'both', ['u', 'p'], { hasPasswordField: true, hasUsernameField: true }],
  ['sign-up form (new-password): no saved password is offered', '<form><input id="u" type="email"><input id="p" type="password" autocomplete="new-password"><input type="password" autocomplete="new-password"></form>', false, [], { hasPasswordField: false, hasAnyPasswordField: true, hasUsernameField: false }],
  ['password change: the current password is filled, not the new ones', '<form><input id="p" type="password" autocomplete="current-password"><input type="password" autocomplete="new-password"><input type="password" autocomplete="new-password"></form>', 'password', ['p'], { hasPasswordField: true }],
]

try {
  let port = 0
  for (let i = 0; i < 60 && !port; i += 1) {
    await sleep(250)
    const file = join(profile, 'DevToolsActivePort')
    if (existsSync(file)) port = Number.parseInt(readFileSync(file, 'utf8'), 10)
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((target) => target.type === 'page')
  const cdp = new Cdp(page.webSocketDebuggerUrl, { callTimeoutMs: 30_000 })
  await cdp.open()
  const run = async (expression) => {
    const r = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
  await cdp.call('Page.enable')
  const load = async (markup, shadow = false) => {
    await cdp.call('Page.navigate', { url: origin })
    await sleep(300)
    await run(`document.body.innerHTML = ${JSON.stringify(markup)}; true`)
    if (shadow) await run(`document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<input id="u" name="username"><input id="p" type="password">'; true`)
  }

  for (const [name, markup, expectedFill, filledIds, expectedPoll] of fillCases) {
    await load(markup, name.includes('shadow root'))
    const tick = JSON.parse(await run(buildPasswordBridgeTickScript()))
    const fill = await run(buildPasswordFillScript(USER, PASS))
    const filled = await run(`(() => {
      const inputs = []
      const walk = (root) => { root.querySelectorAll('*').forEach((e) => { if (e.tagName === 'INPUT') inputs.push(e); if (e.shadowRoot) walk(e.shadowRoot) }) }
      walk(document)
      return inputs.filter((i) => i.value).map((i) => i.id || '(no id)')
    })()`)
    const pollOk = Object.entries(expectedPoll).every(([key, value]) => tick[key] === value)
    check(name, fill === expectedFill && JSON.stringify([...filled].sort()) === JSON.stringify([...filledIds].sort()) && pollOk,
      `fill=${fill}, filled=[${filled}], poll=${JSON.stringify(tick)}`)
  }

  // What is remembered after a submit. The click has to be a real one: the bridge ignores untrusted events.
  const submit = async (markup, values) => {
    await load(markup)
    await run(`(() => { ${Object.entries(values).map(([id, value]) => `document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(value)}`).join(';')}; return true })()`)
    await run(buildPasswordBridgeTickScript()) // installs the listeners
    const box = JSON.parse(await run(`(() => { const r = document.getElementById('go').getBoundingClientRect(); return JSON.stringify({ x: r.x + r.width / 2, y: r.y + r.height / 2 }) })()`))
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.call('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
    }
    await sleep(150)
    return JSON.parse(await run('window.__nebulaPasswordBridgeTick()')).pending
  }
  const stop = 'onsubmit="return false"'

  const login = await submit(`<form ${stop}><input id="u" name="username"><input id="p" type="password"><button id="go" type="submit">Sign in</button></form>`, { u: USER, p: PASS })
  check('a login is captured with its account and password', login?.username === USER && login?.password === PASS, JSON.stringify(login))

  const turkish = await submit(`<form ${stop}><input id="u" name="kullanici_adi"><input id="p" type="password"><button id="go" type="submit">Giriş</button></form>`, { u: 'ogrenci1', p: PASS })
  check('a login with a Turkish account field is captured', turkish?.username === 'ogrenci1' && turkish?.password === PASS, JSON.stringify(turkish))

  const change = await submit(`<form ${stop}><input type="hidden" name="username" value="${USER}"><input id="c" type="password" autocomplete="current-password"><input id="n" type="password" autocomplete="new-password"><input id="r" type="password" autocomplete="new-password"><button id="go" type="submit">Change password</button></form>`, { c: 'old-password', n: 'brand-new-1', r: 'brand-new-1' })
  check('a password change remembers the new password, not the old one', change?.password === 'brand-new-1' && change?.username === '', JSON.stringify(change))

  const plainChange = await submit(`<form ${stop}><input id="c" type="password"><input id="n" type="password"><input id="r" type="password"><button id="go" type="submit">Change password</button></form>`, { c: 'old-password', n: 'brand-new-2', r: 'brand-new-2' })
  check('three unmarked password fields: the second is the new password', plainChange?.password === 'brand-new-2', JSON.stringify(plainChange))

  const lonely = await submit(`<form ${stop}><input id="u" type="text" name="a"><input id="x" type="text" name="b"><input id="p" type="password"><button id="go" type="submit">Go</button></form>`, { u: 'one', x: 'two', p: PASS })
  check('a form without a recognisable account field is not captured', lonely == null, JSON.stringify(lonely))

  // A reload is a new document: the poll answers with a different id, while polls of one page keep theirs.
  await load('<form><input name="username"><input type="password"></form>')
  const firstLoad = JSON.parse(await run(buildPasswordBridgeTickScript())).docId
  const samePage = JSON.parse(await run('window.__nebulaPasswordBridgeTick()')).docId
  await load('<form><input name="username"><input type="password"></form>')
  const afterReload = JSON.parse(await run(buildPasswordBridgeTickScript())).docId
  check('polls of one page keep their document id', firstLoad && firstLoad === samePage, `${firstLoad} / ${samePage}`)
  check('a reload gives the page a new document id', afterReload && afterReload !== firstLoad, `${firstLoad} / ${afterReload}`)

  cdp.ws.close()
} catch (error) {
  check('the run completed', false, String(error?.message ?? error))
} finally {
  chrome.kill()
  site.close()
  await sleep(500)
  rmSync(profile, { recursive: true, force: true })
}
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\nALL CHECKS PASSED (${results.length})` : `\n${failed.length} of ${results.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
