use std::sync::{LazyLock, Mutex};

use tauri::Manager;

const WINDOW_PREFIX: &str = "nebula-window-";
const TAB_PREFIX: &str = "nebula-tab-";
static MOST_RECENT_WINDOW: LazyLock<Mutex<String>> =
    LazyLock::new(|| Mutex::new("main".to_string()));

fn valid_workspace_label(label: &str) -> bool {
    label.starts_with(WINDOW_PREFIX)
        && label.len() <= 120
        && label.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '/' | ':')
        })
}

fn workspace_url(
    app: &tauri::AppHandle,
    window_id: &str,
    transfer_id: Option<&str>,
) -> Result<tauri::WebviewUrl, String> {
    let mut query = format!("nebulaWindowId={window_id}");
    if let Some(transfer_id) = transfer_id {
        query.push_str("&nebulaTransferId=");
        query.push_str(transfer_id);
    }

    if cfg!(debug_assertions) {
        let mut url = app
            .config()
            .build
            .dev_url
            .clone()
            .ok_or_else(|| "Nebula dev URL is unavailable".to_string())?;
        url.set_query(Some(&query));
        return Ok(tauri::WebviewUrl::External(url));
    }

    Ok(tauri::WebviewUrl::App(format!("index.html?{query}").into()))
}

pub fn create_window(
    app: &tauri::AppHandle,
    window_id: String,
    transfer_id: Option<String>,
) -> Result<String, String> {
    if !valid_workspace_label(&window_id) {
        return Err("invalid Nebula workspace window label".to_string());
    }

    if let Some(existing) = app.get_webview_window(&window_id) {
        existing.show().map_err(|error| error.to_string())?;
        existing.set_focus().map_err(|error| error.to_string())?;
        return Ok(window_id);
    }

    let transfer_id = transfer_id.filter(|value| !value.is_empty());
    if let Some(transfer_id) = transfer_id.as_deref() {
        if transfer_id.len() > 120
            || !transfer_id.chars().all(|character| {
                character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
            })
        {
            return Err("invalid Nebula tab transfer id".to_string());
        }
    }

    let url = workspace_url(app, &window_id, transfer_id.as_deref())?;

    let window = tauri::WebviewWindowBuilder::new(app, window_id.clone(), url)
        .title("Nebula")
        .inner_size(1280.0, 800.0)
        .prevent_overflow()
        .decorations(false)
        .transparent(true)
        .resizable(true)
        .focused(true)
        .visible(true)
        .drag_and_drop(false)
        .disable_drag_drop_handler()
        .browser_extensions_enabled(true)
        .build()
        .map_err(|error| error.to_string())?;

    crate::webview_branding::setup_webview_branding(app, &window_id)?;
    crate::tab_error_page::setup_tab_error_page(app, &window_id)?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(window_id)
}

pub fn reparent_tab(
    app: &tauri::AppHandle,
    tab_label: String,
    target_window_label: String,
) -> Result<String, String> {
    if !tab_label.starts_with(TAB_PREFIX) || tab_label.len() > 240 {
        return Err("invalid Nebula tab label".to_string());
    }
    if target_window_label != "main" && !valid_workspace_label(&target_window_label) {
        return Err("invalid Nebula target window label".to_string());
    }

    let tab = app
        .get_webview(&tab_label)
        .ok_or_else(|| format!("webview '{tab_label}' not found"))?;
    let target = app
        .get_window(&target_window_label)
        .ok_or_else(|| format!("window '{target_window_label}' not found"))?;

    tab.hide().map_err(|error| error.to_string())?;
    tab.reparent(&target).map_err(|error| error.to_string())?;
    let parent_window_label = tab.window().label().to_string();
    if parent_window_label != target_window_label {
        return Err(format!(
            "webview '{tab_label}' has parent '{parent_window_label}', expected '{target_window_label}'"
        ));
    }
    tab.set_auto_resize(false)
        .map_err(|error| error.to_string())?;
    Ok(parent_window_label)
}

pub fn mark_window_active(window_label: String) -> Result<(), String> {
    if window_label != "main" && !valid_workspace_label(&window_label) {
        return Err("invalid Nebula workspace window label".to_string());
    }
    *MOST_RECENT_WINDOW
        .lock()
        .map_err(|error| error.to_string())? = window_label;
    Ok(())
}

pub fn most_recent_window_label() -> String {
    MOST_RECENT_WINDOW
        .lock()
        .map(|label| label.clone())
        .unwrap_or_else(|_| "main".to_string())
}

#[cfg(test)]
mod tests {
    use super::valid_workspace_label;

    #[test]
    fn workspace_window_labels_are_narrowly_scoped() {
        assert!(valid_workspace_label("nebula-window-1234-abcd"));
        assert!(!valid_workspace_label("main"));
        assert!(!valid_workspace_label("nebula-window-bad label"));
        assert!(!valid_workspace_label("other-window"));
    }
}
