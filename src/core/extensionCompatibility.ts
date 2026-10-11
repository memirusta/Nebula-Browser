/** Static evidence only: neither permissions nor successful loading prove functionality. */
export interface CompatibilityMetadata {
  manifestVersion?: number
  minBrowserVersion?: string
  permissions?: readonly string[]
  optionalPermissions?: readonly string[]
  hostPermissions?: readonly string[]
  optionalHostPermissions?: readonly string[]
}

export type CompatibilityIssueCode = 'manifest' | 'missingMetadata' | 'minimumVersion' | 'runtimeUnknown'
  | 'nativeMessaging' | 'identity' | 'browserIntegration' | 'unknownPermission'
  | 'broadAccess' | 'popup' | 'sidePanel' | 'devtools' | 'browserOverride' | 'legacyBackground'
  // Gaps measured in Nebula/WebView2 (docs/CURRENT_STATE.md): each names a feature that is
  // declared in the manifest and does not work yet, not a vague "needs testing".
  | 'keyboardShortcuts' | 'notifications' | 'contextMenus' | 'userScripts' | 'omnibox' | 'toolbarClick' | 'googleSignIn'
export interface CompatibilityIssue {
  code: CompatibilityIssueCode
  severity: 'blocked' | 'review' | 'info'
  details: string[]
  optional: boolean
}
export interface CompatibilityReport {
  scope: 'metadata' | 'manifest'
  status: 'blocked' | 'review' | 'candidate'
  issues: CompatibilityIssue[]
  runtimeTest: 'not-run'
  functionalityTest: 'not-run'
}

/** Features the extension declares that Nebula does not provide yet (measured, not a guess). */
// `toolbarClick` is deliberately not here: the emulated click works (Beta), it is only limited.
const KNOWN_GAPS: ReadonlySet<CompatibilityIssueCode> = new Set(['keyboardShortcuts', 'notifications', 'contextMenus',
  'userScripts', 'omnibox', 'googleSignIn'])
export function isKnownGap(issue: Pick<CompatibilityIssue, 'code' | 'optional'>): boolean {
  // An optional permission may never be used, so it is only information.
  return KNOWN_GAPS.has(issue.code) && !issue.optional
}

// This list recognizes permission names; it is deliberately NOT a support allowlist.
const knownPermissions = new Set(('activeTab alarms background bookmarks browsingData clipboardRead clipboardWrite '
  + 'contentSettings contextMenus cookies debugger declarativeContent declarativeNetRequest declarativeNetRequestFeedback '
  + 'declarativeNetRequestWithHostAccess desktopCapture downloads downloads.open downloads.ui favicon fontSettings '
  + 'gcm geolocation history identity identity.email idle management nativeMessaging notifications offscreen '
  + 'pageCapture power printerProvider printing printingMetrics privacy processes proxy readingList scripting search '
  + 'sessions sidePanel storage system.cpu system.display system.memory system.storage tabCapture tabGroups tabs '
  + 'topSites tts ttsEngine unlimitedStorage userScripts vpnProvider wallpaper webNavigation webRequest '
  + 'webRequestAuthProvider webRequestBlocking').split(' '))
const browserPermissions = new Set(['tabs', 'tabGroups', 'sessions', 'bookmarks', 'history', 'browsingData', 'management',
  'topSites', 'readingList', 'search', 'proxy', 'debugger', 'desktopCapture', 'tabCapture', 'downloads'])

function versionParts(value: string): number[] | null {
  if (!/^\d+(?:\.\d+){0,3}$/.test(value)) return null
  const parts = value.split('.').map(Number)
  return parts.every(Number.isSafeInteger) ? parts : null
}

function validExtensionVersion(value: string): boolean {
  const parts = versionParts(value)
  return !!parts && parts.every(n => n <= 65535) && parts.some(n => n > 0)
    && value.split('.').every(part => part.length === 1 || !part.startsWith('0'))
}

export function compareBrowserVersions(actual: string, minimum: string): number | null {
  const a = versionParts(actual), b = versionParts(minimum)
  if (!a || !b) return null
  for (let i = 0; i < 4; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0) ? 1 : -1
  }
  return 0
}

