// Live check of the address field's completion and suggestions in the real app: with a seeded history,
// typing the first letters of a site completes its address (the completion selected), Backspace removes it,
// typing on replaces it, the rows mark what matched, and past searches come back as searches.
// Uses a build with its own identity (tauri.perf.conf.json); the identity's data folders are RESET.
//
//   node scripts/address-suggestions-live.mjs <path-to-app.exe>
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'

const exe = process.argv[2]
if (!exe) {
  console.error('usage: node scripts/address-suggestions-live.mjs <app.exe>')
  process.exit(2)
}
const local = join(process.env.LOCALAPPDATA, 'com.nebula.browser.perf')
const exeWin = exe.split('/').join('\\')
const results = []
const check = (name, ok, detail = '') => {
  results.push(Boolean(ok))
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}
const powershell = (script) => spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
const killAll = () =>
  powershell(`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exeWin.replace(/'/g, "''")}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`)
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
async function mainPage(timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const target of (await targets()).filter((t) => t.type === 'page' && t.url.startsWith('http://tauri.localhost'))) {
      try {
        const cdp = new Cdp(target.webSocketDebuggerUrl, { callTimeoutMs: 60_000 })
        await cdp.open()
        if ((await evaluate(cdp, 'window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? null')) === 'main') return cdp
        cdp.ws.close()
      } catch {
        // going away
      }
    }
    await sleep(500)
  }
  throw new Error('no main page')
}

const DAY = 24 * 60 * 60 * 1000
const now = Date.now()
let n = 0
const seed = []
const add = (url, title, daysAgo, times = 1) => {
  for (let i = 0; i < times; i += 1) {
    seed.push({ id: `seed-${(n += 1)}`, url, title, host: new URL(url).hostname.replace(/^www\./, ''), visitedAt: now - daysAgo * DAY - n * 1000 })
  }
}
add('https://www.youtube.com/', 'YouTube', 0, 6)
add('https://www.youtube.com/watch?v=77s19jCbjis', 'Kyouki (Creo - Crazy) Super Low Pitch - YouTube', 1, 2)
add('https://github.com/', 'GitHub', 1, 4)
add('https://www.google.com/search?q=kyouki+crazy', 'kyouki crazy - Google Search', 2, 2)
seed.sort((a, b) => b.visitedAt - a.visitedAt)

killAll()
await sleep(1500)
for (let i = 0; i < 20; i += 1) {
  rmSync(local, { recursive: true, force: true })
  if (!existsSync(local)) break
  await sleep(1000)
}
const scratch = join(process.env.TEMP, 'nebula-address-suggestions')
mkdirSync(scratch, { recursive: true })
const log = openSync(join(scratch, 'app.log'), 'w')
spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0' }, stdio: ['ignore', log, log] })
closeSync(log)
try {
  let main = await mainPage()
  await sleep(6000)
  // The icon YouTube gave when it was visited (a 1 px PNG stands in for it); GitHub has none yet.
  const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
  await evaluate(main, `localStorage.setItem('__nebula_favicon-cache-v1', ${JSON.stringify(JSON.stringify({ version: 1, icons: { 'youtube.com': { icon, at: Date.now() } } }))}); true`)
  await evaluate(main, `localStorage.setItem('nebula-browsing-history-v1', ${JSON.stringify(JSON.stringify({ version: 1, entries: seed }))}); true`)
  await evaluate(main, 'location.reload(); true').catch(() => undefined)
  main.ws.close()
  await sleep(3000)
  main = await mainPage()
  await sleep(5000)
  // The page does not need the real window to be in front.
  await main.call('Emulation.setFocusEmulationEnabled', { enabled: true })

  const selector = "input[role='combobox']"
  const state = () =>
    evaluate(main, `(() => { const i = document.querySelector(${JSON.stringify(selector)}); return JSON.stringify({ value: i?.value, start: i?.selectionStart, end: i?.selectionEnd, focused: document.activeElement === i }) })()`).then(JSON.parse)
  const type = async (text) => {
    for (const character of text) {
      await main.call('Input.insertText', { text: character })
      await sleep(250)
    }
  }
  const key = async (name, code) => {
    await main.call('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: name, windowsVirtualKeyCode: code })
    await main.call('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: code })
    await sleep(250)
  }
  const rows = () =>
    evaluate(main, `JSON.stringify([...document.querySelectorAll('[role=option]')].map((row) => ({ text: row.textContent, bold: [...row.querySelectorAll('b')].map((b) => b.textContent), icons: [...row.querySelectorAll('img')].map((img) => img.src.slice(0, 22)) })))`).then(JSON.parse)

  await evaluate(main, `document.querySelector(${JSON.stringify(selector)}).focus(); true`)
  await sleep(500)
  await type('you')
  const completed = await state()
  check('typing "you" completes the address after the typed text', completed.value === 'youtube.com', JSON.stringify(completed))
  check('the completion is selected', completed.start === 3 && completed.end === 'youtube.com'.length, `${completed.start}-${completed.end}`)
  const list = await rows()
  check('the first row is the site, with the matched letters bold', /YouTube/.test(list[0]?.text ?? '') && list[0].bold.some((text) => /you/i.test(text)), JSON.stringify(list[0]))

  check('the site row shows the icon kept for it, not one from a third party', list[0].icons.length === 1 && list[0].icons[0].startsWith('data:image/png'), JSON.stringify(list[0].icons))
  await key('Backspace', 8)
  const removed = await state()
  check('Backspace removes the completion and does not bring it back', removed.value === 'you', JSON.stringify(removed))

  await type('tu')
  const again = await state()
  check('typing on completes again', again.value === 'youtube.com' && again.start === 5, JSON.stringify(again))

  // Replace everything: a search typed before comes back as a search.
  await evaluate(main, `document.querySelector(${JSON.stringify(selector)}).select(); true`)
  await key('Backspace', 8)
  await type('kyo')
  const searches = await rows()
  check('a past search comes back as a suggestion', searches.some((row) => /kyouki crazy/.test(row.text)), JSON.stringify(searches.map((row) => row.text)))
  check('no address is completed for text that begins no site', (await state()).value === 'kyo')

  await evaluate(main, `document.querySelector(${JSON.stringify(selector)}).select(); true`)
  await key('Backspace', 8)
  await type('crazy kyo')
  const words = await rows()
  check('several words find the page by its title, in any order', words.some((row) => /Kyouki/.test(row.text)), JSON.stringify(words.map((row) => row.text)))
} catch (error) {
  check('the live run completed', false, String(error?.stack ?? error))
} finally {
  killAll()
}
console.log(results.every(Boolean) ? '\nALL CHECKS PASSED' : `\n${results.filter((ok) => !ok).length} CHECK(S) FAILED`)
process.exit(results.every(Boolean) ? 0 : 1)
