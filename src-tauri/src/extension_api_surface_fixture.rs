//! Fixture files for the WebView2 extension API surface probe.
//!
//! The probe measures what the runtime provides; it never asserts that an API
//! exists. Results are written to `chrome.storage.local` under `report`, then
//! read back by the native test.

pub(crate) const MANIFEST: &str = r#"{
  "manifest_version": 3,
  "name": "Nebula API surface probe",
  "version": "1.0.0",
  "permissions": [
    "storage", "tabs", "scripting", "activeTab", "offscreen", "alarms",
    "contextMenus", "notifications", "downloads", "declarativeNetRequest",
    "webRequest", "webNavigation", "cookies", "identity", "sidePanel",
    "management", "nativeMessaging", "commands", "history", "bookmarks",
    "privacy", "proxy", "browsingData", "idle", "tabGroups", "system.cpu",
    "system.memory", "system.storage", "system.display", "tabCapture",
    "contentSettings", "desktopCapture", "topSites", "search", "gcm",
    "pageCapture", "readingList", "sessions", "tts", "power", "fontSettings",
    "declarativeContent", "debugger", "userScripts", "declarativeNetRequestFeedback"
  ],
  "host_permissions": ["http://127.0.0.1/*"],
  "background": { "service_worker": "background.js" },
  "commands": {
    "toggle-side-panel": {
      "suggested_key": { "default": "Ctrl+Shift+E" },
      "description": "Toggle the panel"
    }
  },
  "content_scripts": [
    { "matches": ["http://127.0.0.1/*"], "js": ["content.js"], "run_at": "document_idle" }
  ],
  "omnibox": { "keyword": "nebulaprobe" },
  "action": { "default_popup": "popup.html" },
  "side_panel": { "default_path": "popup.html" }
}"#;

pub(crate) const POPUP_HTML: &str = r#"<!doctype html><meta charset="utf-8"><title>Probe popup</title><body>probe popup<script src="popup.js"></script>"#;

pub(crate) const OFFSCREEN_HTML: &str = r#"<!doctype html><meta charset="utf-8"><title>Probe offscreen</title><body>offscreen<script src="offscreen.js"></script>"#;

pub(crate) const CONTENT_JS: &str = r#"
document.documentElement.setAttribute('data-nebula-probe', 'content-script-ran')
chrome.runtime.sendMessage({ kind: 'content-ready', href: location.href }).catch(() => {})
chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  if (message && message.kind === 'ping') reply('pong')
})
"#;

pub(crate) const OFFSCREEN_JS: &str = r#"
chrome.runtime.sendMessage({ kind: 'offscreen-loaded' }).catch(() => {})
"#;

/// Page-context probe: runs in the popup, wakes the worker and records what the
/// extension *page* context exposes.
pub(crate) const POPUP_JS: &str = r#"
const names = ['runtime','storage','tabs','windows','scripting','action','sidePanel','offscreen','alarms','contextMenus','notifications','downloads','declarativeNetRequest','webRequest','webNavigation','cookies','identity','permissions','commands','management','history','bookmarks']
const page = { namespaces: {}, webview: typeof chrome.webview }
for (const name of names) page.namespaces[name] = typeof chrome[name]
globalThis.__page = page
chrome.runtime.sendMessage({ kind: 'wake' }).catch(() => {})
"#;

