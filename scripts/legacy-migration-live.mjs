// Live test of the move of extensions installed in the OLD trial-profile format, and of the
// new install path with a real Chrome Web Store (CRX3) package. Needs the network.
//
//   node scripts/legacy-migration-live.mjs <app.exe> <identifier>
//
// <app.exe> must be a build with the `split-driver` feature (the legacy-format installer and its
// guard escape exist only there) and its own identity (tauri.perf.conf.json): the identity's data
// folders are reset before each scenario.
//
//   A  two real catalog extensions installed in the old format, one enabled and one disabled.
//      Single environment: they are legacy, enabling is refused. Switch to split: the migration
//      re-installs both into the browsing profile (same hash), keeps enabled/disabled, and the
//      trial profile (records, folder, profile) is gone.
//   B  one legacy extension whose recorded package hash no longer matches what the store serves:
//      nothing is installed, the old install stays where it is, it is marked migration-review.
//   C  the new install path with a real CRX3 package: download check, install (waits), switch,
//      activation in the browsing profile.
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { Cdp } from './e2e-cdp.mjs'

const [exe, identifier] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').slice(7).toUpperCase()
const wants = (scenario) => !only || only.includes(scenario)
if (!exe || !identifier) {
  console.error('usage: node scripts/legacy-migration-live.mjs <app.exe> <identifier>')
  process.exit(2)
}
const local = join(process.env.LOCALAPPDATA, identifier)
const roaming = join(process.env.APPDATA, identifier)
const scratch = join(process.env.TEMP, 'nebula-legacy-migration')
const trialProfile = join(local, 'extension-browsing-profile')
const extensionRoot = (id) => join(local, 'extensions', id)
const ENABLED_ID = 'nffaoalbilbmmfgbnbgppjihopabppdk' // Video Speed Controller
const DISABLED_ID = 'jabopobgcpjmedljpbcaablpmlmfcogm' // WhatFont
const NEW_ID = 'mgijmajocgfcbeboacabfgobmjgjcoja' // Google Dictionary
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
  await sleep(1500)
  for (let i = 0; i < 20; i += 1) {
    rmSync(local, { recursive: true, force: true })
    rmSync(roaming, { recursive: true, force: true })
    if (!existsSync(local)) return
    await sleep(1000)
  }
  throw new Error('could not reset the fixture identity')
}
async function stopApp() {
  dropConnections()
  killAll()
  await sleep(3000)
}

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
async function mainPage(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const target of (await targets()).filter((t) => t.type === 'page' && t.url.startsWith('http://tauri.localhost'))) {
      try {
        const cdp = new Cdp(target.webSocketDebuggerUrl, { callTimeoutMs: 120_000 })
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
// The app's own log lines are kept: when a step fails they say why.
function launch(extraEnv = {}) {
  mkdirSync(scratch, { recursive: true })
  const log = openSync(join(scratch, 'app.log'), 'a')
  const child = spawn(exe, [], {
    env: { ...process.env, ...extraEnv, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=0' },
    stdio: ['ignore', log, log],
  })
  closeSync(log)
  return child
}
const call = (main, command, args = {}) =>
  evaluate(main, `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)}).then((v) => v, (e) => ({ error: String(e) }))`)
const status = (main, id) => call(main, 'extension_package_manage', { id, action: 'status' })
const listed = async (main) => Object.fromEntries((await call(main, 'extension_host_list')).map((item) => [item.id, item]))
const legacy = (main) => call(main, 'extension_legacy_installs')
const record = (id, name) => (existsSync(join(extensionRoot(id), name)) ? readFileSync(join(extensionRoot(id), name), 'utf8').trim() : null)
async function until(what, probe, timeoutMs, stepMs = 1000) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await probe()
      if (last) return last
    } catch (error) {
      last = String(error)
    }
    await sleep(stepMs)
  }
  throw new Error(`${what} did not happen in ${timeoutMs / 1000}s (last: ${JSON.stringify(last)})`)
}

const LEGACY_ENV = (spec) => ({ NEBULA_FIXTURE_ALLOW_SHARED_PROFILE: '1', NEBULA_FIXTURE_LEGACY_INSTALL: spec })

async function makeLegacy(spec, ids) {
  await resetFixture()
  launch(LEGACY_ENV(spec))
  const main = await mainPage()
  const states = {}
  await until('the legacy installs', async () => {
    for (const id of ids) states[id] = await status(main, id)
    return ids.every((id) => states[id]?.installed)
  }, 240_000, 2000)
  await sleep(3000)
  await stopApp()
  return states
}

