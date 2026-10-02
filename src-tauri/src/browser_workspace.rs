use std::sync::{LazyLock, Mutex};

use tauri::Manager;

const WINDOW_PREFIX: &str = "nebula-window-";
const TAB_PREFIX: &str = "nebula-tab-";
static MOST_RECENT_WINDOW: LazyLock<Mutex<String>> =
    LazyLock::new(|| Mutex::new("main".to_string()));

fn valid_workspace_label(label: &str) -> bool {
    label.starts_with(WINDOW_PREFIX)
        && label.len() <= 120
        && label.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '/' | ':')
        })
}

fn workspace_url(
    app: &tauri::AppHandle,
    window_id: &str,
    transfer_id: Option<&str>,
) -> Result<tauri::WebviewUrl, String> {
    let mut query = format!("nebulaWindowId={window_id}");
    if let Some(transfer_id) = transfer_id {
        query.push_str("&nebulaTransferId=");
        query.push_str(transfer_id);
    }

    if cfg!(debug_assertions) {
        let mut url = app
            .config()
            .build
            .dev_url
            .clone()
            .ok_or_else(|| "Nebula dev URL is unavailable".to_string())?;
        url.set_query(Some(&query));
        return Ok(tauri::WebviewUrl::External(url));
    }

    Ok(tauri::WebviewUrl::App(format!("index.html?{query}").into()))
}

pub fn create_window(
    app: &tauri::AppHandle,
    window_id: String,
    transfer_id: Option<String>,
) -> Result<String, String> {
    if !valid_workspace_label(&window_id) {
        return Err("invalid Nebula workspace window label".to_string());
    }

    if let Some(existing) = app.get_webview_window(&window_id) {
        existing.show().map_err(|error| error.to_string())?;
        existing.set_focus().map_err(|error| error.to_string())?;
        return Ok(window_id);
    }

    let transfer_id = transfer_id.filter(|value| !value.is_empty());
    if let Some(transfer_id) = transfer_id.as_deref() {
        if transfer_id.len() > 120
            || !transfer_id.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
        {
            return Err("invalid Nebula tab transfer id".to_string());
        }
    }

    let url = workspace_url(app, &window_id, transfer_id.as_deref())?;

    let window = tauri::WebviewWindowBuilder::new(app, window_id.clone(), url)
        .title("Nebula")
        .inner_size(1280.0, 800.0)
        .prevent_overflow()
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .focused(true)
        .visible(true)
        .drag_and_drop(false)
        .disable_drag_drop_handler()
        .browser_extensions_enabled(true)
        .build()
        .map_err(|error| error.to_string())?;

    // The WebviewWindow is already successfully built at this point. On Windows,
    // `with_webview` setup callbacks for a freshly-created WebView2 can complete
    // just after these helpers return. Some helpers therefore report a transient
    // "failed to configure webview" even though their queued callback is still
    // running and the window itself is healthy. Treat shell integration setup as
    // best-effort here so a false-negative setup result cannot turn a successful
    // window creation into a rejected tab transfer.
    if let Err(_error) = crate::webview_branding::setup_webview_branding(app, &window_id) {
        #[cfg(debug_assertions)]
        eprintln!("[nebula workspace] branding setup for {window_id}: {_error}");
    }
    if let Err(_error) = crate::tab_error_page::setup_tab_error_page(app, &window_id) {
        #[cfg(debug_assertions)]
        eprintln!("[nebula workspace] error-page setup for {window_id}: {_error}");
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(window_id)
}

pub fn reparent_tab(
    app: &tauri::AppHandle,
    tab_label: String,
    target_window_label: String,
) -> Result<String, String> {
    if !tab_label.starts_with(TAB_PREFIX) || tab_label.len() > 240 {
        return Err("invalid Nebula tab label".to_string());
    }
    if target_window_label != "main" && !valid_workspace_label(&target_window_label) {
        return Err("invalid Nebula target window label".to_string());
    }

    let tab = app
        .get_webview(&tab_label)
        .ok_or_else(|| format!("webview '{tab_label}' not found"))?;
    let target = app
        .get_window(&target_window_label)
        .ok_or_else(|| format!("window '{target_window_label}' not found"))?;

    tab.hide().map_err(|error| error.to_string())?;
    tab.reparent(&target).map_err(|error| error.to_string())?;
    let parent_window_label = tab.window().label().to_string();
    if parent_window_label != target_window_label {
        return Err(format!(
            "webview '{tab_label}' has parent '{parent_window_label}', expected '{target_window_label}'"
        ));
    }

    // Reparenting a child HWND preserves its old screen-space origin on
    // Windows. When the source window is on the right, that origin becomes a
    // positive client offset in the new parent and exposes the Home surface on
    // the left until the target BrowserShell finishes its asynchronous layout.
    // Establish the full target-client postcondition atomically while the tab
    // is still hidden so no shifted compositor frame can be presented.
    tab.set_auto_resize(false)
        .map_err(|error| error.to_string())?;
    let target_size = target.inner_size().map_err(|error| error.to_string())?;
    tab.set_bounds(tauri::Rect {
        position: tauri::PhysicalPosition::new(0, 0).into(),
        size: target_size.into(),
    })
    .map_err(|error| error.to_string())?;
    Ok(parent_window_label)
}

pub fn mark_window_active(window_label: String) -> Result<(), String> {
    if window_label != "main" && !valid_workspace_label(&window_label) {
        return Err("invalid Nebula workspace window label".to_string());
    }
    *MOST_RECENT_WINDOW
        .lock()
        .map_err(|error| error.to_string())? = window_label;
    Ok(())
}

pub fn most_recent_window_label<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> String {
    let remembered = MOST_RECENT_WINDOW
        .lock()
        .map(|label| label.clone())
        .unwrap_or_else(|_| "main".to_string());
    if app.get_window(&remembered).is_some() {
        return remembered;
    }
    if app.get_window("main").is_some() {
        return "main".to_string();
    }
    app.windows()
        .into_keys()
        .find(|label| valid_workspace_label(label))
        .unwrap_or_else(|| "main".to_string())
}

/// Result of resolving the window under the OS cursor for a tab drop.
///
/// `Outside` is a positive measurement: the hit window belongs to another
/// process and no visible Nebula window contains the cursor. Anything that
/// cannot be proven either way is `Unknown`, and callers must not create a
/// window for it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WindowAtCursor {
    Window { label: String },
    Outside,
    Unknown,
}

