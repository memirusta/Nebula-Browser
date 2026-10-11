//! Reach an installed extension's service worker through the in-process
//! DevTools channel of a WebView the host already owns.
//!
//! This module exposes fixed, validated operations only. It never evaluates
//! caller-supplied code, so nothing reachable from web content or an extension
//! page can use it as a generic "run JavaScript in an extension" primitive.
use serde::Serialize;

/// Outcome of emulating a toolbar-icon click.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionClick {
    /// `chrome.action.onClicked` was dispatched to the extension's listeners.
    pub dispatched: bool,
    /// The extension had registered an `onClicked` listener. An action with no
    /// listener and no popup does nothing in Chrome either.
    pub has_listener: bool,
    /// The extension called `sidePanel.setPanelBehavior({openPanelOnActionClick:
    /// true})`: Chrome then opens the panel on a click and never calls a listener.
    pub open_panel_on_action_click: bool,
    /// The tab object handed to the listeners (a real tab of that profile).
    pub tab_id: Option<i64>,
    pub tab_url: Option<String>,
    /// `chrome.sidePanel.open()` was called while handling the click. Chrome
    /// requires a user gesture here that the host cannot forward, so the call is
    /// captured and the host opens the panel itself.
    pub side_panel_requested: bool,
    /// Path from `chrome.sidePanel.getOptions`, when the extension set one.
    pub side_panel_path: Option<String>,
    pub error: Option<String>,
}

/// The only script ever evaluated in a worker. Constant by design.
pub(crate) const CLICK_SCRIPT: &str = r#"(async () => {
  const out = { dispatched: false, hasListener: false, openPanelOnActionClick: false, tabId: null, tabUrl: null, sidePanelRequested: false, sidePanelPath: null, error: null };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const ready = () => typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;
  try {
    // A worker that was just started is listed before its extension APIs exist.
    for (let i = 0; i < 60 && !ready(); i++) await sleep(50);
    if (!ready()) { out.error = 'worker-not-ready'; return out; }
    const event = chrome.action && chrome.action.onClicked;
    if (!event || typeof event.dispatch !== 'function') { out.error = 'no-action-event'; return out; }
    // Listeners are registered while the worker's modules evaluate; wait for them.
    const listening = () => typeof event.hasListeners === 'function' && event.hasListeners();
    for (let i = 0; i < 50 && !listening(); i++) await sleep(50);
    out.hasListener = listening();

    // Hand the extension a real page: prefer an http(s) tab the extension can see.
    const isPage = (candidate) => typeof candidate.url === 'string' && /^https?:/i.test(candidate.url);
    let tabs = [];
    try { tabs = await chrome.tabs.query({}); } catch (_) {}
    let focused = [];
    try { focused = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); } catch (_) {}
    const active = tabs.filter((candidate) => candidate.active);
    const tab = active.find(isPage) || tabs.find(isPage) || focused[0] || active[0] || tabs[0] || null;
    if (tab) { out.tabId = tab.id; out.tabUrl = tab.url || null; }

    const panel = chrome.sidePanel;
    const hasPanel = !!panel && (chrome.runtime.getManifest().permissions || []).includes('sidePanel');
    if (hasPanel && typeof panel.getPanelBehavior === 'function') {
      try {
        const behavior = await panel.getPanelBehavior();
        out.openPanelOnActionClick = !!(behavior && behavior.openPanelOnActionClick);
      } catch (_) {}
    }
    if (out.openPanelOnActionClick) out.sidePanelRequested = true;

    const original = hasPanel && panel.open;
    if (original) panel.open = async () => { out.sidePanelRequested = true; };
    try {
      if (out.hasListener) {
        event.dispatch(tab || { id: -1, windowId: -1, index: 0, pinned: false, highlighted: false, active: true, incognito: false });
        out.dispatched = true;
        if (original && !out.sidePanelRequested) {
          const deadline = Date.now() + 600;
          while (Date.now() < deadline && !out.sidePanelRequested) await sleep(40);
        }
      }
    } finally { if (original) panel.open = original; }
    if (hasPanel && typeof panel.getOptions === 'function') {
      try {
        const options = await panel.getOptions(tab ? { tabId: tab.id } : {});
        if (options && options.enabled !== false && typeof options.path === 'string') out.sidePanelPath = options.path;
      } catch (_) {}
    }
  } catch (error) { out.error = String((error && error.message) || error).slice(0, 200); }
  return out;
})()"#;

