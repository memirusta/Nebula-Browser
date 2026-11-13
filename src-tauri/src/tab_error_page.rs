/// The colours of the interface (the theme and the palette) for the page a failed navigation shows. The window sends them whenever
/// they change; a colour is only taken if it is a short value made of the characters a colour is written with.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorPageTheme {
    pub dark: bool,
    pub base: String,
    pub text: String,
    pub muted: String,
    pub border: String,
    pub surface: String,
    pub accent: String,
    pub strong: String,
    pub on: String,
}

impl Default for ErrorPageTheme {
    /// The dark theme with its cyan accent, until the window has said otherwise.
    fn default() -> Self {
        Self {
            dark: true,
            base: "#09090b".into(),
            text: "#f4f4f5".into(),
            muted: "#a1a1aa".into(),
            border: "rgba(255, 255, 255, 0.13)".into(),
            surface: "rgba(255, 255, 255, 0.07)".into(),
            accent: "#7ec8e3".into(),
            strong: "#4fa6c4".into(),
            on: "#0b0f1a".into(),
        }
    }
}

impl ErrorPageTheme {
    fn is_colour(value: &str) -> bool {
        !value.is_empty()
            && value.len() <= 120
            && value.chars().all(|c| {
                c.is_ascii_alphanumeric()
                    || matches!(c, '#' | '(' | ')' | ',' | '.' | '%' | ' ' | '/' | '-')
            })
    }

    /// The same theme with every colour that is not a plain colour replaced by the default one.
    pub fn sanitized(&self) -> Self {
        let fallback = Self::default();
        let pick = |value: &String, default: &String| {
            if Self::is_colour(value) {
                value.clone()
            } else {
                default.clone()
            }
        };
        Self {
            dark: self.dark,
            base: pick(&self.base, &fallback.base),
            text: pick(&self.text, &fallback.text),
            muted: pick(&self.muted, &fallback.muted),
            border: pick(&self.border, &fallback.border),
            surface: pick(&self.surface, &fallback.surface),
            accent: pick(&self.accent, &fallback.accent),
            strong: pick(&self.strong, &fallback.strong),
            on: pick(&self.on, &fallback.on),
        }
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::hash_map::RandomState;
    use std::collections::{HashMap, VecDeque};
    use std::hash::{BuildHasher, Hasher};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2NavigationCompletedEventArgs2,
        ICoreWebView2NavigationCompletedEventHandler, ICoreWebView2WebMessageReceivedEventHandler,
        COREWEBVIEW2_WEB_ERROR_STATUS, COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
        COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS,
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET, COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED,
        COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE,
        COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
        COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
        COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED,
        COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE, COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT,
        COREWEBVIEW2_WEB_ERROR_STATUS_UNEXPECTED_ERROR, COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN,
        COREWEBVIEW2_WEB_ERROR_STATUS_VALID_AUTHENTICATION_CREDENTIALS_REQUIRED,
        COREWEBVIEW2_WEB_ERROR_STATUS_VALID_PROXY_AUTHENTICATION_REQUIRED,
    };
    use webview2_com::{NavigationCompletedEventHandler, WebMessageReceivedEventHandler};
    use windows::core::PCWSTR;
    use windows::core::PWSTR;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows_core::{Interface, BOOL};

    static HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static VERIFICATION_STATES: LazyLock<Mutex<HashMap<String, VerificationState>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static EXTERNAL_URI_NAVIGATIONS: LazyLock<Mutex<HashMap<String, ExternalUriNavigationState>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static UI_LOCALE: LazyLock<Mutex<String>> = LazyLock::new(|| Mutex::new("en".to_string()));
    static THEME: LazyLock<Mutex<super::ErrorPageTheme>> =
        LazyLock::new(|| Mutex::new(super::ErrorPageTheme::default()));
    /// The error pages that offer "try with protections off": each has a code of its own that only that page knows, and what it
    /// was for (the address that failed and why). The page's button sends the code back; the address is taken from here, never
    /// from the message.
    static COMPAT_PAGES: LazyLock<Mutex<VecDeque<CompatPage>>> =
        LazyLock::new(|| Mutex::new(VecDeque::new()));
    static COMPAT_PAGE_COUNTER: AtomicU64 = AtomicU64::new(1);
    static MESSAGE_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    const MAX_COMPAT_PAGES: usize = 32;
    thread_local! {
        static HANDLERS: RefCell<HashMap<String, ICoreWebView2NavigationCompletedEventHandler>> =
            RefCell::new(HashMap::new());
        static MESSAGE_HANDLERS: RefCell<HashMap<String, ICoreWebView2WebMessageReceivedEventHandler>> =
            RefCell::new(HashMap::new());
    }

    struct CompatPage {
        code: String,
        url: String,
        status: i32,
    }

    /// A code for a new error page: unpredictable (a hasher seeded at random for this process) and different every time.
    fn new_compat_code() -> String {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(COMPAT_PAGE_COUNTER.fetch_add(1, Ordering::Relaxed));
        format!("{:016x}", hasher.finish())
    }

    fn register_compat_page(url: &str, status: COREWEBVIEW2_WEB_ERROR_STATUS) -> String {
        let code = new_compat_code();
        if let Ok(mut pages) = COMPAT_PAGES.lock() {
            pages.push_back(CompatPage {
                code: code.clone(),
                url: url.to_string(),
                status: status.0,
            });
            while pages.len() > MAX_COMPAT_PAGES {
                pages.pop_front();
            }
        }
        code
    }

    fn compat_page_for(code: &str) -> Option<(String, COREWEBVIEW2_WEB_ERROR_STATUS)> {
        let pages = COMPAT_PAGES.lock().ok()?;
        pages
            .iter()
            .find(|page| page.code == code)
            .map(|page| (page.url.clone(), COREWEBVIEW2_WEB_ERROR_STATUS(page.status)))
    }

