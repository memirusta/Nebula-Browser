//! A generic audit of extension windows, so a sizing or framing bug is found by a
//! test and not by a user with one particular extension.
//!
//! It takes every extension in a folder, installs a COPY into a temporary profile,
//! opens every page the manifest declares (popup, options, side panel) exactly as
//! Nebula does, lets it settle and checks rules that must hold for ANY extension:
//!
//! - a popup is frameless;
//! - a page that fits its limits shows no scroll bar;
//! - nothing the page needs is cut off;
//! - a window that follows its content is not much larger than that content;
//! - the page rendered at all.
//!
//! Point `NEBULA_AUDIT_EXTENSIONS_DIR` at a folder of installed extensions, for
//! example the Extension Lab's `extensions` folder (`extension-lab.ps1 audit`).
use super::sender_semantics::folder_entries;
use crate::extension_install::InstallationLocation;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{Duration, Instant};
use tauri::Manager;

const PROBE: &str = r#"(() => {
  const h = document.documentElement;
  return {
    ready: document.readyState,
    hasBody: !!document.body && document.body.getBoundingClientRect().height > 0,
    innerWidth, innerHeight,
    clientWidth: h.clientWidth, clientHeight: h.clientHeight,
    scrollWidth: h.scrollWidth, scrollHeight: h.scrollHeight,
    textLength: (document.body && document.body.innerText || '').trim().length,
    elements: document.body ? document.body.querySelectorAll('*').length : 0,
    frames: document.querySelectorAll('iframe').length,
    scripts: document.querySelectorAll('script').length,
    bodyHeight: document.body ? Math.round(document.body.getBoundingClientRect().height) : 0,
    title: String(document.title).slice(0, 40),
  };
})()"#;

struct Page {
    kind: &'static str,
}

fn read_manifest(folder: &std::path::Path) -> Option<Value> {
    serde_json::from_slice(&std::fs::read(folder.join("manifest.json")).ok()?).ok()
}

/// Resolve `__MSG_x__` names so the report is readable.
fn display_name(folder: &std::path::Path, manifest: &Value) -> String {
    let raw = manifest["name"].as_str().unwrap_or("?");
    let Some(key) = raw
        .strip_prefix("__MSG_")
        .and_then(|k| k.strip_suffix("__"))
    else {
        return raw.to_string();
    };
    let locale = manifest["default_locale"].as_str().unwrap_or("en");
    std::fs::read(folder.join("_locales").join(locale).join("messages.json"))
        .ok()
        .and_then(|bytes| {
            serde_json::from_slice::<Value>(bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes))
                .ok()
        })
        .and_then(|messages| {
            messages
                .as_object()?
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case(key))
                .and_then(|(_, value)| value["message"].as_str().map(str::to_string))
        })
        .unwrap_or_else(|| raw.to_string())
}

fn declared_pages(manifest: &Value) -> Vec<&'static str> {
    let mut kinds = Vec::new();
    if manifest
        .pointer("/action/default_popup")
        .and_then(Value::as_str)
        .is_some_and(|p| !p.is_empty())
    {
        kinds.push("popup");
    }
    if manifest
        .pointer("/options_ui/page")
        .or_else(|| manifest.get("options_page"))
        .and_then(Value::as_str)
        .is_some()
    {
        kinds.push("options");
    }
    if manifest
        .pointer("/side_panel/default_path")
        .and_then(Value::as_str)
        .is_some()
    {
        kinds.push("side-panel");
    }
    kinds
}

fn probe(handle: &tauri::AppHandle, label: &str) -> Option<Value> {
    crate::extension_worker::cdp(
        handle,
        label,
        None,
        "Runtime.evaluate",
        &json!({ "expression": PROBE, "returnByValue": true }),
    )
    .ok()
    .map(|v| v["result"]["value"].clone())
    .filter(|v| v.is_object())
}

fn extents(handle: &tauri::AppHandle, label: &str) -> Option<(f64, f64)> {
    let value = crate::extension_worker::cdp(
        handle,
        label,
        None,
        "Runtime.evaluate",
        &json!({ "expression": crate::extension_popup_size::MEASURE_SCRIPT, "returnByValue": true }),
    )
    .ok()?;
    crate::extension_popup_size::parse_measurement(&value)
}

