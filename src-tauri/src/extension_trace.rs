//! Opt-in evidence trace for extension pages.
//!
//! Set `NEBULA_EXTENSION_TRACE` to a file path (the Extension Lab launcher does)
//! and every extension page Nebula opens records what its frames report: console
//! output, exceptions, failed requests, frame navigations and the `postMessage`
//! handshake. It exists to answer "why does this panel say it can't reach its
//! extension" with measurements instead of guesses. Without the variable nothing
//! is attached and no code in here runs.
//!
//! The only script injected is the fixed `TRACE_SCRIPT`; it never reads page
//! content, only message types and origins. URLs are logged without their query
//! string.

use serde_json::Value;
use std::path::PathBuf;

pub(crate) const TRACE_ENV: &str = "NEBULA_EXTENSION_TRACE";

/// Injected into every new document of the panel and of the frames it embeds.
const TRACE_SCRIPT: &str = r#"(() => {
  const tag = '[nebula-trace]';
  const log = (...a) => { try { console.debug(tag, ...a); } catch (_) {} };
  const where = (location.origin || '') + location.pathname;
  const top = window === window.top;
  log('document', where, top ? 'top' : 'frame');
  addEventListener('message', (e) => {
    let type = '';
    try { type = e.data && e.data.type; } catch (_) {}
    log('message received in', where, 'from', e.origin, 'type=' + type, 'ports=' + (e.ports ? e.ports.length : 0));
  }, true);
  if (top && typeof MessageChannel === 'function') {
    const Original = window.MessageChannel;
    window.MessageChannel = function () { log('MessageChannel created in', where); return new Original(); };
    window.MessageChannel.prototype = Original.prototype;
  }
  const describeRuntime = () => {
    const r = window.chrome && window.chrome.runtime;
    return r ? ('chrome.runtime present, sendMessage=' + typeof r.sendMessage + ', connect=' + typeof r.connect + ', id=' + (r.id || 'none')) : 'no chrome.runtime';
  };
  // A web page reaching its extension (externally_connectable): record each
  // call's shape (message type and key names only) and how it ended.
  const runtime = window.chrome && window.chrome.runtime;
  if (!top && runtime) {
    const shape = (a) => typeof a === 'string' ? a
      : (a && typeof a === 'object'
        ? 'object{' + Object.keys(a).slice(0, 8).join(',') + (typeof a.type === 'string' ? ' type=' + a.type : '') + '}'
        : typeof a);
    const wrap = (name) => {
      const original = runtime[name];
      if (typeof original !== 'function') return;
      try {
        runtime[name] = function (...args) {
          const describe = args.map(shape).join(' | ');
          log('runtime.' + name + ' called', describe);
          const last = args.length - 1;
          if (last >= 0 && typeof args[last] === 'function') {
            const callback = args[last];
            args[last] = function (...results) {
              const err = runtime.lastError;
              log('runtime.' + name + ' callback', err ? 'lastError=' + err.message : 'ok', 'results=' + results.map(shape).join(' | '));
              return callback.apply(this, results);
            };
          }
          let result;
          try { result = original.apply(this, args); } catch (e) {
            log('runtime.' + name + ' threw', String(e && e.message));
            throw e;
          }
          if (result && typeof result.then === 'function') {
            result.then((v) => log('runtime.' + name + ' resolved', shape(v)), (e) => log('runtime.' + name + ' rejected', String(e && e.message)));
          }
          if (name === 'connect' && result && result.onDisconnect) {
            result.onDisconnect.addListener(() => log('runtime.connect port disconnected', describe));
          }
          return result;
        };
      } catch (e) { log('could not wrap runtime.' + name, String(e && e.message)); }
    };
    wrap('sendMessage');
    wrap('connect');
  }
  const report = (label) => log(label, where, describeRuntime());
  report('runtime at start');
  addEventListener('DOMContentLoaded', () => report('runtime at DOMContentLoaded'));
  setTimeout(() => report('runtime after 3s'), 3000);
})();"#;

