//! SPIKE, not product code. Question: can Nebula's trusted shell live in its own
//! WebView2 environment (own user data folder, browser extensions OFF) while tabs
//! and extensions share another one, so that no extension can reach the shell?
//!
//! Every scenario runs in its own test (its own process), because the browser
//! processes belong to the test process and are what gets counted.
//!
//! The "evil" extension asks for everything: `<all_urls>`, `tabs`, `scripting`,
//! `debugger`, `declarativeNetRequest`, `cookies`, plus a content script on every
//! page. It reports what it can do to a local collector. The shell is the real
//! app page (`http://tauri.localhost/index.html`) carrying a sentinel.
//!
//! Control first: with shell and tabs in ONE environment the evil extension must
//! reach the shell, otherwise a passing result in the split layout proves nothing.
use super::script;
use crate::extension_install::InstallationLocation;
use serde_json::{json, Value};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;

const SHELL_INIT: &str = r#"
window.__NEBULA_TRUSTED_SHELL__ = 'sentinel-' + Math.random().toString(36).slice(2);
document.addEventListener('DOMContentLoaded', () => {
  document.documentElement.setAttribute('data-nebula-shell', window.__NEBULA_TRUSTED_SHELL__);
});
setTimeout(() => {
  fetch('http://tauri.localhost/__nebula_probe.txt')
    .then((r) => { window.__dnr_probe = 'status:' + r.status; })
    .catch((e) => { window.__dnr_probe = 'blocked:' + e; });
}, 10000);
"#;

fn tab_page() -> String {
    "<!doctype html><title>Tab page</title><body>tab page<script>\
     setTimeout(() => { fetch('/__nebula_probe.txt')\
       .then((r) => { window.__dnr_probe = 'status:' + r.status; })\
       .catch((e) => { window.__dnr_probe = 'blocked:' + e; }); }, 10000);\
     </script>"
        .into()
}

fn evil_manifest() -> &'static str {
    r#"{
  "manifest_version": 3,
  "name": "Evil probe",
  "version": "1.0.0",
  "permissions": ["tabs", "scripting", "debugger", "declarativeNetRequest", "declarativeNetRequestWithHostAccess", "cookies", "storage", "webNavigation"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "sw.js" },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["content.js"], "run_at": "document_idle" }]
}"#
}

const EVIL_CONTENT: &str = r#"
chrome.runtime.sendMessage({
  kind: 'content',
  info: { where: location.href, shellAttr: document.documentElement.getAttribute('data-nebula-shell'), title: document.title },
});
"#;

fn evil_worker(base: &str, port: u16) -> String {
    format!(
        r#"
const BASE = '{base}';
const post = (kind, data) => fetch(BASE + '/report', {{ method: 'POST', body: JSON.stringify({{ kind, data }}) }}).catch(() => {{}});
chrome.runtime.onMessage.addListener((m) => {{ if (m && m.kind === 'content') post('content', m.info); }});
async function probe(round) {{
  const out = {{ round, tabs: [], exec: [], dbg: [] }};
  try {{ out.tabs = (await chrome.tabs.query({{}})).map((t) => ({{ id: t.id, url: t.url }})); }} catch (e) {{ out.tabsError = String(e).slice(0, 160); }}
  for (const t of out.tabs) {{
    try {{
      const r = await chrome.scripting.executeScript({{ target: {{ tabId: t.id }}, world: 'MAIN', func: () => ({{ u: location.href, s: window.__NEBULA_TRUSTED_SHELL__ ?? null }}) }});
      out.exec.push({{ tab: t.url, r: r[0] && r[0].result }});
    }} catch (e) {{ out.exec.push({{ tab: t.url, error: String(e).slice(0, 160) }}); }}
    try {{
      await chrome.debugger.attach({{ tabId: t.id }}, '1.3');
      const r = await chrome.debugger.sendCommand({{ tabId: t.id }}, 'Runtime.evaluate', {{ expression: 'location.href + " | " + (window.__NEBULA_TRUSTED_SHELL__ || "")' }});
      out.dbg.push({{ tab: t.url, r: r && r.result && r.result.value }});
      await chrome.debugger.detach({{ tabId: t.id }});
    }} catch (e) {{ out.dbg.push({{ tab: t.url, error: String(e).slice(0, 160) }}); }}
  }}
  try {{
    await chrome.declarativeNetRequest.updateDynamicRules({{
      removeRuleIds: [1, 2],
      addRules: [
        {{ id: 1, priority: 1, action: {{ type: 'block' }}, condition: {{ urlFilter: '||tauri.localhost/__nebula_probe', resourceTypes: ['xmlhttprequest', 'other'] }} }},
        {{ id: 2, priority: 1, action: {{ type: 'block' }}, condition: {{ urlFilter: '||127.0.0.1:{port}/__nebula_probe', resourceTypes: ['xmlhttprequest', 'other'] }} }},
      ],
    }});
    out.dnr = 'rules-added';
  }} catch (e) {{ out.dnr = String(e).slice(0, 160); }}
  try {{ out.cookies = (await chrome.cookies.getAll({{ domain: 'tauri.localhost' }})).length; }} catch (e) {{ out.cookiesError = String(e).slice(0, 100); }}
  await post('probe', out);
}}
chrome.runtime.onInstalled.addListener(() => {{
  setTimeout(() => probe(1), 5000);
  setTimeout(() => probe(2), 13000);
}});
"#
    )
}

