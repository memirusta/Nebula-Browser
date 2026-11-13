// Loads one page in a Nebula build and records what it asks for, what is blocked, and (on YouTube) whether an ad is shown.
//
//   node scripts/shield-measure-run.mjs --exe <nebula app.exe> [--url <page>] [--seconds 45] [--label current] [--repeat 1]
//                                       [--out <folder>] [--port 9333] [--keep-open] [--baseline] [--tracking none|balanced|strict]
//                                       [--browser-args "<more Chromium switches>"]
//
// Three things can stand between a page and the network, and a run says which were on: the content blocker (uBlock Origin Lite),
// WebView2's own Tracking Prevention (Microsoft's list; Nebula sets it to "balanced" unless told otherwise), and Nebula's own
// handler (cookie-banner removal, the "block trackers" and "strict cookies" settings). --baseline switches all three off, the blocker before anything is opened (a page that has already been loaded with the blocker's
// scripts keeps them, so switching it off afterwards does not make a clean baseline).
//   node scripts/shield-measure-run.mjs --render <run.json> <run.json> ...        (put saved runs side by side)
//
// Use a build with an identity of its own (tauri.perf.conf.json): the measured app starts from its own profile, and the Nebula
// you use every day is never touched. The build is started with Chromium's remote debugging on; the page is opened the way a
// link from another app is (a second start of the same exe hands it over), then attached to and reloaded, so everything from the
// start of the load is seen. Requests of frames of other sites and of workers are followed too (auto-attach).
//
// The numbers and their limits are explained at the top of scripts/shield-measure.mjs.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  YOUTUBE_PROBE,
  analyzeYoutubeSamples,
  createNetworkRecorder,
  hostOf,
  registrableDomain,
  renderReport,
  summarizeRequests,
} from './shield-measure.mjs'

const DEFAULT_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
const ONBOARDING_COMPLETE_KEY = 'nebula-onboarding-complete-v1'
const SETTINGS_KEY = 'nebula-settings-v1'
const delay = (ms) => new Promise((done) => setTimeout(done, ms))

function readArgs(argv) {
  const args = { seconds: 45, label: 'current', repeat: 1, port: 9333, url: DEFAULT_URL, keepOpen: false, baseline: false, tracking: '', browserArgs: '', render: [] }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--exe') args.exe = argv[++index]
    else if (arg === '--url') args.url = argv[++index]
    else if (arg === '--seconds') args.seconds = Number(argv[++index])
    else if (arg === '--label') args.label = argv[++index]
    else if (arg === '--repeat') args.repeat = Number(argv[++index])
    else if (arg === '--out') args.out = argv[++index]
    else if (arg === '--port') args.port = Number(argv[++index])
    else if (arg === '--keep-open') args.keepOpen = true
    else if (arg === '--baseline') args.baseline = true
    else if (arg === '--tracking') args.tracking = argv[++index]
    else if (arg === '--browser-args') args.browserArgs = argv[++index]
    else if (arg === '--render') args.render = argv.slice(index + 1).filter((value) => !value.startsWith('--'))
  }
  return args
}

/** A small DevTools protocol client on the browser's own socket: sessions are flattened, so one connection reaches every page. */
class Browser {
  constructor(url) {
    this.ws = new WebSocket(url)
    this.nextId = 1
    this.pending = new Map()
    this.listeners = []
    this.ws.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`))
        else pending.resolve(message.result)
      } else {
        for (const listener of this.listeners) listener(message)
      }
    })
  }

  async open() {
    if (this.ws.readyState === 1) return
    await new Promise((resolveOpen, reject) => {
      this.ws.addEventListener('open', resolveOpen, { once: true })
      this.ws.addEventListener('error', () => reject(new Error('Could not open the DevTools socket')), { once: true })
    })
  }

  send(method, params = {}, sessionId, timeoutMs = 30_000) {
    const id = this.nextId++
    return new Promise((resolveSend, reject) => {
      this.pending.set(id, { resolve: resolveSend, reject, method })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method}: no answer in ${timeoutMs / 1000} s`))
      }, timeoutMs)
    })
  }

  on(listener) {
    this.listeners.push(listener)
  }

  close() {
    try {
      this.ws.close()
    } catch {
      // Already closed.
    }
  }
}

