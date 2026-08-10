use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
fn with_webview_result<F, R>(app: &AppHandle, label: &str, f: F) -> Result<R, String>
where
    F: FnOnce(tauri::webview::PlatformWebview) -> Result<R, String> + Send + 'static,
    R: Send + 'static,
{
    use std::sync::mpsc::sync_channel;

    if !label.starts_with("nebula-tab-") {
        return Err("webview control is limited to browser tabs".to_string());
    }

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
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
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
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
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
            controller
                .SetZoomFactor(factor)
                .map_err(|error| error.to_string())
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
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
            core.OpenDevToolsWindow().map_err(|error| error.to_string())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(())
    }
}

#[tauri::command]
pub fn webview_set_memory_usage(app: AppHandle, label: String, low: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;

        with_webview_result(&app, &label, move |inner| unsafe {
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
            let memory: ICoreWebView2_19 = core.cast().map_err(|error| error.to_string())?;
            memory
                .SetMemoryUsageTargetLevel(if low {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                })
                .map_err(|error| error.to_string())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, low);
        Ok(())
    }
}

#[tauri::command]
pub fn webview_is_playing_audio(app: AppHandle, label: String) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
        use windows_core::{Interface, BOOL};

        with_webview_result(&app, &label, |inner| unsafe {
            let core = inner
                .controller()
                .CoreWebView2()
                .map_err(|error| error.to_string())?;
            let media: ICoreWebView2_8 = core.cast().map_err(|error| error.to_string())?;
            let mut playing = BOOL::default();
            media
                .IsDocumentPlayingAudio(std::ptr::addr_of_mut!(playing))
                .map_err(|error| error.to_string())?;
            Ok(playing.as_bool())
        })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(false)
    }
}

#[tauri::command]
pub fn webview_set_suspended(
    app: AppHandle,
    label: String,
    suspended: bool,
) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use std::sync::mpsc::sync_channel;
        use std::time::Duration;

        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
        use webview2_com::TrySuspendCompletedHandler;
        use windows_core::{Interface, BOOL};

        if !label.starts_with("nebula-tab-") {
            return Err("webview suspension is limited to browser tabs".to_string());
        }

        if !suspended {
            return with_webview_result(&app, &label, |inner| unsafe {
                let core = inner
                    .controller()
                    .CoreWebView2()
                    .map_err(|error| error.to_string())?;
                let lifecycle: ICoreWebView2_3 = core.cast().map_err(|error| error.to_string())?;
                let mut is_suspended = BOOL::default();
                lifecycle
                    .IsSuspended(&mut is_suspended)
                    .map_err(|error| error.to_string())?;
                if !is_suspended.as_bool() {
                    return Ok(false);
                }
                lifecycle.Resume().map_err(|error| error.to_string())?;
                Ok(true)
            });
        }

        let webview = app
            .get_webview(&label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let (tx, rx) = sync_channel(1);
        let label_for_error = label.clone();

        webview
            .with_webview(move |inner| unsafe {
                let failure_tx = tx.clone();
                let handler = TrySuspendCompletedHandler::create(Box::new(
                    move |result, is_successful| {
                        let outcome = result
                            .map(|_| is_successful)
                            .map_err(|error| error.to_string());
                        let _ = tx.send(outcome);
                        Ok(())
                    },
                ));

                let result = (|| -> windows_core::Result<()> {
                    let core = inner.controller().CoreWebView2()?;
                    let lifecycle: ICoreWebView2_3 = core.cast()?;
                    let mut is_suspended = BOOL::default();
                    lifecycle.IsSuspended(&mut is_suspended)?;
                    if is_suspended.as_bool() {
                        let _ = failure_tx.send(Ok(true));
                        return Ok(());
                    }
                    lifecycle.TrySuspend(&handler)
                })();

                if let Err(error) = result {
                    let _ = failure_tx.send(Err(error.to_string()));
                }
            })
            .map_err(|error| error.to_string())?;

        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| format!("timed out suspending webview '{label_for_error}'"))?
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, suspended);
        Ok(false)
    }
}
