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
        ICoreWebView2, ICoreWebView2BasicAuthenticationRequestedEventArgs,
        ICoreWebView2BasicAuthenticationRequestedEventHandler, ICoreWebView2Deferral,
        ICoreWebView2LaunchingExternalUriSchemeEventArgs,
        ICoreWebView2LaunchingExternalUriSchemeEventHandler,
        ICoreWebView2NewWindowRequestedEventArgs, ICoreWebView2NewWindowRequestedEventHandler,
        ICoreWebView2PermissionRequestedEventArgs, ICoreWebView2PermissionRequestedEventArgs3,
        ICoreWebView2PermissionRequestedEventHandler, ICoreWebView2ScreenCaptureStartingEventArgs,
        ICoreWebView2ScreenCaptureStartingEventHandler, ICoreWebView2ScriptDialogOpeningEventArgs,
        ICoreWebView2ScriptDialogOpeningEventHandler, ICoreWebView2WebMessageReceivedEventArgs,
        ICoreWebView2WebMessageReceivedEventHandler, ICoreWebView2WindowCloseRequestedEventHandler,
        ICoreWebView2_10, ICoreWebView2_13, ICoreWebView2_18, ICoreWebView2_27,
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
        COREWEBVIEW2_PERMISSION_STATE_DENY, COREWEBVIEW2_SCRIPT_DIALOG_KIND,
    };
    use webview2_com::{
        AddScriptToExecuteOnDocumentCreatedCompletedHandler,
        BasicAuthenticationRequestedEventHandler, LaunchingExternalUriSchemeEventHandler,
        NewWindowRequestedEventHandler, PermissionRequestedEventHandler,
        ScreenCaptureStartingEventHandler, ScriptDialogOpeningEventHandler,
        WebMessageReceivedEventHandler, WindowCloseRequestedEventHandler,
    };
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows_core::{Interface, HSTRING, PWSTR};

    const SITE_UI_EVENT: &str = "nebula-site-ui-request";
    const SITE_UI_CANCELLED_EVENT: &str = "nebula-site-ui-cancelled";
    const SITE_NEW_WINDOW_EVENT: &str = "nebula-site-new-window";
    const SITE_CLOSE_WINDOW_EVENT: &str = "nebula-site-close-window";
    const SITE_POINTER_DOWN_EVENT: &str = "nebula-site-pointer-down";
    const SENSITIVE_FEATURE_USAGE_EVENT: &str = "nebula-sensitive-feature-usage";
    const SITE_PRINT_REQUEST_EVENT: &str = "nebula-site-print-request";
    const SITE_ZOOM_REQUEST_EVENT: &str = "nebula-site-zoom-request";
    const PASSWORD_STEP_EVENT: &str = "nebula-password-step";
    const SITE_UI_TIMEOUT: Duration = Duration::from_secs(60);
    const POPUP_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
    const MAX_PENDING_SITE_UI_PER_TAB: usize = 8;
    const MAX_PENDING_POPUPS_PER_TAB: usize = 4;

    static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
    static CONFIGURED: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static TOKENS: LazyLock<Mutex<HashMap<String, HandlerTokens>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static MAIN_PERMISSION_UI_CONFIGURED: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static SCREEN_CAPTURE_ACTIVE: LazyLock<Mutex<HashMap<String, bool>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    struct HandlerTokens {
        script_dialog: i64,
        basic_auth: Option<i64>,
        new_window: i64,
        window_close: i64,
        web_message: i64,
        external_uri: Option<i64>,
        screen_capture: Option<i64>,
    }

    struct Handlers {
        _script_dialog: ICoreWebView2ScriptDialogOpeningEventHandler,
        _basic_auth: Option<ICoreWebView2BasicAuthenticationRequestedEventHandler>,
        _new_window: ICoreWebView2NewWindowRequestedEventHandler,
        _window_close: ICoreWebView2WindowCloseRequestedEventHandler,
        _web_message: ICoreWebView2WebMessageReceivedEventHandler,
        _external_uri: Option<ICoreWebView2LaunchingExternalUriSchemeEventHandler>,
        _screen_capture: Option<ICoreWebView2ScreenCaptureStartingEventHandler>,
    }

    struct MainPermissionUiHandler {
        _permission: ICoreWebView2PermissionRequestedEventHandler,
        _token: i64,
    }

    struct PendingPopup {
        opener_label: String,
        args: ICoreWebView2NewWindowRequestedEventArgs,
        deferral: ICoreWebView2Deferral,
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
            uri: String,
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
        static PENDING_POPUPS: RefCell<HashMap<String, PendingPopup>> = RefCell::new(HashMap::new());
        static MAIN_PERMISSION_UI_HANDLERS: RefCell<HashMap<String, MainPermissionUiHandler>> =
            RefCell::new(HashMap::new());
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
    struct PopupWindowFeaturesPayload {
        is_popup: bool,
        has_position: bool,
        has_size: bool,
        left: u32,
        top: u32,
        width: u32,
        height: u32,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct NewWindowPayload {
        request_id: String,
        tab_label: String,
        uri: String,
        user_initiated: bool,
        private_mode: bool,
        features: PopupWindowFeaturesPayload,
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

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct SensitiveFeatureUsagePayload {
        tab_label: String,
        origin: String,
        camera: bool,
        microphone: bool,
        location: bool,
        screen: bool,
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

  // WebView2 normally routes window.print() to Chromium's built-in print UI.
  // Keep all print entry points inside Nebula by forwarding the request to the
  // shell. The original function remains the fallback for internal/opaque
  // documents where Wry cannot safely receive a WebMessage.
  const nativeWindowPrint =
    typeof window.print === 'function'
      ? window.print.bind(window)
      : null;

  function requestNebulaPrint() {
    if (!canReportSitePointerDown) {
      if (nativeWindowPrint) nativeWindowPrint();
      return;
    }

    try {
      bridge.postMessage(JSON.stringify({
        type: 'nebula-print-request',
        title: String(document.title || '').slice(0, 1024),
        url: String(window.location.href || '').slice(0, 8192)
      }));
    } catch (_) {
      if (nativeWindowPrint) nativeWindowPrint();
    }
  }

  try {
    Object.defineProperty(window, 'print', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: requestNebulaPrint
    });
  } catch (_) {
    try { window.print = requestNebulaPrint; } catch (_) {}
  }

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
    // WebView2's built-in zoom controller is disabled so Nebula can apply the
    // same bounded zoom steps for keyboard shortcuts and Ctrl+mouse-wheel.
    window.addEventListener('wheel', function (event) {
      if (!event.isTrusted || !event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      try {
        bridge.postMessage(JSON.stringify({
          type: 'nebula-zoom-request',
          action: event.deltaY < 0 ? 'in' : 'out'
        }));
      } catch (_) {}
    }, { capture: true, passive: false });

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

  function installSensitiveFeatureUsageObserver() {
    if (!canReportSitePointerDown || window.__nebulaSensitiveUsageObserverInstalled) return;
    window.__nebulaSensitiveUsageObserverInstalled = true;

    const liveCameraTracks = new Set();
    const liveMicrophoneTracks = new Set();
    const liveDisplayTracks = new Set();
    const trackedKinds = new WeakMap();
    const locationWatches = new Set();
    let pendingLocationRequests = 0;
    let lastUsageKey = '';

    function currentUsage() {
      for (const track of Array.from(liveCameraTracks)) {
        if (!track || track.readyState === 'ended') liveCameraTracks.delete(track);
      }
      for (const track of Array.from(liveMicrophoneTracks)) {
        if (!track || track.readyState === 'ended') liveMicrophoneTracks.delete(track);
      }
      for (const track of Array.from(liveDisplayTracks)) {
        if (!track || track.readyState === 'ended') liveDisplayTracks.delete(track);
      }
      return {
        camera: liveCameraTracks.size > 0,
        microphone: liveMicrophoneTracks.size > 0,
        location: pendingLocationRequests > 0 || locationWatches.size > 0,
        screen: liveDisplayTracks.size > 0
      };
    }

    function reportUsage(force) {
      const usage = currentUsage();
      const key = [usage.camera, usage.microphone, usage.location, usage.screen].join(':');
      if (!force && key === lastUsageKey) return;
      lastUsageKey = key;
      try {
        bridge.postMessage(JSON.stringify({
          type: 'nebula-sensitive-feature-usage',
          origin: window.location.origin,
          camera: usage.camera,
          microphone: usage.microphone,
          location: usage.location,
          screen: usage.screen
        }));
      } catch (_) {}
    }

    function releaseTrack(track) {
      liveCameraTracks.delete(track);
      liveMicrophoneTracks.delete(track);
      liveDisplayTracks.delete(track);
      reportUsage(false);
    }

    function trackDevice(track, forcedKind) {
      if (!track || track.readyState === 'ended' || trackedKinds.has(track)) return track;
      const kind = forcedKind === 'screen'
        ? 'screen'
        : track.kind === 'video'
          ? 'camera'
          : track.kind === 'audio'
            ? 'microphone'
            : '';
      if (!kind) return track;
      trackedKinds.set(track, kind);
      (kind === 'screen'
        ? liveDisplayTracks
        : kind === 'camera'
          ? liveCameraTracks
          : liveMicrophoneTracks).add(track);
      track.addEventListener('ended', function () { releaseTrack(track); }, { once: true });
      if (typeof track.stop === 'function') {
        const nativeStop = track.stop.bind(track);
        try {
          Object.defineProperty(track, 'stop', {
            configurable: true,
            value: function () {
              releaseTrack(track);
              return nativeStop();
            }
          });
        } catch (_) {}
      }
      reportUsage(false);
      return track;
    }

    const mediaDevices = navigator.mediaDevices;
    if (mediaDevices && typeof mediaDevices.getUserMedia === 'function') {
      const nativeGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
      try {
        Object.defineProperty(mediaDevices, 'getUserMedia', {
          configurable: true,
          value: function (constraints) {
            return nativeGetUserMedia(constraints).then(function (stream) {
              if (stream && typeof stream.getTracks === 'function') {
                stream.getTracks().forEach(trackDevice);
              }
              return stream;
            });
          }
        });
      } catch (_) {}
    }

    if (mediaDevices && typeof mediaDevices.getDisplayMedia === 'function') {
      const nativeGetDisplayMedia = mediaDevices.getDisplayMedia.bind(mediaDevices);
      try {
        Object.defineProperty(mediaDevices, 'getDisplayMedia', {
          configurable: true,
          value: function (constraints) {
            return nativeGetDisplayMedia(constraints).then(function (stream) {
              if (stream && typeof stream.getTracks === 'function') {
                stream.getTracks().forEach(function (track) {
                  trackDevice(track, 'screen');
                });
              }
              return stream;
            });
          }
        });
      } catch (_) {}
    }

    if (typeof MediaStreamTrack !== 'undefined' && MediaStreamTrack.prototype) {
      const nativeClone = MediaStreamTrack.prototype.clone;
      if (typeof nativeClone === 'function') {
        try {
          Object.defineProperty(MediaStreamTrack.prototype, 'clone', {
            configurable: true,
            value: function () {
              const cloned = nativeClone.call(this);
              return trackedKinds.has(this) ? trackDevice(cloned, trackedKinds.get(this)) : cloned;
            }
          });
        } catch (_) {}
      }
    }

    const geolocation = navigator.geolocation;
    if (geolocation) {
      const nativeGetCurrentPosition = typeof geolocation.getCurrentPosition === 'function'
        ? geolocation.getCurrentPosition.bind(geolocation)
        : null;
      const nativeWatchPosition = typeof geolocation.watchPosition === 'function'
        ? geolocation.watchPosition.bind(geolocation)
        : null;
      const nativeClearWatch = typeof geolocation.clearWatch === 'function'
        ? geolocation.clearWatch.bind(geolocation)
        : null;

      if (nativeGetCurrentPosition) {
        try {
          Object.defineProperty(geolocation, 'getCurrentPosition', {
            configurable: true,
            value: function (success, failure, options) {
              pendingLocationRequests += 1;
              reportUsage(false);
              let settled = false;
              const finish = function (callback, value) {
                if (!settled) {
                  settled = true;
                  pendingLocationRequests = Math.max(0, pendingLocationRequests - 1);
                  reportUsage(false);
                }
                if (typeof callback === 'function') callback(value);
              };
              return nativeGetCurrentPosition(
                function (position) { finish(success, position); },
                function (error) { finish(failure, error); },
                options
              );
            }
          });
        } catch (_) {}
      }

      if (nativeWatchPosition && nativeClearWatch) {
        try {
          Object.defineProperty(geolocation, 'watchPosition', {
            configurable: true,
            value: function (success, failure, options) {
              const watchId = nativeWatchPosition(success, failure, options);
              locationWatches.add(watchId);
              reportUsage(false);
              return watchId;
            }
          });
          Object.defineProperty(geolocation, 'clearWatch', {
            configurable: true,
            value: function (watchId) {
              locationWatches.delete(watchId);
              reportUsage(false);
              return nativeClearWatch(watchId);
            }
          });
        } catch (_) {}
      }
    }

    window.addEventListener('pagehide', function () {
      liveCameraTracks.clear();
      liveMicrophoneTracks.clear();
      liveDisplayTracks.clear();
      locationWatches.clear();
      pendingLocationRequests = 0;
      reportUsage(true);
    }, true);
    reportUsage(true);
  }

  installSensitiveFeatureUsageObserver();

  function installInstagramAvatarObserver() {
    const hostname = String(window.location.hostname || '').toLowerCase();
    if (hostname !== 'instagram.com' && !hostname.endsWith('.instagram.com')) return;
    if (window.__nebulaInstagramAvatarObserverInstalled) return;
    window.__nebulaInstagramAvatarObserverInstalled = true;

    const hints = window.__nebulaInstagramAvatarHints instanceof Map
      ? window.__nebulaInstagramAvatarHints
      : new Map();
    window.__nebulaInstagramAvatarHints = hints;
    const reported = new Set();

    function senderKey(value) {
      return String(value || '')
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '')
        .slice(0, 80);
    }

    function trustedImageUrl(value) {
      try {
        const url = new URL(String(value || ''), window.location.href);
        const host = String(url.hostname || '').toLowerCase();
        const trusted = [
          'instagram.com',
          'cdninstagram.com',
          'fbcdn.net',
          'facebook.com'
        ].some(function (domain) {
          return host === domain || host.endsWith('.' + domain);
        });
        return url.protocol === 'https:' && trusted ? url.href.slice(0, 2048) : '';
      } catch (_) {
        return '';
      }
    }

    function senderNames(image) {
      const names = [];
      const anchor = image.closest && image.closest('a[href]');
      if (anchor) {
        try {
          const path = new URL(anchor.href, window.location.href).pathname;
          const match = path.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
          const reserved = new Set(['accounts', 'direct', 'explore', 'reels', 'stories']);
          if (match && !reserved.has(match[1].toLowerCase())) names.push(match[1]);
        } catch (_) {}
      }

      const alt = String(image.getAttribute('alt') || '').trim();
      const patterns = [
        /^(.{1,120}?)(?:'s|’s) profile picture$/i,
        /^profile picture of (.{1,120})$/i,
        /^(.{1,120}?) adlı kullanıcının profil resmi$/i,
        /^(.{1,120}?) profil resmi$/i
      ];
      for (let index = 0; index < patterns.length; index += 1) {
        const match = alt.match(patterns[index]);
        if (match && match[1]) names.push(match[1].trim());
      }
      return Array.from(new Set(names.filter(Boolean)));
    }

    function reportImage(image) {
      if (!(image instanceof HTMLImageElement)) return;
      const iconUrl = trustedImageUrl(image.currentSrc || image.src);
      if (!iconUrl) return;
      const names = senderNames(image);
      for (let index = 0; index < names.length; index += 1) {
        const senderName = names[index];
        const key = senderKey(senderName);
        if (!key) continue;
        hints.set(key, iconUrl);
        const reportKey = key + '\u0000' + iconUrl;
        if (reported.has(reportKey)) continue;
        if (reported.size >= 512) reported.clear();
        reported.add(reportKey);
        try {
          bridge.postMessage(JSON.stringify({
            type: 'nebula-site-avatar-hint',
            origin: window.location.origin,
            senderName: senderName.slice(0, 120),
            iconUrl: iconUrl
          }));
        } catch (_) {}
      }
    }

    function scan(root) {
      if (!root) return;
      if (root instanceof HTMLImageElement) reportImage(root);
      if (!root.querySelectorAll) return;
      const images = root.querySelectorAll('img[src]');
      for (let index = 0; index < images.length; index += 1) reportImage(images[index]);
    }

    function arm() {
      if (!document.body) {
        window.setTimeout(arm, 250);
        return;
      }
      scan(document.body);
      new MutationObserver(function (mutations) {
        for (let index = 0; index < mutations.length; index += 1) {
          const mutation = mutations[index];
          if (mutation.type === 'attributes') reportImage(mutation.target);
          for (let addedIndex = 0; addedIndex < mutation.addedNodes.length; addedIndex += 1) {
            scan(mutation.addedNodes[addedIndex]);
          }
        }
      }).observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'alt']
      });
    }

    arm();
  }

  function installInstagramMessageObserver() {
    const hostname = String(window.location.hostname || '').toLowerCase();
    if (hostname !== 'instagram.com' && !hostname.endsWith('.instagram.com')) return;
    if (window.__nebulaInstagramMessageObserverInstalled) return;
    window.__nebulaInstagramMessageObserverInstalled = true;

    const seen = new WeakSet();
    const attempts = new WeakMap();
    const queued = new WeakSet();
    let observer = null;
    let lastMessageKey = '';
    let lastMessageAt = 0;

    function visibleComposer() {
      const candidates = document.querySelectorAll(
        '[contenteditable]:not([contenteditable="false"]), textarea, input[type="text"]'
      );
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        const rect = candidates[index].getBoundingClientRect();
        if (
          !candidates[index].closest('[aria-hidden="true"]') &&
          rect.width > 120 &&
          rect.height > 15 &&
          rect.bottom > window.innerHeight * 0.55
        ) {
          return candidates[index];
        }
      }
      return null;
    }

    function conversationName(composerRect) {
      const headings = document.querySelectorAll('main h1, main h2, main [role="heading"]');
      for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        const rect = heading.getBoundingClientRect();
        const text = String(heading.textContent || '').trim();
        if (
          text &&
          text.length <= 80 &&
          rect.width > 0 &&
          rect.left >= composerRect.left - 48 &&
          rect.bottom < composerRect.top
        ) {
          return text;
        }
      }
      return 'Instagram';
    }

    function conversationAvatar(composerRect, title) {
      const titleKey = String(title || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      if (!titleKey || titleKey === 'instagram') return '';

      function trustedAvatar(image) {
        if (!(image instanceof HTMLImageElement)) return '';
        const rect = image.getBoundingClientRect();
        if (
          rect.width < 16 || rect.width > 96 || rect.height < 16 || rect.height > 96 ||
          rect.bottom >= composerRect.top || rect.width <= 0 || rect.height <= 0
        ) return '';
        try {
          const url = new URL(image.currentSrc || image.src, window.location.href);
          const host = String(url.hostname || '').toLowerCase();
          const trusted = ['instagram.com', 'cdninstagram.com', 'fbcdn.net', 'facebook.com']
            .some(function (domain) { return host === domain || host.endsWith('.' + domain); });
          return url.protocol === 'https:' && trusted ? url.href.slice(0, 2048) : '';
        } catch (_) {
          return '';
        }
      }

      const headings = document.querySelectorAll('main h1, main h2, main [role="heading"]');
      for (let index = 0; index < headings.length; index += 1) {
        const heading = headings[index];
        const headingKey = String(heading.textContent || '')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]/gu, '');
        if (headingKey !== titleKey) continue;
        let container = heading.parentElement;
        for (let depth = 0; container && depth < 5; depth += 1) {
          const images = container.querySelectorAll('img[src]');
          for (let imageIndex = 0; imageIndex < images.length; imageIndex += 1) {
            const avatar = trustedAvatar(images[imageIndex]);
            if (avatar) return avatar;
          }
          if (container.matches('main')) break;
          container = container.parentElement;
        }
      }

      const images = document.querySelectorAll('main img[src][alt]');
      for (let index = 0; index < images.length; index += 1) {
        const altKey = String(images[index].getAttribute('alt') || '')
          .toLocaleLowerCase()
          .replace(/[^\p{L}\p{N}]/gu, '');
        if (!altKey.includes(titleKey)) continue;
        const avatar = trustedAvatar(images[index]);
        if (avatar) return avatar;
      }
      return '';
    }

    function messageDetailsFromCandidate(candidate, composerRect) {
      let container = candidate;
      let parent = candidate.parentElement;
      for (let depth = 0; parent && depth < 6; depth += 1) {
        const rect = parent.getBoundingClientRect();
        const text = String(parent.textContent || '').replace(/\s+/g, ' ').trim();
        const messageNodes = parent.querySelectorAll('[dir="auto"]');
        if (
          !text || text.length > 1200 || rect.width <= 0 || rect.height <= 0 ||
          rect.height > 260 || rect.top < 64 || rect.bottom >= composerRect.top ||
          messageNodes.length === 0 || messageNodes.length > 12
        ) break;
        container = parent;
        parent = parent.parentElement;
      }

      const nodes = [];
      if (container.matches && container.matches('[dir="auto"]')) nodes.push(container);
      if (container.querySelectorAll) {
        const descendants = container.querySelectorAll('[dir="auto"]');
        for (let index = 0; index < descendants.length; index += 1) nodes.push(descendants[index]);
      }
      const entries = [];
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index];
        if (node.querySelector && node.querySelector('[dir="auto"]')) continue;
        const rect = node.getBoundingClientRect();
        const text = String(node.textContent || '').replace(/\s+/g, ' ').trim();
        if (
          !text || text.length > 500 || rect.width <= 0 || rect.height <= 0 ||
          rect.bottom >= composerRect.top || rect.top < 64 ||
          rect.left + rect.width / 2 >= composerRect.left + composerRect.width / 2 ||
          /^(seen|new messages|just now|liked a message|\d+[smhd])$/i.test(text)
        ) continue;
        if (entries.length === 0 || entries[entries.length - 1].text !== text) {
          entries.push({ node: node, rect: rect, text: text });
        }
      }
      const fallbackText = String(candidate.textContent || '').replace(/\s+/g, ' ').trim();
      if (entries.length === 0) return { text: fallbackText, isReply: false };
      const actual = entries[entries.length - 1];
      const hasReplyLabel = /repl(?:y|ied)|yan[ıi]t|cevap/i.test(
        String(container.textContent || '')
      );
      const hasQuotedPreview = entries.slice(0, -1).some(function (entry) {
        const verticalGap = actual.rect.top - entry.rect.bottom;
        return entry.text !== actual.text &&
          entry.node.parentElement !== actual.node.parentElement &&
          verticalGap >= -4 && verticalGap <= 72;
      });
      return { text: actual.text, isReply: hasReplyLabel || hasQuotedPreview };
    }

    function reportCandidate(candidate) {
      if (!candidate || seen.has(candidate)) return;
      if (candidate.closest('button, a, input, textarea')) return;

      const composer = visibleComposer();
      if (!composer || !window.location.pathname.startsWith('/direct/t/')) return;
      const composerRect = composer.getBoundingClientRect();
      const rect = candidate.getBoundingClientRect();
      const details = messageDetailsFromCandidate(candidate, composerRect);
      const text = details.text;
      if (!text || text.length > 500 || rect.width <= 0 || rect.height <= 0) return;
      // Instagram can attach an empty message node and fill its text in a later
      // mutation. Mark it seen only after it has become measurable and readable.
      seen.add(candidate);
      if (rect.bottom >= composerRect.top || rect.top < 64) return;
      if (rect.left < composerRect.left - 48) return;
      if (rect.left + rect.width / 2 >= composerRect.left + composerRect.width / 2) return;
      if (/^(seen|new messages|just now|\d+[smhd])$/i.test(text)) return;

      const now = Date.now();
      const title = conversationName(composerRect);
      const key = title + '\u0000' + text;
      if (key === lastMessageKey && now - lastMessageAt < 5000) return;
      lastMessageKey = key;
      lastMessageAt = now;
      const avatarHints = window.__nebulaInstagramAvatarHints;
      const avatarKey = title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 80);
      const iconUrl = conversationAvatar(composerRect, title) ||
        (avatarHints instanceof Map ? String(avatarHints.get(avatarKey) || '') : '');
      if (iconUrl) {
        if (avatarHints instanceof Map) avatarHints.set(avatarKey, iconUrl);
        try {
          bridge.postMessage(JSON.stringify({
            type: 'nebula-site-avatar-hint',
            origin: window.location.origin,
            senderName: title,
            iconUrl: iconUrl
          }));
        } catch (_) {}
      }
      try {
        const visibleBody = details.isReply ? title + ' replied to you' : text;
        bridge.postMessage(JSON.stringify({
          type: 'nebula-site-notification-content',
          origin: window.location.origin,
          title: title,
          body: visibleBody,
          iconUrl: iconUrl,
          notificationType: details.isReply ? 'reply' : 'message',
          notificationData: details.isReply ? { replyText: text } : null,
          siteName: 'Instagram',
          senderName: title,
          eventKind: details.isReply ? 'reply' : 'message'
        }));
      } catch (_) {}
    }

    function queueCandidate(candidate) {
      if (!candidate || seen.has(candidate) || queued.has(candidate)) return;

      queued.add(candidate);

      window.setTimeout(function () {
        queued.delete(candidate);
        if (seen.has(candidate)) return;

        // Instagram hydrates both normal and replied messages over multiple
        // mutations. Let its own classifier inspect every incoming candidate;
        // reportCandidate marks it seen only after readable text exists and
        // already rejects outgoing/non-message nodes geometrically.
        reportCandidate(candidate);

        if (!seen.has(candidate)) {
          const attempt = attempts.get(candidate) || 0;
          if (attempt < 2) {
            attempts.set(candidate, attempt + 1);
            queueCandidate(candidate);
          }
        }
      }, 80);
    }

    function inspectNode(node) {
      const element = node && node.nodeType === Node.ELEMENT_NODE
        ? node
        : node && node.parentElement;
      if (!element) return;
      if (element.matches && element.matches('[dir="auto"]')) queueCandidate(element);
      if (element.querySelectorAll) {
        const candidates = element.querySelectorAll('[dir="auto"]');
        for (let index = 0; index < candidates.length; index += 1) {
          queueCandidate(candidates[index]);
        }
      }
    }

    function arm() {
      if (observer) return;
      if (!document.body || !window.location.pathname.startsWith('/direct/t/')) {
        window.setTimeout(arm, 750);
        return;
      }
      const composer = visibleComposer();
      if (!composer) {
        window.setTimeout(arm, 500);
        return;
      }
      const existing = document.querySelectorAll('[dir="auto"]');
      for (let index = 0; index < existing.length; index += 1) seen.add(existing[index]);
      observer = new MutationObserver(function (mutations) {
        for (let index = 0; index < mutations.length; index += 1) {
          const mutation = mutations[index];
          if (mutation.type === 'characterData') inspectNode(mutation.target);
          for (let addedIndex = 0; addedIndex < mutation.addedNodes.length; addedIndex += 1) {
            inspectNode(mutation.addedNodes[addedIndex]);
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    window.setTimeout(arm, 300);
  }

  function installInstagramPersistentNotificationObserver() {
    const hostname = String(window.location.hostname || '').toLowerCase();
    if (hostname !== 'instagram.com' && !hostname.endsWith('.instagram.com')) return;
    if (!navigator.serviceWorker || window.__nebulaInstagramPersistentNotificationObserverInstalled) return;
    window.__nebulaInstagramPersistentNotificationObserverInstalled = true;

    const observerStartedAt = Date.now();
    const seen = new Set();
    const pendingUpgrades = new Map();
    let initialized = false;
    let polling = false;
    let nextUpgradeToken = 1;

    if (typeof bridge.addEventListener === 'function') {
      bridge.addEventListener('message', function (event) {
        let value = event && event.data;
        if (typeof value === 'string') {
          try { value = JSON.parse(value); } catch (_) { return; }
        }
        if (!value || value.type !== 'nebula-upgrade-persistent-notification') return;
        const token = String(value.token || '');
        const pending = pendingUpgrades.get(token);
        if (!pending) return;
        pendingUpgrades.delete(token);
        void upgradePersistentNotification(
          pending.registration,
          pending.notification,
          pending.data,
          pending.presentation
        );
      });
    }

    function boundedNotificationData(value) {
      try {
        const serialized = JSON.stringify(value == null ? null : value);
        if (!serialized || serialized.length > 8192) return null;
        return JSON.parse(serialized);
      } catch (_) {
        return null;
      }
    }

    function metadataString(value, acceptedKeys, depth) {
      if (!value || typeof value !== 'object' || depth > 4) return '';
      const entries = Array.isArray(value) ? value.map(function (item, index) {
        return [String(index), item];
      }) : Object.entries(value);
      for (let index = 0; index < entries.length; index += 1) {
        const key = entries[index][0].replace(/[^a-z0-9]/gi, '').toLowerCase();
        const candidate = entries[index][1];
        if (
          acceptedKeys.indexOf(key) >= 0 &&
          typeof candidate === 'string' &&
          candidate.trim()
        ) {
          return candidate.trim().slice(0, 120);
        }
      }
      for (let index = 0; index < entries.length; index += 1) {
        const nested = metadataString(entries[index][1], acceptedKeys, depth + 1);
        if (nested) return nested;
      }
      return '';
    }

    function trustedInstagramImageUrl(value) {
      try {
        const url = new URL(String(value || ''), window.location.href);
        const host = String(url.hostname || '').toLowerCase();
        const trusted = ['instagram.com', 'cdninstagram.com', 'fbcdn.net', 'facebook.com']
          .some(function (domain) { return host === domain || host.endsWith('.' + domain); });
        return url.protocol === 'https:' && trusted ? url.href.slice(0, 2048) : '';
      } catch (_) {
        return '';
      }
    }

    function metadataImageUrl(value, depth) {
      if (!value || typeof value !== 'object' || depth > 4) return '';
      const acceptedKeys = [
        'senderprofilepictureurl',
        'senderprofilepicurl',
        'senderavatarurl',
        'senderimageurl',
        'profilepictureurl',
        'profilepicurl',
        'avatarurl'
      ];
      const entries = Array.isArray(value) ? value.map(function (item, index) {
        return [String(index), item];
      }) : Object.entries(value);
      for (let index = 0; index < entries.length; index += 1) {
        const key = entries[index][0].replace(/[^a-z0-9]/gi, '').toLowerCase();
        if (acceptedKeys.indexOf(key) < 0 || typeof entries[index][1] !== 'string') continue;
        const imageUrl = trustedInstagramImageUrl(entries[index][1]);
        if (imageUrl) return imageUrl;
      }
      for (let index = 0; index < entries.length; index += 1) {
        const nested = metadataImageUrl(entries[index][1], depth + 1);
        if (nested) return nested;
      }
      return '';
    }

    function metadataMessageText(value, notificationBody, senderName) {
      const keyScores = {
        replytext: 100,
        replymessage: 100,
        itemtext: 90,
        directmessage: 90,
        messagetext: 80,
        content: 70,
        text: 70,
        preview: 50,
        previewtext: 50,
        messagepreview: 50,
        message: 10
      };
      const candidates = [];
      function visit(current, depth) {
        if (current == null || depth > 6) return;
        if (typeof current === 'string') {
          const serialized = current.trim();
          if (
            serialized.length <= 8192 &&
            (serialized.startsWith('{') || serialized.startsWith('['))
          ) {
            try { visit(JSON.parse(serialized), depth + 1); } catch (_) {}
          }
          return;
        }
        if (typeof current !== 'object') return;
        const entries = Array.isArray(current) ? current.map(function (item, index) {
          return [String(index), item];
        }) : Object.entries(current);
        for (let index = 0; index < entries.length; index += 1) {
          const key = entries[index][0].replace(/[^a-z0-9]/gi, '').toLowerCase();
          const candidate = entries[index][1];
          const text = typeof candidate === 'string' ? candidate.trim() : '';
          if (
            keyScores[key] && text && text.length <= 500 &&
            !/^https?:\/\//i.test(text) && !text.startsWith('{') && !text.startsWith('[')
          ) {
            candidates.push({ text: text, score: keyScores[key] + Math.min(depth, 6) * 5 });
          }
        }
        for (let index = 0; index < entries.length; index += 1) {
          visit(entries[index][1], depth + 1);
        }
      }
      visit(value, 0);
      const body = String(notificationBody || '').trim();
      const bodyWithoutSender = senderName && body.startsWith(senderName)
        ? body.slice(senderName.length).trim()
        : body;
      const filtered = candidates.filter(function (candidate) {
        const text = candidate.text.toLocaleLowerCase();
        return candidate.text.toLocaleLowerCase() !== body.toLocaleLowerCase() &&
          candidate.text.toLocaleLowerCase() !== bodyWithoutSender.toLocaleLowerCase() &&
          ['replied to you', 'replied to your message', 'yanıtladı', 'yanitladi'].indexOf(text) < 0;
      });
      filtered.sort(function (left, right) { return right.score - left.score; });
      return filtered.length > 0 ? filtered[0].text : '';
    }

    function eventKind(notificationType, body) {
      const type = String(notificationType || '').toLowerCase();
      const text = String(body || '').toLowerCase();
      if (/repl(?:y|ied)|yan[ıi]t|cevap/.test(text)) return 'reply';
      if (type.indexOf('reaction') >= 0 || type.endsWith('_like')) return 'reaction';
      if (type.indexOf('mention') >= 0) return 'mention';
      if (type.startsWith('direct_v2')) return 'message';
      if (type.indexOf('live_broadcast') >= 0) return 'live';
      if (type.indexOf('rtc') >= 0 || type.indexOf('call') >= 0) return 'call';
      if (type === 'post') return 'post';
      return 'notification';
    }

    function eventKindLabel(kind) {
      const language = String(document.documentElement.lang || navigator.language || '').toLowerCase();
      const turkish = language.startsWith('tr');
      const labels = turkish
        ? { message: 'Mesaj', reply: 'Yanıt', reaction: 'Tepki', mention: 'Bahsetme', live: 'Canlı yayın', call: 'Arama', post: 'Gönderi' }
        : { message: 'Message', reply: 'Reply', reaction: 'Reaction', mention: 'Mention', live: 'Live', call: 'Call', post: 'Post' };
      return labels[kind] || '';
    }

    function notificationPresentation(notification, data, notificationType) {
      const body = String(notification.body || '').trim();
      let senderName = metadataString(
        data,
        ['sendername', 'senderusername', 'username', 'actorname', 'fromname', 'displayname', 'profilename'],
        0
      );
      if (!senderName) {
        const separator = body.indexOf(':');
        const prefix = separator > 0 && separator <= 80 ? body.slice(0, separator).trim() : '';
        if (prefix && /[a-zA-ZÀ-ž]/.test(prefix) && prefix.indexOf('//') < 0) senderName = prefix;
      }
      if (!senderName) {
        const actor = body.match(
          /^(.{1,80}?)\s+(?:sent you|repl(?:y|ied)|reacted|liked|sana|hikayene|mesaj[ıi]na)/i
        );
        if (actor && actor[1]) senderName = actor[1].trim();
      }
      const avatarHints = window.__nebulaInstagramAvatarHints;
      const avatarKey = senderName.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 80);
      const cachedAvatar = avatarHints instanceof Map
        ? trustedInstagramImageUrl(avatarHints.get(avatarKey))
        : '';
      const profileImageUrl = metadataImageUrl(data, 0) || cachedAvatar;
      const kind = eventKind(notificationType, body);
      const messageText = metadataMessageText(data, body, senderName);
      return {
        siteName: 'Instagram',
        senderName: senderName,
        eventKind: kind,
        eventLabel: eventKindLabel(kind),
        profileImageUrl: profileImageUrl,
        messageText: messageText,
        body: body
      };
    }

    async function upgradePersistentNotification(registration, notification, data, presentation) {
      if (!data || typeof data !== 'object' || Array.isArray(data)) return;
      if (data.__nebulaPresentationVersion === 1) return;
      const tag = String(notification.tag || '');
      if (!tag || typeof registration.showNotification !== 'function') return;
      const visibleBody = presentation.eventKind === 'reply' && presentation.messageText
        ? presentation.messageText
        : presentation.body;
      const options = {
        body: [presentation.eventLabel, visibleBody].filter(Boolean).join('\n'),
        data: Object.assign({}, data, { __nebulaPresentationVersion: 1 }),
        tag: tag,
        silent: true,
        renotify: false,
        requireInteraction: notification.requireInteraction === true
      };
      const icon = String(presentation.profileImageUrl || notification.icon || '');
      const badge = String(notification.badge || '');
      const image = String(notification.image || '');
      const timestamp = Number(notification.timestamp) || 0;
      if (icon) options.icon = icon;
      if (badge) options.badge = badge;
      if (image) options.image = image;
      if (timestamp > 0) options.timestamp = timestamp;
      const title = presentation.senderName
        ? presentation.senderName + ' • ' + presentation.siteName
        : presentation.siteName;
      try {
        // Reusing Instagram's tag replaces the existing persistent toast in
        // place. Its original data stays intact, so Instagram's own click
        // handler still owns navigation and analytics.
        await registration.showNotification(title, options);
      } catch (_) {}
    }

    function notificationIdentity(notification, serializedData) {
      return [
        String(notification.tag || ''),
        String(Number(notification.timestamp) || 0),
        String(notification.title || ''),
        String(notification.body || ''),
        String(notification.icon || ''),
        serializedData
      ].join('\u0000');
    }

    async function pollPersistentNotifications() {
      if (polling) return;
      polling = true;
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const snapshots = await Promise.all(registrations.map(async function (registration) {
          if (typeof registration.getNotifications !== 'function') {
            return { registration: registration, notifications: [] };
          }
          try {
            return { registration: registration, notifications: await registration.getNotifications() };
          } catch (_) {
            return { registration: registration, notifications: [] };
          }
        }));
        const current = new Set();

        for (let snapshotIndex = 0; snapshotIndex < snapshots.length; snapshotIndex += 1) {
          const registration = snapshots[snapshotIndex].registration;
          const notifications = snapshots[snapshotIndex].notifications;
          for (let index = 0; index < notifications.length; index += 1) {
            const notification = notifications[index];
            const data = boundedNotificationData(notification.data);
            const serializedData = data == null ? '' : JSON.stringify(data);
            const identity = notificationIdentity(notification, serializedData);
            current.add(identity);
            if (seen.has(identity)) continue;
            if (data && data.__nebulaPresentationVersion === 1) continue;

            const timestampMs = Number(notification.timestamp) || 0;
            // Do not replay an old Windows notification merely because the page
            // or Nebula restarted. A notification created during adapter startup
            // is still new and must not fall through to the title-only fallback.
            const isFreshAtStartup = timestampMs >= observerStartedAt - 5000;
            if (initialized || isFreshAtStartup) {
              const notificationType = data && typeof data.notifType === 'string'
                ? data.notifType
                : '';
              const targetUrl = data && typeof data.uri === 'string'
                ? data.uri
                : typeof notification.navigate === 'string'
                  ? notification.navigate
                  : '';
              const presentation = notificationPresentation(notification, data, notificationType);
              let replacementToken = '';
              if (
                data &&
                typeof data === 'object' &&
                !Array.isArray(data) &&
                String(notification.tag || '')
              ) {
                replacementToken = String(Date.now()) + '-' + String(nextUpgradeToken++);
                pendingUpgrades.set(replacementToken, {
                  registration: registration,
                  notification: notification,
                  data: data,
                  presentation: presentation
                });
                window.setTimeout(function () {
                  pendingUpgrades.delete(replacementToken);
                }, 5000);
              }
              try {
                bridge.postMessage(JSON.stringify({
                  type: 'nebula-site-notification-content',
                  adapter: 'service-worker-snapshot',
                  origin: window.location.origin,
                  title: String(notification.title || 'Instagram'),
                  body: String(notification.body || ''),
                  iconUrl: String(presentation.profileImageUrl || notification.icon || ''),
                  notificationTag: String(notification.tag || ''),
                  notificationType: notificationType,
                  targetUrl: targetUrl,
                  notificationData: data,
                  siteName: presentation.siteName,
                  senderName: presentation.senderName,
                  eventKind: presentation.eventKind,
                  replacementToken: replacementToken,
                  timestampMs: timestampMs
                }));
              } catch (_) {
                if (replacementToken) pendingUpgrades.delete(replacementToken);
              }
            }
          }
        }

        seen.clear();
        current.forEach(function (identity) { seen.add(identity); });
        initialized = true;
      } catch (_) {
        // The DOM adapter and title fallback remain available when the
        // persistent Notifications API is unavailable or temporarily fails.
      } finally {
        polling = false;
      }
    }

    window.__nebulaPollInstagramPersistentNotifications = pollPersistentNotifications;
    void pollPersistentNotifications();
    window.setInterval(pollPersistentNotifications, 1000);
    document.addEventListener('visibilitychange', pollPersistentNotifications, true);
    navigator.serviceWorker.addEventListener('controllerchange', pollPersistentNotifications);

    function observeTitle() {
      const title = document.querySelector('title');
      if (!title) {
        window.setTimeout(observeTitle, 250);
        return;
      }
      new MutationObserver(pollPersistentNotifications).observe(title, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
    observeTitle();
  }

  function installWhatsAppMessageObserver() {
    if (String(window.location.hostname || '').toLowerCase() !== 'web.whatsapp.com') return;
    if (window.__nebulaWhatsAppMessageObserverInstalled) return;
    window.__nebulaWhatsAppMessageObserverInstalled = true;

    const seen = new WeakSet();
    const queued = new WeakSet();
    const attempts = new WeakMap(); 

    function conversationName(candidate) {
      const copyable = candidate.querySelector('[data-pre-plain-text]');
      const prefix = String(copyable?.getAttribute('data-pre-plain-text') || '');
      const matched = prefix.match(/\]\s*([^:]{1,80}):\s*$/);
      if (matched && matched[1]) return matched[1].trim();
      const titled = document.querySelector(
        'header [data-testid="conversation-info-header-chat-title"], header span[title]'
      );
      return String(titled?.getAttribute('title') || titled?.textContent || 'WhatsApp').trim();
    }
    

    function reportIncoming(candidate) {
  if (!candidate || seen.has(candidate)) return;

  if (candidate.querySelector('[data-testid="tail-out"]')) {
    seen.add(candidate);
    return;
  }

  const quotedMessage =
    candidate.querySelector('[data-testid="quoted-message"]');

  if (!quotedMessage) return;

  const textNodes = Array.from(
    candidate.querySelectorAll('[data-testid="selectable-text"], .selectable-text')
  );

  if (textNodes.length === 0) return;

  const actualNode = textNodes[textNodes.length - 1];

  const text = String(actualNode?.innerText || actualNode?.textContent || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || text.length > 500) return;

  const senderName =
    conversationName(candidate).slice(0, 80) || 'WhatsApp';

  seen.add(candidate);

  try {
    bridge.postMessage(JSON.stringify({
      type: 'nebula-whatsapp-reply-hint',
      origin: window.location.origin,
      senderName: senderName,
      body: text
    }));
  } catch (_) {}
}

function queueCandidate(candidate) {
  if (!candidate || seen.has(candidate) || queued.has(candidate)) return;

  queued.add(candidate);

  window.setTimeout(function () {
    queued.delete(candidate);

    if (seen.has(candidate)) return;

    const incoming =
      candidate.querySelector('[data-testid="tail-in"]');

    const quoted =
      candidate.querySelector('[data-testid="quoted-message"]');

    if (!incoming || !quoted) {
      const attempt = attempts.get(candidate) || 0;

      if (attempt < 2) {
        attempts.set(candidate, attempt + 1);
        queueCandidate(candidate);
      } else {
        // Normal message veya yeterince hydrate olmadı.
        // Normal notification zaten WebView2 tarafından gelecek.
        seen.add(candidate);
      }

      return;
    }

    reportIncoming(candidate);
  }, 80);
}
    function inspectNode(node) {
  const element = node && node.nodeType === Node.ELEMENT_NODE
    ? node
    : node && node.parentElement;

  if (!element) return;

  const container = element.matches?.('[data-testid="msg-container"]')
    ? element
    : element.closest?.('[data-testid="msg-container"]');

if (container) queueCandidate(container);
  const descendants =
    element.querySelectorAll?.('[data-testid="msg-container"]') || [];

  for (let index = 0; index < descendants.length; index += 1) {
  queueCandidate(descendants[index]);
}
}

    function arm() {
      if (!document.body) {
        window.setTimeout(arm, 500);
        return;
      }
      const existing = document.querySelectorAll('[data-testid="msg-container"]');
      for (let index = 0; index < existing.length; index += 1) seen.add(existing[index]);
      const observer = new MutationObserver(function (mutations) {
        for (let index = 0; index < mutations.length; index += 1) {
          const mutation = mutations[index];
          if (mutation.type === 'characterData') inspectNode(mutation.target);
          for (let addedIndex = 0; addedIndex < mutation.addedNodes.length; addedIndex += 1) {
            inspectNode(mutation.addedNodes[addedIndex]);
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }

    window.setTimeout(arm, 300);
  }

  if (canReportSitePointerDown) installInstagramAvatarObserver();
  if (canReportSitePointerDown) installInstagramPersistentNotificationObserver();
  if (canReportSitePointerDown) installInstagramMessageObserver();
  if (canReportSitePointerDown) installWhatsAppMessageObserver();

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

    fn is_safe_external_uri(uri: &str) -> bool {
        if uri.is_empty() || uri.len() > 32_768 || uri.contains('\0') {
            return false;
        }
        let Ok(parsed) = url::Url::parse(uri) else {
            return false;
        };
        !matches!(
            parsed.scheme().to_ascii_lowercase().as_str(),
            "http"
                | "https"
                | "file"
                | "data"
                | "javascript"
                | "vbscript"
                | "about"
                | "blob"
                | "filesystem"
        )
    }

    fn launch_external_uri(uri: &str) -> Result<(), String> {
        if !is_safe_external_uri(uri) {
            return Err("external URI scheme is not allowed".to_string());
        }

        let operation: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let target: Vec<u16> = uri.encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                None,
                PCWSTR(operation.as_ptr()),
                PCWSTR(target.as_ptr()),
                None,
                None,
                SW_SHOWNORMAL,
            )
        };
        if result.0 as isize <= 32 {
            return Err(format!(
                "Windows could not open the external application (ShellExecuteW={})",
                result.0 as isize
            ));
        }
        Ok(())
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

    fn screen_capture_origin(args: &ICoreWebView2ScreenCaptureStartingEventArgs) -> String {
        let source = unsafe {
            args.OriginalSourceFrameInfo()
                .ok()
                .map(|frame| take_string(|value| frame.Source(value)))
                .unwrap_or_default()
        };
        url::Url::parse(&source)
            .ok()
            .filter(|url| matches!(url.scheme(), "http" | "https"))
            .map(|url| url.origin().ascii_serialization())
            .unwrap_or_default()
    }

    fn record_screen_capture_transition(
        app: &AppHandle,
        tab_label: &str,
        origin: &str,
        stage: &str,
        status: &str,
        reason: &str,
    ) {
        let log_app = app.clone();
        let tab_label = tab_label.to_string();
        let origin = origin.to_string();
        let stage = stage.to_string();
        let status = status.to_string();
        let reason = reason.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = crate::write_transition_log(
                log_app,
                serde_json::json!({
                "stage": stage,
                "status": status,
                "tabLabel": tab_label,
                "origin": origin,
                "reason": reason,
                "nativePicker": true,
                "runtimeInterface": "ICoreWebView2_27",
                }),
            );
        });
    }

    fn update_screen_capture_state(app: &AppHandle, tab_label: &str, origin: &str, active: bool) {
        let changed = if let Ok(mut states) = SCREEN_CAPTURE_ACTIVE.lock() {
            if active {
                states.insert(tab_label.to_string(), true) != Some(true)
            } else {
                states.remove(tab_label) == Some(true)
            }
        } else {
            false
        };
        if changed {
            record_screen_capture_transition(
                app,
                tab_label,
                origin,
                if active {
                    "screen-capture.active"
                } else {
                    "screen-capture.stopped"
                },
                "ok",
                if active {
                    "display-track-live"
                } else {
                    "display-track-ended"
                },
            );
        }
    }

    fn validated_http_document_source_values(
        message_source: &str,
        top_level_source: &str,
    ) -> Option<(url::Url, String)> {
        let mut message_url = url::Url::parse(message_source).ok()?;
        let mut top_level_url = url::Url::parse(top_level_source).ok()?;
        if !matches!(message_url.scheme(), "http" | "https")
            || !matches!(top_level_url.scheme(), "http" | "https")
        {
            return None;
        }
        message_url.set_fragment(None);
        top_level_url.set_fragment(None);
        if message_url != top_level_url {
            return None;
        }
        let origin = message_url.origin().ascii_serialization();
        Some((message_url, origin))
    }

    pub(crate) unsafe fn validated_web_message_source(
        sender: &ICoreWebView2,
        args: &ICoreWebView2WebMessageReceivedEventArgs,
    ) -> Option<(url::Url, String)> {
        let message_source = take_string(|value| args.Source(value));
        let top_level_source = take_string(|value| sender.Source(value));
        validated_http_document_source_values(&message_source, &top_level_source)
    }

    fn host_label(uri: &str) -> String {
        url::Url::parse(uri)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_string))
            .filter(|host| !host.is_empty())
            .unwrap_or_else(|| "Website".to_string())
    }

    fn is_site_webview_label(label: &str) -> bool {
        label.starts_with("nebula-tab-") || label.starts_with("nebula-popup-content-")
    }

    unsafe fn popup_window_features(
        args: &ICoreWebView2NewWindowRequestedEventArgs,
    ) -> PopupWindowFeaturesPayload {
        let Ok(features) = args.WindowFeatures() else {
            return PopupWindowFeaturesPayload {
                is_popup: false,
                has_position: false,
                has_size: false,
                left: 0,
                top: 0,
                width: 0,
                height: 0,
            };
        };

        let mut has_position = windows_core::BOOL::default();
        let mut has_size = windows_core::BOOL::default();
        let mut should_display_toolbar = windows_core::BOOL::default();
        let _ = features.HasPosition(&mut has_position);
        let _ = features.HasSize(&mut has_size);
        let has_popup_disposition = features
            .ShouldDisplayToolbar(&mut should_display_toolbar)
            .is_ok();

        let mut left = 0u32;
        let mut top = 0u32;
        let mut width = 0u32;
        let mut height = 0u32;

        if has_position.as_bool() {
            let _ = features.Left(&mut left);
            let _ = features.Top(&mut top);
        }
        if has_size.as_bool() {
            let _ = features.Width(&mut width);
            let _ = features.Height(&mut height);
        }

        PopupWindowFeaturesPayload {
            // WebView2 98+ reports all browser chrome flags as false when the
            // requested surface is expected to be a popup, and true otherwise.
            // Explicit geometry is the safe fallback for older runtimes.
            is_popup: if has_popup_disposition {
                !should_display_toolbar.as_bool()
            } else {
                has_position.as_bool() || has_size.as_bool()
            },
            has_position: has_position.as_bool(),
            has_size: has_size.as_bool(),
            left,
            top,
            width,
            height,
        }
    }

    unsafe fn webview_private_mode(core: &ICoreWebView2) -> bool {
        let Ok(core13) = core.cast::<ICoreWebView2_13>() else {
            return false;
        };
        let Ok(profile) = core13.Profile() else {
            return false;
        };
        let mut private_mode = windows_core::BOOL::default();
        profile.IsInPrivateModeEnabled(&mut private_mode).is_ok() && private_mode.as_bool()
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
            13 => "persistent-storage",
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

    fn cancel_popup_request(request: PendingPopup) {
        unsafe {
            let _ = request.args.SetHandled(true);
            let _ = request.deferral.Complete();
        }
    }

    fn remove_and_cancel_pending_popup(request_id: &str) -> Option<String> {
        PENDING_POPUPS.with(|pending| {
            pending.borrow_mut().remove(request_id).map(|request| {
                let opener_label = request.opener_label.clone();
                cancel_popup_request(request);
                opener_label
            })
        })
    }

    fn expire_popup_request(request_id: &str) {
        let _ = remove_and_cancel_pending_popup(request_id);
    }

    fn schedule_popup_timeout(app: &AppHandle, request_id: String) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(POPUP_REQUEST_TIMEOUT).await;
            let _ = app.run_on_main_thread(move || {
                expire_popup_request(&request_id);
            });
        });
    }

    fn enqueue_popup_request(app: &AppHandle, payload: NewWindowPayload, request: PendingPopup) {
        let request_id = payload.request_id.clone();
        let opener_label = request.opener_label.clone();
        let inserted = PENDING_POPUPS.with(|pending| {
            let mut pending = pending.borrow_mut();
            if !has_pending_capacity(
                pending
                    .values()
                    .map(|request| request.opener_label.as_str()),
                &opener_label,
                MAX_PENDING_POPUPS_PER_TAB,
            ) {
                return Err(request);
            }
            pending.insert(request_id.clone(), request);
            Ok(())
        });

        if let Err(request) = inserted {
            cancel_popup_request(request);
            return;
        }

        if app.emit(SITE_NEW_WINDOW_EVENT, payload).is_err() {
            let _ = remove_and_cancel_pending_popup(&request_id);
            return;
        }

        schedule_popup_timeout(app, request_id);
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

    pub fn setup_main_permission_ui(app: &AppHandle, label: &str) -> Result<(), String> {
        if label != "main" && !label.starts_with("nebula-window-") {
            return Err("permission UI is limited to Nebula browser windows".to_string());
        }
        {
            let configured = MAIN_PERMISSION_UI_CONFIGURED
                .lock()
                .map_err(|error| error.to_string())?;

            if configured.contains(label) {
                return Ok(());
            }
        }

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;

        let permission_app = app.clone();
        let permission_label = label.to_string();
        let handler_label = label.to_string();

        webview
            .with_webview(move |inner| unsafe {
                let result = (|| -> windows_core::Result<MainPermissionUiHandler> {
                    let core = inner.controller().CoreWebView2()?;
                    let request_app = permission_app.clone();

                    let permission =
                        PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                            let Some(args) = args else { return Ok(()) };
                            let uri = take_string(|value| args.Uri(value));
                            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();

                            if args.PermissionKind(&mut kind).is_err() {
                                args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
                                return Ok(());
                            }

                            let mut initiated = windows_core::BOOL::default();
                            let _ = args.IsUserInitiated(&mut initiated);

                            request_permission(
                                &request_app,
                                &permission_label,
                                args,
                                uri,
                                kind,
                                initiated.as_bool(),
                            )
                        }));

                    let mut token = 0i64;
                    core.add_PermissionRequested(&permission, &mut token)?;

                    Ok(MainPermissionUiHandler {
                        _permission: permission,
                        _token: token,
                    })
                })();

                match result {
                    Ok(handler) => {
                        MAIN_PERMISSION_UI_HANDLERS.with(|handlers| {
                            handlers.borrow_mut().insert(handler_label.clone(), handler);
                        });

                        if let Ok(mut configured) = MAIN_PERMISSION_UI_CONFIGURED.lock() {
                            configured.insert(handler_label.clone());
                        }
                    }
                    Err(_error) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[nebula site ui] main permission UI: {_error}");
                    }
                }
            })
            .map_err(|error| error.to_string())?;

        if MAIN_PERMISSION_UI_CONFIGURED
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            Ok(())
        } else {
            Err("failed to configure permission UI for main webview".to_string())
        }
    }

    pub fn setup(app: &AppHandle, label: &str) -> Result<(), String> {
        if !is_site_webview_label(label) {
            return Err(
                "site UI handlers are limited to browser tabs and popup content".to_string(),
            );
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
                        WebMessageReceivedEventHandler::create(Box::new(move |sender, args| {
                            let Some(sender) = sender else { return Ok(()) };
                            let Some(args) = args else { return Ok(()) };
                            let Some((source_url, source_origin)) =
                                validated_web_message_source(&sender, &args)
                            else {
                                return Ok(());
                            };
                            let raw = take_string(|value| args.TryGetWebMessageAsString(value));
                            let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
                                return Ok(());
                            };

                            if value.get("type").and_then(serde_json::Value::as_str)
                                == Some("nebula-force-dark-status")
                            {
                                let claimed_origin = value
                                    .get("origin")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let mode = value
                                    .get("mode")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                if claimed_origin == source_origin
                                    && matches!(mode, "off" | "native" | "algorithm")
                                {
                                    let media_protected = value
                                        .get("mediaProtected")
                                        .and_then(serde_json::Value::as_bool)
                                        .unwrap_or(false);
                                    let mutation_observed = value
                                        .get("mutationObserved")
                                        .and_then(serde_json::Value::as_bool)
                                        .unwrap_or(false);
                                    let theme_reason = value
                                        .get("themeReason")
                                        .and_then(serde_json::Value::as_str)
                                        .filter(|reason| {
                                            matches!(
                                                *reason,
                                                "uniform-dark"
                                                    | "visible-light-surfaces"
                                                    | "insufficient-dark-coverage"
                                                    | "algorithm-already-active"
                                            )
                                        })
                                        .map(str::to_string);
                                    let dark_sample_ratio = value
                                        .get("darkSampleRatio")
                                        .and_then(serde_json::Value::as_f64)
                                        .filter(|ratio| (0.0..=1.0).contains(ratio));
                                    let light_sample_ratio = value
                                        .get("lightSampleRatio")
                                        .and_then(serde_json::Value::as_f64)
                                        .filter(|ratio| (0.0..=1.0).contains(ratio));
                                    let theme_sample_count = value
                                        .get("themeSampleCount")
                                        .and_then(serde_json::Value::as_u64)
                                        .filter(|count| *count <= 63);
                                    let log_app = protocol_app.clone();
                                    let log_label = protocol_label.clone();
                                    let log_origin = source_origin.clone();
                                    let log_mode = mode.to_string();
                                    tauri::async_runtime::spawn_blocking(move || {
                                        let _ = crate::write_transition_log(
                                            log_app,
                                            serde_json::json!({
                                                "stage": "force-dark.result",
                                                "status": "ok",
                                                "tabLabel": log_label,
                                                "origin": log_origin,
                                                "mode": log_mode,
                                                "mediaProtected": media_protected,
                                                "mutationObserved": mutation_observed,
                                                "themeReason": theme_reason,
                                                "darkSampleRatio": dark_sample_ratio,
                                                "lightSampleRatio": light_sample_ratio,
                                                "themeSampleCount": theme_sample_count,
                                            }),
                                        );
                                    });
                                }
                                return Ok(());
                            }

                            if value.get("type").and_then(serde_json::Value::as_str)
                                == Some("nebula-site-avatar-hint")
                            {
                                let host = source_url.host_str().unwrap_or_default();
                                let claimed_origin = value
                                    .get("origin")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let sender_name = value
                                    .get("senderName")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default()
                                    .trim();
                                let icon_url = value
                                    .get("iconUrl")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default()
                                    .trim();
                                let instagram_source = source_url.scheme() == "https"
                                    && (host.eq_ignore_ascii_case("instagram.com")
                                        || host
                                            .to_ascii_lowercase()
                                            .ends_with(".instagram.com"));
                                if instagram_source
                                    && source_origin == claimed_origin
                                    && !sender_name.is_empty()
                                    && sender_name.chars().count() <= 120
                                    && !icon_url.is_empty()
                                    && icon_url.chars().count() <= 2_048
                                {
                                    crate::notification_broker::remember_sender_avatar(
                                        &protocol_label,
                                        &source_origin,
                                        sender_name,
                                        icon_url,
                                    );
                                }
                                return Ok(());
                            }
                            
                            if value.get("type").and_then(serde_json::Value::as_str)
    == Some("nebula-whatsapp-reply-hint")
{
    let host = source_url.host_str().unwrap_or_default();

    let whatsapp_source =
        source_url.scheme() == "https"
            && host.eq_ignore_ascii_case("web.whatsapp.com");

    let claimed_origin = value
        .get("origin")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();

    let sender_name = value
        .get("senderName")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim();

    let body = value
        .get("body")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .trim();

    if whatsapp_source
        && source_origin == claimed_origin
        && !sender_name.is_empty()
        && sender_name.chars().count() <= 120
        && !body.is_empty()
        && body.chars().count() <= 500
    {
        crate::notification_broker::remember_whatsapp_reply_hint(
            &protocol_label,
            &source_origin,
            sender_name,
            body,
        );
    }

    return Ok(());
}

                            if value.get("type").and_then(serde_json::Value::as_str)
                                == Some("nebula-site-notification-content")
                            {
                                let host = source_url.host_str().unwrap_or_default();
                                let source_has_content_adapter = source_url.scheme() == "https"
                                    && (host.eq_ignore_ascii_case("web.whatsapp.com")
                                        || host.eq_ignore_ascii_case("instagram.com")
                                        || host.to_ascii_lowercase().ends_with(".instagram.com"));
                                let claimed_origin = value
                                    .get("origin")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let title = value
                                    .get("title")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default()
                                    .trim();
                                let body = value
                                    .get("body")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default()
                                    .trim();
                                let adapter = value
                                    .get("adapter")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let is_service_worker_snapshot =
                                    adapter == "service-worker-snapshot";
                                let adapter_is_valid = adapter.is_empty()
                                    || (is_service_worker_snapshot
                                        && (host.eq_ignore_ascii_case("instagram.com")
                                            || host
                                                .to_ascii_lowercase()
                                                .ends_with(".instagram.com")));
                                let icon_url = value
                                    .get("iconUrl")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default()
                                    .trim();
                                let icon_is_valid = icon_url.is_empty()
                                    || url::Url::parse(icon_url).is_ok_and(|url| {
                                        let icon_host = url
                                            .host_str()
                                            .unwrap_or_default()
                                            .to_ascii_lowercase();
                                        url.scheme() == "https"
                                            && (icon_host == "instagram.com"
                                                || icon_host.ends_with(".instagram.com")
                                                || icon_host == "cdninstagram.com"
                                                || icon_host.ends_with(".cdninstagram.com")
                                                || icon_host == "fbcdn.net"
                                                || icon_host.ends_with(".fbcdn.net")
                                                || icon_host == "facebook.com"
                                                || icon_host.ends_with(".facebook.com"))
                                    });
                                let notification_tag = value
                                    .get("notificationTag")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let notification_type = value
                                    .get("notificationType")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let sender_name_hint = value
                                    .get("senderName")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let event_kind_hint = value
                                    .get("eventKind")
                                    .and_then(serde_json::Value::as_str)
                                    .filter(|kind| {
                                        matches!(
                                            *kind,
                                            "message"
                                                | "reply"
                                                | "reaction"
                                                | "mention"
                                                | "live"
                                                | "call"
                                                | "post"
                                        )
                                    })
                                    .unwrap_or_default();
                                let target_url = value
                                    .get("targetUrl")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let replacement_token = value
                                    .get("replacementToken")
                                    .and_then(serde_json::Value::as_str)
                                    .filter(|token| {
                                        !token.is_empty()
                                            && token.len() <= 80
                                            && token.chars().all(|character| {
                                                character.is_ascii_digit() || character == '-'
                                            })
                                    })
                                    .unwrap_or_default();
                                let notification_data = value.get("notificationData").cloned();
                                let timestamp_ms = value
                                    .get("timestampMs")
                                    .and_then(serde_json::Value::as_u64);

                                if source_has_content_adapter
                                    && source_origin == claimed_origin
                                    && adapter_is_valid
                                    && icon_is_valid
                                    && !title.is_empty()
                                    && title.chars().count() <= 80
                                    && !body.is_empty()
                                    && body.chars().count() <= 500
                                    && sender_name_hint.chars().count() <= 120
                                    && crate::tab_metadata::notification_should_surface(
                                        &protocol_app,
                                        &protocol_label,
                                    )
                                {
                                    let instagram_dom_message = !is_service_worker_snapshot
                                        && (host.eq_ignore_ascii_case("instagram.com")
                                            || host
                                                .to_ascii_lowercase()
                                                .ends_with(".instagram.com"));
                                    if instagram_dom_message && !sender_name_hint.is_empty() {
                                        let remembered_body = notification_data
                                            .as_ref()
                                            .and_then(|data| data.get("replyText"))
                                            .and_then(serde_json::Value::as_str)
                                            .unwrap_or(body);
                                        crate::notification_broker::remember_sender_message(
                                            &protocol_label,
                                            &source_origin,
                                            sender_name_hint,
                                            remembered_body,
                                        );
                                        if !icon_url.is_empty() {
                                            crate::notification_broker::remember_sender_avatar(
                                                &protocol_label,
                                                &source_origin,
                                                sender_name_hint,
                                                icon_url,
                                            );
                                        }
                                    }
                                    let upgrade_persistent_notification =
                                        is_service_worker_snapshot
                                            && !replacement_token.is_empty()
                                            && crate::notification_broker::permission_allows_rich_content(
                                                crate::notification_broker::NotificationSource::ContentAdapter,
                                                &protocol_label,
                                                &source_origin,
                                            );
                                    crate::notification_broker::submit(
                                        &protocol_app,
                                        crate::notification_broker::NotificationSource::ContentAdapter,
                                        crate::notification_broker::NotificationCandidate {
                                            tab_label: protocol_label.clone(),
                                            origin: source_origin.clone(),
                                            title: title.to_string(),
                                            body: body.to_string(),
                                            icon_url: icon_url.to_string(),
                                            adapter_kind: Some(if is_service_worker_snapshot {
                                                crate::notification_broker::ContentAdapterKind::ServiceWorkerSnapshot
                                            } else {
                                                crate::notification_broker::ContentAdapterKind::Dom
                                            }),
                                            notification_tag: notification_tag.to_string(),
                                            notification_type: notification_type.to_string(),
                                            sender_name_hint: sender_name_hint.to_string(),
                                            event_kind_hint: event_kind_hint.to_string(),
                                            target_url: target_url.to_string(),
                                            notification_data,
                                            timestamp_ms,
                                            // The page adapter updates persistent notifications in
                                            // place using the original tag. The broker adds the same
                                            // event to Nebula's center without creating a second toast.
                                            show_native_toast: !is_service_worker_snapshot,
                                        },
                                    );
                                    if upgrade_persistent_notification {
                                        let response = serde_json::json!({
                                            "type": "nebula-upgrade-persistent-notification",
                                            "token": replacement_token,
                                        })
                                        .to_string();
                                        let _ = sender.PostWebMessageAsJson(&HSTRING::from(response));
                                    }
                                }
                                return Ok(());
                            }

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

                            if value.get("type").and_then(serde_json::Value::as_str)
                                == Some("nebula-print-request")
                            {
                                let title = value
                                    .get("title")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let url = value
                                    .get("url")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let url_matches_source = url::Url::parse(url).ok().is_some_and(
                                    |url| url.origin().ascii_serialization() == source_origin,
                                );
                                if title.len() <= 1024 && url.len() <= 8192 && url_matches_source {
                                    let _ = protocol_app.emit(
                                        SITE_PRINT_REQUEST_EVENT,
                                        serde_json::json!({
                                            "tabLabel": protocol_label.clone(),
                                            "title": title,
                                            "url": url,
                                        }),
                                    );
                                }
                                return Ok(());
                            }

                            if value.get("type").and_then(serde_json::Value::as_str)
                                == Some("nebula-sensitive-feature-usage")
                            {
                                let claimed_origin = value
                                    .get("origin")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                let camera = value
                                    .get("camera")
                                    .and_then(serde_json::Value::as_bool);
                                let microphone = value
                                    .get("microphone")
                                    .and_then(serde_json::Value::as_bool);
                                let location = value
                                    .get("location")
                                    .and_then(serde_json::Value::as_bool);
                                let screen = value
                                    .get("screen")
                                    .and_then(serde_json::Value::as_bool);
                                if claimed_origin == source_origin {
                                    if let (
                                        Some(camera),
                                        Some(microphone),
                                        Some(location),
                                        Some(screen),
                                    ) = (camera, microphone, location, screen)
                                    {
                                        update_screen_capture_state(
                                            &protocol_app,
                                            &protocol_label,
                                            &source_origin,
                                            screen,
                                        );
                                        let _ = protocol_app.emit(
                                            SENSITIVE_FEATURE_USAGE_EVENT,
                                            SensitiveFeatureUsagePayload {
                                                tab_label: protocol_label.clone(),
                                                origin: source_origin.clone(),
                                                camera,
                                                microphone,
                                                location,
                                                screen,
                                            },
                                        );
                                    }
                                }
                                return Ok(());
                            }

                            if value.get("type").and_then(serde_json::Value::as_str)
                                == Some("nebula-zoom-request")
                            {
                                let action = value
                                    .get("action")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or_default();
                                if matches!(action, "in" | "out") {
                                    let _ = protocol_app.emit(
                                        SITE_ZOOM_REQUEST_EVENT,
                                        serde_json::json!({
                                            "tabLabel": protocol_label.clone(),
                                            "action": action,
                                        }),
                                    );
                                }
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
                                let claimed_url_matches_source = url::Url::parse(url)
                                    .ok()
                                    .is_some_and(|url| {
                                        url.origin().ascii_serialization() == source_origin
                                    });
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

                                if origin == source_origin
                                    && claimed_url_matches_source
                                    && lengths_ok
                                    && payload_ok
                                {
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
                            if url::Url::parse(&origin)
                                .ok()
                                .map(|url| url.origin().ascii_serialization())
                                .as_deref()
                                != Some(source_origin.as_str())
                            {
                                return Ok(());
                            }
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
                                crate::tab_error_page::note_external_uri_navigation(
                                    &external_label,
                                );
                                if !is_safe_external_uri(&external_uri) {
                                    deferral.Complete()?;
                                    return Ok(());
                                }
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
                                        message: external_uri.clone(),
                                        default_text: String::new(),
                                        dialog_kind: None,
                                        permission_kind: Some(scheme),
                                        challenge: None,
                                        is_user_initiated: initiated.as_bool(),
                                    },
                                    PendingRequest::ExternalUri {
                                        tab_label: external_label.clone(),
                                        uri: external_uri,
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

                    // Observe getDisplayMedia without taking ownership of the picker. Leaving
                    // Cancel and Handled untouched delegates selection and cancellation to the
                    // native WebView2/Windows screen-capture UI.
                    let mut screen_capture_handler = None;
                    let mut screen_capture_token = None;
                    match core.cast::<ICoreWebView2_27>() {
                        Ok(core27) => {
                            let capture_app = app_for_handlers.clone();
                            let capture_label = label_for_handlers.clone();
                            let handler = ScreenCaptureStartingEventHandler::create(Box::new(
                                move |_, args| {
                                    let Some(args) = args else { return Ok(()) };
                                    let origin = screen_capture_origin(&args);
                                    record_screen_capture_transition(
                                        &capture_app,
                                        &capture_label,
                                        &origin,
                                        "screen-capture.request",
                                        "info",
                                        "native-picker-delegated",
                                    );
                                    Ok(())
                                },
                            ));
                            let mut token = 0i64;
                            match core27.add_ScreenCaptureStarting(&handler, &mut token) {
                                Ok(()) => {
                                    screen_capture_token = Some(token);
                                    screen_capture_handler = Some(handler);
                                }
                                Err(error) => record_screen_capture_transition(
                                    &app_for_handlers,
                                    &label_for_handlers,
                                    "",
                                    "screen-capture.interface",
                                    "error",
                                    &format!("event-registration-failed: {error}"),
                                ),
                            }
                        }
                        Err(error) => record_screen_capture_transition(
                            &app_for_handlers,
                            &label_for_handlers,
                            "",
                            "screen-capture.interface",
                            "unsupported",
                            &format!("interface-unavailable: {error}"),
                        ),
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
                    let new_window_private_mode = webview_private_mode(&core);
                    let new_window =
                        NewWindowRequestedEventHandler::create(Box::new(move |_, args| {
                            let Some(args) = args else { return Ok(()) };
                            let deferral = args.GetDeferral()?;
                            let uri = take_string(|value| args.Uri(value));
                            let mut initiated = windows_core::BOOL::default();
                            let _ = args.IsUserInitiated(&mut initiated);
                            let features = popup_window_features(&args);
                            let request_id = next_request_id("popup");
                            let payload = NewWindowPayload {
                                request_id: request_id.clone(),
                                tab_label: new_window_label.clone(),
                                uri,
                                user_initiated: initiated.as_bool(),
                                private_mode: new_window_private_mode,
                                features,
                            };

                            if payload.features.is_popup {
                                enqueue_popup_request(
                                    &new_window_app,
                                    payload,
                                    PendingPopup {
                                        opener_label: new_window_label.clone(),
                                        args,
                                        deferral,
                                    },
                                );
                            } else {
                                // A normal target=_blank/new-window request belongs in
                                // Nebula's tab strip. Cancel WebView2's unmanaged window
                                // and let the shell create the tab from the requested URI.
                                args.SetHandled(true)?;
                                deferral.Complete()?;
                                let _ = new_window_app.emit(SITE_NEW_WINDOW_EVENT, payload);
                            }
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
                            screen_capture: screen_capture_token,
                        },
                        Handlers {
                            _script_dialog: script_dialog,
                            _basic_auth: basic_auth_handler,
                            _new_window: new_window,
                            _window_close: window_close,
                            _web_message: web_message,
                            _external_uri: external_uri_handler,
                            _screen_capture: screen_capture_handler,
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
                    Err(_error) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[nebula site ui] {}: {}", label_for_handlers, _error);
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

    pub fn attach_popup(
        app: AppHandle,
        request_id: String,
        popup_label: String,
    ) -> Result<(), String> {
        if !popup_label.starts_with("nebula-popup-content-") {
            return Err("popup target label is not allowed".to_string());
        }

        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let app_for_main = app.clone();

        app.run_on_main_thread(move || {
            let Some(webview) = app_for_main.get_webview(&popup_label) else {
                let _ = remove_and_cancel_pending_popup(&request_id);
                let _ = tx.send(Err(format!("webview '{popup_label}' not found")));
                return;
            };

            let callback_request_id = request_id.clone();
            let callback_tx = tx.clone();
            let queued = webview.with_webview(move |inner| {
                let result = PENDING_POPUPS.with(|pending| {
                    let request = pending
                        .borrow_mut()
                        .remove(&callback_request_id)
                        .ok_or_else(|| {
                            format!("popup request '{callback_request_id}' is no longer pending")
                        })?;

                    let attach_result = unsafe {
                        (|| -> Result<(), String> {
                            let core = inner
                                .controller()
                                .CoreWebView2()
                                .map_err(|error| error.to_string())?;
                            request
                                .args
                                .SetNewWindow(&core)
                                .map_err(|error| error.to_string())?;
                            request
                                .args
                                .SetHandled(true)
                                .map_err(|error| error.to_string())?;
                            request
                                .deferral
                                .Complete()
                                .map_err(|error| error.to_string())?;
                            Ok(())
                        })()
                    };

                    if attach_result.is_err() {
                        cancel_popup_request(request);
                    }

                    attach_result
                });

                let _ = callback_tx.send(result);
            });

            if let Err(error) = queued {
                let _ = remove_and_cancel_pending_popup(&request_id);
                let _ = tx.send(Err(error.to_string()));
            }
        })
        .map_err(|error| error.to_string())?;

        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "timed out attaching popup webview".to_string())?
    }

    pub fn cancel_popup(app: AppHandle, request_id: String) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let _ = remove_and_cancel_pending_popup(&request_id);
            let _ = tx.send(Ok(()));
        })
        .map_err(|error| error.to_string())?;

        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| "timed out cancelling popup request".to_string())?
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

                let mut external_uri_to_launch = None;
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
                            PendingRequest::ExternalUri {
                                uri,
                                args,
                                deferral,
                                ..
                            } => {
                                // Keep WebView2 cancelled so its Edge-branded
                                // confirmation dialog never appears. After the
                                // user accepts Nebula's prompt, launch the exact
                                // URI captured from the native event ourselves.
                                args.SetCancel(true)?;
                                deferral.Complete()?;
                                if response.accepted {
                                    external_uri_to_launch = Some(uri);
                                }
                            }
                        }
                        Ok(())
                    })()
                };
                native_result.map_err(|error| error.to_string())?;
                if let Some(uri) = external_uri_to_launch {
                    launch_external_uri(&uri)?;
                }
                Ok(())
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

            let popup_ids = PENDING_POPUPS.with(|pending| {
                pending
                    .borrow()
                    .iter()
                    .filter(|(_, request)| request.opener_label == label)
                    .map(|(id, _)| id.clone())
                    .collect::<Vec<_>>()
            });
            for id in popup_ids {
                let _ = remove_and_cancel_pending_popup(&id);
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
                    if let (Some(token), Ok(core27)) =
                        (tokens.screen_capture, core.cast::<ICoreWebView2_27>())
                    {
                        let _ = core27.remove_ScreenCaptureStarting(token);
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
        let capture_was_active = SCREEN_CAPTURE_ACTIVE
            .lock()
            .ok()
            .and_then(|mut states| states.remove(label))
            == Some(true);
        if capture_was_active {
            record_screen_capture_transition(
                app,
                label,
                "",
                "screen-capture.stopped",
                "ok",
                "source-tab-closed",
            );
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

        #[test]
        fn web_messages_require_the_exact_top_level_http_document() {
            let validated = validated_http_document_source_values(
                "https://example.com/account#message",
                "https://example.com/account#current",
            )
            .expect("same document should be accepted");
            assert_eq!(validated.1, "https://example.com");

            assert!(validated_http_document_source_values(
                "https://example.com/embedded",
                "https://example.com/account",
            )
            .is_none());
            assert!(validated_http_document_source_values(
                "https://attacker.example/account",
                "https://example.com/account",
            )
            .is_none());
            assert!(validated_http_document_source_values(
                "data:text/html,opaque",
                "data:text/html,opaque",
            )
            .is_none());
        }

        #[test]
        fn external_uri_launcher_rejects_web_and_unsafe_schemes() {
            assert!(is_safe_external_uri("whatsapp://send?phone=905551112233"));
            assert!(is_safe_external_uri("mailto:hello@example.com"));
            assert!(!is_safe_external_uri("https://example.com"));
            assert!(!is_safe_external_uri(
                "file:///C:/Windows/System32/calc.exe"
            ));
            assert!(!is_safe_external_uri("javascript:alert(1)"));
            assert!(!is_safe_external_uri("not a URI"));
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) use imp::validated_web_message_source;
#[cfg(target_os = "windows")]
pub use imp::{
    attach_popup, cancel_popup, request_permission, respond, setup, setup_main_permission_ui,
    teardown, SiteUiResponse,
};

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
pub fn setup_main_permission_ui(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown(_app: &tauri::AppHandle, _label: &str) {}

#[cfg(not(target_os = "windows"))]
pub fn attach_popup(
    _app: tauri::AppHandle,
    _request_id: String,
    _popup_label: String,
) -> Result<(), String> {
    Err("popup windows are currently supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn cancel_popup(_app: tauri::AppHandle, _request_id: String) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn respond(
    _app: tauri::AppHandle,
    _request_id: String,
    _response: SiteUiResponse,
) -> Result<(), String> {
    Ok(())
}
