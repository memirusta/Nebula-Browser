//! What a careless or hostile extension can do with windows, measured in real
//! WebView2. The fixture asks for windows no sensible extension would: huge,
//! off-screen, full-screen, dozens at once, and for addresses a browser keeps to
//! itself. The report lists the windows that really exist afterwards.
use super::{script, wait_value};
use crate::extension_install::InstallationLocation;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Manager;

fn manifest() -> String {
    r#"{
  "manifest_version": 3,
  "name": "Nebula window abuse probe",
  "version": "1.0.0",
  "permissions": ["tabs", "storage"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js", "type": "module" }
}"#
    .to_string()
}

fn background(base: &str) -> String {
    format!(
        r#"
const BASE = '{base}';
const results = {{}};
const trim = (w) => w ? {{ id: w.id, type: w.type, state: w.state, width: w.width, height: w.height, left: w.left, top: w.top, focused: w.focused }} : null;
const attempt = async (name, fn) => {{
  try {{ results[name] = {{ ok: true, value: await fn() }}; }}
  catch (e) {{ results[name] = {{ ok: false, error: String(e && e.message || e).slice(0, 120) }}; }}
}};
chrome.runtime.onMessage.addListener((message, sender, respond) => {{
  if (!message || message.kind !== 'worker-abuse') return;
  (async () => {{
    await attempt('windowHugeOffscreen', async () => trim(await chrome.windows.create({{ url: BASE + '/page', type: 'popup', width: 5000, height: 5000, left: -3000, top: -3000, focused: true }})));
    await attempt('windowFullscreen', async () => trim(await chrome.windows.create({{ url: BASE + '/page', state: 'fullscreen' }})));
    await attempt('tabCreate', async () => {{ const t = await chrome.tabs.create({{ url: BASE + '/page' }}); return {{ id: t.id, windowId: t.windowId }}; }});
    for (const [name, target] of [['file', 'file:///C:/Windows/win.ini'], ['chromeScheme', 'chrome://settings'], ['javascript', 'javascript:alert(1)'], ['data', 'data:text/html,<b>x</b>'], ['aboutBlank', 'about:blank']]) {{
      await attempt('windowUrl_' + name, async () => trim(await chrome.windows.create({{ url: target }})));
    }}
    await attempt('burst25', async () => {{
      const out = [];
      for (let i = 0; i < 25; i++) {{
        try {{ await chrome.windows.create({{ url: BASE + '/page' }}); out.push('ok'); }} catch (e) {{ out.push('err'); }}
      }}
      return out.join(',');
    }});
    respond(results);
  }})();
  return true;
}});
"#
    )
}

const PAGE_ABUSE: &str = r#"(() => {
  const out = {};
  const open = (name, url, features) => { try { const w = window.open(url, '_blank', features); out[name] = w === null ? 'null' : typeof w; } catch (e) { out[name] = 'threw ' + String(e && e.message).slice(0, 60); } };
  open('hugeOffscreen', BASE + '/page', 'popup,width=5000,height=5000,left=-3000,top=-3000');
  open('fullscreenFeature', BASE + '/page', 'popup,fullscreen=yes');
  open('file', 'file:///C:/Windows/win.ini', 'popup');
  open('chromeScheme', 'chrome://settings', 'popup');
  open('javascript', 'javascript:alert(1)', 'popup');
  open('data', 'data:text/html,<b>x</b>', 'popup');
  open('aboutBlank', 'about:blank', 'popup,width=100,height=100');
  open('extensionPage', location.href, 'popup,width=10,height=10');
  for (let i = 0; i < 25; i++) open('burst' + i, BASE + '/page', 'popup');
  window.__pageAbuse = out;
  return null;
})()"#;

const ABUSE_HTML: &str = "<!doctype html><title>abuse</title><body>abuse</body>";

