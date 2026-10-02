//! SPIKE driver: exercises the REAL app (the shell, tabs, popups, shortcuts) and
//! records what the native windows did. Off unless `NEBULA_SPIKE_DRIVER` is set.
//!
//!   NEBULA_SPIKE_DRIVER=full            run the phases below
//!   NEBULA_SPIKE_PHASES=startup,tabs3   optional subset (default: all)
//!   NEBULA_SPIKE_OUT=<file>             JSON report
//!   NEBULA_SPIKE_SCRIPTS=<dir>          repo `scripts` folder (memory sampler)
//!   NEBULA_SPIKE_SPLIT=0|1              baseline or the split-environment shell
//!
//! Real input only goes out while one of this process's windows is in the
//! foreground, so a key press can never land in another program.
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Manager;
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP,
    VIRTUAL_KEY, VK_CONTROL, VK_F11, VK_MENU, VK_TAB, VK_W,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetForegroundWindow, GetGUIThreadInfo, GetWindow, GetWindowRect, GetWindowThreadProcessId,
    IsChild, IsWindowVisible, SetForegroundWindow, GUITHREADINFO, GW_CHILD, GW_HWNDNEXT,
};

fn hwnd(value: isize) -> HWND {
    HWND(value as *mut _)
}

fn script(app: &tauri::AppHandle, label: &str, source: &str) -> Result<Value, String> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let source = source.to_string();
    app.get_webview(label)
        .ok_or_else(|| format!("no webview {label}"))?
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
        .recv_timeout(Duration::from_secs(8))
        .map_err(|e| e.to_string())??;
    serde_json::from_str(&result).map_err(|e| e.to_string())
}

/// (host window handle, browser process id, user data folder) of a webview.
fn webview_facts(app: &tauri::AppHandle, label: &str) -> Option<(isize, u32, String)> {
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Environment7;
    use windows_core::{Interface, PWSTR};
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.get_webview(label)?
        .with_webview(move |inner| unsafe {
            let mut host = HWND::default();
            let _ = inner.controller().ParentWindow(&mut host);
            let mut pid = 0u32;
            if let Ok(core) = inner.controller().CoreWebView2() {
                let _ = core.BrowserProcessId(&mut pid);
            }
            let mut udf = String::new();
            if let Ok(env7) = inner.environment().cast::<ICoreWebView2Environment7>() {
                let mut folder = PWSTR::null();
                if env7.UserDataFolder(&mut folder).is_ok() {
                    udf = folder.to_string().unwrap_or_default();
                    windows::Win32::System::Com::CoTaskMemFree(Some(folder.as_ptr().cast()));
                }
            }
            let _ = tx.send((host.0 as isize, pid, udf));
        })
        .ok()?;
    rx.recv_timeout(Duration::from_secs(5)).ok()
}

static CONSOLE: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

static NOTE_START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

/// Progress line in `<report>.progress.txt`, written at once, so a hang shows where.
fn note(message: &str) {
    use std::io::Write;
    let start = NOTE_START.get_or_init(Instant::now);
    let Ok(out) = std::env::var("NEBULA_SPIKE_OUT") else {
        return;
    };
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(format!("{out}.progress.txt"))
    {
        let _ = writeln!(file, "{:>7.1}s {message}", start.elapsed().as_secs_f32());
    }
}

/// Collects a webview's console, exceptions and log entries through CDP, in-process.
fn attach_console(app: &tauri::AppHandle, label: &str) {
    use windows::core::PCWSTR;
    let Some(webview) = app.get_webview(label) else {
        return;
    };
    let label = label.to_string();
    let _ = webview.with_webview(move |inner| unsafe {
        let Ok(core) = inner.controller().CoreWebView2() else {
            return;
        };
        for name in [
            "Runtime.consoleAPICalled",
            "Runtime.exceptionThrown",
            "Log.entryAdded",
        ] {
            let event = windows_core::HSTRING::from(name);
            let Ok(receiver) = core.GetDevToolsProtocolEventReceiver(PCWSTR(event.as_ptr())) else {
                continue;
            };
            let tag = label.clone();
            let handler = webview2_com::DevToolsProtocolEventReceivedEventHandler::create(
                Box::new(move |_, args| {
                    if let Some(args) = args {
                        let mut text = windows_core::PWSTR::null();
                        if args.ParameterObjectAsJson(&mut text).is_ok() && !text.is_null() {
                            let value = text.to_string().unwrap_or_default();
                            windows::Win32::System::Com::CoTaskMemFree(Some(text.as_ptr().cast()));
                            if let Ok(mut log) = CONSOLE.lock() {
                                if log.len() < 600 {
                                    log.push(format!(
                                        "[{tag}] {name}: {}",
                                        value.chars().take(380).collect::<String>()
                                    ));
                                }
                            }
                        }
                    }
                    Ok(())
                }),
            );
            let mut token = 0i64;
            let _ = receiver.add_DevToolsProtocolEventReceived(&handler, &mut token);
            std::mem::forget(handler);
        }
        for method in ["Runtime.enable", "Log.enable"] {
            let method_h = windows_core::HSTRING::from(method);
            let params = windows_core::HSTRING::from("{}");
            let done = webview2_com::CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                |_, _| Ok(()),
            ));
            let _ = core.CallDevToolsProtocolMethod(
                PCWSTR(method_h.as_ptr()),
                PCWSTR(params.as_ptr()),
                &done,
            );
        }
    });
}

struct Server {
    base: String,
    port: u16,
    stop: Arc<AtomicBool>,
}