/// What a window that follows its content should satisfy, as readable violations.
/// `follows` is false for a window that keeps its own size (a panel, or an options
/// page declared for a tab); `min` is the smallest size its kind may have.
fn violations(
    kind: &str,
    decorated: bool,
    follows: bool,
    min: (f64, f64),
    window: (f64, f64),
    probe: &Value,
    extent: Option<(f64, f64)>,
) -> Vec<String> {
    let mut found = Vec::new();
    let number = |key: &str| probe[key].as_f64().unwrap_or(0.0);
    // Something must have been drawn: a box with height, text, or a frame.
    let drawn = number("bodyHeight") > 0.0 || number("textLength") > 0.0 || number("frames") > 0.0;
    // A page with no script that is empty is a placeholder the extension left empty
    // on purpose (Bitwarden ships `sidepanel-disabled.html`); one that has scripts
    // and still drew nothing is an app that failed to start.
    let placeholder = !drawn && number("scripts") == 0.0;
    if probe["ready"] != "complete" || (!drawn && !placeholder) {
        found.push(format!(
            "the page drew nothing (readyState {}, {} elements, {} characters of text, {} frames, title {})",
            probe["ready"], number("elements"), number("textLength"), number("frames"), probe["title"]
        ));
    }
    if kind == "popup" && decorated {
        found.push("a popup has a window frame".into());
    }
    if !follows {
        return found;
    }
    let max = if kind == "popup" {
        (800.0, 600.0)
    } else {
        (800.0, 680.0)
    };
    if !extent.is_some_and(|(w, h)| w <= max.0 && h <= max.1) {
        return found;
    }
    let cut_x = number("scrollWidth") - number("clientWidth");
    let cut_y = number("scrollHeight") - number("clientHeight");
    let bars_x = window.1 - number("clientHeight");
    let bars_y = window.0 - number("clientWidth");
    if bars_x > 1.5 || bars_y > 1.5 {
        found.push(format!(
            "scroll bars on a page that fits ({bars_y:.0}px vertical, {bars_x:.0}px horizontal)"
        ));
    }
    if cut_x > 1.5 || cut_y > 1.5 {
        found.push(format!(
            "content is cut off ({cut_x:.0}px sideways, {cut_y:.0}px down)"
        ));
    }
    if let Some((w, h)) = extent {
        // A page smaller than the kind's minimum sits in a window of that minimum.
        let (w, h) = (w.max(min.0), h.max(min.1));
        // A fluid page fills its window, so only a window clearly larger than what
        // the page draws counts as empty space (the default sizes are fluid).
        let default = window == (420.0, 560.0) || window == (520.0, 600.0);
        if (window.0 - w > 8.0 || window.1 - h > 8.0) && !default {
            found.push(format!(
                "window {window:?} is larger than the page it shows ({w:.0}x{h:.0})"
            ));
        }
    }
    found
}

fn audit(handle: tauri::AppHandle, directory: PathBuf, work: PathBuf) -> Result<Value, String> {
    let mut report = Vec::new();
    let mut folders: Vec<PathBuf> = std::fs::read_dir(&directory)
        .map_err(|e| e.to_string())?
        .filter_map(|entry| entry.ok().map(|e| e.path()))
        .filter(|path| path.is_dir())
        .collect();
    folders.sort();
    for (index, extension_dir) in folders.iter().enumerate() {
        let Some(version) = std::fs::read_dir(extension_dir)
            .ok()
            .and_then(|mut entries| {
                entries.find_map(|e| {
                    e.ok()
                        .map(|e| e.path())
                        .filter(|p| p.join("manifest.json").is_file())
                })
            })
        else {
            continue;
        };
        let Some(manifest) = read_manifest(&version) else {
            continue;
        };
        let name = display_name(&version, &manifest);
        if let Ok(only) = std::env::var("NEBULA_AUDIT_ONLY") {
            if !name.to_lowercase().contains(&only.to_lowercase()) {
                continue;
            }
        }
        let kinds = declared_pages(&manifest);
        if kinds.is_empty() {
            report.push(json!({ "extension": name, "pages": [], "note": "declares no popup, options or side panel" }));
            continue;
        }
        let root = work.join(format!("ext{index}"));
        let folder = crate::extension_install::prepare_discovery_directory(
            &root,
            "1.0.0",
            folder_entries(&version),
        )?;
        let target = InstallationLocation { root, folder };
        std::fs::write(target.root.join("installed-folder"), "audit-folder")
            .map_err(|e| e.to_string())?;
        if let Err(error) = crate::extension_install::operate(
            handle.clone(),
            "extension-test".into(),
            target.clone(),
            "install".into(),
            None,
        ) {
            report.push(json!({ "extension": name, "error": format!("install failed: {error}") }));
            continue;
        }
        let mut pages = Vec::new();
        for kind in kinds {
            let page = Page { kind };
            let label = format!("extension-ui-audit{index}-{}", page.kind);
            let opened = crate::extension_host::open_controls_page(
                &handle,
                ("browser-window", "extension-test"),
                &label,
                &target,
                &crate::extension_host::page_path(&manifest, page.kind)?,
                false,
            );
            if let Err(error) = opened {
                pages.push(json!({ "kind": page.kind, "violations": [format!("could not open: {error}")] }));
                continue;
            }
            // Wait until the page has rendered and the window has stopped moving.
            let deadline = Instant::now() + Duration::from_secs(14);
            let mut last = (0.0, 0.0);
            let mut steady = 0;
            let mut probed = None;
            while Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(500));
                let Some(window) = handle.get_webview_window(&label) else {
                    break;
                };
                let scale = window.scale_factor().unwrap_or(1.0);
                let Ok(size) = window.inner_size() else {
                    continue;
                };
                let size = (size.width as f64 / scale, size.height as f64 / scale);
                probed = probe(&handle, &label);
                steady = if (size.0 - last.0).abs() < 1.0 && (size.1 - last.1).abs() < 1.0 {
                    steady + 1
                } else {
                    0
                };
                last = size;
                if steady >= 3 && probed.as_ref().is_some_and(|p| p["ready"] == "complete") {
                    break;
                }
            }
            let decorated = handle
                .get_webview_window(&label)
                .and_then(|w| w.is_decorated().ok())
                .unwrap_or(true);
            // Popups and embedded options follow their content; a side panel and an
            // options page declared for a tab keep their own size.
            let follows = page.kind == "popup"
                || (page.kind == "options"
                    && !crate::extension_window_profile::hints(&manifest).options_in_tab);
            let min = if page.kind == "popup" {
                (25.0, 25.0)
            } else {
                (320.0, 240.0)
            };
            let mut found = match &probed {
                Some(probe) => violations(
                    page.kind,
                    decorated,
                    follows,
                    min,
                    last,
                    probe,
                    extents(&handle, &label),
                ),
                None => vec!["the page could not be inspected".to_string()],
            };
            // A page that is still loading can look wrong for a moment. Only a problem
            // that is still there after a pause counts.
            if !found.is_empty() {
                std::thread::sleep(Duration::from_secs(4));
                if let Some(window) = handle.get_webview_window(&label) {
                    let scale = window.scale_factor().unwrap_or(1.0);
                    if let Ok(size) = window.inner_size() {
                        last = (size.width as f64 / scale, size.height as f64 / scale);
                    }
                }
                probed = probe(&handle, &label);
                found = match &probed {
                    Some(probe) => violations(
                        page.kind,
                        decorated,
                        follows,
                        min,
                        last,
                        probe,
                        extents(&handle, &label),
                    ),
                    None => vec!["the page could not be inspected".to_string()],
                };
            }
            pages.push(json!({
                "kind": page.kind, "window": [last.0, last.1], "decorated": decorated,
                "probe": probed, "violations": found,
            }));
            crate::extension_host::close_controls(&handle, &format!("audit{index}"))?;
        }
        let _ = crate::extension_install::operate(
            handle.clone(),
            "extension-test".into(),
            target,
            "remove".into(),
            None,
        );
        report.push(json!({ "extension": name, "pages": pages }));
    }
    Ok(json!(report))
}

