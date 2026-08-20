import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('minimizing Nebula hides the active WebView without putting it to sleep', () => {
  const browser = read('src/platform/tauriBrowser.ts')
  const start = browser.indexOf('async function syncWebviewWindowVisibilityAfterResize')
  const end = browser.indexOf('async function bindBrowserResize', start)

  assert.ok(start >= 0)
  assert.ok(end > start)

  const visibilityBridge = browser.slice(start, end)
  assert.match(visibilityBridge, /currentWindowIsMinimized\(\)/)
  assert.match(visibilityBridge, /webview\.hide\(\)/)
  assert.match(visibilityBridge, /webview\.show\(\)/)
  assert.doesNotMatch(visibilityBridge, /scheduleTabSleep|webview_set_suspended/)
  assert.match(browser, /appWindow\.onResized\([\s\S]*?onLayoutChange/)
})

test('remembered notification choices feed the background keep-alive policy', () => {
  const browser = read('src/platform/tauriBrowser.ts')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  const prompt = read('src/components/SiteUiPrompt/SiteUiPrompt.tsx')

  assert.match(browser, /siteNotifications[\s\S]*?notificationAllowedSites/)
  assert.match(shell, /permissionKind ===[\s\S]*?'notifications'[\s\S]*?response\.remember/)
  assert.match(shell, /setSiteNotificationPermission\([\s\S]*?request\.uri[\s\S]*?'allow'[\s\S]*?'block'/)
  assert.match(prompt, /const reject[\s\S]*?request\.requestType ===[\s\S]*?'permission'[\s\S]*?remember/)
  assert.match(prompt, /onClick=\{reject\}/)
})

test('allowed site notifications use Nebula-owned Windows toasts for activation routing', () => {
  const privacy = read('src-tauri/src/webview_privacy.rs')
  const handlerStart = privacy.indexOf('NotificationReceivedEventHandler::create')
  const handlerEnd = privacy.indexOf('let mut notification_token', handlerStart)

  assert.ok(handlerStart >= 0)
  assert.ok(handlerEnd > handlerStart)

  const handler = privacy.slice(handlerStart, handlerEnd)
  const blockedBranch = handler.indexOf('!current.site_notifications')
  const emit = handler.indexOf('.emit(SITE_NOTIFICATION_EVENT')

  assert.ok(blockedBranch >= 0)
  assert.ok(emit > blockedBranch)
  assert.match(handler.slice(blockedBranch, emit), /args\.SetHandled\(true\)/)
  assert.match(handler, /let notification = args\.Notification\(\)\?[\s\S]*?args\.SetHandled\(true\)\?[\s\S]*?notification\.ReportShown\(\)/)
  assert.match(handler, /requires_native_toast: true/)
  assert.match(handler, /record_content_notification\(&handler_label\)/)
})

test('notification content preview is a global setting and redacts native site toasts', () => {
  const settings = read('src/core/nebulaSettings.ts')
  const settingsPanel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  const browserShell = read('src/components/BrowserShell/BrowserShell.tsx')
  const notifications = read('src/hooks/useNotifications.ts')
  const privacy = read('src-tauri/src/webview_privacy.rs')
  const siteUi = read('src-tauri/src/site_ui.rs')

  assert.match(settings, /showNotificationContent: boolean/)
  assert.match(settings, /showNotificationContent: true/)
  assert.match(settingsPanel, /label=\{t\('showNotificationContent'\)\}/)
  assert.match(browserShell, /showNotificationContent:\s*notifications\.showNotificationContent/)
  assert.match(notifications, /showNotificationContentRef\.current[\s\S]*?notificationHost\(origin\)/)
  assert.match(privacy, /show_notification_content: bool/)
  assert.match(privacy, /args\.SetHandled\(true\)\?[\s\S]*?notification\.ReportShown\(\)/)
  assert.match(privacy, /requires_native_toast: true/)
  assert.match(siteUi, /notification_content_preview_allowed/)
  assert.match(siteUi, /title: if show_content[\s\S]*?body: if show_content/)
})

test('Instagram message nodes are not marked seen before their delayed text arrives', () => {
  const siteUi = read('src-tauri/src/site_ui.rs')
  const reportStart = siteUi.indexOf('function reportCandidate(candidate)')
  const reportEnd = siteUi.indexOf('function inspectNode(node)', reportStart)
  const report = siteUi.slice(reportStart, reportEnd)

  const readableCheck = report.indexOf("if (!text || text.length > 500")
  const seenMark = report.indexOf('seen.add(candidate)')
  assert.ok(readableCheck >= 0)
  assert.ok(seenMark > readableCheck)
  assert.match(
    siteUi,
    /\[contenteditable\]:not\(\[contenteditable="false"\]\), textarea, input\[type="text"\]/,
  )
})

test('clicking a site notification returns to its live tab before opening a fallback URL', () => {
  const panel = read('src/components/NotificationPanel/NotificationPanel.tsx')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')

  assert.match(panel, /onOpenOrigin\(item\.origin, item\.tabLabel\)/)
  assert.match(shell, /shortcutIdForTabWebviewLabel\(tabLabel\)/)
  assert.match(shell, /tabsRef\.current\.some[\s\S]*?switchToExistingBrowseTab\(shortcutId\)[\s\S]*?return/)
  assert.match(shell, /switchToExistingBrowseTab\(shortcutId\)[\s\S]*?openShortcutByUrl/)
})

test('site notification permissions live in Settings instead of the notification center', () => {
  const panel = read('src/components/NotificationPanel/NotificationPanel.tsx')
  const settings = read('src/components/SettingsPanel/SettingsPanel.tsx')
  const categories = read('src/core/settingsCategories.ts')

  assert.doesNotMatch(panel, /notificationSitePermissions|onSetSitePermission/)
  assert.match(categories, /id: 'notifications'/)
  assert.match(settings, /notificationSites\.map\(\(origin\)/)
  assert.match(settings, /onSetNotificationSitePermission\(origin, 'allow'\)/)
  assert.match(settings, /onSetNotificationSitePermission\(origin, 'block'\)/)
  assert.match(settings, /onSetNotificationSitePermission\(origin, null\)/)
})

test('clicking a native Windows toast foregrounds Nebula and routes to its live tab', () => {
  const native = read('src-tauri/src/native_notification.rs')
  const core = read('src/core/notification.ts')
  const hook = read('src/hooks/useNotifications.ts')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')

  assert.match(native, /toast[\s\S]*?\.Activated\(&activated\)/)
  assert.match(native, /activate_main_window\(&window\)/)
  assert.match(native, /nebula-native-notification-activated/)
  assert.match(core, /listenNativeNotificationActivations/)
  assert.match(core, /show_native_notification'[\s\S]*?tabLabel[\s\S]*?origin/)
  assert.match(hook, /showNativeNotification\([\s\S]*?nativeTitle,[\s\S]*?nativeBody,[\s\S]*?payload\.tabLabel,[\s\S]*?origin/)
  assert.match(shell, /listenNativeNotificationActivations[\s\S]*?switchToExistingBrowseTab\(shortcutId\)[\s\S]*?openShortcutByUrl/)
})

test('native site toasts use a cached site favicon with a safe Nebula fallback', () => {
  const core = read('src/core/notification.ts')
  const hook = read('src/hooks/useNotifications.ts')
  const native = read('src-tauri/src/native_notification.rs')
  const lib = read('src-tauri/src/lib.rs')

  assert.match(core, /showNativeNotification\([\s\S]*?iconUrl\?: string \| null[\s\S]*?iconUrl,/)
  assert.match(hook, /showNativeNotification\([\s\S]*?faviconForUrl\(origin\)/)
  assert.match(lib, /show_native_notification\([\s\S]*?icon_url: Option<String>[\s\S]*?native_notification::show[\s\S]*?\.await/)
  assert.match(native, /validated_site_icon_url[\s\S]*?www\.google\.com[\s\S]*?\/s2\/favicons/)
  assert.match(native, /MAX_SITE_ICON_BYTES[\s\S]*?content_length\(\)[\s\S]*?response\.bytes\(\)/)
  assert.match(native, /cached_site_icon_uri[\s\S]*?fallback_notification_icon_uri/)
  assert.match(native, /placement=\\"appLogoOverride\\"[\s\S]*?hint-crop=\\"circle\\"/)
})

test('clearing permissions resets both WebView2 and Nebula notification state', () => {
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  const notifications = read('src/hooks/useNotifications.ts')
  const privacy = read('src-tauri/src/webview_privacy.rs')

  assert.match(
    shell,
    /kind ===[\s\S]*?'all'[\s\S]*?kind ===[\s\S]*?'permissions'[\s\S]*?clearSiteNotificationPermissions\(\)/,
  )
  assert.match(
    notifications,
    /const clearSitePermissions[\s\S]*?setSitePermissions\(\{\}\)/,
  )
  assert.match(
    privacy,
    /BrowsingDataKind::Permissions \| BrowsingDataKind::All[\s\S]*?clear_non_default_permissions_and_wait/,
  )
  assert.match(privacy, /GetNonDefaultPermissionSettings/)
  assert.match(
    privacy,
    /SetPermissionState\([\s\S]*?COREWEBVIEW2_PERMISSION_STATE_DEFAULT/,
  )
})

test('common realtime social sites are not suspended while inactive', () => {
  const browser = read('src/platform/tauriBrowser.ts')

  for (const host of [
    'facebook.com',
    'instagram.com',
    'linkedin.com',
    'reddit.com',
    'threads.net',
    'tiktok.com',
    'twitter.com',
    'x.com',
  ]) {
    assert.ok(browser.includes(`'${host}'`), `${host} must stay active in the background`)
  }
})

test('persistent social notifications fall back to unread title counts while backgrounded', () => {
  const metadata = read('src-tauri/src/tab_metadata.rs')
  const privacy = read('src-tauri/src/webview_privacy.rs')
  const siteUi = read('src-tauri/src/site_ui.rs')
  const notification = read('src/core/notification.ts')
  const permissions = read('src-tauri/permissions/webview-commands.toml')

  assert.match(metadata, /LAST_SOCIAL_UNREAD_COUNTS/)
  assert.match(metadata, /count <= previous/)
  assert.match(metadata, /GetForegroundWindow/)
  assert.match(metadata, /GetAncestor\(hwnd, GA_ROOT\)/)
  assert.doesNotMatch(metadata, /is_focused\(\)/)
  assert.match(metadata, /title_unread_notification_allowed/)
  assert.match(metadata, /requires_native_toast: true/)
  assert.match(metadata, /content_notification_was_recent/)
  assert.match(metadata, /from_millis\(700\)/)
  assert.match(privacy, /notification_allowed_sites/)
  assert.match(siteUi, /nebula-site-notification-content/)
  assert.match(siteUi, /MutationObserver/)
  assert.match(siteUi, /rect\.left \+ rect\.width \/ 2 >= composerRect\.left/)
  assert.match(siteUi, /validated_web_message_source\(&sender, &args\)/)
  assert.match(siteUi, /source_has_content_adapter/)
  assert.match(siteUi, /record_content_notification/)
  assert.match(notification, /show_native_notification/)
  assert.match(permissions, /"show_native_notification"/)
})

test('WhatsApp content bridge accepts incoming messages only from its exact HTTPS origin', () => {
  const siteUi = read('src-tauri/src/site_ui.rs')
  const metadata = read('src-tauri/src/tab_metadata.rs')

  assert.match(siteUi, /installWhatsAppMessageObserver/)
  assert.match(siteUi, /element\.matches\?\.\('\.message-in'\)/)
  assert.doesNotMatch(siteUi, /matches\?\.\('\.message-out'\)/)
  assert.match(siteUi, /querySelector\('\.selectable-text'\)/)
  assert.match(siteUi, /host\.eq_ignore_ascii_case\("web\.whatsapp\.com"\)/)
  assert.match(siteUi, /url\.scheme\(\) == "https"/)
  assert.match(metadata, /\("web\.whatsapp\.com", "WhatsApp"\)/)
})

test('WhatsApp native toasts identify the service before sender and message content', () => {
  const notifications = read('src/hooks/useNotifications.ts')

  assert.match(notifications, /hostname\.toLowerCase\(\) === 'web\.whatsapp\.com'/)
  assert.match(notifications, /const nativeTitle = isWhatsApp \? 'WhatsApp' : title/)
  assert.match(notifications, /\[title, body\]\.filter\(Boolean\)\.join\('\\n'\)/)
  assert.match(notifications, /showNativeNotification\([\s\S]*?nativeTitle,[\s\S]*?nativeBody/)
})

test('notification delivery deduplicates site events and routes completed downloads', () => {
  const settings = read('src/core/nebulaSettings.ts')
  const settingsPanel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  const notifications = read('src/hooks/useNotifications.ts')
  const panel = read('src/components/NotificationPanel/NotificationPanel.tsx')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  const native = read('src-tauri/src/native_notification.rs')

  assert.doesNotMatch(settings, /focusModeAlerts/)
  assert.match(settings, /downloadNotifications: boolean/)
  assert.match(settingsPanel, /downloadNotifications/)
  assert.match(notifications, /recentSiteNotificationsRef/)
  assert.match(notifications, /previousTimestamp[\s\S]*?2_500/)
  assert.match(notifications, /nativeDownloadToastIdsRef/)
  assert.match(notifications, /download\.requiresConfirmation/)
  assert.match(
    notifications,
    /showNativeNotification\([\s\S]*?download\.fileName[\s\S]*?download\.id/,
  )
  assert.match(panel, /onOpenDownload\(item\.downloadId\)/)
  assert.match(shell, /downloadId[\s\S]*?actDownload\(downloadId, 'reveal'\)/)
  assert.match(native, /download_id: Option<String>/)
  assert.match(native, /directory\.contains\("\\\\target\\\\"\)/)
  assert.match(native, /include_bytes!\("\.\.\/icons\/128x128\.png"\)/)
  assert.match(native, /placement=\\"appLogoOverride\\"/)
})
