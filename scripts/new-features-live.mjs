// Live check of the 2026-10-06 shell changes on a real Nebula build with its own identity
// (tauri.perf.conf.json; its data folders are reset): the scale readout of the layout audit, the overlay
// clip that lets clicks through to the page, the camera/microphone bubble, the chip for a tab a page
// opened, the Forward button, the dome after minimize/restore, the history logos, and the overlay menu's
// panels no longer bringing Semi-Lunar back over its buttons.
//
//   node scripts/new-features-live.mjs <path-to-app.exe> [label]
//
// Run it on the build under test and, as a contrast, on one from before the changes: the checks that need
// the new code fail there on purpose. A window is shown for about two minutes; do not touch the mouse.
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'

const exe = process.argv[2]
const label = process.argv[3] ?? 'build'
if (!exe) {
  console.error('usage: node scripts/new-features-live.mjs <app.exe> [label]')
  process.exit(2)
}
const identifier = 'com.nebula.browser.perf'
const local = join(process.env.LOCALAPPDATA, identifier)
const exeWin = exe.split('/').join('\\')
const ps = (script) => spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const win32 = `
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public class W {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  public static IntPtr Top(uint pid) { IntPtr f = IntPtr.Zero; EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (p != pid) return true; var c = new StringBuilder(128); GetClassName(h, c, 128); if (c.ToString() == "Tauri Window") { var t = new StringBuilder(128); GetWindowText(h, t, 128); if (t.ToString() == "Nebula") { f = h; return false; } } return true; }, IntPtr.Zero); return f; }
  // Direct webview hosts: "hwnd:x,y,w,h,visible;" (client coordinates of the window, which is maximized).
  public static string Hosts(uint pid) {
    SetProcessDPIAware();
    var sb = new StringBuilder(); IntPtr top = Top(pid); if (top == IntPtr.Zero) return "";
    POINT o; o.X = 0; o.Y = 0; RECT tr; GetWindowRect(top, out tr);
    EnumChildWindows(top, (ch, l) => { if (GetParent(ch) != top) return true; var cc = new StringBuilder(128); GetClassName(ch, cc, 128); if (cc.ToString() == "WRY_WEBVIEW") { RECT q; GetWindowRect(ch, out q); sb.Append(ch.ToInt64().ToString("x") + ":" + q.L + "," + q.T + "," + (q.R - q.L) + "," + (q.B - q.T) + "," + (IsWindowVisible(ch) ? 1 : 0) + ";"); } return true; }, IntPtr.Zero);
    return sb.ToString();
  }
  // The direct webview host of the window under a screen point.
  public static string HostAt(uint pid, int x, int y) {
    SetProcessDPIAware();
    IntPtr top = Top(pid); if (top == IntPtr.Zero) return "notop";
    POINT p; p.X = x; p.Y = y; IntPtr h = WindowFromPoint(p);
    while (h != IntPtr.Zero && GetParent(h) != top) h = GetParent(h);
    return h == IntPtr.Zero ? "other" : h.ToInt64().ToString("x");
  }
  public static void Front(uint pid) { IntPtr top = Top(pid); ShowWindow(top, 3); SetForegroundWindow(top); }
  public static void Cycle(uint pid, int hold) { IntPtr top = Top(pid); ShowWindow(top, 6); System.Threading.Thread.Sleep(hold); ShowWindow(top, 9); }
}
"@
`
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
const hosts = (pid) =>
  ps(`${win32}; [W]::Hosts(${pid})`).stdout.trim().split(';').filter(Boolean).map((part) => {
    const [id, rest] = part.split(':')
    const [x, y, width, height, visible] = rest.split(',').map(Number)
    return { id, x, y, width, height, visible: visible === 1 }
  })
