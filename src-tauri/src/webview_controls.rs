use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
fn with_webview_result<F, R>(app: &AppHandle, label: &str, f: F) -> Result<R, String>
where
    F: FnOnce(tauri::webview::PlatformWebview) -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    use std::sync::mpsc::sync_channel;

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;

    let (tx, rx) = sync_channel(1);

    webview
        .with_webview(move |inner| {
            let _ = tx.send(f(inner));
        })
        .map_err(|error| error.to_string())?;

    rx.recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|_| format!("timed out in webview control '{label}'"))?
}

#[tauri::command]
pub fn webview_reload(app: AppHandle, label: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        with_webview_result(&app, &label, |inner| unsafe {
            let core = inner.controller().CoreWebView2().map_err(|error| error.to_string())?;
            core.Reload().map_err(|error| error.to_string())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(())
    }
}

#[tauri::command]
pub fn webview_go_forward(app: AppHandle, label: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        with_webview_result(&app, &label, |inner| unsafe {
            let core = inner.controller().CoreWebView2().map_err(|error| error.to_string())?;
            let mut can_go_forward = windows_core::BOOL::default();
            core.CanGoForward(std::ptr::addr_of_mut!(can_go_forward))
                .map_err(|error| error.to_string())?;
            if can_go_forward.as_bool() {
                core.GoForward().map_err(|error| error.to_string())?;
                Ok(true)
            } else {
                Ok(false)
            }
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(false)
    }
}

#[tauri::command]
pub fn webview_zoom(app: AppHandle, label: String, action: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let zoom_action = action.clone();
        with_webview_result(&app, &label, move |inner| unsafe {
            let controller = inner.controller();
            let mut factor = 0.0f64;
            controller
                .ZoomFactor(&mut factor)
                .map_err(|error| error.to_string())?;
            factor = match zoom_action.as_str() {
                "in" => (factor + 0.1).min(5.0),
                "out" => (factor - 0.1).max(0.25),
                "reset" => 1.0,
                _ => return Err(format!("unknown zoom action '{zoom_action}'")),
            };
            controller.SetZoomFactor(factor).map_err(|error| error.to_string())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, action);
        Ok(())
    }
}

#[tauri::command]
pub fn webview_open_devtools(app: AppHandle, label: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        with_webview_result(&app, &label, |inner| unsafe {
            let core = inner.controller().CoreWebView2().map_err(|error| error.to_string())?;
            core.OpenDevToolsWindow().map_err(|error| error.to_string())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(())
    }
}