async function waitFor(what, read, timeoutMs, stepMs = 500) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      last = await read()
      if (last) return last
    } catch {
      // Not up yet.
    }
    await delay(stepMs)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

async function json(url) {
  const response = await fetch(url)
  return response.json()
}

function startNebula(exe, port, netLog, extraArgs = '') {
  const previous = process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS ?? ''
  const switches = [
    previous,
    extraArgs,
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    // Without it a video does not start by itself in a page nobody clicked, and there would be no ad to see.
    '--autoplay-policy=no-user-gesture-required',
    `--log-net-log=${netLog}`,
    '--net-log-capture-mode=Default',
  ].filter(Boolean).join(' ')
  const child = spawn(exe, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: switches }, stdio: 'ignore' })
  return child
}

/** Hands an address to the running build the way a link from another app does (the single-instance plugin forwards it). */
function handOver(exe, url) {
  const child = spawn(exe, [url], { stdio: 'ignore', detached: true })
  child.unref()
}

/** Asks the app to close the way a person does, so the browser can finish its logs; stops it only if it will not go. */
async function closeNebula(child) {
  if (child.exitCode !== null) return
  await new Promise((done) => {
    const killer = spawn('taskkill', ['/PID', String(child.pid)], { stdio: 'ignore' })
    killer.on('exit', done)
  })
  const deadline = Date.now() + 20_000
  while (child.exitCode === null && Date.now() < deadline) await delay(500)
  if (child.exitCode === null) {
    await new Promise((done) => spawn('taskkill', ['/PID', String(child.pid), '/F'], { stdio: 'ignore' }).on('exit', done))
  }
}

/**
 * What the content blocker (uBlock Origin Lite) has switched on right now, read from the extension's own background worker,
 * and, for a baseline run, switched off: its rule sets, its own rules, and the scripts it injects (the scriptlets that, among
 * other things, take advertising out of YouTube's player data). The worker is reached through the DevTools protocol, so the
 * app itself is not changed. It stays switched off only until the worker starts again; the state is read again afterwards.
 */
const OFF_SCRIPT = `(async () => {
  const enabled = await chrome.declarativeNetRequest.getEnabledRulesets()
  if (enabled.length) await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: enabled })
  const dynamic = await chrome.declarativeNetRequest.getDynamicRules()
  if (dynamic.length) await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: dynamic.map((rule) => rule.id) })
  const session = await chrome.declarativeNetRequest.getSessionRules()
  if (session.length) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: session.map((rule) => rule.id) })
  const scripts = await chrome.scripting.getRegisteredContentScripts()
  if (scripts.length) await chrome.scripting.unregisterContentScripts({ ids: scripts.map((script) => script.id) })
  return true
})()`

const READ_SCRIPT = `(async () => ({
  rulesets: await chrome.declarativeNetRequest.getEnabledRulesets(),
  dynamicRules: (await chrome.declarativeNetRequest.getDynamicRules()).length,
  sessionRules: (await chrome.declarativeNetRequest.getSessionRules()).length,
  // Session rules that stop or change a request (not the ones that only let one through).
  sessionRulesThatBlock: (await chrome.declarativeNetRequest.getSessionRules()).filter((rule) => !['allow', 'allowAllRequests'].includes(rule.action.type)).length,
  scripts: (await chrome.scripting.getRegisteredContentScripts()).length,
}))()`

/**
 * The blocker's own filtering mode for every site (0 none, 1 basic, 2 optimal, 3 complete), set the way its own pages set it: by
 * message, from a page of the extension (opened here and closed again). It is kept by the extension, so unlike switching its
 * rule sets off from outside it survives the worker starting again. Returns the mode that was there before.
 */