const front = (pid) => ps(`${win32}; [W]::Front(${pid})`)
const hostAt = (pid, x, y) => ps(`${win32}; [W]::Front(${pid}); [W]::HostAt(${pid}, ${x}, ${y})`).stdout.trim()
const overlayHost = (pid, wantedHeight) => hosts(pid).find((host) => host.width >= 1900 && host.x === 0 && host.y === 0 && (wantedHeight ? host.height === wantedHeight : host.height < 400))

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
        const state = JSON.parse(await evaluate(cdp, `JSON.stringify({ ready: document.readyState, children: document.getElementById('root')?.children.length ?? 0 })`))
        if (state.ready === 'complete') return { cdp, target }
        cdp.ws.close()
      } catch { /* going away */ }
    }
    await sleep(300)
  }
  return null
}
const invoke = (cdp, command, args = {}) =>
  evaluate(cdp, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)}).then((v) => JSON.stringify(v ?? null))`).then((text) => JSON.parse(text))
const emit = (cdp, event, payload) => invoke(cdp, 'plugin:event|emit', { event, payload })

const site = createServer((request, response) => {
  response.setHeader('content-type', 'text/html')
  const url = request.url ?? '/'
  if (url.startsWith('/b')) {
    response.end('<!doctype html><title>Page B</title><body style="margin:0"><a id="n" href="/c">to C</a><div style="height:3000px">B</div></body>')
  } else if (url.startsWith('/c')) {
    response.end('<!doctype html><title>Page C</title><body style="margin:0"><div style="height:3000px">C</div></body>')
  } else {
    response.end('<!doctype html><title>Page A</title><body style="margin:0"><div style="background:#fa0;height:60px">TOP</div><a id="l" target="_blank" href="/b">open B</a><div style="height:3000px">A</div></body>')
  }
})
await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve))
const port = site.address().port
const origin = `http://127.0.0.1:${port}`