fn fixture(root: PathBuf, base: &str) -> InstallationLocation {
    let entries: Vec<(PathBuf, Vec<u8>)> = vec![
        (PathBuf::from("manifest.json"), manifest().into_bytes()),
        (
            PathBuf::from("background.js"),
            background(base).into_bytes(),
        ),
        (PathBuf::from("abuse.html"), ABUSE_HTML.as_bytes().to_vec()),
    ];
    let folder =
        crate::extension_install::prepare_discovery_directory(&root, "1.0.0", entries).unwrap();
    InstallationLocation { root, folder }
}

/// Every window Nebula (Tauri) knows about, except the harness's own.
fn inventory(handle: &tauri::AppHandle) -> Value {
    let mut windows = Vec::new();
    for (label, window) in handle.windows() {
        if label == "extension-test" {
            continue;
        }
        let scale = window.scale_factor().unwrap_or(1.0);
        let size = window.outer_size().ok();
        let position = window.outer_position().ok();
        windows.push(json!({
            "label": label,
            "visible": window.is_visible().unwrap_or(false),
            "decorated": window.is_decorated().unwrap_or(true),
            "fullscreen": window.is_fullscreen().unwrap_or(false),
            "sizeLogical": size.map(|s| [(s.width as f64 / scale).round(), (s.height as f64 / scale).round()]),
            "positionLogical": position.map(|p| [(p.x as f64 / scale).round(), (p.y as f64 / scale).round()]),
        }));
    }
    windows.sort_by_key(|w| w["label"].as_str().unwrap_or_default().to_string());
    json!(windows)
}

/// Pages and workers the browser engine holds for the profile, whether or not
/// Nebula created a window for them.
fn engine_targets(handle: &tauri::AppHandle) -> Value {
    let Ok(targets) = crate::extension_worker::cdp(
        handle,
        "extension-test",
        None,
        "Target.getTargets",
        &json!({}),
    ) else {
        return json!("unavailable");
    };
    let mut pages = 0;
    let mut urls = Vec::new();
    for target in targets["targetInfos"]
        .as_array()
        .cloned()
        .unwrap_or_default()
    {
        if target["type"] == "page" {
            pages += 1;
            urls.push(
                target["url"]
                    .as_str()
                    .unwrap_or_default()
                    .chars()
                    .take(60)
                    .collect::<String>(),
            );
        }
    }
    json!({ "pageTargets": pages, "urls": urls })
}

