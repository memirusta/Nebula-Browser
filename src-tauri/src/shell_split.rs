//! Builds the shell's webviews natively when the shell does not live where the config
//! would put it: in the trusted user data folder with extensions OFF (`Mode::Split`), or
//! with a hydration seed (any run that hydrates, see `shell_isolation`).
//!
//! Tauri resolves a `dataDirectory` given from JS or the config to
//! `%LOCALAPPDATA%\<webview label>\<path>`, so the shell's several webviews could not
//! share one folder that way. Only the Rust builder takes an absolute path. Tabs and popup
//! content are created from JS with no data folder, which Tauri resolves to the app's
//! default folder: the browsing environment, extensions ON.
use crate::shell_isolation;
use tauri::Manager;

/// Whether the config windows must be created here instead of by Tauri's own startup.
pub fn takes_over_config_windows() -> bool {
    shell_isolation::split_active() || shell_isolation::hydrating()
}

/// Creates the windows the config would have created.
pub fn create_config_windows(
    app: &tauri::App,
    windows: &[tauri::utils::config::WindowConfig],
) -> Result<(), Box<dyn std::error::Error>> {
    for config in windows {
        let mut builder = tauri::WebviewWindowBuilder::from_config(app, config)?;
        if shell_isolation::split_active() {
            builder = builder
                .data_directory(shell_isolation::trusted_dir(app)?)
                .browser_extensions_enabled(false);
        }
        if let Some(script) = shell_isolation::hydration_script() {
            builder = builder.initialization_script(script);
        }
        builder.build()?;
    }
    Ok(())
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
    if !shell_isolation::split_active() {
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
    let mut builder =
        tauri::webview::WebviewBuilder::new(label, tauri::WebviewUrl::External(parsed))
            .transparent(true)
            .focused(false)
            .data_directory(shell_isolation::trusted_dir(&app)?)
            .browser_extensions_enabled(false);
    if let Some(script) = shell_isolation::hydration_script() {
        builder = builder.initialization_script(script);
    }
    window
        .add_child(
            builder,
            tauri::PhysicalPosition::new(x, y),
            tauri::PhysicalSize::new(width, height),
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}
