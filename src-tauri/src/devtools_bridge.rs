#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2DevToolsProtocolEventReceivedEventHandler,
        ICoreWebView2DevToolsProtocolEventReceiver,
    };
    use webview2_com::{
        CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler,
    };
    use windows::core::PCWSTR;
    use windows_core::{HSTRING, PWSTR};

    const DEVTOOLS_EVENT: &str = "nebula-devtools-event";
    const DEVTOOLS_EVENTS: &[&str] = &[
        "Runtime.consoleAPICalled",
        "Runtime.exceptionThrown",
        "Log.entryAdded",
        "Network.requestWillBeSent",
        "Network.responseReceived",
        "Network.loadingFailed",
        "Network.loadingFinished",
        "Page.domContentEventFired",
        "Page.loadEventFired",
        "Security.securityStateChanged",
    ];

    struct Subscription {
        receiver: ICoreWebView2DevToolsProtocolEventReceiver,
        _handler: ICoreWebView2DevToolsProtocolEventReceivedEventHandler,
        token: i64,
    }

    static SUBSCRIBED: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static CDP_CALL_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    thread_local! {
        static SUBSCRIPTIONS: RefCell<HashMap<String, Vec<Subscription>>> =
            RefCell::new(HashMap::new());
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct DevToolsEventPayload {
        tab_label: String,
        event: String,
        params_json: String,
        timestamp_ms: u64,
    }

    fn validate_label(label: &str) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") {
            return Err("DevTools access is limited to browser tabs".to_string());
        }
        Ok(())
    }

    fn timestamp_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis() as u64)
            .unwrap_or(0)
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

    pub fn call(
        app: &AppHandle,
        label: &str,
        method: &str,
        params_json: &str,
    ) -> Result<String, String> {
        validate_label(label)?;
        if method.trim().is_empty() {
            return Err("DevTools protocol method cannot be empty".to_string());
        }

        // WebView2 CDP calls are COM callbacks on the WebView thread.  Keep
        // Inspector traffic strictly serialized so opening F12 cannot queue a
        // burst of re-entrant CallDevToolsProtocolMethod calls against the same
        // controller.  This lock intentionally covers the completion wait.
        let _call_guard = CDP_CALL_LOCK
            .lock()
            .map_err(|_| "DevTools protocol call lock was poisoned".to_string())?;

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let method = method.to_string();
        let params_json = if params_json.trim().is_empty() {
            "{}".to_string()
        } else {
            params_json.to_string()
        };

        webview
            .with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    let _ = tx.send(Err("CoreWebView2 is unavailable".to_string()));
                    return;
                };

                let failure_tx = tx.clone();
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |result, value| {
                        let output = result
                            .map(|_| value)
                            .map_err(|error| error.to_string());
                        let _ = tx.send(output);
                        Ok(())
                    },
                ));
                let method_h = HSTRING::from(method);
                let params_h = HSTRING::from(params_json);
                if let Err(error) = core.CallDevToolsProtocolMethod(
                    PCWSTR(method_h.as_ptr()),
                    PCWSTR(params_h.as_ptr()),
                    &handler,
                ) {
                    let _ = failure_tx.send(Err(error.to_string()));
                }
            })
            .map_err(|error| error.to_string())?;

        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| "DevTools protocol call timed out".to_string())?
    }

    pub fn subscribe(app: &AppHandle, label: &str) -> Result<(), String> {
        validate_label(label)?;
        if SUBSCRIBED
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            return Ok(());
        }

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let subscription_label = label.to_string();
        let callback_label = subscription_label.clone();
        let app = app.clone();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);

        webview
            .with_webview(move |inner| unsafe {
                let result = (|| -> windows_core::Result<Vec<Subscription>> {
                    let core = inner.controller().CoreWebView2()?;
                    let mut subscriptions = Vec::new();

                    for &event_name in DEVTOOLS_EVENTS {
                        let event_h = HSTRING::from(event_name);
                        let receiver =
                            core.GetDevToolsProtocolEventReceiver(PCWSTR(event_h.as_ptr()))?;
                        let event_app = app.clone();
                        let event_label = callback_label.clone();
                        let event_name = event_name.to_string();
                        let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(
                            move |_, args| {
                                let Some(args) = args else { return Ok(()) };
                                let params_json =
                                    take_string(|value| args.ParameterObjectAsJson(value));
                                let _ = event_app.emit(
                                    DEVTOOLS_EVENT,
                                    DevToolsEventPayload {
                                        tab_label: event_label.clone(),
                                        event: event_name.clone(),
                                        params_json,
                                        timestamp_ms: timestamp_ms(),
                                    },
                                );
                                Ok(())
                            },
                        ));
                        let mut token = 0i64;
                        receiver.add_DevToolsProtocolEventReceived(&handler, &mut token)?;
                        subscriptions.push(Subscription {
                            receiver,
                            _handler: handler,
                            token,
                        });
                    }

                    Ok(subscriptions)
                })();

                let result = result
                    .map(|subscriptions| {
                        SUBSCRIPTIONS.with(|items| {
                            items
                                .borrow_mut()
                                .insert(subscription_label.clone(), subscriptions);
                        });
                    })
                    .map_err(|error| error.to_string());
                let _ = tx.send(result);
            })
            .map_err(|error| error.to_string())?;

        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| "timed out subscribing to DevTools events".to_string())??;
        SUBSCRIBED
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string());
        Ok(())
    }

    pub fn unsubscribe(app: &AppHandle, label: &str) -> Result<(), String> {
        validate_label(label)?;
        let label = label.to_string();
        if let Ok(mut subscribed) = SUBSCRIBED.lock() {
            subscribed.remove(&label);
        }
        if app.get_webview(&label).is_none() {
            return Ok(());
        }

        let webview = app
            .get_webview(&label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        webview
            .with_webview(move |_| {
                SUBSCRIPTIONS.with(|subscriptions| {
                    if let Some(items) = subscriptions.borrow_mut().remove(&label) {
                        for item in items {
                            unsafe {
                                let _ = item
                                    .receiver
                                    .remove_DevToolsProtocolEventReceived(item.token);
                            }
                        }
                    }
                });
                let _ = tx.send(());
            })
            .map_err(|error| error.to_string())?;
        rx.recv_timeout(Duration::from_secs(2))
            .map_err(|_| "timed out unsubscribing from DevTools events".to_string())?;
        Ok(())
    }

    pub fn teardown(app: &AppHandle, label: &str) {
        let _ = unsubscribe(app, label);
    }
}

#[cfg(target_os = "windows")]
pub use imp::{call, subscribe, teardown, unsubscribe};

#[cfg(not(target_os = "windows"))]
pub fn call(
    _app: &tauri::AppHandle,
    _label: &str,
    _method: &str,
    _params_json: &str,
) -> Result<String, String> {
    Ok("{}".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn subscribe(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn unsubscribe(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown(_app: &tauri::AppHandle, _label: &str) {}
