#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::{Arc, LazyLock, Mutex};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2ContainsFullScreenElementChangedEventHandler,
        ICoreWebView2WebMessageReceivedEventArgs, ICoreWebView2WebMessageReceivedEventHandler,
    };
    use webview2_com::{
        AddScriptToExecuteOnDocumentCreatedCompletedHandler,
        ContainsFullScreenElementChangedEventHandler, ExecuteScriptCompletedHandler,
        WebMessageReceivedEventHandler,
    };
    use windows::core::PCWSTR;
    use windows_core::{BOOL, HSTRING, PWSTR};

    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static WEBMESSAGE_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    thread_local! {
        static HANDLERS: RefCell<HashMap<String, (ICoreWebView2ContainsFullScreenElementChangedEventHandler, ICoreWebView2WebMessageReceivedEventHandler)>> =
            RefCell::new(HashMap::new());
    }
    static LAST_FULLSCREEN_STATES: LazyLock<Mutex<HashMap<String, bool>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    const FULLSCREEN_FALLBACK_SCRIPT: &str = r#"
(function () {
  if (window.__nebulaFullscreenHookInstalled) return;
  window.__nebulaFullscreenHookInstalled = true;
  const nebulaWebMessageBridge = window.chrome && window.chrome.webview;
  try {
    Object.defineProperty(window.chrome, 'webview', {
      value: undefined,
      configurable: false,
      enumerable: false,
      writable: false
    });
  } catch (_) {
    try {
      const maskedChrome = Object.create(window.chrome || null);
      Object.defineProperty(maskedChrome, 'webview', { value: undefined });
      Object.defineProperty(window, 'chrome', { value: maskedChrome });
    } catch (_) {}
  }
  function notifyHost() {
    try { nebulaWebMessageBridge.postMessage('nebula-fullscreen-state-changed'); } catch (_) {}
  }
  document.addEventListener('fullscreenchange', notifyHost, true);
  document.addEventListener('webkitfullscreenchange', notifyHost, true);
})();
"#;

    unsafe fn web_message_string(args: &ICoreWebView2WebMessageReceivedEventArgs) -> String {
        let mut value = PWSTR::null();
        if args.TryGetWebMessageAsString(&mut value).is_err() || value.is_null() {
            return String::new();
        }
        let message = value.to_string().unwrap_or_default();
        windows::Win32::System::Com::CoTaskMemFree(Some(value.as_ptr().cast()));
        message
    }

    #[derive(Clone, Serialize)]
    struct TabFullscreenPayload {
        label: String,
        is_fullscreen: bool,
    }

    fn emit_fullscreen(app: &AppHandle, label: &str, is_fullscreen: bool) {
        let changed = LAST_FULLSCREEN_STATES
            .lock()
            .map(|mut states| {
                states.insert(label.to_string(), is_fullscreen) != Some(is_fullscreen)
            })
            .unwrap_or(true);
        if !changed {
            return;
        }
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
        if let Ok(mut states) = LAST_FULLSCREEN_STATES.lock() {
            states.remove(label);
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
            move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };

                let native_app = app_handle.clone();
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
                            &native_app,
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

                // Some sites (notably YouTube in affected WebView2 runtimes) update the
                // DOM fullscreen state without reliably raising the native changed event.
                // The page message is only a wake-up signal: never trust its payload.
                // Always read the authoritative fullscreen state back from WebView2.
                let fallback_app = app_handle.clone();
                let fallback_label = tab_label.clone();
                let webmessage_handler =
                    WebMessageReceivedEventHandler::create(Box::new(move |sender, args| {
                        let Some(webview) = sender else {
                            return Ok(());
                        };
                        let Some(args) = args else {
                            return Ok(());
                        };
                        if web_message_string(&args) != "nebula-fullscreen-state-changed"
                            || crate::site_ui::validated_web_message_source(&webview, &args)
                                .is_none()
                        {
                            return Ok(());
                        }
                        let mut contains_fullscreen = BOOL::default();
                        if webview
                            .ContainsFullScreenElement(&mut contains_fullscreen)
                            .is_err()
                        {
                            return Ok(());
                        }
                        emit_fullscreen(
                            &fallback_app,
                            &fallback_label,
                            contains_fullscreen.as_bool(),
                        );
                        Ok(())
                    }));

                let mut webmessage_token = 0i64;
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
                    tokens.insert(tab_label.clone(), webmessage_token);
                }
                HANDLERS.with(|handlers| {
                    handlers
                        .borrow_mut()
                        .insert(tab_label.clone(), (handler, webmessage_handler));
                });

                let script = HSTRING::from(FULLSCREEN_FALLBACK_SCRIPT);
                let execute_handler =
                    ExecuteScriptCompletedHandler::create(Box::new(|_result, _value| Ok(())));
                let _ = core.ExecuteScript(PCWSTR(script.as_ptr()), &execute_handler);

                let document_handler = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(
                    Box::new(|_result, _id| Ok(())),
                );
                let _ = core.AddScriptToExecuteOnDocumentCreated(
                    PCWSTR(script.as_ptr()),
                    &document_handler,
                );
            }
        });

        if let Err(error) = setup_result {
            teardown_tab_fullscreen(app, label);
            return Err(error.to_string());
        }

        let registered = registered_token.lock().ok().and_then(|slot| *slot);
        let fallback_registered = registered_webmessage.lock().ok().and_then(|slot| *slot);
        if registered.is_none() || fallback_registered.is_none() {
            teardown_tab_fullscreen(app, label);
            return Err(format!(
                "failed to register fullscreen handler for '{label}'"
            ));
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
        let label_for_handler = label.to_string();

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
                HANDLERS.with(|handlers| {
                    handlers.borrow_mut().remove(&label_for_handler);
                });
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