struct Collector {
    base: String,
    port: u16,
    reports: Arc<Mutex<Vec<Value>>>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl Collector {
    fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        let reports = Arc::new(Mutex::new(Vec::new()));
        let stop = Arc::new(AtomicBool::new(false));
        let (sink, stopped) = (reports.clone(), stop.clone());
        let thread = std::thread::spawn(move || {
            while !stopped.load(Ordering::Acquire) {
                let Ok((mut connection, _)) = listener.accept() else {
                    std::thread::sleep(Duration::from_millis(10));
                    continue;
                };
                let _ = connection.set_nonblocking(false);
                let _ = connection.set_read_timeout(Some(Duration::from_secs(2)));
                let mut bytes = Vec::new();
                let mut chunk = [0u8; 4096];
                let (mut head_end, mut length) = (None, 0usize);
                loop {
                    let Ok(read) = connection.read(&mut chunk) else {
                        break;
                    };
                    if read == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&chunk[..read]);
                    if head_end.is_none() {
                        if let Some(at) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                            head_end = Some(at + 4);
                            let head = String::from_utf8_lossy(&bytes[..at]).to_ascii_lowercase();
                            length = head
                                .lines()
                                .find_map(|l| l.strip_prefix("content-length:"))
                                .and_then(|v| v.trim().parse().ok())
                                .unwrap_or(0);
                        }
                    }
                    if let Some(end) = head_end {
                        if bytes.len() >= end + length {
                            break;
                        }
                    }
                }
                let text = String::from_utf8_lossy(&bytes).into_owned();
                let first = text.lines().next().unwrap_or("").to_string();
                let body = head_end.map(|e| String::from_utf8_lossy(&bytes[e..]).into_owned());
                let (status, content) = if first.starts_with("POST /report") {
                    if let Some(value) = body.and_then(|b| serde_json::from_str::<Value>(&b).ok()) {
                        sink.lock().unwrap().push(value);
                    }
                    ("200 OK", String::new())
                } else if first.starts_with("GET /__nebula_probe") {
                    ("200 OK", "ok".to_string())
                } else if first.starts_with("GET /page") {
                    ("200 OK", tab_page())
                } else {
                    ("404 Not Found", String::new())
                };
                let _ = write!(
                    connection,
                    "HTTP/1.1 {status}\r\nContent-Type: text/html\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{content}",
                    content.len()
                );
            }
        });
        Self {
            base: format!("http://127.0.0.1:{port}"),
            port,
            reports,
            stop,
            thread: Some(thread),
        }
    }

    fn finish(mut self) -> Vec<Value> {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        self.reports.lock().unwrap().clone()
    }
}

fn evil_location(root: PathBuf, base: &str, port: u16) -> InstallationLocation {
    let worker = evil_worker(base, port);
    let entries: Vec<(PathBuf, Vec<u8>)> = [
        ("manifest.json", evil_manifest().to_string()),
        ("sw.js", worker),
        ("content.js", EVIL_CONTENT.to_string()),
    ]
    .into_iter()
    .map(|(name, body)| (PathBuf::from(name), body.into_bytes()))
    .collect();
    let folder =
        crate::extension_install::prepare_discovery_directory(&root, "1.0.0", entries).unwrap();
    InstallationLocation { root, folder }
}