fn start_server() -> Server {
    let first = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = first.local_addr().unwrap().port();
    let mut listeners = vec![first];
    // Nebula reuses a tab for the same site, so every tab needs a host of its own.
    for n in 10..=30 {
        if let Ok(listener) = TcpListener::bind(format!("127.0.0.{n}:{port}")) {
            listeners.push(listener);
        }
    }
    let stop = Arc::new(AtomicBool::new(false));
    for listener in listeners {
        listener.set_nonblocking(true).unwrap();
        let stopped = stop.clone();
        std::thread::spawn(move || {
            while !stopped.load(Ordering::Acquire) {
                let Ok((mut connection, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                };
                std::thread::spawn(move || {
                    let _ = connection.set_nonblocking(false);
                    let _ = connection.set_read_timeout(Some(Duration::from_secs(2)));
                    let mut bytes = [0u8; 8192];
                    let read = connection.read(&mut bytes).unwrap_or(0);
                    let request = String::from_utf8_lossy(&bytes[..read]).into_owned();
                    let first = request.lines().next().unwrap_or("").to_string();
                    let mut extra = String::new();
                    let body = if first.starts_with("GET /cookie") {
                        let seen = request
                            .lines()
                            .find(|l| l.to_ascii_lowercase().starts_with("cookie:"))
                            .unwrap_or("")
                            .to_string();
                        extra = "Set-Cookie: nebula_spike=1; Max-Age=86400; Path=/\r\n".into();
                        format!("<!doctype html><title>cookie page</title><body>seen:[{seen}]")
                    } else if first.starts_with("GET /popup") {
                        "<!doctype html><title>spike popup</title><body style=\"background:#246\">popup".to_string()
                    } else if first.starts_with("GET /page") {
                        let n = first
                            .split("n=")
                            .nth(1)
                            .and_then(|r| r.split([' ', '&']).next())
                            .unwrap_or("0");
                        format!("<!doctype html><title>spike tab {n}</title><body style=\"background:#123;color:#fff\"><h1>spike tab {n}</h1>{}", "<p>filler text for a page that weighs something</p>".repeat(40))
                    } else {
                        String::new()
                    };
                    let status = if body.is_empty() {
                        "404 Not Found"
                    } else {
                        "200 OK"
                    };
                    let _ = write!(
                    connection,
                    "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                });
            }
        });
    }
    Server {
        base: format!("http://127.0.0.1:{port}"),
        port,
        stop,
    }
}

struct Rect4 {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

/// Everything observable about the main window and its webviews at one moment.
fn observe(app: &tauri::AppHandle, stage: &str, inventory: bool) -> Value {
    let Some(main) = app.get_window("main") else {
        return json!({ "stage": stage, "error": "no main window" });
    };
    let scale = main.scale_factor().unwrap_or(1.0);
    let inner = main
        .inner_size()
        .map(|s| (s.width, s.height))
        .unwrap_or((0, 0));
    let monitor = main
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| (m.size().width, m.size().height));
    let window = json!({
        "visible": main.is_visible().unwrap_or(false),
        "minimized": main.is_minimized().unwrap_or(false),
        "maximized": main.is_maximized().unwrap_or(false),
        "fullscreen": main.is_fullscreen().unwrap_or(false),
        "scale": scale,
        "innerPhysical": [inner.0, inner.1],
        "monitorPhysical": monitor.map(|m| json!([m.0, m.1])),
    });

    let main_hwnd = main.hwnd().map(|h| h.0 as isize).unwrap_or(0);
    let mut origin = POINT { x: 0, y: 0 };
    if main_hwnd != 0 {
        unsafe {
            let _ = ClientToScreen(hwnd(main_hwnd), &mut origin);
        }
    }

    let main_rect = unsafe {
        let mut rect = windows::Win32::Foundation::RECT::default();
        if main_hwnd != 0 {
            let _ = GetWindowRect(hwnd(main_hwnd), &mut rect);
        }
        [
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top,
        ]
    };
    let mut hosts: Vec<(String, isize)> = Vec::new();
    let mut facts = serde_json::Map::new();
    for (label, webview) in app.webviews() {
        if webview.window().label() != "main" {
            continue;
        }
        if let Some((host, pid, udf)) = webview_facts(app, &label) {
            hosts.push((label.clone(), host));
            if inventory {
                facts.insert(label.clone(), json!({ "browserPid": pid, "udf": udf }));
            }
        }
    }

    let mut z: Vec<Value> = Vec::new();
    unsafe {
        let mut current = if main_hwnd != 0 {
            GetWindow(hwnd(main_hwnd), GW_CHILD).ok()
        } else {
            None
        };
        let mut guard = 0;
        while let Some(handle) = current {
            guard += 1;
            if guard > 64 {
                break;
            }
            let label = hosts
                .iter()
                .find(|(_, h)| *h == handle.0 as isize)
                .map(|(l, _)| l.clone())
                .unwrap_or_else(|| "?".into());
            let mut rect = windows::Win32::Foundation::RECT::default();
            let _ = GetWindowRect(handle, &mut rect);
            let r = Rect4 {
                x: rect.left - origin.x,
                y: rect.top - origin.y,
                w: rect.right - rect.left,
                h: rect.bottom - rect.top,
            };
            z.push(json!({
                "label": label,
                "visible": IsWindowVisible(handle).as_bool(),
                "rect": [r.x, r.y, r.w, r.h],
            }));
            current = GetWindow(handle, GW_HWNDNEXT).ok();
        }
    }

    let mut focus_label = Value::Null;
    let foreground_ours;
    unsafe {
        let fg = GetForegroundWindow();
        let mut pid = 0u32;
        let thread = GetWindowThreadProcessId(fg, Some(&mut pid));
        foreground_ours = pid == std::process::id();
        if thread != 0 {
            let mut info = GUITHREADINFO {
                cbSize: std::mem::size_of::<GUITHREADINFO>() as u32,
                ..Default::default()
            };
            if GetGUIThreadInfo(thread, &mut info).is_ok() && !info.hwndFocus.0.is_null() {
                for (label, host) in &hosts {
                    if hwnd(*host) == info.hwndFocus
                        || IsChild(hwnd(*host), info.hwndFocus).as_bool()
                    {
                        focus_label = json!(label);
                    }
                }
            }
        }
    }

    let tabs = app
        .webviews()
        .keys()
        .filter(|l| l.starts_with("nebula-tab-"))
        .count();
    json!({
        "stage": stage,
        "window": window,
        "zTopToBottom": z,
        "foregroundIsNebula": foreground_ours,
        "focusedWebview": focus_label,
        "tabWebviews": tabs,
        "mainRect": main_rect,
        "webviewLabels": app.webviews().keys().cloned().collect::<Vec<_>>(),
        "facts": facts,
    })
}

/// What must come back identical after a minimize/restore or a fullscreen round trip.
fn signature(observation: &Value) -> Value {
    let z = observation["zTopToBottom"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    json!({
        "z": z.iter().map(|c| format!("{}:{}:{}", c["label"], c["visible"], c["rect"])).collect::<Vec<_>>(),
        "fullscreen": observation["window"]["fullscreen"],
        "minimized": observation["window"]["minimized"],
    })
}

/// Properties that must hold whenever a tab is showing, however the window got there.
/// Smaller index in `zTopToBottom` means higher in the z-order.
fn invariants(o: &Value) -> Value {
    let z = o["zTopToBottom"].as_array().cloned().unwrap_or_default();
    let is_tab = |l: &str| l.starts_with("nebula-tab-") && !l.contains("prewarmed");
    let find = |pred: &dyn Fn(&str) -> bool| {
        z.iter()
            .position(|c| c["visible"] == true && c["label"].as_str().is_some_and(pred))
    };
    let (tab, main, chrome) = (
        find(&is_tab),
        find(&|l| l == "main"),
        find(&|l| l.starts_with("nebula-chrome")),
    );
    let visible_tabs = z
        .iter()
        .filter(|c| c["visible"] == true && c["label"].as_str().is_some_and(is_tab))
        .count();
    json!({
        "tabVisible": tab.is_some(),
        "tabAboveMain": matches!((tab, main), (Some(t), Some(m)) if t < m),
        "tabFillsMain": matches!((tab, main), (Some(t), Some(m)) if z[t]["rect"] == z[m]["rect"]),
        "chromePresent": chrome.is_some(),
        "chromeAboveTab": matches!((chrome, tab), (Some(c), Some(t)) if c < t),
        "visibleTabCount": visible_tabs,
    })
}

fn invariants_hold(i: &Value) -> bool {
    i["tabVisible"] == true
        && i["tabAboveMain"] == true
        && i["tabFillsMain"] == true
        && i["visibleTabCount"] == 1
}

fn top_tab(observation: &Value) -> Option<String> {
    observation["zTopToBottom"]
        .as_array()?
        .iter()
        .find_map(|c| {
            let label = c["label"].as_str()?;
            (label.starts_with("nebula-tab-")
                && !label.contains("prewarmed")
                && c["visible"] == true)
                .then(|| label.to_string())
        })
}

/// Real keyboard input goes to the focused webview; a person's focus is in the tab.
fn focus_top_tab(app: &tauri::AppHandle) -> Option<String> {
    let top = top_tab(&observe(app, "focus", false))?;
    if let Some(webview) = app.get_webview(&top) {
        let _ = webview.set_focus();
    }
    std::thread::sleep(Duration::from_millis(350));
    Some(top)
}

fn wait_for(what: &str, seconds: u64, mut condition: impl FnMut() -> bool) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(seconds);
    while !condition() {
        if Instant::now() >= deadline {
            return Err(format!("timed out waiting for {what}"));
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    Ok(())
}

fn make_foreground(app: &tauri::AppHandle) -> Result<(), String> {
    let main = app.get_window("main").ok_or("no main window")?;
    let handle = hwnd(main.hwnd().map_err(|e| e.to_string())?.0 as isize);
    for _ in 0..8 {
        unsafe {
            // Releasing and pressing Alt lets a process bring its own window up.
            let _ = SendInput(
                &[key(VK_MENU, false), key(VK_MENU, true)],
                std::mem::size_of::<INPUT>() as i32,
            );
            let _ = SetForegroundWindow(handle);
            let mut pid = 0u32;
            GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid));
            if pid == std::process::id() {
                return Ok(());
            }
        }
        std::thread::sleep(Duration::from_millis(300));
    }
    Err("could not bring the Nebula window to the foreground".into())
}

fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: vk,
                wScan: 0,
                dwFlags: if up {
                    KEYEVENTF_KEYUP
                } else {
                    KEYBD_EVENT_FLAGS(0)
                },
                time: 0,
                dwExtraInfo: 0,
            },
        },
    }
}