let main
try {
  // ============================== A: same hash, enabled and disabled ==============================
  if (wants('A')) {
  console.log('--- A: two legacy installs (one enabled, one disabled), same hash')
  const created = await makeLegacy(`${ENABLED_ID}:enabled,${DISABLED_ID}:disabled`, [ENABLED_ID, DISABLED_ID])
  check('A: the enabled legacy extension was installed in the old format', created[ENABLED_ID]?.installed && created[ENABLED_ID]?.enabled, JSON.stringify(created[ENABLED_ID]))
  check('A: the disabled legacy extension was installed in the old format', created[DISABLED_ID]?.installed && !created[DISABLED_ID]?.enabled, JSON.stringify(created[DISABLED_ID]))
  const before = {}
  for (const id of [ENABLED_ID, DISABLED_ID]) {
    before[id] = { installedId: record(id, 'installed-id'), folder: record(id, 'installed-folder') }
  }
  check('A: records look like the old format (no installed-profile marker, a trial profile exists)', [ENABLED_ID, DISABLED_ID].every((id) => !existsSync(join(extensionRoot(id), 'installed-profile')) && before[id].installedId && before[id].folder) && existsSync(trialProfile), JSON.stringify(before))

  launch() // the product, single environment, no escape
  main = await mainPage()
  await sleep(5000)
  const legacyList = await legacy(main)
  check('A: both are legacy installs in the single environment', legacyList.length === 2 && legacyList.every((item) => item.needsReview === null), JSON.stringify(legacyList))
  const items = await listed(main)
  check('A: the catalog lists them as trial-profile installs with their enabled state', items[ENABLED_ID]?.isolatedProfile && items[ENABLED_ID]?.enabled && items[DISABLED_ID]?.isolatedProfile && !items[DISABLED_ID]?.enabled, JSON.stringify([items[ENABLED_ID]?.enabled, items[DISABLED_ID]?.enabled]))
  const enableTry = await call(main, 'extension_package_manage', { id: DISABLED_ID, action: 'enable' })
  check('A: enabling a legacy extension is refused until it moves', /needs-migration/.test(enableTry?.error ?? ''), JSON.stringify(enableTry))
  check('A: nothing was registered with the browsing profile meanwhile', ![ENABLED_ID, DISABLED_ID].some((id) => existsSync(join(extensionRoot(id), 'installed-profile'))))

  const switched = await call(main, 'shell_isolation_switch', { target: 'split' })
  check('A: the migration gate passes', switched === null || switched === undefined, JSON.stringify(switched))
  main = await afterRestart((s) => s.mode === 'split' && !s.hydrating && s.pending === null)
  const started = Date.now()
  await until('the migration', async () => (await legacy(main)).length === 0, 300_000, 2000)
  console.log(`INFO migration finished ${((Date.now() - started) / 1000).toFixed(0)} s after the split was final`)
  const moved = await listed(main)
  for (const [id, enabled] of [[ENABLED_ID, true], [DISABLED_ID, false]]) {
    const label = enabled ? 'enabled' : 'disabled'
    check(`A: the ${label} extension is registered with the browsing profile`, record(id, 'installed-profile') === 'browsing' && moved[id] && !moved[id].isolatedProfile, JSON.stringify(moved[id]))
    check(`A: the ${label} state was kept`, moved[id]?.enabled === enabled, `enabled=${moved[id]?.enabled}`)
    check(`A: the ${label} extension keeps its reviewed package (same hash)`, record(id, 'installed-folder') === before[id].folder)
    check(`A: no review or error record for the ${label} extension`, !existsSync(join(extensionRoot(id), 'migration-review')) && !existsSync(join(extensionRoot(id), 'activation-error')))
    const s = await status(main, id)
    check(`A: its status answers from the browsing profile (${label})`, s?.installed && s?.enabled === enabled, JSON.stringify(s))
  }
  await until('the trial profile to be removed', async () => !existsSync(trialProfile), 60_000)
  check('A: the old trial profile (records, folder, profile) is gone', !existsSync(trialProfile))
  await stopApp()
  }

  // ============================== B: a different hash ==============================
  if (wants('B')) {
  console.log('--- B: a legacy install whose recorded hash no longer matches the store')
  await makeLegacy(`${ENABLED_ID}:enabled`, [ENABLED_ID])
  const folderBefore = record(ENABLED_ID, 'installed-folder')
  const idBefore = record(ENABLED_ID, 'installed-id')
  // The recorded digest becomes one the store does not serve (a copy of the folder keeps the old
  // registration's files intact, only the record changes).
  const fake = 'ab'.repeat(32)
  cpSync(join(extensionRoot(ENABLED_ID), folderBefore), join(extensionRoot(ENABLED_ID), fake), { recursive: true })
  writeFileSync(join(extensionRoot(ENABLED_ID), 'installed-folder'), fake)
  launch()
  main = await mainPage()
  await sleep(5000)
  const switchedB = await call(main, 'shell_isolation_switch', { target: 'split' })
  check('B: the migration gate passes', switchedB === null || switchedB === undefined, JSON.stringify(switchedB))
  main = await afterRestart((s) => s.mode === 'split' && !s.hydrating && s.pending === null)
  await until('the review record', async () => existsSync(join(extensionRoot(ENABLED_ID), 'migration-review')), 300_000, 2000)
  await sleep(8000) // and it must not be retried into something else
  const review = record(ENABLED_ID, 'migration-review')
  check('B: it is marked migration-review', Boolean(review), review ?? '')
  check('B: nothing was installed in the browsing profile', !existsSync(join(extensionRoot(ENABLED_ID), 'installed-profile')))
  check('B: the old install stayed where it was (same registration id, same record)', record(ENABLED_ID, 'installed-id') === idBefore && record(ENABLED_ID, 'installed-folder') === fake)
  const stillLegacy = await legacy(main)
  check('B: it is still a legacy install, flagged for review', stillLegacy.length === 1 && stillLegacy[0].needsReview, JSON.stringify(stillLegacy))
  const itemsB = await listed(main)
  check('B: it still runs from the trial profile, enabled', itemsB[ENABLED_ID]?.isolatedProfile && itemsB[ENABLED_ID]?.enabled, JSON.stringify(itemsB[ENABLED_ID]))
  check('B: the trial profile was not removed', existsSync(trialProfile))
  check('B: no activation error was recorded', !existsSync(join(extensionRoot(ENABLED_ID), 'activation-error')))
  await stopApp()
  }

  // ============================== C: the new install path, real CRX3 ==============================
  if (wants('C')) {
  console.log('--- C: new install with a real Chrome Web Store package (CRX3)')
  await resetFixture()
  launch()
  main = await mainPage()
  await sleep(5000)
  const download = await call(main, 'extension_download_checked', { id: NEW_ID })
  let savedPath = null
  try {
    check('C: the real package downloaded, parsed (CRX3), verified and load-tested', !download?.error && download?.compatibility?.sha256?.length === 64, download?.error ?? '')
    savedPath = download?.path ?? null
    const compat = download?.compatibility ?? {}
    console.log('INFO checked download:', JSON.stringify({ source: compat.source, sourceId: compat.sourceId, loadTest: compat.loadTest, version: download?.version, sha256: compat.sha256 }))
    check('C: it is the Chrome Web Store identity that was checked', /chrome-web-store/i.test(String(compat.source ?? '')) && compat.sourceId === NEW_ID, `${compat.source} / ${compat.sourceId}`)
    const installed = await call(main, 'extension_package_manage', { id: NEW_ID, action: 'install', expectedSha256: compat.sha256 })
    check('C: install in the single environment prepares the package and waits', installed?.pendingActivation === true && !installed?.installed, JSON.stringify(installed))
    check('C: the prepared folder is the reviewed package (hash recorded) and nothing is registered', record(NEW_ID, 'installed-folder') === compat.sha256 && !existsSync(join(extensionRoot(NEW_ID), 'installed-id')) && existsSync(join(extensionRoot(NEW_ID), 'pending-activation')))
    check('C: the old catalog host was not created for it', !existsSync(trialProfile))
    const switchedC = await call(main, 'shell_isolation_switch', { target: 'split' })
    check('C: the migration gate passes', switchedC === null || switchedC === undefined, JSON.stringify(switchedC))
    main = await afterRestart((s) => s.mode === 'split' && !s.hydrating && s.pending === null)
    const active = await until('the activation', async () => {
      const s = await status(main, NEW_ID)
      return s?.installed && s?.enabled ? s : null
    }, 180_000, 2000)
    check('C: the extension is registered and enabled in the browsing profile after the split', Boolean(active), JSON.stringify(active))
    const itemsC = await listed(main)
    check('C: the catalog lists it as a browsing-profile extension', itemsC[NEW_ID] && !itemsC[NEW_ID].isolatedProfile && itemsC[NEW_ID].enabled, JSON.stringify(itemsC[NEW_ID]))
    check('C: records are complete (profile marker, no pending, no error)', record(NEW_ID, 'installed-profile') === 'browsing' && !existsSync(join(extensionRoot(NEW_ID), 'pending-activation')) && !existsSync(join(extensionRoot(NEW_ID), 'activation-error')))
    check('C: still no trial profile', !existsSync(trialProfile))
  } finally {
    // The checked download saves a copy in the user's Downloads folder; this test made it, so it removes it.
    if (savedPath && /Chrome-[a-p]{32}-/.test(savedPath)) rmSync(savedPath, { force: true })
  }
  }
} catch (error) {
  check('the live run completed', false, String(error?.stack ?? error))
} finally {
  dropConnections()
  killAll()
}
const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? '\nALL CHECKS PASSED' : `\n${failed.length} CHECK(S) FAILED`)
process.exit(failed.length === 0 ? 0 : 1)
