// Drives the Settings row of the opt-in split through the real UI (DevTools on the page,
// not the screen): Settings -> Extensions -> "Turn on and restart" -> the app's own
// confirmation -> restart -> split; and the way back. Also checks the notice after a
// rolled-back switch. Use a build with its own identity (tauri.perf.conf.json); the
// identity's data folders are reset first.
//
//   node scripts/shell-isolation-ui-live.mjs <path-to-app.exe> <identifier>
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'

const [exe, identifier] = process.argv.slice(2)
if (!exe || !identifier) {
  console.error('usage: node scripts/shell-isolation-ui-live.mjs <app.exe> <identifier>')
  process.exit(2)
}
const local = join(process.env.LOCALAPPDATA, identifier)
const roaming = join(process.env.APPDATA, identifier)
const markerFile = join(local, 'shell-isolation.json')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}
const powershell = (script) => spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
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

const environments = [join(local, 'EBWebView'), join(local, 'trusted', 'EBWebView')]
async function targets() {
  const all = []
  for (const folder of environments) {
    const file = join(folder, 'DevToolsActivePort')
    if (!existsSync(file)) continue
    const port = Number.parseInt(readFileSync(file, 'utf8'), 10)
    try {
      for (const target of await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) all.push(target)
    } catch {
      // a stale file
    }
  }
  return all
}
const open = []
async function page(label, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const target of (await targets()).filter((t) => t.type === 'page' && t.url.startsWith('http://tauri.localhost'))) {
      try {
        const cdp = new Cdp(target.webSocketDebuggerUrl, { callTimeoutMs: 30_000 })
        await cdp.open()
        open.push(cdp)
        const value = await evaluate(cdp, `window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? null`)
        if (value === label) return cdp
        cdp.ws.close()
      } catch {
        // going away
      }
    }
    await sleep(500)
  }
  throw new Error(`no ${label} page`)
}
function dropConnections() {
  for (const cdp of open.splice(0)) {
    try { cdp.ws.close() } catch { /* gone */ }
  }
}
async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? ''}`)
  return result.result.value
}
async function until(what, probe, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (value) return value
    } catch {
      // not yet
    }
    await sleep(400)
  }
  throw new Error(`${what} did not happen`)
}
async function afterRestart(predicate) {
  dropConnections()
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const main = await page('main', 8_000)
      const state = await evaluate(main, "window.__TAURI_INTERNALS__.invoke('shell_isolation_status')")
      if (predicate(state)) return main
    } catch {
      // between processes
    }
    dropConnections()
    await sleep(700)
  }
  throw new Error('the restarted app did not reach the expected state')
}
let spawned
function launch() {
  spawned = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0' }, stdio: 'ignore' })
}

/** Opens Settings (button in the chrome overlay) and the Extensions category (in main). */
async function openExtensionsSettings(main) {
  const chrome = await page('nebula-chrome')
  await evaluate(chrome, `[...document.querySelectorAll('button')].find((b) => ['Ayarlar', 'Settings'].includes(b.getAttribute('aria-label') || ''))?.click()`)
  await until('the Settings dialog', () => evaluate(main, `!!document.querySelector('[role="dialog"][aria-label="Ayarlar"], [role="dialog"][aria-label="Settings"]')`))
  await evaluate(main, `[...document.querySelectorAll('[role="dialog"] button')].find((b) => /(Extensions|Eklentiler)$/.test((b.textContent || '').trim()))?.click()`)
  await until('the Extensions section', () => evaluate(main, `!!document.querySelector('[data-extension-explorer]')`))
}
const rowText = (main) => evaluate(main, `(() => { const rows = [...document.querySelectorAll('[role="dialog"] div')].filter((d) => /Keep Nebula|Nebula ekranlarını/.test(d.textContent || "") && d.querySelector("button")); rows.sort((a, b) => a.textContent.length - b.textContent.length); return rows[0] ? rows[0].textContent : null })()`)
const clickRowButton = (main, labels) => evaluate(main, `(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => ${JSON.stringify(labels)}.some((l) => (x.textContent || '').trim() === l)); if (!b) return 'no button'; if (b.disabled) return 'disabled'; b.click(); return 'clicked' })()`)
const confirmDialog = (main) => evaluate(main, `(() => { const all = [...document.querySelectorAll('[role="alertdialog"] button')]; const el = all[all.length - 1]; if (!el) return 'no dialog'; el.click(); return 'clicked' })()`)

try {
  await resetFixture()
  launch()
  let main = await page('main')
  await sleep(4000)
  await openExtensionsSettings(main)
  await until('the isolation row', () => rowText(main))
  check('the row is in Settings > Extensions and says it is off', /Off|Kapalı/.test((await rowText(main)) ?? ''), (await rowText(main) ?? '').slice(-120))

  let r = await clickRowButton(main, ['Turn on and restart', 'Aç ve yeniden başlat'])
  check('the enable button is clickable', r === 'clicked', r)
  await until('the confirmation', () => evaluate(main, `!!document.querySelector('[role="alertdialog"]')`))
  const message = await evaluate(main, `document.querySelector('[role="alertdialog"]').textContent`)
  check('the app asks before restarting', /restart|yeniden/i.test(message), message.slice(0, 120))
  r = await confirmDialog(main)
  check('the confirmation is accepted', r === 'clicked', r)

  main = await afterRestart((s) => s.mode === 'split' && !s.hydrating && s.pending === null)
  check('Nebula restarted into the split environment through the UI', true)
  await sleep(5000)
  await openExtensionsSettings(main)
  await until('the isolation row', () => rowText(main))
  check('the row now says it is on, with a way back', /On|Açık/.test((await rowText(main)) ?? '') && /Turn off|Kapat/.test((await rowText(main)) ?? ''), (await rowText(main) ?? '').slice(-120))
  r = await clickRowButton(main, ['Turn off and restart', 'Kapat ve yeniden başlat'])
  await until('the confirmation', () => evaluate(main, `!!document.querySelector('[role="alertdialog"]')`))
  await confirmDialog(main)
  main = await afterRestart((s) => s.mode === 'single' && !s.hydrating && s.pending === null)
  check('the way back works through the UI', true)

  // A rolled-back switch is announced once.
  dropConnections()
  killAll()
  await sleep(2500)
  const marker = JSON.parse(readFileSync(markerFile, 'utf8'))
  writeFileSync(markerFile, JSON.stringify({ ...marker, pending: 'split', attempts: 0, expected: { storeGeneration: 1, keyCount: 1, digest: '0'.repeat(64) } }))
  launch()
  main = await page('main')
  await until('the notice dialog', () => evaluate(main, `!!document.querySelector('[role="alertdialog"]')`), 30_000)
  const notice = await evaluate(main, `document.querySelector('[role="alertdialog"]').textContent`)
  check('a switch that did not verify is announced once', /could not be verified|doğrulanamadı/.test(notice), notice.slice(0, 160))
  const status = await evaluate(main, "window.__TAURI_INTERNALS__.invoke('shell_isolation_status')")
  check('and the notice is cleared so it is not shown again', status.notice === null, JSON.stringify(status))
} catch (error) {
  check('the live run completed', false, String(error?.stack ?? error))
} finally {
  dropConnections()
  killAll()
}
const failed = results.filter((x) => !x.ok)
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
