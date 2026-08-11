#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{LazyLock, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde::{Deserialize, Serialize};
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2NavigationCompletedEventHandler,
        ICoreWebView2NavigationStartingEventHandler, ICoreWebView2NotificationReceivedEventHandler,
        ICoreWebView2PermissionRequestedEventHandler, ICoreWebView2Profile3, ICoreWebView2Profile4,
        ICoreWebView2Profile6, ICoreWebView2WebResourceRequestedEventHandler, ICoreWebView2_13,
        ICoreWebView2_2, ICoreWebView2_24, COREWEBVIEW2_PERMISSION_KIND,
        COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        COREWEBVIEW2_PERMISSION_STATE_DEFAULT, COREWEBVIEW2_PERMISSION_STATE_DENY,
        COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_BALANCED,
        COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE, COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_STRICT,
        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT,
    };
    use webview2_com::{
        ExecuteScriptCompletedHandler, NavigationCompletedEventHandler,
        NavigationStartingEventHandler, NotificationReceivedEventHandler,
        PermissionRequestedEventHandler, SetPermissionStateCompletedHandler,
        WebResourceRequestedEventHandler,
    };
    use windows::core::PCWSTR;
    use windows::Win32::System::Com::IStream;
    use windows_core::{Interface, HSTRING, PWSTR};

    #[derive(Clone, Debug, Default, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct PrivacyOptions {
        pub block_trackers: bool,
        pub strict_cookies: bool,
        pub https_only: bool,
        #[serde(default = "default_tracking_level")]
        pub tracking_level: String,
        #[serde(default)]
        pub global_privacy_control: bool,
        #[serde(default)]
        pub site_exceptions: Vec<String>,
        #[serde(default)]
        pub custom_block_list: Vec<String>,
        #[serde(default = "default_permission_policy")]
        pub permission_policy: String,
        #[serde(default)]
        pub permission_exceptions: Vec<String>,
        #[serde(default)]
        pub cookie_banner_blocking: bool,
        #[serde(default)]
        pub site_notifications: bool,
        #[serde(default)]
        pub notification_allowed_sites: Vec<String>,
        #[serde(default)]
        pub notification_blocked_sites: Vec<String>,
    }

    fn default_tracking_level() -> String {
        "balanced".to_string()
    }
    fn default_permission_policy() -> String {
        "ask".to_string()
    }

    struct HandlerTokens {
        navigation: i64,
        navigation_completed: i64,
        resource: i64,
        permission: i64,
        notification: Option<i64>,
    }

    struct Handlers {
        _navigation: ICoreWebView2NavigationStartingEventHandler,
        _navigation_completed: ICoreWebView2NavigationCompletedEventHandler,
        _resource: ICoreWebView2WebResourceRequestedEventHandler,
        _permission: ICoreWebView2PermissionRequestedEventHandler,
        _notification: Option<ICoreWebView2NotificationReceivedEventHandler>,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SiteNotificationPayload {
        id: String,
        tab_label: String,
        origin: String,
        title: String,
        body: String,
        icon_url: String,
        timestamp_ms: u64,
    }

    static OPTIONS: LazyLock<Mutex<HashMap<String, PrivacyOptions>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static CONFIGURED: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static TOKENS: LazyLock<Mutex<HashMap<String, HandlerTokens>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static NEXT_NOTIFICATION_ID: AtomicU64 = AtomicU64::new(1);

    const SITE_NOTIFICATION_EVENT: &str = "nebula-site-notification";

    thread_local! {
        static HANDLERS: RefCell<HashMap<String, Handlers>> = RefCell::new(HashMap::new());
    }

    const TRACKER_HOSTS: &[&str] = &[
        "doubleclick.net",
        "google-analytics.com",
        "googletagmanager.com",
        "googlesyndication.com",
        "googleadservices.com",
        "adservice.google.com",
        "facebook.net",
        "connect.facebook.net",
        "scorecardresearch.com",
        "hotjar.com",
        "segment.io",
        "segment.com",
        "mixpanel.com",
        "amplitude.com",
        "clarity.ms",
        "taboola.com",
        "outbrain.com",
        "criteo.com",
        "criteo.net",
    ];

    fn options(label: &str) -> PrivacyOptions {
        OPTIONS
            .lock()
            .ok()
            .and_then(|options| options.get(label).cloned())
            .unwrap_or_default()
    }

    unsafe fn take_string(read: impl FnOnce(*mut PWSTR) -> windows_core::Result<()>) -> String {
        let mut value = PWSTR::null();
        let text = if read(&mut value).is_ok() {
            value.to_string().unwrap_or_default()
        } else {
            String::new()
        };
        if !value.is_null() {
            windows::Win32::System::Com::CoTaskMemFree(Some(value.as_ptr().cast()));
        }
        text
    }

    fn is_local_host(host: &str) -> bool {
        host.eq_ignore_ascii_case("localhost")
            || host == "127.0.0.1"
            || host == "[::1]"
            || host.ends_with(".localhost")
    }

    fn https_upgrade(uri: &str) -> Option<String> {
        let parsed = url::Url::parse(uri).ok()?;
        if parsed.scheme() != "http" || is_local_host(parsed.host_str()?) {
            return None;
        }
        let mut upgraded = parsed;
        upgraded.set_scheme("https").ok()?;
        Some(upgraded.to_string())
    }

    fn host_for_uri(uri: &str) -> Option<String> {
        url::Url::parse(uri)
            .ok()
            .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
    }

    fn host_matches_list(host: &str, entries: &[String]) -> bool {
        entries.iter().any(|entry| {
            let entry = entry.trim().trim_start_matches("*.").to_ascii_lowercase();
            !entry.is_empty() && (host == entry || host.ends_with(&format!(".{entry}")))
        })
    }

    fn is_tracker(uri: &str, custom_block_list: &[String]) -> bool {
        let Some(host) = host_for_uri(uri) else {
            return false;
        };
        TRACKER_HOSTS
            .iter()
            .any(|tracker| host == *tracker || host.ends_with(&format!(".{tracker}")))
            || host_matches_list(&host, custom_block_list)
    }

    fn is_browser_verification_resource(uri: &str) -> bool {
        let Ok(parsed) = url::Url::parse(uri) else {
            return false;
        };
        let host = parsed.host_str().unwrap_or_default();
        host.eq_ignore_ascii_case("challenges.cloudflare.com")
            || parsed.path().starts_with("/cdn-cgi/challenge-platform/")
    }

    fn is_excepted(uri: &str, exceptions: &[String]) -> bool {
        let Some(host) = url::Url::parse(uri)
            .ok()
            .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        else {
            return false;
        };
        exceptions.iter().any(|item| {
            let item = url::Url::parse(item.trim())
                .ok()
                .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
                .unwrap_or_else(|| item.trim().trim_start_matches("*.").to_ascii_lowercase());
            !item.is_empty() && (host == item || host.ends_with(&format!(".{item}")))
        })
    }

    fn timestamp_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    fn same_site(top_uri: &str, request_uri: &str) -> bool {
        let host = |uri: &str| {
            url::Url::parse(uri)
                .ok()
                .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        };
        let (Some(top), Some(request)) = (host(top_uri), host(request_uri)) else {
            return true;
        };
        top == request
            || top.ends_with(&format!(".{request}"))
            || request.ends_with(&format!(".{top}"))
    }

    fn cookie_shield_script(enabled: bool) -> String {
        format!(
            r#"(() => {{
  const stateKey = '__nebulaCookieShield';
  const existing = window[stateKey];
  const restore = () => {{
    existing?.observer?.disconnect();
    document.querySelectorAll('[data-nebula-cookie-hidden]').forEach((element) => {{
      const original = element.getAttribute('data-nebula-cookie-style');
      if (original === '__none__') element.removeAttribute('style');
      else if (original !== null) element.setAttribute('style', original);
      element.removeAttribute('data-nebula-cookie-hidden');
      element.removeAttribute('data-nebula-cookie-style');
    }});
    if (existing?.htmlOverflow !== undefined) document.documentElement.style.overflow = existing.htmlOverflow;
    if (existing?.bodyOverflow !== undefined && document.body) document.body.style.overflow = existing.bodyOverflow;
    delete window[stateKey];
  }};
  if (!{enabled}) {{ restore(); return; }}
  if (existing?.enabled) return;
  const knownRoots = [
    '#onetrust-banner-sdk', '.onetrust-pc-dark-filter', '#CybotCookiebotDialog',
    '#CybotCookiebotDialogBodyUnderlay', '#didomi-host', '.didomi-popup-backdrop',
    '.qc-cmp2-container', '.qc-cmp2-persistent-link', '.iubenda-cs-container',
    '#iubenda-cs-banner', '.cc-window', '.cc-banner', '#cookie-banner',
    '.cookie-banner', '.cookie-consent', '.cookie-notice', '.cookie-popup',
    '.cookies-banner', '.cookie-policy', '.cookie-policy-container',
    '#cookieConsent', '#cookie-consent', '#consent-banner', '.consent-banner',
    '#cmpbox', '.cmpbox', '.fc-consent-root', '#usercentrics-root',
    '[data-testid="cookie-policy-dialog"]', '[data-testid="cookie-banner"]',
    '[aria-label*="cookie" i][role="dialog"]', '[id^="sp_message_container_"]'
  ];
  const rejectSelectors = [
    '#onetrust-reject-all-handler', '#CybotCookiebotDialogBodyButtonDecline',
    '#didomi-notice-disagree-button', '[data-testid="uc-deny-all-button"]',
    '[data-testid="consent-reject-all"]', '.qc-cmp2-summary-buttons button:first-child',
    '.iubenda-cs-reject-btn', '.sp_choice_type_12', '[id*="reject-all" i]',
    '[class*="reject-all" i]', '[id*="deny-all" i]', '[class*="deny-all" i]'
  ];
  const consentWords = /(çerez|cerez|cookie|consent|gizlilik|kişisel veri|kisisel veri|privacy|tracking|izleme)/i;
  const rejectLabels = new Set([
    'tümünü reddet', 'tumunu reddet', 'hepsini reddet', 'reddet',
    'sadece gerekli çerezler', 'sadece gerekli cerezler', 'yalnızca gerekli',
    'yalnizca gerekli', 'gerekli olanlara izin ver', 'reject all', 'decline all',
    'deny all', 'refuse all', 'only necessary', 'necessary only', 'essential only',
    'alle ablehnen', 'tout refuser', 'refuser tout', 'rifiuta tutto',
    'rechazar todo', 'rejeitar tudo'
  ]);
  const noticeActionLabels = new Set([
    'accept all', 'accept', 'agree', 'allow all', 'i agree', 'continue',
    'manage preferences', 'manage settings', 'cookie settings',
    'preferences', 'settings'
  ]);
  const normalize = (value) => (value || '')
    .normalize('NFKC')
    .toLocaleLowerCase('tr-TR')
    .replace(/[.!…,:;]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const state = {{
    enabled: true,
    observer: null,
    scheduled: false,
    processed: new WeakSet(),
    htmlOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body?.style.overflow
  }};
  window[stateKey] = state;
  const hideElement = (element) => {{
    if (!(element instanceof HTMLElement)) return false;
    if (element.hasAttribute('data-nebula-cookie-hidden')) return false;
    element.setAttribute('data-nebula-cookie-style', element.getAttribute('style') ?? '__none__');
    element.setAttribute('data-nebula-cookie-hidden', '');
    element.style.setProperty('display', 'none', 'important');
    return true;
  }};
  const looksLikeConsentRoot = (element) => {{
    if (!(element instanceof HTMLElement)) return false;
    const text = element.innerText || element.textContent || '';
    if (!consentWords.test(text) || text.length > 5000) return false;
    const style = getComputedStyle(element);
    return element.matches(knownRoots.join(',')) ||
      element.getAttribute('role') === 'dialog' ||
      element.getAttribute('aria-modal') === 'true' ||
      style.position === 'fixed' || style.position === 'sticky';
  }};
  const consentRootFor = (element) => {{
    let current = element;
    for (let depth = 0; current && depth < 10; depth += 1, current = current.parentElement) {{
      if (looksLikeConsentRoot(current)) return current;
    }}
    return null;
  }};
  const rejectText = (element) => normalize(
    element instanceof HTMLInputElement ? element.value :
      element.getAttribute('aria-label') || element.textContent
  );
  const tryReject = () => {{
    const candidates = new Set();
    for (const selector of rejectSelectors) {{
      document.querySelectorAll(selector).forEach((element) => candidates.add(element));
    }}
    document.querySelectorAll('button, input[type="button"], input[type="submit"], a[role="button"]').forEach((element) => {{
      if (rejectLabels.has(rejectText(element))) candidates.add(element);
    }});
    for (const element of candidates) {{
      if (!(element instanceof HTMLElement) || state.processed.has(element)) continue;
      const root = consentRootFor(element);
      if (!root) continue;
      state.processed.add(element);
      element.click();
      setTimeout(() => {{
        if (document.contains(root)) {{
          hideElement(root);
          document.documentElement.style.setProperty('overflow', 'auto', 'important');
          if (document.body) document.body.style.setProperty('overflow', 'auto', 'important');
        }}
      }}, 350);
      return true;
    }}
    return false;
  }};
  const hideCompactConsentNotice = () => {{
    const controls = document.querySelectorAll(
      'button, input[type="button"], input[type="submit"], a[role="button"]'
    );

    for (const control of controls) {{
      if (!(control instanceof HTMLElement)) continue;
      const label = rejectText(control);
      if (!noticeActionLabels.has(label)) continue;

      let current = control.parentElement;
      for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {{
        if (current === document.body || current === document.documentElement) break;

        const text = current.innerText || current.textContent || '';
        if (!consentWords.test(text) || text.length > 2500) continue;

        const rect = current.getBoundingClientRect();
        const actionCount = current.querySelectorAll(
          'button, input[type="button"], input[type="submit"], a[role="button"]'
        ).length;

        const compact =
          rect.width >= 220 &&
          rect.width <= Math.min(window.innerWidth * 0.96, 960) &&
          rect.height >= 70 &&
          rect.height <= 650 &&
          actionCount > 0 &&
          actionCount <= 12;

        if (!compact) continue;

        if (hideElement(current)) {{
          document.documentElement.style.setProperty('overflow', 'auto', 'important');
          if (document.body) document.body.style.setProperty('overflow', 'auto', 'important');
          return true;
        }}
      }}
    }}

    return false;
  }};
  const scan = () => {{
    state.scheduled = false;
    const rejected = tryReject();
    let changed = false;
    if (!rejected) changed = hideCompactConsentNotice() || changed;
    if (!rejected && !changed) for (const selector of knownRoots) {{
      for (const element of document.querySelectorAll(selector)) {{
        if (looksLikeConsentRoot(element)) changed = hideElement(element) || changed;
      }}
    }}
    if (!rejected && !changed) {{
      const generic = document.querySelectorAll(
        '[role="dialog"], [aria-modal="true"], [id*="cookie" i], [class*="cookie" i], [id*="consent" i], [class*="consent" i], [id*="kvkk" i], [class*="kvkk" i]'
      );
      for (const element of generic) {{
        if (looksLikeConsentRoot(element)) changed = hideElement(element) || changed;
      }}
    }}
    if (changed) {{
      document.documentElement.style.setProperty('overflow', 'auto', 'important');
      if (document.body) document.body.style.setProperty('overflow', 'auto', 'important');
    }}
  }};
  const schedule = () => {{
    if (state.scheduled) return;
    state.scheduled = true;
    requestAnimationFrame(scan);
  }};
  scan();
  state.observer = new MutationObserver(schedule);
  state.observer.observe(document.documentElement, {{ childList: true, subtree: true }});
}})();"#,
            enabled = if enabled { "true" } else { "false" }
        )
    }

    unsafe fn apply_cookie_shield(core: &ICoreWebView2, current: &PrivacyOptions) {
        let uri = take_string(|value| core.Source(value));
        let enabled =
            current.cookie_banner_blocking && !is_excepted(&uri, &current.site_exceptions);
        let script = HSTRING::from(cookie_shield_script(enabled));
        let handler = ExecuteScriptCompletedHandler::create(Box::new(|_, _| Ok(())));
        let _ = core.ExecuteScript(PCWSTR(script.as_ptr()), &handler);
    }

    pub fn apply(app: &AppHandle, label: &str, next: PrivacyOptions) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") {
            return Err("privacy settings are limited to browser tabs".to_string());
        }
        let previous = OPTIONS
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string(), next.clone());
        let reset_notification_sites = previous
            .map(|previous| {
                previous
                    .notification_allowed_sites
                    .into_iter()
                    .chain(previous.notification_blocked_sites)
                    .filter(|origin| {
                        !next.notification_allowed_sites.contains(origin)
                            && !next.notification_blocked_sites.contains(origin)
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        if let Some(webview) = app.get_webview(label) {
            let profile_options = next.clone();
            let _ = webview.with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };
                apply_cookie_shield(&core, &profile_options);
                let Ok(core13) = core.cast::<ICoreWebView2_13>() else {
                    return;
                };
                let Ok(profile) = core13.Profile() else {
                    return;
                };
                if let Ok(profile3) = profile.cast::<ICoreWebView2Profile3>() {
                    let level = match profile_options.tracking_level.as_str() {
                        "none" => COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_NONE,
                        "strict" => COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_STRICT,
                        _ => COREWEBVIEW2_TRACKING_PREVENTION_LEVEL_BALANCED,
                    };
                    let _ = profile3.SetPreferredTrackingPreventionLevel(level);
                }
                if let Ok(profile4) = profile.cast::<ICoreWebView2Profile4>() {
                    let set_permission = |origin: &str, state| {
                        let origin = HSTRING::from(origin);
                        let handler =
                            SetPermissionStateCompletedHandler::create(Box::new(|_| Ok(())));
                        let _ = profile4.SetPermissionState(
                            COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS,
                            PCWSTR(origin.as_ptr()),
                            state,
                            &handler,
                        );
                    };
                    for origin in &reset_notification_sites {
                        set_permission(origin, COREWEBVIEW2_PERMISSION_STATE_DEFAULT);
                    }
                    for origin in &profile_options.notification_allowed_sites {
                        set_permission(origin, COREWEBVIEW2_PERMISSION_STATE_ALLOW);
                    }
                    for origin in &profile_options.notification_blocked_sites {
                        set_permission(origin, COREWEBVIEW2_PERMISSION_STATE_DENY);
                    }
                }
                if let Ok(profile6) = profile.cast::<ICoreWebView2Profile6>() {
                    let _ = profile6.SetIsPasswordAutosaveEnabled(false);
                    let _ = profile6.SetIsGeneralAutofillEnabled(false);
                }
            });
        }

        if CONFIGURED
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            return Ok(());
        }

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let navigation_label = label.to_string();
        let cookie_label = label.to_string();
        let resource_label = label.to_string();
        let store_label = label.to_string();
        let notification_app = app.clone();
        let permission_app = app.clone();

        webview
            .with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };
                let Ok(core2) = core.cast::<ICoreWebView2_2>() else {
                    return;
                };
                let Ok(environment) = core2.Environment() else {
                    return;
                };

                let navigation =
                    NavigationStartingEventHandler::create(Box::new(move |sender, args| {
                        let Some(args) = args else { return Ok(()) };
                        if !options(&navigation_label).https_only {
                            return Ok(());
                        }
                        let uri = take_string(|value| args.Uri(value));
                        let Some(upgraded) = https_upgrade(&uri) else {
                            return Ok(());
                        };
                        args.SetCancel(true)?;
                        if let Some(sender) = sender {
                            sender.Navigate(&HSTRING::from(upgraded))?;
                        }
                        Ok(())
                    }));

                let navigation_completed =
                    NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
                        if let Some(sender) = sender {
                            apply_cookie_shield(&sender, &options(&cookie_label));
                        }
                        Ok(())
                    }));

                let resource =
                    WebResourceRequestedEventHandler::create(Box::new(move |sender, args| {
                        let Some(args) = args else { return Ok(()) };
                        let current = options(&resource_label);
                        let needs_resource_policy =
                            current.block_trackers || current.strict_cookies;
                        let mut resource_context = COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;
                        let is_document = args.ResourceContext(&mut resource_context).is_ok()
                            && resource_context == COREWEBVIEW2_WEB_RESOURCE_CONTEXT_DOCUMENT;

                        // GPC is a site-level preference. Sending it on the main
                        // document is sufficient for the site while avoiding two
                        // COM header writes for every image, font and media chunk.
                        if !(needs_resource_policy || current.global_privacy_control && is_document)
                        {
                            return Ok(());
                        }

                        let request = args.Request()?;
                        let uri = take_string(|value| request.Uri(value));

                        // Cloudflare challenges depend on an unmodified request,
                        // persistent storage and cookies. Avoid applying Nebula's
                        // optional header/cookie/tracker policies only to the
                        // verification endpoints themselves.
                        if is_browser_verification_resource(&uri) {
                            crate::tab_error_page::note_browser_verification_request(
                                &resource_label,
                            );
                            return Ok(());
                        }

                        let excepted = is_excepted(&uri, &current.site_exceptions);
                        if current.block_trackers
                            && !excepted
                            && is_tracker(&uri, &current.custom_block_list)
                        {
                            let response = environment.CreateWebResourceResponse(
                                None::<&IStream>,
                                204,
                                &HSTRING::from("Blocked by Nebula"),
                                &HSTRING::from("Cache-Control: no-store\r\nContent-Length: 0"),
                            )?;
                            args.SetResponse(&response)?;
                            return Ok(());
                        }

                        if current.global_privacy_control && is_document {
                            let headers = request.Headers()?;
                            let _ = headers.SetHeader(&HSTRING::from("DNT"), &HSTRING::from("1"));
                            let _ =
                                headers.SetHeader(&HSTRING::from("Sec-GPC"), &HSTRING::from("1"));
                        }

                        if current.strict_cookies && !excepted {
                            let top_uri = sender
                                .map(|core| take_string(|value| core.Source(value)))
                                .unwrap_or_default();
                            if !same_site(&top_uri, &uri) {
                                let _ = request.Headers()?.RemoveHeader(&HSTRING::from("Cookie"));
                            }
                        }
                        Ok(())
                    }));

                let permission_label = store_label.clone();
                let permission =
                    PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                        let Some(args) = args else { return Ok(()) };
                        let current = options(&permission_label);
                        let uri = take_string(|value| args.Uri(value));
                        let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
                        let has_kind = args.PermissionKind(&mut kind).is_ok();
                        let is_notification =
                            has_kind && kind == COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS;

                        if is_notification {
                            if !current.site_notifications
                                || is_excepted(&uri, &current.notification_blocked_sites)
                            {
                                args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                                return Ok(());
                            }
                            if is_excepted(&uri, &current.notification_allowed_sites) {
                                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                                return Ok(());
                            }
                        }

                        if current.permission_policy == "block"
                            && !is_excepted(&uri, &current.permission_exceptions)
                        {
                            args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                            return Ok(());
                        }

                        if !has_kind {
                            args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                            return Ok(());
                        }

                        let mut initiated = windows_core::BOOL::default();
                        let _ = args.IsUserInitiated(&mut initiated);
                        crate::site_ui::request_permission(
                            &permission_app,
                            &permission_label,
                            args,
                            uri,
                            kind,
                            initiated.as_bool(),
                        )
                    }));

                let notification_label = store_label.clone();
                let notification = core
                    .cast::<ICoreWebView2_24>()
                    .ok()
                    .map(|core24| {
                        let handler_label = notification_label.clone();
                        let handler =
                            NotificationReceivedEventHandler::create(Box::new(move |_, args| {
                                let Some(args) = args else { return Ok(()) };
                                let origin = take_string(|value| args.SenderOrigin(value));
                                let current = options(&handler_label);

                                // Nebula owns presentation for captured notifications. This avoids a
                                // duplicate WebView2/Windows toast while keeping push/service-worker
                                // notifications in the browser's unified notification center.
                                args.SetHandled(true)?;
                                if !current.site_notifications
                                    || is_excepted(&origin, &current.notification_blocked_sites)
                                {
                                    if let Ok(notification) = args.Notification() {
                                        let _ = notification.ReportClosed();
                                    }
                                    return Ok(());
                                }

                                let notification = args.Notification()?;
                                let timestamp = timestamp_ms();
                                let sequence = NEXT_NOTIFICATION_ID.fetch_add(1, Ordering::Relaxed);
                                let payload = SiteNotificationPayload {
                                    id: format!("site-{timestamp}-{sequence}"),
                                    tab_label: handler_label.clone(),
                                    origin,
                                    title: take_string(|value| notification.Title(value)),
                                    body: take_string(|value| notification.Body(value)),
                                    icon_url: take_string(|value| notification.IconUri(value)),
                                    timestamp_ms: timestamp,
                                };
                                let _ = notification.ReportShown();
                                let _ = notification_app.emit(SITE_NOTIFICATION_EVENT, payload);
                                Ok(())
                            }));
                        let mut token = 0i64;
                        if core24
                            .add_NotificationReceived(&handler, &mut token)
                            .is_ok()
                        {
                            Some((handler, token))
                        } else {
                            None
                        }
                    })
                    .flatten();

                core.AddWebResourceRequestedFilter(
                    &HSTRING::from("*"),
                    COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                )
                .ok();
                let mut navigation_token = 0i64;
                let mut navigation_completed_token = 0i64;
                let mut resource_token = 0i64;
                let mut permission_token = 0i64;
                if core
                    .add_NavigationStarting(&navigation, &mut navigation_token)
                    .is_err()
                {
                    return;
                }
                if core
                    .add_NavigationCompleted(&navigation_completed, &mut navigation_completed_token)
                    .is_err()
                {
                    let _ = core.remove_NavigationStarting(navigation_token);
                    return;
                }
                if core
                    .add_WebResourceRequested(&resource, &mut resource_token)
                    .is_err()
                {
                    let _ = core.remove_NavigationStarting(navigation_token);
                    let _ = core.remove_NavigationCompleted(navigation_completed_token);
                    return;
                }
                if core
                    .add_PermissionRequested(&permission, &mut permission_token)
                    .is_err()
                {
                    let _ = core.remove_NavigationStarting(navigation_token);
                    let _ = core.remove_NavigationCompleted(navigation_completed_token);
                    let _ = core.remove_WebResourceRequested(resource_token);
                    return;
                }
                if let Ok(mut tokens) = TOKENS.lock() {
                    tokens.insert(
                        store_label.clone(),
                        HandlerTokens {
                            navigation: navigation_token,
                            navigation_completed: navigation_completed_token,
                            resource: resource_token,
                            permission: permission_token,
                            notification: notification.as_ref().map(|(_, token)| *token),
                        },
                    );
                }
                HANDLERS.with(|handlers| {
                    handlers.borrow_mut().insert(
                        store_label.clone(),
                        Handlers {
                            _navigation: navigation,
                            _navigation_completed: navigation_completed,
                            _resource: resource,
                            _permission: permission,
                            _notification: notification.map(|(handler, _)| handler),
                        },
                    );
                });
            })
            .map_err(|error| error.to_string())?;

        if !TOKENS
            .lock()
            .map_err(|error| error.to_string())?
            .contains_key(label)
        {
            return Err(format!("failed to register privacy handlers for '{label}'"));
        }
        CONFIGURED
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string());
        Ok(())
    }

    pub fn teardown(app: &AppHandle, label: &str) {
        let tokens = TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));
        let handler_label = label.to_string();
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(move |inner| unsafe {
                if let (Ok(core), Some(tokens)) = (inner.controller().CoreWebView2(), tokens) {
                    let _ = core.remove_NavigationStarting(tokens.navigation);
                    let _ = core.remove_NavigationCompleted(tokens.navigation_completed);
                    let _ = core.remove_WebResourceRequested(tokens.resource);
                    let _ = core.remove_PermissionRequested(tokens.permission);
                    if let (Some(token), Ok(core24)) =
                        (tokens.notification, core.cast::<ICoreWebView2_24>())
                    {
                        let _ = core24.remove_NotificationReceived(token);
                    }
                    let _ = core.RemoveWebResourceRequestedFilter(
                        &HSTRING::from("*"),
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                    );
                }
                HANDLERS.with(|handlers| {
                    handlers.borrow_mut().remove(&handler_label);
                });
            });
        }
        OPTIONS.lock().ok().map(|mut options| options.remove(label));
        CONFIGURED
            .lock()
            .ok()
            .map(|mut configured| configured.remove(label));
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn upgrades_remote_http_but_not_localhost() {
            assert_eq!(
                https_upgrade("http://example.com/path").as_deref(),
                Some("https://example.com/path")
            );
            assert!(https_upgrade("http://localhost:3000/path").is_none());
        }

        #[test]
        fn matches_builtin_and_custom_trackers_by_domain_boundary() {
            assert!(is_tracker("https://a.doubleclick.net/pixel", &[]));
            assert!(is_tracker(
                "https://metrics.example.test/pixel",
                &["example.test".to_string()]
            ));
            assert!(!is_tracker("https://notdoubleclick.net", &[]));
        }

        #[test]
        fn recognizes_only_cloudflare_verification_resources() {
            assert!(is_browser_verification_resource(
                "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/orchestrate/jsch/v1"
            ));
            assert!(is_browser_verification_resource(
                "https://example.com/cdn-cgi/challenge-platform/h/g/flow/ov1"
            ));
            assert!(!is_browser_verification_resource(
                "https://challenges.cloudflare.com.attacker.test/cdn-cgi/script.js"
            ));
            assert!(!is_browser_verification_resource(
                "https://example.com/assets/challenge.js"
            ));
        }

        #[test]
        fn site_exceptions_include_subdomains_only() {
            let exceptions = vec!["example.com".to_string()];
            assert!(is_excepted("https://account.example.com", &exceptions));
            assert!(!is_excepted(
                "https://example.com.attacker.test",
                &exceptions
            ));
        }

        #[test]
        fn cookie_shield_prefers_rejection_before_hiding() {
            let script = cookie_shield_script(true);
            assert!(script.contains("tümünü reddet"));
            assert!(script.contains("#onetrust-reject-all-handler"));
            assert!(
                script.find("tryReject()").unwrap() < script.find("knownRoots").unwrap_or(0)
                    || script.contains("const rejected = tryReject()")
            );
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{apply, teardown, PrivacyOptions};

#[cfg(target_os = "windows")]
pub fn clear_browsing_data(app: &tauri::AppHandle, label: &str, kind: &str) -> Result<(), String> {
    use serde::Serialize;
    use tauri::{Emitter, Manager};
    use webview2_com::ClearBrowsingDataCompletedHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Profile2, ICoreWebView2_13, COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_PROFILE,
        COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY,
        COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES, COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
        COREWEBVIEW2_BROWSING_DATA_KINDS_SETTINGS,
    };
    use windows_core::Interface;

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct BrowsingDataClearPayload {
        label: String,
        kind: String,
        error: Option<String>,
    }

    const CLEAR_EVENT: &str = "nebula-browsing-data-cleared";

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;
    let data_kind = match kind {
        "cookies" => COREWEBVIEW2_BROWSING_DATA_KINDS_COOKIES,
        "cache" => COREWEBVIEW2_BROWSING_DATA_KINDS_DISK_CACHE,
        "history" => COREWEBVIEW2_BROWSING_DATA_KINDS_BROWSING_HISTORY,
        "permissions" => COREWEBVIEW2_BROWSING_DATA_KINDS_SETTINGS,
        _ => COREWEBVIEW2_BROWSING_DATA_KINDS_ALL_PROFILE,
    };
    let app_handle = app.clone();
    let label_for_event = label.to_string();
    let kind_for_event = kind.to_string();

    webview
        .with_webview(move |inner| unsafe {
            let completion_app = app_handle.clone();
            let completion_label = label_for_event.clone();
            let completion_kind = kind_for_event.clone();
            let result = (|| -> windows_core::Result<()> {
                let core = inner.controller().CoreWebView2()?;
                let core13 = core.cast::<ICoreWebView2_13>()?;
                let profile = core13.Profile()?;
                let profile2 = profile.cast::<ICoreWebView2Profile2>()?;
                let handler = ClearBrowsingDataCompletedHandler::create(Box::new(move |result| {
                    let payload = BrowsingDataClearPayload {
                        label: completion_label.clone(),
                        kind: completion_kind.clone(),
                        error: result.err().map(|error| error.to_string()),
                    };
                    let _ = completion_app.emit(CLEAR_EVENT, payload);
                    Ok(())
                }));
                profile2.ClearBrowsingData(data_kind, &handler)
            })();

            if let Err(error) = result {
                let payload = BrowsingDataClearPayload {
                    label: label_for_event,
                    kind: kind_for_event,
                    error: Some(error.to_string()),
                };
                let _ = app_handle.emit(CLEAR_EVENT, payload);
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "windows"))]
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivacyOptions {
    pub block_trackers: bool,
    pub strict_cookies: bool,
    pub https_only: bool,
    pub tracking_level: String,
    pub global_privacy_control: bool,
    pub site_exceptions: Vec<String>,
    pub custom_block_list: Vec<String>,
    pub permission_policy: String,
    pub permission_exceptions: Vec<String>,
    pub cookie_banner_blocking: bool,
    pub site_notifications: bool,
    pub notification_allowed_sites: Vec<String>,
    pub notification_blocked_sites: Vec<String>,
}

#[cfg(not(target_os = "windows"))]
pub fn apply(
    _app: &tauri::AppHandle,
    _label: &str,
    _options: PrivacyOptions,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown(_app: &tauri::AppHandle, _label: &str) {}

#[cfg(not(target_os = "windows"))]
pub fn clear_browsing_data(
    _app: &tauri::AppHandle,
    _label: &str,
    _kind: &str,
) -> Result<(), String> {
    Ok(())
}
