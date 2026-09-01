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
  const broker = read('src-tauri/src/notification_broker.rs')
  const handlerStart = privacy.indexOf('NotificationReceivedEventHandler::create')
  const handlerEnd = privacy.indexOf('let mut notification_token', handlerStart)

  assert.ok(handlerStart >= 0)
  assert.ok(handlerEnd > handlerStart)

  const handler = privacy.slice(handlerStart, handlerEnd)
  assert.match(handler, /args\.SetHandled\(true\)\?/)
  assert.match(handler, /permission_allows\([\s\S]*?NotificationSource::Webview2/)
  assert.match(handler, /if allowed[\s\S]*?ReportShown\(\)[\s\S]*?ReportClosed\(\)/)
  assert.match(handler, /notification_broker::submit\([\s\S]*?NotificationSource::Webview2/)
  assert.match(broker, /native_notification::show\([\s\S]*?event\.tab_label[\s\S]*?event\.origin/)
})

test('notification content preview is a global setting and redacts native site toasts', () => {
  const settings = read('src/core/nebulaSettings.ts')
  const settingsPanel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  const browserShell = read('src/components/BrowserShell/BrowserShell.tsx')
  const notifications = read('src/hooks/useNotifications.ts')
  const privacy = read('src-tauri/src/webview_privacy.rs')
  const broker = read('src-tauri/src/notification_broker.rs')
  const errorPage = read('src-tauri/src/tab_error_page.rs')

  assert.match(settings, /showNotificationContent: boolean/)
  assert.match(settings, /showNotificationContent: true/)
  assert.match(settingsPanel, /label=\{t\('showNotificationContent'\)\}/)
  assert.match(browserShell, /showNotificationContent:\s*notifications\.showNotificationContent/)
  assert.doesNotMatch(notifications, /showNotificationContentRef|requiresNativeToast/)
  assert.match(privacy, /show_notification_content: bool/)
  assert.match(privacy, /NotificationDeliveryPolicy[\s\S]*?show_content/)
  assert.match(broker, /let title = if show_content[\s\S]*?let (?:mut )?body = if show_content/)
  assert.match(errorPage, /Yeni bir mesajın veya bildirimin var\./)
  assert.match(errorPage, /You have a new message or notification\./)
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
  assert.match(siteUi, /function messageDetailsFromCandidate/)
  assert.match(siteUi, /function isInstagramReactionActivity/)
  assert.match(siteUi, /function isGenericInstagramActivity/)
  assert.doesNotMatch(siteUi, /function instagramInboxRow/)
  assert.doesNotMatch(siteUi, /window\.__nebulaScanInstagramNotificationContent/)
  assert.match(siteUi, /isReaction: isInstagramReactionActivity/)
  assert.match(siteUi, /details\.isReaction \? 'reaction'/)
  assert.match(siteUi, /attributeFilter: \['aria-label', 'title'\]/)
  assert.match(siteUi, /mutation\.type === 'characterData' \|\| mutation\.type === 'attributes'/)
  assert.match(siteUi, /hasQuotedPreview/)
  assert.match(
    siteUi,
    /notificationData: details\.isReply && !details\.isReaction \? \{ replyText: text \} : null/,
  )
  assert.match(report, /function queueCandidate[\s\S]*reportCandidate\(candidate\)/)
  assert.doesNotMatch(report, /reportIncoming\(candidate\)/)
  assert.doesNotMatch(report, /Normal message; DOM adapter/)

  const reactionStart = siteUi.indexOf('function isInstagramReactionActivity')
  const reactionEnd = siteUi.indexOf('function isGenericInstagramActivity', reactionStart)
  assert.ok(reactionStart >= 0)
  assert.ok(reactionEnd > reactionStart)
  const isInstagramReactionActivity = new Function(
    `${siteUi.slice(reactionStart, reactionEnd)}; return isInstagramReactionActivity;`,
  )() as (text: string) => boolean
  assert.equal(isInstagramReactionActivity('Reacted 💟 to your message · 2m'), true)
  assert.equal(isInstagramReactionActivity('Reacted 💟 to your message 2m'), true)
  assert.equal(isInstagramReactionActivity('Sincap67 Reacted ❤️ to your message'), true)
  assert.equal(isInstagramReactionActivity('You have a new message or notification.'), false)

  const genericStart = siteUi.indexOf('function isGenericInstagramActivity')
  const genericEnd = siteUi.indexOf('function instagramActivityText', genericStart)
  const isGenericInstagramActivity = new Function(
    `${siteUi.slice(genericStart, genericEnd)}; return isGenericInstagramActivity;`,
  )() as (text: string) => boolean
  assert.equal(isGenericInstagramActivity('Typing...'), true)
  const metadata = read('src-tauri/src/tab_metadata.rs')
  assert.doesNotMatch(metadata, /request_instagram_content_scan/)
})

test('clicking a site notification returns to its live tab before opening a fallback URL', () => {
  const panel = read('src/components/NotificationPanel/NotificationPanel.tsx')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')

  assert.match(panel, /onOpenOrigin\(item\.origin, item\.tabLabel, item\.targetUrl\)/)
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
  const broker = read('src-tauri/src/notification_broker.rs')
  const core = read('src/core/notification.ts')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')

  assert.match(native, /toast[\s\S]*?\.Activated\(&activated\)/)
  assert.match(native, /activate_main_window\(&window\)/)
  assert.match(native, /nebula-native-notification-activated/)
  assert.match(core, /listenNativeNotificationActivations/)
  assert.match(core, /show_native_notification'[\s\S]*?tabLabel[\s\S]*?origin/)
  assert.match(broker, /native_notification::show\([\s\S]*?Some\(event\.tab_label\.clone\(\)\)[\s\S]*?Some\(event\.origin\.clone\(\)\)/)
  assert.match(native, /record_click_routing/)
  assert.match(shell, /listenNativeNotificationActivations[\s\S]*?switchToExistingBrowseTab\(shortcutId\)[\s\S]*?openShortcutByUrl/)
})

test('native site toasts use a cached site favicon with a safe Nebula fallback', () => {
  const broker = read('src-tauri/src/notification_broker.rs')
  const native = read('src-tauri/src/native_notification.rs')
  const lib = read('src-tauri/src/lib.rs')

  assert.match(broker, /favicon_url[\s\S]*?https:\/\/www\.google\.com\/s2\/favicons/)
  assert.match(broker, /native_notification::show\([\s\S]*?favicon_url\(&event\.origin\)/)
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

test('persistent social notifications surface while their source tab is hidden', () => {
  const metadata = read('src-tauri/src/tab_metadata.rs')
  const native = read('src-tauri/src/lib.rs')
  const privacy = read('src-tauri/src/webview_privacy.rs')
  const siteUi = read('src-tauri/src/site_ui.rs')
  const broker = read('src-tauri/src/notification_broker.rs')
  const notification = read('src/core/notification.ts')
  const permissions = read('src-tauri/permissions/webview-commands.toml')
  const bridgeRuntime = siteUi.match(
    /const PROTOCOL_HANDLER_BRIDGE_SCRIPT: &str = r#"\r?\n([\s\S]*?)\r?\n"#;/,
  )?.[1]

  assert.ok(bridgeRuntime)
  assert.doesNotThrow(() => new Function(bridgeRuntime))

  assert.match(metadata, /LAST_SOCIAL_UNREAD_COUNTS/)
  assert.match(metadata, /count <= previous/)
  assert.match(metadata, /GetForegroundWindow/)
  assert.match(metadata, /GetAncestor\(hwnd, GA_ROOT\)/)
  assert.doesNotMatch(metadata, /is_focused\(\)/)
  assert.match(metadata, /ACTIVE_TAB_LABELS/)
  assert.match(metadata, /notification_should_surface/)
  assert.match(metadata, /Some\(Some\(active_label\)\) => active_label != source_tab_label/)
  assert.match(native, /set_active_tab_for_window\(&window_label, active_tab_label\.as_deref\(\)\)/)
  assert.match(metadata, /from_millis\(700\)/)
  assert.match(metadata, /NotificationSource::TitleFallback/)
  assert.match(privacy, /notification_allowed_sites/)
  assert.match(siteUi, /nebula-site-notification-content/)
  assert.match(siteUi, /MutationObserver/)
  assert.match(siteUi, /installInstagramPersistentNotificationObserver/)
  assert.match(siteUi, /navigator\.serviceWorker\.getRegistrations\(\)/)
  assert.match(siteUi, /registration\.getNotifications\(\)/)
  assert.match(siteUi, /adapter: 'service-worker-snapshot'/)
  assert.match(siteUi, /notification\.icon/)
  assert.match(siteUi, /data\.notifType/)
  assert.match(siteUi, /data\.uri/)
  assert.match(siteUi, /registration\.showNotification\(title, options\)/)
  assert.match(siteUi, /__nebulaPresentationVersion: 1/)
  assert.match(siteUi, /replacementToken: replacementToken/)
  assert.match(siteUi, /nebula-upgrade-persistent-notification/)
  assert.match(siteUi, /permission_allows_rich_content/)
  assert.match(siteUi, /PostWebMessageAsJson/)
  assert.match(siteUi, /tag: tag/)
  assert.match(siteUi, /silent: true/)
  assert.match(siteUi, /senderName: presentation\.senderName/)
  assert.match(siteUi, /eventKind: presentation\.eventKind/)
  assert.match(siteUi, /installInstagramAvatarObserver/)
  assert.match(siteUi, /function instagramAvatarKey/)
  assert.match(siteUi, /character !== '\\uFE0E' && character !== '\\uFE0F'/)
  assert.match(siteUi, /nebula-site-avatar-hint/)
  assert.match(siteUi, /profileImageUrl: profileImageUrl/)
  assert.match(siteUi, /presentation\.profileImageUrl \|\| notification\.icon/)
  assert.match(siteUi, /metadataMessageText/)
  assert.match(siteUi, /conversationAvatar/)
  assert.match(siteUi, /remember_sender_message/)
  assert.match(broker, /remember_sender_avatar/)
  assert.match(broker, /sender_avatar_hint/)
  assert.match(broker, /SENDER_AVATAR_TTL/)
  assert.match(broker, /WEBVIEW2_ENRICHMENT_DELAY_MS/)
  assert.match(broker, /INSTAGRAM_DOM_FALLBACK_DELAY_MS/)
  assert.match(privacy, /notification\.Tag\(value\)/)
  assert.doesNotMatch(siteUi, /www-service-worker\.js/)
  assert.match(siteUi, /rect\.left \+ rect\.width \/ 2 >= composerRect\.left/)
  assert.match(siteUi, /validated_web_message_source\(&sender, &args\)/)
  assert.match(siteUi, /source_has_content_adapter/)
  assert.match(siteUi, /NotificationSource::ContentAdapter/)
  assert.match(
    siteUi,
    /notification_should_surface\(\s*&protocol_app,\s*&protocol_label,\s*\)/,
  )
  assert.match(broker, /recent-webview2-authority/)
  assert.match(broker, /recent-service-worker-snapshot-authority/)
  assert.match(broker, /recent-higher-authority-source/)
  assert.match(broker, /persistent-notification-upgraded-in-place/)
  assert.match(notification, /nebula-notification-broker/)
  assert.match(notification, /siteName: string/)
  assert.match(notification, /senderName: string/)
  assert.match(notification, /eventKind: string/)
  assert.match(notification, /notificationType: string/)
  assert.match(notification, /targetUrl: string/)
  assert.match(permissions, /"notification_broker_replay"/)
})

test('WhatsApp reply bridge accepts incoming replies only from its exact HTTPS origin', () => {
  const siteUi = read('src-tauri/src/site_ui.rs')
  const metadata = read('src-tauri/src/tab_metadata.rs')

  assert.match(siteUi, /installWhatsAppMessageObserver/)
  assert.match(siteUi, /candidate\.querySelector\('\[data-testid="tail-in"\]'\)/)
  assert.match(siteUi, /candidate\.querySelector\('\[data-testid="quoted-message"\]'\)/)
  assert.match(siteUi, /candidate\.querySelector\('\[data-testid="tail-out"\]'\)/)
  assert.match(siteUi, /querySelectorAll\('\[data-testid="selectable-text"\], \.selectable-text'\)/)
  assert.match(siteUi, /host\.eq_ignore_ascii_case\("web\.whatsapp\.com"\)/)
  assert.match(siteUi, /url\.scheme\(\) == "https"/)
  assert.match(metadata, /\("web\.whatsapp\.com", "WhatsApp"\)/)
})

test('native social toasts keep the service footer without a redundant Nebula prefix', () => {
  const broker = read('src-tauri/src/notification_broker.rs')
  const native = read('src-tauri/src/native_notification.rs')
  const metadata = read('src-tauri/src/tab_metadata.rs')

  assert.match(broker, /notification_site_name/)
  assert.match(broker, /sender_name: presentation\.sender_name/)
  assert.match(broker, /event_kind: presentation\.event_kind/)
  assert.match(broker, /native_notification::show\([\s\S]*?event\.site_name[\s\S]*?event\.sender_name[\s\S]*?event\.event_kind/)
  assert.match(native, /<text hint-maxLines=\\\"1\\\">/)
  assert.match(native, /placement=\\\"attribution\\\"/)
  assert.match(native, /\(site_name != "Nebula"\)\.then_some\(site_name\)/)
  assert.doesNotMatch(native, /Some\("Nebula"\),/)
  assert.match(native, /additional_messages_label/)
  assert.match(native, /NotificationData/)
  assert.match(native, /UpdateWithTagAndGroup/)
  assert.match(native, /SetSuppressPopup\(true\)/)
  assert.match(native, /SetData/)
  assert.match(native, /SetTag/)
  assert.match(native, /SetGroup/)
  assert.match(broker, /update_toast_thread/)
  assert.match(broker, /reset_toast_threads_for_tab/)
  assert.match(metadata, /source_tab_is_actively_visible/)
  assert.match(metadata, /previous\.is_some_and\(\|previous\| count < previous\)[\s\S]*?source_tab_is_actively_visible/)
  assert.match(broker, /collect_metadata_messages/)
  assert.match(native, /reset_toast_thread/)
  assert.match(broker, /reply_display_body/)
  assert.match(native, /trusted_instagram_profile/)
  assert.match(native, /hint-crop=\\\"circle\\\"/)
})

test('notification delivery deduplicates site events and routes completed downloads', () => {
  const settings = read('src/core/nebulaSettings.ts')
  const settingsPanel = read('src/components/SettingsPanel/SettingsPanel.tsx')
  const notifications = read('src/hooks/useNotifications.ts')
  const broker = read('src-tauri/src/notification_broker.rs')
  const panel = read('src/components/NotificationPanel/NotificationPanel.tsx')
  const shell = read('src/components/BrowserShell/BrowserShell.tsx')
  const native = read('src-tauri/src/native_notification.rs')

  assert.doesNotMatch(settings, /focusModeAlerts/)
  assert.match(settings, /downloadNotifications: boolean/)
  assert.match(settingsPanel, /downloadNotifications/)
  assert.doesNotMatch(notifications, /recentSiteNotificationsRef|previousTimestamp/)
  assert.match(broker, /NotificationSource::Webview2 => None/)
  assert.match(broker, /MAX_REPLAY_EVENTS: usize = 200/)
  assert.match(broker, /MAX_DIAGNOSTICS: usize = 200/)
  assert.match(broker, /MAX_DIAGNOSTIC_LOG_BYTES: u64 = 1024 \* 1024/)
  assert.match(broker, /notification-broker\.jsonl/)
  assert.match(broker, /site-broker-\{\}-\{sequence\}/)
  assert.match(broker, /fn diagnostic_origin[\s\S]*?normalized_origin/)
  assert.match(notifications, /replaySiteNotifications[\s\S]*?\}, \[add\]\)/)
  assert.match(notifications, /nativeDownloadToastIdsRef/)
  assert.match(notifications, /download\.requiresConfirmation/)
  assert.match(
    notifications,
    /showNativeNotification\([\s\S]*?download\.fileName[\s\S]*?download\.id/,
  )
  assert.match(panel, /onOpenDownload\(item\.downloadId\)/)
  assert.match(panel, /className=\{styles\.avatar\}/)
  assert.match(panel, /item\.notificationType/)
  assert.match(panel, /item\.eventKind/)
  assert.match(panel, /item\.senderName/)
  assert.match(panel, /item\.siteName/)
  assert.match(panel, /item\.targetUrl/)
  assert.match(shell, /targetUrl[\s\S]*?navigateBrowseTab\(shortcutId, targetUrl\)/)
  assert.match(shell, /downloadId[\s\S]*?actDownload\(downloadId, 'reveal'\)/)
  assert.match(native, /download_id: Option<String>/)
  assert.match(native, /CreateToastNotifierWithId[\s\S]*?app\.config\(\)\.identifier/)
  assert.match(native, /emergency PowerShell fallback/)
  assert.match(native, /include_bytes!\("\.\.\/icons\/128x128\.png"\)/)
  assert.match(native, /placement=\\"appLogoOverride\\"/)
})
