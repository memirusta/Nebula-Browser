#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::{LazyLock, Mutex};
    use std::time::Instant;

    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2DocumentTitleChangedEventHandler,
        ICoreWebView2NavigationCompletedEventHandler, ICoreWebView2NavigationStartingEventHandler,
        ICoreWebView2SourceChangedEventHandler,
    };
    use webview2_com::{
        DocumentTitleChangedEventHandler, NavigationCompletedEventHandler,
        NavigationStartingEventHandler, SourceChangedEventHandler,
    };
    use windows::core::PWSTR;
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOT};
    use windows_core::BOOL;

    type HandlerTokens = (i64, i64, i64, i64);

    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, HandlerTokens>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static NAVIGATION_STARTED_AT: LazyLock<Mutex<HashMap<String, Instant>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    thread_local! {
        static HANDLERS: RefCell<HashMap<String, (
            ICoreWebView2SourceChangedEventHandler,
            ICoreWebView2DocumentTitleChangedEventHandler,
            ICoreWebView2NavigationStartingEventHandler,
            ICoreWebView2NavigationCompletedEventHandler,
        )>> = RefCell::new(HashMap::new());
    }
    static LAST_SNAPSHOTS: LazyLock<Mutex<HashMap<String, (String, String)>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static LAST_SOCIAL_UNREAD_COUNTS: LazyLock<Mutex<HashMap<String, u64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    #[derive(Clone, Serialize)]
    struct TabSnapshotPayload {
        label: String,
        url: String,
        title: String,
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
        if let Ok(mut snapshots) = LAST_SNAPSHOTS.lock() {
            let next = (url.clone(), title.clone());
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
            },
        );
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

                if let Ok(mut tokens) = HANDLER_TOKENS.lock() {
                    tokens.insert(
                        label_for_store.clone(),
                        (
                            source_token,
                            title_token,
                            navigation_start_token,
                            navigation_complete_token,
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
                        ),
                    );
                });

                emit_snapshot(&initial_app, &label_for_store, &core);
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
                    )),
                ) = (inner.controller().CoreWebView2(), tokens)
                {
                    let _ = core.remove_SourceChanged(source_token);
                    let _ = core.remove_DocumentTitleChanged(title_token);
                    let _ = core.remove_NavigationStarting(navigation_start_token);
                    let _ = core.remove_NavigationCompleted(navigation_complete_token);
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
        if let Ok(mut counts) = LAST_SOCIAL_UNREAD_COUNTS.lock() {
            counts.remove(label);
        }
        if let Ok(mut starts) = NAVIGATION_STARTED_AT.lock() {
            starts.remove(label);
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
