// Live check of the opt-in switch between the single environment and the split one, on a
// real Nebula build with its own identity (tauri.perf.conf.json). It RESETS that identity's
// data folders first. DevTools drives the page; nothing here uses the screen.
//
//   node scripts/shell-isolation-live.mjs <path-to-app.exe> <identifier> [port]
//
// Scenarios: single -> split (gate, restart, hydration, residue cleanup, mirroring keeps
// working, tabs live in the other environment) -> single again (state follows, trusted
// folder removed); a switch whose recorded digest does not match is abandoned at startup;
// a switch whose hydration report disagrees is rolled back automatically.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'

const [exe, identifier, portArg] = process.argv.slice(2)
if (!exe || !identifier) {
  console.error('usage: node scripts/shell-isolation-live.mjs <app.exe> <identifier> [port]')
  process.exit(2)
}
void portArg
const local = join(process.env.LOCALAPPDATA, identifier)
const roaming = join(process.env.APPDATA, identifier)
const markerFile = join(local, 'shell-isolation.json')
const storeFile = join(local, 'shell-state.v1.dpapi')
const trusted = join(local, 'trusted')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}

const powershell = (script) =>
  spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

function killAll() {
  const escaped = exe.replace(/\//g, '\\').replace(/'/g, "''")
  powershell(`
    Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${escaped}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${identifier}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  `)
}

async function resetFixture() {
  killAll()
  for (let i = 0; i < 20; i += 1) {
    rmSync(local, { recursive: true, force: true })
    rmSync(roaming, { recursive: true, force: true })
    if (!existsSync(local)) return
    await sleep(1000)
  }
  throw new Error('could not reset the fixture identity')
}

// Every WebView2 environment is its own browser process, so each needs its own DevTools port.
// With port 0 each one picks a free port and writes it to DevToolsActivePort in its folder.
const environments = [join(local, 'EBWebView'), join(local, 'trusted', 'EBWebView')]
const devtools = async () => {
  const targets = []
  for (const folder of environments) {
    const file = join(folder, 'DevToolsActivePort')
    if (!existsSync(file)) continue
    const livePort = Number.parseInt(readFileSync(file, 'utf8'), 10)
    try {
      const list = await (await fetch(`http://127.0.0.1:${livePort}/json/list`)).json()
      for (const target of list) targets.push({ ...target, environment: folder.includes('trusted') ? 'trusted' : 'default' })
    } catch {
      // a stale file from an environment that is not running
    }
  }
  return targets
}
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

let spawned = null
function launch() {
  spawned = spawn(exe, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0' },
    stdio: 'ignore',
  })
}

const open = new Map()
async function connect(target) {
  const cdp = new Cdp(target.webSocketDebuggerUrl, { callTimeoutMs: 60_000 })
  await cdp.open()
  open.set(target.id, cdp)
  return cdp
}
function dropConnections() {
  for (const cdp of open.values()) {
    try { cdp.ws.close() } catch { /* gone */ }
  }
  open.clear()
}
async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(`${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? ''}`)
  }
  return result.result.value
}
const labelOf = (cdp) => evaluate(cdp, `window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? null`)

async function mainPage(timeoutMs = 45_000) {
  return waitFor('the main shell page', async (list) => {
    for (const target of list.filter((t) => t.type === 'page' && t.url.startsWith('http://tauri.localhost'))) {
      try {
        const cdp = await connect(target)
        if ((await labelOf(cdp)) === 'main') return cdp
        cdp.ws.close()
      } catch {
        // a page that is going away
      }
    }
    return null
  }, timeoutMs)
}

/**
 * Waits for the restarted app: the first main page whose isolation status satisfies the
 * predicate. The restart is fast and the new process reuses the DevTools port, so "the
 * port went away" is not observable; the old process simply never satisfies the predicate.
 */
async function afterRestart(predicate = () => true) {
  dropConnections()
  const deadline = Date.now() + 90_000
  let lastState = null
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const cdp = await mainPage(8_000)
      const state = await evaluate(cdp, "window.__TAURI_INTERNALS__.invoke('shell_isolation_status')")
      lastState = state
      if (predicate(state)) return cdp
    } catch (error) {
      lastError = String(error)
    }
    dropConnections()
    await sleep(700)
  }
  throw new Error('the restarted app did not reach the expected state; last state ' + JSON.stringify(lastState) + ', last error ' + lastError + ', targets ' + JSON.stringify((await devtools().catch(() => [])).map((t) => t.environment + ':' + t.url)))
}

