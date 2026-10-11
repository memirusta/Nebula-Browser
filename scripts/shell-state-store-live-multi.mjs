// Live check of two properties of the shell state mirror that the single-window script
// does not cover:
//
//   1. Web content cannot reach the store: a tab and a popup webview (nebula-tab-*,
//      nebula-popup-content-*) are refused every store command, and the store does not change.
//   2. Two shell windows writing at the same time converge: every key both windows wrote is
//      in the store with the live value, both mirrors stay alive after sustained writes
//      (the rate limit is a retry, not a failure), and a key both windows fight over
//      is healed by the periodic reconcile.
//
//   node scripts/shell-state-store-live-multi.mjs <path-to-app.exe> <identifier> [port] [--fast]
//
// Use a build with its own identity (tauri.perf.conf.json). --fast skips the 65 s wait
// for the periodic reconcile. Exit code 0 only if every check passed.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'


/** Ends every process of the build under test (the single-instance plugin would hand a new start to a dying one). */
function killByExe(path) {
  const escaped = path.split('/').join(String.fromCharCode(92)).replace(/'/g, "''")
  spawnSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '" + escaped + "' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"], { stdio: 'ignore' })
  spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 2'], { stdio: 'ignore' })
}

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const fast = process.argv.includes('--fast')
const [exe, identifier, portArg] = args
if (!exe || !identifier) {
  console.error('usage: node scripts/shell-state-store-live-multi.mjs <app.exe> <identifier> [port] [--fast]')
  process.exit(2)
}
const port = Number(portArg ?? 9348)
const storeFile = join(process.env.LOCALAPPDATA, identifier, 'shell-state.v1.dpapi')
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

const connections = new Map()
async function connect(target) {
  if (connections.has(target.id)) return connections.get(target.id)
  const cdp = new Cdp(target.webSocketDebuggerUrl, { callTimeoutMs: 60_000 })
  await cdp.open()
  connections.set(target.id, cdp)
  return cdp
}
async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) {
    throw new Error(`${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? ''}`)
  }
  return result.result.value
}
const label = (cdp) => evaluate(cdp, `window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? null`)
const status = (cdp) => evaluate(cdp, `window.__TAURI_INTERNALS__.invoke('shell_store_status')`)
const liveStorage = (cdp) =>
  evaluate(cdp, `(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; })()`)

function decryptStore() {
  const script = `
    Add-Type -AssemblyName System.Security
    $bytes = [IO.File]::ReadAllBytes('${storeFile.replace(/'/g, "''")}')
    [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser'))
  `
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const run = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    if (run.status === 0) return JSON.parse(Buffer.from(run.stdout.trim(), 'base64').toString('utf8'))
    spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 300'])
  }
  throw new Error('could not decrypt the store')
}

