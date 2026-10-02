// Drives the real "Factory reset" button of a real Nebula build through DevTools and checks
// what is left afterwards (not Computer Use: it talks to the page, not to the screen).
//
//   node scripts/factory-reset-live.mjs <path-to-app.exe> <identifier> [port]
//
// Use a build with its own identity (tauri.perf.conf.json): the reset really erases that
// identity's profile, password vault, shell state store and settings. Before the click it
// seeds: shell localStorage keys, a shell cookie, an IndexedDB database, a password vault
// entry, and waits until the shell state store holds the keys. After the click it waits
// for the shell to reload and checks that none of it survived, including in the store.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'


/** Ends every process of the build under test (the single-instance plugin would hand a new start to a dying one). */
function killByExe(path) {
  const escaped = path.split('/').join(String.fromCharCode(92)).replace(/'/g, "''")
  spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '" + escaped + "' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' })
  spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2'], { stdio: 'ignore' })
}

const [exe, identifier, portArg] = process.argv.slice(2)
if (!exe || !identifier) {
  console.error('usage: node scripts/factory-reset-live.mjs <app.exe> <identifier> [port]')
  process.exit(2)
}
const port = Number(portArg ?? 9349)
const local = join(process.env.LOCALAPPDATA, identifier)
const roaming = join(process.env.APPDATA, identifier)
const storeFile = join(local, 'shell-state.v1.dpapi')
const vaultFile = join(roaming, 'password-vault.dpapi')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}

const devtools = async () => (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
async function waitFor(what, find, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const found = await find(await devtools())
      if (found) return found
    } catch {
      // not up yet
    }
    await sleep(400)
  }
  throw new Error(`${what} did not appear`)
}
const shellPage = (list) => list.find((t) => t.type === 'page' && /^https?:\/\/tauri\.localhost/.test(t.url) && !/chrome|overlay/i.test(t.title))

let cdp
let chrome
// The Settings button lives in the chrome overlay webview; the dialog and the reset live in main.
async function attachChrome() {
  if (chrome) try { chrome.ws.close() } catch { /* gone */ }
  const found = await waitFor('the chrome overlay page', async (list) => {
    for (const t of list.filter((x) => x.type === 'page' && /^https?:\/\/tauri\.localhost/.test(x.url))) {
      const probe = new Cdp(t.webSocketDebuggerUrl, { callTimeoutMs: 30_000 })
      await probe.open()
      const label = await probe.call('Runtime.evaluate', { expression: 'window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? null', returnByValue: true })
      if (label.result.value === 'nebula-chrome') return probe
      probe.ws.close()
    }
    return null
  }, 20_000)
  chrome = found
}
async function attach(timeoutMs) {
  if (cdp) try { cdp.ws.close() } catch { /* gone */ }
  const target = await waitFor('the shell page', async (list) => {
    for (const t of list.filter((x) => x.type === 'page' && /^https?:\/\/tauri\.localhost/.test(x.url))) {
      const probe = new Cdp(t.webSocketDebuggerUrl, { callTimeoutMs: 30_000 })
      await probe.open()
      const label = await probe.call('Runtime.evaluate', { expression: 'window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? null', returnByValue: true })
      if (label.result.value === 'main') return { target: t, probe }
      probe.ws.close()
    }
    return null
  }, timeoutMs)
  cdp = target.probe
}
async function evaluate(expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(`${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? ''}`)
  }
  return result.result.value
}
const status = () => evaluate(`window.__TAURI_INTERNALS__.invoke('shell_store_status')`)

killByExe(exe)
const child = spawn(exe, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: 'ignore',
})