#[derive(Clone)]
struct Layout {
    /// Folder of the shell webview. Equal to `browse_dir` for the control.
    shell_dir: PathBuf,
    shell_extensions: bool,
    /// Folder of tabs and extensions.
    browse_dir: PathBuf,
    tabs: usize,
    evil: bool,
    /// An extra hidden webview in a third folder, like today's catalog host.
    catalog_dir: Option<PathBuf>,
    /// Also open a private (InPrivate) tab in the browsing folder.
    private_tab: bool,
    /// Try a webview with extensions OFF in the browsing folder (environment mismatch).
    mismatch: bool,
}

fn browser_pid(app: &tauri::AppHandle, label: &str) -> Option<u32> {
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.get_webview(label)?
        .with_webview(move |inner| unsafe {
            let pid = inner.controller().CoreWebView2().ok().and_then(|core| {
                let mut pid = 0u32;
                core.BrowserProcessId(&mut pid).ok().map(|_| pid)
            });
            let _ = tx.send(pid);
        })
        .ok()?;
    rx.recv_timeout(Duration::from_secs(5)).ok().flatten()
}

/// Samples the process tree with the repo's own memory script.
fn sample_memory(seconds: u32) -> Value {
    let scripts = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/extension-lab-memory.ps1");
    let log = std::env::temp_dir().join(format!("nebula-spike-memory-{}.log", std::process::id()));
    let status = std::process::Command::new("powershell")
        .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&scripts)
        .args(["-AppPid", &std::process::id().to_string(), "-Log"])
        .arg(&log)
        .args(["-IntervalSeconds", "2", "-MaxSeconds", &seconds.to_string()])
        .status();
    let text = std::fs::read_to_string(&log).unwrap_or_default();
    let last = text
        .lines()
        .rfind(|l| !l.starts_with('#') && l.contains('|'))
        .unwrap_or("")
        .to_string();
    let fields: Vec<&str> = last.split('|').map(str::trim).collect();
    json!({
        "scriptOk": status.map(|s| s.success()).unwrap_or(false),
        "processes": fields.get(2).and_then(|v| v.parse::<u32>().ok()),
        "treeMb": fields.get(3).and_then(|v| v.trim_end_matches(" MB").parse::<u32>().ok()),
        "line": last,
    })
}