    /// What the page's button said: only a message with the code of a page Nebula built counts, and it asks for the retry of
    /// the address that page was built for.
    fn handle_compat_message(app: &AppHandle, label: &str, raw: &str) {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
            return;
        };
        if value.get("type").and_then(serde_json::Value::as_str) != Some("nebula-compat-retry") {
            return;
        }
        let code = value
            .get("code")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        let Some((url, status)) = compat_page_for(code) else {
            return;
        };
        emit_compatibility_request(app, label, &url, status);
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
            CoTaskMemFree(Some(value.as_ptr().cast()));
        }
        text
    }

    struct VerificationState {
        last_seen: Instant,
        retry_count: u8,
    }

    struct ExternalUriNavigationState {
        last_seen: Instant,
        pending_completions: u8,
    }

    const VERIFICATION_WINDOW: Duration = Duration::from_secs(45);
    const MAX_VERIFICATION_RETRIES: u8 = 2;
    const DOWNLOAD_ABORT_GRACE: Duration = Duration::from_millis(900);
    const EXTERNAL_URI_NAVIGATION_WINDOW: Duration = Duration::from_secs(5);
    const COMPATIBILITY_REQUEST_EVENT: &str = "nebula-site-compatibility-request";

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CompatibilityRequestPayload {
        tab_label: String,
        url: String,
        error_status: String,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    enum ErrorKind {
        Certificate,
        NameNotResolved,
        TimedOut,
        Authentication,
        ServerResponse,
        Network,
        Unexpected,
    }

    pub fn set_ui_locale(locale: &str) {
        let normalized = match locale.to_ascii_lowercase().as_str() {
            "tr" => "tr",
            "es" => "es",
            "de" => "de",
            "fr" => "fr",
            "id" => "id",
            "ru" => "ru",
            "it" => "it",
            "ja" => "ja",
            _ => "en",
        };
        if let Ok(mut current) = UI_LOCALE.lock() {
            *current = normalized.to_string();
        }
    }

    pub fn set_theme(theme: &super::ErrorPageTheme) {
        if let Ok(mut current) = THEME.lock() {
            *current = theme.sanitized();
        }
    }

    fn current_theme() -> super::ErrorPageTheme {
        THEME.lock().map(|theme| theme.clone()).unwrap_or_default()
    }

    pub fn current_ui_locale() -> String {
        UI_LOCALE
            .lock()
            .map(|locale| locale.clone())
            .unwrap_or_else(|_| "en".to_string())
    }

    pub fn notification_activity_body() -> String {
        match current_ui_locale().as_str() {
            "tr" => "Yeni bir mesajın veya bildirimin var.".to_string(),
            "es" => "Tienes un mensaje o una notificación nuevos.".to_string(),
            "de" => "Du hast eine neue Nachricht oder Benachrichtigung.".to_string(),
            "fr" => "Vous avez un nouveau message ou une nouvelle notification.".to_string(),
            "id" => "Anda memiliki pesan atau notifikasi baru.".to_string(),
            "ru" => "У вас новое сообщение или уведомление.".to_string(),
            "it" => "Hai un nuovo messaggio o una nuova notifica.".to_string(),
            "ja" => "新しいメッセージまたは通知があります。".to_string(),
            _ => "You have a new message or notification.".to_string(),
        }
    }

    pub(crate) fn note_browser_verification_request(label: &str) {
        let now = Instant::now();
        if let Ok(mut states) = VERIFICATION_STATES.lock() {
            let state = states
                .entry(label.to_string())
                .or_insert(VerificationState {
                    last_seen: now,
                    retry_count: 0,
                });
            if now.duration_since(state.last_seen) > VERIFICATION_WINDOW {
                state.retry_count = 0;
            }
            state.last_seen = now;
        }
    }

    pub(crate) fn note_external_uri_navigation(label: &str) {
        let now = Instant::now();
        if let Ok(mut navigations) = EXTERNAL_URI_NAVIGATIONS.lock() {
            let state =
                navigations
                    .entry(label.to_string())
                    .or_insert(ExternalUriNavigationState {
                        last_seen: now,
                        pending_completions: 0,
                    });
            if now.duration_since(state.last_seen) > EXTERNAL_URI_NAVIGATION_WINDOW {
                state.pending_completions = 0;
            }
            state.last_seen = now;
            state.pending_completions = state.pending_completions.saturating_add(1);
        }
    }

    fn claim_external_uri_navigation(label: &str) -> bool {
        let now = Instant::now();
        let Ok(mut navigations) = EXTERNAL_URI_NAVIGATIONS.lock() else {
            return false;
        };
        let Some(state) = navigations.get_mut(label) else {
            return false;
        };
        if now.duration_since(state.last_seen) > EXTERNAL_URI_NAVIGATION_WINDOW
            || state.pending_completions == 0
        {
            navigations.remove(label);
            return false;
        }
        state.pending_completions -= 1;
        if state.pending_completions == 0 {
            navigations.remove(label);
        }
        true
    }

    fn claim_browser_verification_retry(label: &str) -> Option<Duration> {
        let now = Instant::now();
        let mut states = VERIFICATION_STATES.lock().ok()?;
        let state = states.get_mut(label)?;
        if now.duration_since(state.last_seen) > VERIFICATION_WINDOW
            || state.retry_count >= MAX_VERIFICATION_RETRIES
        {
            return None;
        }
        state.retry_count += 1;
        Some(Duration::from_millis(700 * u64::from(state.retry_count)))
    }

    fn data_url_for_html(html: &str) -> String {
        let encoded: String = html
            .bytes()
            .map(|byte| match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                    (byte as char).to_string()
                }
                _ => format!("%{byte:02X}"),
            })
            .collect();
        format!("data:text/html;charset=utf-8,{encoded}")
    }

    fn js_string_literal(value: &str) -> String {
        serde_json::to_string(value)
            .unwrap_or_else(|_| "\"\"".to_string())
            .replace('<', "\\u003C")
            .replace('>', "\\u003E")
            .replace('&', "\\u0026")
            .replace('\u{2028}', "\\u2028")
            .replace('\u{2029}', "\\u2029")
    }

    fn read_webview_source(webview: &ICoreWebView2) -> String {
        unsafe {
            let mut uri = PWSTR::null();
            if webview.Source(&mut uri).is_err() {
                return String::new();
            }

            let url = uri.to_string().unwrap_or_default();
            if !uri.is_null() {
                CoTaskMemFree(Some(uri.as_ptr().cast()));
            }
            url
        }
    }

    fn compatibility_request_url(value: &str) -> Option<String> {
        let parsed = url::Url::parse(value).ok()?;
        let host = parsed.host_str()?;
        (matches!(parsed.scheme(), "http" | "https")
            && !crate::network_address::is_local_network_host(host))
        .then(|| parsed.to_string())
    }

    fn web_error_status_name(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> &'static str {
        match status {
            COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN => "COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN",
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT => "COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT",
            COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_UNEXPECTED_ERROR => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_UNEXPECTED_ERROR"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_VALID_AUTHENTICATION_CREDENTIALS_REQUIRED => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_VALID_AUTHENTICATION_CREDENTIALS_REQUIRED"
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_VALID_PROXY_AUTHENTICATION_REQUIRED => {
                "COREWEBVIEW2_WEB_ERROR_STATUS_VALID_PROXY_AUTHENTICATION_REQUIRED"
            }
            _ => "COREWEBVIEW2_WEB_ERROR_STATUS_UNRECOGNIZED",
        }
    }

    fn error_kind(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> ErrorKind {
        match status {
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_COMMON_NAME_IS_INCORRECT
            | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_EXPIRED
            | COREWEBVIEW2_WEB_ERROR_STATUS_CLIENT_CERTIFICATE_CONTAINS_ERRORS
            | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_REVOKED
            | COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID => ErrorKind::Certificate,
            COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED => ErrorKind::NameNotResolved,
            COREWEBVIEW2_WEB_ERROR_STATUS_TIMEOUT => ErrorKind::TimedOut,
            COREWEBVIEW2_WEB_ERROR_STATUS_VALID_AUTHENTICATION_CREDENTIALS_REQUIRED
            | COREWEBVIEW2_WEB_ERROR_STATUS_VALID_PROXY_AUTHENTICATION_REQUIRED => {
                ErrorKind::Authentication
            }
            COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE
            | COREWEBVIEW2_WEB_ERROR_STATUS_REDIRECT_FAILED => ErrorKind::ServerResponse,
            COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE
            | COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED
            | COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET
            | COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED
            | COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT => ErrorKind::Network,
            _ => ErrorKind::Unexpected,
        }
    }

    /// Failures a proxy that cannot be reached can look like: worth saying that an extension is
    /// routing the connection.
    fn may_come_from_a_proxy(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> bool {
        matches!(
            error_kind(status),
            ErrorKind::TimedOut | ErrorKind::Network | ErrorKind::NameNotResolved
        )
    }

    /// After a network-type error page was shown: name an extension that controls the proxy, if any.
    fn offer_proxy_hint(
        app: &AppHandle,
        label: &str,
        status: COREWEBVIEW2_WEB_ERROR_STATUS,
        locale: &str,
    ) {
        if may_come_from_a_proxy(status) {
            crate::proxy_error_hint::offer(app, label, locale);
        }
    }

    /// The failures a site's own protections can cause, so that "turn the protections off for this site" is a
    /// fair thing to offer: a connection that was reset, and a response the page could not use. Everything the
    /// error page words as "This site can't be reached" ("could not connect", "unreachable", "disconnected" and
    /// "connection aborted", which is also what a navigation that a site's own script replaced looks like) gets
    /// the error page and nothing else.
    fn should_offer_compatibility_retry(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> bool {
        matches!(
            status,
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET
                | COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE
        )
    }

    /// Whether Windows says that no network offers internet access (cable out, Wi-Fi off, flight mode). A
    /// site that cannot be reached then says nothing about the site or Nebula's protections. Any doubt counts as
    /// online, so the compatibility offer is only held back when the machine is known to be offline.
    fn internet_unavailable() -> bool {
        use windows::Win32::Networking::NetworkListManager::{
            INetworkListManager, NetworkListManager, NLM_CONNECTIVITY_IPV4_INTERNET,
            NLM_CONNECTIVITY_IPV6_INTERNET,
        };
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
        };

        unsafe {
            // The thread is normally a UI thread with COM already set up; a different mode is not an error here.
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let Ok(manager) =
                CoCreateInstance::<_, INetworkListManager>(&NetworkListManager, None, CLSCTX_ALL)
            else {
                return false;
            };
            let Ok(connectivity) = manager.GetConnectivity() else {
                return false;
            };
            connectivity.0 & (NLM_CONNECTIVITY_IPV4_INTERNET.0 | NLM_CONNECTIVITY_IPV6_INTERNET.0)
                == 0
        }
    }

    /// The compatibility offer ("turn the protections off for this site") only makes sense when the machine is
    /// online and the connection was cut: offline, every site fails the same way.
    fn compatibility_retry_applies(
        status: COREWEBVIEW2_WEB_ERROR_STATUS,
        internet_unavailable: bool,
    ) -> bool {
        should_offer_compatibility_retry(status) && !internet_unavailable
    }

    fn emit_compatibility_request(
        app: &AppHandle,
        label: &str,
        failed_url: &str,
        error_status: COREWEBVIEW2_WEB_ERROR_STATUS,
    ) {
        if !should_offer_compatibility_retry(error_status)
            || !compatibility_retry_applies(error_status, internet_unavailable())
        {
            return;
        }
        let Some(url) = compatibility_request_url(failed_url) else {
            return;
        };
        let _ = app.emit(
            COMPATIBILITY_REQUEST_EVENT,
            CompatibilityRequestPayload {
                tab_label: label.to_string(),
                url,
                error_status: web_error_status_name(error_status).to_string(),
            },
        );
    }

    fn local_http_fallback_url(
        retry_url: &str,
        error_status: COREWEBVIEW2_WEB_ERROR_STATUS,
    ) -> Option<String> {
        if error_kind(error_status) != ErrorKind::Certificate {
            return None;
        }

        let mut parsed = url::Url::parse(retry_url).ok()?;
        if parsed.scheme() != "https"
            || !crate::network_address::is_local_network_host(parsed.host_str()?)
        {
            return None;
        }

        if parsed.port() == Some(443) {
            parsed.set_port(None).ok()?;
        }
        parsed.set_scheme("http").ok()?;
        Some(parsed.to_string())
    }

    /// The sentence under the buttons of a page that offers "try with protections off", the button and its word while it runs.
    fn compat_copy(locale: &str) -> (&'static str, &'static str, &'static str) {
        match locale {
            "tr" => (
                "Bağlantı kesildi ya da kullanılabilir bir yanıt alınamadı. Bu genellikle ağdan ya da sitenin kendisinden kaynaklanır. Site başka tarayıcılarda çalışıyorsa Nebula'nın korumaları sebep olabilir.",
                "Korumalar kapalı dene",
                "Deneniyor…",
            ),
            "es" => (
                "La conexión se cortó o no recibió una respuesta utilizable. Suele deberse a la red o al propio sitio. Si el sitio funciona en otros navegadores, las protecciones de Nebula pueden ser la causa.",
                "Probar sin protecciones",
                "Probando…",
            ),
            "de" => (
                "Die Verbindung wurde getrennt oder lieferte keine brauchbare Antwort. Meist liegt es am Netzwerk oder an der Website selbst. Funktioniert die Website in anderen Browsern, könnten die Schutzfunktionen von Nebula die Ursache sein.",
                "Ohne Schutz versuchen",
                "Wird versucht …",
            ),
            "fr" => (
                "La connexion a été coupée ou n'a reçu aucune réponse exploitable. Cela vient généralement du réseau ou du site lui-même. Si le site fonctionne dans d'autres navigateurs, les protections de Nebula peuvent en être la cause.",
                "Essayer sans protections",
                "Essai en cours…",
            ),
            "id" => (
                "Koneksi terputus atau tidak mendapat jawaban yang dapat dipakai. Biasanya karena jaringan atau situsnya sendiri. Jika situs berfungsi di peramban lain, perlindungan Nebula mungkin penyebabnya.",
                "Coba tanpa perlindungan",
                "Mencoba…",
            ),
            "ru" => (
                "Соединение было прервано или не получило пригодного ответа. Обычно причина в сети или на самом сайте. Если сайт работает в других браузерах, причиной могут быть защиты Nebula.",
                "Попробовать без защиты",
                "Пробуем…",
            ),
            "it" => (
                "La connessione è stata interrotta o non ha ricevuto una risposta utilizzabile. Di solito dipende dalla rete o dal sito stesso. Se il sito funziona in altri browser, la causa potrebbero essere le protezioni di Nebula.",
                "Prova senza protezioni",
                "Provo…",
            ),
            "ja" => (
                "接続が切断されたか、利用できる応答が得られませんでした。通常はネットワークかサイト自体が原因です。他のブラウザーで表示できる場合は、Nebula の保護機能が原因の可能性があります。",
                "保護をオフにして再試行",
                "試行中…",
            ),
            _ => (
                "The connection was cut or got no usable answer. This is usually the network or the site itself. If the site works in other browsers, Nebula's protections may be the cause.",
                "Try with protections off",
                "Trying…",
            ),
        }
    }

    fn error_page_labels(locale: &str) -> (&'static str, &'static str, &'static str) {
        match locale {
            "tr" => ("tr", "Tekrar dene", "HTTP ile dene"),
            "es" => ("es", "Volver a intentarlo", "Probar con HTTP"),
            "de" => ("de", "Erneut versuchen", "HTTP versuchen"),
            "fr" => ("fr", "Réessayer", "Essayer en HTTP"),
            "id" => ("id", "Coba lagi", "Coba HTTP"),
            "ru" => ("ru", "Повторить", "Попробовать HTTP"),
            "it" => ("it", "Riprova", "Prova HTTP"),
            "ja" => ("ja", "再試行", "HTTP で試す"),
            _ => ("en", "Try again", "Try HTTP"),
        }
    }

    fn error_page_copy(locale: &str, kind: ErrorKind) -> (&'static str, &'static str) {
        match locale {
            "tr" => match kind {
                ErrorKind::Certificate => (
                    "Bağlantı güvenli değil",
                    "Bu adresin güvenlik sertifikası geçersiz veya güvenilir değil.",
                ),
                ErrorKind::NameNotResolved => (
                    "Site bulunamadı",
                    "Sunucu adresi bulunamadı. Adresi kontrol edip tekrar deneyin.",
                ),
                ErrorKind::TimedOut => (
                    "Bağlantı zaman aşımına uğradı",
                    "Sunucu zamanında yanıt vermedi. Bir süre sonra tekrar deneyin.",
                ),
                ErrorKind::Authentication => (
                    "Kimlik doğrulama gerekli",
                    "Sunucu veya proxy geçerli oturum bilgileri istiyor.",
                ),
                ErrorKind::ServerResponse => (
                    "Sunucu yanıtı geçersiz",
                    "Sunucu geçersiz bir yanıt veya yönlendirme gönderdi.",
                ),
                ErrorKind::Network => (
                    "Bu siteye ulaşılamıyor",
                    "Sunucuya bağlanılamadı. Adresi ve ağ bağlantısını kontrol edin.",
                ),
                ErrorKind::Unexpected => (
                    "Sayfa yüklenemedi",
                    "Beklenmeyen bir gezinme hatası oluştu. Tekrar deneyin.",
                ),
            },
            "es" => match kind {
                ErrorKind::Certificate => (
                    "La conexión no es privada",
                    "El certificado de seguridad del sitio no es válido o no es de confianza.",
                ),
                _ => (
                    "No se puede acceder a este sitio",
                    "No se pudo establecer la conexión. Comprueba la dirección y vuelve a intentarlo.",
                ),
            },
            "de" => match kind {
                ErrorKind::Certificate => (
                    "Die Verbindung ist nicht privat",
                    "Das Sicherheitszertifikat der Website ist ungültig oder nicht vertrauenswürdig.",
                ),
                _ => (
                    "Diese Website ist nicht erreichbar",
                    "Die Verbindung konnte nicht hergestellt werden. Prüfe die Adresse und versuche es erneut.",
                ),
            },
            "fr" => match kind {
                ErrorKind::Certificate => (
                    "La connexion n’est pas privée",
                    "Le certificat de sécurité du site est invalide ou non approuvé.",
                ),
                _ => (
                    "Ce site est inaccessible",
                    "La connexion n’a pas pu être établie. Vérifiez l’adresse et réessayez.",
                ),
            },
            "id" => match kind {
                ErrorKind::Certificate => (
                    "Koneksi tidak pribadi",
                    "Sertifikat keamanan situs tidak valid atau tidak tepercaya.",
                ),
                _ => (
                    "Situs ini tidak dapat dijangkau",
                    "Koneksi tidak dapat dibuat. Periksa alamat lalu coba lagi.",
                ),
            },
            "ru" => match kind {
                ErrorKind::Certificate => (
                    "Подключение не защищено",
                    "Сертификат безопасности сайта недействителен или ему нельзя доверять.",
                ),
                _ => (
                    "Не удаётся открыть этот сайт",
                    "Не удалось установить соединение. Проверьте адрес и повторите попытку.",
                ),
            },
            "it" => match kind {
                ErrorKind::Certificate => (
                    "La connessione non è privata",
                    "Il certificato di sicurezza del sito non è valido o non è attendibile.",
                ),
                _ => (
                    "Questo sito non è raggiungibile",
                    "Non è stato possibile stabilire la connessione. Controlla l’indirizzo e riprova.",
                ),
            },
            "ja" => match kind {
                ErrorKind::Certificate => (
                    "この接続ではプライバシーが保護されません",
                    "このサイトのセキュリティ証明書は無効か、信頼されていません。",
                ),
                _ => (
                    "このサイトにアクセスできません",
                    "接続できませんでした。アドレスを確認して、もう一度お試しください。",
                ),
            },
            _ => match kind {
                ErrorKind::Certificate => (
                    "Your connection isn't private",
                    "The site's security certificate is invalid or not trusted.",
                ),
                ErrorKind::NameNotResolved => (
                    "This site can't be found",
                    "The server address could not be found. Check the address and try again.",
                ),
                ErrorKind::TimedOut => (
                    "The connection timed out",
                    "The server did not respond in time. Try again later.",
                ),
                ErrorKind::Authentication => (
                    "Authentication required",
                    "The server or proxy requires valid sign-in credentials.",
                ),
                ErrorKind::ServerResponse => (
                    "Invalid server response",
                    "The server returned an invalid response or redirect.",
                ),
                ErrorKind::Network => (
                    "This site can't be reached",
                    "The server could not be reached. Check the address and your network connection.",
                ),
                ErrorKind::Unexpected => (
                    "The page couldn't be loaded",
                    "An unexpected navigation error occurred. Try again.",
                ),
            },
        }
    }

    fn build_error_page_url(
        retry_url: &str,
        error_status: COREWEBVIEW2_WEB_ERROR_STATUS,
        locale: &str,
    ) -> String {
        let nebula_mark = include_str!("../resources/branding/nebula-app-logo-128.base64").trim();
        let retry_js = js_string_literal(retry_url);
        let display_url = retry_url
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;")
            .replace('"', "&quot;")
            .replace('\'', "&#39;");
        let status_name = web_error_status_name(error_status);
        let kind = error_kind(error_status);
        let (lang, retry_label, try_http_label) = error_page_labels(locale);
        let (title, description) = error_page_copy(locale, kind);
        let theme = current_theme();
        let scheme = if theme.dark { "dark" } else { "light" };
        let (base, text, muted, border, surface, accent, strong, on) = (
            theme.base,
            theme.text,
            theme.muted,
            theme.border,
            theme.surface,
            theme.accent,
            theme.strong,
            theme.on,
        );
        // A connection that was cut, or an answer that could not be used, is the only failure Nebula's own protections can cause,
        // so only then does the page offer a retry without them (and never when the machine is offline).
        let offers_compat = compatibility_retry_applies(error_status, internet_unavailable())
            && compatibility_request_url(retry_url).is_some();
        let (compat_hint, compat_button, compat_trying) = compat_copy(locale);
        let compat_code = if offers_compat {
            register_compat_page(retry_url, error_status)
        } else {
            String::new()
        };
        let compat_code_js = js_string_literal(&compat_code);
        let compat_trying_js = js_string_literal(compat_trying);
        let compat_button_html = if offers_compat {
            format!(
                r#"<button type="button" id="try-compat" class="secondary">{compat_button}</button>"#
            )
        } else {
            String::new()
        };
        let compat_hint_html = if offers_compat {
            format!(r#"<p class="hint">{compat_hint}</p>"#)
        } else {
            String::new()
        };
        let http_fallback = local_http_fallback_url(retry_url, error_status);
        let http_fallback_js = js_string_literal(http_fallback.as_deref().unwrap_or_default());
        let http_fallback_button = http_fallback
            .as_ref()
            .map(|_| {
                format!(
                    r#"<button type="button" id="try-http" class="secondary">{try_http_label}</button>"#
                )
            })
            .unwrap_or_default();

        let html = format!(
            r#"<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nebula</title>
<style>
  :root {{
    color-scheme: {scheme};
    --base: {base};
    --text: {text};
    --muted: {muted};
    --border: {border};
    --surface: {surface};
    --accent: {accent};
    --strong: {strong};
    --on: {on};
  }}
  * {{ box-sizing: border-box; margin: 0; }}
  body {{
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: var(--base);
    color: var(--text);
    font: 16px/1.5 "Segoe UI", system-ui, sans-serif;
    padding: 24px;
    text-align: center;
  }}
  .glyph {{
    width: 56px;
    height: 56px;
    margin-bottom: 20px;
    border-radius: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }}
  .glyph img {{ width: 100%; height: 100%; display: block; }}
  h1 {{ font-size: 22px; font-weight: 700; margin-bottom: 8px; letter-spacing: -0.01em; }}
  p {{ color: var(--muted); max-width: 420px; margin-bottom: 24px; }}
  .url {{
    max-width: min(620px, 88vw);
    margin: -12px 0 22px;
    color: var(--text);
    font-size: 13px;
    overflow-wrap: anywhere;
  }}
  .status {{ color: var(--muted); opacity: 0.75; font-size: 12px; margin: -14px 0 20px; }}
  .actions {{ display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }}
  button {{
    background: linear-gradient(135deg, var(--strong), var(--accent));
    color: var(--on);
    border: none;
    padding: 12px 24px;
    border-radius: 10px;
    font: inherit;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }}
  button:hover {{ filter: brightness(1.07); }}
  button:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 3px; }}
  button:disabled {{ opacity: 0.6; cursor: default; filter: none; }}
  .hint {{ max-width: 460px; margin: 22px 0 0; color: var(--muted); font-size: 13px; line-height: 1.55; }}
  button.secondary {{ background: var(--surface); color: var(--text); border: 1px solid var(--border); }}
  .brand {{ position: fixed; bottom: 16px; color: var(--muted); opacity: 0.6; font-size: 13px; letter-spacing: 0.08em; }}
</style>
</head>
<body>
  <div class="glyph"><img src="data:image/png;base64,{nebula_mark}" alt=""></div>
  <h1>{title}</h1>
  <p>{description}</p>
  <div class="url">{display_url}</div>
  <div class="status">{status_name}</div>
  <div class="actions">
    <button type="button" id="retry">{retry_label}</button>
    {http_fallback_button}
    {compat_button_html}
  </div>
  {compat_hint_html}
  <div class="brand">NEBULA</div>
  <script>
    const retryUrl = {retry_js};
    const httpFallbackUrl = {http_fallback_js};
    document.getElementById('retry').onclick = () => {{
      if (retryUrl) location.replace(retryUrl);
      else location.reload();
    }};
    const compatButton = document.getElementById('try-compat');
    if (compatButton) {{
      compatButton.onclick = () => {{
        compatButton.disabled = true;
        compatButton.textContent = {compat_trying_js};
        try {{
          window.chrome.webview.postMessage(JSON.stringify({{ type: 'nebula-compat-retry', code: {compat_code_js} }}));
        }} catch (_) {{}}
      }};
    }}
    const httpButton = document.getElementById('try-http');
    if (httpButton && httpFallbackUrl) {{
      httpButton.onclick = () => location.replace(httpFallbackUrl);
    }}
  </script>
</body>
</html>"#
        );

        data_url_for_html(&html)
    }

    fn navigate_webview(webview: &ICoreWebView2, url: &str) {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        let wide: Vec<u16> = OsStr::new(url).encode_wide().chain(Some(0)).collect();
        unsafe {
            let _ = webview.Navigate(PCWSTR(wide.as_ptr()));
        }
    }

    fn suppress_error_page(status: COREWEBVIEW2_WEB_ERROR_STATUS, http_status: i32) -> bool {
        match status {
            COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED
            | COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN => true,
            // A page calling window.stop() after a response arrived is reported
            // as ConnectionAborted. Before any HTTP response (status 0), however,
            // the same WebView2 status represents a real connection failure such
            // as Chromium's ERR_QUIC_PROTOCOL_ERROR and needs our error page.
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED => http_status > 0,
            _ => false,
        }
    }

    fn retry_target_is_current(failed_url: &str, current_url: &str) -> bool {
        !failed_url.is_empty() && failed_url == current_url
    }

    fn retry_webview_after(app: AppHandle, label: String, url: String, delay: Duration) {
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            let Some(webview) = app.get_webview(&label) else {
                return;
            };
            let _ = webview.with_webview(move |inner| unsafe {
                if let Ok(core) = inner.controller().CoreWebView2() {
                    let current_url = read_webview_source(&core);
                    if retry_target_is_current(&url, &current_url) {
                        navigate_webview(&core, &url);
                    }
                }
            });
        });
    }

    fn show_connection_aborted_error_after(
        app: AppHandle,
        label: String,
        failed_url: String,
        error_status: COREWEBVIEW2_WEB_ERROR_STATUS,
    ) {
        std::thread::spawn(move || {
            std::thread::sleep(DOWNLOAD_ABORT_GRACE);

            let app_for_main = app.clone();
            let _ = app.run_on_main_thread(move || {
                if crate::download_manager::has_recent_or_active_download_for_label(&label) {
                    return;
                }

                let Some(webview) = app_for_main.get_webview(&label) else {
                    return;
                };

                let _ = webview.with_webview(move |inner| unsafe {
                    let Ok(core) = inner.controller().CoreWebView2() else {
                        return;
                    };

                    let current = read_webview_source(&core);
                    if current.starts_with("data:text/html")
                        || !retry_target_is_current(&failed_url, &current)
                    {
                        return;
                    }

                    let locale = current_ui_locale();
                    let error_url = build_error_page_url(&failed_url, error_status, &locale);
                    navigate_webview(&core, &error_url);
                    offer_proxy_hint(&app_for_main, &label, error_status, &locale);
                    emit_compatibility_request(&app_for_main, &label, &failed_url, error_status);
                });
            });
        });
    }

    pub fn setup_tab_error_page(app: &AppHandle, label: &str) -> Result<(), String> {
        if !crate::webview_branding::is_nebula_webview_label(label) {
            return Err(format!("error-page setup is not allowed for '{label}'"));
        }

        {
            let tokens = HANDLER_TOKENS.lock().map_err(|error| error.to_string())?;
            if tokens.contains_key(label) {
                return Ok(());
            }
        }

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;

        let label_for_store = label.to_string();
        let label_for_handler = label.to_string();
        let app_for_handler = app.clone();

        webview
            .with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };

                if let Ok(settings) = core.Settings() {
                    let _ = settings.SetIsBuiltInErrorPageEnabled(false);
                }

                let message_label = label_for_handler.clone();
                let message_app = app_for_handler.clone();
                let handler =
                    NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                        let Some(args) = args else {
                            return Ok(());
                        };

                        let mut success = BOOL::default();
                        if args.IsSuccess(&mut success).is_err() {
                            return Ok(());
                        }

                        if success.as_bool() {
                            return Ok(());
                        }

                        // WebView2 reports downloads and deliberately stopped page loads as
                        // failed navigations. Neither status means the network is offline,
                        // so preserve the current page instead of replacing it with an error.
                        let mut error_status = COREWEBVIEW2_WEB_ERROR_STATUS::default();
                        let mut http_status = 0i32;
                        if let Ok(args2) = args.cast::<ICoreWebView2NavigationCompletedEventArgs2>()
                        {
                            let _ = args2.HttpStatusCode(&mut http_status);
                        }
                        if args.WebErrorStatus(&mut error_status).is_ok()
                            && suppress_error_page(error_status, http_status)
                        {
                            return Ok(());
                        }

                        // WebView2 deliberately reports every external protocol
                        // launch as ConnectionAborted. Consume only the failure
                        // paired with our preceding external-URI event so genuine
                        // connection aborts still receive Nebula's error page.
                        if error_status == COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED
                            && http_status == 0
                            && claim_external_uri_navigation(&label_for_handler)
                        {
                            return Ok(());
                        }

                        let Some(webview) = sender else {
                            return Ok(());
                        };

                        let current = read_webview_source(&webview);
                        if current.starts_with("data:text/html") {
                            return Ok(());
                        }

                        let failed_url = if current.is_empty() || current == "about:blank" {
                            "about:blank".to_string()
                        } else {
                            current
                        };

                        if failed_url != "about:blank" {
                            if let Some(delay) =
                                claim_browser_verification_retry(&label_for_handler)
                            {
                                retry_webview_after(
                                    app_for_handler.clone(),
                                    label_for_handler.clone(),
                                    failed_url,
                                    delay,
                                );
                                return Ok(());
                            }
                        }

                        if error_status == COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED
                            && http_status == 0
                        {
                            show_connection_aborted_error_after(
                                app_for_handler.clone(),
                                label_for_handler.clone(),
                                failed_url,
                                error_status,
                            );
                            return Ok(());
                        }

                        let locale = current_ui_locale();
                        let error_url = build_error_page_url(&failed_url, error_status, &locale);
                        navigate_webview(&webview, &error_url);
                        offer_proxy_hint(
                            &app_for_handler,
                            &label_for_handler,
                            error_status,
                            &locale,
                        );
                        Ok(())
                    }));

                // The page's own button (see build_error_page_url) asks for the retry without protections.
                let message =
                    WebMessageReceivedEventHandler::create(Box::new(move |sender, args| {
                        let (Some(sender), Some(args)) = (sender, args) else {
                            return Ok(());
                        };
                        // Only a message from the page Nebula built: its address is a data URL, and so is the tab's.
                        let source = take_string(|value| args.Source(value));
                        let top_level = take_string(|value| sender.Source(value));
                        if !source.starts_with("data:text/html")
                            || !top_level.starts_with("data:text/html")
                        {
                            return Ok(());
                        }
                        let raw = take_string(|value| args.TryGetWebMessageAsString(value));
                        handle_compat_message(&message_app, &message_label, &raw);
                        Ok(())
                    }));
                let mut message_token: i64 = 0;
                if core
                    .add_WebMessageReceived(&message, &mut message_token)
                    .is_ok()
                {
                    if let Ok(mut tokens) = MESSAGE_TOKENS.lock() {
                        tokens.insert(label_for_store.clone(), message_token);
                    }
                    MESSAGE_HANDLERS.with(|handlers| {
                        handlers
                            .borrow_mut()
                            .insert(label_for_store.clone(), message);
                    });
                }

                let mut token: i64 = 0;
                if core.add_NavigationCompleted(&handler, &mut token).is_err() {
                    return;
                }

                let Ok(mut tokens) = HANDLER_TOKENS.lock() else {
                    let _ = core.remove_NavigationCompleted(token);
                    return;
                };
                tokens.insert(label_for_store.clone(), token);
                HANDLERS.with(|handlers| {
                    handlers
                        .borrow_mut()
                        .insert(label_for_store.clone(), handler);
                });
            })
            .map_err(|error| error.to_string())?;

        Ok(())
    }

    pub fn teardown_tab_error_page(app: &AppHandle, label: &str) {
        let token = HANDLER_TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));
        let message_token = MESSAGE_TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));
        let label_for_handler = label.to_string();

        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(move |inner| unsafe {
                if let Ok(core) = inner.controller().CoreWebView2() {
                    if let Some(token) = token {
                        let _ = core.remove_NavigationCompleted(token);
                    }
                    if let Some(token) = message_token {
                        let _ = core.remove_WebMessageReceived(token);
                    }
                }
                HANDLERS.with(|handlers| {
                    handlers.borrow_mut().remove(&label_for_handler);
                });
                MESSAGE_HANDLERS.with(|handlers| {
                    handlers.borrow_mut().remove(&label_for_handler);
                });
            });
        }
        if let Ok(mut states) = VERIFICATION_STATES.lock() {
            states.remove(label);
        }
        if let Ok(mut navigations) = EXTERNAL_URI_NAVIGATIONS.lock() {
            navigations.remove(label);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{
            build_error_page_url, claim_external_uri_navigation, compat_copy, compat_page_for,
            compatibility_request_url, compatibility_retry_applies, js_string_literal,
            local_http_fallback_url, note_external_uri_navigation, register_compat_page,
            retry_target_is_current, set_theme, should_offer_compatibility_retry,
            suppress_error_page, web_error_status_name,
            COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE,
        };

        /// The page is a percent-encoded data URL.
        fn decoded(url: &str) -> String {
            let encoded = url.trim_start_matches("data:text/html;charset=utf-8,");
            let raw = encoded.as_bytes();
            let mut bytes = Vec::new();
            let mut index = 0;
            while index < raw.len() {
                if raw[index] == b'%' {
                    bytes.push(u8::from_str_radix(&encoded[index + 1..index + 3], 16).unwrap());
                    index += 3;
                } else {
                    bytes.push(raw[index]);
                    index += 1;
                }
            }
            String::from_utf8(bytes).unwrap()
        }

        #[test]
        fn compatibility_requests_are_limited_to_http_sites() {
            assert_eq!(
                compatibility_request_url("https://example.com/path").as_deref(),
                Some("https://example.com/path")
            );
            assert!(compatibility_request_url("data:text/html,blocked").is_none());
            assert!(compatibility_request_url("file:///C:/secret.txt").is_none());
            assert!(compatibility_request_url("javascript:alert(1)").is_none());
            assert!(compatibility_request_url("https://192.168.1.1/").is_none());
            assert!(compatibility_request_url("http://router.local/").is_none());
        }
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
            COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET,
            COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED,
            COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
            COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
            COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE,
            COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN,
        };

        #[test]
        fn cancelled_navigation_does_not_replace_the_page_with_an_error() {
            assert!(suppress_error_page(
                COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
                0,
            ));
            assert!(suppress_error_page(
                COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN,
                0,
            ));
        }

        #[test]
        fn connection_aborted_without_http_response_shows_the_error_page() {
            assert!(!suppress_error_page(
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
                0,
            ));
            assert!(suppress_error_page(
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
                200,
            ));
            assert!(!suppress_error_page(
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                0,
            ));
        }

        #[test]
        fn external_uri_abort_is_claimed_once_for_its_tab() {
            let label = "external-uri-abort-test";
            note_external_uri_navigation(label);
            assert!(claim_external_uri_navigation(label));
            assert!(!claim_external_uri_navigation(label));
            assert!(!claim_external_uri_navigation("another-tab"));
        }

        #[test]
        fn custom_error_page_includes_the_webview_status() {
            let page = build_error_page_url(
                "https://example.com",
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET,
                "en",
            );
            assert!(page.contains("COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET"));
            assert!(page.contains("https%3A%2F%2Fexample.com"));
            assert!(page.contains("This%20site%20can%27t%20be%20reached"));
        }

        #[test]
        fn custom_error_page_respects_selected_turkish_locale() {
            let page = build_error_page_url(
                "https://example.com",
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                "tr",
            );
            assert!(page.contains("Bu%20siteye%20ula%C5%9F%C4%B1lam%C4%B1yor"));
            assert!(page.contains("Tekrar%20dene"));
            assert!(page.contains("lang%3D%22tr%22"));
        }

        #[test]
        fn custom_error_page_respects_selected_spanish_locale() {
            let page = build_error_page_url(
                "https://example.com",
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                "es",
            );
            assert!(page.contains("No%20se%20puede%20acceder%20a%20este%20sitio"));
            assert!(page.contains("Volver%20a%20intentarlo"));
            assert!(page.contains("lang%3D%22es%22"));
        }

        #[test]
        fn custom_error_page_respects_selected_german_locale() {
            let page = build_error_page_url(
                "https://example.com",
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                "de",
            );
            assert!(page.contains("Diese%20Website%20ist%20nicht%20erreichbar"));
            assert!(page.contains("Erneut%20versuchen"));
            assert!(page.contains("lang%3D%22de%22"));
        }

        #[test]
        fn custom_error_page_respects_selected_french_locale() {
            let page = build_error_page_url(
                "https://example.com",
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                "fr",
            );
            assert!(page.contains("Ce%20site%20est%20inaccessible"));
            assert!(page.contains("lang%3D%22fr%22"));
        }

        #[test]
        fn custom_error_page_respects_selected_indonesian_locale() {
            let page = build_error_page_url(
                "https://example.com",
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                "id",
            );
            assert!(page.contains("Situs%20ini%20tidak%20dapat%20dijangkau"));
            assert!(page.contains("Coba%20lagi"));
            assert!(page.contains("lang%3D%22id%22"));
        }

        #[test]
        fn custom_error_page_respects_selected_russian_locale() {
            let page = build_error_page_url(
                "https://example.com",
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                "ru",
            );
            assert!(page.contains("lang%3D%22ru%22"));
            assert!(page.contains("%D0%9F%D0%BE%D0%B2%D1%82%D0%BE%D1%80%D0%B8%D1%82%D1%8C"));
        }

        #[test]
        fn custom_error_page_respects_selected_italian_locale() {
            let page = build_error_page_url(
                "https://example.com",
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                "it",
            );
            assert!(page.contains("Questo%20sito%20non%20%C3%A8%20raggiungibile"));
            assert!(page.contains("Riprova"));
            assert!(page.contains("lang%3D%22it%22"));
        }

        #[test]
        fn custom_error_page_respects_selected_japanese_locale() {
            let page = build_error_page_url(
                "https://example.com",
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                "ja",
            );
            assert!(page.contains("lang%3D%22ja%22"));
            assert!(page.contains("%E5%86%8D%E8%A9%A6%E8%A1%8C"));
        }

        #[test]
        fn certificate_error_uses_a_named_status_and_offers_local_http_fallback() {
            let page = build_error_page_url(
                "https://192.168.1.1/",
                COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
                "en",
            );
            assert!(page.contains("COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID"));
            assert!(page.contains("Your%20connection%20isn%27t%20private"));
            assert!(page.contains("Try%20HTTP"));
            assert!(page.contains("http%3A%2F%2F192.168.1.1%2F"));
            assert!(!page.contains("COREWEBVIEW2_WEB_ERROR_STATUS%285%29"));

            assert_eq!(
                local_http_fallback_url(
                    "https://192.168.1.1:443/admin",
                    COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
                )
                .as_deref(),
                Some("http://192.168.1.1/admin")
            );
        }

        #[test]
        fn public_certificate_errors_do_not_offer_an_insecure_downgrade() {
            let page = build_error_page_url(
                "https://example.com/",
                COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
                "en",
            );
            assert!(!page.contains("Try%20HTTP"));
            assert!(local_http_fallback_url(
                "https://example.com/",
                COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
            )
            .is_none());
        }

        #[test]
        fn error_page_script_literals_cannot_close_the_script_element() {
            let literal = js_string_literal("https://example.com/</script>?q='&line=\u{2028}");
            assert!(!literal.contains('<'));
            assert!(!literal.contains('>'));
            assert!(!literal.contains('&'));
            assert!(literal.contains("\\u003C/script\\u003E"));
            assert!(literal.contains("\\u0026"));
            assert!(literal.contains("\\u2028"));
        }

        #[test]
        fn status_names_and_compatibility_prompts_follow_the_real_error_kind() {
            assert_eq!(
                web_error_status_name(COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID),
                "COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID"
            );
            assert!(!should_offer_compatibility_retry(
                COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID
            ));
            assert!(!should_offer_compatibility_retry(
                COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED
            ));
            assert!(should_offer_compatibility_retry(
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET
            ));
            assert!(!should_offer_compatibility_retry(
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED
            ));
        }

        #[test]
        fn a_site_that_cannot_be_reached_never_gets_the_compatibility_prompt() {
            // "This site can't be reached": nothing the protections do could have caused it.
            for status in [
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
                COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED,
                COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE,
                COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
            ] {
                assert!(!should_offer_compatibility_retry(status));
                assert!(!compatibility_retry_applies(status, false));
            }
        }

        #[test]
        fn the_windows_connectivity_check_answers_without_failing() {
            // The answer depends on the machine, so nothing is asserted: this only makes sure the Windows call
            // runs. A failed lookup counts as online.
            println!("internet_unavailable = {}", super::internet_unavailable());
        }

        #[test]
        fn no_internet_never_blames_the_site_or_the_protections() {
            let status = COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET;
            assert!(compatibility_retry_applies(status, false));
            assert!(!compatibility_retry_applies(status, true));
            assert!(!compatibility_retry_applies(
                COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
                false
            ));
        }

        #[test]
        fn only_a_page_nebula_built_can_ask_for_the_retry_and_it_asks_for_its_own_address() {
            let first = register_compat_page(
                "https://one.example/",
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET,
            );
            let second = register_compat_page(
                "https://two.example/",
                COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE,
            );
            assert_ne!(first, second);
            assert_eq!(first.len(), 16);
            let (url, status) = compat_page_for(&first).unwrap();
            assert_eq!(url, "https://one.example/");
            assert_eq!(status, COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET);
            assert_eq!(compat_page_for(&second).unwrap().0, "https://two.example/");
            // A code that was never given out, or none, gets nothing.
            assert!(compat_page_for("0000000000000000").is_none());
            assert!(compat_page_for("").is_none());
        }

        #[test]
        fn the_retry_without_protections_is_only_offered_for_a_cut_connection() {
            // The page of a site that cannot be reached has no such button and sends no message.
            for status in [
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
                COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
                COREWEBVIEW2_WEB_ERROR_STATUS_CERTIFICATE_IS_INVALID,
            ] {
                let page = decoded(&build_error_page_url("https://example.test/", status, "en"));
                assert!(!page.contains(r#"id="try-compat""#), "{status:?}");
                assert!(!page.contains(r#"class="hint""#), "{status:?}");
            }
            // A cut connection has it (when the machine is online), in every language, with its sentence.
            if !super::internet_unavailable() {
                for locale in ["en", "tr", "es", "de", "fr", "id", "ru", "it", "ja"] {
                    let page = decoded(&build_error_page_url(
                        "https://example.test/",
                        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET,
                        locale,
                    ));
                    assert!(page.contains(r#"id="try-compat""#), "{locale}");
                    assert!(page.contains(r#"class="hint""#), "{locale}");
                    let (hint, button, trying) = compat_copy(locale);
                    assert!(!hint.is_empty() && !button.is_empty() && !trying.is_empty());
                }
            }
        }

        #[test]
        fn the_error_page_takes_the_colours_of_the_interface_and_only_colours() {
            let theme = super::super::ErrorPageTheme {
                dark: false,
                base: "rgb(255, 255, 255)".into(),
                text: "rgb(15, 19, 48)".into(),
                muted: "red; } body { display: none".into(),
                border: "rgba(15, 19, 60, 0.12)".into(),
                surface: "#f3f4fb".into(),
                accent: "rgb(251, 191, 36)".into(),
                strong: "rgb(225, 164, 4)".into(),
                on: "rgb(11, 15, 26)".into(),
            };
            set_theme(&theme);
            let url = build_error_page_url(
                "https://example.test/",
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET,
                "en",
            );
            // The page is a percent-encoded data URL.
            let encoded = url.trim_start_matches("data:text/html;charset=utf-8,");
            let mut bytes = Vec::new();
            let raw = encoded.as_bytes();
            let mut index = 0;
            while index < raw.len() {
                if raw[index] == b'%' {
                    bytes.push(u8::from_str_radix(&encoded[index + 1..index + 3], 16).unwrap());
                    index += 3;
                } else {
                    bytes.push(raw[index]);
                    index += 1;
                }
            }
            let html = String::from_utf8(bytes).unwrap();
            assert!(html.contains("color-scheme: light;"));
            assert!(html.contains("--base: rgb(255, 255, 255);"));
            assert!(html.contains("--accent: rgb(251, 191, 36);"));
            // A value that is not a plain colour is replaced by the default one, not written into the style sheet.
            assert!(!html.contains("display: none"));
            assert!(html.contains("--muted: #a1a1aa;"));
            set_theme(&super::super::ErrorPageTheme::default());
        }

        #[test]
        fn delayed_verification_retry_cannot_replace_a_newer_navigation() {
            assert!(retry_target_is_current(
                "https://challenge.example/",
                "https://challenge.example/",
            ));
            assert!(!retry_target_is_current(
                "https://challenge.example/",
                "https://destination.example/",
            ));
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{
    current_ui_locale, notification_activity_body, set_theme, set_ui_locale, setup_tab_error_page,
    teardown_tab_error_page,
};

#[cfg(target_os = "windows")]
pub(crate) use imp::{note_browser_verification_request, note_external_uri_navigation};

#[cfg(not(target_os = "windows"))]
pub fn set_ui_locale(_locale: &str) {}

#[cfg(not(target_os = "windows"))]
pub fn set_theme(_theme: &ErrorPageTheme) {}

#[cfg(not(target_os = "windows"))]
pub fn current_ui_locale() -> String {
    "en".to_string()
}

#[cfg(not(target_os = "windows"))]
pub fn notification_activity_body() -> String {
    "You have a new message or notification.".to_string()
}

#[cfg(not(target_os = "windows"))]
pub fn setup_tab_error_page(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_tab_error_page(_app: &tauri::AppHandle, _label: &str) {}

#[cfg(not(target_os = "windows"))]
pub(crate) fn note_browser_verification_request(_label: &str) {}

#[cfg(not(target_os = "windows"))]
pub(crate) fn note_external_uri_navigation(_label: &str) {}
