//! Real-WebView2 checks of how an extension worker sees extension UI.
//!
//! Chrome gives `sender.tab` only to senders living in a browser tab; popups and
//! side panels have none, and extensions rely on that. WebView2 has no browser UI,
//! so the window Nebula opens for an extension page is just another WebView and
//! is reported as a tab. `native_extension_sender_platform` records that (if it
//! ever fails, WebView2 changed and `extension_compat` can be retired).
//! `native_extension_sender_compat` asserts what Nebula provides on top of it.
//!
//! The setup mirrors Claude's side panel: an extension page that embeds a web
//! page which reaches the extension through `externally_connectable`.
use super::{script, wait_value};
use crate::extension_install::InstallationLocation;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Manager;

const MANIFEST: &str = r#"{
  "manifest_version": 3,
  "name": "Nebula sender probe",
  "version": "1.0.0",
  "permissions": ["tabs", "storage"],
  "host_permissions": ["http://127.0.0.1/*"],
  "externally_connectable": { "matches": ["http://127.0.0.1/*"] },
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [{ "matches": ["http://127.0.0.1/*"], "js": ["content.js"], "run_at": "document_idle" }]
}"#;

const BACKGROUND_JS: &str = r#"
const trim = (url) => String(url || '').split('?')[0];
const describe = async (sender, from) => {
  const tab = sender.tab;
  const out = { from, frameId: sender.frameId, senderUrl: trim(sender.url), hasTab: tab !== undefined };
  if (tab) out.tab = { id: tab.id, windowId: tab.windowId, active: tab.active, url: trim(tab.url) };
  try { out.allTabs = (await chrome.tabs.query({})).map((t) => ({ id: t.id, url: trim(t.url) })); }
  catch (e) { out.tabsError = String(e && e.message); }
  return out;
};
const answer = (store) => (message, sender, respond) => {
  if (!message || message.kind !== 'who') return;
  describe(sender, message.from).then(async (r) => {
    if (store) await chrome.storage.local.set({ [store]: r });
    respond(r);
  }, (e) => respond({ error: String(e) }));
  return true;
};
chrome.runtime.onMessage.addListener(answer(null));
chrome.runtime.onMessageExternal.addListener(answer('lastExternal'));
chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener(async (message) => {
    port.postMessage(await describe(port.sender, message.from));
  });
});
"#;

const CONTENT_JS: &str = r#"
chrome.runtime.sendMessage({ kind: 'who', from: 'content-script' })
  .then((r) => document.documentElement.setAttribute('data-who', JSON.stringify(r)));
"#;

const INNER_HTML: &str = "<!doctype html><title>inner</title><script src=\"inner.js\"></script>";
const INNER_JS: &str =
    "chrome.runtime.sendMessage({ kind: 'who', from: 'panel-iframe' }).then((r) => { window.__who = r; });\n\
     const port = chrome.runtime.connect();\n\
     port.onMessage.addListener((r) => { window.__port = r; });\n\
     port.postMessage({ from: 'panel-iframe-port' });";

// Popups the way real extensions write them: the page sets its own size.
const POPUP_HTML: &str = "<!doctype html><body style=\"margin:0\"><div style=\"width:300px;height:180px;background:#246\"></div>";
const BIG_POPUP_HTML: &str = "<!doctype html><body style=\"margin:0\"><div style=\"width:1000px;height:900px;background:#462\"></div>";
// No size of its own: it fills whatever window it is given.
const FLUID_POPUP_HTML: &str = "<!doctype html><body style=\"margin:0\"><div style=\"height:100vh;background:#624\">fluid</div>";

// A fractional height: at 125% scaling 180.4 css px is 225.5 device px.
const FRACTIONAL_POPUP_HTML: &str = "<!doctype html><html style=\"background:#fff\"><body style=\"margin:0\"><div style=\"width:300.6px;height:180.4px;background:#246\"></div>";

// Text that does not fit its 200px box: the page scrolls sideways although every
// element's box is only 200x50. The window must grow to what the page really needs.
const OVERFLOWING_POPUP_HTML: &str = "<!doctype html><body style=\"margin:0\"><div style=\"width:200px;height:50px;background:#246\"><span style=\"white-space:nowrap;font:14px monospace\">0123456789012345678901234567890123456789012345678901234567890123456789</span></div>";

// A decorative shape that overflows a clipping box: Bitwarden's welcome screen
// animates an <svg> whose shapes reach far outside it. What is cut off is not part
// of the page, so the window must be 300x150 however far the shapes reach.
const CLIPPED_POPUP_HTML: &str = "<!doctype html><body style=\"margin:0\"><div style=\"position:relative;width:300px;height:100px;overflow:hidden;background:#246\"><div style=\"position:absolute;left:0;top:0;width:2000px;height:2000px;background:#462\"></div></div><svg width=\"300\" height=\"50\" style=\"display:block\"><rect x=\"0\" y=\"0\" width=\"3000\" height=\"3000\" fill=\"#684\"/></svg>";