/// Sends a chord only while a Nebula window is in the foreground.
fn press(app: &tauri::AppHandle, chord: &[VIRTUAL_KEY]) -> Result<(), String> {
    make_foreground(app)?;
    let mut inputs: Vec<INPUT> = chord.iter().map(|k| key(*k, false)).collect();
    inputs.extend(chord.iter().rev().map(|k| key(*k, true)));
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(GetForegroundWindow(), Some(&mut pid));
        if pid != std::process::id() {
            return Err("foreground changed; keys not sent".into());
        }
        let sent = SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
        if sent as usize != inputs.len() {
            return Err(format!("SendInput sent {sent} of {}", inputs.len()));
        }
    }
    Ok(())
}

fn sample_memory(seconds: u32) -> Value {
    let scripts = PathBuf::from(std::env::var("NEBULA_SPIKE_SCRIPTS").unwrap_or_default())
        .join("extension-lab-memory.ps1");
    let log = std::env::temp_dir().join(format!(
        "nebula-spike-driver-memory-{}.log",
        std::process::id()
    ));
    let ok = std::process::Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&scripts)
        .args(["-AppPid", &std::process::id().to_string(), "-Log"])
        .arg(&log)
        .args(["-IntervalSeconds", "2", "-MaxSeconds", &seconds.to_string()])
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    let text = std::fs::read_to_string(&log).unwrap_or_default();
    let last = text
        .lines()
        .rfind(|l| !l.starts_with('#') && l.contains('|'))
        .unwrap_or("")
        .to_string();
    let fields: Vec<&str> = last.split('|').map(str::trim).collect();
    json!({
        "scriptOk": ok,
        "processes": fields.get(2).and_then(|v| v.parse::<u32>().ok()),
        "treeMb": fields.get(3).and_then(|v| v.trim_end_matches(" MB").parse::<u32>().ok()),
    })
}

fn open_urls(app: &tauri::AppHandle, server: &Server, range: std::ops::Range<usize>) {
    crate::external_open::spike_open_urls(
        app,
        range
            .map(|n| format!("http://127.0.0.{}:{}/page?n={n}", 10 + n, server.port))
            .collect(),
    );
}

/// Live tab webviews. Nebula creates a tab's webview when the tab is first shown, so
/// this is not the number of tabs; a pre-warmed spare is not a tab either.
fn tab_labels(app: &tauri::AppHandle) -> Vec<String> {
    app.webviews()
        .keys()
        .filter(|l| l.starts_with("nebula-tab-") && !l.contains("prewarmed"))
        .cloned()
        .collect()
}

fn phase_startup(app: &tauri::AppHandle) -> Result<Value, String> {
    wait_for("the main window", 60, || {
        app.get_window("main")
            .is_some_and(|w| w.is_visible().unwrap_or(false))
    })?;
    // The overlay webview is created when the shell needs it; do not insist on it.
    let _ = wait_for("the chrome webview", 8, || {
        app.get_webview("nebula-chrome").is_some()
    });
    std::thread::sleep(Duration::from_secs(4));
    Ok(json!({ "startup": observe(app, "startup", true) }))
}