async function setBlockerMode(browser, level) {
  const worker = await waitFor("the blocker's background worker", async () => {
    const { targetInfos } = await browser.send('Target.getTargets')
    return targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'))
  }, 45_000)
  const extensionId = new URL(worker.url).host
  const { targetId } = await browser.send('Target.createTarget', { url: `chrome-extension://${extensionId}/dashboard.html` })
  try {
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
    const ask = async (expression) => {
      const answer = await browser.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
      if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text)
      return answer.result.value
    }
    await waitFor('the extension page', () => ask('typeof chrome !== "undefined" && Boolean(chrome.runtime && chrome.runtime.sendMessage)'), 20_000, 500)
    const before = await ask('chrome.runtime.sendMessage({ what: "getDefaultFilteringMode" })')
    if (before !== level) await ask(`chrome.runtime.sendMessage({ what: "setDefaultFilteringMode", level: ${level} })`)
    await delay(1500)
    return before
  } finally {
    await browser.send('Target.closeTarget', { targetId }).catch(() => {})
  }
}

const isBlockerOff = (state) => state.rulesets.length === 0 && state.dynamicRules === 0 && state.sessionRulesThatBlock === 0 && state.scripts === 0

async function blockerState(browser, off, waitMs = 60_000, keep = false) {
  const worker = await waitFor("the blocker's background worker", async () => {
    const { targetInfos } = await browser.send('Target.getTargets')
    return targetInfos.find((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'))
  }, waitMs)
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId: worker.targetId, flatten: true })
  const run = async (expression) => {
    const answer = await browser.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId)
    if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text)
    return answer.result.value
  }
  const read = READ_SCRIPT
  // Right after the browser starts the worker is there before the extension's own interfaces are.
  await waitFor('the extension interfaces', () => run('typeof chrome !== "undefined" && Boolean(chrome.declarativeNetRequest) && Boolean(chrome.scripting)'), waitMs, 1000)
  const before = await run(read)
  if (!off) {
    await browser.send('Target.detachFromTarget', { sessionId }).catch(() => {})
    return { extension: worker.url.split('/')[2], ...before }
  }
  await run(OFF_SCRIPT)
  // The extension reacts to what was switched off (it puts rules of its own in their place), so it is repeated until nothing
  // that blocks is left, a few times at most.
  let after = await run(read)
  for (let round = 0; round < 4 && (after.rulesets.length || after.dynamicRules || after.sessionRulesThatBlock || after.scripts); round++) {
    await run(OFF_SCRIPT)
    await delay(800)
    after = await run(read)
  }
  // While a debugger is attached the worker is not stopped for being idle (which is how it would start again and put its
  // rules back), so for a baseline the session is kept and handed to the guard.
  if (!keep) await browser.send('Target.detachFromTarget', { sessionId }).catch(() => {})
  return { extension: worker.url.split('/')[2], before, ...after, switchedOff: isBlockerOff(after), ...(keep ? { sessionId, run } : {}) }
}