fn measure(
    handle: tauri::AppHandle,
    target: InstallationLocation,
    base: String,
    requests: Arc<AtomicUsize>,
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
    let panel = "extension-ui-abuse-options";
    crate::extension_host::open_controls_page(
        &handle,
        ("extension-test", "extension-test"),
        panel,
        &target,
        "abuse.html",
        false,
    )?;
    wait_value(
        &handle,
        panel,
        "globalThis.chrome?.runtime?.id ? true : null",
    )?;
    // As in production: the profile's host window handles the windows an extension's
    // service worker asks for, through the same policy as extension pages.
    let host = handle
        .get_webview_window("extension-test")
        .ok_or("Missing host window")?;
    crate::extension_host::popup_windows::attach(&handle, &host, false)?;
    // Opening the panel above counted as the user acting on the extension. Forget
    // it: this first round is a service worker acting entirely on its own.
    crate::extension_window_policy::forget_user_action();
    let before = json!({ "windows": inventory(&handle), "engine": engine_targets(&handle) });

    // 1. From the extension's service worker.
    script(
        &handle,
        panel,
        "globalThis.__workerAbuse = undefined; chrome.runtime.sendMessage({ kind: 'worker-abuse' }).then((r) => { globalThis.__workerAbuse = r; }); null",
    )?;
    let worker_results = {
        let deadline = Instant::now() + Duration::from_secs(90);
        loop {
            let value =
                script(&handle, panel, "globalThis.__workerAbuse ?? null").unwrap_or(Value::Null);
            if !value.is_null() || Instant::now() >= deadline {
                break value;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    };
    std::thread::sleep(Duration::from_secs(4));
    let after_worker = json!({ "windows": inventory(&handle), "engine": engine_targets(&handle), "pageRequests": requests.load(Ordering::SeqCst) });

    // 2. From the extension's own page (window.open). First as a script runs on its
    //    own (no click), then inside a user gesture.
    let page_abuse = PAGE_ABUSE.replace("BASE +", &format!("'{base}' +"));
    // The host's ExecuteScript hands the page a short-lived user activation, which
    // the first window.open would use up. A real page with no click has none, so
    // run the calls from a timer after it has expired.
    script(
        &handle,
        panel,
        &format!("setTimeout(() => {{ {page_abuse}; }}, 7000); null"),
    )?;
    std::thread::sleep(Duration::from_secs(11));
    let page_results =
        script(&handle, panel, "globalThis.__pageAbuse ?? null").unwrap_or(Value::Null);
    let after_page = json!({ "windows": inventory(&handle), "engine": engine_targets(&handle), "pageRequests": requests.load(Ordering::SeqCst) });
    script(&handle, panel, "globalThis.__pageAbuse = undefined; null")?;
    // The same calls, as if the user had clicked.
    crate::extension_worker::cdp(
        &handle,
        panel,
        None,
        "Runtime.evaluate",
        &json!({ "expression": page_abuse, "userGesture": true, "returnByValue": true }),
    )?;
    std::thread::sleep(Duration::from_secs(5));
    let gesture_results =
        script(&handle, panel, "globalThis.__pageAbuse ?? null").unwrap_or(Value::Null);
    let after_gesture = json!({ "windows": inventory(&handle), "engine": engine_targets(&handle), "pageRequests": requests.load(Ordering::SeqCst) });
    // 3. The same service worker, right after the user acted on the extension (opened
    //    it, clicked its icon): a sign-in window it opens now is wanted.
    crate::extension_window_policy::note_user_action();
    script(
        &handle,
        panel,
        "globalThis.__workerAbuse = undefined; chrome.runtime.sendMessage({ kind: 'worker-abuse' }).then((r) => { globalThis.__workerAbuse = r; }); null",
    )?;
    let deadline = Instant::now() + Duration::from_secs(90);
    while script(&handle, panel, "globalThis.__workerAbuse ?? null")
        .unwrap_or(Value::Null)
        .is_null()
        && Instant::now() < deadline
    {
        std::thread::sleep(Duration::from_millis(500));
    }
    std::thread::sleep(Duration::from_secs(4));
    let after_worker_action = json!({ "windows": inventory(&handle), "engine": engine_targets(&handle), "pageRequests": requests.load(Ordering::SeqCst) });
    let work_area = handle
        .get_window(panel)
        .and_then(|window| window.current_monitor().ok().flatten())
        .map(|monitor| {
            let area = monitor.work_area().size;
            let scale = monitor.scale_factor();
            json!([
                (area.width as f64 / scale).round(),
                (area.height as f64 / scale).round()
            ])
        });
    Ok(json!({
        "before": before,
        "workerResults": worker_results,
        "afterWorkerAbuse": after_worker,
        "pageResults": page_results,
        "afterPageAbuse": after_page,
        "gestureResults": gesture_results,
        "afterGestureAbuse": after_gesture,
        "afterWorkerWithAction": after_worker_action,
        "workArea": work_area,
        "denials": crate::extension_window_policy::recent_denials(),
    }))
}

#[test]
#[ignore = "Diagnostic: opens many WebView2 windows with a temporary profile; needs a Windows desktop session"]
fn native_extension_window_abuse() {
    use std::io::{Read, Write};
    let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            deadline.recv_timeout(Duration::from_secs(240)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            eprintln!("Window abuse probe exceeded 240 seconds");
            std::process::exit(1);
        }
    });
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.local_addr().unwrap());
    let target = fixture(directory.path().join("abuse"), &base);
    server.set_nonblocking(true).unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let requests = Arc::new(AtomicUsize::new(0));
    let (stopped, counted) = (stop.clone(), requests.clone());
    let server_thread = std::thread::spawn(move || {
        while !stopped.load(Ordering::Acquire) {
            if let Ok((mut connection, _)) = server.accept() {
                let _ = connection.set_read_timeout(Some(Duration::from_secs(2)));
                let mut bytes = [0; 2048];
                let read = connection.read(&mut bytes).unwrap_or(0);
                if String::from_utf8_lossy(&bytes[..read]).starts_with("GET /page") {
                    counted.fetch_add(1, Ordering::SeqCst);
                }
                let body = "<!doctype html><title>Abuse target</title><body>target";
                let _ = write!(connection, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    });
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.nebula.extension-abuse-test".into();
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
                let result = measure(handle.clone(), target, base, requests);
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
    let output =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/extension-window-abuse.json");
    std::fs::write(&output, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    println!("report: {}", output.display());

    let extension_windows = |stage: &str| -> Vec<Value> {
        report[stage]["windows"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|w| {
                w["label"]
                    .as_str()
                    .is_some_and(|l| l.starts_with("extension-auth-"))
            })
            .collect()
    };
    // A service worker opens nothing, whatever it asks for.
    assert!(extension_windows("afterWorkerAbuse").is_empty(), "{report}");
    // The windows a service worker asked for, by the host that received them.
    let from_host = |stage: &str| -> Vec<Value> {
        report[stage]["windows"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|w| {
                w["label"]
                    .as_str()
                    .is_some_and(|l| l.starts_with("extension-auth-extension-test-"))
            })
            .collect()
    };
    assert!(
        from_host("afterWorkerAbuse").is_empty(),
        "background code opened a window with no action of the user: {report}"
    );
    // A script that no click started opens nothing: this was sixteen windows.
    assert!(
        extension_windows("afterPageAbuse").is_empty(),
        "windows opened without a user action: {report}"
    );
    assert!(
        report["denials"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d.as_str().is_some_and(|d| d.contains("click or key press"))),
        "the refusals were not recorded: {report}"
    );
    // Right after the user acted on the extension, its background code may open the
    // window it needs (a sign-in page): a few at most, never more than the cap, never
    // the screen, and only the addresses a window may show.
    let background = from_host("afterWorkerWithAction");
    assert!(
        (1..=crate::extension_window_policy::MAX_WINDOWS_PER_OWNER).contains(&background.len()),
        "{} windows from background code after a user action: {report}",
        background.len()
    );
    let urls: Vec<String> = report["afterWorkerWithAction"]["engine"]["urls"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|u| u.as_str().map(str::to_string))
        .collect();
    assert!(
        urls.iter().all(|u| !u.starts_with("file:")
            && !u.starts_with("chrome:")
            && !u.starts_with("data:")),
        "a forbidden address became a page: {urls:?}"
    );
    // With a user gesture a window may open, but never a flood and never the screen.
    let opened = extension_windows("afterGestureAbuse");
    assert!(
        (1..=crate::extension_window_policy::MAX_WINDOWS_PER_OWNER).contains(&opened.len()),
        "{} windows opened from one extension page: {report}",
        opened.len()
    );
    let area = report["workArea"].as_array().expect("work area");
    let (area_w, area_h) = (area[0].as_f64().unwrap(), area[1].as_f64().unwrap());
    for window in &opened {
        assert_eq!(window["fullscreen"], false, "{window}");
        // Outer size includes the frame; allow a little for it.
        let size = window["sizeLogical"].as_array().unwrap();
        assert!(
            size[0].as_f64().unwrap() <= area_w * 0.9 + 24.0
                && size[1].as_f64().unwrap() <= area_h * 0.9 + 48.0,
            "a window covers the screen: {window} in {area_w}x{area_h}"
        );
    }
}