const noticeShown = async (cdp) => { for (let i = 0; i < 40; i += 1) { const text = await evaluate(cdp, `document.querySelector('[role="alertdialog"]')?.textContent ?? ''`); if (/could not be verified|doğrulanamadı/.test(text)) return true; await sleep(500) } return false }
const invoke = (cdp, command, args = {}) =>
  evaluate(cdp, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})`)
const status = (cdp) => invoke(cdp, 'shell_isolation_status')
const storeStatus = (cdp) => invoke(cdp, 'shell_store_status')
const marker = () => (existsSync(markerFile) ? JSON.parse(readFileSync(markerFile, 'utf8')) : null)

function decryptStore() {
  const script = `
    Add-Type -AssemblyName System.Security
    [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes('${storeFile.replace(/'/g, "''")}'), $null, 'CurrentUser'))
  `
  const run = powershell(script)
  if (run.status !== 0) throw new Error(run.stderr)
  return JSON.parse(Buffer.from(run.stdout.trim(), 'base64').toString('utf8'))
}

/** The content digest the app computes (src-tauri shell_state_store.rs content_digest). */
function digestOf(pairs) {
  const encoder = new TextEncoder()
  const list = pairs.map(([k, v]) => [Buffer.from(encoder.encode(k)), Buffer.from(encoder.encode(v))]).sort((a, b) => Buffer.compare(a[0], b[0]))
  const hash = createHash('sha256')
  const length = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b }
  for (const [k, v] of list) { hash.update(length(k.length)); hash.update(k); hash.update(length(v.length)); hash.update(v) }
  return hash.digest('hex')
}

async function settle(cdp, key, value, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (decryptStore().entries[key]?.v === value) return true
    await sleep(500)
  }
  return false
}

const probes = {
  'nebula-iso-probe-a': 'alpha-\u00fc-\u{1F600}',
  'nebula-iso-probe-b': JSON.stringify({ nested: [1, 2, 3], text: 'line\nbreak' }),
  'nebula-iso-probe-c': 'x'.repeat(50_000),
}

async function seed(cdp) {
  for (const [key, value] of Object.entries(probes)) {
    await evaluate(cdp, `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)}), 1`)
  }
  return settle(cdp, 'nebula-iso-probe-c', probes['nebula-iso-probe-c'])
}

async function holdsProbes(cdp) {
  const live = await evaluate(cdp, `(() => { const o = {}; for (const k of ${JSON.stringify(Object.keys(probes))}) o[k] = localStorage.getItem(k); return o })()`)
  return Object.entries(probes).every(([key, value]) => live[key] === value)
}

try {
  await resetFixture()
  launch()
  let main = await mainPage()
  await sleep(4000)

  // ---- single -> split ------------------------------------------------------------
  let s = await status(main)
  check('a fresh installation starts in the single environment', s.mode === 'single' && !s.hydrating && s.pending === null, JSON.stringify(s))
  check('there is no trusted folder yet', !existsSync(trusted))
  check('the probe state reaches the store', await seed(main))

  const switchResult = await evaluate(main, `window.__TAURI_INTERNALS__.invoke('shell_isolation_switch', { target: 'split' }).then(() => 'ok', (e) => 'failed: ' + JSON.stringify(e))`)
  check('the migration gate passes and the switch is scheduled', switchResult === 'ok', switchResult)
  const pending = marker()
  check('the marker records the switch with the digest', pending?.pending === 'split' && pending?.mode === 'single' && pending?.expected?.digest?.length === 64, JSON.stringify(pending))

  main = await afterRestart((state) => state.mode === 'split' && !state.hydrating)
  await sleep(6000)
  s = await status(main)
  check('after the restart the shell runs in the split environment', s.mode === 'split', JSON.stringify(s))
  check('the hydration was verified and the switch is final', s.pending === null && !s.hydrating && marker()?.mode === 'split' && marker()?.pending === null, JSON.stringify(marker()))
  check('the shell holds exactly the state it had', await holdsProbes(main))
  check('the shell lives in the trusted folder', existsSync(join(trusted, 'EBWebView')))
  const udf = powershell(`(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${identifier}*' } | ForEach-Object { $_.CommandLine }) -join "\`n"`).stdout
  check('shell processes run on the trusted user data folder', /trusted/.test(udf))

  // The browsing environment: a document at the app's origin there must not see the shell's old state.
  await evaluate(main, `window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview', { windowLabel: 'main', options: { label: 'nebula-tab-iso-probe', url: 'http://tauri.localhost/favicon.svg', x: 0, y: 0, width: 200, height: 200, browserExtensionsEnabled: true } }).then(() => 1)`)
  const tab = await waitFor('the probe tab', (list) => list.find((t) => t.type === 'page' && t.url === 'http://tauri.localhost/favicon.svg'))
  const tabCdp = await connect(tab)
  const residue = await evaluate(tabCdp, `Object.keys(localStorage).filter((k) => k.startsWith('nebula-')).length`)
  check('the old shell state is gone from the browsing environment', residue === 0, `${residue} nebula- keys left`)
  await evaluate(main, `window.__TAURI_INTERNALS__.invoke('plugin:webview|webview_close', { label: 'nebula-tab-iso-probe' }).then(() => 1, () => 0)`)

  // Mirroring keeps working in the trusted environment.
  await evaluate(main, `localStorage.setItem('nebula-iso-probe-split', 'written in split'), 1`)
  check('the mirror keeps working in the trusted shell', await settle(main, 'nebula-iso-probe-split', 'written in split'))

  // ---- split -> single --------------------------------------------------------------
  const back = await evaluate(main, `window.__TAURI_INTERNALS__.invoke('shell_isolation_switch', { target: 'single' }).then(() => 'ok', (e) => 'failed: ' + JSON.stringify(e))`)
  check('the way back passes the gate too', back === 'ok', back)
  main = await afterRestart((state) => state.mode === 'single' && !state.hydrating && state.pending === null)
  await sleep(6000)
  s = await status(main)
  check('back in the single environment', s.mode === 'single' && s.pending === null && !s.hydrating, JSON.stringify(s))
  check('the state followed, including what was written while split', (await holdsProbes(main)) && (await evaluate(main, `localStorage.getItem('nebula-iso-probe-split')`)) === 'written in split')
  // The old processes may still hold files for a moment; the app retries in the background.
  for (let i = 0; i < 30 && existsSync(trusted); i += 1) await sleep(500)
  check('the trusted folder (the shell\'s own data) is removed', !existsSync(trusted))

  // ---- a switch whose recorded digest is wrong is abandoned at startup ----------------
  dropConnections()
  killAll()
  await sleep(2500)
  const tampered = { ...marker(), pending: 'split', attempts: 0, expected: { storeGeneration: 1, keyCount: 1, digest: '0'.repeat(64) } }
  writeFileSync(markerFile, JSON.stringify(tampered))
  launch()
  main = await mainPage()
  await sleep(3000)
  s = await status(main)
  check('a pending switch with a wrong digest is abandoned, and the app runs as before', s.mode === 'single' && s.pending === null, JSON.stringify(s))
  check('the user is told once that the switch was undone', await noticeShown(main))
  check('the shell state is intact after the abandoned switch', await holdsProbes(main))
  check('the notice was acknowledged when it was shown', (await status(main)).notice === null)


  // ---- a hydration that disagrees with the record is rolled back automatically --------
  dropConnections()
  killAll()
  await sleep(2500)
  // The record is built by hand from the store (the same digest a real gate pass records),
  // with a wrong key count: the run starts as split and its own report cannot match.
  const liveEntries = Object.entries(decryptStore().entries).filter(([k, e]) => e.v !== null && !k.startsWith('__nebula_') && k !== 'nebula-browser-run-state-v1')
  const recorded = { ...marker(), pending: 'split', attempts: 0, expected: { storeGeneration: 1, keyCount: liveEntries.length + 1, digest: digestOf(liveEntries.map(([k, e]) => [k, e.v])) } }
  writeFileSync(markerFile, JSON.stringify(recorded))
  launch()
  // The run starts as split, reports a different key count, and rolls itself back.
  main = await afterRestart((state) => state.mode === 'single' && !state.hydrating && state.pending === null)
  await sleep(2000)
  s = await status(main)
  check('a hydration that does not match the record rolls back to the source environment', s.mode === 'single' && s.pending === null, JSON.stringify(s))
  check('and the user is told', await noticeShown(main))
  check('the source environment kept all its state', await holdsProbes(main))
} catch (error) {
  check('the live run completed', false, String(error?.stack ?? error))
} finally {
  dropConnections()
  killAll()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