try {
  await attach(40_000)
  await sleep(4000)

  // ---- seed --------------------------------------------------------------------
  await evaluate(`(() => {
    localStorage.setItem('nebula-reset-probe-a', 'secret-a')
    localStorage.setItem('nebula-reset-probe-b', 'secret-b')
    localStorage.setItem('unprefixed-reset-probe', 'keeps-its-key')
    document.cookie = 'nebula_reset_probe=1; max-age=3600; path=/'
    return 1
  })()`)
  await evaluate(`new Promise((resolve, reject) => {
    const open = indexedDB.open('nebula-reset-probe', 1)
    open.onupgradeneeded = () => open.result.createObjectStore('s')
    open.onsuccess = () => { const tx = open.result.transaction('s', 'readwrite'); tx.objectStore('s').put('x', 'k'); tx.oncomplete = () => { open.result.close(); resolve(1) } }
    open.onerror = () => reject(open.error)
  })`)
  await evaluate(`window.__TAURI_INTERNALS__.invoke('password_vault_save', { json: '[{"id":"reset-probe","username":"u"}]', expectedJson: null })`)
  check('the vault file exists before the reset', existsSync(vaultFile), vaultFile)

  let before = null
  for (let i = 0; i < 20; i += 1) {
    await sleep(1000)
    before = await status()
    if (before.keyCount > 0) {
      const live = await evaluate(`localStorage.length`)
      if (before.keyCount >= live - 1) break
    }
  }
  check('the shell state store holds the seeded state before the reset', before && before.keyCount > 2 && existsSync(storeFile), JSON.stringify(before))

  // ---- click through the real UI ---------------------------------------------------
  await attachChrome()
  const click = (predicate, description, via = evaluate) => via(`(() => {
    const el = [...document.querySelectorAll('button, [role="tab"], [role="menuitem"]')].find((e) => (${predicate})(e))
    if (!el) return ${JSON.stringify(`no element: ${description}`)}
    el.focus(); el.click(); return 'clicked'
  })()`)
  const text = (e) => (e.textContent || '').trim()
  const evaluateChrome = async (expression) => {
    const result = await chrome.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    return result.result.value
  }
  let r = await click(`(e) => ['Ayarlar', 'Settings'].includes(e.getAttribute('aria-label') || '')`, 'Settings button', evaluateChrome)
  check('the Settings button (chrome overlay) is clicked', r === 'clicked', r)
  await waitFor('the Settings dialog', async () => evaluate(`!!document.querySelector('[role="dialog"][aria-label="Ayarlar"], [role="dialog"][aria-label="Settings"]')`), 10_000)
  r = await click(`(e) => /(About|Hakkında)$/i.test((e.textContent || '').trim()) && !!e.closest('[role="dialog"]')`, 'About category')
  check('the About category opens', r === 'clicked', r)
  await sleep(500)
  r = await click(`(e) => /^(Tamamen sıfırla|Factory reset)$/i.test((e.textContent || '').trim())`, 'Factory reset button')
  check('the Factory reset button is there', r === 'clicked', r)
  await sleep(500)
  // The row asks for confirmation in the app's own dialog (role=alertdialog).
  const dialogButtons = await evaluate(`[...document.querySelectorAll('[role="alertdialog"] button')].map((e) => (e.textContent || '').trim())`)
  check('the app asks for confirmation before resetting', Array.isArray(dialogButtons) && dialogButtons.length >= 2, JSON.stringify(dialogButtons))
  // The confirm button is the last one (cancel comes first).
  r = await evaluate(`(() => { const all = [...document.querySelectorAll('[role="alertdialog"] button')]; const el = all[all.length - 1]; if (!el) return 'no confirm button'; el.click(); return 'clicked: ' + (el.textContent || '').trim() })()`)
  check('the confirmation is accepted', /^clicked/.test(String(r)), r)

  // ---- the shell reloads -------------------------------------------------------------
  const reloadedStart = Date.now()
  let reloaded = false
  for (let i = 0; i < 60 && !reloaded; i += 1) {
    await sleep(1000)
    try {
      await attach(5_000)
      reloaded = await evaluate(`!localStorage.getItem('nebula-reset-probe-a') && !!document.body`)
    } catch {
      // the page is going away
    }
  }
  check('the shell reloaded after the reset', reloaded, `${((Date.now() - reloadedStart) / 1000).toFixed(1)}s`)
  await sleep(6000) // past the first reconcile of the new page

  // ---- what is left ------------------------------------------------------------------
  const left = await evaluate(`(() => ({
    keys: Object.keys(localStorage),
    cookie: document.cookie,
    vaultKeys: 0,
  }))()`)
  check('the seeded nebula- keys are gone from localStorage', !left.keys.some((k) => k.startsWith('nebula-reset-probe')), left.keys.filter((k) => k.startsWith('nebula-reset')).join(','))
  check('the cookie is gone', !/nebula_reset_probe/.test(left.cookie), left.cookie)
  const db = await evaluate(`indexedDB.databases ? indexedDB.databases().then((l) => l.map((d) => d.name)) : []`)
  check('the IndexedDB database is gone', !db.includes('nebula-reset-probe'), JSON.stringify(db))
  check('the password vault file is gone', !existsSync(vaultFile))
  const after = await status()
  check('the store no longer holds the erased state', after.keyCount <= 40, JSON.stringify(after))
  // Decrypt the store and its previous copy and look for the secrets.
  const script = `
    Add-Type -AssemblyName System.Security
    foreach ($f in '${storeFile.replace(/'/g, "''")}', '${storeFile.replace(/'/g, "''")}.bak') {
      if (Test-Path $f) {
        $bytes = [IO.File]::ReadAllBytes($f)
        [Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser'))
      }
    }
  `
  const run = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  check('no erased secret is in the store file or its previous copy', run.status === 0 && !/secret-a|secret-b|nebula-reset-probe/.test(run.stdout), run.status === 0 ? '' : run.stderr)
  console.log('INFO files in the local data folder:', existsSync(local) ? readdirSync(local).join(', ') : '(missing)')
} catch (error) {
  check('the live run completed', false, String(error?.stack ?? error))
} finally {
  try { cdp?.ws.close() } catch { /* gone */ }
  killByExe(exe)
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
