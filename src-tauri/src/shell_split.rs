//! SPIKE: keep Nebula's trusted shell in its own WebView2 environment.
//!
//! With `NEBULA_SPIKE_SPLIT=1` every shell webview (main window, `nebula-chrome*`,
//! `nebula-window-*`, the Google sign-in window) uses an absolute data folder of its
//! own with browser extensions OFF. Tabs and popup content are created from JS with no
//! data folder, which Tauri resolves to the app's default folder: the browsing
//! environment, extensions ON. Without the variable nothing here runs and the app is
//! exactly what it was.
//!
//! Tauri resolves a `dataDirectory` given from JS or the config to
//! `%LOCALAPPDATA%\<webview label>\<path>`, so the shell's several webviews could not
//! share one folder that way. Only the Rust builder takes an absolute path.
use std::path::PathBuf;
use tauri::Manager;

pub fn enabled() -> bool {
    std::env::var("NEBULA_SPIKE_SPLIT").is_ok_and(|value| value == "1")
}

pub fn trusted_dir<M: Manager<tauri::Wry>>(manager: &M) -> Result<PathBuf, String> {
    let dir = manager
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join("trusted");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// Creates the windows the config would have created, in the trusted environment.
pub fn create_config_windows(
    app: &tauri::App,
    windows: &[tauri::utils::config::WindowConfig],
) -> Result<(), Box<dyn std::error::Error>> {
    for config in windows {
        tauri::WebviewWindowBuilder::from_config(app, config)?
            .data_directory(trusted_dir(app)?)
            .browser_extensions_enabled(false)
            .build()?;
    }
    Ok(())
}

#[tauri::command]
pub fn shell_split_enabled() -> bool {
    enabled()
}

/// The shell's overlay webview. A JS `new Webview` cannot reach the trusted folder,
/// so in split mode it is built here. Only Nebula's own pages, only chrome labels.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn shell_chrome_webview_create(
    app: tauri::AppHandle,
    window_label: String,
    label: String,
    url: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<(), String> {
    if !enabled() {
        return Err("The trusted shell environment is not enabled".into());
    }
    if label != "nebula-chrome" && !label.starts_with("nebula-chrome-") {
        return Err("Only Nebula chrome webviews can be created here".into());
    }
    let parsed: tauri::Url = url
        .parse()
        .map_err(|_| "Invalid chrome address".to_string())?;
    if !matches!(parsed.host_str(), Some("tauri.localhost" | "localhost")) {
        return Err("The chrome webview must be a Nebula page".into());
    }
    let window = app
        .get_window(&window_label)
        .ok_or_else(|| format!("window '{window_label}' not found"))?;
    let builder = tauri::webview::WebviewBuilder::new(label, tauri::WebviewUrl::External(parsed))
        .transparent(true)
        .focused(false)
        .data_directory(trusted_dir(&app)?)
        .browser_extensions_enabled(false);
    window
        .add_child(
            builder,
            tauri::PhysicalPosition::new(x, y),
            tauri::PhysicalSize::new(width, height),
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}