fn phase_tabs3(app: &tauri::AppHandle, server: &Server) -> Result<Value, String> {
    open_urls(app, server, 0..3);
    wait_for("a live tab webview", 60, || !tab_labels(app).is_empty())?;
    std::thread::sleep(Duration::from_secs(8));
    let titles: Vec<Value> = tab_labels(app)
        .iter()
        .map(|l| script(app, l, "document.title").unwrap_or_else(|e| json!(format!("error: {e}"))))
        .collect();
    Ok(json!({ "titles": titles, "threeTabs": observe(app, "three_tabs", true) }))
}

fn phase_minimize_restore(app: &tauri::AppHandle, baseline: &Value) -> Result<Value, String> {
    let main = app.get_window("main").ok_or("no main window")?;
    if baseline.is_null() {
        return Err("no baseline observation (the tab phase did not run)".into());
    }
    // The state a cycle must return to is the settled one before the first minimize.
    std::thread::sleep(Duration::from_secs(2));
    let settled = observe(app, "settled", false);
    let want = signature(&settled);
    let before_invariants = invariants(&settled);
    let mut cycles = Vec::new();
    for cycle in 1..=5 {
        // Like a person: start from the active window, minimize, restore from the taskbar.
        let start_foreground = make_foreground(app).is_ok();
        main.minimize().map_err(|e| e.to_string())?;
        std::thread::sleep(Duration::from_millis(1500));
        let minimized = observe(app, "minimized", false);
        main.unminimize().map_err(|e| e.to_string())?;
        let reactivated = make_foreground(app).is_ok();
        std::thread::sleep(Duration::from_millis(3000));
        let restored = observe(app, "restored", false);
        let same = signature(&restored)["z"] == want["z"];
        let inv = invariants(&restored);
        cycles.push(json!({
            "cycle": cycle,
            "startedForeground": start_foreground,
            "reactivatedAfterRestore": reactivated,
            "minimizedFlag": minimized["window"]["minimized"],
            "restoredMatchesSettledState": same,
            "invariantsHold": invariants_hold(&inv),
            "invariants": inv,
            "restoredForeground": restored["foregroundIsNebula"],
            "restoredFocus": restored["focusedWebview"],
            "restoredZ": restored["zTopToBottom"],
        }));
    }
    Ok(json!({
        "settledInvariants": before_invariants,
        "settledZ": settled["zTopToBottom"],
        "cycles": cycles,
    }))
}

fn phase_f11(app: &tauri::AppHandle, baseline: &Value) -> Result<Value, String> {
    focus_top_tab(app).ok_or("no visible tab on top")?;
    std::thread::sleep(Duration::from_millis(500));
    let before = observe(app, "before_f11", false);
    // Fullscreen is measured on the showing tab's real rectangle: its height becomes the
    // monitor's. (Neither `inner_size` nor the window frame rectangle tracks it.)
    let tab_height = |o: &Value| -> Value {
        top_tab(o)
            .and_then(|label| {
                o["zTopToBottom"]
                    .as_array()?
                    .iter()
                    .find(|c| c["label"] == label.as_str())
                    .map(|c| c["rect"][3].clone())
            })
            .unwrap_or(Value::Null)
    };
    let initial = tab_height(&before);
    let monitor = before["window"]["monitorPhysical"].clone();
    let monitor_rect = monitor[1].clone();
    let poll = |app: &tauri::AppHandle, want: &Value, seconds: u64| -> (bool, f32, Value) {
        let started = Instant::now();
        loop {
            let o = observe(app, "poll", false);
            if tab_height(&o) == *want {
                return (true, started.elapsed().as_secs_f32(), o);
            }
            if started.elapsed() > Duration::from_secs(seconds) {
                return (false, started.elapsed().as_secs_f32(), o);
            }
            std::thread::sleep(Duration::from_millis(250));
        }
    };
    let focus_before = observe(app, "f11_focus", false)["focusedWebview"].clone();
    // 1) The real key. 2) If it changes nothing, the native toggle the shell would call.
    let key_sent = press(app, &[VK_F11]);
    let (mut entered, mut enter_seconds, mut on) = poll(app, &monitor_rect, 6);
    let mut via = "key";
    let mut toggled = String::new();
    if !entered {
        via = "native toggle";
        toggled = format!(
            "{:?}",
            crate::site_fullscreen_window::toggle_browser_fullscreen_window(app, "main")
        );
        (entered, enter_seconds, on) = poll(app, &monitor_rect, 8);
    }
    let (mut exited, mut exit_seconds, mut off) = (false, 0.0f32, Value::Null);
    let mut second_press = false;
    if entered {
        std::thread::sleep(Duration::from_millis(1500));
        on = observe(app, "fullscreen_on", false);
        if via == "key" {
            let _ = press(app, &[VK_F11]);
        } else {
            let _ = crate::site_fullscreen_window::toggle_browser_fullscreen_window(app, "main");
        }
        (exited, exit_seconds, off) = poll(app, &initial, 8);
        if !exited {
            // Leave the window usable for the phases that follow.
            let _ = crate::site_fullscreen_window::toggle_browser_fullscreen_window(app, "main");
            second_press = true;
            std::thread::sleep(Duration::from_secs(3));
        }
        std::thread::sleep(Duration::from_millis(1500));
        off = observe(app, "fullscreen_off", false);
    }
    Ok(json!({
        "initialInner": initial,
        "monitor": monitor,
        "focusBeforeKey": focus_before,
        "keyResult": format!("{key_sent:?}"),
        "enteredVia": via,
        "nativeToggleResult": toggled,
        "entered": entered,
        "enterSeconds": enter_seconds,
        "exited": exited,
        "exitSeconds": exit_seconds,
        "neededSecondPress": second_press,
        "on": on,
        "off": off,
        "invariantsOn": invariants(&on),
        "invariantsOff": invariants(&off),
        "invariantsOffHold": invariants_hold(&invariants(&off)),
        "chromeOnFullscreen": on["zTopToBottom"].as_array().map(|z| z.iter().filter(|c| c["label"].as_str().is_some_and(|l| l.starts_with("nebula-chrome")) && c["visible"] == true).count()),
        "baselineArg": baseline["window"]["innerPhysical"].clone(),
    }))
}

