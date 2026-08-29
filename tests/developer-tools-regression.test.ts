import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const inspector = readFileSync('src/components/DeveloperTools/DeveloperTools.tsx', 'utf8')
const bridge = readFileSync('src-tauri/src/devtools_bridge.rs', 'utf8')
const contextMenu = readFileSync('src-tauri/src/context_menu.rs', 'utf8')
const contextMenuUi = readFileSync('src/components/SiteContextMenu/SiteContextMenu.tsx', 'utf8')
const browserShell = readFileSync('src/components/BrowserShell/BrowserShell.tsx', 'utf8')
const platform = readFileSync('src/platform/tauriDevTools.ts', 'utf8')

test('Inspector subscribes to live CDP events and releases the active tab cleanly', () => {
  assert.match(inspector, /await subscribeTabDevTools\(activeTabId\)/)
  assert.match(inspector, /unsubscribeTabDevTools\(activeTabId\)/)
  assert.match(platform, /'Runtime\.enable'/)
  assert.match(platform, /'Network\.enable'/)
  assert.match(platform, /'Performance\.enable'/)
  assert.match(bridge, /"Runtime\.consoleAPICalled"/)
  assert.match(bridge, /"Network\.requestWillBeSent"/)
  assert.match(bridge, /"Debugger\.scriptParsed"/)
  assert.match(bridge, /"Overlay\.inspectNodeRequested"/)
  assert.match(platform, /devToolsLifecycleQueues/)
  assert.match(platform, /queueDevToolsLifecycle\(shortcutId/)
  assert.match(platform, /await callTabDevTools\(shortcutId, 'Overlay\.setInspectMode'/)
  assert.match(platform, /await callTabDevTools\(shortcutId, 'Overlay\.hideHighlight'/)
})

test('page context menu Inspect resolves the clicked DOM node in Nebula Inspector', () => {
  assert.match(contextMenu, /NEBULA_INSPECT_COMMAND_ID: i32 = -10_002/)
  assert.match(contextMenu, /payload\.command_id = NEBULA_INSPECT_COMMAND_ID/)
  assert.match(contextMenuUi, /commandId: NEBULA_INSPECT_COMMAND_ID/)
  assert.match(contextMenuUi, /t\('contextInspect'\)/)
  assert.match(browserShell, /commandId ===\s*NEBULA_INSPECT_COMMAND_ID/)
  assert.match(browserShell, /setDeveloperToolsInspectRequest\(\{/)
  assert.match(inspector, /'DOM\.getNodeForLocation'/)
  assert.match(inspector, /inspectRequest\.x/)
  assert.match(inspector, /inspectRequest\.y/)
  assert.match(inspector, /document\.elementFromPoint/)
  assert.match(inspector, /'DOM\.requestNode'/)
  assert.match(inspector, /node\.nodeType !== 1/)
  assert.ok(
    inspector.indexOf('document.elementFromPoint') < inspector.indexOf("'DOM.getNodeForLocation'"),
    'stable elementFromPoint hit testing should run before the WebView2-sensitive CDP fallback',
  )
  assert.doesNotMatch(inspector, /'DOM\.getNodeForLocation',[\s\S]{0,180}ignorePointerEventsNone/)
  assert.match(platform, /throw new Error\(`\$\{method\}: \$\{String\(error\)\}`\)/)
})

test('Site panel separates Cookie API capability from Nebula privacy policy', () => {
  assert.match(inspector, /cookieApiAvailable/)
  assert.match(inspector, /privacyState\.strictCookies/)
  assert.match(inspector, /privacyState\.trackingLevel/)
  assert.match(inspector, /privacyState\.blockTrackers/)
  assert.match(inspector, /'Network\.getCookies'/)
  assert.doesNotMatch(inspector, /<span>\{copy\.cookies\}<\/span><strong>\{pageInfo\?\.cookieEnabled/)
})

test('Elements supports picking, searching, editing and attribute operations', () => {
  assert.match(inspector, /'Overlay\.setInspectMode'/)
  assert.match(inspector, /onElementPickerModeChange\?\.\(next\)/)
  assert.match(browserShell, /setViewMode\(active \? 'browsing' : 'overlay'\)/)
  assert.match(inspector, /'DOM\.performSearch'/)
  assert.match(inspector, /'DOM\.getSearchResults'/)
  assert.match(inspector, /'DOM\.setOuterHTML'/)
  assert.match(inspector, /'DOM\.setAttributeValue'/)
  assert.match(inspector, /'DOM\.removeAttribute'/)
  assert.match(inspector, /'CSS\.getComputedStyleForNode'/)
})

test('Network, Sources, Storage and Accessibility expose their high-value CDP tools', () => {
  assert.match(inspector, /'Network\.getResponseBody'/)
  assert.match(inspector, /curlForRequest/)
  assert.match(inspector, /'Network\.setCacheDisabled'/)
  assert.match(inspector, /'Debugger\.getScriptSource'/)
  assert.match(inspector, /'Accessibility\.getFullAXTree'/)
  assert.match(inspector, /'Network\.deleteCookies'/)
  assert.match(inspector, /`\$\{area\}\.removeItem/)
  assert.match(inspector, /indexedDB\.databases/)
  assert.match(inspector, /navigator\.serviceWorker\.getRegistrations/)
})

test('Inspector keeps captured diagnostics attributable and avoids misleading orphan rows', () => {
  assert.match(inspector, /RAW_EVENT_SUPPRESSIONS/)
  assert.match(inspector, /'Debugger\.scriptParsed'/)
  assert.match(inspector, /consoleSourceLabel\(entry\)/)
  assert.match(inspector, /typeof response\.url === 'string'/)
  assert.match(inspector, /if \(!current\) return items/)
  assert.match(inspector, /if \(!items\.some\(\(item\) => item\.requestId === requestId\)\) return items/)
  assert.match(inspector, /secureContext: window\.isSecureContext/)
  assert.match(inspector, /sourceEntries\.length \? copy\.selectSource : copy\.noSources/)
})

test('Inspector separates blocked traffic and keeps dense panels readable and private', () => {
  assert.match(inspector, /isClientBlockedNetworkEntry/)
  assert.match(inspector, /ERR_BLOCKED_BY_CLIENT/)
  assert.match(inspector, /blockedRequestCount/)
  assert.match(inspector, /!isClientBlockedConsoleEntry\(entry\)/)
  assert.match(inspector, /revealedCookieIds/)
  assert.doesNotMatch(inspector, /<strong title=\{cookie\.value\}>/)
  assert.match(inspector, /showAnonymousSources/)
  assert.match(inspector, /sourceGroupLabel/)
  assert.match(inspector, /showAccessibilityNoise/)
  assert.match(inspector, /filteredAccessibilityNodes/)
  assert.match(inspector, /selectSection\(item\.id\)/)
  assert.match(inspector, /resourceTimingEntries/)
})
