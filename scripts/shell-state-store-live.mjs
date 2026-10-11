// Live check of the shell state mirror against a real Nebula build (use a build with
// its own identity, e.g. `tauri build --config src-tauri/tauri.perf.conf.json`, so the
// normal profile is not touched):
//
//   node scripts/shell-state-store-live.mjs <path-to-app.exe> <identifier> [port]
//
// It starts the app with a DevTools port on the shell, writes localStorage keys through
// the page, kills the app, decrypts the store file with DPAPI (as the same user) and
// compares it with what localStorage held. Then it starts the app again and checks the
// store was loaded. Exit code 0 only if every check passed.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
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
  console.error('usage: node scripts/shell-state-store-live.mjs <app.exe> <identifier> [port]')
  process.exit(2)
}
const port = Number(portArg ?? 9347)
const storeDir = join(process.env.LOCALAPPDATA, identifier)
const storeFile = join(storeDir, 'shell-state.v1.dpapi')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}

function start() {
  const child = spawn(exe, [], {
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}` },
    stdio: 'ignore',
  })
  return child
}

async function shellTarget(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && /^https?:\/\/tauri\.localhost/.test(t.url))
      if (page) return page
    } catch {
      // not up yet
    }
    await sleep(500)
  }
  throw new Error('the shell page did not appear')
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + JSON.stringify(result.exceptionDetails.exception?.description))
  return result.result.value
}

const invokeStatus = `window.__TAURI_INTERNALS__.invoke('shell_store_status')`
const snapshotExpression = `(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; })()`

function decryptStore() {
  const script = `
    Add-Type -AssemblyName System.Security
    $bytes = [IO.File]::ReadAllBytes('${storeFile.replace(/'/g, "''")}')
    $plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, 'CurrentUser')
    [Convert]::ToBase64String($plain)
  `
  const run = spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(run.stderr || 'could not decrypt the store')
  // Base64 keeps the bytes intact: the console code page would mangle non-ASCII text.
  return JSON.parse(Buffer.from(run.stdout.trim(), 'base64').toString('utf8'))
}

function stop(child) {
  killByExe(exe)
}

if (existsSync(storeFile)) {
  rmSync(storeFile, { force: true })
  rmSync(`${storeFile}.bak`, { force: true })
}

// ---- first run -------------------------------------------------------------------
killByExe(exe)
let child = start()
let live
let status
try {
  const target = await shellTarget()
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await sleep(1500)

  await evaluate(cdp, `localStorage.setItem('nebula-live-check-a', 'alpha-ü-\u{1F600}'), 1`)
  await evaluate(cdp, `localStorage.setItem('nebula-live-check-b', 'beta'), 1`)
  await evaluate(cdp, `localStorage.setItem('nebula-browser-run-state-v1', '{"live":"check"}'), 1`)
  await evaluate(cdp, `localStorage.setItem('nebula-live-check-big', 'x'.repeat(2 * 1024 * 1024 + 10)), 1`)
  await sleep(1500)
  await evaluate(cdp, `localStorage.removeItem('nebula-live-check-b'), 1`)
  await sleep(1500)

  status = await evaluate(cdp, invokeStatus)
  live = await evaluate(cdp, snapshotExpression)
  check('the shell can reach the store commands', typeof status?.generation === 'number', JSON.stringify(status))
  check('the store was written (generation advanced)', status.generation > 0)
  cdp.ws.close()
} catch (error) {
  check('first run completed', false, String(error))
} finally {
  stop(child)
}
await sleep(1500)

if (live && existsSync(storeFile)) {
  const raw = readFileSync(storeFile)
  check('the file on disk is not plain text', !raw.includes(Buffer.from('nebula-live-check-a')) && !raw.includes(Buffer.from('"entries"')))
  const doc = decryptStore()
  const entries = doc.entries
  const keys = Object.keys(live).filter((k) => k !== 'nebula-browser-run-state-v1' && k !== 'nebula-live-check-big' && !k.startsWith('__nebula_'))
  const missing = keys.filter((k) => entries[k]?.v !== live[k])
  check('every live key (but the excluded and oversized) is in the store with the same value', missing.length === 0, missing.join(', '))
  check('the crash marker is not in the store', !('nebula-browser-run-state-v1' in entries))
  check('an oversized value is not in the store', !entries['nebula-live-check-big'])
  check('a removed key is a tombstone, not a value', entries['nebula-live-check-b'] && entries['nebula-live-check-b'].v === null)
  check('non-ASCII values survive', entries['nebula-live-check-a']?.v === live['nebula-live-check-a'])
  check('schema and checksum fields are present', doc.schema === 1 && typeof doc.checksum === 'string' && doc.checksum.length === 64)
  check('the store has the key count the app reported', Object.values(entries).filter((e) => e.v !== null).length === status.keyCount)
} else {
  check('a store file exists after the first run', false, storeFile)
}

// ---- second run ------------------------------------------------------------------
child = start()
try {
  const target = await shellTarget()
  const cdp = new Cdp(target.webSocketDebuggerUrl)
  await cdp.open()
  await sleep(6000) // past the first reconcile
  const again = await evaluate(cdp, invokeStatus)
  check('a restarted app loads the store', again.generation >= status.generation && again.keyCount >= status.keyCount - 1, JSON.stringify(again))
  check('an unchanged start does not rewrite the store', again.generation - status.generation <= 3, `generation ${status.generation} -> ${again.generation}`)
  // The factory reset path: the shell asks for a wipe and nothing of the store is left.
  await evaluate(cdp, `window.__TAURI_INTERNALS__.invoke('shell_store_wipe').then(() => 1)`)
  const wiped = await evaluate(cdp, invokeStatus)
  check('a wipe empties the store and removes its files', wiped.keyCount === 0 && wiped.generation === 0 && !existsSync(storeFile) && !existsSync(`${storeFile}.bak`), JSON.stringify(wiped))
  cdp.ws.close()
} catch (error) {
  check('second run completed', false, String(error))
} finally {
  stop(child)
}

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