fn drive(
    handle: tauri::AppHandle,
    layout: Layout,
    collector_base: String,
    port: u16,
    work: PathBuf,
) -> Result<Value, String> {
    // Install the evil extension through the browsing profile, BEFORE any page
    // loads, so its content script is injected.
    let mut install = Value::Null;
    if layout.evil {
        let target = evil_location(work.join("evil"), &collector_base, port);
        std::fs::write(target.root.join("installed-folder"), "evil").map_err(|e| e.to_string())?;
        let status = crate::extension_install::operate(
            handle.clone(),
            "host".into(),
            target.clone(),
            "install".into(),
            None,
        )?;
        install = json!({ "installed": status.installed, "enabled": status.enabled });
    }

    // One window, shell and tabs as children, like Nebula.
    let window = tauri::window::WindowBuilder::new(&handle, "app-window")
        .inner_size(1000.0, 600.0)
        .visible(true)
        .focused(false)
        .build()
        .map_err(|e| e.to_string())?;
    let mut created = serde_json::Map::new();
    let shell =
        tauri::webview::WebviewBuilder::new("shell", tauri::WebviewUrl::App("index.html".into()))
            .data_directory(layout.shell_dir.clone())
            .browser_extensions_enabled(layout.shell_extensions)
            .initialization_script(SHELL_INIT);
    created.insert(
        "shell".into(),
        json!(window
            .add_child(
                shell,
                tauri::LogicalPosition::new(0.0, 0.0),
                tauri::LogicalSize::new(400.0, 600.0)
            )
            .map(|_| "ok".to_string())
            .unwrap_or_else(|e| format!("error: {e}"))),
    );
    for index in 0..layout.tabs {
        let tab = tauri::webview::WebviewBuilder::new(
            format!("tab-{index}"),
            tauri::WebviewUrl::External(
                format!("{collector_base}/page?tab={index}")
                    .parse()
                    .unwrap(),
            ),
        )
        .data_directory(layout.browse_dir.clone())
        .browser_extensions_enabled(true);
        let result = window
            .add_child(
                tab,
                tauri::LogicalPosition::new(400.0, 0.0),
                tauri::LogicalSize::new(600.0, 600.0),
            )
            .map(|_| "ok".to_string())
            .unwrap_or_else(|e| format!("error: {e}"));
        created.insert(format!("tab-{index}"), json!(result));
    }
    if layout.private_tab {
        let tab = tauri::webview::WebviewBuilder::new(
            "private-tab",
            tauri::WebviewUrl::External(
                format!("{collector_base}/page?private=1").parse().unwrap(),
            ),
        )
        .data_directory(layout.browse_dir.clone())
        .browser_extensions_enabled(true)
        .incognito(true);
        let result = window
            .add_child(
                tab,
                tauri::LogicalPosition::new(400.0, 0.0),
                tauri::LogicalSize::new(600.0, 600.0),
            )
            .map(|_| "ok".to_string())
            .unwrap_or_else(|e| format!("error: {e}"));
        created.insert("private-tab".into(), json!(result));
    }
    if layout.mismatch {
        let tab = tauri::webview::WebviewBuilder::new(
            "mismatch",
            tauri::WebviewUrl::External(
                format!("{collector_base}/page?mismatch=1").parse().unwrap(),
            ),
        )
        .data_directory(layout.browse_dir.clone())
        .browser_extensions_enabled(false);
        let result = window
            .add_child(
                tab,
                tauri::LogicalPosition::new(400.0, 0.0),
                tauri::LogicalSize::new(600.0, 600.0),
            )
            .map(|_| "ok".to_string())
            .unwrap_or_else(|e| format!("error: {e}"));
        created.insert("mismatch".into(), json!(result));
    }

    // Let pages load and the extension probe twice (5 s and 13 s after install).
    std::thread::sleep(Duration::from_secs(16));

    let memory = sample_memory(8);
    let mut pids = serde_json::Map::new();
    for label in [
        "host",
        "shell",
        "tab-0",
        "private-tab",
        "mismatch",
        "catalog",
    ] {
        pids.insert(label.into(), json!(browser_pid(&handle, label)));
    }
    let sentinel =
        script(&handle, "shell", "window.__NEBULA_TRUSTED_SHELL__ ?? null").unwrap_or(Value::Null);
    let shell_probe = script(&handle, "shell", "window.__dnr_probe ?? null").unwrap_or(Value::Null);
    let tab_probe = script(&handle, "tab-0", "window.__dnr_probe ?? null").unwrap_or(Value::Null);
    // Positive control for the private tab: the page must have loaded and run its
    // own script, otherwise "the extension did not see it" proves nothing. A block
    // by the extension's rule shows as `blocked:`; a page without the extension as `status:`.
    let private_state = script(
        &handle,
        "private-tab",
        "JSON.stringify({ href: location.href, title: document.title, probe: window.__dnr_probe ?? null })",
    )
    .unwrap_or_else(|e| json!(format!("script error: {e}")));
    let mismatch_state = script(
        &handle,
        "mismatch",
        "JSON.stringify({ href: location.href, title: document.title, probe: window.__dnr_probe ?? null })",
    )
    .unwrap_or_else(|e| json!(format!("script error: {e}")));

    if layout.evil {
        let target = InstallationLocation {
            root: work.join("evil"),
            folder: work.join("evil"),
        };
        let _ = crate::extension_install::operate(
            handle.clone(),
            "host".into(),
            target,
            "remove".into(),
            None,
        );
    }
    Ok(json!({
        "install": install,
        "created": created,
        "browserProcessIds": pids,
        "sentinel": sentinel,
        "shellFetchProbe": shell_probe,
        "tabFetchProbe": tab_probe,
        "privateTabState": private_state,
        "mismatchTabState": mismatch_state,
        "memory": memory,
    }))
}