fn phase_popup(app: &tauri::AppHandle, base: &str, baseline: &Value) -> Result<Value, String> {
    let top = top_tab(baseline).ok_or("no visible tab on top")?;
    let opened = script(
        app,
        &top,
        &format!("(() => {{ const w = window.open('{base}/popup', '_blank', 'width=420,height=320'); return !!w; }})()"),
    )
    .unwrap_or_else(|e| json!(format!("error: {e}")));
    let found = wait_for("a popup content webview", 15, || {
        app.webviews()
            .keys()
            .any(|l| l.starts_with("nebula-popup-content-"))
    });
    std::thread::sleep(Duration::from_secs(2));
    let popup_label = app
        .webviews()
        .keys()
        .find(|l| l.starts_with("nebula-popup-content-"))
        .cloned();
    let facts = popup_label
        .as_ref()
        .and_then(|l| webview_facts(app, l))
        .map(|(_, pid, udf)| json!({ "browserPid": pid, "udf": udf }));
    let title = popup_label
        .as_ref()
        .and_then(|l| script(app, l, "document.title").ok());
    let windows_before: Vec<String> = app
        .windows()
        .keys()
        .filter(|l| l.starts_with("nebula-popup-window-"))
        .cloned()
        .collect();
    for label in &windows_before {
        if let Some(window) = app.get_window(label) {
            let _ = window.destroy();
        }
    }
    std::thread::sleep(Duration::from_secs(3));
    let gone = !app
        .webviews()
        .keys()
        .any(|l| l.starts_with("nebula-popup-content-"));
    Ok(json!({
        "windowOpenReturned": opened,
        "contentCreated": found.is_ok(),
        "popupContent": popup_label,
        "facts": facts,
        "title": title,
        "popupWindows": windows_before,
        "contentGoneAfterClose": gone,
    }))
}

fn phase_tabs20(app: &tauri::AppHandle, server: &Server) -> Result<Value, String> {
    // The first phase already left three tabs open; add more until there are 20.
    let before = tab_labels(app).len();
    note(&format!("tabs20: start, {before} live tab webviews"));
    open_urls(app, server, 3..20);
    std::thread::sleep(Duration::from_secs(4));

    // A tab's webview exists once the tab has been shown, so walk them with the real
    // shortcut: that is what creates, stacks and focuses each one.
    let mut visited = std::collections::BTreeSet::new();
    let mut walk_errors = Vec::new();
    let mut live_timeline = Vec::new();
    for step in 0..24 {
        note(&format!("walk {step}: focusing"));
        focus_top_tab(app);
        note(&format!("walk {step}: pressing Ctrl+Tab"));
        if let Err(e) = press(app, &[VK_CONTROL, VK_TAB]) {
            note(&format!("walk {step}: press failed: {e}"));
            walk_errors.push(e);
            break;
        }
        // A new tab's webview takes a moment to appear.
        std::thread::sleep(Duration::from_millis(1800));
        for label in tab_labels(app) {
            visited.insert(label);
        }
        live_timeline.push(tab_labels(app).len());
        note(&format!(
            "walk {step}: {} live tab webviews",
            tab_labels(app).len()
        ));
    }
    std::thread::sleep(Duration::from_secs(6));
    note("observing 20 tabs");
    let twenty = observe(app, "twenty_tabs", true);
    note("sampling memory");
    let memory_open = sample_memory(8);
    note("memory sampled; closing tabs");

    // Close them with the real shortcut.
    let started = Instant::now();
    let mut timeline = Vec::new();
    for _ in 0..40 {
        if tab_labels(app).is_empty() {
            break;
        }
        focus_top_tab(app);
        if let Err(e) = press(app, &[VK_CONTROL, VK_W]) {
            walk_errors.push(e);
            break;
        }
        std::thread::sleep(Duration::from_millis(500));
        timeline.push(tab_labels(app).len());
        note(&format!(
            "close: {} live tab webviews",
            tab_labels(app).len()
        ));
    }
    std::thread::sleep(Duration::from_secs(6));
    let remaining = tab_labels(app).len();
    note("sampling memory after close");
    let memory_closed = sample_memory(6);
    note("tabs20 done");
    Ok(json!({
        "tabsBeforeOpening": before,
        "twentyTabs": twenty,
        "memoryWith20Tabs": memory_open,
        "distinctTabsVisitedByCtrlTab": visited.len(),
        "liveTabWebviewsWhileWalking": live_timeline,
        "closeTimeline": timeline,
        "closeSeconds": started.elapsed().as_secs_f32(),
        "tabsRemaining": remaining,
        "memoryAfterClose": memory_closed,
        "inputErrors": walk_errors,
    }))
}