fn panel_html() -> String {
    "<!doctype html><title>panel</title><iframe id=\"ext\" src=\"inner.html\"></iframe>\
     <iframe id=\"web\"></iframe><script src=\"panel.js\"></script>"
        .into()
}

fn panel_js(base: &str) -> String {
    format!(
        "chrome.runtime.sendMessage({{ kind: 'who', from: 'panel-top' }}).then((r) => {{ window.__who = r; }});\n\
         document.getElementById('web').src = '{base}/frame?id=' + chrome.runtime.id;"
    )
}

/// The embedded web page: it reaches the extension the way claude.ai does.
const FRAME_PAGE: &str = "<!doctype html><title>frame</title><script>\
    const id = new URLSearchParams(location.search).get('id');\
    chrome.runtime.sendMessage(id, { kind: 'who', from: 'web-frame-in-panel' }).catch(() => {});\
    </script>";

fn fixture(root: PathBuf, base: &str, compat: bool) -> InstallationLocation {
    let panel_page = panel_html();
    let panel_script = panel_js(base);
    let entries: Vec<(PathBuf, Vec<u8>)> = [
        ("manifest.json", MANIFEST),
        ("background.js", BACKGROUND_JS),
        ("content.js", CONTENT_JS),
        ("panel.html", panel_page.as_str()),
        ("panel.js", panel_script.as_str()),
        ("inner.html", INNER_HTML),
        ("inner.js", INNER_JS),
        ("popup.html", POPUP_HTML),
        ("big.html", BIG_POPUP_HTML),
        ("fluid.html", FLUID_POPUP_HTML),
        ("frac.html", FRACTIONAL_POPUP_HTML),
        ("overflow.html", OVERFLOWING_POPUP_HTML),
        ("clipped.html", CLIPPED_POPUP_HTML),
    ]
    .into_iter()
    .map(|(name, body)| (PathBuf::from(name), body.as_bytes().to_vec()))
    .collect();
    // The production path: what an installed package goes through.
    let entries = if compat {
        let manifest: Value = serde_json::from_str(MANIFEST).unwrap();
        crate::extension_compat::apply(entries, &manifest)
            .unwrap()
            .0
    } else {
        entries
    };
    let folder =
        crate::extension_install::prepare_discovery_directory(&root, "1.0.0", entries).unwrap();
    InstallationLocation { root, folder }
}

fn wait_for(app: &tauri::AppHandle, label: &str, expression: &str) -> Value {
    wait_value(app, label, expression).unwrap_or_else(|e| json!({ "error": e }))
}

fn measure(
    handle: tauri::AppHandle,
    target: InstallationLocation,
    base: String,
) -> Result<Value, String> {
    std::fs::write(target.root.join("installed-folder"), "fixture-folder")
        .map_err(|e| e.to_string())?;
    crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "install".into(),
        None,
    )?;
    // A real web tab in the profile: its content script is the reference sender.
    handle
        .get_webview("extension-test")
        .ok_or("Missing test webview")?
        .navigate(format!("{base}/page").parse().unwrap())
        .map_err(|e| e.to_string())?;
    let content_script = wait_for(
        &handle,
        "extension-test",
        "(() => { const v = document.documentElement.getAttribute('data-who'); return v ? JSON.parse(v) : null; })()",
    );

    // The panel exactly as Nebula opens extension UI.
    let panel = "extension-ui-sender-panel";
    crate::extension_host::open_controls_page(
        &handle,
        ("extension-test", "extension-test"),
        panel,
        &target,
        "panel.html",
        false,
    )?;
    let top = wait_for(
        &handle,
        panel,
        "window.__who === undefined ? null : window.__who",
    );
    let extension_iframe = wait_for(
        &handle,
        panel,
        "(() => { const f = document.getElementById('ext'); return f && f.contentWindow && f.contentWindow.__who !== undefined ? f.contentWindow.__who : null; })()",
    );
    let port = wait_for(
        &handle,
        panel,
        "(() => { const f = document.getElementById('ext'); return f && f.contentWindow && f.contentWindow.__port !== undefined ? f.contentWindow.__port : null; })()",
    );
    // The web page reached the extension from inside the panel (Claude's case); the
    // worker stored what it saw.
    let deadline = Instant::now() + Duration::from_secs(15);
    let mut external = Value::Null;
    while external.is_null() && Instant::now() < deadline {
        let _ = script(
            &handle,
            panel,
            "globalThis.__ext = undefined; chrome.storage.local.get('lastExternal').then((v) => { globalThis.__ext = v.lastExternal || null; }); null",
        );
        std::thread::sleep(Duration::from_millis(400));
        external = script(&handle, panel, "globalThis.__ext ?? null").unwrap_or(Value::Null);
    }
    crate::extension_host::close_controls(&handle, "sender")?;
    crate::extension_install::operate(
        handle,
        "extension-test".into(),
        target,
        "remove".into(),
        None,
    )?;
    Ok(json!({
        "contentScript": content_script,
        "panelTopFrame": top,
        "panelExtensionIframe": extension_iframe,
        "panelExtensionIframePort": port,
        "webPageInsidePanel": external,
    }))
}