/// Readiness probe, also constant. A just-started worker is listed as a target
/// before its global scope is complete: at that moment neither `chrome` nor even
/// `setTimeout` exists, so waiting has to be polled from outside the worker.
/// Who controls the browser's proxy, asked of an extension's own worker: what
/// `chrome.proxy.settings.get` answers for `levelOfControl`. Read-only and fixed.
pub(crate) const PROXY_CONTROL_SCRIPT: &str = "new Promise((resolve) => { try { chrome.proxy.settings.get({}, (details) => resolve(details ? details.levelOfControl : null)) } catch (error) { resolve(null) } })";
pub(crate) const READY_SCRIPT: &str = "typeof chrome !== 'undefined' && typeof setTimeout === 'function' && !!(chrome.runtime && chrome.runtime.id)";

/// A side-panel path from an extension is untrusted input. Keep only a plain
/// relative path inside the package: no scheme, no traversal, no query tricks.
pub(crate) fn safe_package_path(path: &str) -> Option<String> {
    let trimmed = path.trim().trim_start_matches('/');
    let without_query = trimmed.split(['?', '#']).next().unwrap_or_default();
    if without_query.is_empty()
        || without_query.len() > 200
        || without_query.contains(['\\', ':', '\0'])
        || without_query
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        || !without_query.to_ascii_lowercase().ends_with(".html")
    {
        return None;
    }
    Some(without_query.to_string())
}