/// Classify a cursor that matched no Nebula window. `hit_root_pid` is the
/// process that owns the root of the window under the cursor, or `None` when
/// the hit-test returned no window at all.
fn classify_unmatched_cursor(hit_root_pid: Option<u32>, own_pid: u32) -> WindowAtCursor {
    match hit_root_pid {
        Some(pid) if pid != 0 && pid != own_pid => WindowAtCursor::Outside,
        _ => WindowAtCursor::Unknown,
    }
}

#[cfg(not(target_os = "windows"))]
pub fn window_at_cursor(_app: &tauri::AppHandle) -> Result<WindowAtCursor, String> {
    Ok(WindowAtCursor::Unknown)
}

#[cfg(target_os = "windows")]
pub fn window_at_cursor(app: &tauri::AppHandle) -> Result<WindowAtCursor, String> {
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetClassNameW, GetCursorPos, GetTopWindow, GetWindow, GetWindowRect,
        GetWindowThreadProcessId, IsWindowVisible, WindowFromPoint, GA_ROOT, GW_HWNDNEXT, GW_OWNER,
    };

    fn class_name(hwnd: HWND) -> String {
        if hwnd.0.is_null() {
            return String::new();
        }
        let mut buffer = [0u16; 128];
        let length = unsafe { GetClassNameW(hwnd, &mut buffer) };
        String::from_utf16_lossy(&buffer[..length.max(0) as usize])
    }

    fn process_id(hwnd: HWND) -> u32 {
        if hwnd.0.is_null() {
            return 0;
        }
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        pid
    }

    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point).map_err(|error| error.to_string())? };

    let mut owned: Vec<(String, HWND)> = Vec::new();
    // `webview_windows()` omits any window that hosts a child WebView with a
    // different label, which is every Nebula window (Chrome + tab WebViews).
    for (label, window) in app.windows() {
        if label != "main" && !valid_workspace_label(&label) {
            continue;
        }
        owned.push((label, window.hwnd().map_err(|error| error.to_string())?));
    }

    let hovered = unsafe { WindowFromPoint(point) };
    let root = if hovered.0.is_null() {
        hovered
    } else {
        unsafe { GetAncestor(hovered, GA_ROOT) }
    };
    if !root.0.is_null() {
        // The hit window's root, then its owner chain, may be a Nebula window.
        let mut candidate = root;
        for _ in 0..8 {
            if let Some((label, _)) = owned.iter().find(|(_, hwnd)| *hwnd == candidate) {
                return Ok(WindowAtCursor::Window {
                    label: label.clone(),
                });
            }
            match unsafe { GetWindow(candidate, GW_OWNER) } {
                Ok(owner) if !owner.0.is_null() => candidate = owner,
                _ => break,
            }
        }
    }

    // `WindowFromPoint` can miss a transparent, pointer-captured window. Walk
    // the real top-level z-order and take the first visible Nebula window whose
    // rectangle contains the cursor.
    let mut walked = unsafe { GetTopWindow(None) }.ok();
    let mut steps = 0;
    while let Some(current) = walked {
        steps += 1;
        if steps > 1024 || current.0.is_null() {
            break;
        }
        if let Some((label, _)) = owned.iter().find(|(_, hwnd)| *hwnd == current) {
            if unsafe { IsWindowVisible(current) }.as_bool() {
                let mut rect = RECT::default();
                if unsafe { GetWindowRect(current, &mut rect) }.is_ok()
                    && point.x >= rect.left
                    && point.x < rect.right
                    && point.y >= rect.top
                    && point.y < rect.bottom
                {
                    return Ok(WindowAtCursor::Window {
                        label: label.clone(),
                    });
                }
            }
        }
        walked = unsafe { GetWindow(current, GW_HWNDNEXT) }.ok();
    }

    // No Nebula window matched. The cursor is only proven to be outside when
    // the hit window belongs to another process; a hit on one of our own
    // windows (or no hit at all) stays unknown so callers do not guess.
    let own_pid = std::process::id();
    let hit_root_pid = if root.0.is_null() {
        None
    } else {
        Some(process_id(root))
    };
    let outcome = classify_unmatched_cursor(hit_root_pid, own_pid);
    if outcome == WindowAtCursor::Outside {
        return Ok(outcome);
    }

    // Keep the evidence for the unresolved case.
    let _ = crate::write_transition_log(
        app.clone(),
        serde_json::json!({
            "stage": "workspace.window-at-cursor.unmatched",
            "status": "error",
            "outcome": "unknown",
            "cursor": { "x": point.x, "y": point.y },
            "hovered": hovered.0 as isize,
            "hoveredClass": class_name(hovered),
            "hoveredPid": process_id(hovered),
            "root": root.0 as isize,
            "rootClass": class_name(root),
            "rootPid": process_id(root),
            "processId": own_pid,
            "windows": owned
                .iter()
                .map(|(label, hwnd)| serde_json::json!({
                    "label": label,
                    "hwnd": hwnd.0 as isize,
                    "visible": unsafe { IsWindowVisible(*hwnd) }.as_bool(),
                }))
                .collect::<Vec<_>>(),
        }),
    );
    Ok(WindowAtCursor::Unknown)
}