/// Registered inside an extension's service worker once it is ready. Logs the
/// shape of each external message sender (the question being measured is whether
/// WebView2 reports the hosting extension page as a browser tab). Never reads
/// message contents.
const SENDER_SCRIPT: &str = r#"(() => {
  if (self.__nebulaTraceSender) return 'already installed';
  self.__nebulaTraceSender = true;
  chrome.runtime.onMessageExternal.addListener((message, sender) => {
    const tab = sender && sender.tab;
    const origin = (value) => typeof value === 'string' ? value.split('/').slice(0, 4).join('/') : null;
    console.debug('[nebula-trace] external sender', JSON.stringify({
      messageType: message && typeof message.type === 'string' ? message.type : typeof message,
      origin: sender && sender.origin,
      frameId: sender && sender.frameId,
      hasTab: tab !== undefined,
      tabId: tab ? tab.id : null,
      tabUrl: tab ? origin(tab.url) : null,
      tabKeys: tab ? Object.keys(tab).slice(0, 14) : null,
      documentLifecycle: sender && sender.documentLifecycle,
    }));
  });
  return 'installed; onMessageExternal.addListener is ' + String(chrome.runtime.onMessageExternal.addListener).replace(/\s+/g, ' ').slice(0, 70);
})()"#;

/// True once an extension worker has its `chrome` namespace.
const WORKER_READY_SCRIPT: &str =
    "typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.onMessageExternal)";

/// One line in the trace file, when tracing is on. Used for events that are not
/// DevTools traffic, such as a window the host refused to open.
pub(crate) fn note(what: &str) {
    use std::io::Write;
    let Some(path) = log_path() else { return };
    let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    else {
        return;
    };
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0);
    let _ = writeln!(file, "{millis} [host] {}", clip(what));
}

pub(crate) fn log_path() -> Option<PathBuf> {
    let value = std::env::var_os(TRACE_ENV)?;
    let path = PathBuf::from(value);
    (!path.as_os_str().is_empty()).then_some(path)
}

fn without_query(url: &str) -> &str {
    url.split(['?', '#']).next().unwrap_or(url)
}

fn clip(text: &str) -> String {
    let flat: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect();
    if flat.chars().count() > 600 {
        format!("{}...", flat.chars().take(600).collect::<String>())
    } else {
        flat
    }
}

