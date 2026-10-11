use crate::restore_visibility_state::RestoreVisibilityState;
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use tauri::Manager;
use windows::Win32::UI::WindowsAndMessaging::IsIconic;

static STATES: LazyLock<Mutex<HashMap<String, RestoreVisibilityState>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn set_target(app: &tauri::AppHandle, window_label: &str, target: Option<&str>) {
    if let Ok(mut states) = STATES.lock() {
        states
            .entry(window_label.to_string())
            .or_default()
            .set_target(target);
    }
    if let Some(window) = app.get_window(window_label) {
        sync(&window);
    }
}

fn sync(window: &tauri::Window) {
    let _crumb = crate::ui_watchdog::enter("restore_visibility.sync");
    let Ok(hwnd) = window.hwnd() else { return };
    let minimized = unsafe { IsIconic(hwnd).as_bool() };
    let action = STATES.lock().ok().and_then(|states| {
        states
            .get(window.label())
            .and_then(|state| state.action(minimized))
    });
    let Some((label, visible)) = action else {
        return;
    };
    let Some(webview) = window.app_handle().get_webview(&label) else {
        return;
    };
    // A transferred or replaced tab must never be shown by its old window.
    if webview.window().label() != window.label() {
        return;
    }
    let result = if visible {
        webview.show()
    } else {
        webview.hide()
    };
    if result.is_ok() {
        if let Ok(mut states) = STATES.lock() {
            if let Some(state) = states.get_mut(window.label()) {
                state.applied(&label, visible);
            }
        }
    }
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    match event {
        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_) => sync(window),
        tauri::WindowEvent::Destroyed => {
            if let Ok(mut states) = STATES.lock() {
                states.remove(window.label());
            }
        }
        _ => {}
    }
}