console.log(`\n=== ${label}: ${exe}`)
killAll()
await sleep(2000)
for (let i = 0; i < 10; i += 1) { rmSync(local, { recursive: true, force: true }); if (!existsSync(local)) break; await sleep(1000) }
const app = spawn(exe, [], {
  env: { ...process.env, NEBULA_SHELL_ISOLATION: 'split', WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0' },
  stdio: 'ignore',
})
const pid = app.pid
let main = null
let chrome = null
try {
  main = await connect((t) => t.url.startsWith('http://tauri.localhost') && !t.url.includes('#chrome'))
  check('the shell starts', main !== null)
  if (!main) throw new Error('no shell')
  await sleep(2500)
  ps(`${win32}; $t = [W]::Top(${pid}); [W]::ShowWindow($t, 3) | Out-Null; [W]::SetForegroundWindow($t) | Out-Null`)
  spawn(exe, [`${origin}/`], { env: { ...process.env, NEBULA_SHELL_ISOLATION: 'split' }, stdio: 'ignore' })
  let present = []
  for (let waited = 0; waited < 40_000; waited += 1000) {
    await sleep(1000)
    present = hosts(pid)
    if (present.length >= 3) break
    if (waited === 15_000) spawn(exe, [`${origin}/`], { stdio: 'ignore' })
  }
  await sleep(3000)
  chrome = await connect((t) => t.url.includes('#chrome'), 30_000)
  check('a site is shown and the Semi-Lunar surface exists', hosts(pid).length >= 3 && chrome !== null, JSON.stringify(hosts(pid).map((h) => [h.width, h.height])))
  if (!chrome) throw new Error('no chrome surface')
  const tabPage = await connect((t) => t.url.startsWith(`${origin}/`), 20_000)
  const audit = await invoke(main.cdp, 'webview_layout_audit', { windowLabel: 'main' })
  const tabLabel = audit.hosts.find((h) => h.label.startsWith('nebula-tab-') && h.visible)?.label ?? ''

  // 1. The audit reads the scale of every webview and the window's DPI.
  const scaleReadable = typeof audit.windowDpi === 'number' && audit.windowDpi > 0 && audit.hosts.filter((h) => h.visible).every((h) => typeof h.rasterScale === 'number' && h.rasterScale > 0)
  check('the layout audit reports the window DPI and each visible webview\'s scale', scaleReadable, `dpi ${audit.windowDpi}, ${JSON.stringify(audit.hosts.filter((h) => h.visible).map((h) => h.rasterScale))}`)
  if (scaleReadable) {
    check('every visible webview draws at its window\'s scale', audit.hosts.filter((h) => h.visible).every((h) => Math.abs(h.rasterScale - audit.windowDpi / 96) <= 0.01))
    const changed = await invoke(main.cdp, 'webview_resync_scale', { windowLabel: 'main' }).catch((error) => `error: ${error.message}`)
    check('resyncing a correct scale changes nothing', changed === 0, String(changed))
  }

  // 2. The overlay clip: a tall overlay where only a strip and a bubble belong to it.
  const clientWidth = audit.clientWidth
  await invoke(chrome.cdp, 'webview_set_chrome_bounds', { windowLabel: 'main', x: 0, y: 0, width: clientWidth, height: 78 })
  await sleep(500)
  const tall = overlayHost(pid, 78)
  check('a 78 px overlay takes clicks in its whole band (the problem)', Boolean(tall) && hostAt(pid, 500, 40) === tall?.id, tall ? tall.id : 'not 78 tall')
  if (tall) {
    const applied = await invoke(chrome.cdp, 'webview_set_chrome_clip', {
      windowLabel: 'main',
      rects: [{ x: 0, y: 0, width: 32000, height: 10 }, { x: 1500, y: 14, width: 300, height: 40 }],
    }).catch((error) => `error: ${error.message}`)
    await sleep(400)
    check('the clip command is accepted', applied === true, String(applied))
    check('outside the clip the page gets the click', hostAt(pid, 500, 40) !== tall.id, hostAt(pid, 500, 40))
    check('inside the bubble rectangle the overlay still gets it', hostAt(pid, 1600, 30) === tall.id)
    check('the strip at the top edge still belongs to the overlay', hostAt(pid, 500, 5) === tall.id)
    await invoke(chrome.cdp, 'webview_set_chrome_clip', { windowLabel: 'main', rects: null }).catch(() => undefined)
    await sleep(400)
    check('lifting the clip gives the whole band back', hostAt(pid, 500, 40) === tall.id)
    const refused = await invoke(chrome.cdp, 'webview_set_chrome_clip', { windowLabel: 'main', rects: [] }).then(() => false, () => true)
    check('an empty clip is refused', refused)
  }
  await invoke(chrome.cdp, 'webview_set_chrome_bounds', { windowLabel: 'main', x: 0, y: 0, width: clientWidth, height: 10 })
  await sleep(500)

  // 3. The dome after minimize / restore.
  const dome = () => evaluate(chrome.cdp, `JSON.stringify([...document.querySelectorAll('[class]')].filter((e) => /lunarGlass/.test(String(e.className))).map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)] }))`).then(JSON.parse)
  const before = await dome()
  for (let i = 0; i < 4; i += 1) {
    ps(`${win32}; [W]::Cycle(${pid}, ${i % 2 === 0 ? 400 : 60})`)
    await sleep(900)
  }
  await sleep(1500)
  const after = await dome()
  check('the dome has the same size after minimizing and restoring the window several times', before.length > 0 && JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} -> ${JSON.stringify(after)}`)

  // 4. The camera/microphone bubble.
  const payload = { tabLabel, origin, camera: false, microphone: true, location: false, screen: false }
  const emitted = await emit(chrome.cdp, 'nebula-sensitive-feature-usage', payload).then(() => true, () => false)
  await sleep(1200)
  const bubble = () => evaluate(chrome.cdp, `JSON.stringify((() => { const e = [...document.querySelectorAll('[class]')].find((x) => /privacyIndicator/.test(String(x.className)) && !/privacyIndicator(Body|Icons|Site|Features)/.test(String(x.className))); if (!e) return null; const r = e.getBoundingClientRect(); return { compact: /Compact/.test(String(e.className)), x: r.left, y: r.top, w: r.width, h: r.height } })())`).then(JSON.parse)
  const full = await bubble()
  check('something starts being used: the bubble is shown in full first', emitted && full !== null && full.compact === false && full.w > 150, JSON.stringify(full))
  await sleep(6000)
  const small = await bubble()
  check('then it shrinks to the small form (icons only)', small !== null && small.compact === true && small.w < 90, JSON.stringify(small))
  const strip = overlayHost(pid)
  const band = strip ? strip.height : 0
  check('the small bubble fits inside the overlay at its full height (nothing is cut off)', band >= 78 && Boolean(small) && small.y + small.h <= band, `band ${band}px, bubble ${JSON.stringify(small)}`)
  check('the page is clickable beside the small bubble (band left of it)', Boolean(small) && hostAt(pid, 500, 30) !== strip?.id, hostAt(pid, 500, 30))
  check('the small bubble itself is still reachable', Boolean(small && strip) && hostAt(pid, Math.round(small.x + small.w / 2), Math.round(small.y + small.h / 2)) === strip.id)
  await emit(chrome.cdp, 'nebula-sensitive-feature-usage', { ...payload, microphone: false })
  await sleep(1500)
  check('when nothing is used any more the bubble goes and the overlay is a strip again', (await bubble()) === null && (overlayHost(pid)?.height ?? 0) <= 12, `${overlayHost(pid)?.height}px`)

  // 5. A tab a page opened: the menu opens for a moment and the new tab's icon is highlighted.
  if (tabPage) {
    ps(`${win32}; [W]::SetCursorPos(960, 700) | Out-Null`)
    await evaluate(tabPage.cdp, `document.getElementById('l').click()`)
    const peekState = () => evaluate(chrome.cdp, `JSON.stringify({ highlighted: [...document.querySelectorAll('[class]')].filter((x) => /shortcutSpawned/.test(String(x.className))).length, dome: [...document.querySelectorAll('[class]')].some((x) => /browsingChromeExpanded/.test(String(x.className))) })`).then(JSON.parse)
    let seen = null
    for (let waited = 0; waited < 3000; waited += 250) {
      await sleep(250)
      const state = await peekState()
      if (state.highlighted > 0) { seen = state; break }
    }
    check('a tab a page opened: the menu opens and exactly one icon is highlighted', seen !== null && seen.highlighted === 1, JSON.stringify(seen))
    check('the menu is open while it is shown (the overlay is tall)', (overlayHost(pid)?.height ?? 0) > 60, `${overlayHost(pid)?.height}px`)
    await sleep(4500)
    const after = await peekState()
    check('after a couple of seconds the highlight is gone and the menu is closed again', after.highlighted === 0 && (overlayHost(pid)?.height ?? 99) <= 12, JSON.stringify(after) + ' ' + overlayHost(pid)?.height + 'px')
  }

  // 6. Forward: go back in the (new) tab after visiting another page there.
  const tabNow = await connect((t) => t.url.startsWith(`${origin}/b`), 15_000)
  if (tabNow) {
    await evaluate(tabNow.cdp, `document.getElementById('n').click()`)
    await sleep(2500)
    await evaluate(tabNow.cdp, `history.back()`).catch(() => undefined)
    await sleep(2500)
    front(pid)
    ps(`${win32}; [W]::SetCursorPos(960, 3) | Out-Null`)
    await sleep(2500)
    const labels = () => evaluate(chrome.cdp, `JSON.stringify([...document.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') ?? '') + '|' + (b.getAttribute('title') ?? '')))`).then(JSON.parse)
    const buttons = await labels()
    const forward = buttons.some((text) => /Forward|İleri|Vorw|Adelante|Avanti|進む|Avancer|Maju|Вперёд/i.test(text))
    const back = buttons.some((text) => /Back|Geri|Zurück|Atrás|Indietro|戻る|Retour|Kembali|Назад/i.test(text))
    check('after going back, the menu offers Back and Forward', back && forward, JSON.stringify(buttons.filter((t) => t !== '|').slice(0, 8)))
    if (forward) {
      await evaluate(chrome.cdp, `[...document.querySelectorAll('button')].find((b) => /Forward|İleri|Vorw|Adelante|Avanti|進む|Avancer|Maju|Вперёд/i.test((b.getAttribute('aria-label') ?? '') + (b.getAttribute('title') ?? '')))?.click()`)
      await sleep(2500)
      const urls = (await targets()).map((t) => t.url)
      check('pressing Forward goes forward in the page', urls.some((url) => url.startsWith(`${origin}/c`)), urls.filter((u) => u.startsWith(origin)).join(' '))
    }
    ps(`${win32}; [W]::SetCursorPos(960, 700) | Out-Null`)
    await sleep(1200)
  }

  // 7. History: logos on the rows, and the panel closing in the overlay menu does not bring Semi-Lunar back.
  await emit(main.cdp, 'nebula-chrome-action:main', { type: 'toggle-history-panel' })
  await sleep(2500)
  const rows = await evaluate(main.cdp, `JSON.stringify([...document.querySelectorAll('[class*="historyItem"]')].map((row) => !!row.querySelector('[class*="itemLogo"]')))`).then(JSON.parse)
  check('every history row has a logo (or its letter)', rows.length > 0 && rows.every(Boolean), `${rows.filter(Boolean).length}/${rows.length} rows`)
  const chromeHost = () => hosts(pid).find((h) => h.width >= 1900 && h.height < 400 && h.x === 0 && h.y === 0 && h.id === overlayId)
  const overlayId = strip?.id
  check('with the history panel open in the overlay menu, the Semi-Lunar surface is hidden', overlayId !== undefined && chromeHost()?.visible === false, JSON.stringify(chromeHost()))
  await emit(main.cdp, 'nebula-chrome-action:main', { type: 'toggle-history-panel' })
  await sleep(2500)
  check('after the panel is closed it stays hidden, so the menu\'s buttons can be pressed', chromeHost()?.visible === false, JSON.stringify(chromeHost()))
} catch (error) {
  check('the run completed', false, String(error?.message ?? error))
} finally {
  killAll()
  site.close()
}
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\n${label}: ALL CHECKS PASSED (${results.length})` : `\n${label}: ${failed.length} of ${results.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