fn run_probe(compat: bool) -> Value {
    use std::io::{Read, Write};
    let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            deadline.recv_timeout(Duration::from_secs(150)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            eprintln!("Sender probe exceeded 150 seconds");
            std::process::exit(1);
        }
    });
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.local_addr().unwrap());
    let target = fixture(directory.path().join("sender"), &base, compat);
    server.set_nonblocking(true).unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    let server_thread = std::thread::spawn(move || {
        while !stopped.load(Ordering::Acquire) {
            if let Ok((mut connection, _)) = server.accept() {
                let _ = connection.set_read_timeout(Some(Duration::from_secs(2)));
                let mut bytes = [0; 4096];
                let read = connection.read(&mut bytes).unwrap_or(0);
                let request = String::from_utf8_lossy(&bytes[..read]);
                let body = if request.starts_with("GET /frame") {
                    FRAME_PAGE
                } else {
                    "<!doctype html><title>Probe page</title><body>Probe page"
                };
                let _ = write!(connection, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    });
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.nebula.extension-sender-test".into();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let app = tauri::Builder::default()
        .any_thread()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "extension-test",
                tauri::WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .data_directory(profile)
            .browser_extensions_enabled(true)
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = measure(handle.clone(), target, base);
                let _ = tx.send(result);
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    app.run_return(|_, _| {});
    stop.store(true, Ordering::Release);
    server_thread.join().unwrap();
    let report = rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    let name = if compat { "compat" } else { "platform" };
    let output = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join(format!("target/extension-sender-{name}.json"));
    std::fs::write(&output, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    println!("report: {}", output.display());
    report
}

/// What is true of WebView2 itself, before Nebula does anything.
#[test]
#[ignore = "Starts hidden WebView2 windows with a temporary profile; needs a Windows desktop session"]
fn native_extension_sender_platform() {
    let report = run_probe(false);
    // The reference: a real web tab has a tab.
    assert_eq!(report["contentScript"]["hasTab"], true, "{report}");
    // WebView2 reports extension UI as tabs, for the page and for every frame in it.
    for key in [
        "panelTopFrame",
        "panelExtensionIframe",
        "panelExtensionIframePort",
        "webPageInsidePanel",
    ] {
        assert_eq!(
            report[key]["hasTab"], true,
            "{key}: WebView2 no longer reports extension UI as a tab; retire extension_compat. {report}"
        );
        assert!(
            report[key]["tab"]["url"]
                .as_str()
                .is_some_and(|u| u.ends_with("/panel.html")),
            "{key}: {report}"
        );
    }
}

/// What Nebula provides: Chrome's sender shape for the extension's own UI, with
/// real tabs untouched.
#[test]
#[ignore = "Starts hidden WebView2 windows with a temporary profile; needs a Windows desktop session"]
fn native_extension_sender_compat() {
    let report = run_probe(true);
    // Real tabs are unaffected.
    assert_eq!(report["contentScript"]["hasTab"], true, "{report}");
    assert!(
        report["contentScript"]["tab"]["url"]
            .as_str()
            .is_some_and(|u| u.starts_with("http://127.0.0.1")),
        "{report}"
    );
    // The extension's own UI looks as it does in Chrome, whichever way it messages:
    // runtime.sendMessage from its page, from a frame in it, a long-lived port, and
    // a web page embedded in it reaching the extension externally (Claude's case).
    for key in [
        "panelTopFrame",
        "panelExtensionIframe",
        "panelExtensionIframePort",
        "webPageInsidePanel",
    ] {
        assert_eq!(
            report[key]["hasTab"], false,
            "{key} still carries sender.tab: {report}"
        );
        assert!(
            report[key]["senderUrl"].is_string(),
            "{key}: the worker did not answer: {report}"
        );
    }
}

/// Nebula's browser windows hold a chrome WebView and tab WebViews under
/// different labels, so Tauri does not treat them as "webview windows". The
/// panel must still be owned by such a window: an unowned, taskbar-less panel
/// cannot be reached with Alt+Tab or the taskbar and is lost behind other apps.
fn ownership_probe(
    handle: tauri::AppHandle,
    target: InstallationLocation,
) -> Result<Value, String> {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindow, GW_OWNER};
    std::fs::write(target.root.join("installed-folder"), "fixture-folder")
        .map_err(|e| e.to_string())?;
    crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "install".into(),
        None,
    )?;
    let panel = "extension-ui-owned-panel";
    crate::extension_host::open_controls_page(
        &handle,
        ("browser-window", "extension-test"),
        panel,
        &target,
        "panel.html",
        false,
    )?;
    let owner = handle
        .get_window("browser-window")
        .ok_or("Missing owner window")?
        .hwnd()
        .map_err(|e| e.to_string())?;
    let panel_hwnd = handle
        .get_webview_window(panel)
        .ok_or("Missing panel")?
        .hwnd()
        .map_err(|e| e.to_string())?;
    let actual = unsafe { GetWindow(panel_hwnd, GW_OWNER) }.unwrap_or_default();
    let multi_webview = handle.get_webview_window("browser-window").is_none();
    crate::extension_host::close_controls(&handle, "owned")?;
    Ok(json!({
        "ownerIsMultiWebview": multi_webview,
        "ownerHwnd": owner.0 as usize,
        "panelOwnerHwnd": actual.0 as usize,
    }))
}

#[test]
#[ignore = "Starts hidden WebView2 windows with a temporary profile; needs a Windows desktop session"]
fn native_extension_panel_is_owned_by_a_multi_webview_window() {
    let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            deadline.recv_timeout(Duration::from_secs(120)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            eprintln!("Ownership probe exceeded 120 seconds");
            std::process::exit(1);
        }
    });
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let target = fixture(directory.path().join("sender"), "http://127.0.0.1:1", false);
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.nebula.extension-owner-test".into();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let app = tauri::Builder::default()
        .any_thread()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "extension-test",
                tauri::WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .data_directory(profile)
            .browser_extensions_enabled(true)
            .build()?;
            // A Nebula-shaped browser window: two WebViews with their own labels.
            let window = tauri::window::WindowBuilder::new(app, "browser-window")
                .visible(false)
                .build()?;
            for label in ["browser-chrome", "nebula-tab-1"] {
                window.add_child(
                    tauri::webview::WebviewBuilder::new(
                        label,
                        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
                    ),
                    tauri::LogicalPosition::new(0.0, 0.0),
                    tauri::LogicalSize::new(100.0, 100.0),
                )?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = ownership_probe(handle.clone(), target);
                let _ = tx.send(result);
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    app.run_return(|_, _| {});
    let report = rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    println!("{report}");
    assert_eq!(
        report["ownerIsMultiWebview"], true,
        "the owner must be Nebula-shaped for this test to mean anything: {report}"
    );
    assert_ne!(report["ownerHwnd"], 0, "{report}");
    assert_eq!(
        report["panelOwnerHwnd"], report["ownerHwnd"],
        "the extension panel is not owned by its browser window: {report}"
    );
}