async function measureOnce({ exe, port, url, seconds, outDir, runLabel, keepOpen, browserArgs, baseline, tracking }) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const netLog = join(outDir, `netlog-${runLabel.replace(/\W+/g, '_')}-${stamp}.json`)
  if (/\s/.test(netLog)) throw new Error(`The log path must not contain spaces: ${netLog}`)

  const app = startNebula(exe, port, netLog, browserArgs)
  let browser
  try {
    const version = await waitFor('the DevTools endpoint', () => json(`http://127.0.0.1:${port}/json/version`), 90_000)
    browser = new Browser(version.webSocketDebuggerUrl)
    await browser.open()

    // A baseline switches the blocker off first of all, while its worker is still awake (a worker with nothing to do is stopped
    // soon after the browser starts), and keeps a debugger on it so that it stays awake and cannot put its rules back unseen.
    let blocker
    let blockerRun
    const guard = { reads: 0, reapplied: 0, failedReads: 0 }
    let guardTimer
    if (baseline) {
      const { sessionId: _kept, run, ...off } = await blockerState(browser, true, 60_000, true)
      blockerRun = run
      blocker = off
      if (!blocker.switchedOff) throw new Error(`The blocker could not be switched off: ${JSON.stringify(blocker)}`)
      // Its own mode for every site goes to "none" too: that is kept by the extension, so a worker that starts again does not
      // register the scripts that take requests out of the page.
      await setBlockerMode(browser, 0)
      await blockerRun(OFF_SCRIPT)
      guardTimer = setInterval(async () => {
        try {
          const state = await blockerRun(READ_SCRIPT)
          guard.reads += 1
          if (!isBlockerOff(state)) {
            guard.reapplied += 1
            await blockerRun(OFF_SCRIPT)
          }
        } catch {
          guard.failedReads += 1
        }
      }, 2000)
    }

    // The first-run screens are not what is measured: a profile of its own that has not been through them is told it has.
    const targets = async () => (await browser.send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page')
    const shell = await waitFor('the window of the app', async () => (await targets()).find((t) => /tauri\.localhost|localhost/.test(t.url) && !/about:blank/.test(t.url)), 90_000)
    const shellSession = (await browser.send('Target.attachToTarget', { targetId: shell.targetId, flatten: true })).sessionId
    const done = await browser.send('Runtime.evaluate', { expression: `localStorage.getItem(${JSON.stringify(ONBOARDING_COMPLETE_KEY)})`, returnByValue: true }, shellSession)
    if (done.result.value !== '1') {
      await browser.send('Runtime.evaluate', { expression: `localStorage.setItem(${JSON.stringify(ONBOARDING_COMPLETE_KEY)}, '1')`, returnByValue: true }, shellSession)
      await browser.send('Page.reload', {}, shellSession)
      await delay(10_000)
    }
    // Nebula's own privacy settings for this run: a baseline has Tracking Prevention, cookie-banner removal, "block trackers" and
    // "strict cookies" off; any run can be given a Tracking Prevention level. The app reads them again when its window reloads.
    const trackingLevel = tracking || (baseline ? 'none' : '')
    let privacyStored
    const privacy = {}
    if (trackingLevel) privacy.trackingLevel = trackingLevel
    if (baseline) Object.assign(privacy, { cookieBannerBlocking: false, blockTrackers: false, strictCookies: false })
    if (Object.keys(privacy).length > 0) {
      await browser.send('Runtime.evaluate', {
        expression: `(() => { const stored = JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}) || '{}'); stored.privacy = { ...(stored.privacy || {}), ...${JSON.stringify(privacy)} }; localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, JSON.stringify(stored)); return true })()`,
        returnByValue: true,
      }, shellSession)
      await browser.send('Page.reload', {}, shellSession)
      await delay(10_000)
      // What the app holds after it reloaded: the run says it, so a setting that did not stick is seen rather than assumed.
      const readBack = await browser.send('Runtime.evaluate', { expression: `JSON.stringify((JSON.parse(localStorage.getItem(${JSON.stringify(SETTINGS_KEY)}) || '{}').privacy) || null)`, returnByValue: true }, shellSession)
      privacyStored = readBack.result?.value ? JSON.parse(readBack.result.value) : null
      if (process.env.SHIELD_DEBUG) console.error('settings after reload:', readBack.result?.value)
    }
    await browser.send('Target.detachFromTarget', { sessionId: shellSession }).catch(() => {})

    // The page: handed over like a link, found among the targets, then attached to and reloaded.
    const known = new Set((await targets()).map((t) => t.targetId))
    const site = registrableDomain(hostOf(url))
    const findTab = async () => (await targets()).find((t) => !known.has(t.targetId) && registrableDomain(hostOf(t.url)) === site)
    // A hand-over before the app listens for it is lost, so it is repeated until a tab with the page appears.
    let tab
    for (let attempt = 1; attempt <= 5 && !tab; attempt++) {
      handOver(exe, url)
      tab = await waitFor('the tab with the page', findTab, 20_000).catch(() => undefined)
    }
    if (!tab) {
      const seen = (await targets()).map((t) => `${t.type} ${t.url.slice(0, 90)}`)
      throw new Error(`No tab with the page appeared. The pages that were there: ${JSON.stringify(seen, null, 1)}`)
    }
    const sessionId = (await browser.send('Target.attachToTarget', { targetId: tab.targetId, flatten: true })).sessionId

    const recorder = createNetworkRecorder()
    const sessions = new Map([[sessionId, 'page']])
    const seenMethods = {}
    browser.on((message) => {
      if (process.env.SHIELD_DEBUG && message.method) seenMethods[message.method] = (seenMethods[message.method] ?? 0) + 1
      if (message.method === 'Target.attachedToTarget') {
        const child = message.params.sessionId
        sessions.set(child, message.params.targetInfo.type)
        void prepare(child)
      } else if (message.sessionId && sessions.has(message.sessionId) && message.method?.startsWith('Network.')) {
        // Request ids are only unique inside one session.
        const params = message.params
        recorder.onEvent(message.method, params && params.requestId ? { ...params, requestId: `${message.sessionId}:${params.requestId}` } : params)
      }
    })

    async function prepare(session) {
      try {
        // Short waits: a frame that does not answer must not hold the page back (it is let go in any case, below).
        await browser.send('Network.enable', {}, session, 5000)
        await browser.send('Network.setCacheDisabled', { cacheDisabled: true }, session, 5000)
        await browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, session, 5000)
      } catch (error) {
        // A frame that went away while it was being prepared.
        if (process.env.SHIELD_DEBUG) console.error('prepare failed:', error.message)
      } finally {
        await browser.send('Runtime.runIfWaitingForDebugger', {}, session, 5000).catch(() => {})
      }
    }
    await prepare(sessionId)
    if (process.env.SHIELD_DEBUG) console.error('attached to', tab.url.slice(0, 100), 'session', sessionId)
    await browser.send('Page.enable', {}, sessionId)
    // The page that was handed over is left to finish loading first: reloading one that is still loading is a navigation that
    // is cut off, and the app answers that with its error page.
    await waitFor('the first load to finish', async () => {
      const state = await browser.send('Runtime.evaluate', { expression: 'document.readyState + "|" + location.protocol', returnByValue: true }, sessionId)
      return state.result?.value === 'complete|https:'
    }, 60_000).catch(() => {})
    await delay(2000)
    // The blocker's background worker is asleep until a page wakes it (a worker that has nothing to do is stopped, and is not
    // among the targets then), so it is looked for now, with a page open, and switched off before the reload that is measured.
    // A baseline puts the blocker's own mode to "none" first; any other run makes sure it is at its usual "optimal" (an earlier
    // baseline that did not finish could have left it off).
    if (!baseline) {
      // Any other run makes sure the blocker is at its usual "optimal" mode (an earlier baseline could have left it off), and says
      // what it has on.
      await setBlockerMode(browser, 2).catch(() => undefined)
      blocker = await blockerState(browser, false, 45_000)
    }
    // Not a reload: the page that was handed over is left (about:blank) and the address is then opened afresh, so nothing the
    // first page had in flight (its beacons as it unloads, its workers) is mixed into what is measured.
    await browser.send('Page.navigate', { url: 'about:blank' }, sessionId)
    await delay(3000)
    await browser.send('Page.navigate', { url }, sessionId)

    const isYoutube = /(^|\.)youtube\.com$/.test(hostOf(url))
    const samples = []
    const started = Date.now()
    let playAttempts = 0
    while (Date.now() - started < seconds * 1000) {
      await delay(1000)
      if (!isYoutube) continue
      try {
        const evaluated = await browser.send('Runtime.evaluate', { expression: YOUTUBE_PROBE, returnByValue: true }, sessionId)
        if (process.env.SHIELD_DEBUG && samples.length === 0) console.error('first probe answer:', JSON.stringify(evaluated).slice(0, 400))
        if (evaluated.result?.value) samples.push(evaluated.result.value)
        // A video that has not started is started once or twice with the player's own button; one that plays is left alone
        // (pressing the button of a playing video would pause it, and a paused video shows no ad to measure).
        const last = samples[samples.length - 1]
        if (playAttempts < 3 && Date.now() - started > 3000 + playAttempts * 4000 && last && last.paused === true && (last.videoTime ?? 0) < 1 && !last.adShowing) {
          playAttempts += 1
          await browser.send('Runtime.evaluate', {
            expression: `(() => {
              const consent = document.querySelector('button[aria-label*="Reject all"], form[action*="consent"] button')
              if (consent) consent.click()
              const video = document.querySelector('video')
              const button = document.querySelector('.ytp-play-button, .ytp-large-play-button')
              if (video && video.paused) { if (button) button.click(); else video.play().catch(() => {}) }
            })()`,
          }, sessionId).catch(() => {})
        }
      } catch (error) {
        // The page was between two documents.
        if (process.env.SHIELD_DEBUG) console.error('probe failed:', error.message)
      }
    }

    if (process.env.SHIELD_DEBUG) {
      console.error('events seen:', JSON.stringify(seenMethods))
      const where = await browser.send('Runtime.evaluate', { expression: 'JSON.stringify({ href: location.href.slice(0, 120), text: document.body ? document.body.innerText.slice(0, 400) : null })', returnByValue: true }, sessionId).catch((error) => ({ result: { value: error.message } }))
      console.error('the page:', where.result?.value)
    }
    clearInterval(guardTimer)
    if (baseline) await setBlockerMode(browser, 2).catch(() => undefined)
    const requests = recorder.requests()
    const network = summarizeRequests(requests, url)
    const youtube = isYoutube ? analyzeYoutubeSamples(samples) : undefined
    // Clean: it was read every two seconds through the run and never found back on. Not clean: it was found back on (it was
    // switched off again each time, but the page ran with it on in between). Unproven: it could not be read.
    const stayedOff = !baseline ? undefined : guard.reads === 0 ? null : guard.reapplied === 0
    return { label: runLabel, url, seconds, at: new Date().toISOString(), baseline: baseline || undefined, nebulaPrivacy: Object.keys(privacy).length ? privacy : undefined, nebulaPrivacyStored: privacyStored, blocker, guard: baseline ? guard : undefined, stayedOff, network, youtube, netLog, requests, samples }
  } finally {
    browser?.close()
    if (!keepOpen) await closeNebula(app)
  }
}

