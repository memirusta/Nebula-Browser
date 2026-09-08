#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2NavigationCompletedEventArgs2,
        ICoreWebView2NavigationCompletedEventHandler, COREWEBVIEW2_WEB_ERROR_STATUS,
        COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
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
    use webview2_com::NavigationCompletedEventHandler;
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
    thread_local! {
        static HANDLERS: RefCell<HashMap<String, ICoreWebView2NavigationCompletedEventHandler>> =
            RefCell::new(HashMap::new());
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

    fn should_offer_compatibility_retry(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> bool {
        matches!(
            status,
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED
                | COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET
                | COREWEBVIEW2_WEB_ERROR_STATUS_DISCONNECTED
                | COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT
                | COREWEBVIEW2_WEB_ERROR_STATUS_SERVER_UNREACHABLE
                | COREWEBVIEW2_WEB_ERROR_STATUS_ERROR_HTTP_INVALID_SERVER_RESPONSE
        )
    }

    fn emit_compatibility_request(
        app: &AppHandle,
        label: &str,
        failed_url: &str,
        error_status: COREWEBVIEW2_WEB_ERROR_STATUS,
    ) {
        if !should_offer_compatibility_retry(error_status) {
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
  * {{ box-sizing: border-box; margin: 0; }}
  body {{
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    background: #0a0812;
    color: #ede6ff;
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
  h1 {{ font-size: 22px; font-weight: 600; margin-bottom: 8px; }}
  p {{ color: #a89bc4; max-width: 420px; margin-bottom: 24px; }}
  .url {{
    max-width: min(620px, 88vw);
    margin: -12px 0 22px;
    color: #c9bddf;
    font-size: 13px;
    overflow-wrap: anywhere;
  }}
  .status {{ color: #675a80; font-size: 12px; margin: -14px 0 20px; }}
  .actions {{ display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }}
  button {{
    background: #863bff;
    color: #fff;
    border: none;
    padding: 12px 24px;
    border-radius: 10px;
    font-size: 15px;
    cursor: pointer;
  }}
  button:hover {{ filter: brightness(1.08); }}
  button.secondary {{ background: #241a38; color: #d8c9f4; }}
  .brand {{ position: fixed; bottom: 16px; color: #5c4d7a; font-size: 13px; letter-spacing: 0.08em; }}
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
  </div>
  <div class="brand">NEBULA</div>
  <script>
    const retryUrl = {retry_js};
    const httpFallbackUrl = {http_fallback_js};
    document.getElementById('retry').onclick = () => {{
      if (retryUrl) location.replace(retryUrl);
      else location.reload();
    }};
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
                        emit_compatibility_request(
                            &app_for_handler,
                            &label_for_handler,
                            &failed_url,
                            error_status,
                        );
                        Ok(())
                    }));

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
        let label_for_handler = label.to_string();

        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(move |inner| unsafe {
                if let Ok(core) = inner.controller().CoreWebView2() {
                    if let Some(token) = token {
                        let _ = core.remove_NavigationCompleted(token);
                    }
                }
                HANDLERS.with(|handlers| {
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
            build_error_page_url, claim_external_uri_navigation, compatibility_request_url,
            js_string_literal, local_http_fallback_url, note_external_uri_navigation,
            retry_target_is_current, should_offer_compatibility_retry, suppress_error_page,
            web_error_status_name,
        };

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
            COREWEBVIEW2_WEB_ERROR_STATUS_HOST_NAME_NOT_RESOLVED,
            COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
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
    current_ui_locale, notification_activity_body, set_ui_locale, setup_tab_error_page,
    teardown_tab_error_page,
};

#[cfg(target_os = "windows")]
pub(crate) use imp::{note_browser_verification_request, note_external_uri_navigation};

#[cfg(not(target_os = "windows"))]
pub fn set_ui_locale(_locale: &str) {}

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