/// What size a popup window settles at, in logical pixels.
fn settled_size(
    handle: &tauri::AppHandle,
    label: &str,
    expected: (f64, f64),
) -> Result<(f64, f64), (f64, f64)> {
    let deadline = Instant::now() + Duration::from_secs(12);
    let mut last = (0.0, 0.0);
    while Instant::now() < deadline {
        if let Some(window) = handle.get_webview_window(label) {
            let scale = window.scale_factor().unwrap_or(1.0);
            if let Ok(inner) = window.inner_size() {
                last = (inner.width as f64 / scale, inner.height as f64 / scale);
                if (last.0 - expected.0).abs() <= 4.0 && (last.1 - expected.1).abs() <= 4.0 {
                    return Ok(last);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Err(last)
}

fn popup_probe(handle: tauri::AppHandle, target: InstallationLocation) -> Result<Value, String> {
    std::fs::write(target.root.join("installed-folder"), "fixture-folder")
        .map_err(|e| e.to_string())?;
    crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "install".into(),
        None,
    )?;
    let mut report = serde_json::Map::new();
    for (label, page, expected) in [
        // Smaller than the old fixed 420x560: the window must shrink to it.
        ("extension-ui-sized-popup", "popup.html", (300.0, 180.0)),
        // Larger than Chrome allows: it stops at 800x600.
        ("extension-ui-big-popup", "big.html", (800.0, 600.0)),
        // No size of its own: the window keeps the default.
        ("extension-ui-fluid-popup", "fluid.html", (420.0, 560.0)),
    ] {
        crate::extension_host::open_controls_page(
            &handle,
            ("extension-test", "extension-test"),
            label,
            &target,
            page,
            false,
        )?;
        let outcome = settled_size(&handle, label, expected);
        report.insert(
            label.into(),
            json!({ "expected": [expected.0, expected.1], "settled": outcome.is_ok(), "size": match outcome { Ok(s) | Err(s) => [s.0, s.1] } }),
        );
    }
    // A window a fraction of a device pixel taller than the page shows the page's
    // white canvas as a thin line along the bottom edge: it must not be taller.
    crate::extension_host::open_controls_page(
        &handle,
        ("extension-test", "extension-test"),
        "extension-ui-fractional-popup",
        &target,
        "frac.html",
        false,
    )?;
    let fractional = settled_size(&handle, "extension-ui-fractional-popup", (300.0, 180.0));
    let window = handle
        .get_webview_window("extension-ui-fractional-popup")
        .ok_or("Missing popup")?;
    let scale = window.scale_factor().unwrap_or(1.0);
    let physical = window.inner_size().map_err(|e| e.to_string())?;
    report.insert(
        "fractionalPopup".into(),
        json!({
            "settled": fractional.is_ok(),
            "scale": scale,
            "windowDevicePixels": [physical.width, physical.height],
            "contentDevicePixels": [300.6 * scale, 180.4 * scale],
        }),
    );
    // No scroll bars on a page that fits (the window is rounded down, so a fraction of
    // a pixel overflows), and the bars stay when the page really exceeds the limit.
    let viewport = |label: &str| -> Result<Value, String> {
        crate::extension_worker::cdp(
            &handle,
            label,
            None,
            "Runtime.evaluate",
            &json!({ "expression": "[document.documentElement.clientWidth, document.documentElement.clientHeight, window.innerWidth, window.innerHeight]", "returnByValue": true }),
        )
        .map(|v| v["result"]["value"].clone())
    };
    report.insert(
        "fractionalViewport".into(),
        viewport("extension-ui-fractional-popup")?,
    );
    report.insert("bigViewport".into(), viewport("extension-ui-big-popup")?);
    crate::extension_host::open_controls_page(
        &handle,
        ("extension-test", "extension-test"),
        "extension-ui-clipped-popup",
        &target,
        "clipped.html",
        false,
    )?;
    let clipped_size = settled_size(&handle, "extension-ui-clipped-popup", (300.0, 150.0));
    report.insert(
        "clippedWindow".into(),
        json!(match clipped_size {
            Ok(s) | Err(s) => [s.0, s.1],
        }),
    );
    // A page that overflows its own boxes: the window grows to fit, no bars, no cut.
    crate::extension_host::open_controls_page(
        &handle,
        ("extension-test", "extension-test"),
        "extension-ui-overflow-popup",
        &target,
        "overflow.html",
        false,
    )?;
    std::thread::sleep(Duration::from_secs(4));
    report.insert(
        "overflowViewport".into(),
        crate::extension_worker::cdp(
            &handle,
            "extension-ui-overflow-popup",
            None,
            "Runtime.evaluate",
            &json!({ "expression": "[document.documentElement.clientWidth, document.documentElement.scrollWidth, window.innerWidth]", "returnByValue": true }),
        )
        .map(|v| v["result"]["value"].clone())?,
    );
    // Popups are frameless boxes like Chrome's; panels keep their window frame.
    report.insert(
        "popupIsFrameless".into(),
        json!(!handle
            .get_webview_window("extension-ui-sized-popup")
            .ok_or("Missing popup")?
            .is_decorated()
            .map_err(|e| e.to_string())?),
    );
    // An options page that was not declared to open in a tab follows its content,
    // within its own limits (at least 320x240 here: the content is 300x180).
    crate::extension_host::open_controls_page(
        &handle,
        ("extension-test", "extension-test"),
        "extension-ui-embedded-options",
        &target,
        "popup.html",
        false,
    )?;
    let options = settled_size(&handle, "extension-ui-embedded-options", (320.0, 240.0));
    report.insert(
        "embeddedOptions".into(),
        json!({ "settled": options.is_ok(), "size": match options { Ok(s) | Err(s) => [s.0, s.1] } }),
    );
    // A page that asks for a 300x300 window gets 300x300, not the default.
    crate::extension_worker::cdp(
        &handle,
        "extension-ui-sized-popup",
        None,
        "Runtime.evaluate",
        &json!({ "expression": "window.open('about:blank', '', 'popup,width=300,height=300'); null", "userGesture": true }),
    )?;
    let requested_window = {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let found = handle
                .webview_windows()
                .into_keys()
                .find(|label| label.starts_with("extension-auth-extension-ui-sized-popup-"));
            if found.is_some() || Instant::now() >= deadline {
                break found;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    };
    if let Some(label) = requested_window {
        let size = settled_size(&handle, &label, (300.0, 300.0));
        report.insert(
            "windowOpenedAs300x300".into(),
            json!({ "settled": size.is_ok(), "size": match size { Ok(s) | Err(s) => [s.0, s.1] } }),
        );
    }
    // A panel is not a popup: it must keep its size whatever it contains.
    crate::extension_host::open_controls_page(
        &handle,
        ("extension-test", "extension-test"),
        "extension-ui-sized-side-panel",
        &target,
        "popup.html",
        false,
    )?;
    std::thread::sleep(Duration::from_secs(3));
    let panel = handle
        .get_webview_window("extension-ui-sized-side-panel")
        .ok_or("Missing panel")?;
    let scale = panel.scale_factor().unwrap_or(1.0);
    let inner = panel.inner_size().map_err(|e| e.to_string())?;
    report.insert(
        "sidePanelIsFramed".into(),
        json!(panel.is_decorated().map_err(|e| e.to_string())?),
    );
    report.insert(
        "sidePanelKeepsItsSize".into(),
        json!([inner.width as f64 / scale, inner.height as f64 / scale]),
    );
    crate::extension_host::close_controls(&handle, "sized")?;
    Ok(Value::Object(report))
}

#[test]
#[ignore = "Starts hidden WebView2 windows with a temporary profile; needs a Windows desktop session"]
fn native_extension_popup_follows_its_content() {
    let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            deadline.recv_timeout(Duration::from_secs(180)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            eprintln!("Popup size probe exceeded 180 seconds");
            std::process::exit(1);
        }
    });
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let target = fixture(directory.path().join("sender"), "http://127.0.0.1:1", false);
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.nebula.extension-popup-test".into();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let app = tauri::Builder::default()
        .any_thread()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "extension-test",
                tauri::WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .data_directory(profile)
            .browser_extensions_enabled(true)
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = popup_probe(handle.clone(), target);
                let _ = tx.send(result);
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    app.run_return(|_, _| {});
    let report = rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    for label in [
        "extension-ui-sized-popup",
        "extension-ui-big-popup",
        "extension-ui-fluid-popup",
    ] {
        assert_eq!(report[label]["settled"], true, "{label}: {report}");
    }
    // Fits: the page's visible area is the whole window, so no scroll bar takes room.
    let fits = &report["fractionalViewport"];
    assert!(
        (fits[0].as_f64().unwrap() - fits[2].as_f64().unwrap()).abs() <= 1.0
            && (fits[1].as_f64().unwrap() - fits[3].as_f64().unwrap()).abs() <= 1.0,
        "a page that fits shows scroll bars: {report}"
    );
    // The window grew to the text (about 590px) instead of cutting it off.
    let overflow = &report["overflowViewport"];
    assert!(
        overflow[2].as_f64().unwrap() > 300.0
            && overflow[1].as_f64().unwrap() - overflow[0].as_f64().unwrap() <= 1.5,
        "a page whose text overflows its box was cut off: {report}"
    );
    // Shapes that a clipping box cuts off do not count toward the page's size.
    let clipped = &report["clippedWindow"];
    assert!(
        (clipped[0].as_f64().unwrap() - 300.0).abs() <= 4.0
            && (clipped[1].as_f64().unwrap() - 150.0).abs() <= 4.0,
        "a clipped decorative overflow made the window the wrong size: {report}"
    );
    // Too big for the limit: the bars are back so it can be scrolled.
    let big = &report["bigViewport"];
    assert!(
        big[0].as_f64().unwrap() < big[2].as_f64().unwrap()
            || big[1].as_f64().unwrap() < big[3].as_f64().unwrap(),
        "a page larger than the limit cannot be scrolled: {report}"
    );
    assert_eq!(report["popupIsFrameless"], true, "{report}");
    assert_eq!(report["sidePanelIsFramed"], true, "{report}");
    let fractional = &report["fractionalPopup"];
    assert_eq!(fractional["settled"], true, "{report}");
    assert!(
        fractional["windowDevicePixels"][1].as_f64().unwrap()
            <= fractional["contentDevicePixels"][1].as_f64().unwrap() + 1e-6
            && fractional["windowDevicePixels"][0].as_f64().unwrap()
                <= fractional["contentDevicePixels"][0].as_f64().unwrap() + 1e-6,
        "the window is taller or wider than its content, so the page canvas shows: {report}"
    );
    assert_eq!(report["embeddedOptions"]["settled"], true, "{report}");
    assert_eq!(report["windowOpenedAs300x300"]["settled"], true, "{report}");
    let side = &report["sidePanelKeepsItsSize"];
    // The page is only 300x180, yet the panel is its own size (400 wide, docked
    // profile): it does not shrink to content as a popup does.
    assert!(
        (side[0].as_f64().unwrap() - 400.0).abs() <= 4.0 && side[1].as_f64().unwrap() >= 300.0,
        "a side panel must not follow its content: {report}"
    );
}

/// Every file under `root`, as package entries.
pub(super) fn folder_entries(root: &std::path::Path) -> Vec<(PathBuf, Vec<u8>)> {
    let mut entries = Vec::new();
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for item in std::fs::read_dir(&directory).unwrap() {
            let path = item.unwrap().path();
            if path.is_dir() {
                pending.push(path);
            } else {
                entries.push((
                    path.strip_prefix(root).unwrap().to_path_buf(),
                    std::fs::read(&path).unwrap(),
                ));
            }
        }
    }
    entries
}

const POPUP_DIAGNOSTIC: &str = r#"(() => {
  const b = document.body, h = document.documentElement;
  const br = b.getBoundingClientRect(), hr = h.getBoundingClientRect();
  const bs = getComputedStyle(b), hs = getComputedStyle(h);
  let maxBottom = 0, maxBottomEl = '', maxRight = 0, maxRightEl = '';
  for (const n of b.querySelectorAll('*')) {
    const r = n.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const tag = n.tagName + '#' + n.id + '.' + String(n.className && n.className.baseVal !== undefined ? n.className.baseVal : n.className).slice(0, 40);
    if (r.bottom > maxBottom) { maxBottom = r.bottom; maxBottomEl = tag; }
    if (r.right > maxRight) { maxRight = r.right; maxRightEl = tag; }
  }
  return {
    viewport: [h.clientWidth, h.clientHeight], innerHeight,
    body: { w: br.width, h: br.height, top: br.top, bottom: br.bottom, margin: [bs.marginTop, bs.marginBottom], padding: [bs.paddingTop, bs.paddingBottom], overflow: bs.overflow, minHeight: bs.minHeight, maxHeight: bs.maxHeight, background: bs.backgroundColor },
    html: { h: hr.height, background: hs.backgroundColor, overflow: hs.overflow },
    scroll: [h.scrollWidth, h.scrollHeight],
    maxBottom, maxBottomEl, maxRight, maxRightEl,
  };
})()"#;