#[cfg(target_os = "windows")]
mod imp {
    use super::{safe_package_path, ActionClick, CLICK_SCRIPT, PROXY_CONTROL_SCRIPT, READY_SCRIPT};
    use serde_json::{json, Value};
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant};
    use tauri::Manager;

    static CDP_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    /// One DevTools call from `label`'s WebView, optionally scoped to a session.
    /// Must run off the main thread: the completion arrives on it.
    pub(crate) fn cdp(
        app: &tauri::AppHandle,
        label: &str,
        session: Option<&str>,
        method: &str,
        params: &Value,
    ) -> Result<Value, String> {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_11;
        use windows::core::{Interface, PCWSTR};

        let _serialized = CDP_LOCK
            .lock()
            .map_err(|_| "Extension worker channel lock was poisoned".to_string())?;
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let session = session.map(str::to_string);
        let method = method.to_string();
        let params = params.to_string();
        app.get_webview(label)
            .ok_or("Extension profile window is unavailable")?
            .with_webview(move |inner| unsafe {
                let failure = tx.clone();
                let handler = webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(
                    Box::new(move |result, value| {
                        let _ = tx.send(result.map(|_| value).map_err(|e| e.to_string()));
                        Ok(())
                    }),
                );
                let method = windows_core::HSTRING::from(method);
                let params = windows_core::HSTRING::from(params);
                let outcome = inner.controller().CoreWebView2().and_then(|core| {
                    if let Some(session) = session {
                        let session = windows_core::HSTRING::from(session);
                        let core11: ICoreWebView2_11 = core.cast()?;
                        core11.CallDevToolsProtocolMethodForSession(
                            PCWSTR(session.as_ptr()),
                            PCWSTR(method.as_ptr()),
                            PCWSTR(params.as_ptr()),
                            &handler,
                        )
                    } else {
                        core.CallDevToolsProtocolMethod(
                            PCWSTR(method.as_ptr()),
                            PCWSTR(params.as_ptr()),
                            &handler,
                        )
                    }
                });
                if let Err(error) = outcome {
                    let _ = failure.send(Err(error.to_string()));
                }
            })
            .map_err(|e| e.to_string())?;
        let json = rx
            .recv_timeout(Duration::from_secs(8))
            .map_err(|_| "Extension worker call timed out".to_string())??;
        serde_json::from_str(&json).map_err(|e| e.to_string())
    }

    fn find_worker(
        app: &tauri::AppHandle,
        label: &str,
        prefix: &str,
    ) -> Result<Option<String>, String> {
        let targets = cdp(app, label, None, "Target.getTargets", &json!({}))?;
        Ok(targets["targetInfos"].as_array().and_then(|list| {
            list.iter()
                .find(|target| {
                    target["type"] == "service_worker"
                        && target["url"]
                            .as_str()
                            .is_some_and(|url| url.starts_with(prefix))
                })
                .and_then(|target| target["targetId"].as_str().map(str::to_string))
        }))
    }

    /// MV3 workers stop when idle and only running ones are listed as targets.
    pub(crate) fn ensure_worker(
        app: &tauri::AppHandle,
        label: &str,
        runtime_id: &str,
    ) -> Result<String, String> {
        let scope = format!("chrome-extension://{runtime_id}/");
        if let Some(id) = find_worker(app, label, &scope)? {
            return Ok(id);
        }
        // Not running: ask the browser to start it for this extension scope.
        let _ = cdp(app, label, None, "ServiceWorker.enable", &json!({}));
        cdp(
            app,
            label,
            None,
            "ServiceWorker.startWorker",
            &json!({ "scopeURL": scope }),
        )?;
        let deadline = Instant::now() + Duration::from_secs(4);
        while Instant::now() < deadline {
            if let Some(id) = find_worker(app, label, &scope)? {
                return Ok(id);
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        Err("The extension's background worker did not start".into())
    }

    fn wait_ready(app: &tauri::AppHandle, label: &str, session: &str) -> Result<(), String> {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let ready = cdp(
                app,
                label,
                Some(session),
                "Runtime.evaluate",
                &json!({ "expression": READY_SCRIPT, "returnByValue": true }),
            )
            .map(|value| value["result"]["value"] == true)
            .unwrap_or(false);
            if ready {
                return Ok(());
            }
            if Instant::now() >= deadline {
                return Err("The extension's background worker did not become ready".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    /// Waits until `expression` is true in the extension's background worker, starting
    /// the worker if it is not running. Polled from outside: a worker that has just been
    /// started is not complete yet, and an MV3 worker can stop at any moment (idle
    /// shutdown, a crash, a restart of the extension), so a lost session is not an error:
    /// the worker is found or started again and the wait goes on until `timeout`.
    /// Returns `Ok(false)` if the deadline passes first.
    pub(crate) fn wait_for_condition(
        app: &tauri::AppHandle,
        label: &str,
        runtime_id: &str,
        expression: &str,
        timeout: Duration,
    ) -> Result<bool, String> {
        let deadline = Instant::now() + timeout;
        let mut session: Option<String> = None;
        let mut met = false;
        while Instant::now() < deadline {
            if session.is_none() {
                session = attach_worker(app, label, runtime_id).ok();
            }
            if let Some(id) = &session {
                let outcome = cdp(
                    app,
                    label,
                    Some(id),
                    "Runtime.evaluate",
                    &json!({ "expression": expression, "returnByValue": true }),
                );
                match outcome {
                    Ok(value) if value["result"]["value"] == true => {
                        met = true;
                        break;
                    }
                    Ok(_) => {}
                    // The target went away under us: attach to whatever runs next.
                    Err(_) => session = None,
                }
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        if let Some(id) = session {
            let _ = cdp(
                app,
                label,
                None,
                "Target.detachFromTarget",
                &json!({ "sessionId": id }),
            );
        }
        Ok(met)
    }

    fn attach_worker(
        app: &tauri::AppHandle,
        label: &str,
        runtime_id: &str,
    ) -> Result<String, String> {
        let target_id = ensure_worker(app, label, runtime_id)?;
        let attached = cdp(
            app,
            label,
            None,
            "Target.attachToTarget",
            &json!({ "targetId": target_id, "flatten": true }),
        )?;
        attached["sessionId"]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| "The extension worker refused the connection".to_string())
    }

    /// Whether this extension controls the browser's proxy right now. `label` is a WebView
    /// in the profile the extension is installed in. Starts the extension's worker if it
    /// is not running; call it off the main thread.
    pub(crate) fn proxy_control(
        app: &tauri::AppHandle,
        label: &str,
        runtime_id: &str,
    ) -> Result<bool, String> {
        let session = attach_worker(app, label, runtime_id)?;
        let evaluated = wait_ready(app, label, &session).and_then(|()| {
            cdp(
                app,
                label,
                Some(&session),
                "Runtime.evaluate",
                &json!({ "expression": PROXY_CONTROL_SCRIPT, "returnByValue": true, "awaitPromise": true }),
            )
        });
        let _ = cdp(
            app,
            label,
            None,
            "Target.detachFromTarget",
            &json!({ "sessionId": session }),
        );
        Ok(evaluated?["result"]["value"] == "controlled_by_this_extension")
    }

    /// Emulate a click on the extension's toolbar icon. `label` is a WebView in
    /// the profile the extension is installed in; `runtime_id` is validated by
    /// the caller as a 32-character extension identifier.
    pub(crate) fn click_action(
        app: &tauri::AppHandle,
        label: &str,
        runtime_id: &str,
    ) -> Result<ActionClick, String> {
        let target_id = ensure_worker(app, label, runtime_id)?;
        let attached = cdp(
            app,
            label,
            None,
            "Target.attachToTarget",
            &json!({ "targetId": target_id, "flatten": true }),
        )?;
        let session = attached["sessionId"]
            .as_str()
            .ok_or("The extension worker refused the connection")?
            .to_string();
        let ready = wait_ready(app, label, &session);
        let evaluated = match ready {
            Ok(()) => cdp(
                app,
                label,
                Some(&session),
                "Runtime.evaluate",
                &json!({ "expression": CLICK_SCRIPT, "returnByValue": true, "awaitPromise": true }),
            ),
            Err(error) => Err(error),
        };
        let _ = cdp(
            app,
            label,
            None,
            "Target.detachFromTarget",
            &json!({ "sessionId": session }),
        );
        let evaluated = evaluated?;
        if let Some(details) = evaluated.get("exceptionDetails") {
            return Err(format!(
                "Extension worker raised an exception: {}",
                details["exception"]["description"]
                    .as_str()
                    .unwrap_or("unknown")
                    .chars()
                    .take(200)
                    .collect::<String>()
            ));
        }
        let value = &evaluated["result"]["value"];
        Ok(ActionClick {
            dispatched: value["dispatched"] == true,
            has_listener: value["hasListener"] == true,
            open_panel_on_action_click: value["openPanelOnActionClick"] == true,
            tab_id: value["tabId"].as_i64(),
            tab_url: value["tabUrl"].as_str().map(str::to_string),
            side_panel_requested: value["sidePanelRequested"] == true,
            side_panel_path: value["sidePanelPath"].as_str().and_then(safe_package_path),
            error: value["error"].as_str().map(str::to_string),
        })
    }
}

#[cfg(all(test, target_os = "windows", feature = "extension-native-smoke"))]
pub(crate) use imp::ensure_worker;
#[cfg(target_os = "windows")]
pub(crate) use imp::{cdp, click_action, proxy_control, wait_for_condition};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn side_panel_paths_stay_inside_the_package() {
        assert_eq!(
            safe_package_path("sidepanel.html"),
            Some("sidepanel.html".into())
        );
        assert_eq!(
            safe_package_path("/ui/panel.html?tab=1#x"),
            Some("ui/panel.html".into())
        );
        for hostile in [
            "",
            "../secret.html",
            "ui/../../x.html",
            "https://evil.example/p.html",
            "javascript:alert(1)",
            "C:\\\\Windows\\\\x.html",
            "ui\\\\panel.html",
            "panel.js",
            "ui//panel.html",
            "a\0b.html",
        ] {
            assert_eq!(safe_package_path(hostile), None, "{hostile:?}");
        }
    }

    #[test]
    fn the_worker_script_is_a_fixed_constant_without_placeholders() {
        // A `const`, with no template placeholders: no caller data can be
        // interpolated into what runs inside an extension worker.
        assert!(CLICK_SCRIPT.contains("chrome.action.onClicked"));
        for constant in [CLICK_SCRIPT, READY_SCRIPT, PROXY_CONTROL_SCRIPT] {
            assert!(!constant.contains("${") && !constant.contains('`'));
        }
        // Polled from Rust because a starting worker has no `setTimeout` yet.
        assert!(READY_SCRIPT.contains("typeof setTimeout"));
        // The proxy question only reads: it never sets or clears anything.
        assert!(PROXY_CONTROL_SCRIPT.contains("settings.get"));
        assert!(!PROXY_CONTROL_SCRIPT.contains("settings.set"));
        assert!(!PROXY_CONTROL_SCRIPT.contains("settings.clear"));
        assert!(!CLICK_SCRIPT.contains("${"));
        assert!(!CLICK_SCRIPT.contains("`"));
    }

    #[test]
    fn click_results_serialize_in_camel_case() {
        let json = serde_json::to_value(ActionClick {
            dispatched: true,
            side_panel_requested: true,
            ..ActionClick::default()
        })
        .unwrap();
        assert_eq!(json["dispatched"], true);
        assert_eq!(json["sidePanelRequested"], true);
        assert!(json.get("tabId").is_some());
    }
}
