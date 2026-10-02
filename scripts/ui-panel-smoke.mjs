// Isolated React/CSS checks. No production build, native commands, or user profile.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import { Cdp, pollUntil } from './e2e-cdp.mjs'
import { verifyTutorial } from './ui-tutorial-smoke.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tutorialOnly = process.argv.includes('--tutorial')
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
async function findBrowser() {
  if (process.env.NEBULA_E2E_BROWSER) return process.env.NEBULA_E2E_BROWSER
  const paths = [
    join(process.env['ProgramFiles(x86)'] || '', 'Microsoft/Edge/Application/msedge.exe'),
    join(process.env.ProgramFiles || '', 'Google/Chrome/Application/chrome.exe'),
  ]
  const cache = join(homedir(), '.cache/puppeteer/chrome')
  for (const version of await readdir(cache).catch(() => [])) {
    paths.push(join(cache, version, 'chrome-win64/chrome.exe'))
  }
  const found = paths.find((path) => existsSync(path))
  assert(found, 'Set NEBULA_E2E_BROWSER to an installed Chrome/Edge executable.')
  return found
}

const bundle = await build({
  configFile: false, root, logLevel: 'silent', plugins: [react()],
  build: { write: false, minify: false, rollupOptions: {
    input: join(root, 'scripts/fixtures/ui-panels.tsx'), output: { entryFileNames: 'fixture.js' },
  } },
})
const assets = new Map(bundle.output.map((file) => [
  `/${file.fileName}`, file.type === 'chunk' ? file.code : file.source,
]))
const css = [...assets.keys()].filter((path) => path.endsWith('.css'))
assets.set('/', `<!doctype html><html><head>${css.map((path) => `<link rel="stylesheet" href="${path}">`).join('')}</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`)
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname
  res.writeHead(assets.has(path) ? 200 : 404, {
    'Content-Type': path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html',
  }).end(assets.get(path) ?? '')
})
let browser, cdp, profile, failure, diagnostics = ''
let checks = 0
try {
  const executable = await findBrowser()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const base = `http://127.0.0.1:${server.address().port}`
  profile = await mkdtemp(join(tmpdir(), 'nebula-ui-panels-'))
  browser = spawn(executable, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-software-rasterizer',
    '--disable-background-networking', '--disable-component-update', '--disable-sync',
    '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  browser.on('error', (error) => { failure = error })
  browser.on('exit', (code) => { failure = new Error(`Browser exited: ${code}\n${diagnostics}`) })
  browser.stderr.on('data', (chunk) => { diagnostics = `${diagnostics}${chunk}`.slice(-8000) })
  const wait = (name, fn) => pollUntil(name, fn, Date.now() + 15000, () => failure)
  const ws = await wait('browser startup', () => diagnostics.match(/DevTools listening on (ws:\/\/\S+)/)?.[1])
  const port = new URL(ws).port
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  cdp = new Cdp(pages.find((page) => page.type === 'page').webSocketDebuggerUrl)
  await cdp.open()
  console.log(`Browser: ${(await cdp.call('Browser.getVersion')).product}`)
  const evaluate = (source) => cdp.eval(source)
  const size = (width, height) => cdp.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
  const key = async (key, shift = false) => {
    const codes = { Tab: 9, Escape: 27, ArrowLeft: 37, ArrowRight: 39 }
    assert(codes[key], 'Unsupported test key: ' + key)
    const params = { key, code: key, windowsVirtualKeyCode: codes[key], modifiers: shift ? 8 : 0 }
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', ...params })
    await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
  }
  const load = async (panel, variant = 'home') => {
    await evaluate('window.fixture = undefined')
    await cdp.call('Page.navigate', { url: `${base}/?panel=${panel}&variant=${variant}` })
    await wait('fixture', () => evaluate('!!window.fixture && !!document.querySelector("#open")'))
    await evaluate('document.querySelector("#open").focus(); document.querySelector("#open").click()')
    await wait('panel opened', () => evaluate('!!document.querySelector("[role=dialog], #focus")'))
    await delay(220)
  }
  if (tutorialOnly) {
    checks += await verifyTutorial({ cdp, load, size, evaluate, key, wait, root })
  } else {
  for (const panel of ['history', 'notifications', 'downloads', 'site', 'private']) {
    for (const variant of panel === 'site' || panel === 'private' ? ['home'] : ['home', 'browsing']) {
      await size(1280, 900)
      await load(panel, variant)
      for (const [width, height] of [[1280,900], [1280,500], [860,360], [650,500], [600,360], [360,480], [1280,900]]) {
        await size(width, height)
        await delay(80)
        const bounds = await evaluate(`(() => {
          const panel = document.querySelector('[role=dialog]'), r = panel.getBoundingClientRect();
          return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:innerWidth,height:innerHeight};
        })()`)
        assert(bounds.top >= 11 && bounds.left >= 11 && bounds.bottom <= height - 11 && bounds.right <= width - 11,
          `${panel}/${variant} outside ${width}x${height}: ${JSON.stringify(bounds)}`)
        checks++
      }
      await size(420, 360)
      for (const locale of ['en', 'tr', 'de', 'fr', 'es', 'it', 'ru', 'ja', 'id']) {
        await evaluate(`fixture.setLocale(${JSON.stringify(locale)})`)
        await wait('locale', () => evaluate(`document.documentElement.lang === ${JSON.stringify(locale)}`))
        await delay(80)
        const result = await evaluate(`(() => {
          const panel = document.querySelector('[role=dialog]');
          const buttons = [...panel.querySelectorAll('button')].filter(button => !button.disabled);
          const last = buttons.at(-1);
          last.focus(); last.scrollIntoView({block:'nearest',inline:'nearest'});
          const r = last.getBoundingClientRect(), p = panel.getBoundingClientRect();
          return {accessible:r.top >= p.top && r.bottom <= Math.min(p.bottom,innerHeight),
            horizontalOverflow:panel.scrollWidth > panel.clientWidth + 1, r:{top:r.top,bottom:r.bottom}};
        })()`)
        assert(result.accessible && !result.horizontalOverflow, `${panel}/${variant}/${locale}: inaccessible control ${JSON.stringify(result)}`)
        checks++
      }
    }
  }
  for (const panel of ['dialog', 'modal']) {
    await load(panel)
    assert.equal(await evaluate('document.activeElement.id'), 'first')
    assert.deepEqual(await evaluate('fixture.focusable()'), ['first', 'summary', 'open-nested', 'selected-radio', 'last'])
    await key('Tab', true)
    assert.equal(await evaluate('document.activeElement.id'), 'last')
    await key('Tab')
    assert.equal(await evaluate('document.activeElement.id'), 'first')
    await key('Tab')
    assert.equal(await evaluate('document.activeElement.id'), 'summary', 'Tab entered a hidden or disabled control')
    await key('Tab')
    assert.equal(await evaluate('document.activeElement.id'), 'open-nested', 'Tab entered closed details')
    await key('Tab', true)
    assert.equal(await evaluate('document.activeElement.id'), 'summary')
    await evaluate('document.querySelector("#details").open = true')
    assert.deepEqual(await evaluate('fixture.focusable()'), ['first', 'summary', 'detail-action', 'open-nested', 'selected-radio', 'last'])
    await evaluate('document.querySelector("#open-nested").focus(); document.querySelector("#open-nested").click()')
    await wait('nested focus', () => evaluate('document.activeElement.id === "nested-close"'))
    await key('Tab')
    assert.equal(await evaluate('document.activeElement.id'), 'nested-close')
    await key('Escape')
    await wait('nested closed and focus restored', () => evaluate('!document.querySelector("#nested") && document.activeElement.id === "open-nested"'))
    assert(await evaluate('!!document.querySelector("#focus")'), 'Escape closed the parent')
    await evaluate('document.querySelectorAll("#focus button, #focus input, #focus summary").forEach(element => element.tabIndex = -1)')
    await key('Tab')
    assert.equal(await evaluate('document.activeElement.id'), 'focus', 'An empty tab order lost focus')
    checks += 12
  }
  await size(1280, 900)
  await load('history')
  await evaluate('document.querySelector("[role=dialog] button").focus()')
  await key('Tab', true)
  assert(await evaluate(`(() => {
    const rect = document.activeElement.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= innerHeight && !!document.activeElement.closest('[role=dialog]');
  })()`), 'Keyboard navigation did not reveal the last history control')
  checks++
  await evaluate('fixture.setLocale("en")')
  await wait('English history', () => evaluate('document.documentElement.lang === "en"'))
  await wait('translated clear-history button', () => evaluate(`(() => {
    const button = [...document.querySelectorAll('[role=dialog] button')].find(button => button.textContent.trim() === 'Clear history');
    if (!button) return false;
    button.id = 'history-clear'; button.focus(); button.click(); return true;
  })()`))
  await wait('history confirmation', () => evaluate('!!document.querySelector("[role=alertdialog]")'))
  await key('Escape')
  await wait('confirmation dismissed', () => evaluate('!document.querySelector("[role=alertdialog]") && document.activeElement.id === "history-clear"'))
  assert(await evaluate('!!document.querySelector("[aria-labelledby=history-dialog-title]")'), 'Confirmation dismissed the history panel')
  checks++
  await load('site')
  await evaluate('document.querySelector("footer button").focus(); fixture.rerender()')
  await wait('site rerender', () => evaluate('document.querySelector("#revision").textContent === "1"'))
  await delay(80)
  assert(await evaluate('document.activeElement === document.querySelector("footer button")'), 'Site update stole focus')
  await key('Escape')
  await wait('site closed and focus restored', () => evaluate('!document.querySelector("[role=dialog]") && document.activeElement.id === "open"'))
  checks += 2
  }
  console.log(`PASS: ${checks} viewport and keyboard checks. No native window behavior tested.`)
} finally {
  await cdp?.call('Browser.close').catch(() => {})
  cdp?.close()
  browser?.kill()
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
  // Only the disposable directory created by this process is removed.
  if (profile) {
    assert.equal(dirname(resolve(profile)), resolve(tmpdir()))
    assert(basename(profile).startsWith('nebula-ui-panels-'))
    await rm(profile, { recursive: true, force: true, maxRetries: 6, retryDelay: 250 })
  }
}
