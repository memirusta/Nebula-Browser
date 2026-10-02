//! The process lives as long as the browser windows the user can see.
//!
//! Extension hosts are hidden windows (`extension-catalog-host`, extension pages and
//! their sign-in windows). Tauri exits only when every window is gone, so one hidden
//! host kept the process alive after the last browser window closed. The next launch
//! then handed off to that process through the single-instance plugin and nothing
//! appeared: a process with no window.
use tauri::Manager;

/// Labels of windows that only serve the browser and never show a page on their own.
const BACKGROUND_PREFIX: &str = "extension-";

fn is_background_window(label: &str) -> bool {
    label.starts_with(BACKGROUND_PREFIX)
}

/// True when nothing the user could look at is left.
fn only_background_windows<'a>(labels: impl IntoIterator<Item = &'a str>) -> bool {
    labels.into_iter().all(is_background_window)
}

/// Ends the process when the last browser window has closed.
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if !matches!(event, tauri::WindowEvent::Destroyed) || is_background_window(window.label()) {
        return;
    }
    let app = window.app_handle().clone();
    let closed = window.label().to_string();
    // Off the event loop: destroying windows from inside a window event can stall it.
    std::thread::spawn(move || {
        let remaining = app.windows();
        let labels = remaining
            .keys()
            .map(String::as_str)
            .filter(|label| *label != closed);
        if !only_background_windows(labels) {
            return;
        }
        for (label, window) in &remaining {
            if *label != closed {
                let _ = window.destroy();
            }
        }
        app.exit(0);
    });
}

/// A second launch must always end with a Nebula window in front, even when the
/// running process has none (it used to do nothing without a link to open).
pub fn on_second_instance(app: &tauri::AppHandle) {
    let label = crate::browser_workspace::most_recent_window_label(app);
    if let Some(window) = app.get_window(&label) {
        crate::external_open::activate_main_window(&window);
        return;
    }
    let app = app.clone();
    // Creating a window needs the event loop, which is the thread calling us.
    std::thread::spawn(move || {
        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis())
            .unwrap_or_default();
        if let Err(_error) =
            crate::browser_workspace::create_window(&app, format!("nebula-window-{millis}"), None)
        {
            #[cfg(debug_assertions)]
            eprintln!("[nebula lifecycle] could not open a window for a second launch: {_error}");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{is_background_window, only_background_windows};

    #[test]
    fn extension_windows_are_background_and_browser_windows_are_not() {
        for label in [
            "extension-catalog-host",
            "extension-ui-abc-1",
            "extension-auth-extension-ui-abc-1-2",
            "extension-trial-site-3",
        ] {
            assert!(is_background_window(label), "{label}");
        }
        for label in ["main", "nebula-window-12", "nebula-chrome", "nebula-tab-1"] {
            assert!(!is_background_window(label), "{label}");
        }
    }

    #[test]
    fn the_process_ends_only_when_no_browser_window_is_left() {
        assert!(only_background_windows([]));
        assert!(only_background_windows(["extension-catalog-host"]));
        assert!(only_background_windows([
            "extension-catalog-host",
            "extension-ui-abc-1"
        ]));
        assert!(!only_background_windows(["main"]));
        assert!(!only_background_windows([
            "extension-catalog-host",
            "nebula-window-7"
        ]));
    }
}