fn analyse(sentinel: &Value, reports: &[Value]) -> Value {
    let sentinel = sentinel.as_str().unwrap_or("<missing>").to_string();
    let contents: Vec<&Value> = reports
        .iter()
        .filter(|r| r["kind"] == "content")
        .map(|r| &r["data"])
        .collect();
    let probes: Vec<&Value> = reports
        .iter()
        .filter(|r| r["kind"] == "probe")
        .map(|r| &r["data"])
        .collect();
    let shell_url = |s: &Value| s.as_str().is_some_and(|u| u.contains("tauri.localhost"));
    let tab_url = |s: &Value| s.as_str().is_some_and(|u| u.contains("127.0.0.1"));
    let content_on_shell = contents.iter().any(|c| shell_url(&c["where"]));
    let content_reads_sentinel = contents
        .iter()
        .any(|c| c["shellAttr"].as_str() == Some(sentinel.as_str()));
    let content_on_tab = contents.iter().any(|c| tab_url(&c["where"]));
    let mut tabs_sees_shell = false;
    let mut tabs_sees_tab = false;
    let (mut exec_shell, mut exec_tab, mut dbg_shell, mut dbg_tab) = (false, false, false, false);
    let mut seen_tabs = Vec::new();
    for probe in &probes {
        for t in probe["tabs"].as_array().into_iter().flatten() {
            seen_tabs.push(t["url"].clone());
            tabs_sees_shell |= shell_url(&t["url"]);
            tabs_sees_tab |= tab_url(&t["url"]);
        }
        for e in probe["exec"].as_array().into_iter().flatten() {
            let ok = !e["r"].is_null();
            exec_shell |=
                ok && shell_url(&e["tab"]) && e["r"]["s"].as_str() == Some(sentinel.as_str());
            exec_tab |= ok && tab_url(&e["tab"]);
        }
        for d in probe["dbg"].as_array().into_iter().flatten() {
            let value = d["r"].as_str().unwrap_or("");
            dbg_shell |= shell_url(&d["tab"]) && value.contains(sentinel.as_str());
            dbg_tab |= tab_url(&d["tab"]) && value.contains("127.0.0.1");
        }
    }
    json!({
        "reportsReceived": reports.len(),
        "contentScriptRanOnShell": content_on_shell,
        "contentScriptReadShellDom": content_reads_sentinel,
        "contentScriptRanOnTab": content_on_tab,
        "tabsQuerySeesShell": tabs_sees_shell,
        "tabsQuerySeesTab": tabs_sees_tab,
        "executeScriptMainWorldReadsShell": exec_shell,
        "executeScriptMainWorldReadsTab": exec_tab,
        "debuggerReadsShell": dbg_shell,
        "debuggerReadsTab": dbg_tab,
        "tabsSeenByExtension": seen_tabs,
        "contentPages": contents.iter().map(|c| c["where"].clone()).collect::<Vec<_>>(),
        "firstProbe": probes.first().map(|p| (*p).clone()),
    })
}

fn run_scenario(name: &str, build: impl FnOnce(&Path) -> Layout) -> Value {
    let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            deadline.recv_timeout(Duration::from_secs(240)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            eprintln!("Spike scenario exceeded 240 seconds");
            std::process::exit(1);
        }
    });
    let directory = tempfile::tempdir().unwrap();
    let work = directory.path().to_path_buf();
    let layout = build(&work);
    let collector = Collector::start();
    let (base, port) = (collector.base.clone(), collector.port);
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    // A debug build points `WebviewUrl::App` at the dev server. The shell must be the
    // embedded app served at http://tauri.localhost, as in a release build.
    context.config_mut().build.dev_url = None;
    context.config_mut().identifier = format!("com.nebula.shell-spike-{name}");
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let host_dir = layout.browse_dir.clone();
    let catalog_dir = layout.catalog_dir.clone();
    let app = tauri::Builder::default()
        .any_thread()
        .setup(move |app| {
            // The browsing folder's own hidden host, as Nebula uses to manage extensions.
            tauri::WebviewWindowBuilder::new(
                app,
                "host",
                tauri::WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .data_directory(host_dir)
            .browser_extensions_enabled(true)
            .build()?;
            if let Some(dir) = catalog_dir {
                tauri::WebviewWindowBuilder::new(
                    app,
                    "catalog",
                    tauri::WebviewUrl::External("about:blank".parse().unwrap()),
                )
                .visible(false)
                .focused(false)
                .skip_taskbar(true)
                .data_directory(dir)
                .browser_extensions_enabled(true)
                .build()?;
            }
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = drive(handle.clone(), layout, base, port, work);
                let _ = tx.send(result);
                handle.exit(0);
            });
            Ok(())
        })
        .build(context)
        .unwrap();
    app.run_return(|_, _| {});
    let reports = collector.finish();
    let mut report = rx
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap_or_else(|e| json!({ "error": e }));
    report["analysis"] = analyse(&report["sentinel"], &reports);
    report["scenario"] = json!(name);
    let output =
        Path::new(env!("CARGO_MANIFEST_DIR")).join(format!("target/shell-isolation-{name}.json"));
    std::fs::write(&output, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    println!("report: {}", output.display());
    println!(
        "{}",
        serde_json::to_string_pretty(&report["analysis"]).unwrap()
    );
    report
}