const server = createServer((request, response) => {
  response.setHeader('content-type', 'text/html')
  response.end('<!doctype html><title>probe</title><p>probe</p>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const probeBase = `http://127.0.0.1:${server.address().port}`

if (existsSync(storeFile)) {
  rmSync(storeFile, { force: true })
  rmSync(`${storeFile}.bak`, { force: true })
}
killByExe(exe)
// This script needs the single environment (tabs share the shell's DevTools port there). Other
// scripts may have left the fixture identity in the split one: go back to the default.
rmSync(join(process.env.LOCALAPPDATA, identifier, 'shell-isolation.json'), { force: true })
rmSync(join(process.env.LOCALAPPDATA, identifier, 'trusted'), { recursive: true, force: true })
const child = spawn(exe, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
  stdio: 'ignore',
})

try {
  // The shell has several webviews (main, chrome overlay); pick the one labelled main.
  let mainTarget = null
  await waitFor('the main shell page', async (list) => {
    for (const target of list.filter((t) => t.type === 'page' && /^https?:\/\/tauri\.localhost/.test(t.url))) {
      const probe = await connect(target)
      if ((await label(probe)) === 'main') {
        mainTarget = target
        return true
      }
      probe.ws.close()
      connections.delete(target.id)
    }
    return false
  })
  connections.delete(mainTarget.id)
  const main = await connect(mainTarget)
  check('the first shell window is main', (await label(main)) === 'main')
  await sleep(5000) // past the first reconcile
  const baseline = await status(main)

  // ---- 1. web content is refused ------------------------------------------------
  const probes = ['nebula-tab-ipc-probe', 'nebula-popup-content-ipc-probe']
  for (const webviewLabel of probes) {
    const url = `${probeBase}/${webviewLabel}`
    await evaluate(
      main,
      `window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview', { windowLabel: 'main', options: { label: '${webviewLabel}', url: '${url}', x: 0, y: 0, width: 300, height: 300, browserExtensionsEnabled: true } }).then(() => 'ok')`,
    )
    const target = await waitFor(`the ${webviewLabel} page`, (list) => list.find((t) => t.type === 'page' && t.url.startsWith(url)))
    const page = await connect(target)
    const outcome = await evaluate(
      page,
      `(async () => {
        const bridge = !!window.__TAURI_INTERNALS__
        const attempt = async (name, args) => {
          try { await window.__TAURI_INTERNALS__.invoke(name, args); return 'ALLOWED' } catch (e) { return 'denied: ' + String(e).slice(0, 120) }
        }
        return {
          bridge,
          apply: await attempt('shell_store_apply', { ops: [{ op: 'set', key: 'nebula-evil', value: 'x', seq: Date.now() * 1000 }] }),
          status: await attempt('shell_store_status', {}),
          wipe: await attempt('shell_store_wipe', {}),
          isolationStatus: await attempt('shell_isolation_status', {}),
          isolationSwitch: await attempt('shell_isolation_switch', { target: 'split' }),
          isolationHydrated: await attempt('shell_isolation_hydrated', { report: { id: 'x', digest: 'x', keyCount: 0 } }),
          isolationBarrier: await attempt('shell_isolation_barrier_ack', { ack: { id: 'x', phase: 'drain' } }),
          isolationNotice: await attempt('shell_isolation_ack_notice', {}),
        }
      })()`,
    )
    const refused = ['apply', 'status', 'wipe', 'isolationStatus', 'isolationSwitch', 'isolationHydrated', 'isolationBarrier', 'isolationNotice'].every((k) => String(outcome[k]).startsWith('denied'))
    check(`${webviewLabel}: every store command is refused`, refused, JSON.stringify(outcome))
    await evaluate(main, `window.__TAURI_INTERNALS__.invoke('plugin:webview|webview_close', { label: '${webviewLabel}' }).then(() => 'closed', () => 'close failed')`)
  }
  await sleep(1000)
  const afterProbes = await status(main)
  check('the store did not change during the probes', afterProbes.generation === baseline.generation && afterProbes.keyCount === baseline.keyCount, `${baseline.generation}/${baseline.keyCount} -> ${afterProbes.generation}/${afterProbes.keyCount}`)
  check('the store was not wiped by web content', afterProbes.keyCount > 0)

  // ---- 2. two shell windows writing at once ---------------------------------------
  const created = await evaluate(main, `window.__TAURI_INTERNALS__.invoke('browser_create_window', { windowId: 'nebula-window-livemw', transferId: null })`)
  // Every shell webview is a writer: main, its chrome overlay, and the new window (with
  // its own overlay). They share one localStorage and each runs its own mirror.
  const writers = new Map()
  const found = await waitFor('the new shell window', async (list) => {
    for (const target of list.filter((t) => t.type === 'page' && /^https?:\/\/tauri\.localhost/.test(t.url))) {
      if (!writers.has(target.id)) {
        const cdp = await connect(target)
        writers.set(target.id, { cdp, label: await label(cdp) })
      }
    }
    return [...writers.values()].some((w) => w.label === 'nebula-window-livemw') ? writers : null
  }, 60_000)
  const labels = [...found.values()].map((w) => w.label)
  check('a second shell window exists next to main', labels.includes('nebula-window-livemw'), `${created}; shell webviews: ${labels.join(', ')}`)
  await sleep(5000)

  const writer = (name) => `(async () => {
    const w = ${JSON.stringify(name)}
    for (let i = 0; i < 150; i++) {
      localStorage.setItem('nebula-race-' + w + '-' + i, 'value-' + w + '-' + i + '-é')
      localStorage.setItem('nebula-race-shared', w + '-' + i)
      if (i % 10 === 9) localStorage.removeItem('nebula-race-' + w + '-' + (i - 5))
      await new Promise((r) => setTimeout(r, 100))
    }
    return 'done'
  })()`
  const done = await Promise.all([...found.values()].map((w, index) => evaluate(w.cdp, writer(String.fromCharCode(97 + index)))))
  check('all ' + done.length + ' shell webviews finished their writes', done.every((value) => value === 'done'))
  await sleep(2500)

  const live = await liveStorage(main)
  const sameStorage = []
  for (const w of found.values()) sameStorage.push(JSON.stringify(Object.entries(await liveStorage(w.cdp)).sort()))
  check('every shell webview sees the same localStorage', sameStorage.every((value) => value === JSON.stringify(Object.entries(live).sort())))
  const compare = () => {
    const entries = decryptStore().entries
    const wrong = Object.keys(live)
      .filter((k) => k !== 'nebula-browser-run-state-v1' && k !== 'nebula-race-shared' && k !== 'nebula-live-check-big' && !k.startsWith('__nebula_'))
      .filter((k) => entries[k]?.v !== live[k])
    const resurrected = Object.entries(entries).filter(([k, e]) => e.v !== null && !(k in live))
    return { entries, wrong, resurrected }
  }
  // The rate limit makes busy mirrors retry (3 s), so a backlog drains after the writes
  // stop: poll until the store matches, and report how long it took.
  const drainStart = Date.now()
  let compared = compare()
  while ((compared.wrong.length > 0 || compared.resurrected.length > 0) && Date.now() - drainStart < 40_000) {
    await sleep(1000)
    compared = compare()
  }
  const drained = ((Date.now() - drainStart) / 1000).toFixed(1)
  check('every key the windows wrote reaches the store with the live value', compared.wrong.length === 0, `${Object.keys(live).length} keys, ${drained}s after the writes plus 2.5 s, mismatched: ${compared.wrong.slice(0, 5).join(', ')}`)
  check('no removed key was brought back by another window', compared.resurrected.length === 0, compared.resurrected.map(([k]) => k).slice(0, 5).join(', '))
  const sharedBefore = compared.entries['nebula-race-shared']?.v
  console.log(`INFO contested key: live=${live['nebula-race-shared']} store=${sharedBefore}`)

  // Both mirrors must still be alive: a canary from each window reaches the store.
  const canaryKeys = []
  for (const [index, w] of [...found.values()].entries()) {
    canaryKeys.push('nebula-canary-' + index)
    await evaluate(w.cdp, "localStorage.setItem('nebula-canary-" + index + "', String(Date.now())), 1")
  }
  let canaries = false
  for (let i = 0; i < 20 && !canaries; i += 1) {
    await sleep(1000)
    const entries = decryptStore().entries
    canaries = canaryKeys.every((key) => entries[key]?.v)
  }
  check('every shell webview is still mirroring after the sustained writes', canaries)
  const end = await status(main)
  check('the store is not disabled', end.disabled === null, JSON.stringify(end))

  if (!fast) {
    await sleep(65_000)
    const healed = decryptStore().entries['nebula-race-shared']?.v
    // A fresh connection: the old ones may have been dropped while idle.
    for (const cdp of connections.values()) {
      try { cdp.ws.close() } catch { /* already closed */ }
    }
    connections.clear()
    const again = await waitFor('the main page again', (list) => list.find((t) => t.type === 'page' && /^https?:\/\/tauri\.localhost/.test(t.url)))
    const liveShared = (await liveStorage(await connect(again)))['nebula-race-shared']
    check('the contested key is healed by the periodic reconcile', healed === liveShared, `store=${healed} live=${liveShared}`)
  }
} catch (error) {
  check('the live run completed', false, String(error?.stack ?? error))
} finally {
  for (const cdp of connections.values()) {
    try { cdp.ws.close() } catch { /* already closed */ }
  }
  killByExe(exe)
  server.close()
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