/// Runs JS files (comma separated in NEBULA_SPIKE_EVAL) in a webview, one every
/// NEBULA_SPIKE_EVAL_GAP seconds, and reports each result. Probing without a rebuild.
fn phase_eval(app: &tauri::AppHandle) -> Result<Value, String> {
    let files = std::env::var("NEBULA_SPIKE_EVAL").map_err(|_| "NEBULA_SPIKE_EVAL is not set")?;
    let label = std::env::var("NEBULA_SPIKE_EVAL_LABEL").unwrap_or_else(|_| "main".into());
    let wait: u64 = std::env::var("NEBULA_SPIKE_EVAL_WAIT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);
    let gap: u64 = std::env::var("NEBULA_SPIKE_EVAL_GAP")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(4);
    std::thread::sleep(Duration::from_secs(wait));
    let mut results = Vec::new();
    for file in files.split(',') {
        let js = std::fs::read_to_string(file.trim()).map_err(|e| format!("{file}: {e}"))?;
        let value =
            script(app, &label, &js).unwrap_or_else(|e| json!(format!("script error: {e}")));
        results.push(json!({ "file": file, "result": value }));
        std::thread::sleep(Duration::from_secs(gap));
    }
    Ok(json!({ "label": label, "results": results, "observation": observe(app, "eval", true) }))
}

/// Repeats what the shell's JS does to create a tab webview and reports the answer.
fn phase_diag(app: &tauri::AppHandle, server: &Server) -> Result<Value, String> {
    let url = format!("http://127.0.0.42:{}/page?n=99", server.port);
    let source = format!(
        "(() => {{ window.__diag = 'pending'; window.__TAURI_INTERNALS__.invoke('plugin:webview|create_webview', {{ windowLabel: 'main', options: {{ label: 'nebula-tab-spike-diag', url: '{url}', x: 0, y: 0, width: 400, height: 300, browserExtensionsEnabled: true }} }}).then(() => {{ window.__diag = 'ok'; }}).catch((e) => {{ window.__diag = 'error:' + e; }}); return 1; }})()"
    );
    script(app, "main", &source)?;
    std::thread::sleep(Duration::from_secs(8));
    let result = script(app, "main", "window.__diag ?? null").unwrap_or(Value::Null);
    let facts = webview_facts(app, "nebula-tab-spike-diag")
        .map(|(_, pid, udf)| json!({ "browserPid": pid, "udf": udf }));
    let title = script(app, "nebula-tab-spike-diag", "document.title").ok();
    if let Some(webview) = app.get_webview("nebula-tab-spike-diag") {
        let _ = webview.close();
    }
    Ok(json!({ "createWebviewResult": result, "facts": facts, "title": title }))
}

/// The profile owner is invisible, has no IPC, can only show about:blank, is in the
/// browsing process, and is not part of the shell's window.
fn phase_hostcheck(app: &tauri::AppHandle, server: &Server) -> Result<Value, String> {
    let owner = crate::browser_profile::owner(app)?;
    let _ = &owner;
    let label = crate::browser_profile::OWNER_LABEL;
    let visible = app
        .get_webview_window(label)
        .map(|w| w.is_visible().unwrap_or(true));
    let _ = script(
        app,
        label,
        "(() => { window.__ipc = 'pending'; try { window.__TAURI_INTERNALS__.invoke('shell_split_enabled').then((r) => { window.__ipc = 'allowed:' + r; }).catch((e) => { window.__ipc = 'denied:' + e; }); } catch (e) { window.__ipc = 'no-bridge:' + e; } return 1; })()",
    );
    let _ = script(
        app,
        label,
        &format!(
            "(() => {{ location.href = '{}/page?n=77'; return 1; }})()",
            server.base
        ),
    );
    std::thread::sleep(Duration::from_secs(3));
    let ipc = script(app, label, "window.__ipc ?? null").unwrap_or(Value::Null);
    let location = script(app, label, "location.href").unwrap_or(Value::Null);
    let facts =
        webview_facts(app, label).map(|(_, pid, udf)| json!({ "browserPid": pid, "udf": udf }));
    let tab_pid = tab_labels(app)
        .first()
        .and_then(|l| webview_facts(app, l))
        .map(|(_, pid, _)| pid);
    let observation = observe(app, "hostcheck", false);
    // Children of the shell's window, top to bottom: the owner is its own window.
    let in_shell_window = observation["zTopToBottom"]
        .as_array()
        .is_some_and(|children| children.iter().any(|c| c["label"] == label));
    let capability_files =
        std::fs::read_dir(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("capabilities"))
            .map(|dir| {
                dir.flatten()
                    .filter_map(|entry| std::fs::read_to_string(entry.path()).ok())
                    .filter(|text| {
                        text.contains("extension-browse-host") || text.contains("extension-*")
                    })
                    .count()
            })
            .unwrap_or(usize::MAX);
    Ok(json!({
        "label": label,
        "windowVisible": visible,
        "ipcCall": ipc,
        "locationAfterNavigationAttempt": location,
        "facts": facts,
        "samePidAsATab": tab_pid.map(|pid| facts.as_ref().is_some_and(|f| f["browserPid"] == pid)),
        "listedAsAShellWindowWebview": in_shell_window,
        "capabilityFilesMatchingTheLabel": capability_files,
        "lifecycleTreatsItAsBackground": label.starts_with("extension-"),
    }))
}

/// What the owner costs, and that it goes away by itself: memory and processes while it
/// exists, after its idle teardown, and that the next operation brings it back.
fn phase_hostcost(app: &tauri::AppHandle) -> Result<Value, String> {
    let label = crate::browser_profile::OWNER_LABEL;
    {
        let _lease = crate::browser_profile::owner(app)?;
        std::thread::sleep(Duration::from_secs(3));
    }
    let with_owner = sample_memory(6);
    let existed = app.get_webview(label).is_some();
    // Past the 60 s idle window, with a margin for the teardown thread's 5 s tick.
    std::thread::sleep(Duration::from_secs(75));
    let gone = app.get_webview(label).is_none();
    let without_owner = sample_memory(6);
    let again = tauri::async_runtime::block_on(crate::ublock_extension::ublock_extension_status(
        app.clone(),
        "main".into(),
    ));
    let back = app.get_webview(label).is_some();
    Ok(json!({
        "ownerExistedWhileInUse": existed,
        "withOwner": with_owner,
        "ownerGoneAfterIdle": gone,
        "withoutOwner": without_owner,
        "nextOperationWorks": again.as_ref().map(|s| serde_json::to_value(s).unwrap_or(Value::Null)).map_err(|e| e.clone()),
        "ownerBackAfterOperation": back,
    }))
}
/// Every profile-level operation, called the old way (with the shell's label where the
/// command still takes one) and checked to land on the browsing profile.
fn phase_profileops(app: &tauri::AppHandle) -> Result<Value, String> {
    let folder = crate::browser_profile::user_data_folder(app);
    let ublock = tauri::async_runtime::block_on(crate::ublock_extension::ublock_extension_status(
        app.clone(),
        "main".into(),
    ));
    let usage = crate::webview_privacy::profile_storage_usage(app)
        .map(|u| serde_json::to_value(u).unwrap_or(Value::Null));
    let permissions = tauri::async_runtime::block_on(
        crate::webview_privacy::clear_site_permissions(app, "https://example.com"),
    );
    let enumerated =
        crate::extension_install::enumerate(app.clone(), crate::browser_profile::owner_label(app)?);
    let processes = tauri::async_runtime::block_on(
        crate::webview_controls::webview_process_snapshot(app.clone()),
    );
    let process_summary = processes.as_ref().map(|list| {
        let value = serde_json::to_value(list).unwrap_or(Value::Null);
        let browsers: std::collections::BTreeSet<i64> = value
            .as_array()
            .into_iter()
            .flatten()
            .filter(|p| p["kind"] == "browser")
            .filter_map(|p| p["pid"].as_i64())
            .collect();
        json!({ "processes": value.as_array().map(|a| a.len()), "browserProcesses": browsers })
    });
    Ok(json!({
        "browserProfileFolder": folder.as_ref().map(|p| p.display().to_string()).map_err(|e| e.clone()),
        "ublockStatusWithShellLabel": ublock.as_ref().map(|s| serde_json::to_value(s).unwrap_or(Value::Null)).map_err(|e| e.clone()),
        "storageUsage": usage,
        "clearSitePermissions": permissions.as_ref().map(|_| "ok").map_err(|e| e.clone()),
        "enumerateExtensions": enumerated.as_ref().map(|m| m.len()).map_err(|e| e.clone()),
        "processSnapshot": process_summary,
    }))
}

fn phase_oauth(app: &tauri::AppHandle, base: &str) -> Result<Value, String> {
    let window = crate::google_oauth::open_google_oauth_popup(app, &format!("{base}/cookie"))?;
    let label = window.label().to_string();
    std::thread::sleep(Duration::from_secs(5));
    let facts =
        webview_facts(app, &label).map(|(_, pid, udf)| json!({ "browserPid": pid, "udf": udf }));
    let page = script(
        app,
        &label,
        "document.body ? document.body.textContent : null",
    )
    .unwrap_or_else(|e| json!(format!("error: {e}")));
    let ipc_type = script(app, &label, "typeof window.__TAURI_INTERNALS__").unwrap_or(Value::Null);
    let _ = script(
        app,
        &label,
        "(() => { window.__ipc = 'pending'; try { window.__TAURI_INTERNALS__.invoke('shell_split_enabled').then((r) => { window.__ipc = 'allowed:' + r; }).catch((e) => { window.__ipc = 'denied:' + e; }); } catch (e) { window.__ipc = 'no-bridge:' + e; } return 1; })()",
    );
    std::thread::sleep(Duration::from_secs(2));
    let ipc = script(app, &label, "window.__ipc ?? null").unwrap_or(Value::Null);
    let _ = window.destroy();
    Ok(
        json!({ "label": label, "facts": facts, "page": page, "tauriBridgeType": ipc_type, "ipcCall": ipc }),
    )
}

/// uBO Lite readiness from the host, timed: after a fresh install, again right away and
/// once more after the worker has been left idle. Install first if the profile has none.
fn phase_ready(app: &tauri::AppHandle) -> Result<Value, String> {
    use crate::ublock_extension as ub;
    let before = ub::ublock_extension_status_blocking(app.clone())?;
    let mut installed_now = false;
    if !before.installed || !before.enabled {
        ub::ublock_extension_install_blocking(app.clone())?;
        installed_now = true;
    }
    let mut samples = Vec::new();
    for gap in [0u64, 0, 20] {
        std::thread::sleep(Duration::from_secs(gap));
        let started = Instant::now();
        let ready = ub::ublock_extension_ready_blocking(app.clone());
        samples.push(json!({
            "afterIdleSeconds": gap,
            "ready": ready.as_ref().ok(),
            "error": ready.as_ref().err(),
            "millis": started.elapsed().as_millis(),
        }));
    }
    Ok(json!({ "installedNow": installed_now, "statusBefore": serde_json::to_value(&before).unwrap_or(Value::Null), "samples": samples }))
}

/// Service-worker lifecycle around the uBO readiness wait. Every scenario reports
/// whether it behaved and how long it took.
fn phase_readylife(app: &tauri::AppHandle) -> Result<Value, String> {
    use crate::extension_worker as worker;
    use crate::ublock_extension as ub;
    note("readylife: start");
    let before = ub::ublock_extension_status_blocking(app.clone())?;
    note("readylife: status read");
    let installed_now = !before.installed || !before.enabled;
    if installed_now {
        ub::ublock_extension_install_blocking(app.clone())?;
    }
    let id = ub::ublock_extension_id(app).ok_or("no uBO install marker after install")?;
    let _lease = crate::browser_profile::owner(app)?;
    let label = crate::browser_profile::OWNER_LABEL;
    let flag = "globalThis.nebulaInitialized === true";
    let mut scenarios = Vec::new();
    note("readylife: installed, owner leased");
    let mut record = |name: &str, ok: bool, millis: u128, detail: Value| {
        note(&format!("readylife: {name}: ok={ok} {millis} ms"));
        scenarios.push(json!({ "name": name, "ok": ok, "millis": millis, "detail": detail }));
    };
    let timed = |f: &dyn Fn() -> Result<bool, String>| {
        let started = Instant::now();
        let result = f();
        (result, started.elapsed().as_millis())
    };
    let host_ready = || ub::ublock_extension_ready_blocking(app.clone());
    let stop_all = || {
        let _ = worker::cdp(app, label, None, "ServiceWorker.enable", &json!({}));
        worker::cdp(app, label, None, "ServiceWorker.stopAllWorkers", &json!({}))
    };
    let worker_count = || -> usize {
        worker::cdp(app, label, None, "Target.getTargets", &json!({}))
            .ok()
            .and_then(|v| v["targetInfos"].as_array().map(|l| l.iter().filter(|t| t["type"] == "service_worker").count()))
            .unwrap_or(usize::MAX)
    };

    // 1. First answer after the install (fresh profile: the worker has never run).
    let (r, ms) = timed(&host_ready);
    record("first answer after install", matches!(r, Ok(true)), ms, json!({ "installedNow": installed_now, "result": format!("{r:?}") }));
    // 2. Worker running and initialised.
    let (r, ms) = timed(&host_ready);
    record("worker already running", matches!(r, Ok(true)) && ms < 1500, ms, json!({ "result": format!("{r:?}") }));
    // 3. Worker stopped (idle shutdown): the check starts it again.
    let stopped = stop_all();
    std::thread::sleep(Duration::from_millis(800));
    let gone = worker_count();
    let (r, ms) = timed(&host_ready);
    record("worker stopped, then asked", matches!(r, Ok(true)), ms, json!({ "stopCall": stopped.is_ok(), "workersAfterStop": gone, "result": format!("{r:?}") }));
    // 4. Worker stopped again while the wait is polling: it must re-attach to the next one.
    let _ = stop_all();
    std::thread::sleep(Duration::from_millis(500));
    let killer = {
        let app = app.clone();
        std::thread::spawn(move || {
            for delay in [350u64, 900] {
                std::thread::sleep(Duration::from_millis(delay));
                let _ = crate::extension_worker::cdp(&app, crate::browser_profile::OWNER_LABEL, None, "ServiceWorker.stopAllWorkers", &json!({}));
            }
        })
    };
    let (r, ms) = timed(&host_ready);
    let _ = killer.join();
    record("worker stopped twice during the wait", matches!(r, Ok(true)), ms, json!({ "result": format!("{r:?}") }));
    // 5. A condition that never becomes true ends at its deadline, not later, not never.
    let (r, ms) = timed(&|| worker::wait_for_condition(app, label, &id, "false", Duration::from_secs(2)));
    record("never-true condition ends at the deadline", matches!(r, Ok(false)) && (1900..6000).contains(&ms), ms, json!({ "result": format!("{r:?}") }));
    // 6. An extension that is not there: no hang, no error, "not ready".
    let bogus = "a".repeat(32);
    let (r, ms) = timed(&|| worker::wait_for_condition(app, label, &bogus, flag, Duration::from_secs(2)));
    record("unknown extension id ends at the deadline", matches!(r, Ok(false)) && ms < 15000, ms, json!({ "result": format!("{r:?}") }));
    // 7. And the real one still works afterwards.
    let (r, ms) = timed(&host_ready);
    record("ready again after the failures", matches!(r, Ok(true)), ms, json!({ "result": format!("{r:?}") }));
    let all_ok = scenarios.iter().all(|s| s["ok"] == true);
    Ok(json!({ "allOk": all_ok, "installedNow": installed_now, "scenarios": scenarios }))
}

/// Owner churn: one real profile operation (the uBO status check) every `gap` seconds,
/// `cycles` times. NEBULA_SPIKE_CHURN="gap:cycles,gap:cycles". Each cycle records the
/// latency of the operation, whether the owner had to be created, the counters, and the
/// process count and tree memory at the end.
fn phase_churn(app: &tauri::AppHandle) -> Result<Value, String> {
    let spec = std::env::var("NEBULA_SPIKE_CHURN").unwrap_or_else(|_| "20:6,70:4".into());
    let mut runs = Vec::new();
    let label = crate::browser_profile::OWNER_LABEL;
    for part in spec.split(',') {
        let (gap, cycles) = part.split_once(':').ok_or("bad NEBULA_SPIKE_CHURN")?;
        let gap: u64 = gap.parse().map_err(|_| "bad gap")?;
        let cycles: u32 = cycles.parse().map_err(|_| "bad cycles")?;
        // Start every run from "no owner", so the first operation is a cold one.
        let settle = Instant::now() + Duration::from_secs(90);
        while app.get_webview(label).is_some() && Instant::now() < settle {
            std::thread::sleep(Duration::from_secs(2));
        }
        let (c0, d0, m0) = crate::browser_profile::churn_counters();
        let memory_start = sample_memory(4);
        let mut rows = Vec::new();
        for cycle in 0..cycles {
            let existed = app.get_webview(label).is_some();
            let started = Instant::now();
            let status = crate::ublock_extension::ublock_extension_status_blocking(app.clone());
            rows.push(json!({
                "cycle": cycle,
                "ownerExistedBefore": existed,
                "operationMillis": started.elapsed().as_millis(),
                "ok": status.is_ok(),
            }));
            std::thread::sleep(Duration::from_secs(gap));
        }
        let (c1, d1, m1) = crate::browser_profile::churn_counters();
        let memory_end = sample_memory(4);
        runs.push(json!({
            "gapSeconds": gap,
            "cycles": rows,
            "created": c1 - c0,
            "destroyed": d1 - d0,
            "createMillisTotal": (m1 - m0) / 1000,
            "memoryAtStart": memory_start,
            "memoryAtEnd": memory_end,
        }));
    }
    Ok(json!({ "runs": runs }))
}

pub fn start(app: tauri::AppHandle) {
    let Ok(name) = std::env::var("NEBULA_SPIKE_DRIVER") else {
        return;
    };
    let out = PathBuf::from(
        std::env::var("NEBULA_SPIKE_OUT").unwrap_or_else(|_| "spike-driver.json".into()),
    );
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(
            std::env::var("NEBULA_SPIKE_WATCHDOG")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(600),
        ));
        eprintln!("spike driver watchdog expired");
        std::process::exit(2);
    });
    std::thread::spawn(move || {
        let phases: Vec<String> = std::env::var("NEBULA_SPIKE_PHASES")
            .unwrap_or_else(|_| "startup,tabs3,minrestore,popup,f11,tabs20,oauth".into())
            .split(',')
            .map(|s| s.trim().to_string())
            .collect();
        let server = start_server();
        if std::env::var("NEBULA_SPIKE_CONSOLE").is_ok() {
            let watcher = app.clone();
            std::thread::spawn(move || {
                let mut attached = std::collections::HashSet::new();
                loop {
                    for label in watcher.webviews().keys() {
                        if attached.insert(label.clone()) {
                            attach_console(&watcher, label);
                        }
                    }
                    std::thread::sleep(Duration::from_millis(400));
                }
            });
        }
        let mut report = serde_json::Map::new();
        report.insert("driver".into(), json!(name));
        report.insert("split".into(), json!(crate::shell_split::enabled()));
        let mut baseline = Value::Null;
        let started = Instant::now();
        for phase in &phases {
            report.insert("currentPhase".into(), json!(phase));
            let _ = std::fs::write(
                &out,
                serde_json::to_string_pretty(&Value::Object(report.clone())).unwrap(),
            );
            let result = match phase.as_str() {
                "startup" => phase_startup(&app),
                "tabs3" => {
                    phase_tabs3(&app, &server).inspect(|v| baseline = v["threeTabs"].clone())
                }
                "minrestore" => phase_minimize_restore(&app, &baseline),
                "f11" => phase_f11(&app, &baseline),
                "popup" => phase_popup(&app, &server.base, &baseline),
                "tabs20" => phase_tabs20(&app, &server),
                "oauth" => phase_oauth(&app, &server.base),
                "diag" => phase_diag(&app, &server),
                "hostcheck" => phase_hostcheck(&app, &server),
                "hostcost" => phase_hostcost(&app),
                "profileops" => phase_profileops(&app),
                "ready" => phase_ready(&app),
                "readylife" => phase_readylife(&app),
                "churn" => phase_churn(&app),
                "eval" => phase_eval(&app),
                "open3" => {
                    open_urls(&app, &server, 0..3);
                    Ok(json!({ "queued": 3 }))
                }
                other => Err(format!("unknown phase {other}")),
            };
            let mut entry = result.unwrap_or_else(|e| json!({ "error": e }));
            if let Some(object) = entry.as_object_mut() {
                object.insert("elapsedSeconds".into(), json!(started.elapsed().as_secs()));
            }
            report.insert(phase.clone(), entry);
            // A phase that hangs later must not cost the earlier results.
            let _ = std::fs::write(
                &out,
                serde_json::to_string_pretty(&Value::Object(report.clone())).unwrap(),
            );
        }
        server.stop.store(true, Ordering::Release);
        if let Ok(log) = CONSOLE.lock() {
            report.insert("console".into(), json!(log.clone()));
        }
        let _ = std::fs::write(
            &out,
            serde_json::to_string_pretty(&Value::Object(report)).unwrap(),
        );
        app.exit(0);
    });
}