#[cfg(test)]
mod tests {
    use super::{classify_unmatched_cursor, valid_workspace_label, WindowAtCursor};

    #[test]
    fn unmatched_cursor_is_outside_only_for_a_foreign_process() {
        assert_eq!(
            classify_unmatched_cursor(Some(4321), 100),
            WindowAtCursor::Outside
        );
        // A hit on one of our own windows that we could not label is unknown.
        assert_eq!(
            classify_unmatched_cursor(Some(100), 100),
            WindowAtCursor::Unknown
        );
        // No hit, or an unreadable owner, is never proof of "outside".
        assert_eq!(
            classify_unmatched_cursor(None, 100),
            WindowAtCursor::Unknown
        );
        assert_eq!(
            classify_unmatched_cursor(Some(0), 100),
            WindowAtCursor::Unknown
        );
    }

    #[test]
    fn window_at_cursor_serializes_as_a_tagged_union() {
        assert_eq!(
            serde_json::to_string(&WindowAtCursor::Window {
                label: "main".to_string()
            })
            .unwrap(),
            r#"{"kind":"window","label":"main"}"#
        );
        assert_eq!(
            serde_json::to_string(&WindowAtCursor::Outside).unwrap(),
            r#"{"kind":"outside"}"#
        );
        assert_eq!(
            serde_json::to_string(&WindowAtCursor::Unknown).unwrap(),
            r#"{"kind":"unknown"}"#
        );
    }

    #[test]
    fn workspace_window_labels_are_narrowly_scoped() {
        assert!(valid_workspace_label("nebula-window-1234-abcd"));
        assert!(!valid_workspace_label("main"));
        assert!(!valid_workspace_label("nebula-window-bad label"));
        assert!(!valid_workspace_label("other-window"));
    }
}