/// Diagnostic, not a contract: opens a real installed extension's popup from a
/// COPY of its folder in a temporary profile and prints how the page measures.
/// `NEBULA_POPUP_SOURCE` is the version folder, `NEBULA_POPUP_PAGE` its popup path.
#[test]
#[ignore = "Diagnostic: needs NEBULA_POPUP_SOURCE and a Windows desktop session"]
fn native_extension_popup_measure_real_page() {
    let source = PathBuf::from(std::env::var("NEBULA_POPUP_SOURCE").expect("NEBULA_POPUP_SOURCE"));
    let page = std::env::var("NEBULA_POPUP_PAGE").unwrap_or_else(|_| "popup.html".into());
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let root = directory.path().join("real");
    let folder = crate::extension_install::prepare_discovery_directory(
        &root,
        "1.0.0",
        folder_entries(&source),
    )
    .unwrap();
    let target = InstallationLocation { root, folder };
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.nebula.extension-popup-real".into();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let app = tauri::Builder::default()
        .any_thread()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "extension-test",
                tauri::WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .data_directory(profile)
            .browser_extensions_enabled(true)
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = (|| -> Result<Value, String> {
                    std::fs::write(target.root.join("installed-folder"), "fixture-folder")
                        .map_err(|e| e.to_string())?;
                    crate::extension_install::operate(
                        handle.clone(),
                        "extension-test".into(),
                        target.clone(),
                        "install".into(),
                        None,
                    )?;
                    let label = "extension-ui-real-popup";
                    crate::extension_host::open_controls_page(
                        &handle,
                        ("extension-test", "extension-test"),
                        label,
                        &target,
                        &page,
                        false,
                    )?;
                    std::thread::sleep(Duration::from_secs(6));
                    let window = handle.get_webview_window(label).ok_or("popup closed")?;
                    let scale = window.scale_factor().unwrap_or(1.0);
                    let inner = window.inner_size().map_err(|e| e.to_string())?;
                    let measured = crate::extension_worker::cdp(
                        &handle,
                        label,
                        None,
                        "Runtime.evaluate",
                        &json!({ "expression": crate::extension_popup_size::MEASURE_SCRIPT, "returnByValue": true }),
                    )?;
                    let details = crate::extension_worker::cdp(
                        &handle,
                        label,
                        None,
                        "Runtime.evaluate",
                        &json!({ "expression": POPUP_DIAGNOSTIC, "returnByValue": true }),
                    )?;
                    Ok(json!({
                        "scale": scale,
                        "windowLogical": [inner.width as f64 / scale, inner.height as f64 / scale],
                        "measureScript": measured["result"]["value"],
                        "details": details["result"]["value"],
                    }))
                })();
                let _ = tx.send(result);
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    app.run_return(|_, _| {});
    let report = rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
}

