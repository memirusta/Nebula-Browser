#[cfg(target_os = "windows")]
mod imp {
    use base64::Engine as _;
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::{LazyLock, Mutex};
    use std::time::Instant;

    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2DocumentTitleChangedEventHandler,
        ICoreWebView2FaviconChangedEventHandler, ICoreWebView2NavigationCompletedEventHandler,
        ICoreWebView2NavigationStartingEventHandler, ICoreWebView2SourceChangedEventHandler,
        ICoreWebView2_15, COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG,
    };
    use webview2_com::{
        DocumentTitleChangedEventHandler, FaviconChangedEventHandler, GetFaviconCompletedHandler,
        NavigationCompletedEventHandler, NavigationStartingEventHandler, SourceChangedEventHandler,
    };
    use windows::core::PWSTR;
    use windows::Win32::System::Com::{
        CoTaskMemFree, IStream, STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET,
    };
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOT};
    use windows_core::{Interface, BOOL};

    type HandlerTokens = (i64, i64, i64, i64, Option<i64>);
    type TabMetadataHandlers = (
        ICoreWebView2SourceChangedEventHandler,
        ICoreWebView2DocumentTitleChangedEventHandler,
        ICoreWebView2NavigationStartingEventHandler,
        ICoreWebView2NavigationCompletedEventHandler,
        Option<ICoreWebView2FaviconChangedEventHandler>,
    );

    type TabSnapshotState = (String, String, Option<String>);

    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));

    static HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, HandlerTokens>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    static NAVIGATION_STARTED_AT: LazyLock<Mutex<HashMap<String, Instant>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    thread_local! {
        static HANDLERS: RefCell<HashMap<String, TabMetadataHandlers>> =
            RefCell::new(HashMap::new());
    }

    static LAST_SNAPSHOTS: LazyLock<Mutex<HashMap<String, TabSnapshotState>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    static FAVICON_CACHE: LazyLock<Mutex<HashMap<String, (String, String)>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static FAVICON_REQUEST_EPOCHS: LazyLock<Mutex<HashMap<String, u64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static LAST_SOCIAL_UNREAD_COUNTS: LazyLock<Mutex<HashMap<String, u64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    #[derive(Clone, Serialize)]
    struct TabSnapshotPayload {
        label: String,
        url: String,
        title: String,
        favicon: Option<String>,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct TabLoadingPayload {
        label: String,
        is_loading: bool,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct TabNavigationPerformancePayload {
        label: String,
        url: String,
        duration_ms: u128,
        success: bool,
    }

    unsafe fn take_webview_string(
        read: impl FnOnce(*mut PWSTR) -> windows_core::Result<()>,
    ) -> String {
        let mut value = PWSTR::null();
        let text = if read(&mut value).is_ok() {
            value.to_string().unwrap_or_default()
        } else {
            String::new()
        };
        if !value.is_null() {
            CoTaskMemFree(Some(value.as_ptr().cast()));
        }
        text
    }

    unsafe fn read_favicon_stream(stream: &IStream) -> Result<Vec<u8>, String> {
        const MAX_FAVICON_BYTES: usize = 64 * 1024;

        let mut stat = STATSTG::default();
        stream
            .Stat(&mut stat, STATFLAG_NONAME)
            .map_err(|error| error.to_string())?;
        let size =
            usize::try_from(stat.cbSize).map_err(|_| "favicon image is too large".to_string())?;
        if size == 0 || size > MAX_FAVICON_BYTES {
            return Err("favicon image is empty or exceeds 64 KB".to_string());
        }

        stream
            .Seek(0, STREAM_SEEK_SET, None)
            .map_err(|error| error.to_string())?;
        let mut bytes = vec![0u8; size];
        let mut offset = 0usize;
        while offset < bytes.len() {
            let chunk_size = (bytes.len() - offset).min(u32::MAX as usize) as u32;
            let mut read = 0u32;
            stream
                .Read(
                    bytes[offset..].as_mut_ptr().cast(),
                    chunk_size,
                    Some(&mut read),
                )
                .ok()
                .map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            offset += read as usize;
        }
        bytes.truncate(offset);
        if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]) {
            Ok(bytes)
        } else {
            Err("WebView2 returned invalid favicon image data".to_string())
        }
    }

    fn usable_favicon_uri(value: &str) -> Option<String> {
        const MAX_REMOTE_URI_LENGTH: usize = 4_096;
        const MAX_INLINE_URI_LENGTH: usize = 90_000;

        let value = value.trim();
        if value.is_empty() {
            return None;
        }
        if value.starts_with("data:") {
            let prefix = value
                .split_once(',')
                .map(|(prefix, _)| prefix.to_ascii_lowercase())?;
            let safe_image = [
                "data:image/png;base64",
                "data:image/jpeg;base64",
                "data:image/gif;base64",
                "data:image/webp;base64",
                "data:image/x-icon;base64",
                "data:image/vnd.microsoft.icon;base64",
            ]
            .contains(&prefix.as_str());
            return (safe_image && value.len() <= MAX_INLINE_URI_LENGTH).then(|| value.to_string());
        }
        if value.len() > MAX_REMOTE_URI_LENGTH {
            return None;
        }
        let parsed = url::Url::parse(value).ok()?;
        matches!(parsed.scheme(), "http" | "https").then(|| parsed.to_string())
    }

    fn social_site(url: &str) -> Option<(String, &'static str)> {
        let parsed = url::Url::parse(url).ok()?;
        let host = parsed.host_str()?.to_ascii_lowercase();
        let name = [
            ("facebook.com", "Facebook"),
            ("instagram.com", "Instagram"),
            ("web.whatsapp.com", "WhatsApp"),
            ("linkedin.com", "LinkedIn"),
            ("reddit.com", "Reddit"),
            ("threads.net", "Threads"),
            ("tiktok.com", "TikTok"),
            ("twitter.com", "X"),
            ("x.com", "X"),
        ]
        .into_iter()
        .find_map(|(site, name)| {
            (host == site || host.ends_with(&format!(".{site}"))).then_some(name)
        })?;
        Some((parsed.origin().ascii_serialization(), name))
    }

    fn unread_prefix(title: &str) -> u64 {
        title
            .strip_prefix('(')
            .and_then(|rest| rest.split_once(')'))
            .and_then(|(count, _)| count.trim().parse::<u64>().ok())
            .unwrap_or(0)
    }

    pub fn app_is_backgrounded(app: &AppHandle) -> bool {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.is_invalid() {
            return false;
        }
        !app.windows().values().any(|window| {
            window.hwnd().is_ok_and(|hwnd| {
                hwnd == foreground || unsafe { GetAncestor(hwnd, GA_ROOT) } == foreground
            })
        })
    }

    fn emit_social_unread_notification(app: &AppHandle, label: &str, url: &str, title: &str) {
        let Some((origin, site_name)) = social_site(url) else {
            if let Ok(mut counts) = LAST_SOCIAL_UNREAD_COUNTS.lock() {
                counts.remove(label);
            }
            return;
        };
        let count = unread_prefix(title);
        let previous = LAST_SOCIAL_UNREAD_COUNTS
            .lock()
            .ok()
            .and_then(|mut counts| counts.insert(label.to_string(), count));
        if previous.map_or(true, |previous| count <= previous) {
            return;
        }
        if !app_is_backgrounded(app) {
            return;
        }
        let notification_app = app.clone();
        let notification_label = label.to_string();
        let notification_origin = origin;
        let notification_title = site_name.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(700)).await;
            let count_is_current = LAST_SOCIAL_UNREAD_COUNTS
                .lock()
                .ok()
                .and_then(|counts| counts.get(&notification_label).copied())
                == Some(count);
            if !count_is_current || !app_is_backgrounded(&notification_app) {
                return;
            }
            crate::notification_broker::submit(
                &notification_app,
                crate::notification_broker::NotificationSource::TitleFallback,
                crate::notification_broker::NotificationCandidate {
                    tab_label: notification_label,
                    origin: notification_origin,
                    title: notification_title,
                    body: String::new(),
                    icon_url: String::new(),
                },
            );
        });
    }

    fn emit_snapshot(app: &AppHandle, label: &str, webview: &ICoreWebView2) {
        let (url, title) = unsafe {
            (
                take_webview_string(|value| webview.Source(value)),
                take_webview_string(|value| webview.DocumentTitle(value)),
            )
        };
        let favicon = FAVICON_CACHE.lock().ok().and_then(|cache| {
            cache
                .get(label)
                .filter(|(favicon_url, _)| favicon_url == &url)
                .map(|(_, favicon)| favicon.clone())
        });
        if let Ok(mut snapshots) = LAST_SNAPSHOTS.lock() {
            let next = (url.clone(), title.clone(), favicon.clone());
            if snapshots.get(label) == Some(&next) {
                return;
            }
            snapshots.insert(label.to_string(), next);
        }
        emit_social_unread_notification(app, label, &url, &title);
        let _ = app.emit(
            "nebula-tab-snapshot",
            TabSnapshotPayload {
                label: label.to_string(),
                url,
                title,
                favicon,
            },
        );
    }

    fn request_favicon(app: &AppHandle, label: &str, webview: &ICoreWebView2) {
        let expected_url = unsafe { take_webview_string(|value| webview.Source(value)) };
        if expected_url.is_empty() || expected_url == "about:blank" {
            return;
        }

        let Ok(favicon_webview) = webview.cast::<ICoreWebView2_15>() else {
            return;
        };
        let favicon_uri = unsafe { take_webview_string(|value| favicon_webview.FaviconUri(value)) };
        let source_after_uri = unsafe { take_webview_string(|value| webview.Source(value)) };
        if source_after_uri == expected_url {
            if let Some(favicon_uri) = usable_favicon_uri(&favicon_uri) {
                if let Ok(mut cache) = FAVICON_CACHE.lock() {
                    cache.insert(label.to_string(), (expected_url, favicon_uri));
                }
                emit_snapshot(app, label, webview);
                return;
            }
        }

        // WebView2's decoded PNG is intentionally only a fallback. It is often
        // a 16 px tab-strip bitmap and becomes visibly soft in Nebula's larger
        // shortcut surfaces; FaviconUri keeps the site's original ICO/SVG/PNG.
        let request_epoch = FAVICON_REQUEST_EPOCHS
            .lock()
            .ok()
            .map(|mut epochs| {
                let epoch = epochs.entry(label.to_string()).or_default();
                *epoch = epoch.wrapping_add(1);
                *epoch
            })
            .unwrap_or_default();
        let callback_app = app.clone();
        let callback_label = label.to_string();
        let callback_webview = webview.clone();
        let handler = GetFaviconCompletedHandler::create(Box::new(move |result, stream| {
            if result.is_err() {
                return Ok(());
            }
            let Some(stream) = stream else {
                return Ok(());
            };
            let Ok(bytes) = (unsafe { read_favicon_stream(&stream) }) else {
                return Ok(());
            };
            let current_url =
                unsafe { take_webview_string(|value| callback_webview.Source(value)) };
            if current_url != expected_url {
                return Ok(());
            }
            let request_is_current = FAVICON_REQUEST_EPOCHS
                .lock()
                .ok()
                .and_then(|epochs| epochs.get(&callback_label).copied())
                == Some(request_epoch);
            if !request_is_current {
                return Ok(());
            }

            let favicon = format!(
                "data:image/png;base64,{}",
                base64::engine::general_purpose::STANDARD.encode(bytes),
            );
            if let Ok(mut cache) = FAVICON_CACHE.lock() {
                cache.insert(callback_label.clone(), (current_url, favicon));
            }
            emit_snapshot(&callback_app, &callback_label, &callback_webview);
            Ok(())
        }));

        unsafe {
            let _ = favicon_webview.GetFavicon(COREWEBVIEW2_FAVICON_IMAGE_FORMAT_PNG, &handler);
        }
    }

    fn emit_navigation_performance(
        app: &AppHandle,
        label: &str,
        webview: &ICoreWebView2,
        success: bool,
    ) {
        let started_at = NAVIGATION_STARTED_AT
            .lock()
            .ok()
            .and_then(|mut starts| starts.remove(label));
        let Some(started_at) = started_at else {
            return;
        };

        let url = unsafe { take_webview_string(|value| webview.Source(value)) };
        if url.is_empty() || url == "about:blank" {
            return;
        }

        let _ = app.emit(
            "nebula-tab-navigation-performance",
            TabNavigationPerformancePayload {
                label: label.to_string(),
                url,
                duration_ms: started_at.elapsed().as_millis(),
                success,
            },
        );
    }

    pub fn setup_tab_metadata(app: &AppHandle, label: &str) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") {
            return Ok(());
        }
        if CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            return Ok(());
        }

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let source_app = app.clone();
        let source_label = label.to_string();
        let title_app = app.clone();
        let title_label = label.to_string();
        let navigation_start_app = app.clone();
        let navigation_start_label = label.to_string();
        let navigation_complete_label = label.to_string();
        let navigation_complete_app = app.clone();
        let favicon_label = label.to_string();
        let favicon_app = app.clone();
        let initial_app = app.clone();
        let label_for_store = label.to_string();

        webview
            .with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };

                let source_handler =
                    SourceChangedEventHandler::create(Box::new(move |sender, _args| {
                        if let Some(webview) = sender {
                            emit_snapshot(&source_app, &source_label, &webview);
                        }
                        Ok(())
                    }));
                let title_handler =
                    DocumentTitleChangedEventHandler::create(Box::new(move |sender, _args| {
                        if let Some(webview) = sender {
                            emit_snapshot(&title_app, &title_label, &webview);
                        }
                        Ok(())
                    }));
                let navigation_start_handler =
                    NavigationStartingEventHandler::create(Box::new(move |_sender, _args| {
                        if let Ok(mut starts) = NAVIGATION_STARTED_AT.lock() {
                            starts.insert(navigation_start_label.clone(), Instant::now());
                        }
                        let _ = navigation_start_app.emit(
                            "nebula-tab-loading-state",
                            TabLoadingPayload {
                                label: navigation_start_label.clone(),
                                is_loading: true,
                            },
                        );
                        Ok(())
                    }));
                let navigation_complete_handler =
                    NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
                        let Some(webview) = sender else {
                            return Ok(());
                        };
                        let mut success = BOOL::default();
                        let success = args
                            .and_then(|args| {
                                args.IsSuccess(&mut success).ok().map(|_| success.as_bool())
                            })
                            .unwrap_or(false);
                        let _ = navigation_complete_app.emit(
                            "nebula-tab-loading-state",
                            TabLoadingPayload {
                                label: navigation_complete_label.clone(),
                                is_loading: false,
                            },
                        );
                        emit_navigation_performance(
                            &navigation_complete_app,
                            &navigation_complete_label,
                            &webview,
                            success,
                        );
                        request_favicon(
                            &navigation_complete_app,
                            &navigation_complete_label,
                            &webview,
                        );
                        Ok(())
                    }));
                let favicon_handler =
                    FaviconChangedEventHandler::create(Box::new(move |sender, _args| {
                        if let Some(webview) = sender {
                            request_favicon(&favicon_app, &favicon_label, &webview);
                        }
                        Ok(())
                    }));
                let mut source_token = 0i64;
                if core
                    .add_SourceChanged(&source_handler, &mut source_token)
                    .is_err()
                {
                    return;
                }
                let mut title_token = 0i64;
                if core
                    .add_DocumentTitleChanged(&title_handler, &mut title_token)
                    .is_err()
                {
                    let _ = core.remove_SourceChanged(source_token);
                    return;
                }
                let mut navigation_start_token = 0i64;
                if core
                    .add_NavigationStarting(&navigation_start_handler, &mut navigation_start_token)
                    .is_err()
                {
                    let _ = core.remove_SourceChanged(source_token);
                    let _ = core.remove_DocumentTitleChanged(title_token);
                    return;
                }
                let mut navigation_complete_token = 0i64;
                if core
                    .add_NavigationCompleted(
                        &navigation_complete_handler,
                        &mut navigation_complete_token,
                    )
                    .is_err()
                {
                    let _ = core.remove_SourceChanged(source_token);
                    let _ = core.remove_DocumentTitleChanged(title_token);
                    let _ = core.remove_NavigationStarting(navigation_start_token);
                    return;
                }

                let mut registered_favicon_handler = None;
                let favicon_token = core.cast::<ICoreWebView2_15>().ok().and_then(|core15| {
                    let mut token = 0i64;
                    if core15
                        .add_FaviconChanged(&favicon_handler, &mut token)
                        .is_ok()
                    {
                        registered_favicon_handler = Some(favicon_handler);
                        Some(token)
                    } else {
                        None
                    }
                });

                if let Ok(mut tokens) = HANDLER_TOKENS.lock() {
                    tokens.insert(
                        label_for_store.clone(),
                        (
                            source_token,
                            title_token,
                            navigation_start_token,
                            navigation_complete_token,
                            favicon_token,
                        ),
                    );
                }
                HANDLERS.with(|handlers| {
                    handlers.borrow_mut().insert(
                        label_for_store.clone(),
                        (
                            source_handler,
                            title_handler,
                            navigation_start_handler,
                            navigation_complete_handler,
                            registered_favicon_handler,
                        ),
                    );
                });

                emit_snapshot(&initial_app, &label_for_store, &core);
                request_favicon(&initial_app, &label_for_store, &core);
            })
            .map_err(|error| error.to_string())?;

        if !HANDLER_TOKENS
            .lock()
            .map_err(|error| error.to_string())?
            .contains_key(label)
        {
            return Err(format!(
                "failed to register metadata handlers for '{label}'"
            ));
        }
        CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string());
        Ok(())
    }

    pub fn teardown_tab_metadata(app: &AppHandle, label: &str) {
        let tokens = HANDLER_TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));
        let label_for_handler = label.to_string();

        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(move |inner| unsafe {
                if let (
                    Ok(core),
                    Some((
                        source_token,
                        title_token,
                        navigation_start_token,
                        navigation_complete_token,
                        favicon_token,
                    )),
                ) = (inner.controller().CoreWebView2(), tokens)
                {
                    let _ = core.remove_SourceChanged(source_token);
                    let _ = core.remove_DocumentTitleChanged(title_token);
                    let _ = core.remove_NavigationStarting(navigation_start_token);
                    let _ = core.remove_NavigationCompleted(navigation_complete_token);
                    if let (Some(token), Ok(core15)) =
                        (favicon_token, core.cast::<ICoreWebView2_15>())
                    {
                        let _ = core15.remove_FaviconChanged(token);
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
        if let Ok(mut snapshots) = LAST_SNAPSHOTS.lock() {
            snapshots.remove(label);
        }
        if let Ok(mut favicons) = FAVICON_CACHE.lock() {
            favicons.remove(label);
        }
        if let Ok(mut epochs) = FAVICON_REQUEST_EPOCHS.lock() {
            epochs.remove(label);
        }
        if let Ok(mut counts) = LAST_SOCIAL_UNREAD_COUNTS.lock() {
            counts.remove(label);
        }
        if let Ok(mut starts) = NAVIGATION_STARTED_AT.lock() {
            starts.remove(label);
        }
    }

    #[cfg(test)]
    mod tests {
        use super::usable_favicon_uri;

        #[test]
        fn favicon_uri_accepts_web_images_and_rejects_active_or_local_schemes() {
            assert_eq!(
                usable_favicon_uri("https://cdn.example/icon.svg").as_deref(),
                Some("https://cdn.example/icon.svg")
            );
            assert_eq!(
                usable_favicon_uri("http://example.test/favicon.ico").as_deref(),
                Some("http://example.test/favicon.ico")
            );
            assert!(usable_favicon_uri("javascript:alert(1)").is_none());
            assert!(usable_favicon_uri("file:///C:/secret.png").is_none());
            assert!(usable_favicon_uri("data:text/html;base64,PGgxPkJvb208L2gxPg==").is_none());
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{app_is_backgrounded, setup_tab_metadata, teardown_tab_metadata};

#[cfg(not(target_os = "windows"))]
pub fn setup_tab_metadata(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_tab_metadata(_app: &tauri::AppHandle, _label: &str) {}

#[cfg(not(target_os = "windows"))]
pub fn app_is_backgrounded(_app: &tauri::AppHandle) -> bool {
    false
}