/// CONTROL: shell and tabs share one folder with extensions on (today's layout).
/// The evil extension is expected to reach the shell.
#[test]
#[ignore = "Spike: starts WebView2 windows with temporary profiles; needs a Windows desktop session"]
fn native_shell_isolation_control_single_environment() {
    let report = run_scenario("control-single", |work| Layout {
        shell_dir: work.join("udf-one"),
        shell_extensions: true,
        browse_dir: work.join("udf-one"),
        tabs: 1,
        evil: true,
        catalog_dir: None,
        private_tab: false,
        mismatch: false,
    });
    println!("{}", report["analysis"]);
}

/// TARGET: shell in its own folder with extensions off; tabs and extensions in another.
#[test]
#[ignore = "Spike: starts WebView2 windows with temporary profiles; needs a Windows desktop session"]
fn native_shell_isolation_split_environments() {
    let report = run_scenario("split", |work| Layout {
        shell_dir: work.join("udf-shell"),
        shell_extensions: false,
        browse_dir: work.join("udf-browse"),
        tabs: 1,
        evil: true,
        catalog_dir: None,
        private_tab: true,
        mismatch: false,
    });
    println!("{}", report["analysis"]);
}

/// RAM, layout 1: one folder for everything (shell, 3 tabs).
#[test]
#[ignore = "Spike: starts WebView2 windows with temporary profiles; needs a Windows desktop session"]
fn native_shell_isolation_ram_single() {
    run_scenario("ram-single", |work| Layout {
        shell_dir: work.join("udf-one"),
        shell_extensions: true,
        browse_dir: work.join("udf-one"),
        tabs: 3,
        evil: false,
        catalog_dir: None,
        private_tab: false,
        mismatch: false,
    });
}

/// RAM, layout 2: shell and tabs in separate folders (the proposal).
#[test]
#[ignore = "Spike: starts WebView2 windows with temporary profiles; needs a Windows desktop session"]
fn native_shell_isolation_ram_split() {
    run_scenario("ram-split", |work| Layout {
        shell_dir: work.join("udf-shell"),
        shell_extensions: false,
        browse_dir: work.join("udf-browse"),
        tabs: 3,
        evil: false,
        catalog_dir: None,
        private_tab: false,
        mismatch: false,
    });
}

/// RAM, layout 3: today's shape, shell and tabs in one folder plus a catalog host
/// in a second folder.
#[test]
#[ignore = "Spike: starts WebView2 windows with temporary profiles; needs a Windows desktop session"]
fn native_shell_isolation_ram_today() {
    run_scenario("ram-today", |work| Layout {
        shell_dir: work.join("udf-one"),
        shell_extensions: true,
        browse_dir: work.join("udf-one"),
        tabs: 3,
        evil: false,
        catalog_dir: Some(work.join("udf-catalog")),
        private_tab: false,
        mismatch: false,
    });
}

/// What happens when a webview asks for extensions OFF in a folder that already runs
/// with extensions ON (the Google sign-in window under the proposed layout).
#[test]
#[ignore = "Spike: starts WebView2 windows with temporary profiles; needs a Windows desktop session"]
fn native_shell_isolation_environment_mismatch() {
    run_scenario("mismatch", |work| Layout {
        shell_dir: work.join("udf-shell"),
        shell_extensions: false,
        browse_dir: work.join("udf-browse"),
        tabs: 1,
        evil: true,
        catalog_dir: None,
        private_tab: true,
        mismatch: true,
    });
}
