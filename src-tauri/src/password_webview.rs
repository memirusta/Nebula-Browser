#[cfg(target_os = "windows")]
mod imp {
    use std::sync::{LazyLock, Mutex};

    use tauri::AppHandle;
    use tauri::Manager;
    use webview2_com::ExecuteScriptCompletedHandler;
    use windows::core::PCWSTR;
    use windows_core::HSTRING;

    static SCRIPT_MUTEX: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    pub fn execute_script(app: &AppHandle, label: &str, script: &str) -> Result<String, String> {
        if !label.starts_with("nebula-tab-") {
            return Ok(String::new());
        }

        let _guard = SCRIPT_MUTEX
            .lock()
            .map_err(|error| error.to_string())?;

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;

        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let script = script.to_string();

        webview
            .with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };

                let handler = ExecuteScriptCompletedHandler::create(Box::new(
                    move |result: Result<(), windows_core::Error>, value: String| {
                        let out = if result.is_ok() { value } else { String::new() };
                        let _ = tx.send(out);
                        Ok(())
                    },
                ));

                let script_h = HSTRING::from(script);
                if core
                    .ExecuteScript(PCWSTR(script_h.as_ptr()), &handler)
                    .is_ok()
                {
                    std::mem::forget(handler);
                }
            })
            .map_err(|error| error.to_string())?;

        // Wait outside with_webview so WebView2 can dispatch the script callback.
        Ok(rx
            .recv_timeout(std::time::Duration::from_secs(6))
            .unwrap_or_default())
    }
}

#[cfg(target_os = "windows")]
pub use imp::execute_script;

#[cfg(not(target_os = "windows"))]
pub fn execute_script(
    _app: &tauri::AppHandle,
    _label: &str,
    _script: &str,
) -> Result<String, String> {
    Ok(String::new())
}