/// A side panel is docked to the right edge of its browser window and as tall as
/// it; an options page declared for a tab opens large. Measured against a
/// Nebula-shaped browser window at a known place.
#[test]
#[ignore = "Starts hidden WebView2 windows with a temporary profile; needs a Windows desktop session"]
fn native_extension_windows_follow_their_declared_kind() {
    let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            deadline.recv_timeout(Duration::from_secs(120)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            eprintln!("Declared kind probe exceeded 120 seconds");
            std::process::exit(1);
        }
    });
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    // An extension that declares its options page for a tab.
    let manifest = MANIFEST.replace(
        "\"background\":",
        "\"options_ui\": { \"page\": \"popup.html\", \"open_in_tab\": true },\n  \"background\":",
    );
    let entries: Vec<(PathBuf, Vec<u8>)> = [
        ("manifest.json", manifest.as_str()),
        ("background.js", BACKGROUND_JS),
        ("content.js", CONTENT_JS),
        ("popup.html", POPUP_HTML),
    ]
    .into_iter()
    .map(|(name, body)| (PathBuf::from(name), body.as_bytes().to_vec()))
    .collect();
    let root = directory.path().join("kind");
    let folder =
        crate::extension_install::prepare_discovery_directory(&root, "1.0.0", entries).unwrap();
    let target = InstallationLocation { root, folder };
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.nebula.extension-kind-test".into();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let app = tauri::Builder::default()
        .any_thread()
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "extension-test",
                tauri::WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .data_directory(profile)
            .browser_extensions_enabled(true)
            .build()?;
            // A Nebula-shaped browser window at a known place and size.
            let window = tauri::window::WindowBuilder::new(app, "browser-window")
                .inner_size(1200.0, 800.0)
                .position(100.0, 100.0)
                .visible(false)
                .build()?;
            for label in ["browser-chrome", "nebula-tab-1"] {
                window.add_child(
                    tauri::webview::WebviewBuilder::new(
                        label,
                        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
                    ),
                    tauri::LogicalPosition::new(0.0, 0.0),
                    tauri::LogicalSize::new(100.0, 100.0),
                )?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = (|| -> Result<Value, String> {
                    std::fs::write(target.root.join("installed-folder"), "fixture-folder")
                        .map_err(|e| e.to_string())?;
                    crate::extension_install::operate(
                        handle.clone(),
                        "extension-test".into(),
                        target.clone(),
                        "install".into(),
                        None,
                    )?;
                    let geometry = |label: &str| -> Result<Value, String> {
                        let window = handle.get_window(label).ok_or("Missing window")?;
                        let scale = window.scale_factor().map_err(|e| e.to_string())?;
                        let size = window.outer_size().map_err(|e| e.to_string())?;
                        let position = window.outer_position().map_err(|e| e.to_string())?;
                        Ok(json!({
                            "size": [size.width as f64 / scale, size.height as f64 / scale],
                            "position": [position.x as f64 / scale, position.y as f64 / scale],
                        }))
                    };
                    let owner = geometry("browser-window")?;
                    let mut report = serde_json::Map::new();
                    report.insert("owner".into(), owner);
                    for (label, page) in [
                        ("extension-ui-kind-side-panel", "popup.html"),
                        ("extension-ui-kind-options", "popup.html"),
                    ] {
                        crate::extension_host::open_controls_page(
                            &handle,
                            ("browser-window", "extension-test"),
                            label,
                            &target,
                            page,
                            false,
                        )?;
                        std::thread::sleep(Duration::from_secs(2));
                        report.insert(label.into(), geometry(label)?);
                    }
                    crate::extension_host::close_controls(&handle, "kind")?;
                    Ok(Value::Object(report))
                })();
                let _ = tx.send(result);
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    app.run_return(|_, _| {});
    let report = rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    let number = |value: &Value| value.as_f64().unwrap();
    let owner = &report["owner"];
    let (owner_x, owner_y) = (number(&owner["position"][0]), number(&owner["position"][1]));
    let (owner_w, owner_h) = (number(&owner["size"][0]), number(&owner["size"][1]));
    // The side panel: against the right edge of its browser window, nearly as tall.
    let panel = &report["extension-ui-kind-side-panel"];
    let panel_right = number(&panel["position"][0]) + number(&panel["size"][0]);
    assert!(
        (panel_right - (owner_x + owner_w - 12.0)).abs() <= 24.0,
        "the side panel is not docked to its browser window's right edge: {report}"
    );
    assert!(
        number(&panel["size"][1]) >= owner_h - 80.0 - 4.0
            && number(&panel["size"][1]) <= owner_h + 4.0,
        "the side panel is not as tall as its browser window: {report}"
    );
    assert!(
        (number(&panel["position"][1]) - (owner_y + 56.0)).abs() <= 8.0,
        "{report}"
    );
    // An options page declared for a tab is large, not the 420x560 default.
    let options = &report["extension-ui-kind-options"];
    assert!(
        number(&options["size"][0]) >= 700.0 && number(&options["size"][1]) >= 560.0,
        "an options page meant for a tab opened small: {report}"
    );
}
