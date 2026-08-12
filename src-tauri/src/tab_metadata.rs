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
        if let Ok(mut starts) = NAVIGATION_STARTED_AT.lock() {
            starts.remove(label);
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{setup_tab_metadata, teardown_tab_metadata};

#[cfg(not(target_os = "windows"))]
pub fn setup_tab_metadata(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_tab_metadata(_app: &tauri::AppHandle, _label: &str) {}