export function assessExtensionCompatibility(metadata: CompatibilityMetadata, runtimeVersion?: string): CompatibilityReport {
  const issues: CompatibilityIssue[] = []
  const add = (code: CompatibilityIssueCode, severity: CompatibilityIssue['severity'], details: string[] = [], optional = false) => {
    issues.push({ code, severity, details, optional })
  }
  if (metadata.manifestVersion == null) add('missingMetadata', 'review', ['manifest_version'])
  else if (metadata.manifestVersion !== 3) add('manifest', 'blocked', [String(metadata.manifestVersion)])
  if (metadata.permissions == null || metadata.hostPermissions == null) add('missingMetadata', 'review', ['permissions'])
  if (metadata.minBrowserVersion) {
    const compared = runtimeVersion ? compareBrowserVersions(runtimeVersion, metadata.minBrowserVersion) : null
    if (compared == null) add('runtimeUnknown', 'review', [metadata.minBrowserVersion])
    else if (compared < 0) add('minimumVersion', 'blocked', [metadata.minBrowserVersion, runtimeVersion!])
  }
  for (const optional of [false, true]) {
    const permissions = [...new Set((optional ? metadata.optionalPermissions : metadata.permissions) ?? [])]
    const severity = optional ? 'info' : 'review'
    if (permissions.includes('nativeMessaging')) add('nativeMessaging', severity, ['nativeMessaging'], optional)
    if (permissions.some(p => p === 'identity' || p === 'identity.email')) add('identity', severity, ['identity'], optional)
    if (permissions.includes('sidePanel')) add('sidePanel', severity, ['sidePanel'], optional)
    // Declared APIs Nebula does not bridge to the browser UI yet.
    if (permissions.includes('notifications')) add('notifications', severity, ['notifications'], optional)
    if (permissions.includes('contextMenus')) add('contextMenus', severity, ['contextMenus'], optional)
    if (permissions.includes('userScripts')) add('userScripts', severity, ['userScripts'], optional)
    const integration = permissions.filter(p => browserPermissions.has(p))
    if (integration.length) add('browserIntegration', severity, integration, optional)
    const unknown = permissions.filter(p => !knownPermissions.has(p) && !/^(\*|https?|file|ftp):\/\//.test(p) && p !== '<all_urls>')
    if (unknown.length) add('unknownPermission', severity, unknown, optional)
    const hosts = [...(optional ? metadata.optionalHostPermissions : metadata.hostPermissions) ?? [], ...permissions]
    const broad = [...new Set(hosts.filter(host => ['<all_urls>', '*://*/*', 'https://*/*', 'http://*/*', 'file:///*'].includes(host)))]
    if (broad.length) add('broadAccess', 'info', broad, optional)
  }
  return report('metadata', issues)
}

function report(scope: CompatibilityReport['scope'], issues: CompatibilityIssue[]): CompatibilityReport {
  return {
    scope,
    status: issues.some(i => i.severity === 'blocked') ? 'blocked' : issues.some(i => i.severity === 'review') ? 'review' : 'candidate',
    issues, runtimeTest: 'not-run', functionalityTest: 'not-run',
  }
}

export function assessExtensionManifest(value: unknown, runtimeVersion?: string): CompatibilityReport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return report('manifest', [{ code: 'manifest', severity: 'blocked', details: ['Invalid manifest'], optional: false }])
  }
  const manifest = value as Record<string, unknown>
  const stringArray = (key: string) => Array.isArray(manifest[key]) && (manifest[key] as unknown[]).every(v => typeof v === 'string')
    ? manifest[key] as string[] : undefined
  const result = assessExtensionCompatibility({
    manifestVersion: typeof manifest.manifest_version === 'number' ? manifest.manifest_version : undefined,
    minBrowserVersion: typeof manifest.minimum_chrome_version === 'string' ? manifest.minimum_chrome_version : undefined,
    permissions: manifest.permissions === undefined ? [] : stringArray('permissions'),
    optionalPermissions: stringArray('optional_permissions'),
    hostPermissions: manifest.host_permissions === undefined ? [] : stringArray('host_permissions'),
    optionalHostPermissions: stringArray('optional_host_permissions'),
  }, runtimeVersion)
  const add = (code: CompatibilityIssueCode, severity: CompatibilityIssue['severity'], details: string[]) =>
    result.issues.push({ code, severity, details, optional: false })
  if (manifest.manifest_version !== 3 || typeof manifest.name !== 'string' || !manifest.name.trim()
    || typeof manifest.version !== 'string' || !validExtensionVersion(manifest.version)) add('manifest', 'blocked', ['name / version / manifest_version'])
  for (const key of ['action', 'background', 'options_ui', 'side_panel', 'icons']) {
    const value = manifest[key]
    if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value))) add('manifest', 'blocked', [key])
  }
  for (const key of ['permissions', 'optional_permissions', 'host_permissions', 'optional_host_permissions']) {
    if (manifest[key] !== undefined && !stringArray(key)) add('manifest', 'blocked', [key])
  }
  if (manifest.minimum_chrome_version !== undefined && (typeof manifest.minimum_chrome_version !== 'string'
    || !versionParts(manifest.minimum_chrome_version))) add('manifest', 'blocked', ['minimum_chrome_version'])
  const action = manifest.action as Record<string, unknown> | undefined
  // A toolbar popup is no longer a limitation: Nebula opens it from the extensions box.
  // A toolbar icon with no popup is reached through Nebula's emulated toolbar click.
  if (action && !action.default_popup) {
    const grants = stringArray('permissions')?.includes('activeTab') ? ['activeTab'] : []
    add('toolbarClick', 'review', grants)
  }
  const commands = manifest.commands
  if (commands && typeof commands === 'object' && !Array.isArray(commands)) {
    const bound = Object.entries(commands as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === 'object' && 'suggested_key' in (value as object)).map(([name]) => name)
    if (bound.length) add('keyboardShortcuts', 'review', bound)
  }
  if (manifest.omnibox) add('omnibox', 'review', ['omnibox'])
  if (manifest.oauth2 && stringArray('permissions')?.includes('identity')) add('googleSignIn', 'review', ['oauth2'])
  if (manifest.side_panel && !result.issues.some(i => i.code === 'sidePanel' && !i.optional)) add('sidePanel', 'review', ['side_panel'])
  if (manifest.devtools_page) add('devtools', 'review', [String(manifest.devtools_page)])
  if (manifest.chrome_url_overrides || manifest.chrome_settings_overrides) add('browserOverride', 'review', ['chrome overrides'])
  const background = manifest.background as Record<string, unknown> | undefined
  if (background?.scripts || background?.page || background?.persistent !== undefined) add('legacyBackground', 'blocked', ['background'])
  return report('manifest', result.issues)
}
