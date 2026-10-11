//! Offline host contract checks. Never loads a user's extensions or profile.
use super::*;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

fn script(app: &tauri::AppHandle, label: &str, source: &str) -> Result<Value, String> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let source = source.to_string();
    app.get_webview(label)
        .ok_or("Missing test webview")?
        .with_webview(move |inner| unsafe {
            let failure = tx.clone();
            let handler = webview2_com::ExecuteScriptCompletedHandler::create(Box::new(
                move |result, value| {
                    let _ = tx.send(result.map(|_| value).map_err(|e| e.to_string()));
                    Ok(())
                },
            ));
            let source = windows_core::HSTRING::from(source);
            if let Err(error) = inner
                .controller()
                .CoreWebView2()
                .and_then(|core| core.ExecuteScript(&source, &handler))
            {
                let _ = failure.send(Err(error.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;
    let result = rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|e| e.to_string())??;
    serde_json::from_str(&result).map_err(|e| e.to_string())
}

fn wait_value(app: &tauri::AppHandle, label: &str, source: &str) -> Result<Value, String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let value = script(app, label, source)?;
        if !value.is_null() {
            return Ok(value);
        }
        if Instant::now() >= deadline {
            return Err(format!("Timed out: {source}"));
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn wait_until(stage: &str, mut ready: impl FnMut() -> bool) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(10);
    while !ready() {
        if Instant::now() >= deadline {
            return Err(format!("Timed out waiting for {stage}"));
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    Ok(())
}

fn probe(
    handle: tauri::AppHandle,
    target: InstallationLocation,
    base: String,
    requests: Arc<Mutex<Vec<String>>>,
) -> Result<(), String> {
    std::fs::write(target.root.join("installed-folder"), "fixture-folder")
        .map_err(|e| e.to_string())?;
    println!(
        "Runtime: {}",
        crate::extension_runtime::read_version(handle.clone(), "extension-test")?
    );
    crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "install".into(),
        None,
    )?;
    handle
        .get_webview("extension-test")
        .unwrap()
        .navigate(format!("{base}/seed").parse().unwrap())
        .map_err(|e| e.to_string())?;
    wait_value(
        &handle,
        "extension-test",
        "location.pathname === '/seed' && document.readyState === 'complete' ? true : null",
    )?;
    let label = "extension-ui-fixture-popup";
    open_controls(
        &handle,
        ("extension-test", "extension-test"),
        label,
        &target,
        "popup",
        false,
    )?;
    let controls = wait_value(&handle, label, "globalThis.chrome?.runtime?.id ? {id:chrome.runtime.id,bridge:!!chrome.windows.__nebulaWindowBridge} : null")?;
    if controls["bridge"] != false {
        return Err("Native window API was replaced".into());
    }
    let apis = [
        "tabs",
        "windows",
        "tabs-callback",
        "windows-callback",
        "dom",
    ];
    for api in apis {
        let url = serde_json::to_string(&format!("{base}/{api}")).unwrap();
        let operation = if api == "dom" {
            format!("Boolean(window.open({url}, '_blank'))")
        } else if let Some(api) = api.strip_suffix("-callback") {
            format!("await new Promise(resolve => {{chrome.{api}.create({{url:{url}}}, value=>resolve({{value,error:chrome.runtime.lastError?.message}}));setTimeout(()=>resolve({{timeout:true}}),2000)}})")
        } else {
            format!("await chrome.{api}.create({{url:{url}}})")
        };
        script(&handle, label, &format!("globalThis.__result=null; (async()=>{{try{{globalThis.__result={{result:{operation}}}}}catch(e){{globalThis.__result={{error:String(e)}}}}}})(); null"))?;
        let result = wait_value(&handle, label, "globalThis.__result ?? null")?;
        if result.get("error").is_some()
            || result["result"].get("error").is_some()
            || result["result"]["timeout"] == true
        {
            return Err(format!("{api} failed: {result}"));
        }
        // Each API must produce exactly one managed popup. A page may keep only a
        // few windows open (extension_window_policy), so close it before the next
        // API, except the last one: the nested popup below needs a live opener.
        let managed = |handle: &tauri::AppHandle| {
            handle
                .webview_windows()
                .into_keys()
                .filter(|label| label.starts_with("extension-auth-"))
                .collect::<Vec<_>>()
        };
        wait_until(&format!("{api} popup"), || {
            managed(&handle).len() == 1
                && requests
                    .lock()
                    .unwrap()
                    .iter()
                    .any(|request| request.starts_with(&format!("GET /{api} ")))
        })?;
        if api != *apis.last().unwrap() {
            for label in managed(&handle) {
                if let Some(window) = handle.get_webview_window(&label) {
                    let _ = window.destroy();
                }
            }
            wait_until(&format!("{api} popup closed"), || {
                managed(&handle).is_empty()
            })?;
        }
    }
    wait_until("native URLs", || {
        apis.iter().all(|api| {
            requests
                .lock()
                .unwrap()
                .iter()
                .any(|request| request.starts_with(&format!("GET /{api} ")))
        })
    })?;
    for api in apis {
        let received = requests.lock().unwrap();
        let matches: Vec<_> = received
            .iter()
            .filter(|request| request.starts_with(&format!("GET /{api} ")))
            .collect();
        if matches.len() != 1
            || !matches[0]
                .to_ascii_lowercase()
                .contains("cookie: nebula_fixture=shared")
        {
            return Err(format!("{api}: duplicate request or lost profile cookie"));
        }
    }
    let popups: Vec<_> = handle
        .webview_windows()
        .into_iter()
        .filter(|(label, _)| label.starts_with("extension-auth-"))
        .collect();
    if popups.len() != 1 {
        return Err("The last native request did not leave exactly one managed popup".into());
    }
    for (_, window) in &popups {
        if window.is_visible().map_err(|e| e.to_string())? {
            return Err("Hidden test opened a visible popup".into());
        }
    }
    let parent = &popups[0].0;
    let nested_url = serde_json::to_string(&format!("{base}/nested")).unwrap();
    if script(
        &handle,
        parent,
        &format!("Boolean(window.open({nested_url}, '_blank'))"),
    )? != true
    {
        return Err("Nested popup lost its opener".into());
    }
    wait_until("nested URL", || {
        requests
            .lock()
            .unwrap()
            .iter()
            .any(|request| request.starts_with("GET /nested "))
    })?;
    let nested = handle
        .webview_windows()
        .into_iter()
        .find(|(label, _)| {
            label.starts_with("extension-auth-") && !popups.iter().any(|(old, _)| old == label)
        })
        .ok_or("Missing nested popup")?
        .0;
    script(&handle, &nested, "window.close(); true")?;
    wait_until("window.close cleanup", || {
        handle.get_webview(&nested).is_none()
    })?;
    close_controls(&handle, "fixture")?;
    crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "disable".into(),
        None,
    )?;
    wait_until("disable cleanup", || {
        !handle
            .webview_windows()
            .keys()
            .any(|label| label.starts_with("extension-auth-") || label.starts_with("extension-ui-"))
    })?;
    if !target.root.join("installed-id").is_file()
        || !target.root.join("installed-folder").is_file()
    {
        return Err("Disabling removed the installation records".into());
    }
    let runtime_id =
        std::fs::read_to_string(target.root.join("installed-id")).map_err(|e| e.to_string())?;
    crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "remove".into(),
        None,
    )?;
    if target.root.join("installed-id").exists() || target.root.join("installed-folder").exists() {
        return Err("Removal left installation records behind".into());
    }
    let baseline = crate::extension_install::enumerate(handle.clone(), "extension-test".into())?;
    println!("Registration baseline after removal: {baseline:?}; removed fixture: {runtime_id}");
    if baseline.contains_key(&runtime_id) {
        return Err("Native removal kept the fixture registered".into());
    }
    // Force the atomic marker write to fail after AddBrowserExtension succeeds.
    // The installed extension must be rolled back, not become an invisible entry.
    let marker = target.root.join("installed-id");
    std::fs::create_dir(&marker).map_err(|e| e.to_string())?;
    let failure = crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "install".into(),
        None,
    )
    .err()
    .ok_or("Installation ignored marker persistence failure")?;
    let after_rollback =
        crate::extension_install::enumerate(handle.clone(), "extension-test".into())?;
    if !failure.contains("installation rolled back") || after_rollback != baseline {
        return Err(format!(
            "Failed installation changed runtime registrations: {after_rollback:?}; {failure}"
        ));
    }
    std::fs::remove_dir(&marker).map_err(|e| e.to_string())?;
    if !crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "install".into(),
        None,
    )?
    .enabled
    {
        return Err("Installation could not recover after rollback".into());
    }
    crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "remove".into(),
        None,
    )?;
    // A stale record whose runtime registration has already gone is removable too.
    std::fs::write(&marker, "a".repeat(32)).map_err(|e| e.to_string())?;
    std::fs::write(target.root.join("installed-folder"), "a".repeat(64))
        .map_err(|e| e.to_string())?;
    crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "remove".into(),
        None,
    )?;
    if marker.exists() || target.root.join("installed-folder").exists() {
        return Err("Removal could not clear stale registration records".into());
    }
    println!("Passed: failed registration persistence rolls back, retry reinstalls, disable retains records, remove clears records, stale-record cleanup");
    println!("Passed: native tabs/windows and callbacks, concurrent requests, same-profile HttpOnly cookie, nested popup, window.close, disable/removal cleanup; no API shim or user profile");
    Ok(())
}

