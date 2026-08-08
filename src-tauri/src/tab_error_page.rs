#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant};

    use tauri::AppHandle;
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2NavigationCompletedEventHandler, COREWEBVIEW2_WEB_ERROR_STATUS,
        COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
        COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED, COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN,
    };
    use webview2_com::NavigationCompletedEventHandler;
    use windows::core::PCWSTR;
    use windows::core::PWSTR;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows_core::BOOL;

    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static VERIFICATION_STATES: LazyLock<Mutex<HashMap<String, VerificationState>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    thread_local! {
        static HANDLERS: RefCell<HashMap<String, ICoreWebView2NavigationCompletedEventHandler>> =
            RefCell::new(HashMap::new());
    }

    struct VerificationState {
        last_seen: Instant,
        retry_count: u8,
    }

    const VERIFICATION_WINDOW: Duration = Duration::from_secs(45);
    const MAX_VERIFICATION_RETRIES: u8 = 2;

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

    fn build_error_page_url(retry_url: &str, error_status: &str) -> String {
        let retry_js = retry_url
            .replace('\\', "\\\\")
            .replace('\'', "\\'")
            .replace(['\n', '\r'], "");

        let html = format!(
            r#"<!DOCTYPE html>
<html lang="tr">
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
    background: linear-gradient(135deg, #863bff, #5b21b6);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    font-weight: 700;
  }}
  h1 {{ font-size: 22px; font-weight: 600; margin-bottom: 8px; }}
  p {{ color: #a89bc4; max-width: 420px; margin-bottom: 24px; }}
  .status {{ color: #675a80; font-size: 12px; margin: -14px 0 20px; }}
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
  .brand {{ position: fixed; bottom: 16px; color: #5c4d7a; font-size: 13px; letter-spacing: 0.08em; }}
</style>
</head>
<body>
  <div class="glyph">N</div>
  <h1>Bağlantı kurulamadı</h1>
  <p>İnternet bağlantınızı kontrol edin ve tekrar deneyin.</p>
  <div class="status">{error_status}</div>
  <button type="button" id="retry">Tekrar dene</button>
  <div class="brand">NEBULA</div>
  <script>
    const retryUrl = '{retry_js}';
    document.getElementById('retry').onclick = () => {{
      if (retryUrl) location.replace(retryUrl);
      else location.reload();
    }};
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

    fn suppress_error_page(status: COREWEBVIEW2_WEB_ERROR_STATUS) -> bool {
        matches!(
            status,
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED
                | COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED
                | COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN
        )
    }

    fn retry_webview_after(app: AppHandle, label: String, url: String, delay: Duration) {
        std::thread::spawn(move || {
            std::thread::sleep(delay);
            let Some(webview) = app.get_webview(&label) else {
                return;
            };
            let _ = webview.with_webview(move |inner| unsafe {
                if let Ok(core) = inner.controller().CoreWebView2() {
                    navigate_webview(&core, &url);
                }
            });
        });
    }

    pub fn setup_tab_error_page(app: &AppHandle, label: &str) -> Result<(), String> {
        if !crate::webview_branding::is_nebula_webview_label(label) {
            return Err(format!("error-page setup is not allowed for '{label}'"));
        }

        {
            let configured = CONFIGURED_LABELS
                .lock()
                .map_err(|error| error.to_string())?;
            if configured.contains(label) {
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
                        if args.WebErrorStatus(&mut error_status).is_ok()
                            && suppress_error_page(error_status)
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

                        let error_url =
                            build_error_page_url(&failed_url, &format!("{error_status:?}"));
                        navigate_webview(&webview, &error_url);
                        Ok(())
                    }));

                let mut token: i64 = 0;
                if core.add_NavigationCompleted(&handler, &mut token).is_err() {
                    return;
                }

                if let Ok(mut tokens) = HANDLER_TOKENS.lock() {
                    tokens.insert(label_for_store.clone(), token);
                }
                HANDLERS.with(|handlers| {
                    handlers
                        .borrow_mut()
                        .insert(label_for_store.clone(), handler);
                });
            })
            .map_err(|error| error.to_string())?;

        CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string());

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
        if let Ok(mut configured) = CONFIGURED_LABELS.lock() {
            configured.remove(label);
        }
        if let Ok(mut states) = VERIFICATION_STATES.lock() {
            states.remove(label);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::{build_error_page_url, suppress_error_page};
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT,
            COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED,
            COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED,
            COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN,
        };

        #[test]
        fn download_navigation_does_not_replace_the_page_with_an_error() {
            assert!(suppress_error_page(
                COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_ABORTED
            ));
            assert!(suppress_error_page(
                COREWEBVIEW2_WEB_ERROR_STATUS_OPERATION_CANCELED
            ));
            assert!(suppress_error_page(COREWEBVIEW2_WEB_ERROR_STATUS_UNKNOWN));
            assert!(!suppress_error_page(
                COREWEBVIEW2_WEB_ERROR_STATUS_CANNOT_CONNECT
            ));
        }

        #[test]
        fn custom_error_page_includes_the_webview_status() {
            let page = build_error_page_url(
                "https://example.com",
                "COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET",
            );
            assert!(page.contains("COREWEBVIEW2_WEB_ERROR_STATUS_CONNECTION_RESET"));
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{setup_tab_error_page, teardown_tab_error_page};

#[cfg(target_os = "windows")]
pub(crate) use imp::note_browser_verification_request;

#[cfg(not(target_os = "windows"))]
pub fn setup_tab_error_page(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_tab_error_page(_app: &tauri::AppHandle, _label: &str) {}

#[cfg(not(target_os = "windows"))]
pub(crate) fn note_browser_verification_request(_label: &str) {}
