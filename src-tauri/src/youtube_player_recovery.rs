//! Gets a YouTube video going when its player is stuck on 0:00 / 0:00.
//!
//! The page script (`site_scripts/youtube_player_recovery.js`) does the work inside the page: when a
//! watch page has loaded no video a few seconds after it opened, it reloads the page once. This module
//! only installs that script, at document start, in a browser tab's WebView. It touches no other site.

/// The script, as shipped. A constant: nothing the page or the user says is put into it.
pub(crate) const SCRIPT: &str = include_str!("site_scripts/youtube_player_recovery.js");

#[cfg(target_os = "windows")]
mod imp {
    use std::collections::HashSet;
    use std::sync::{Arc, LazyLock, Mutex};

    use tauri::{AppHandle, Manager};
    use webview2_com::AddScriptToExecuteOnDocumentCreatedCompletedHandler;
    use windows::core::PCWSTR;
    use windows_core::HSTRING;

    static CONFIGURED: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));

    /// Installs the script in the tab's WebView (once per tab). Runs where the other tab setup
    /// helpers run: `with_webview` completes inline.
    pub fn setup(app: &AppHandle, label: &str) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") {
            return Err("the YouTube recovery is limited to browser tabs".to_string());
        }
        if CONFIGURED
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            return Ok(());
        }
        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let failure = Arc::new(Mutex::new(None::<String>));
        let slot = failure.clone();
        webview
            .with_webview(move |inner| unsafe {
                let result = (|| -> windows_core::Result<()> {
                    let core = inner.controller().CoreWebView2()?;
                    let script = HSTRING::from(super::SCRIPT);
                    let handler = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(
                        Box::new(|_result, _id| Ok(())),
                    );
                    core.AddScriptToExecuteOnDocumentCreated(PCWSTR(script.as_ptr()), &handler)?;
                    Ok(())
                })();
                if let Err(error) = result {
                    if let Ok(mut slot) = slot.lock() {
                        *slot = Some(error.to_string());
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        if let Some(error) = failure.lock().map_err(|error| error.to_string())?.take() {
            return Err(error);
        }
        CONFIGURED
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string());
        Ok(())
    }

    pub fn teardown(label: &str) {
        if let Ok(mut configured) = CONFIGURED.lock() {
            configured.remove(label);
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{setup, teardown};

#[cfg(not(target_os = "windows"))]
pub fn setup(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown(_label: &str) {}

#[cfg(test)]
mod tests {
    use super::SCRIPT;

    #[test]
    fn the_script_is_limited_to_youtube_watch_pages_and_reloads_at_most_once() {
        assert!(SCRIPT.contains("location.hostname !== 'www.youtube.com'"));
        assert!(SCRIPT.contains("location.pathname === '/watch'"));
        assert!(SCRIPT.contains("window.top !== window"));
        assert!(SCRIPT.contains("reloadedRecently"));
        // Constant text: no placeholders that something could be put into.
        assert!(!SCRIPT.contains("${") && !SCRIPT.contains('`'));
    }
}
