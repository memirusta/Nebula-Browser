// Live check, on a real Nebula build with its own identity (tauri.perf.conf.json; its data folders are reset): a
// link that opens in a new tab and answers with a file must not leave that tab behind, the download must still
// complete, and the page the user came from must be shown again. A window is shown for about a minute.
//
//   node scripts/download-tab-live.mjs <path-to-app.exe>
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'

const exe = process.argv[2]
if (!exe) {
  console.error('usage: node scripts/download-tab-live.mjs <app.exe>')
  process.exit(2)
}
const identifier = 'com.nebula.browser.perf'
const local = join(process.env.LOCALAPPDATA, identifier)
const exeWin = exe.split('/').join('\\')
const ps = (script) => spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}
const killAll = () =>
  ps(`
    Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exeWin.replace(/'/g, "''")}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${identifier}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  `)
const environments = () => [join(local, 'EBWebView'), join(local, 'trusted', 'EBWebView')]
async function targets() {
  const all = []
  for (const folder of environments()) {
    const file = join(folder, 'DevToolsActivePort')
    if (!existsSync(file)) continue
    const port = Number.parseInt(readFileSync(file, 'utf8'), 10)
    try {
      for (const target of await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) all.push(target)
    } catch { /* stale */ }
  }
  return all
}
async function evaluate(cdp, expression) {
  const r = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}
async function connect(match, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const target of await targets()) {
      if (target.type !== 'page' || !match(target)) continue
      try {
        const cdp = new Cdp(target.webSocketDebuggerUrl, { callTimeoutMs: 30_000 })
        await cdp.open()
        if (JSON.parse(await evaluate(cdp, `JSON.stringify({ ready: document.readyState })`)).ready === 'complete') return cdp
        cdp.ws.close()
      } catch { /* going away */ }
    }
    await sleep(300)
  }
  return null
}
const invoke = (cdp, command, args = {}) =>
  evaluate(cdp, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)}).then((v) => JSON.stringify(v ?? null))`).then((text) => JSON.parse(text))

const fileName = `nebula-live-${Date.now()}.bin`
const downloaded = join(homedir(), 'Downloads', fileName)
const site = createServer((request, response) => {
  const url = request.url ?? '/'
  if (url.startsWith('/file')) {
    response.setHeader('content-type', 'application/octet-stream')
    response.setHeader('content-disposition', `attachment; filename="${fileName}"`)
    response.end(Buffer.alloc(100 * 1024, 7))
  } else if (url.startsWith('/page2')) {
    response.setHeader('content-type', 'text/html')
    response.end('<!doctype html><title>Second page</title><body>second</body>')
  } else {
    response.setHeader('content-type', 'text/html')
    response.end('<!doctype html><title>Start page</title><body><a id="d" target="_blank" href="/file">download</a> <a id="p" target="_blank" href="/page2">page</a></body>')
  }
})
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve))
const origin = `http://127.0.0.1:${site.address().port}`

killAll()
await sleep(2000)
for (let i = 0; i < 10; i += 1) { rmSync(local, { recursive: true, force: true }); if (!existsSync(local)) break; await sleep(1000) }
const app = spawn(exe, [], { env: { ...process.env, NEBULA_SHELL_ISOLATION: 'split', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0' }, stdio: 'ignore' })
try {
  const main = await connect((t) => t.url.startsWith('http://tauri.localhost') && !t.url.includes('#chrome'))
  check('the shell starts', main !== null)
  if (!main) throw new Error('no shell')
  await sleep(2500)
  spawn(exe, [`${origin}/`], { env: { ...process.env, NEBULA_SHELL_ISOLATION: 'split' }, stdio: 'ignore' })
  let tab = null
  for (let waited = 0; waited < 40_000 && !tab; waited += 1000) {
    tab = await connect((t) => t.url.startsWith(`${origin}/`), 1500)
    if (!tab && waited === 15_000) spawn(exe, [`${origin}/`], { stdio: 'ignore' })
  }
  check('the start page is shown in a tab', tab !== null)
  if (!tab) throw new Error('no tab')
  await sleep(2500)
  const tabs = async () => (await invoke(main, 'webview_layout_audit', { windowLabel: 'main' })).hosts.filter((h) => h.label.startsWith('nebula-tab-') && h.visible && h.width > 100)
  const before = await tabs()
  check('one tab is shown', before.length === 1, JSON.stringify(before.map((h) => h.label.slice(-8))))

  // 1. A link that opens in a new tab and answers with a file.
  await evaluate(tab, `document.getElementById('d').click()`)
  let file = false
  for (let waited = 0; waited < 20_000; waited += 500) {
    await sleep(500)
    if (existsSync(downloaded) && statSync(downloaded).size === 100 * 1024) { file = true; break }
  }
  check('the file is downloaded completely', file, downloaded)
  await sleep(2500)
  const after = await tabs()
  check('no tab is left behind by the download, and the start page is shown again', after.length === 1 && after[0].label === before[0].label, JSON.stringify(after.map((h) => h.label.slice(-8))))
  const urls = (await targets()).filter((t) => t.type === 'page' && t.url.startsWith(origin)).map((t) => t.url)
  check('only the start page is open', urls.length === 1 && urls[0] === `${origin}/`, JSON.stringify(urls))

  // 2. A link that opens in a new tab and answers with a page keeps that tab.
  await evaluate(tab, `document.getElementById('p').click()`)
  await sleep(3500)
  const withPage = await tabs()
  check('a new tab that shows a page is kept', withPage.length === 1 && withPage[0].label !== before[0].label, JSON.stringify(withPage.map((h) => h.label.slice(-8))))
  const second = (await targets()).filter((t) => t.type === 'page' && t.url.startsWith(`${origin}/page2`)).length
  check('and that page is open', second === 1, String(second))
} catch (error) {
  check('the run completed', false, String(error?.message ?? error))
} finally {
  killAll()
  site.close()
  rmSync(downloaded, { force: true })
}
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\nALL CHECKS PASSED (${results.length})` : `\n${failed.length} of ${results.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