#[test]
#[ignore = "Starts hidden WebView2 windows with a temporary profile; needs a Windows desktop session"]
fn native_extension_navigation_contract() {
    let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            deadline.recv_timeout(Duration::from_secs(90)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            eprintln!("Extension host contract exceeded 90 seconds");
            std::process::exit(1);
        }
    });
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("fixture");
    let profile = directory.path().join("profile");
    let manifest = serde_json::json!({
        "manifest_version":3,"name":"Nebula navigation fixture","version":"1.0.0",
        "permissions":["tabs"],"action":{"default_popup":"popup.html"}
    });
    let entries = vec![
        (
            PathBuf::from("manifest.json"),
            serde_json::to_vec(&manifest).unwrap(),
        ),
        (
            PathBuf::from("popup.html"),
            b"<!doctype html><title>Navigation fixture</title><body>Navigation fixture</body>"
                .to_vec(),
        ),
    ];
    let folder =
        crate::extension_install::prepare_discovery_directory(&root, "1.0.0", entries).unwrap();
    let target = InstallationLocation { root, folder };
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.local_addr().unwrap());
    server.set_nonblocking(true).unwrap();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let received = requests.clone();
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    let server_thread = std::thread::spawn(move || {
        while !stopped.load(Ordering::Acquire) {
            if let Ok((mut connection, _)) = server.accept() {
                let _ = connection.set_read_timeout(Some(Duration::from_secs(2)));
                let mut bytes = [0; 4096];
                let count = connection.read(&mut bytes).unwrap_or(0);
                let request = String::from_utf8_lossy(&bytes[..count]).to_string();
                let cookie = if request.starts_with("GET /seed ") {
                    "Set-Cookie: nebula_fixture=shared; Path=/; HttpOnly; SameSite=Lax\r\n"
                } else {
                    ""
                };
                received.lock().unwrap().push(request);
                let body =
                    "<!doctype html><title>Local sign-in fixture</title><body>Local fixture</body>";
                let _ = write!(connection, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n{cookie}Content-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    });
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.nebula.extension-navigation-test".into();
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
                let result = probe(handle.clone(), target, base, requests);
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
    rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
}

#[path = "extension_api_surface_fixture.rs"]
mod surface_fixture;

#[path = "extension_sender_native_test.rs"]
mod sender_semantics;

#[path = "extension_window_abuse_native_test.rs"]
mod window_abuse;

#[path = "extension_pages_audit_native_test.rs"]
mod pages_audit;

/// Raw DevTools call; the implementation is the production one.
fn cdp(
    app: &tauri::AppHandle,
    label: &str,
    session: Option<&str>,
    method: &str,
    params: &str,
) -> Result<Value, String> {
    let params: Value = serde_json::from_str(params).map_err(|e| e.to_string())?;
    crate::extension_worker::cdp(app, label, session, method, &params)
}

/// Can the host reach an extension service worker through the in-process
/// DevTools channel (no remote debugging port, no package patching)?
fn service_worker_cdp(app: &tauri::AppHandle, label: &str) -> Value {
    let mut steps = serde_json::Map::new();
    let mut record = |name: &str, value: Value| {
        steps.insert(name.to_string(), value);
    };
    let targets = match cdp(app, label, None, "Target.getTargets", "{}") {
        Ok(value) => value,
        Err(error) => {
            record("getTargets", serde_json::json!({ "error": error }));
            return Value::Object(steps);
        }
    };
    let list = targets["targetInfos"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    record(
        "getTargets",
        serde_json::json!({
            "count": list.len(),
            "types": list.iter().map(|t| format!("{} {}", t["type"].as_str().unwrap_or("?"),
                t["url"].as_str().unwrap_or("").chars().take(70).collect::<String>())).collect::<Vec<_>>(),
        }),
    );
    let Some(worker) = list.iter().find(|target| {
        target["type"] == "service_worker"
            && target["url"]
                .as_str()
                .is_some_and(|url| url.starts_with("chrome-extension://"))
    }) else {
        record("serviceWorkerTarget", serde_json::json!("not listed"));
        return Value::Object(steps);
    };
    let target_id = worker["targetId"].as_str().unwrap_or_default().to_string();
    record("serviceWorkerTarget", serde_json::json!("listed"));
    let session = match cdp(
        app,
        label,
        None,
        "Target.attachToTarget",
        &serde_json::json!({ "targetId": target_id, "flatten": true }).to_string(),
    ) {
        Ok(value) => value["sessionId"].as_str().map(str::to_string),
        Err(error) => {
            record("attach", serde_json::json!({ "error": error }));
            return Value::Object(steps);
        }
    };
    let Some(session) = session else {
        record(
            "attach",
            serde_json::json!({ "error": "no sessionId returned" }),
        );
        return Value::Object(steps);
    };
    record("attach", serde_json::json!("ok"));
    let evaluate = |expression: &str| {
        cdp(
            app,
            label,
            Some(&session),
            "Runtime.evaluate",
            &serde_json::json!({ "expression": expression, "returnByValue": true, "awaitPromise": true })
                .to_string(),
        )
    };
    record(
        "evaluate.typeofDispatch",
        evaluate("typeof chrome.action.onClicked.dispatch")
            .map(|v| v["result"]["value"].clone())
            .unwrap_or_else(|e| serde_json::json!({ "error": e })),
    );
    record(
        "evaluate.dispatchOnClicked",
        evaluate("chrome.action.onClicked.dispatch({id:1,windowId:1,index:0,pinned:false,highlighted:true,active:true,incognito:false,url:'about:blank'}); true")
            .map(|v| if v.get("exceptionDetails").is_some() { v["exceptionDetails"]["exception"]["description"].clone() } else { v["result"]["value"].clone() })
            .unwrap_or_else(|e| serde_json::json!({ "error": e })),
    );
    Value::Object(steps)
}

fn surface_entries() -> Vec<(PathBuf, Vec<u8>)> {
    vec![
        ("manifest.json", surface_fixture::MANIFEST),
        ("background.js", surface_fixture::BACKGROUND_JS),
        ("popup.html", surface_fixture::POPUP_HTML),
        ("popup.js", surface_fixture::POPUP_JS),
        ("offscreen.html", surface_fixture::OFFSCREEN_HTML),
        ("offscreen.js", surface_fixture::OFFSCREEN_JS),
        ("content.js", surface_fixture::CONTENT_JS),
    ]
    .into_iter()
    .map(|(name, content)| (PathBuf::from(name), content.as_bytes().to_vec()))
    .collect()
}

fn build_surface_fixture(root: PathBuf) -> InstallationLocation {
    let folder =
        crate::extension_install::prepare_discovery_directory(&root, "1.0.0", surface_entries())
            .unwrap();
    InstallationLocation { root, folder }
}

/// Measure what WebView2 provides to an extension service worker and page. This
/// records facts; it deliberately asserts nothing about which APIs exist.
fn api_surface_probe(
    handle: tauri::AppHandle,
    target: InstallationLocation,
    base: String,
) -> Result<Value, String> {
    std::fs::write(target.root.join("installed-folder"), "fixture-folder")
        .map_err(|e| e.to_string())?;
    let runtime = crate::extension_runtime::read_version(handle.clone(), "extension-test")?;
    crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "install".into(),
        None,
    )?;
    // A real http page in the same profile: the question is whether the
    // extension sees it and can script it.
    handle
        .get_webview("extension-test")
        .ok_or("Missing test webview")?
        .navigate(format!("{base}/page").parse().unwrap())
        .map_err(|e| e.to_string())?;
    wait_value(
        &handle,
        "extension-test",
        "location.pathname === '/page' && document.readyState === 'complete' ? true : null",
    )?;
    let content_script = {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let value = script(
                &handle,
                "extension-test",
                "document.documentElement.getAttribute('data-nebula-probe')",
            )?;
            if !value.is_null() || Instant::now() >= deadline {
                break value;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    };
    let label = "extension-ui-surface-popup";
    open_controls(
        &handle,
        ("extension-test", "extension-test"),
        label,
        &target,
        "popup",
        false,
    )?;
    wait_value(
        &handle,
        label,
        "globalThis.chrome?.runtime?.id ? true : null",
    )?;
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut worker = Value::Null;
    loop {
        script(
            &handle,
            label,
            "globalThis.__report = undefined; chrome.storage.local.get('report').then(v => { globalThis.__report = v.report || null }); null",
        )?;
        std::thread::sleep(Duration::from_millis(400));
        let value = script(
            &handle,
            label,
            "globalThis.__report === undefined ? 'pending' : globalThis.__report",
        )?;
        if value != "pending" && !value.is_null() {
            worker = value;
        }
        if worker.get("__done").is_some() || Instant::now() >= deadline {
            break;
        }
    }
    let page = script(&handle, label, "globalThis.__page ?? null")?;
    let channel = service_worker_cdp(&handle, label);
    let runtime_id =
        std::fs::read_to_string(target.root.join("installed-id")).map_err(|e| e.to_string())?;
    // The production path: the same call the Extensions panel makes.
    let first_click = crate::extension_worker::click_action(&handle, "extension-test", &runtime_id);
    // MV3 workers stop when idle. Stop it, then click again: the host must wake it.
    let scope = format!("chrome-extension://{runtime_id}/");
    let _ = crate::extension_worker::cdp(
        &handle,
        label,
        None,
        "ServiceWorker.enable",
        &serde_json::json!({}),
    );
    let _ = crate::extension_worker::cdp(
        &handle,
        label,
        None,
        "ServiceWorker.stopAllWorkers",
        &serde_json::json!({}),
    );
    let stopped = {
        let deadline = Instant::now() + Duration::from_secs(6);
        loop {
            let listed = crate::extension_worker::cdp(
                &handle,
                label,
                None,
                "Target.getTargets",
                &serde_json::json!({}),
            )
            .map(|targets| {
                targets["targetInfos"].as_array().is_some_and(|list| {
                    list.iter().any(|t| {
                        t["type"] == "service_worker"
                            && t["url"].as_str().is_some_and(|u| u.starts_with(&scope))
                    })
                })
            })
            .unwrap_or(true);
            if !listed || Instant::now() >= deadline {
                break !listed;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
    };
    let second_click =
        crate::extension_worker::click_action(&handle, "extension-test", &runtime_id);
    // The Sider/Imageye pattern: the browser opens the panel on a click and calls no listener.
    script(
        &handle,
        label,
        "chrome.runtime.sendMessage({ kind: 'panel-behavior-on' }).catch(() => {}); null",
    )?;
    std::thread::sleep(Duration::from_millis(400));
    let behavior_click =
        crate::extension_worker::click_action(&handle, "extension-test", &runtime_id);
    let click = serde_json::json!({
        "first": first_click.map(|c| serde_json::to_value(c).unwrap()).unwrap_or_else(|e| serde_json::json!({ "error": e })),
        "workerStoppedBeforeSecond": stopped,
        "second": second_click.map(|c| serde_json::to_value(c).unwrap()).unwrap_or_else(|e| serde_json::json!({ "error": e })),
        "panelBehaviorClick": behavior_click.map(|c| serde_json::to_value(c).unwrap()).unwrap_or_else(|e| serde_json::json!({ "error": e })),
    });
    std::thread::sleep(Duration::from_millis(600));
    script(
        &handle,
        label,
        "globalThis.__report = undefined; chrome.storage.local.get('report').then(v => { globalThis.__report = v.report || null }); null",
    )?;
    std::thread::sleep(Duration::from_millis(400));
    let after = script(&handle, label, "globalThis.__report ?? null")?;
    if after.get("__done").is_some() {
        worker = after;
    }
    close_controls(&handle, "surface")?;
    crate::extension_install::operate(
        handle.clone(),
        "extension-test".into(),
        target.clone(),
        "remove".into(),
        None,
    )?;
    Ok(
        serde_json::json!({ "runtime": runtime, "worker": worker, "page": page, "workerChannel": channel, "hostSeesContentScript": content_script, "click": click }),
    )
}

#[test]
#[ignore = "Starts hidden WebView2 windows with a temporary profile; needs a Windows desktop session"]
fn native_extension_api_surface() {
    let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            deadline.recv_timeout(Duration::from_secs(150)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            eprintln!("API surface probe exceeded 150 seconds");
            std::process::exit(1);
        }
    });
    let directory = tempfile::tempdir().unwrap();
    let profile = directory.path().join("profile");
    let target = build_surface_fixture(directory.path().join("surface"));
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.local_addr().unwrap());
    server.set_nonblocking(true).unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    let server_thread = std::thread::spawn(move || {
        while !stopped.load(Ordering::Acquire) {
            if let Ok((mut connection, _)) = server.accept() {
                let _ = connection.set_read_timeout(Some(Duration::from_secs(2)));
                let mut bytes = [0; 4096];
                let _ = connection.read(&mut bytes);
                let body = "<!doctype html><title>Probe page</title><body>Probe page";
                let _ = write!(connection, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    });
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.nebula.extension-surface-test".into();
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
                let result = api_surface_probe(handle.clone(), target, base);
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
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/extension-api-surface.json");
    std::fs::write(&output, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    println!(
        "Runtime {}; report: {}",
        report["runtime"],
        output.display()
    );
    if let Some(worker) = report["worker"].as_object() {
        for (name, entry) in worker {
            if name == "namespaces" || name == "globals" || name == "__done" {
                continue;
            }
            let outcome = if entry["ok"] == true {
                format!("ok {}", entry["value"])
            } else {
                format!("ERR {}", entry["error"])
            };
            println!(
                "  {name}: {}",
                outcome.chars().take(160).collect::<String>()
            );
        }
        println!("  done flag: {}", worker.contains_key("__done"));
        println!(
            "  host sees content script attribute: {}",
            report["hostSeesContentScript"]
        );
        println!(
            "  onClicked.fired after host dispatch: {}",
            worker
                .get("onClicked.fired")
                .map(|v| v.to_string())
                .unwrap_or_else(|| "NOT FIRED".into())
        );
        println!(
            "  workerChannel: {}",
            serde_json::to_string_pretty(&report["workerChannel"]).unwrap()
        );
    } else {
        println!("  no worker report received");
    }
    println!(
        "  click: {}",
        serde_json::to_string_pretty(&report["click"]).unwrap()
    );
    // Unlike the probes above, these assert behaviour Nebula itself provides.
    let click = &report["click"];
    for run in ["first", "second"] {
        let result = &click[run];
        assert_eq!(
            result["dispatched"], true,
            "{run} click not dispatched: {result}"
        );
        assert!(
            result["tabUrl"]
                .as_str()
                .is_some_and(|url| url.starts_with("http://127.0.0.1")),
            "{run} click did not hand the extension the real http tab: {result}"
        );
        assert_eq!(
            result["sidePanelRequested"], true,
            "{run} click did not capture sidePanel.open: {result}"
        );
        assert_eq!(
            result["sidePanelPath"], "popup.html",
            "{run} click lost the side panel path: {result}"
        );
    }
    assert_eq!(
        click["workerStoppedBeforeSecond"], true,
        "the worker was still running, so the wake-up path was not exercised"
    );
    // The listener was registered before the click, and the panel behaviour was off.
    for run in ["first", "second"] {
        assert_eq!(click[run]["hasListener"], true, "{run}: {}", click[run]);
        assert_eq!(
            click[run]["openPanelOnActionClick"], false,
            "{run}: {}",
            click[run]
        );
    }
    // Sider/Imageye pattern: the browser opens the panel itself, so the click must
    // ask for the panel even though it is the behaviour, not a listener, that does it.
    let behavior = &click["panelBehaviorClick"];
    assert_eq!(behavior["openPanelOnActionClick"], true, "{behavior}");
    assert_eq!(behavior["sidePanelRequested"], true, "{behavior}");
    assert_eq!(behavior["sidePanelPath"], "popup.html", "{behavior}");

    // The worker's first line is an unguarded `chrome.commands` call. With the
    // manifest key declared it is native, so startup must complete. (Without the
    // key the namespace is undefined: it is gated by the manifest, not missing.)
    assert!(
        report["worker"].get("__done").is_some(),
        "the worker did not finish starting up"
    );
    assert_eq!(report["worker"]["commands.getAll"]["ok"], true);
}

/// DevTools events (console, exceptions, worker errors) from one webview, newest
/// last. `session` is set for events from an attached target such as a worker.
fn capture_events(
    app: &tauri::AppHandle,
    label: &str,
    events: &[&'static str],
) -> Result<Arc<Mutex<Vec<Value>>>, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2DevToolsProtocolEventReceivedEventArgs2;
    use windows::core::{Interface, PCWSTR};
    use windows_core::{HSTRING, PWSTR};

    fn take(read: impl FnOnce(*mut PWSTR) -> windows_core::Result<()>) -> String {
        let mut value = PWSTR::null();
        if read(&mut value).is_err() || value.is_null() {
            return String::new();
        }
        let text = unsafe { value.to_string().unwrap_or_default() };
        unsafe { windows::Win32::System::Com::CoTaskMemFree(Some(value.as_ptr().cast())) };
        text
    }

    let sink: Arc<Mutex<Vec<Value>>> = Arc::new(Mutex::new(Vec::new()));
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let events = events.to_vec();
    let collected = sink.clone();
    app.get_webview(label)
        .ok_or("Missing webview")?
        .with_webview(move |inner| unsafe {
            let result = (|| -> windows_core::Result<()> {
                let core = inner.controller().CoreWebView2()?;
                for name in events {
                    let event = HSTRING::from(name);
                    let receiver = core.GetDevToolsProtocolEventReceiver(PCWSTR(event.as_ptr()))?;
                    let sink = collected.clone();
                    let handler = webview2_com::DevToolsProtocolEventReceivedEventHandler::create(
                        Box::new(move |_, args| {
                            let Some(args) = args else { return Ok(()) };
                            let params = take(|v| args.ParameterObjectAsJson(v));
                            let session = args
                                .cast::<ICoreWebView2DevToolsProtocolEventReceivedEventArgs2>()
                                .map(|a| take(|v| a.SessionId(v)))
                                .unwrap_or_default();
                            let mut parsed: Value =
                                serde_json::from_str(&params).unwrap_or(Value::Null);
                            // Keep every entry small: this is evidence, not a log dump.
                            let rendered = parsed.to_string();
                            if rendered.len() > 1500 {
                                parsed = Value::String(format!("{}...", &rendered[..1500]));
                            }
                            if let Ok(mut list) = sink.lock() {
                                if list.len() < 200 {
                                    list.push(serde_json::json!({
                                        "event": name, "session": session, "params": parsed
                                    }));
                                }
                            }
                            Ok(())
                        }),
                    );
                    let mut token = 0i64;
                    receiver.add_DevToolsProtocolEventReceived(&handler, &mut token)?;
                }
                Ok(())
            })();
            let _ = tx.send(result.map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "Timed out subscribing to DevTools events".to_string())??;
    Ok(sink)
}

fn events_since(sink: &Arc<Mutex<Vec<Value>>>, from: usize) -> Vec<Value> {
    sink.lock()
        .map(|list| list[from.min(list.len())..].to_vec())
        .unwrap_or_default()
}

/// One concise line per event: what the extension said, not raw protocol.
fn summarize_events(events: &[Value], own_id: &str) -> Vec<String> {
    let mut others = 0;
    let mut lines: Vec<String> = events
        .iter()
        .filter_map(|entry| {
            let params = &entry["params"];
            // `workerErrorReported` is browser-wide: keep only this extension's own.
            if entry["event"] == "ServiceWorker.workerErrorReported"
                && !params["errorMessage"]["sourceURL"]
                    .as_str()
                    .is_some_and(|url| url.contains(own_id))
            {
                others += 1;
                return None;
            }
            let text = match entry["event"].as_str()? {
                "Runtime.exceptionThrown" => {
                    let details = &params["exceptionDetails"];
                    format!(
                        "EXCEPTION {} ({}:{})",
                        details["exception"]["description"]
                            .as_str()
                            .or(details["text"].as_str())
                            .unwrap_or("?")
                            .lines()
                            .next()
                            .unwrap_or("?"),
                        details["url"]
                            .as_str()
                            .unwrap_or("")
                            .rsplit('/')
                            .next()
                            .unwrap_or(""),
                        details["lineNumber"]
                    )
                }
                "Runtime.consoleAPICalled" => format!(
                    "console.{} {}",
                    params["type"].as_str().unwrap_or("log"),
                    params["args"]
                        .as_array()
                        .map(|a| a
                            .iter()
                            .map(|x| x["value"]
                                .as_str()
                                .map(str::to_string)
                                .or_else(|| x["description"].as_str().map(str::to_string))
                                .unwrap_or_default())
                            .collect::<Vec<_>>()
                            .join(" "))
                        .unwrap_or_default()
                ),
                "Log.entryAdded" => format!(
                    "log.{} {}",
                    params["entry"]["level"].as_str().unwrap_or("?"),
                    params["entry"]["text"].as_str().unwrap_or("")
                ),
                other => format!("{other} {params}"),
            };
            Some(text.chars().take(260).collect())
        })
        .collect();
    if others > 0 {
        lines.push(format!(
            "({others} worker errors from other extensions omitted)"
        ));
    }
    lines
}

/// Run one installed lab extension and record what it says: worker startup, the
/// toolbar click, and the side panel page. Evidence only, no assertions.
fn diagnose_extension(
    handle: &tauri::AppHandle,
    host: &str,
    owner: &str,
    entry: &crate::extension_discovery::DiscoveryExtension,
) -> Result<Value, String> {
    let target = location(root_for(handle, &entry.id)?, &entry.id)?;
    let runtime_id =
        std::fs::read_to_string(target.root.join("installed-id")).map_err(|e| e.to_string())?;
    let manifest = manifest_at(&target.folder)?;
    let events = capture_events(
        handle,
        host,
        &[
            "Runtime.exceptionThrown",
            "Runtime.consoleAPICalled",
            "Log.entryAdded",
            "ServiceWorker.workerErrorReported",
        ],
    )?;
    let call = |session: Option<&str>, method: &str, params: Value| {
        crate::extension_worker::cdp(handle, host, session, method, &params)
    };

    // 1. Restart the worker so its startup is observed from the first line.
    let _ = call(None, "ServiceWorker.enable", serde_json::json!({}));
    let _ = call(None, "ServiceWorker.stopAllWorkers", serde_json::json!({}));
    std::thread::sleep(Duration::from_millis(800));
    let started = crate::extension_worker::ensure_worker(handle, host, &runtime_id);
    let mut report = serde_json::Map::new();
    report.insert(
        "worker".into(),
        serde_json::json!(if started.is_ok() {
            "running"
        } else {
            "did not start"
        }),
    );
    report.insert(
        "workerError".into(),
        serde_json::json!(started.as_ref().err()),
    );
    let mut session_id = None;
    if let Ok(target_id) = &started {
        let attached = call(
            None,
            "Target.attachToTarget",
            serde_json::json!({ "targetId": target_id, "flatten": true }),
        );
        if let Ok(attached) = attached {
            session_id = attached["sessionId"].as_str().map(str::to_string);
        }
    }
    if let Some(session) = &session_id {
        // Enabling replays what the worker already logged, including startup errors.
        let _ = call(Some(session), "Runtime.enable", serde_json::json!({}));
        let _ = call(Some(session), "Log.enable", serde_json::json!({}));
    }
    std::thread::sleep(Duration::from_millis(1500));
    report.insert(
        "startupEvents".into(),
        serde_json::json!(summarize_events(&events_since(&events, 0), &runtime_id)),
    );

    // 2. The toolbar click, as the Extensions panel performs it.
    let mark = events.lock().map(|l| l.len()).unwrap_or(0);
    let click = crate::extension_worker::click_action(handle, host, &runtime_id);
    std::thread::sleep(Duration::from_millis(1500));
    report.insert(
        "click".into(),
        click
            .as_ref()
            .map(|c| serde_json::to_value(c).unwrap())
            .unwrap_or_else(|e| serde_json::json!({ "error": e })),
    );
    report.insert(
        "clickEvents".into(),
        serde_json::json!(summarize_events(&events_since(&events, mark), &runtime_id)),
    );

    // 3. The side panel page, if the extension has one.
    let panel_path = click
        .as_ref()
        .ok()
        .and_then(|c| c.side_panel_path.clone())
        .or_else(|| page_path(&manifest, "side-panel").ok());
    if let Some(path) = panel_path.clone() {
        let panel_label = format!("extension-ui-{}-diag-panel", entry.id);
        let label = panel_label.as_str();
        let opened = open_controls_page(handle, (owner, host), label, &target, &path, false);
        report.insert("panelPath".into(), serde_json::json!(path));
        report.insert("panelOpened".into(), serde_json::json!(opened.is_ok()));
        report.insert(
            "panelOpenError".into(),
            serde_json::json!(opened.as_ref().err()),
        );
        if opened.is_ok() {
            std::thread::sleep(Duration::from_millis(4000));
            let panel_events = capture_events(
                handle,
                label,
                &[
                    "Runtime.exceptionThrown",
                    "Runtime.consoleAPICalled",
                    "Log.entryAdded",
                ],
            )?;
            let panel_call = |method: &str| {
                crate::extension_worker::cdp(handle, label, None, method, &serde_json::json!({}))
            };
            let _ = panel_call("Runtime.enable");
            let _ = panel_call("Log.enable");
            std::thread::sleep(Duration::from_millis(1500));
            report.insert(
                "panelText".into(),
                script(
                    handle,
                    label,
                    "document.body ? document.body.innerText.slice(0, 500) : null",
                )
                .unwrap_or(Value::Null),
            );
            report.insert(
                "panelEvents".into(),
                serde_json::json!(summarize_events(
                    &events_since(&panel_events, 0),
                    &runtime_id
                )),
            );
            let _ = close_controls(handle, &entry.id);
        }
    } else {
        report.insert("panelPath".into(), Value::Null);
    }
    if let Some(session) = session_id.take() {
        let _ = call(
            None,
            "Target.detachFromTarget",
            serde_json::json!({ "sessionId": session }),
        );
    }

    // 4. The cold path the Extensions panel takes: the worker is stopped, then one
    //    click starts it and opens the panel at once. The warm run above gave the
    //    worker seconds to settle before the panel loaded; this one does not.
    if let Some(path) = panel_path {
        let _ = call(None, "ServiceWorker.stopAllWorkers", serde_json::json!({}));
        let scope = format!("chrome-extension://{runtime_id}/");
        let deadline = Instant::now() + Duration::from_secs(6);
        loop {
            let listed = call(None, "Target.getTargets", serde_json::json!({}))
                .map(|targets| {
                    targets["targetInfos"].as_array().is_some_and(|list| {
                        list.iter().any(|t| {
                            t["type"] == "service_worker"
                                && t["url"].as_str().is_some_and(|u| u.starts_with(&scope))
                        })
                    })
                })
                .unwrap_or(false);
            if !listed || Instant::now() >= deadline {
                report.insert("coldWorkerStopped".into(), serde_json::json!(!listed));
                break;
            }
            std::thread::sleep(Duration::from_millis(150));
        }
        let cold_click = crate::extension_worker::click_action(handle, host, &runtime_id);
        let cold_label = format!("extension-ui-{}-cold-panel", entry.id);
        let opened = open_controls_page(handle, (owner, host), &cold_label, &target, &path, false);
        report.insert(
            "coldClick".into(),
            cold_click
                .as_ref()
                .map(|c| serde_json::to_value(c).unwrap())
                .unwrap_or_else(|e| serde_json::json!({ "error": e })),
        );
        report.insert("coldPanelOpened".into(), serde_json::json!(opened.is_ok()));
        if opened.is_ok() {
            std::thread::sleep(Duration::from_millis(4000));
            let cold_events = capture_events(
                handle,
                &cold_label,
                &[
                    "Runtime.exceptionThrown",
                    "Runtime.consoleAPICalled",
                    "Log.entryAdded",
                ],
            )?;
            for method in ["Runtime.enable", "Log.enable"] {
                let _ = crate::extension_worker::cdp(
                    handle,
                    &cold_label,
                    None,
                    method,
                    &serde_json::json!({}),
                );
            }
            std::thread::sleep(Duration::from_millis(1500));
            report.insert(
                "coldPanelText".into(),
                script(
                    handle,
                    &cold_label,
                    "document.body ? document.body.innerText.slice(0, 500) : null",
                )
                .unwrap_or(Value::Null),
            );
            report.insert(
                "coldPanelEvents".into(),
                serde_json::json!(summarize_events(
                    &events_since(&cold_events, 0),
                    &runtime_id
                )),
            );
            let _ = close_controls(handle, &entry.id);
        }
    }
    Ok(Value::Object(report))
}

#[test]
#[ignore = "Runs real extensions installed in the Extension Lab profile; close the lab app first"]
fn native_extension_lab_diagnose() {
    let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            deadline.recv_timeout(Duration::from_secs(300)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            eprintln!("Extension Lab diagnosis exceeded 5 minutes");
            std::process::exit(1);
        }
    });
    // Comma-separated Chrome Web Store ids; Claude by default.
    let wanted: Vec<String> = std::env::var("NEBULA_LAB_DIAGNOSE")
        .unwrap_or_else(|_| "fcoeoabgfenejglbffodgkkbkcdhcgfn".into())
        .split(',')
        .map(|id| id.trim().to_string())
        .filter(|id| !id.is_empty())
        .collect();
    // The lab installs catalog extensions into the catalog profile on purpose, to see what
    // they do; that is a registration the isolation guard refuses in the product.
    std::env::set_var("NEBULA_FIXTURE_ALLOW_SHARED_PROFILE", "1");
    let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", server.local_addr().unwrap());
    server.set_nonblocking(true).unwrap();
    let stop = Arc::new(AtomicBool::new(false));
    let stopped = stop.clone();
    let server_thread = std::thread::spawn(move || {
        while !stopped.load(Ordering::Acquire) {
            if let Ok((mut connection, _)) = server.accept() {
                let _ = connection.set_read_timeout(Some(Duration::from_secs(2)));
                let mut bytes = [0; 4096];
                let _ = connection.read(&mut bytes);
                let body = "<!doctype html><title>Lab page</title><body>Lab page";
                let _ = write!(connection, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            } else {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    });
    let scratch = tempfile::tempdir().unwrap();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    // The lab's identity: the catalog profile (with the installed extensions) lives under it.
    context.config_mut().identifier = "com.nebula.browser.extensionlab".into();
    let owner_profile = scratch.path().join("owner");
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
            .data_directory(owner_profile)
            .browser_extensions_enabled(true)
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = (|| -> Result<Value, String> {
                    let host = catalog_host(&handle)?;
                    // A real page in the extension profile, so tab-aware extensions have a tab.
                    let site = tauri::WebviewWindowBuilder::new(
                        &handle,
                        "extension-lab-site",
                        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
                    )
                    .visible(false)
                    .focused(false)
                    .skip_taskbar(true)
                    .data_directory(catalog_profile_directory(&handle)?)
                    .browser_extensions_enabled(true)
                    .build()
                    .map_err(|e| e.to_string())?;
                    site.navigate(format!("{base}/page").parse().unwrap())
                        .map_err(|e| e.to_string())?;
                    wait_value(
                        &handle,
                        "extension-lab-site",
                        "location.pathname === '/page' && document.readyState === 'complete' ? true : null",
                    )?;
                    let mut all = serde_json::Map::new();
                    for store_id in &wanted {
                        let Some(entry) = crate::extension_discovery::DISCOVERY
                            .iter()
                            .find(|e| e.store_id == *store_id)
                        else {
                            all.insert(store_id.clone(), serde_json::json!("not in the catalog"));
                            continue;
                        };
                        let outcome = diagnose_extension(&handle, &host, "extension-test", entry);
                        println!("== {} ({store_id})", entry.id);
                        match &outcome {
                            Ok(report) => println!("{}", serde_json::to_string_pretty(report).unwrap()),
                            Err(error) => println!("  FAILED: {error}"),
                        }
                        all.insert(
                            entry.id.clone(),
                            outcome.unwrap_or_else(|e| serde_json::json!({ "error": e })),
                        );
                    }
                    Ok(Value::Object(all))
                })();
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
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/extension-lab-diagnose.json");
    std::fs::write(&output, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    println!("Report: {}", output.display());
}

/// Extensions that ask the host for the most features (docs/EXTENSION_CAPABILITY_SCAN.md),
/// excluding any that need a companion desktop app, plus Claude by request.
/// `Secure Exam Proctor` is deliberately absent: lockdown software should not be
/// run for a feature test.
const LAB_EXTENSIONS: &[(&str, &str)] = &[
    ("fcoeoabgfenejglbffodgkkbkcdhcgfn", "Claude"),
    ("nngceckbapebfimnlniiiahkandclblb", "Bitwarden"),
    ("hnmpcagpplmpfojmgmnngilcnanddlhb", "Windscribe VPN"),
    ("gmbmikajjgmnabiglmofipeabaddhgne", "Save to Google Drive"),
    ("hdokiejnpimakedhajhdlcegeplioahd", "LastPass"),
    ("mpnlkmlkncncpgnnkmkgoobfpnjmblnk", "Norton Safe Search"),
    ("difoiogjjojoaoomphldepapgpbgkhkb", "Sider"),
    ("neebplgakaahbhdphmkckjjcegoiijjo", "Keepa"),
    ("agionbommeaifngbhincahgmoflcikhm", "Imageye"),
    ("mlomiejdfkolichcflejclcbmpeaniij", "Ghostery"),
    ("bmnlcjabgnpnenekpadlanbbkooimhnj", "Honey"),
    ("bhghoamapcdpbohphigoooaddinpkbai", "Authenticator"),
    ("alhgpfoeiimagjlnfekdhkjlkiomcapa", "Apollo.io"),
];

/// Install the lab extensions into the Extension Lab app's catalog profile with
/// the same code the Extensions UI uses (download, digest binding, isolated
/// load probe, registration). Idempotent: already-installed ones are skipped.
fn lab_setup(handle: tauri::AppHandle) -> Result<Value, String> {
    let webview = handle
        .get_webview("extension-test")
        .ok_or("Missing host webview")?;
    let mut rows = Vec::new();
    for (store_id, name) in LAB_EXTENSIONS {
        let outcome: Result<String, String> = (|| {
            // Catalog ids are slugs for some entries ("bitwarden") and store ids for
            // the rest, so look the entry up by its Chrome store id.
            let entry = crate::extension_discovery::DISCOVERY
                .iter()
                .find(|entry| entry.store_id == *store_id)
                .ok_or("This extension is not in Nebula's discovery catalog")?;
            let status = tauri::async_runtime::block_on(manage_discovery(
                handle.clone(),
                webview.clone(),
                "status".into(),
                entry.id.clone(),
                None,
            ))?;
            if status.installed {
                return Ok(format!("already installed (enabled={})", status.enabled));
            }
            let bytes = tauri::async_runtime::block_on(
                crate::extension_download::fetch_discovery_package(&entry.id),
            )?;
            let digest = {
                use sha2::Digest;
                format!("{:x}", sha2::Sha256::digest(&bytes))
            };
            let installed = tauri::async_runtime::block_on(manage_discovery(
                handle.clone(),
                webview.clone(),
                "install".into(),
                entry.id.clone(),
                Some(digest),
            ))?;
            Ok(format!(
                "installed (enabled={}, {} KB)",
                installed.enabled,
                bytes.len() / 1024
            ))
        })();
        println!(
            "  {name}: {}",
            match &outcome {
                Ok(text) => text.clone(),
                Err(error) => format!("FAILED: {error}"),
            }
        );
        rows.push(serde_json::json!({
            "name": name, "storeId": store_id,
            "result": outcome.clone().unwrap_or_default(),
            "error": outcome.err(),
        }));
    }
    Ok(Value::Array(rows))
}

#[test]
#[ignore = "Downloads public extension packages into the Extension Lab profile; needs a Windows desktop session"]
fn native_extension_lab_setup() {
    let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            deadline.recv_timeout(Duration::from_secs(1200)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            eprintln!("Extension Lab setup exceeded 20 minutes");
            std::process::exit(1);
        }
    });
    let scratch = tempfile::tempdir().unwrap();
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    // Must equal tauri.extensionlab.conf.json: the profile path derives from it.
    context.config_mut().identifier = "com.nebula.browser.extensionlab".into();
    let host_profile = scratch.path().join("host");
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
            .data_directory(host_profile)
            .browser_extensions_enabled(true)
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = lab_setup(handle.clone());
                let _ = tx.send(result);
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    app.run_return(|_, _| {});
    let report = rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    let output =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/extension-lab-setup.json");
    std::fs::write(&output, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    println!("Report: {}", output.display());
}

#[path = "shell_isolation_spike_native_test.rs"]
mod shell_spike;
