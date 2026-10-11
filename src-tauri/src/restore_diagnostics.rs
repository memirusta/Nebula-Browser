//! Geometry-only diagnostics for the separate restore test build.
use tauri::Manager;
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetForegroundWindow, GetWindowPlacement, GetWindowRect, IsIconic,
    IsWindowVisible, WINDOWPLACEMENT,
};

fn rect_value(rect: RECT) -> serde_json::Value {
    serde_json::json!({
        "x": rect.left, "y": rect.top,
        "width": rect.right - rect.left, "height": rect.bottom - rect.top,
    })
}

fn snapshot(hwnd: HWND) -> serde_json::Value {
    unsafe {
        let mut outer = RECT::default();
        let mut client = RECT::default();
        let mut placement = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        let outer_ok = GetWindowRect(hwnd, &mut outer).is_ok();
        let client_ok = GetClientRect(hwnd, &mut client).is_ok();
        let placement_ok = GetWindowPlacement(hwnd, &mut placement).is_ok();
        serde_json::json!({
            "outer": outer_ok.then(|| rect_value(outer)),
            "client": client_ok.then(|| rect_value(client)),
            "visible": IsWindowVisible(hwnd).as_bool(),
            "minimized": IsIconic(hwnd).as_bool(),
            "foreground": GetForegroundWindow() == hwnd,
            "showCommand": placement_ok.then_some(placement.showCmd),
        })
    }
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    let app = window.app_handle();
    if app.config().identifier != "com.nebula.browser.perf" {
        return;
    }
    let event_name = match event {
        tauri::WindowEvent::Focused(true) => "focus-gained",
        tauri::WindowEvent::Focused(false) => "focus-lost",
        tauri::WindowEvent::Resized(_) => "resized",
        _ => return,
    };
    let Ok(hwnd) = window.hwnd() else { return };
    let _ = crate::write_transition_log(
        app.clone(),
        serde_json::json!({
            "stage": "restore.native-window-event", "status": "info",
            "event": event_name, "windowLabel": window.label(), "geometry": snapshot(hwnd),
        }),
    );
    for (label, webview) in app.webviews() {
        if webview.window().label() != window.label() {
            continue;
        }
        let app = app.clone();
        // No synchronous wait from a window callback: record when the runtime
        // executes this WebView callback. No URLs or page content are logged.
        let _ = webview.with_webview(move |inner| unsafe {
            let controller = inner.controller();
            let mut host = HWND::default();
            let mut bounds = RECT::default();
            let mut visible = windows::core::BOOL::default();
            let host_ok = controller.ParentWindow(&mut host).is_ok();
            let bounds_ok = controller.Bounds(&mut bounds).is_ok();
            let visible_ok = controller.IsVisible(&mut visible).is_ok();
            let _ = crate::write_transition_log(
                app,
                serde_json::json!({
                    "stage": "restore.native-webview-event", "status": "info",
                    "event": event_name, "label": label,
                    "host": host_ok.then(|| snapshot(host)),
                    "controllerBounds": bounds_ok.then(|| rect_value(bounds)),
                    "controllerVisible": visible_ok.then(|| visible.as_bool()),
                }),
            );
        });
    }
}
