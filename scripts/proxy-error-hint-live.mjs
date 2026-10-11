// Live check of the error page's proxy hint: an extension that controls the browser's proxy (the real
// Proton VPN, given a proxy that cannot be reached) makes a page fail; the error page must then say that
// the extension is routing the connection. With the proxy released the same kind of failure must NOT
// carry the hint. Needs the network (Chrome Web Store download) and a build with its own identity
// (tauri.perf.conf.json) and the `split-driver` feature; the identity's data folders are RESET.
//
//   node scripts/proxy-error-hint-live.mjs <app.exe> <identifier>
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'

const [exe, identifier] = process.argv.slice(2)
if (!exe || !identifier) {
  console.error('usage: node scripts/proxy-error-hint-live.mjs <app.exe> <identifier>')
  process.exit(2)
}
const ID = 'jplgfhpmjnbigmhklmmbgecoobifkmpa' // Proton VPN
const local = join(process.env.LOCALAPPDATA, identifier)
const scratch = join(process.env.TEMP, 'nebula-proxy-hint')
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
// A proxy that takes the connection and never answers, like a network that drops the packets to a VPN's servers.
// (A proxy that refuses the connection is no test: the browser then falls back to a direct connection.)
const blackhole = net.createServer((socket) => {
  socket.on('error', () => {})
})
await new Promise((resolve) => blackhole.listen(0, '127.0.0.1', resolve))
const blackholePort = blackhole.address().port
// TEST-NET-1 (RFC 5737) is never routed: connection attempts get no answer, like packets a network drops.
const UNREACHABLE = { host: process.env.PROXY_HOST ?? '192.0.2.1', port: Number(process.env.PROXY_PORT ?? 8080) }
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
async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
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

/** The error page of a tab and what its proxy hint says (null: no hint), waiting up to `seconds` for the page. */
async function errorPage(seconds, expectHint, ignore = new Set()) {
  const deadline = Date.now() + seconds * 1000
  let last = { found: false, hint: null }
  while (Date.now() < deadline) {
    for (const target of (await targets()).filter((t) => t.type === 'page' && t.url.startsWith('data:text/html') && !ignore.has(t.id))) {
      try {
        const cdp = new Cdp(target.webSocketDebuggerUrl, { callTimeoutMs: 20_000 })
        await cdp.open()
        const state = await evaluate(cdp, `JSON.stringify({ retry: !!document.getElementById('retry'), hint: document.getElementById('proxy-hint')?.textContent ?? null })`)
        cdp.ws.close()
        const parsed = JSON.parse(state)
        if (parsed.retry) {
          last = { found: true, hint: parsed.hint }
          if (expectHint ? parsed.hint : false) return last
        }
      } catch {
        // page changing
      }
    }
    await sleep(700)
  }
  return last
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
const env = { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0' }
spawn(exe, [], { env, stdio: ['ignore', log, log] })
closeSync(log)
try {
  let main = await mainPage()
  await sleep(5000)
  const download = await call(main, 'extension_download_checked', { id: ID })
  await call(main, 'extension_package_manage', { id: ID, action: 'install', expectedSha256: download.compatibility.sha256 })
  await call(main, 'shell_isolation_switch', { target: 'split' })
  main = await mainPage((state) => state.mode === 'split' && !state.hydrating && state.pending === null, 180_000)
  let active = null
  for (let i = 0; i < 90 && !active; i += 1) {
    const status = await call(main, 'extension_package_manage', { id: ID, action: 'status' })
    if (status?.installed && status?.enabled) active = status
    else await sleep(2000)
  }
  check('the real extension is active in the browsing profile', Boolean(active), JSON.stringify(active))
  await sleep(3000)

  // Wake the extension's worker (opening its popup does), then make it control a proxy nobody listens on.
  await call(main, 'extension_host_open', { id: ID, kind: 'popup' })
  await sleep(5000)
  const worker = (await targets()).find((t) => t.type === 'service_worker' && t.url.includes(ID))
  const sw = new Cdp(worker.webSocketDebuggerUrl, { callTimeoutMs: 60_000 })
  await sw.open()
  const setProxy = await evaluate(
    sw,
    `new Promise((resolve) => chrome.proxy.settings.set({ value: { mode: 'fixed_servers', rules: { singleProxy: { scheme: 'http', host: '${UNREACHABLE.host}', port: ${UNREACHABLE.port} } } }, scope: 'regular' }, () => resolve(chrome.runtime.lastError ? 'error: ' + chrome.runtime.lastError.message : 'set')))`,
  )
  check('the extension controls a proxy that never answers', setProxy === 'set', setProxy)

  // A real tab: a second launch with a URL hands it to the running app, like a link the user opens.
  spawn(exe, ['http://example.com/'], { env, stdio: 'ignore' })
  const withHint = await errorPage(150, true)
  check('the page fails and Nebula shows its error page', withHint.found)
  if (!withHint.found) console.log('INFO page targets:', JSON.stringify((await targets()).filter((t) => t.type === 'page').map((t) => t.url.slice(0, 80))))
  check('the error page names the extension and the proxy', Boolean(withHint.hint) && /Proton/i.test(withHint.hint ?? '') && /proxy/i.test(withHint.hint ?? ''), String(withHint.hint))

  // Released: the same kind of failure must not carry the hint (the answer is kept for 20 s, so wait it out).
  await evaluate(sw, `new Promise((resolve) => chrome.proxy.settings.clear({ scope: 'regular' }, () => resolve('cleared')))`)
  await sleep(23_000)
  const earlier = new Set((await targets()).filter((t) => t.url.startsWith('data:text/html')).map((t) => t.id))
  spawn(exe, ['http://127.0.0.1:9/'], { env, stdio: 'ignore' })
  await sleep(12_000)
  const without = await errorPage(25, false, earlier)
  check('a failure with no proxy extension in control shows the error page without the hint', without.found && without.hint === null, JSON.stringify(without))
} catch (error) {
  check('the live run completed', false, String(error?.stack ?? error))
} finally {
  killAll()
  blackhole.close()
}
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
