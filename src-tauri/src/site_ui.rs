#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{LazyLock, Mutex};
    use std::time::Duration;

    use serde::{Deserialize, Serialize};
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2BasicAuthenticationRequestedEventArgs,
        ICoreWebView2BasicAuthenticationRequestedEventHandler, ICoreWebView2Deferral,
        ICoreWebView2LaunchingExternalUriSchemeEventArgs,
        ICoreWebView2LaunchingExternalUriSchemeEventHandler,
        ICoreWebView2NewWindowRequestedEventHandler, ICoreWebView2PermissionRequestedEventArgs,
        ICoreWebView2PermissionRequestedEventArgs3, ICoreWebView2ScriptDialogOpeningEventArgs,
        ICoreWebView2ScriptDialogOpeningEventHandler, ICoreWebView2WebMessageReceivedEventHandler,
        ICoreWebView2WindowCloseRequestedEventHandler, ICoreWebView2_10, ICoreWebView2_18,
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        COREWEBVIEW2_PERMISSION_STATE_DENY, COREWEBVIEW2_SCRIPT_DIALOG_KIND,
    };
    use webview2_com::{
        AddScriptToExecuteOnDocumentCreatedCompletedHandler,
        BasicAuthenticationRequestedEventHandler, LaunchingExternalUriSchemeEventHandler,
        NewWindowRequestedEventHandler, ScriptDialogOpeningEventHandler,
        WebMessageReceivedEventHandler, WindowCloseRequestedEventHandler,
    };
    use windows::core::PCWSTR;
    use windows_core::{Interface, HSTRING, PWSTR};

    const SITE_UI_EVENT: &str = "nebula-site-ui-request";
    const SITE_UI_CANCELLED_EVENT: &str = "nebula-site-ui-cancelled";
    const SITE_NEW_WINDOW_EVENT: &str = "nebula-site-new-window";
    const SITE_CLOSE_WINDOW_EVENT: &str = "nebula-site-close-window";
    const SITE_POINTER_DOWN_EVENT: &str = "nebula-site-pointer-down";
    const PASSWORD_STEP_EVENT: &str = "nebula-password-step";
    const SITE_UI_TIMEOUT: Duration = Duration::from_secs(60);
    const MAX_PENDING_SITE_UI_PER_TAB: usize = 8;

    static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
    static CONFIGURED: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static TOKENS: LazyLock<Mutex<HashMap<String, HandlerTokens>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    struct HandlerTokens {
        script_dialog: i64,
        basic_auth: Option<i64>,
        new_window: i64,
        window_close: i64,
        web_message: i64,
        external_uri: Option<i64>,
    }

    struct Handlers {
        _script_dialog: ICoreWebView2ScriptDialogOpeningEventHandler,
        _basic_auth: Option<ICoreWebView2BasicAuthenticationRequestedEventHandler>,
        _new_window: ICoreWebView2NewWindowRequestedEventHandler,
        _window_close: ICoreWebView2WindowCloseRequestedEventHandler,
        _web_message: ICoreWebView2WebMessageReceivedEventHandler,
        _external_uri: Option<ICoreWebView2LaunchingExternalUriSchemeEventHandler>,
    }

    enum PendingRequest {
        ScriptDialog {
            tab_label: String,
            args: ICoreWebView2ScriptDialogOpeningEventArgs,
            deferral: ICoreWebView2Deferral,
            is_prompt: bool,
        },
        Permission {
            tab_label: String,
            args: ICoreWebView2PermissionRequestedEventArgs,
            deferral: ICoreWebView2Deferral,
        },
        BasicAuth {
            tab_label: String,
            args: ICoreWebView2BasicAuthenticationRequestedEventArgs,
            deferral: ICoreWebView2Deferral,
        },
        ProtocolHandler {
            tab_label: String,
        },
        ExternalUri {
            tab_label: String,
            args: ICoreWebView2LaunchingExternalUriSchemeEventArgs,
            deferral: ICoreWebView2Deferral,
        },
    }

    impl PendingRequest {
        fn tab_label(&self) -> &str {
            match self {
                Self::ScriptDialog { tab_label, .. }
                | Self::Permission { tab_label, .. }
                | Self::BasicAuth { tab_label, .. }
                | Self::ProtocolHandler { tab_label, .. }
                | Self::ExternalUri { tab_label, .. } => tab_label,
            }
        }
    }

    thread_local! {
        static HANDLERS: RefCell<HashMap<String, Handlers>> = RefCell::new(HashMap::new());
        static PENDING: RefCell<HashMap<String, PendingRequest>> = RefCell::new(HashMap::new());
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SiteUiRequest {
        pub id: String,
        pub tab_label: String,
        pub request_type: String,
        pub uri: String,
        pub title: String,
        pub message: String,
        pub default_text: String,
        pub dialog_kind: Option<String>,
        pub permission_kind: Option<String>,
        pub challenge: Option<String>,
        pub is_user_initiated: bool,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SiteUiCancelledPayload {
        id: String,
        tab_label: String,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct NewWindowPayload {
        tab_label: String,
        uri: String,
        user_initiated: bool,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CloseWindowPayload {
        tab_label: String,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PasswordStepPayload {
        kind: String,
        tab_label: String,
        origin: String,
        url: String,
        username: String,
        password: String,
    }

    #[derive(Debug, Deserialize)]
    struct ProtocolHandlerMessage {
        #[serde(rename = "type")]
        kind: String,
        scheme: String,
        #[serde(rename = "handlerUrl")]
        handler_url: String,
        origin: String,
        #[serde(default)]
        title: String,
    }

    const PROTOCOL_HANDLER_BRIDGE_SCRIPT: &str = r#"
(function () {
  if (window.__nebulaProtocolHandlerHookInstalled) return;
  window.__nebulaProtocolHandlerHookInstalled = true;

  const bridge = window.chrome && window.chrome.webview;
  if (!bridge) return;

  // Report real user clicks on the actual site surface to the Nebula shell.
  // The captured bridge stays usable after later hardening masks
  // window.chrome.webview from ordinary page code.
  // Wry's Windows IPC layer turns WebMessageReceived.Source into an
  // http::Request URI. WebView2 can report an empty Source for opaque/internal
  // documents such as Nebula's data: error page, which makes Wry panic while
  // parsing that URI. Only remote HTTP(S) site documents need this bridge.
  const canReportSitePointerDown =
    window.location.protocol === 'http:' ||
    window.location.protocol === 'https:';

  function isVisibleInput(input) {
    try {
      if (!input || input.tagName !== 'INPUT' || input.disabled || input.readOnly) return false;
      const type = String(input.type || '').toLowerCase();
      if (type === 'hidden') return false;
      const rect = input.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (_) {
      return false;
    }
  }

  function isPasswordInput(input) {
    if (!isVisibleInput(input)) return false;
    const type = String(input.type || '').toLowerCase();
    const autocomplete = String(input.getAttribute('autocomplete') || '').toLowerCase();
    return type === 'password' || autocomplete === 'current-password' || autocomplete === 'new-password';
  }

  function usernameScore(input) {
    if (!isVisibleInput(input) || isPasswordInput(input)) return -1;
    const type = String(input.type || '').toLowerCase();
    if (type === 'checkbox' || type === 'radio' || type === 'submit' || type === 'button') return -1;

    const autocomplete = String(input.getAttribute('autocomplete') || '').toLowerCase();
    const name = String(input.getAttribute('name') || '').toLowerCase();
    const id = String(input.getAttribute('id') || '').toLowerCase();
    const aria = String(input.getAttribute('aria-label') || '').toLowerCase();
    const haystack = name + ' ' + id + ' ' + aria;

    if (autocomplete === 'username') return 100;
    if (autocomplete === 'email') return 95;
    if (type === 'email') return 90;
    if (haystack.includes('email')) return 85;
    if (haystack.includes('user') || haystack.includes('login')) return 80;
    if (type === 'tel' && (haystack.includes('phone') || haystack.includes('mobile'))) return 70;
    return -1;
  }

  function findUsernameInput(inputs) {
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < inputs.length; i += 1) {
      const score = usernameScore(inputs[i]);
      if (score > bestScore) {
        best = inputs[i];
        bestScore = score;
      }
    }
    return best;
  }

  function rememberedUsernameValue(inputs) {
    // Some two-step providers remove the visible username field on the
    // password step but keep the account in an explicit hidden login field.
    // Read only high-confidence identity fields; never scrape arbitrary hidden
    // inputs because they commonly contain tokens and opaque state.
    for (let i = 0; i < inputs.length; i += 1) {
      const input = inputs[i];
      if (!input || input.tagName !== 'INPUT' || isPasswordInput(input)) continue;
      const autocomplete = String(input.getAttribute('autocomplete') || '').toLowerCase();
      const name = String(input.getAttribute('name') || '').toLowerCase();
      const id = String(input.getAttribute('id') || '').toLowerCase();
      const explicitIdentity =
        autocomplete === 'username' ||
        autocomplete === 'email' ||
        name === 'login' ||
        name === 'loginfmt' ||
        name === 'username' ||
        name === 'email' ||
        id === 'login' ||
        id === 'loginfmt' ||
        id === 'username' ||
        id === 'email';
      if (!explicitIdentity) continue;
      const value = String(input.value || '').trim();
      if (value) return value;
    }

    // Microsoft-style password-only pages expose the selected account in a
    // visible #displayName element. Accept displayed text only when it looks
    // like an e-mail address or phone number to avoid mistaking a person's
    // display name for a login identifier.
    const display = document.querySelector('#displayName, [data-username], [data-email]');
    if (!display) return '';
    const candidate = String(
      display.getAttribute('data-username') ||
      display.getAttribute('data-email') ||
      display.textContent ||
      ''
    ).trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return candidate;
    if (/^\+?[0-9][0-9 ()-]{5,}$/.test(candidate)) return candidate;
    return '';
  }

  function isCredentialActionTarget(target) {
    if (!target || !target.closest) return false;
    const control = target.closest('button, input[type="submit"], [role="button"]');
    if (!control) return false;

    const tag = String(control.tagName || '').toLowerCase();
    const type = String(control.type || control.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && type === 'submit') return true;
    if (tag === 'button' && type !== 'button' && type !== 'reset') return true;

    const actionText = [
      control.textContent,
      control.value,
      control.getAttribute('aria-label'),
      control.getAttribute('title'),
      control.getAttribute('name'),
      control.getAttribute('id')
    ].filter(Boolean).join(' ').toLowerCase();
    return /(next|continue|sign[ -]?in|log[ -]?in|submit|create|register|sign[ -]?up|verify|ileri|devam|giriş|giris|oturum|kaydol|kayıt|kayit|oluştur|olustur)/.test(actionText);
  }

  let lastPasswordMessageKey = '';
  let lastPasswordMessageAt = 0;

  function postPasswordStep(kind, username, password) {
    try {
      const origin = window.location.origin;
      const url = window.location.href;
      if (!origin || (window.location.protocol !== 'http:' && window.location.protocol !== 'https:')) return;

      const cleanUser = String(username || '').trim();
      const cleanPassword = String(password || '');
      if (kind === 'identity' && !cleanUser) return;
      if (kind === 'submit' && !cleanPassword) return;

      const now = Date.now();
      const dedupeKey = kind + '\u0000' + origin + '\u0000' + cleanUser + '\u0000' + cleanPassword;
      if (dedupeKey === lastPasswordMessageKey && now - lastPasswordMessageAt < 1500) return;
      lastPasswordMessageKey = dedupeKey;
      lastPasswordMessageAt = now;

      bridge.postMessage(JSON.stringify({
        type: kind === 'identity' ? 'nebula-password-step-identity' : 'nebula-password-step-submit',
        origin: origin,
        url: url,
        username: cleanUser,
        password: kind === 'submit' ? cleanPassword : ''
      }));
    } catch (_) {}
  }

  function capturePasswordStep(event) {
    if (event && event.isTrusted === false) return;

    const inputs = document.querySelectorAll('input');
    let passwordInput = null;
    for (let i = 0; i < inputs.length; i += 1) {
      if (isPasswordInput(inputs[i])) {
        passwordInput = inputs[i];
        break;
      }
    }

    if (passwordInput) {
      const password = String(passwordInput.value || '');
      if (!password) return;
      const form = passwordInput.closest && passwordInput.closest('form');
      const scope = form ? form.querySelectorAll('input') : inputs;
      const usernameInput = findUsernameInput(scope);
      const username = usernameInput
        ? String(usernameInput.value || '').trim()
        : rememberedUsernameValue(inputs);
      postPasswordStep('submit', username, password);
      return;
    }

    const usernameInput = findUsernameInput(inputs);
    if (!usernameInput) return;
    postPasswordStep('identity', usernameInput.value, '');
  }

  if (canReportSitePointerDown) {
    window.addEventListener('pointerdown', function (event) {
      if (!event.isTrusted) return;

      try {
        bridge.postMessage(JSON.stringify({
          type: 'nebula-site-pointer-down'
        }));
      } catch (_) {}

      if (isCredentialActionTarget(event.target)) {
        capturePasswordStep(event);
      }
    }, true);

    window.addEventListener('click', function (event) {
      if (!event.isTrusted) return;
      if (!isCredentialActionTarget(event.target)) return;
      capturePasswordStep(event);
    }, true);

    window.addEventListener('submit', function (event) {
      if (!event.isTrusted) return;
      capturePasswordStep(event);
    }, true);

    window.addEventListener('keydown', function (event) {
      if (!event.isTrusted || event.key !== 'Enter') return;
      capturePasswordStep(event);
    }, true);
  }

  if (typeof Navigator === 'undefined') return;

  const proto = Navigator.prototype;
  if (!proto || typeof proto.registerProtocolHandler !== 'function') return;

  try {
    Object.defineProperty(proto, 'registerProtocolHandler', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: function (scheme, handlerUrl) {
        const normalizedScheme = String(scheme || '').trim().toLowerCase();
        const resolved = new URL(String(handlerUrl), window.location.href);

        if (!resolved.href.includes('%s')) {
          throw new DOMException('The handler URL must include %s.', 'SyntaxError');
        }

        bridge.postMessage(JSON.stringify({
          type: 'nebula-register-protocol-handler',
          scheme: normalizedScheme,
          handlerUrl: resolved.href,
          origin: window.location.origin,
          title: document.title || window.location.hostname || 'Website'
        }));
      }
    });
  } catch (_) {}
})();
"#;
    #[derive(Clone, Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct SiteUiResponse {
        pub accepted: bool,
        #[serde(default)]
        pub text: String,
        #[serde(default)]
        pub username: String,
        #[serde(default)]
        pub password: String,
        #[serde(default)]
        pub remember: bool,
    }

    fn next_request_id(kind: &str) -> String {
        let id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        format!("{kind}-{id}")
    }

    fn take_string<F>(read: F) -> String
    where
        F: FnOnce(*mut PWSTR) -> windows_core::Result<()>,
    {
        let mut value = PWSTR::null();
        if read(&mut value).is_err() || value.is_null() {
            return String::new();
        }
        let text = unsafe { value.to_string().unwrap_or_default() };
        unsafe {
            windows::Win32::System::Com::CoTaskMemFree(Some(value.as_ptr().cast()));
        }
        text
    }

    fn host_label(uri: &str) -> String {
        url::Url::parse(uri)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_string))
            .filter(|host| !host.is_empty())
            .unwrap_or_else(|| "Website".to_string())
    }

    fn script_dialog_kind(kind: COREWEBVIEW2_SCRIPT_DIALOG_KIND) -> &'static str {
        match kind.0 {
            0 => "alert",
            1 => "confirm",
            2 => "prompt",
            3 => "beforeunload",
            _ => "unknown",
        }
    }

    pub fn permission_kind_name(kind: COREWEBVIEW2_PERMISSION_KIND) -> &'static str {
        match kind.0 {
            1 => "microphone",
            2 => "camera",
            3 => "geolocation",
            4 => "notifications",
            5 => "sensors",
            6 => "clipboard-read",
            7 => "multiple-downloads",
            8 => "file-read-write",
            9 => "autoplay",
            10 => "local-fonts",
            11 => "midi-sysex",
            12 => "window-management",
            _ => "unknown",
        }
    }

    fn valid_protocol_scheme(scheme: &str) -> bool {
        const SAFE: &[&str] = &[
            "bitcoin",
            "geo",
            "im",
            "irc",
            "ircs",
            "magnet",
            "mailto",
            "matrix",
            "mms",
            "news",
            "nntp",
            "openpgp4fpr",
            "sip",
            "sms",
            "smsto",
            "ssh",
            "tel",
            "urn",
            "webcal",
            "wtai",
        ];

        SAFE.contains(&scheme)
            || scheme.strip_prefix("web+").is_some_and(|rest| {
                !rest.is_empty()
                    && rest
                        .chars()
                        .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit())
            })
    }

    fn valid_protocol_registration(
        message: &ProtocolHandlerMessage,
    ) -> Option<(String, String, String, String)> {
        if message.kind != "nebula-register-protocol-handler" {
            return None;
        }

        let scheme = message.scheme.trim().to_ascii_lowercase();
        if !valid_protocol_scheme(&scheme) || !message.handler_url.contains("%s") {
            return None;
        }

        let origin = url::Url::parse(message.origin.trim()).ok()?;
        let handler = url::Url::parse(message.handler_url.trim()).ok()?;

        if origin.scheme() != "https"
            || handler.scheme() != "https"
            || origin.origin() != handler.origin()
        {
            return None;
        }

        let title = message.title.trim();
        Some((
            scheme,
            handler.to_string(),
            origin.to_string(),
            if title.is_empty() {
                host_label(origin.as_str())
            } else {
                title.to_string()
            },
        ))
    }

    fn has_pending_capacity<'a>(
        labels: impl Iterator<Item = &'a str>,
        tab_label: &str,
        limit: usize,
    ) -> bool {
        labels
            .filter(|label| *label == tab_label)
            .take(limit)
            .count()
            < limit
    }

    fn remove_and_cancel_pending(request_id: &str) -> Option<String> {
        PENDING.with(|pending| {
            pending.borrow_mut().remove(request_id).map(|request| {
                let tab_label = request.tab_label().to_string();
                cancel_request(request);
                tab_label
            })
        })
    }

    fn expire_site_ui_request(app: &AppHandle, request_id: &str) {
        if let Some(tab_label) = remove_and_cancel_pending(request_id) {
            let _ = app.emit(
                SITE_UI_CANCELLED_EVENT,
                SiteUiCancelledPayload {
                    id: request_id.to_string(),
                    tab_label,
                },
            );
        }
    }

    fn schedule_site_ui_timeout(app: &AppHandle, request_id: String) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(SITE_UI_TIMEOUT).await;
            let dispatcher = app.clone();
            let event_app = app.clone();
            let _ = dispatcher.run_on_main_thread(move || {
                expire_site_ui_request(&event_app, &request_id);
            });
        });
    }

    fn enqueue_request(app: &AppHandle, payload: SiteUiRequest, request: PendingRequest) {
        let request_id = payload.id.clone();
        let tab_label = request.tab_label().to_string();
        let inserted = PENDING.with(|pending| {
            let mut pending = pending.borrow_mut();
            if !has_pending_capacity(
                pending.values().map(PendingRequest::tab_label),
                &tab_label,
                MAX_PENDING_SITE_UI_PER_TAB,
            ) {
                return Err(request);
            }
            pending.insert(request_id.clone(), request);
            Ok(())
        });

        if let Err(request) = inserted {
            cancel_request(request);
            return;
        }

        if app.emit(SITE_UI_EVENT, payload).is_err() {
            let _ = remove_and_cancel_pending(&request_id);
            return;
        }
        schedule_site_ui_timeout(app, request_id);
    }

    pub fn request_permission(
        app: &AppHandle,
        tab_label: &str,
        args: ICoreWebView2PermissionRequestedEventArgs,
        uri: String,
        kind: COREWEBVIEW2_PERMISSION_KIND,
        is_user_initiated: bool,
    ) -> windows_core::Result<()> {
        let deferral = unsafe { args.GetDeferral()? };
        let id = next_request_id("permission");
        let permission_name = permission_kind_name(kind).to_string();
        enqueue_request(
            app,
            SiteUiRequest {
                id: id.clone(),
                tab_label: tab_label.to_string(),
                request_type: "permission".to_string(),
                uri: uri.clone(),
                title: host_label(&uri),
                message: format!("This site wants permission to use {permission_name}."),
                default_text: String::new(),
                dialog_kind: None,
                permission_kind: Some(permission_name),
                challenge: None,
                is_user_initiated,
            },
            PendingRequest::Permission {
                tab_label: tab_label.to_string(),
                args,
                deferral,
            },
        );
        Ok(())
    }

    pub fn setup(app: &AppHandle, label: &str) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") {
            return Err("site UI handlers are limited to browser tabs".to_string());
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
        let app_for_handlers = app.clone();
        let label_for_handlers = label.to_string();

        webview
            .with_webview(move |inner| unsafe {
                let result = (|| -> windows_core::Result<(HandlerTokens, Handlers)> {
                    let core = inner.controller().CoreWebView2()?;
                    core.Settings()?.SetAreDefaultScriptDialogsEnabled(false)?;

                    // Replace Chromium's protocol-handler bubble with Nebula UI.
                    // This script executes before page scripts and captures the
                    // WebView2 message bridge before the later fullscreen bridge
                    // masks window.chrome.webview from site code.
                    let protocol_script = HSTRING::from(PROTOCOL_HANDLER_BRIDGE_SCRIPT);
                    let protocol_script_complete =
                        AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
                            |_result, _id| Ok(()),
                        ));
                    core.AddScriptToExecuteOnDocumentCreated(
                        PCWSTR(protocol_script.as_ptr()),
                        &protocol_script_complete,
                    )?;

                    let protocol_app = app_for_handlers.clone();
                    let protocol_label = label_for_handlers.clone();
                    let web_message =
                        WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                            let Some(args) = args else { return Ok(()) };
                            let raw = take_string(|value| args.TryGetWebMessageAsString(value));
                            let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
                                return Ok(());
                            };

                            if value.get("type").and_then(serde_json::Value::as_str)
                                == Some("nebula-site-pointer-down")
                            {
                                let _ = protocol_app.emit(
                                    SITE_POINTER_DOWN_EVENT,
                                    serde_json::json!({
                                        "tabLabel": protocol_label.clone(),
                                    }),
                                );
                                return Ok(());
                            }

                            let message_kind =
                                value.get("type").and_then(serde_json::Value::as_str);
                            if matches!(
                                message_kind,
                                Some("nebula-password-step-identity")
                                    | Some("nebula-password-step-submit")
                            ) {
                                let origin = value
                                    .get("origin")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let url = value
                                    .get("url")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let username = value
                                    .get("username")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let password = value
                                    .get("password")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let is_http_origin =
                                    origin.starts_with("https://") || origin.starts_with("http://");
                                let lengths_ok = origin.len() <= 2048
                                    && url.len() <= 8192
                                    && username.len() <= 1024
                                    && password.len() <= 16_384;
                                let payload_ok = match message_kind {
                                    Some("nebula-password-step-identity") => {
                                        !username.trim().is_empty()
                                    }
                                    Some("nebula-password-step-submit") => !password.is_empty(),
                                    _ => false,
                                };

                                if is_http_origin && lengths_ok && payload_ok {
                                    let _ = protocol_app.emit(
                                        PASSWORD_STEP_EVENT,
                                        PasswordStepPayload {
                                            kind: if message_kind
                                                == Some("nebula-password-step-identity")
                                            {
                                                "identity".to_string()
                                            } else {
                                                "submit".to_string()
                                            },
                                            tab_label: protocol_label.clone(),
                                            origin: origin.to_string(),
                                            url: url.to_string(),
                                            username: username.to_string(),
                                            password: password.to_string(),
                                        },
                                    );
                                }
                                return Ok(());
                            }

                            let Ok(message) =
                                serde_json::from_value::<ProtocolHandlerMessage>(value)
                            else {
                                return Ok(());
                            };
                            let Some((scheme, handler_url, origin, title)) =
                                valid_protocol_registration(&message)
                            else {
                                return Ok(());
                            };
                            let id = next_request_id("protocol-handler");
                            enqueue_request(
                                &protocol_app,
                                SiteUiRequest {
                                    id: id.clone(),
                                    tab_label: protocol_label.clone(),
                                    request_type: "protocol-handler".to_string(),
                                    uri: origin,
                                    title,
                                    message: handler_url,
                                    default_text: String::new(),
                                    dialog_kind: None,
                                    permission_kind: Some(scheme),
                                    challenge: None,
                                    is_user_initiated: false,
                                },
                                PendingRequest::ProtocolHandler {
                                    tab_label: protocol_label.clone(),
                                },
                            );
                            Ok(())
                        }));
                    let mut web_message_token = 0i64;
                    core.add_WebMessageReceived(&web_message, &mut web_message_token)?;

                    // External schemes (mailto:, tel:, custom application URLs)
                    // use Nebula's permission surface instead of WebView2's
                    // built-in Edge dialog.
                    let mut external_uri_handler = None;
                    let mut external_uri_token = None;
                    if let Ok(core18) = core.cast::<ICoreWebView2_18>() {
                        let external_app = app_for_handlers.clone();
                        let external_label = label_for_handlers.clone();
                        let handler = LaunchingExternalUriSchemeEventHandler::create(Box::new(
                            move |_, args| {
                                let Some(args) = args else { return Ok(()) };

                                // Default-deny immediately. The response path
                                // flips this to false only after explicit Allow.
                                args.SetCancel(true)?;
                                let deferral = args.GetDeferral()?;
                                let external_uri = take_string(|value| args.Uri(value));
                                let initiating_origin =
                                    take_string(|value| args.InitiatingOrigin(value));
                                let mut initiated = windows_core::BOOL::default();
                                let _ = args.IsUserInitiated(&mut initiated);

                                let scheme = url::Url::parse(&external_uri)
                                    .ok()
                                    .map(|parsed| parsed.scheme().to_string())
                                    .unwrap_or_else(|| {
                                        external_uri
                                            .split_once(':')
                                            .map(|(scheme, _)| scheme.to_string())
                                            .unwrap_or_else(|| "external".to_string())
                                    });

                                let id = next_request_id("external-uri");
                                enqueue_request(
                                    &external_app,
                                    SiteUiRequest {
                                        id: id.clone(),
                                        tab_label: external_label.clone(),
                                        request_type: "external-uri".to_string(),
                                        uri: initiating_origin.clone(),
                                        title: host_label(&initiating_origin),
                                        message: external_uri,
                                        default_text: String::new(),
                                        dialog_kind: None,
                                        permission_kind: Some(scheme),
                                        challenge: None,
                                        is_user_initiated: initiated.as_bool(),
                                    },
                                    PendingRequest::ExternalUri {
                                        tab_label: external_label.clone(),
                                        args,
                                        deferral,
                                    },
                                );
                                Ok(())
                            },
                        ));

                        let mut token = 0i64;
                        core18.add_LaunchingExternalUriScheme(&handler, &mut token)?;
                        external_uri_token = Some(token);
                        external_uri_handler = Some(handler);
                    }

                    let script_app = app_for_handlers.clone();
                    let script_label = label_for_handlers.clone();
                    let script_dialog =
                        ScriptDialogOpeningEventHandler::create(Box::new(move |_, args| {
                            let Some(args) = args else { return Ok(()) };
                            let deferral = args.GetDeferral()?;
                            let uri = take_string(|value| args.Uri(value));
                            let message = take_string(|value| args.Message(value));
                            let default_text = take_string(|value| args.DefaultText(value));
                            let mut kind = COREWEBVIEW2_SCRIPT_DIALOG_KIND::default();
                            let _ = args.Kind(&mut kind);
                            let kind_name = script_dialog_kind(kind).to_string();
                            let is_prompt = kind_name == "prompt";
                            let id = next_request_id("dialog");

                            enqueue_request(
                                &script_app,
                                SiteUiRequest {
                                    id: id.clone(),
                                    tab_label: script_label.clone(),
                                    request_type: "script-dialog".to_string(),
                                    uri: uri.clone(),
                                    title: host_label(&uri),
                                    message,
                                    default_text,
                                    dialog_kind: Some(kind_name),
                                    permission_kind: None,
                                    challenge: None,
                                    is_user_initiated: true,
                                },
                                PendingRequest::ScriptDialog {
                                    tab_label: script_label.clone(),
                                    args,
                                    deferral,
                                    is_prompt,
                                },
                            );
                            Ok(())
                        }));
                    let mut script_token = 0i64;
                    core.add_ScriptDialogOpening(&script_dialog, &mut script_token)?;

                    let new_window_app = app_for_handlers.clone();
                    let new_window_label = label_for_handlers.clone();
                    let new_window =
                        NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
                            let Some(args) = args else { return Ok(()) };
                            let uri = take_string(|value| args.Uri(value));
                            let mut initiated = windows_core::BOOL::default();
                            let _ = args.IsUserInitiated(&mut initiated);
                            args.SetHandled(true)?;
                            let _ = new_window_app.emit(
                                SITE_NEW_WINDOW_EVENT,
                                NewWindowPayload {
                                    tab_label: new_window_label.clone(),
                                    uri,
                                    user_initiated: initiated.as_bool(),
                                },
                            );
                            Ok(())
                        }));
                    let mut new_window_token = 0i64;
                    core.add_NewWindowRequested(&new_window, &mut new_window_token)?;

                    let close_app = app_for_handlers.clone();
                    let close_label = label_for_handlers.clone();
                    let window_close =
                        WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
                            let _ = close_app.emit(
                                SITE_CLOSE_WINDOW_EVENT,
                                CloseWindowPayload {
                                    tab_label: close_label.clone(),
                                },
                            );
                            Ok(())
                        }));
                    let mut window_close_token = 0i64;
                    core.add_WindowCloseRequested(&window_close, &mut window_close_token)?;

                    let mut basic_auth_handler = None;
                    let mut basic_auth_token = None;
                    if let Ok(core10) = core.cast::<ICoreWebView2_10>() {
                        let auth_app = app_for_handlers.clone();
                        let auth_label = label_for_handlers.clone();
                        let handler = BasicAuthenticationRequestedEventHandler::create(Box::new(
                            move |_, args| {
                                let Some(args) = args else { return Ok(()) };
                                let deferral = args.GetDeferral()?;
                                let uri = take_string(|value| args.Uri(value));
                                let challenge = take_string(|value| args.Challenge(value));
                                let id = next_request_id("auth");

                                enqueue_request(
                                    &auth_app,
                                    SiteUiRequest {
                                        id: id.clone(),
                                        tab_label: auth_label.clone(),
                                        request_type: "basic-auth".to_string(),
                                        uri: uri.clone(),
                                        title: host_label(&uri),
                                        message: "This site requires HTTP authentication."
                                            .to_string(),
                                        default_text: String::new(),
                                        dialog_kind: None,
                                        permission_kind: None,
                                        challenge: Some(challenge),
                                        is_user_initiated: true,
                                    },
                                    PendingRequest::BasicAuth {
                                        tab_label: auth_label.clone(),
                                        args,
                                        deferral,
                                    },
                                );
                                Ok(())
                            },
                        ));
                        let mut token = 0i64;
                        core10.add_BasicAuthenticationRequested(&handler, &mut token)?;
                        basic_auth_token = Some(token);
                        basic_auth_handler = Some(handler);
                    }

                    Ok((
                        HandlerTokens {
                            script_dialog: script_token,
                            basic_auth: basic_auth_token,
                            new_window: new_window_token,
                            window_close: window_close_token,
                            web_message: web_message_token,
                            external_uri: external_uri_token,
                        },
                        Handlers {
                            _script_dialog: script_dialog,
                            _basic_auth: basic_auth_handler,
                            _new_window: new_window,
                            _window_close: window_close,
                            _web_message: web_message,
                            _external_uri: external_uri_handler,
                        },
                    ))
                })();

                match result {
                    Ok((tokens, handlers)) => {
                        if let Ok(mut token_map) = TOKENS.lock() {
                            token_map.insert(label_for_handlers.clone(), tokens);
                            HANDLERS.with(|slots| {
                                slots
                                    .borrow_mut()
                                    .insert(label_for_handlers.clone(), handlers);
                            });
                            if let Ok(mut configured) = CONFIGURED.lock() {
                                configured.insert(label_for_handlers.clone());
                            }
                        }
                    }
                    Err(error) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[nebula site ui] {}: {}", label_for_handlers, error);
                    }
                }
            })
            .map_err(|error| error.to_string())?;

        if CONFIGURED
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            Ok(())
        } else {
            Err(format!("failed to configure site UI for '{label}'"))
        }
    }

    pub fn respond(
        app: AppHandle,
        request_id: String,
        response: SiteUiResponse,
    ) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let result = PENDING.with(|pending| {
                let request = pending.borrow_mut().remove(&request_id).ok_or_else(|| {
                    format!("site UI request '{request_id}' is no longer pending")
                })?;

                let native_result = unsafe {
                    (|| -> windows_core::Result<()> {
                        match request {
                            PendingRequest::ScriptDialog {
                                args,
                                deferral,
                                is_prompt,
                                ..
                            } => {
                                if response.accepted {
                                    // An intentionally empty prompt response must replace the
                                    // page-provided default text too. Only prompt dialogs accept
                                    // result text; alert/confirm/beforeunload do not.
                                    if is_prompt {
                                        args.SetResultText(&HSTRING::from(response.text))?;
                                    }
                                    args.Accept()?;
                                }
                                deferral.Complete()?;
                            }
                            PendingRequest::Permission { args, deferral, .. } => {
                                if let Ok(args3) =
                                    args.cast::<ICoreWebView2PermissionRequestedEventArgs3>()
                                {
                                    let _ = args3.SetSavesInProfile(response.remember);
                                }
                                args.SetState(if response.accepted {
                                    COREWEBVIEW2_PERMISSION_STATE_ALLOW
                                } else {
                                    COREWEBVIEW2_PERMISSION_STATE_DENY
                                })?;
                                deferral.Complete()?;
                            }
                            PendingRequest::BasicAuth { args, deferral, .. } => {
                                if response.accepted {
                                    let credentials = args.Response()?;
                                    credentials.SetUserName(&HSTRING::from(response.username))?;
                                    credentials.SetPassword(&HSTRING::from(response.password))?;
                                    args.SetCancel(false)?;
                                } else {
                                    args.SetCancel(true)?;
                                }
                                deferral.Complete()?;
                            }
                            PendingRequest::ProtocolHandler { .. } => {}
                            PendingRequest::ExternalUri { args, deferral, .. } => {
                                args.SetCancel(!response.accepted)?;
                                deferral.Complete()?;
                            }
                        }
                        Ok(())
                    })()
                };
                native_result.map_err(|error| error.to_string())
            });
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;

        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| "timed out completing site UI request".to_string())?
    }

    fn cancel_request(request: PendingRequest) {
        unsafe {
            match request {
                PendingRequest::ScriptDialog { deferral, .. } => {
                    let _ = deferral.Complete();
                }
                PendingRequest::Permission { args, deferral, .. } => {
                    let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY);
                    let _ = deferral.Complete();
                }
                PendingRequest::BasicAuth { args, deferral, .. } => {
                    let _ = args.SetCancel(true);
                    let _ = deferral.Complete();
                }
                PendingRequest::ProtocolHandler { .. } => {}
                PendingRequest::ExternalUri { args, deferral, .. } => {
                    let _ = args.SetCancel(true);
                    let _ = deferral.Complete();
                }
            }
        }
    }

    pub fn cancel_for_tab(app: &AppHandle, label: &str) {
        let app = app.clone();
        let label = label.to_string();
        let _ = app.clone().run_on_main_thread(move || {
            let cancelled = PENDING.with(|pending| {
                let mut pending = pending.borrow_mut();
                let ids: Vec<String> = pending
                    .iter()
                    .filter(|(_, request)| request.tab_label() == label)
                    .map(|(id, _)| id.clone())
                    .collect();
                let mut cancelled = Vec::with_capacity(ids.len());
                for id in ids {
                    if let Some(request) = pending.remove(&id) {
                        cancel_request(request);
                        cancelled.push(id);
                    }
                }
                cancelled
            });

            for id in cancelled {
                let _ = app.emit(
                    SITE_UI_CANCELLED_EVENT,
                    SiteUiCancelledPayload {
                        id,
                        tab_label: label.clone(),
                    },
                );
            }
        });
    }

    pub fn teardown(app: &AppHandle, label: &str) {
        let tokens = TOKENS.lock().ok().and_then(|mut map| map.remove(label));
        let handler_label = label.to_string();
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(move |inner| unsafe {
                if let (Ok(core), Some(tokens)) = (inner.controller().CoreWebView2(), tokens) {
                    let _ = core.remove_ScriptDialogOpening(tokens.script_dialog);
                    let _ = core.remove_NewWindowRequested(tokens.new_window);
                    let _ = core.remove_WindowCloseRequested(tokens.window_close);
                    let _ = core.remove_WebMessageReceived(tokens.web_message);
                    if let (Some(token), Ok(core10)) =
                        (tokens.basic_auth, core.cast::<ICoreWebView2_10>())
                    {
                        let _ = core10.remove_BasicAuthenticationRequested(token);
                    }
                    if let (Some(token), Ok(core18)) =
                        (tokens.external_uri, core.cast::<ICoreWebView2_18>())
                    {
                        let _ = core18.remove_LaunchingExternalUriScheme(token);
                    }
                }
                HANDLERS.with(|slots| {
                    slots.borrow_mut().remove(&handler_label);
                });
            });
        }
        if let Ok(mut configured) = CONFIGURED.lock() {
            configured.remove(label);
        }
        cancel_for_tab(app, label);
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn site_ui_queue_is_bounded_per_tab() {
            let labels = ["tab-a", "tab-a", "tab-b"];
            assert!(!has_pending_capacity(labels.into_iter(), "tab-a", 2));
            assert!(has_pending_capacity(labels.into_iter(), "tab-b", 2));
        }

        #[test]
        fn expired_protocol_prompt_is_removed_from_pending_requests() {
            let id = "protocol-handler-test";
            PENDING.with(|pending| {
                pending.borrow_mut().insert(
                    id.to_string(),
                    PendingRequest::ProtocolHandler {
                        tab_label: "tab-a".to_string(),
                    },
                );
            });

            assert_eq!(remove_and_cancel_pending(id).as_deref(), Some("tab-a"));
            PENDING.with(|pending| assert!(!pending.borrow().contains_key(id)));
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{request_permission, respond, setup, teardown, SiteUiResponse};

#[cfg(not(target_os = "windows"))]
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SiteUiResponse {
    pub accepted: bool,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
    #[serde(default)]
    pub remember: bool,
}

#[cfg(not(target_os = "windows"))]
pub fn setup(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown(_app: &tauri::AppHandle, _label: &str) {}

#[cfg(not(target_os = "windows"))]
pub fn respond(
    _app: tauri::AppHandle,
    _request_id: String,
    _response: SiteUiResponse,
) -> Result<(), String> {
    Ok(())
}
