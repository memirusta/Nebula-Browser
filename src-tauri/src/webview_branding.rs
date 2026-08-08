pub fn is_nebula_webview_label(label: &str) -> bool {
    label == "main" || label == "nebula-chrome" || label.starts_with("nebula-tab-")
}

#[cfg(target_os = "windows")]
mod imp {
    use std::collections::HashSet;
    use std::sync::{LazyLock, Mutex};
    use std::time::Duration;

    use tauri::{AppHandle, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Settings3, ICoreWebView2Settings4,
    };
    use windows_core::Interface;

    use super::is_nebula_webview_label;

    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));

    unsafe fn apply_settings(inner: tauri::webview::PlatformWebview) -> Result<(), String> {
        let core = inner
            .controller()
            .CoreWebView2()
            .map_err(|error| error.to_string())?;
        let settings = core.Settings().map_err(|error| error.to_string())?;

        settings
            .SetIsBuiltInErrorPageEnabled(false)
            .map_err(|error| error.to_string())?;
        settings
            .SetAreDefaultContextMenusEnabled(false)
            .map_err(|error| error.to_string())?;
        settings
            .SetIsStatusBarEnabled(false)
            .map_err(|error| error.to_string())?;
        settings
            .SetIsZoomControlEnabled(false)
            .map_err(|error| error.to_string())?;
        settings
            .SetAreHostObjectsAllowed(false)
            .map_err(|error| error.to_string())?;
        settings
            .SetAreDevToolsEnabled(cfg!(debug_assertions))
            .map_err(|error| error.to_string())?;

        // Keep WebView2's native User-Agent untouched. It must stay consistent
        // with UA Client Hints and JavaScript-visible browser characteristics;
        // anti-bot challenges reject a partially rewritten browser identity.

        if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
        }

        if let Ok(settings4) = settings.cast::<ICoreWebView2Settings4>() {
            let _ = settings4.SetIsPasswordAutosaveEnabled(false);
            let _ = settings4.SetIsGeneralAutofillEnabled(false);
        }

        Ok(())
    }

    pub fn setup_webview_branding(app: &AppHandle, label: &str) -> Result<(), String> {
        if !is_nebula_webview_label(label) {
            return Err(format!("webview branding is not allowed for '{label}'"));
        }
        if CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            return Ok(());
        }

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let (tx, rx) = std::sync::mpsc::sync_channel(1);

        webview
            .with_webview(move |inner| {
                let _ = tx.send(unsafe { apply_settings(inner) });
            })
            .map_err(|error| error.to_string())?;

        rx.recv_timeout(Duration::from_secs(2))
            .map_err(|_| format!("timed out configuring webview '{label}'"))??;
        CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string());
        Ok(())
    }

    pub fn teardown_webview_branding(label: &str) {
        if let Ok(mut configured) = CONFIGURED_LABELS.lock() {
            configured.remove(label);
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{setup_webview_branding, teardown_webview_branding};

#[cfg(not(target_os = "windows"))]
pub fn setup_webview_branding(_app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    if is_nebula_webview_label(label) {
        Ok(())
    } else {
        Err(format!("webview branding is not allowed for '{label}'"))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_webview_branding(_label: &str) {}
