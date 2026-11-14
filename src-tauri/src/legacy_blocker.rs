//! Takes away the content blocker that earlier versions of Nebula installed in the browser profile (a bundled uBlock Origin Lite).
//!
//! Nebula now blocks with its own shield (`shield.rs`), so the extension is no longer wanted: left in the profile it would keep
//! blocking next to the shield, and nothing would say so. Only the copy that Nebula itself installed is removed: it is told apart
//! by the identity that was written down when it was installed (`current.json`), so an extension the person installed
//! themselves, even another build of the same one, is not touched.
//!
//! This runs at every start but costs nothing once there is nothing to remove: without the marker file it only looks for the
//! folder the extension was copied to.
use std::path::PathBuf;

use serde::Deserialize;
use tauri::{AppHandle, Manager};

/// The folder earlier versions copied the extension to (and wrote their marker in), under the app's local data.
const LEGACY_FOLDER: [&str; 2] = ["extensions", "ubol"];

#[derive(Deserialize)]
struct Marker {
    extension_id: String,
}

fn legacy_root(app: &AppHandle) -> Option<PathBuf> {
    let mut path = app.path().app_local_data_dir().ok()?;
    for part in LEGACY_FOLDER {
        path.push(part);
    }
    Some(path)
}

/// The identity of the extension Nebula installed, if it did. Not checked against a version: whichever build it was, it is ours.
fn installed_id(root: &std::path::Path) -> Option<String> {
    let bytes = std::fs::read(root.join("current.json")).ok()?;
    let marker: Marker = serde_json::from_slice(&bytes).ok()?;
    (!marker.extension_id.is_empty()).then_some(marker.extension_id)
}

/// Removes the extension from the browser profile (when Nebula installed one) and then the folder it was copied to. Returns whether
/// there was anything to remove. If the removal from the profile fails nothing is deleted, so the next start tries again.
#[cfg(target_os = "windows")]
fn retire_blocking(app: AppHandle) -> Result<bool, String> {
    let Some(root) = legacy_root(&app) else {
        return Ok(false);
    };
    if !root.exists() {
        return Ok(false);
    }
    if let Some(id) = installed_id(&root) {
        remove_from_profile(&app, &id)?;
    }
    std::fs::remove_dir_all(&root)
        .map_err(|error| format!("could not remove the old blocker's folder: {error}"))?;
    Ok(true)
}

#[cfg(not(target_os = "windows"))]
fn retire_blocking(app: AppHandle) -> Result<bool, String> {
    let Some(root) = legacy_root(&app) else {
        return Ok(false);
    };
    if !root.exists() {
        return Ok(false);
    }
    std::fs::remove_dir_all(&root)
        .map_err(|error| format!("could not remove the old blocker's folder: {error}"))?;
    Ok(true)
}

/// Asks the profile for its extensions and removes the one with this identity, if it is there.
#[cfg(target_os = "windows")]
fn remove_from_profile(app: &AppHandle, wanted_id: &str) -> Result<(), String> {
    use std::time::Duration;

    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Profile7, ICoreWebView2_13};
    use webview2_com::{
        BrowserExtensionRemoveCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler,
    };
    use windows_core::{Interface, PWSTR};

    let webview = crate::browser_profile::owner(app)?;
    let wanted_id = wanted_id.to_string();
    // How many removals were started (or an error), and then one message for each that finished.
    let (started_tx, started_rx) = std::sync::mpsc::sync_channel::<Result<usize, String>>(1);
    let (done_tx, done_rx) = std::sync::mpsc::channel::<Result<(), String>>();

    webview
        .with_webview(move |inner| unsafe {
            let failure_tx = started_tx.clone();
            let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(
                move |result, extensions| {
                    if result.is_err() {
                        let _ = started_tx.send(Err(format!(
                            "WebView2 could not list the browser extensions: {result:?}"
                        )));
                        return Ok(());
                    }
                    let mut ours = Vec::new();
                    if let Some(extensions) = extensions {
                        let mut count = 0;
                        if extensions.Count(&mut count).is_ok() {
                            for index in 0..count {
                                let Ok(extension) = extensions.GetValueAtIndex(index) else {
                                    continue;
                                };
                                let mut id = PWSTR::null();
                                if extension.Id(&mut id).is_err() {
                                    continue;
                                }
                                let extension_id = id.to_string().unwrap_or_default();
                                if !id.is_null() {
                                    windows::Win32::System::Com::CoTaskMemFree(Some(
                                        id.as_ptr().cast(),
                                    ));
                                }
                                if extension_id == wanted_id {
                                    ours.push(extension);
                                }
                            }
                        }
                    }
                    let _ = started_tx.send(Ok(ours.len()));
                    for extension in ours {
                        let on_done = done_tx.clone();
                        let on_error = done_tx.clone();
                        let removed = BrowserExtensionRemoveCompletedHandler::create(Box::new(
                            move |remove_result| {
                                let _ = on_done.send(remove_result.map_err(|error| {
                                    format!("WebView2 could not remove the old blocker: {error}")
                                }));
                                Ok(())
                            },
                        ));
                        if let Err(error) = extension.Remove(&removed) {
                            let _ = on_error.send(Err(format!(
                                "WebView2 could not start removing the old blocker: {error}"
                            )));
                        }
                    }
                    Ok(())
                },
            ));
            let result = inner
                .controller()
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_13>())
                .and_then(|core| core.Profile())
                .and_then(|profile| profile.cast::<ICoreWebView2Profile7>())
                .and_then(|profile| profile.GetBrowserExtensions(&handler));
            if let Err(error) = result {
                let _ = failure_tx.send(Err(error.to_string()));
            }
        })
        .map_err(|error| error.to_string())?;

    let removals = started_rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "timed out listing the browser extensions".to_string())??;
    for _ in 0..removals {
        done_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "timed out removing the old blocker".to_string())??;
    }
    Ok(())
}

/// Takes away the blocker earlier versions installed. Called once when the app starts; returns whether there was one.
#[tauri::command]
pub async fn legacy_blocker_retire(app: AppHandle) -> Result<bool, String> {
    // The completion handlers run on the window's thread, so only the wait for them belongs on the blocking pool.
    tauri::async_runtime::spawn_blocking(move || retire_blocking(app))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_identity_comes_from_the_marker_of_the_install_and_nothing_else() {
        let folder =
            std::env::temp_dir().join(format!("nebula-legacy-blocker-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        assert_eq!(installed_id(&folder), None, "no marker, no identity");
        std::fs::write(
            folder.join("current.json"),
            br#"{"source_sha256":"x","bundle_revision":3,"extension_id":"abc123"}"#,
        )
        .unwrap();
        assert_eq!(
            installed_id(&folder).as_deref(),
            Some("abc123"),
            "whatever build it was"
        );
        std::fs::write(folder.join("current.json"), br#"{"extension_id":""}"#).unwrap();
        assert_eq!(
            installed_id(&folder),
            None,
            "an empty identity would match nothing and is not one"
        );
        std::fs::write(folder.join("current.json"), b"not json").unwrap();
        assert_eq!(installed_id(&folder), None);
        let _ = std::fs::remove_dir_all(&folder);
    }
}