function saveRun(outDir, run) {
  const file = join(outDir, `run-${run.label.replace(/\W+/g, '_')}-${run.at.replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify(run, null, 2))
  return file
}

async function main() {
  const args = readArgs(process.argv.slice(2))
  if (args.render.length > 0) {
    const runs = args.render.map((file) => JSON.parse(readFileSync(file, 'utf8')))
    console.log(renderReport(runs, { runs: String(runs.length) }))
    return
  }
  if (!args.exe || !existsSync(args.exe)) throw new Error('Give the build to measure: --exe <path to app.exe> (use a build with its own identity, see tauri.perf.conf.json)')
  const outDir = resolve(args.out ?? join(process.env.TEMP ?? '.', 'nebula-shield-measure'))
  mkdirSync(outDir, { recursive: true })

  const runs = []
  for (let index = 1; index <= args.repeat; index++) {
    const runLabel = args.repeat > 1 ? `${args.label} #${index}` : args.label
    console.log(`Measuring ${args.url} (${runLabel}, ${args.seconds} s)`)
    const run = await measureOnce({ exe: args.exe, port: args.port, url: args.url, seconds: args.seconds, outDir, runLabel, keepOpen: args.keepOpen, browserArgs: args.browserArgs, baseline: args.baseline, tracking: args.tracking })
    console.log(`  saved ${saveRun(outDir, run)}`)
    runs.push(run)
  }
  const report = renderReport(runs, { exe: args.exe, page: args.url, seconds: String(args.seconds) })
  const reportFile = join(outDir, `report-${args.label.replace(/\W+/g, '_')}-${Date.now()}.md`)
  writeFileSync(reportFile, report)
  console.log('\n' + report + `\n\nReport: ${reportFile}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
