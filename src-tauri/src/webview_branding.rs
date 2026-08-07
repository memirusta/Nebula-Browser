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
        ICoreWebView2Settings2, ICoreWebView2Settings3, ICoreWebView2Settings4,
    };
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows_core::Interface;

    use super::is_nebula_webview_label;

    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));

    fn neutralize_user_agent(user_agent: &str) -> String {
        user_agent
            .split_whitespace()
            .filter(|token| {
                !token.starts_with("Edg/")
                    && !token.starts_with("Edge/")
                    && !token.starts_with("EdgA/")
                    && !token.starts_with("EdgiOS/")
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

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

        if let Ok(settings2) = settings.cast::<ICoreWebView2Settings2>() {
            let mut raw_user_agent = PWSTR::null();
            if settings2.UserAgent(&mut raw_user_agent).is_ok() {
                let current = raw_user_agent.to_string().unwrap_or_default();
                if !raw_user_agent.is_null() {
                    CoTaskMemFree(Some(raw_user_agent.as_ptr().cast()));
                }
                let neutral = neutralize_user_agent(&current);
                if !neutral.is_empty() && neutral != current {
                    let wide: Vec<u16> = neutral.encode_utf16().chain(Some(0)).collect();
                    let _ = settings2.SetUserAgent(PCWSTR(wide.as_ptr()));
                }
            }
        }

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

    #[cfg(test)]
    mod tests {
        use super::neutralize_user_agent;

        #[test]
        fn removes_edge_brand_tokens_without_changing_chromium_tokens() {
            let input =
                "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
            assert_eq!(
                neutralize_user_agent(input),
                "Mozilla/5.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36"
            );
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
