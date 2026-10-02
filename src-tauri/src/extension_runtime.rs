#[cfg(target_os = "windows")]
pub(crate) fn read_version(app: tauri::AppHandle, label: &str) -> Result<String, String> {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_2;
    use windows_core::{Interface, PWSTR};
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.get_webview(label)
        .ok_or("Browser window unavailable")?
        .with_webview(move |inner| unsafe {
            let result = (|| -> Result<String, String> {
                let environment = inner
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_2>())
                    .and_then(|core| core.Environment())
                    .map_err(|e| e.to_string())?;
                let mut value = PWSTR::null();
                let result = environment.BrowserVersionString(&mut value);
                let version = value.to_string().unwrap_or_default();
                if !value.is_null() {
                    windows::Win32::System::Com::CoTaskMemFree(Some(value.as_ptr().cast()));
                }
                result.map_err(|e| e.to_string())?;
                let version = version.split_whitespace().next().unwrap_or("");
                if version.is_empty() || !version.bytes().all(|c| c.is_ascii_digit() || c == b'.') {
                    return Err("Runtime version unavailable".into());
                }
                Ok(version.to_string())
            })();
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "Runtime version query timed out".to_string())?
}

#[tauri::command]
pub async fn extension_runtime_version(
    app: tauri::AppHandle,
    webview: tauri::Webview,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let label = webview.label().to_string();
        tauri::async_runtime::spawn_blocking(move || read_version(app, &label))
            .await
            .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, webview);
        Err("Browser extensions require Windows".into())
    }
}