/// Service-worker probe. Each attempt stores its own result immediately so a
/// hang in a later probe cannot lose earlier measurements.
pub(crate) const BACKGROUND_JS: &str = r#"
// Unguarded use of chrome.commands at the top level, before anything else runs
// (the pattern in the real Claude worker). It works natively because the
// manifest declares `commands`; without that key the namespace is undefined.
chrome.commands.onCommand.addListener((name) => { globalThis.__lastCommand = name })
const report = {}
let offscreenLoaded = false
let started = false
const flush = () => { try { chrome.storage.local.set({ report }) } catch (_) {} }
const put = (key, value) => { report[key] = value; flush() }
const text = (error) => String((error && error.message) || error).slice(0, 200)
async function attempt(name, fn, ms = 4000) {
  try {
    const value = await Promise.race([
      fn(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ])
    put(name, { ok: true, value })
  } catch (error) {
    put(name, { ok: false, error: text(error) })
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.kind === 'offscreen-loaded') offscreenLoaded = true
  if (message && message.kind === 'content-ready') put('contentScript.messaged', { ok: true, value: { host: String(message.href).split('/')[2] } })
  if (message && message.kind === 'wake') run()
  // Lets the native test switch the worker to the pattern Sider and Imageye use.
  if (message && message.kind === 'panel-behavior-on') chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

// Registered like any real extension would: the host never calls this directly.
chrome.action.onClicked.addListener(async (tab) => {
  put('onClicked.fired', { ok: true, value: { tabId: tab && tab.id, active: tab && tab.active } })
  // What real extensions do on a toolbar click: open their side panel.
  try { await chrome.sidePanel.open({ tabId: tab.id }); put('onClicked.sidePanelOpen', { ok: true, value: true }) }
  catch (error) { put('onClicked.sidePanelOpen', { ok: false, error: text(error) }) }
})

async function run() {
  if (started) return
  started = true
  const names = ['action','alarms','bookmarks','browserAction','browsingData','certificateProvider','commands','contentSettings','contextMenus','cookies','debugger','declarativeContent','declarativeNetRequest','desktopCapture','devtools','dns','documentScan','downloads','enterprise','extension','fontSettings','gcm','history','i18n','identity','idle','instanceID','management','notifications','offscreen','omnibox','pageAction','pageCapture','permissions','platformKeys','power','printerProvider','printing','privacy','processes','proxy','readingList','runtime','scripting','search','sessions','sidePanel','storage','system','tabCapture','tabGroups','tabs','topSites','tts','userScripts','webNavigation','webRequest','windows']
  const namespaces = {}
  for (const name of names) namespaces[name] = typeof chrome[name]
  put('namespaces', { ok: true, value: namespaces })
  put('globals', { ok: true, value: {
    chromeWebview: typeof chrome.webview,
    selfChromeWebview: typeof self.chrome?.webview,
    importScripts: typeof importScripts,
    moduleWorker: false,
    actionOnClicked: typeof chrome.action?.onClicked,
    actionSetBadgeText: typeof chrome.action?.setBadgeText,
    sidePanelOpen: typeof chrome.sidePanel?.open,
    offscreenCreate: typeof chrome.offscreen?.createDocument,
  } })

  await attempt('storage.roundtrip', async () => {
    await chrome.storage.local.set({ probe: 1 })
    return (await chrome.storage.local.get('probe')).probe === 1
  })
  await attempt('tabs.query.all', async () => (await chrome.tabs.query({})).map((tab) => ({
    id: tab.id, active: tab.active, scheme: String(tab.url || tab.pendingUrl || '').split(':')[0] || 'none',
  })))
  await attempt('tabs.query.active', async () => (await chrome.tabs.query({ active: true, currentWindow: true })).length)
  await attempt('windows.getAll', async () => (await chrome.windows.getAll()).map((w) => ({ id: w.id, type: w.type, focused: w.focused })))
  await attempt('windows.getCurrent', async () => { const w = await chrome.windows.getCurrent(); return { id: w.id, type: w.type } })
  await attempt('scripting.executeScript.firstTab', async () => {
    const tabs = await chrome.tabs.query({})
    if (!tabs.length) return { skipped: 'no tabs reported' }
    const result = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: () => 1 })
    return { results: result.length }
  })
  await attempt('tabs.query.http', async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' })).map((tab) => ({
    id: tab.id, active: tab.active, windowId: tab.windowId, status: tab.status, title: tab.title,
  })))
  await attempt('scripting.executeScript.http', async () => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' })
    if (!tabs.length) return { skipped: 'no http tab visible to the extension' }
    const out = await chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, func: () => document.title })
    return { title: out[0] && out[0].result }
  })
  await attempt('tabs.sendMessage.http', async () => {
    const tabs = await chrome.tabs.query({ url: 'http://127.0.0.1/*' })
    if (!tabs.length) return { skipped: 'no http tab visible to the extension' }
    return await chrome.tabs.sendMessage(tabs[0].id, { kind: 'ping' })
  })
  await attempt('sidePanel.open.overridable', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(chrome.sidePanel, 'open')
    const original = chrome.sidePanel.open
    let out
    try { chrome.sidePanel.open = async () => 'overridden'; out = await chrome.sidePanel.open({}) } catch (e) { out = 'throws: ' + text(e) }
    try { chrome.sidePanel.open = original } catch (_) {}
    return { result: out, descriptor: descriptor ? { writable: descriptor.writable, configurable: descriptor.configurable } : null }
  })
  await attempt('action.setBadgeText', async () => { await chrome.action.setBadgeText({ text: '1' }); return await chrome.action.getBadgeText({}) })

  await attempt('action.onClicked.shape', async () => {
    const event = chrome.action.onClicked
    const out = {}
    const descriptor = Object.getOwnPropertyDescriptor(chrome.action, 'onClicked')
    out.descriptor = descriptor ? { configurable: descriptor.configurable, writable: descriptor.writable, accessor: !!descriptor.get } : null
    out.addListenerType = typeof event.addListener
    out.frozen = Object.isFrozen(event)
    out.hasDispatch = typeof event.dispatch
    try { event.addListener(() => {}); out.addListenerWorks = true } catch (e) { out.addListenerWorks = text(e) }
    try { const original = event.addListener; event.addListener = function (...args) { return original.apply(this, args) }; out.reassignAddListener = event.addListener !== original } catch (e) { out.reassignAddListener = text(e) }
    try { Object.defineProperty(chrome.action, 'onClicked', { value: event, configurable: true }); out.redefineProperty = true } catch (e) { out.redefineProperty = text(e) }
    return out
  })
  await attempt('sidePanel.setOptions', async () => { await chrome.sidePanel.setOptions({ path: 'popup.html', enabled: true }); return true })
  await attempt('sidePanel.getOptions', async () => await chrome.sidePanel.getOptions({}))
  // Read, never write: `run()` re-executes on every worker restart and a write here
  // would undo the behaviour the native test switches on.
  await attempt('sidePanel.getPanelBehavior', async () => await chrome.sidePanel.getPanelBehavior())
  await attempt('sidePanel.open', async () => { const w = await chrome.windows.getCurrent(); await chrome.sidePanel.open({ windowId: w.id }); return true })

  await attempt('offscreen.createDocument', async () => {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['DOM_PARSER'], justification: 'API surface probe' })
    for (let i = 0; i < 30 && !offscreenLoaded; i++) await new Promise((r) => setTimeout(r, 100))
    return { created: true, pageLoaded: offscreenLoaded }
  }, 8000)
  await attempt('offscreen.hasDocument', async () => typeof chrome.offscreen.hasDocument === 'function' ? await chrome.offscreen.hasDocument() : 'no hasDocument')

  await attempt('contextMenus.create', async () => new Promise((resolve, reject) => {
    chrome.contextMenus.create({ id: 'probe', title: 'probe', contexts: ['page'] }, () => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(true))
  }))
  await attempt('alarms.create', async () => { await chrome.alarms.create('probe', { delayInMinutes: 60 }); return (await chrome.alarms.getAll()).length })
  await attempt('notifications.getAll', async () => await new Promise((resolve) => chrome.notifications.getAll(resolve)))
  await attempt('downloads.search', async () => (await chrome.downloads.search({})).length)
  await attempt('declarativeNetRequest.updateDynamicRules', async () => { await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [], removeRuleIds: [] }); return true })
  await attempt('webRequest.listener', async () => typeof chrome.webRequest.onBeforeRequest?.addListener)
  await attempt('webNavigation.listener', async () => typeof chrome.webNavigation.onCommitted?.addListener)
  await attempt('cookies.getAll', async () => (await chrome.cookies.getAll({})).length)
  await attempt('identity.getRedirectURL', async () => String(chrome.identity.getRedirectURL()).split('/')[2] ? 'redirect-url-ok' : 'empty')
  await attempt('identity.launchWebAuthFlow.type', async () => typeof chrome.identity.launchWebAuthFlow)
  await attempt('permissions.getAll', async () => { const p = await chrome.permissions.getAll(); return { permissions: p.permissions.length, origins: (p.origins || []).length } })
  await attempt('commands.getAll', async () => (await chrome.commands.getAll()).length)
  await attempt('management.getSelf', async () => { const s = await chrome.management.getSelf(); return { name: s.name, enabled: s.enabled } })
  await attempt('runtime.getPlatformInfo', async () => await chrome.runtime.getPlatformInfo())
  await attempt('runtime.sendNativeMessage', async () => await new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage('nebula.api.probe', { ping: 1 }, (response) => chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(response))
  }))
  await attempt('history.search', async () => (await chrome.history.search({ text: '', maxResults: 1 })).length)
  await attempt('bookmarks.getTree', async () => (await chrome.bookmarks.getTree()).length)
  await attempt('commands.getAll', async () => await chrome.commands.getAll())
  await attempt('tabGroups.none', async () => chrome.tabGroups.TAB_GROUP_ID_NONE)
  put('__done', true)
}

run()
"#;
