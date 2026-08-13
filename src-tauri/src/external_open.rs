use serde::Serialize;
use std::sync::Mutex;
use tauri::{Emitter, Manager};

static PENDING_EXTERNAL_URLS: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenTabAction<'a> {
    #[serde(rename = "type")]
    action_type: &'static str,
    shortcut_id: &'static str,
    url: &'a str,
}

fn is_supported_external_url(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };

    matches!(url.scheme(), "http" | "https") && url.host_str().is_some()
}

fn extract_external_urls<I, S>(args: I) -> Vec<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .filter_map(|value| {
            let value = value.as_ref().trim();

            if is_supported_external_url(value) {
                Some(value.to_owned())
            } else {
                None
            }
        })
        .collect()
}

/// Capture HTTP/HTTPS arguments from the first process.
///
/// The frontend is not ready yet at this point, so the URLs remain queued until
/// the main WebView drains them after React has mounted.
pub fn capture_startup_args() {
    let urls = extract_external_urls(std::env::args());

    if urls.is_empty() {
        return;
    }

    if let Ok(mut pending) = PENDING_EXTERNAL_URLS.lock() {
        pending.extend(urls);
    }
}

/// Called by tauri-plugin-single-instance when Windows attempts to start a
/// second Nebula process.
///
/// The main BrowserShell already consumes `nebula-chrome-action/open-tab`, so
/// external URLs deliberately use that existing navigation pipeline.
pub fn handle_second_instance<R: tauri::Runtime>(app: &tauri::AppHandle<R>, args: &[String]) {
    let urls = extract_external_urls(args);

    if urls.is_empty() {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    for url in urls {
        let _ = app.emit(
            "nebula-chrome-action",
            OpenTabAction {
                action_type: "open-tab",
                shortcut_id: "",
                url: &url,
            },
        );
    }
}

#[tauri::command]
pub fn take_pending_open_urls() -> Result<Vec<String>, String> {
    let mut pending = PENDING_EXTERNAL_URLS
        .lock()
        .map_err(|_| "external URL queue is unavailable".to_string())?;

    Ok(std::mem::take(&mut *pending))
}

#[cfg(test)]
mod tests {
    use super::{extract_external_urls, is_supported_external_url};

    #[test]
    fn accepts_only_http_and_https_urls() {
        assert!(is_supported_external_url("https://example.com/path?q=1"));
        assert!(is_supported_external_url("http://127.0.0.1:8080/callback"));

        assert!(!is_supported_external_url("file:///C:/test.html"));
        assert!(!is_supported_external_url("javascript:alert(1)"));
        assert!(!is_supported_external_url("--some-flag"));
        assert!(!is_supported_external_url("not-a-url"));
    }

    #[test]
    fn extracts_urls_without_treating_executable_as_navigation() {
        let args = vec![
            r"C:\Program Files\Nebula\app.exe".to_string(),
            "https://example.com/one".to_string(),
            "--flag".to_string(),
            "http://example.org/two".to_string(),
        ];

        assert_eq!(
            extract_external_urls(args),
            vec![
                "https://example.com/one".to_string(),
                "http://example.org/two".to_string(),
            ],
        );
    }
}
