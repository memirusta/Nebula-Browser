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
use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Controller3;
#[cfg(target_os = "windows")]
use windows::core::Interface;
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::{HWND, POINT, RECT};
#[cfg(target_os = "windows")]
use windows::Win32::Graphics::Gdi::ClientToScreen;
#[cfg(target_os = "windows")]
use windows::Win32::UI::HiDpi::GetDpiForWindow;
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
    /// The controller's rasterization scale (0 when it cannot be read).
    raster_scale: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutAudit {
    client_width: i32,
    client_height: i32,
    minimized: bool,
    /// The browser window's DPI as Windows has it (96 = 100%); 0 when it cannot be read.
    window_dpi: u32,
    hosts: Vec<HostRect>,
}

/// The rasterization scale a webview of a window at `dpi` must have.
#[cfg(target_os = "windows")]
fn expected_scale(dpi: u32) -> f64 {
    f64::from(dpi) / 96.0
}

#[cfg(target_os = "windows")]
fn window_dpi(hwnd: HWND) -> u32 {
    unsafe { GetDpiForWindow(hwnd) }
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
            let controller = inner.controller();
            let mut raster_scale = 0.0;
            if let Ok(controller3) = controller.cast::<ICoreWebView2Controller3>() {
                let _ = controller3.RasterizationScale(&mut raster_scale);
            }
            let result = controller
                .ParentWindow(&mut host)
                .map_err(|error| error.to_string())
                .and_then(|()| {
                    let mut rect = RECT::default();
                    GetWindowRect(host, &mut rect).map_err(|error| error.to_string())?;
                    Ok((rect, IsWindowVisible(host).as_bool(), raster_scale))
                });
            let _ = tx.send(result);
        });
        if queued.is_err() {
            continue;
        }
        let Ok(Ok((rect, visible, raster_scale))) =
            rx.recv_timeout(std::time::Duration::from_secs(2))
        else {
            continue;
        };
        hosts.push(HostRect {
            label,
            x: rect.left - origin.x,
            y: rect.top - origin.y,
            width: rect.right - rect.left,
            height: rect.bottom - rect.top,
            visible,
            raster_scale,
        });
    }
    hosts.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(LayoutAudit {
        client_width: client.right - client.left,
        client_height: client.bottom - client.top,
        minimized,
        window_dpi: window_dpi(hwnd),
        hosts,
    })
}

/// Bring every webview of the window back to the scale of the monitor it is on.
///
/// After the display setup changes (a screen switched off, a lid closed, the window moved to a
/// monitor with another scale) a webview can keep the scale of the monitor it was on, and then
/// draws its page at the wrong size inside a host that is the right size. Setting the scale
/// explicitly and then handing it back to WebView2's own detection makes it look again.
#[cfg(target_os = "windows")]
fn resync_scale_blocking(app: &tauri::AppHandle, window_label: &str) -> Result<usize, String> {
    let _crumb = crate::ui_watchdog::enter("cmd.webview_resync_scale");
    let window = app
        .get_window(window_label)
        .ok_or_else(|| format!("window '{window_label}' not found"))?;
    let dpi = window_dpi(window.hwnd().map_err(|error| error.to_string())?);
    if dpi == 0 {
        return Err("the window's DPI cannot be read".to_string());
    }
    let scale = expected_scale(dpi);
    let mut changed = 0;
    for (_label, webview) in app.webviews() {
        if webview.window().label() != window_label {
            continue;
        }
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let queued = webview.with_webview(move |inner| unsafe {
            let result = (|| -> Result<bool, String> {
                let controller3 = inner
                    .controller()
                    .cast::<ICoreWebView2Controller3>()
                    .map_err(|error| error.to_string())?;
                let mut current = 0.0;
                controller3
                    .RasterizationScale(&mut current)
                    .map_err(|error| error.to_string())?;
                let differs = (current - scale).abs() > 0.01;
                if differs {
                    controller3
                        .SetRasterizationScale(scale)
                        .map_err(|error| error.to_string())?;
                    controller3
                        .SetShouldDetectMonitorScaleChanges(true)
                        .map_err(|error| error.to_string())?;
                }
                Ok(differs)
            })();
            let _ = tx.send(result);
        });
        if queued.is_err() {
            continue;
        }
        if let Ok(Ok(true)) = rx.recv_timeout(std::time::Duration::from_secs(2)) {
            changed += 1;
        }
    }
    Ok(changed)
}

/// Make the webviews of the window use the scale of its monitor again; returns how many had another.
#[tauri::command]
pub async fn webview_resync_scale(
    app: tauri::AppHandle,
    window_label: String,
) -> Result<usize, String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || resync_scale_blocking(&app, &window_label))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, window_label);
        Err("Scale resync is for Windows webviews".to_string())
    }
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