#[test]
#[ignore = "Diagnostic: needs NEBULA_AUDIT_EXTENSIONS_DIR and a Windows desktop session"]
fn native_extension_pages_audit() {
    let directory = PathBuf::from(
        std::env::var("NEBULA_AUDIT_EXTENSIONS_DIR").expect("NEBULA_AUDIT_EXTENSIONS_DIR"),
    );
    let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
    std::thread::spawn(move || {
        if matches!(
            deadline.recv_timeout(Duration::from_secs(1500)),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout)
        ) {
            eprintln!("Extension pages audit exceeded 25 minutes");
            std::process::exit(1);
        }
    });
    let work = tempfile::tempdir().unwrap();
    let profile = work.path().join("profile");
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().identifier = "com.nebula.extension-audit".into();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    let work_path = work.path().to_path_buf();
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
            // A Nebula-shaped browser window to own the extension windows.
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
                let result = audit(handle.clone(), directory, work_path);
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
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/extension-pages-audit.json");
    std::fs::write(&output, serde_json::to_string_pretty(&report).unwrap()).unwrap();
    let mut failures = 0;
    println!(
        "\n{:<36} {:<11} {:<14} result",
        "extension", "page", "window"
    );
    for entry in report.as_array().unwrap() {
        let name = entry["extension"].as_str().unwrap_or("?");
        if let Some(error) = entry["error"].as_str() {
            println!("{name:<36} {:<11} {:<14} {error}", "-", "-");
            failures += 1;
            continue;
        }
        for page in entry["pages"].as_array().cloned().unwrap_or_default() {
            let found = page["violations"].as_array().cloned().unwrap_or_default();
            failures += found.len();
            let window = page["window"]
                .as_array()
                .map(|w| {
                    format!(
                        "{:.0}x{:.0}",
                        w[0].as_f64().unwrap_or(0.0),
                        w[1].as_f64().unwrap_or(0.0)
                    )
                })
                .unwrap_or_default();
            let result = if found.is_empty() {
                "ok".to_string()
            } else {
                found
                    .iter()
                    .filter_map(|v| v.as_str())
                    .collect::<Vec<_>>()
                    .join("; ")
            };
            println!(
                "{:<36} {:<11} {:<14} {result}",
                name.chars().take(34).collect::<String>(),
                page["kind"].as_str().unwrap_or("?"),
                window
            );
        }
    }
    println!("report: {}\nviolations: {failures}", output.display());
    assert_eq!(
        failures, 0,
        "extension windows break rules that must hold for any extension; see the table"
    );
}