/// One short human-readable line for a DevTools event.
pub(crate) fn summarize(event: &str, params: &Value) -> String {
    let text = |value: &Value| value.as_str().unwrap_or_default().to_string();
    match event {
        "Runtime.consoleAPICalled" => {
            let args = params["args"]
                .as_array()
                .map(|args| {
                    args.iter()
                        .map(|arg| {
                            arg["value"]
                                .as_str()
                                .map(str::to_string)
                                .or_else(|| arg["description"].as_str().map(str::to_string))
                                .unwrap_or_else(|| arg["value"].to_string())
                        })
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .unwrap_or_default();
            format!("console.{} {}", text(&params["type"]), args)
        }
        "Runtime.exceptionThrown" => {
            let details = &params["exceptionDetails"];
            format!(
                "exception {} {} @{}",
                text(&details["text"]),
                text(&details["exception"]["description"]),
                without_query(details["url"].as_str().unwrap_or_default())
            )
        }
        "Log.entryAdded" => {
            let entry = &params["entry"];
            format!(
                "log.{} {} @{}",
                text(&entry["level"]),
                text(&entry["text"]),
                without_query(entry["url"].as_str().unwrap_or_default())
            )
        }
        "Network.responseReceived" => format!(
            "response {} {}",
            params["response"]["status"],
            without_query(params["response"]["url"].as_str().unwrap_or_default())
        ),
        "Network.loadingFailed" => format!(
            "request failed {} blocked={} {}",
            text(&params["errorText"]),
            text(&params["blockedReason"]),
            text(&params["requestId"])
        ),
        "Page.frameNavigated" => format!(
            "navigated {}",
            without_query(params["frame"]["url"].as_str().unwrap_or_default())
        ),
        "Target.attachedToTarget" => format!(
            "attached {} {}",
            text(&params["targetInfo"]["type"]),
            without_query(params["targetInfo"]["url"].as_str().unwrap_or_default())
        ),
        "Target.detachedFromTarget" => "detached".to_string(),
        other => other.to_string(),
    }
}

#[cfg(target_os = "windows")]
mod imp {
    use super::{clip, log_path, summarize, SENDER_SCRIPT, TRACE_SCRIPT, WORKER_READY_SCRIPT};
    use serde_json::{json, Value};
    use std::io::Write;
    use std::sync::mpsc::{channel, RecvTimeoutError};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
    use tauri::Manager;

    const EVENTS: &[&str] = &[
        "Runtime.consoleAPICalled",
        "Runtime.exceptionThrown",
        "Log.entryAdded",
        "Network.responseReceived",
        "Network.loadingFailed",
        "Page.frameNavigated",
        "Target.attachedToTarget",
        "Target.detachedFromTarget",
    ];
    /// Long enough to cover a panel being opened and used for a while.
    const TRACE_LIFETIME: Duration = Duration::from_secs(20 * 60);

    fn take(read: impl FnOnce(*mut windows_core::PWSTR) -> windows_core::Result<()>) -> String {
        let mut value = windows_core::PWSTR::null();
        if read(&mut value).is_err() || value.is_null() {
            return String::new();
        }
        let text = unsafe { value.to_string().unwrap_or_default() };
        unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(value.as_ptr().cast())) };
        text
    }

    fn now_ms() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    }

    /// Watch `label`'s WebView and every frame it embeds. A no-op unless the
    /// trace variable is set.
    ///
    /// Returns true when tracing took over the first navigation: the page must be
    /// traced from its first line, so it is only opened once the trace is in
    /// place. Navigating it from outside as well would race with that (a lost
    /// race left the panel on a blank page). False means the caller navigates.
    pub(crate) fn attach(app: &tauri::AppHandle, label: &str, url: &str) -> bool {
        let Some(path) = log_path() else { return false };
        let file = match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
        {
            Ok(file) => Arc::new(Mutex::new(file)),
            Err(_) => return false,
        };
        let write_line = {
            let file = file.clone();
            let label = label.to_string();
            move |session: &str, what: &str| {
                if let Ok(mut file) = file.lock() {
                    let session = if session.is_empty() {
                        "page"
                    } else {
                        &session[..session.len().min(6)]
                    };
                    let _ = writeln!(
                        file,
                        "{} [{}] [{}] {}",
                        now_ms(),
                        label,
                        session,
                        clip(what)
                    );
                }
            }
        };
        let app = app.clone();
        let label = label.to_string();
        let url = url.to_string();
        std::thread::spawn(move || {
            use crate::extension_worker::cdp;
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2DevToolsProtocolEventReceivedEventArgs2;
            use windows::core::{Interface, PCWSTR};

            let (sessions_tx, sessions_rx) = channel::<(String, bool)>();
            let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
            let logger = write_line.clone();
            let subscribe = app.get_webview(&label).map(|webview| {
                webview.with_webview(move |inner| unsafe {
                    let result = (|| -> windows_core::Result<()> {
                        let core = inner.controller().CoreWebView2()?;
                        for &name in EVENTS {
                            let event = windows_core::HSTRING::from(name);
                            let receiver =
                                core.GetDevToolsProtocolEventReceiver(PCWSTR(event.as_ptr()))?;
                            let logger = logger.clone();
                            let sessions = sessions_tx.clone();
                            let handler =
                                webview2_com::DevToolsProtocolEventReceivedEventHandler::create(
                                    Box::new(move |_, args| {
                                        let Some(args) = args else { return Ok(()) };
                                        let params = take(|v| args.ParameterObjectAsJson(v));
                                        let session = args
                                            .cast::<ICoreWebView2DevToolsProtocolEventReceivedEventArgs2>()
                                            .map(|a| take(|v| a.SessionId(v)))
                                            .unwrap_or_default();
                                        let parsed: Value =
                                            serde_json::from_str(&params).unwrap_or(Value::Null);
                                        if name == "Target.attachedToTarget" {
                                            if let Some(id) = parsed["sessionId"].as_str() {
                                                let info = &parsed["targetInfo"];
                                                let worker = info["type"] == "service_worker"
                                                    && info["url"]
                                                        .as_str()
                                                        .is_some_and(|url| {
                                                            url.starts_with("chrome-extension://")
                                                        });
                                                let _ = sessions.send((id.to_string(), worker));
                                            }
                                        }
                                        logger(&session, &summarize(name, &parsed));
                                        Ok(())
                                    }),
                                );
                            let mut token = 0i64;
                            receiver.add_DevToolsProtocolEventReceived(&handler, &mut token)?;
                        }
                        Ok(())
                    })();
                    let _ = ready_tx.send(result.map_err(|e| e.to_string()));
                })
            });
            match subscribe {
                Some(Ok(())) => {}
                _ => return,
            }
            if !matches!(ready_rx.recv_timeout(Duration::from_secs(5)), Ok(Ok(()))) {
                write_line("", "trace: could not subscribe to DevTools events");
                return;
            }

            let setup = |session: Option<&str>| {
                for (method, params) in [
                    ("Runtime.enable", json!({})),
                    ("Log.enable", json!({})),
                    ("Network.enable", json!({})),
                    ("Page.enable", json!({})),
                    (
                        "Page.addScriptToEvaluateOnNewDocument",
                        json!({ "source": TRACE_SCRIPT }),
                    ),
                    (
                        "Target.setAutoAttach",
                        json!({ "autoAttach": true, "waitForDebuggerOnStart": true, "flatten": true }),
                    ),
                ] {
                    // Workers have no Page domain and so on: a refusal is expected.
                    let _ = cdp(&app, &label, session, method, &params);
                }
                if session.is_some() {
                    // Targets attached above wait for a debugger: let them run.
                    let _ = cdp(
                        &app,
                        &label,
                        session,
                        "Runtime.runIfWaitingForDebugger",
                        &json!({}),
                    );
                }
            };

            setup(None);
            // Only now open the page, so its top document is traced from line one.
            let navigated = cdp(&app, &label, None, "Page.navigate", &json!({ "url": url }));
            write_line(
                "",
                &format!("trace: attached, navigated {}", navigated.is_ok()),
            );
            // Off this thread: waiting for a worker must not hold back the frames
            // queued behind it.
            let spawn_sender_listener = |session: String| {
                let (app, label, log) = (app.clone(), label.clone(), write_line.clone());
                std::thread::spawn(move || {
                    let deadline = Instant::now() + Duration::from_secs(10);
                    while Instant::now() < deadline {
                        let ready = cdp(
                            &app,
                            &label,
                            Some(&session),
                            "Runtime.evaluate",
                            &json!({ "expression": WORKER_READY_SCRIPT, "returnByValue": true }),
                        );
                        if ready.is_ok_and(|v| v["result"]["value"] == true) {
                            let outcome = cdp(
                                &app,
                                &label,
                                Some(&session),
                                "Runtime.evaluate",
                                &json!({ "expression": SENDER_SCRIPT, "returnByValue": true }),
                            );
                            log(
                                &session,
                                &format!(
                                    "trace: sender listener {}",
                                    outcome
                                        .map(|v| v["result"]["value"].to_string())
                                        .unwrap_or_else(|e| e)
                                ),
                            );
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    log(&session, "trace: worker never became ready");
                });
            };
            let started = Instant::now();
            while started.elapsed() < TRACE_LIFETIME {
                match sessions_rx.recv_timeout(Duration::from_secs(2)) {
                    Ok((session, worker)) => {
                        setup(Some(&session));
                        if worker {
                            spawn_sender_listener(session);
                        }
                    }
                    Err(RecvTimeoutError::Timeout) => {
                        if app.get_webview(&label).is_none() {
                            break;
                        }
                    }
                    Err(RecvTimeoutError::Disconnected) => break,
                }
            }
            write_line("", "trace: finished");
        });
        true
    }
}

#[cfg(target_os = "windows")]
pub(crate) use imp::attach;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn summaries_drop_query_strings() {
        let line = summarize(
            "Network.responseReceived",
            &json!({ "response": { "status": 200, "url": "https://claude.ai/api/x?token=secret#frag" } }),
        );
        assert_eq!(line, "response 200 https://claude.ai/api/x");
        let line = summarize(
            "Page.frameNavigated",
            &json!({ "frame": { "url": "https://claude.ai/cic/new?surface=cic_sidepanel" } }),
        );
        assert_eq!(line, "navigated https://claude.ai/cic/new");
    }

    #[test]
    fn console_arguments_are_joined() {
        let line = summarize(
            "Runtime.consoleAPICalled",
            &json!({ "type": "debug", "args": [{ "value": "[nebula-trace]" }, { "value": "message received" }] }),
        );
        assert_eq!(line, "console.debug [nebula-trace] message received");
    }

    #[test]
    fn long_lines_are_clipped_and_flattened() {
        assert_eq!(clip("a\nb"), "a b");
        assert!(clip(&"x".repeat(2000)).len() < 700);
    }

    #[test]
    fn the_injected_scripts_are_fixed_constants() {
        for script in [TRACE_SCRIPT, SENDER_SCRIPT, WORKER_READY_SCRIPT] {
            assert!(!script.contains("${") && !script.contains('`'));
        }
    }
}
