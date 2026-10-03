//! What the browser window's webviews really look like, read from Windows.
//!
//! The browsing layout (tab, Semi-Lunar overlay, shell) is positioned by commands the
//! shell sends after events (resize, focus, restore). Windows does not always send the
//! event the repair waits for: a window brought to the front can change geometry without
//! a resize, and focus can return to a child window so the top-level one never reports
//! `Focused`. The shell therefore also asks, now and then, where each webview host
//! actually is, compares it with what it expects, and repairs a difference that persists.
//! This is the read half: rectangles in the window's client coordinates, as Windows has
//! them, not as a cache believes them to be.
use serde::Serialize;
#[cfg(target_os = "windows")]
use tauri::Manager;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, POINT, RECT};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::ClientToScreen;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetWindowRect, IsIconic, IsWindowVisible,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostRect {
    label: String,
    /// Client coordinates of the browser window.
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    visible: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutAudit {
    client_width: i32,
    client_height: i32,
    minimized: bool,
    hosts: Vec<HostRect>,
}

#[cfg(target_os = "windows")]
fn audit_blocking(app: &tauri::AppHandle, window_label: &str) -> Result<LayoutAudit, String> {
    let _crumb = crate::ui_watchdog::enter("cmd.webview_layout_audit");
    let window = app
        .get_window(window_label)
        .ok_or_else(|| format!("window '{window_label}' not found"))?;
    let hwnd = window.hwnd().map_err(|error| error.to_string())?;
    let (minimized, client, origin) = unsafe {
        let minimized = IsIconic(hwnd).as_bool();
        let mut client = RECT::default();
        GetClientRect(hwnd, &mut client).map_err(|error| error.to_string())?;
        let mut origin = POINT::default();
        ClientToScreen(hwnd, &mut origin)
            .ok()
            .map_err(|error| error.to_string())?;
        (minimized, client, origin)
    };
    let mut hosts = Vec::new();
    // Hidden or parked webviews are listed too (visible = false): the shell decides what matters.
    for (label, webview) in app.webviews() {
        if webview.window().label() != window_label {
            continue;
        }
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let queued = webview.with_webview(move |inner| unsafe {
            let mut host = HWND::default();
            let result = inner
                .controller()
                .ParentWindow(&mut host)
                .map_err(|error| error.to_string())
                .and_then(|()| {
                    let mut rect = RECT::default();
                    GetWindowRect(host, &mut rect).map_err(|error| error.to_string())?;
                    Ok((rect, IsWindowVisible(host).as_bool()))
                });
            let _ = tx.send(result);
        });
        if queued.is_err() {
            continue;
        }
        let Ok(Ok((rect, visible))) = rx.recv_timeout(std::time::Duration::from_secs(2)) else {
            continue;
        };
        hosts.push(HostRect {
            label,
            x: rect.left - origin.x,
            y: rect.top - origin.y,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            visible,
        });
    }
    hosts.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(LayoutAudit {
        client_width: client.right - client.left,
        client_height: client.bottom - client.top,
        minimized,
        hosts,
    })
}

/// Rectangles of every webview host of the window, in client coordinates.
#[tauri::command]
pub async fn webview_layout_audit(
    app: tauri::AppHandle,
    window_label: String,
) -> Result<LayoutAudit, String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || audit_blocking(&app, &window_label))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, window_label);
        Err("The layout audit reads Windows webview hosts".to_string())
    }
}
