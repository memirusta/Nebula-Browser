#[cfg(target_os = "windows")]
mod imp {
    use std::collections::{HashMap, HashSet};
    use std::sync::{Arc, LazyLock, Mutex};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::ContainsFullScreenElementChangedEventHandler;
    use windows_core::BOOL;

    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    #[derive(Clone, Serialize)]
    struct TabFullscreenPayload {
        label: String,
        is_fullscreen: bool,
    }

    fn clear_tab_state(label: &str) {
        if let Ok(mut configured) = CONFIGURED_LABELS.lock() {
            configured.remove(label);
        }
        if let Ok(mut tokens) = HANDLER_TOKENS.lock() {
            tokens.remove(label);
        }
    }

    pub fn setup_tab_fullscreen(app: &AppHandle, label: &str) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") {
            return Ok(());
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

        let app_handle = app.clone();
        let tab_label = label.to_string();
        let label_for_store = label.to_string();
        let registered_token = Arc::new(Mutex::new(None::<i64>));

        let setup_result = webview.with_webview({
            let registered_token = Arc::clone(&registered_token);
            move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };

                let label_for_handler = tab_label.clone();
                let handler = ContainsFullScreenElementChangedEventHandler::create(Box::new(
                    move |sender, _| {
                        let Some(webview) = sender else {
                            return Ok(());
                        };

                        let mut contains_fullscreen = BOOL::default();
                        if webview
                            .ContainsFullScreenElement(&mut contains_fullscreen)
                            .is_err()
                        {
                            return Ok(());
                        }

                        let _ = app_handle.emit(
                            "nebula-tab-fullscreen",
                            TabFullscreenPayload {
                                label: label_for_handler.clone(),
                                is_fullscreen: contains_fullscreen.as_bool(),
                            },
                        );
                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                if core
                    .add_ContainsFullScreenElementChanged(&handler, &mut token)
                    .is_err()
                {
                    return;
                }

                if let Ok(mut slot) = registered_token.lock() {
                    *slot = Some(token);
                }

                if let Ok(mut tokens) = HANDLER_TOKENS.lock() {
                    tokens.insert(tab_label, token);
                }

                // Keep the COM callback alive for the webview lifetime.
                let _ = Box::leak(Box::new(handler));
            }
        });

        if let Err(error) = setup_result {
            clear_tab_state(label);
            return Err(error.to_string());
        }

        let registered = registered_token
            .lock()
            .ok()
            .and_then(|slot| *slot);
        if registered.is_none() {
            clear_tab_state(label);
            return Err(format!("failed to register fullscreen handler for '{label}'"));
        }

        let mut configured = CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?;
        configured.insert(label_for_store);

        Ok(())
    }

    pub fn teardown_tab_fullscreen(app: &AppHandle, label: &str) {
        if !label.starts_with("nebula-tab-") {
            return;
        }

        let token = HANDLER_TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));

        if let Some(token) = token {
            if let Some(webview) = app.get_webview(label) {
                let _ = webview.with_webview(move |inner| unsafe {
                    if let Ok(core) = inner.controller().CoreWebView2() {
                        let _ = core.remove_ContainsFullScreenElementChanged(token);
                    }
                });
            }
        }

        clear_tab_state(label);
    }
}

#[cfg(target_os = "windows")]
pub use imp::{setup_tab_fullscreen, teardown_tab_fullscreen};

#[cfg(not(target_os = "windows"))]
pub fn setup_tab_fullscreen(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_tab_fullscreen(_app: &tauri::AppHandle, _label: &str) {}
