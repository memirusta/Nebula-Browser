// Live check that an extension popup which opens a window and closes itself right after (what
// almost every "Sign in" button does: `chrome.tabs.create(...)` then `window.close()`) does not take
// the browser down. The WebView2 runtime crashes (access violation inside its own code) when a new
// window is bound with `SetNewWindow` to an opener that is already gone; the host must open the
// window on its own address instead. Needs the network (the real Proton VPN extension is installed
// from the Chrome Web Store) and a build with its own identity (tauri.perf.conf.json) and the
// `split-driver` feature; the identity's data folders are RESET.
//
//   node scripts/extension-popup-close-live.mjs <app.exe> <identifier>
//
//   A  the popup calls `chrome.tabs.create` and closes itself in the same moment: the app survives
//      and the window is opened on the address.
//   B  the extension's own "Sign in" button (the real flow): the app survives and the sign-in page opens.
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'

const [exe, identifier] = process.argv.slice(2)
if (!exe || !identifier) {
  console.error('usage: node scripts/extension-popup-close-live.mjs <app.exe> <identifier>')
  process.exit(2)
}
const ID = 'jplgfhpmjnbigmhklmmbgecoobifkmpa' // Proton VPN
const local = join(process.env.LOCALAPPDATA, identifier)
const scratch = join(process.env.TEMP, 'nebula-popup-close')
const exeWin = exe.split('/').join('\\')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}
const powershell = (script) => spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const killAll = () =>
  powershell(`
    Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exeWin.replace(/'/g, "''")}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${identifier}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  `)
const appProcesses = () =>
  Number(powershell(`(Get-Process app -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq '${exeWin.replace(/'/g, "''")}' } | Measure-Object).Count`).stdout.trim() || 0)

const environments = () => [join(local, 'EBWebView'), join(local, 'trusted', 'EBWebView')]
async function targets() {
  const all = []
  for (const folder of environments()) {
    const file = join(folder, 'DevToolsActivePort')
    if (!existsSync(file)) continue
    const port = Number.parseInt(readFileSync(file, 'utf8'), 10)
    try {
      for (const target of await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) all.push(target)
    } catch {
      // stale
    }
  }
  return all
}
async function evaluate(cdp, expression, extra = {}) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...extra })
  if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ''}`)
  return result.result.value
}
const call = (main, command, args = {}) =>
  evaluate(main, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)}).then((v) => v, (e) => ({ error: String(e) }))`)

async function mainPage(predicate = null, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const target of (await targets()).filter((t) => t.type === 'page' && t.url.startsWith('http://tauri.localhost'))) {
      try {
        const cdp = new Cdp(target.webSocketDebuggerUrl, { callTimeoutMs: 120_000 })
        await cdp.open()
        if ((await evaluate(cdp, 'window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? null')) === 'main') {
          if (!predicate || predicate(await evaluate(cdp, "window.__TAURI_INTERNALS__.invoke('shell_isolation_status')"))) return cdp
        }
        cdp.ws.close()
      } catch {
        // going away, or between processes
      }
    }
    await sleep(700)
  }
  throw new Error('no main page')
}
const pages = async () => (await targets()).filter((t) => t.type === 'page').map((t) => t.url)

/** Opens the popup and runs `action` in it with a user gesture; the app must stay up. */
async function runInPopup(main, action) {
  const opened = await call(main, 'extension_host_open', { id: ID, kind: 'popup' })
  if (opened?.error) throw new Error(opened.error)
  let popup = null
  for (let i = 0; i < 30 && !popup; i += 1) {
    await sleep(500)
    popup = (await targets()).find((t) => t.type === 'page' && t.url.startsWith(`chrome-extension://${ID}/popup.html`))
  }
  if (!popup) throw new Error('the popup did not open')
  const cdp = new Cdp(popup.webSocketDebuggerUrl, { callTimeoutMs: 60_000 })
  await cdp.open()
  await sleep(2000)
  const before = appProcesses()
  const result = await evaluate(cdp, action, { userGesture: true }).catch((error) => `gone: ${error.message}`)
  return { before, result }
}

killAll()
await sleep(1500)
for (let i = 0; i < 20; i += 1) {
  rmSync(local, { recursive: true, force: true })
  if (!existsSync(local)) break
  await sleep(1000)
}
mkdirSync(scratch, { recursive: true })
const log = openSync(join(scratch, 'app.log'), 'w')
spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0' }, stdio: ['ignore', log, log] })
closeSync(log)
try {
  let main = await mainPage()
  await sleep(5000)
  const download = await call(main, 'extension_download_checked', { id: ID })
  check('the real package downloaded and was verified', !download?.error && download?.compatibility?.sha256?.length === 64, download?.error ?? '')
  const installed = await call(main, 'extension_package_manage', { id: ID, action: 'install', expectedSha256: download.compatibility.sha256 })
  check('the install waits for the isolated shell', installed?.pendingActivation === true, JSON.stringify(installed))
  const switched = await call(main, 'shell_isolation_switch', { target: 'split' })
  check('the migration gate passes', switched === null || switched === undefined, JSON.stringify(switched))
  main = await mainPage((state) => state.mode === 'split' && !state.hydrating && state.pending === null, 180_000)
  let active = null
  for (let i = 0; i < 90 && !active; i += 1) {
    const status = await call(main, 'extension_package_manage', { id: ID, action: 'status' })
    if (status?.installed && status?.enabled) active = status
    else await sleep(2000)
  }
  check('the extension is active in the browsing profile', Boolean(active), JSON.stringify(active))
  await sleep(3000)

  // A: ask for a window and close at the same moment.
  const a = await runInPopup(
    main,
    `(() => { chrome.tabs.create({ url: 'https://example.com/' }).then(() => window.close()); return 'asked' })()`,
  )
  await sleep(8000)
  check('A: the app survives a popup that opens a window and closes itself', appProcesses() >= 1 && a.before >= 1, `processes ${appProcesses()}`)
  check('A: the window it asked for is open on its address', (await pages()).some((url) => url.startsWith('https://example.com/')), JSON.stringify(await pages()))

  // B: the extension's own sign-in button.
  const b = await runInPopup(
    main,
    `(() => { const button = [...document.querySelectorAll('button,a,[role=button]')].find((x) => /sign in|log in|login/i.test(x.textContent || '')); if (!button) return 'no-login-button'; button.click(); return 'clicked' })()`,
  )
  check('B: the sign-in button was found and pressed', b.result === 'clicked', String(b.result))
  await sleep(10_000)
  check('B: the app survives the real sign-in flow', appProcesses() >= 1, `processes ${appProcesses()}`)
  check('B: the sign-in page is open', (await pages()).some((url) => url.startsWith('https://account.proton.me/')), JSON.stringify(await pages()))
} catch (error) {
  check('the live run completed', false, String(error?.stack ?? error))
} finally {
  killAll()
}
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
