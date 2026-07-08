#[cfg(target_os = "windows")]
mod imp {
    use std::collections::{HashMap, HashSet};
    use std::sync::{Arc, LazyLock, Mutex};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::{
        AddScriptToExecuteOnDocumentCreatedCompletedHandler, ContainsFullScreenElementChangedEventHandler,
        ExecuteScriptCompletedHandler, WebMessageReceivedEventHandler,
    };
    use windows::core::PCWSTR;
    use windows_core::{BOOL, HSTRING};

    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static WEBMESSAGE_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    const FULLSCREEN_HOOK_SCRIPT: &str = r#"
(function () {
  if (window.__nebulaFsHook) return;
  window.__nebulaFsHook = true;
  function notify() {
    var fs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    try {
      window.chrome.webview.postMessage(
        JSON.stringify({ type: "nebula-fs", is_fullscreen: fs })
      );
    } catch (e) {}
  }
  document.addEventListener("fullscreenchange", notify, true);
  document.addEventListener("webkitfullscreenchange", notify, true);
})();
"#;

    #[derive(Clone, Serialize)]
    struct TabFullscreenPayload {
        label: String,
        is_fullscreen: bool,
    }

    fn emit_fullscreen(app: &AppHandle, label: &str, is_fullscreen: bool) {
        let _ = app.emit(
            "nebula-tab-fullscreen",
            TabFullscreenPayload {
                label: label.to_string(),
                is_fullscreen,
            },
        );
    }

    fn clear_tab_state(label: &str) {
        if let Ok(mut configured) = CONFIGURED_LABELS.lock() {
            configured.remove(label);
        }
        if let Ok(mut tokens) = HANDLER_TOKENS.lock() {
            tokens.remove(label);
        }
        if let Ok(mut tokens) = WEBMESSAGE_TOKENS.lock() {
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
        let registered_webmessage = Arc::new(Mutex::new(None::<i64>));

        let setup_result = webview.with_webview({
            let registered_token = Arc::clone(&registered_token);
            let registered_webmessage = Arc::clone(&registered_webmessage);
            let app_for_message = app_handle.clone();
            let tab_label_for_message = tab_label.clone();
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

                        emit_fullscreen(
                            &app_handle,
                            &label_for_handler,
                            contains_fullscreen.as_bool(),
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
                    tokens.insert(tab_label.clone(), token);
                }

                let _ = Box::leak(Box::new(handler));

                let label_for_webmessage = tab_label_for_message.clone();
                let webmessage_handler = WebMessageReceivedEventHandler::create(Box::new(
                    move |_sender, args| {
                        let Some(args) = args else {
                            return Ok(());
                        };

                        let mut message = windows::core::PWSTR::null();
                        if args.TryGetWebMessageAsString(&mut message).is_err() {
                            return Ok(());
                        }

                        let message = message.to_string().unwrap_or_default();
                        let Ok(value) = serde_json::from_str::<serde_json::Value>(&message) else {
                            return Ok(());
                        };

                        if value.get("type").and_then(|entry| entry.as_str()) != Some("nebula-fs")
                        {
                            return Ok(());
                        }

                        let is_fullscreen = value
                            .get("is_fullscreen")
                            .and_then(|entry| entry.as_bool())
                            .unwrap_or(false);

                        emit_fullscreen(&app_for_message, &label_for_webmessage, is_fullscreen);
                        Ok(())
                    },
                ));

                let mut webmessage_token: i64 = 0;
                if core
                    .add_WebMessageReceived(&webmessage_handler, &mut webmessage_token)
                    .is_err()
                {
                    return;
                }

                if let Ok(mut slot) = registered_webmessage.lock() {
                    *slot = Some(webmessage_token);
                }

                if let Ok(mut tokens) = WEBMESSAGE_TOKENS.lock() {
                    tokens.insert(tab_label_for_message.clone(), webmessage_token);
                }

                let _ = Box::leak(Box::new(webmessage_handler));

                let script_h = HSTRING::from(FULLSCREEN_HOOK_SCRIPT);
                let script_handler =
                    ExecuteScriptCompletedHandler::create(Box::new(|_result, _value| Ok(())));
                let _ = core.ExecuteScript(PCWSTR(script_h.as_ptr()), &script_handler);
                let _ = Box::leak(Box::new(script_handler));

                let doc_script_handler = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(
                    Box::new(|_error, _id| Ok(())),
                );
                let _ = core.AddScriptToExecuteOnDocumentCreated(
                    PCWSTR(script_h.as_ptr()),
                    &doc_script_handler,
                );
                let _ = Box::leak(Box::new(doc_script_handler));
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

        let webmessage_token = WEBMESSAGE_TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));

        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(move |inner| unsafe {
                if let Ok(core) = inner.controller().CoreWebView2() {
                    if let Some(token) = token {
                        let _ = core.remove_ContainsFullScreenElementChanged(token);
                    }
                    if let Some(token) = webmessage_token {
                        let _ = core.remove_WebMessageReceived(token);
                    }
                }
            });
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
