use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

const UBLOCK_FOLDER: &str = "ubol";
const UBLOCK_VERSION: &str = "2026.804.1653";
const UBLOCK_SHA256: &str = "4cbfae11caf3a3a8d2e98d9c0844229d0ef7d1334785232d4fc667117a526193";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UblockExtensionInfo {
    extension_root: String,
    version: &'static str,
    source_sha256: &'static str,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UblockRuntimeStatus {
    installed: bool,
    enabled: bool,
}

fn contains_extension(root: &Path) -> bool {
    root.join(UBLOCK_FOLDER).join("manifest.json").is_file()
        && root.join(UBLOCK_FOLDER).join("LICENSE.txt").is_file()
}

fn extension_root(app: &AppHandle) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("resources").join("extensions"));
        candidates.push(resource_dir.join("extensions"));
    }
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("extensions"),
    );

    candidates
        .into_iter()
        .find(|candidate| contains_extension(candidate))
        .and_then(|candidate| candidate.canonicalize().ok())
        .ok_or_else(|| "bundled uBlock Origin Lite extension was not found".to_string())
}

#[tauri::command]
pub fn ublock_extension_info(app: AppHandle) -> Result<UblockExtensionInfo, String> {
    let root = extension_root(&app)?;
    Ok(UblockExtensionInfo {
        extension_root: root.to_string_lossy().into_owned(),
        version: UBLOCK_VERSION,
        source_sha256: UBLOCK_SHA256,
    })
}

#[cfg(target_os = "windows")]
fn ublock_extension_install_blocking(
    app: AppHandle,
    label: String,
) -> Result<UblockRuntimeStatus, String> {
    use std::time::Duration;

    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Profile7, ICoreWebView2_13};
    use webview2_com::ProfileAddBrowserExtensionCompletedHandler;
    use windows_core::{Interface, BOOL, HSTRING};

    let extension_dir = extension_root(&app)?.join(UBLOCK_FOLDER);
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);

    webview
        .with_webview(move |inner| unsafe {
            let failure_tx = tx.clone();
            let handler = ProfileAddBrowserExtensionCompletedHandler::create(Box::new(
                move |result, extension| {
                    if result.is_err() {
                        let _ = tx.send(Err(format!(
                            "WebView2 could not install uBlock Origin Lite: {result:?}"
                        )));
                        return Ok(());
                    }

                    let mut status = UblockRuntimeStatus {
                        installed: extension.is_some(),
                        enabled: false,
                    };
                    if let Some(extension) = extension {
                        let mut enabled = BOOL::default();
                        status.enabled =
                            extension.IsEnabled(&mut enabled).is_ok() && enabled.as_bool();
                    }
                    let _ = tx.send(Ok(status));
                    Ok(())
                },
            ));

            let result = inner
                .controller()
                .CoreWebView2()
                .and_then(|core| core.cast::<ICoreWebView2_13>())
                .and_then(|core| core.Profile())
                .and_then(|profile| profile.cast::<ICoreWebView2Profile7>())
                .and_then(|profile| {
                    profile.AddBrowserExtension(&HSTRING::from(extension_dir.as_path()), &handler)
                });
            if let Err(error) = result {
                let _ = failure_tx.send(Err(error.to_string()));
            }
        })
        .map_err(|error| error.to_string())?;

    rx.recv_timeout(Duration::from_secs(10))
        .map_err(|_| "timed out installing uBlock Origin Lite".to_string())?
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn ublock_extension_install(
    app: AppHandle,
    label: String,
) -> Result<UblockRuntimeStatus, String> {
    // The WebView2 completion handler is dispatched on the UI thread. Waiting
    // in a synchronous Tauri command blocks that thread and guarantees a
    // timeout, so only the channel wait belongs on the blocking pool.
    tauri::async_runtime::spawn_blocking(move || ublock_extension_install_blocking(app, label))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn ublock_extension_install(
    _app: AppHandle,
    _label: String,
) -> Result<UblockRuntimeStatus, String> {
    Ok(UblockRuntimeStatus::default())
}

#[cfg(target_os = "windows")]
fn ublock_extension_status_blocking(
    app: AppHandle,
    label: String,
) -> Result<UblockRuntimeStatus, String> {
    use std::time::Duration;

    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Profile7, ICoreWebView2_13};
    use webview2_com::ProfileGetBrowserExtensionsCompletedHandler;
    use windows_core::{Interface, BOOL, PWSTR};

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);

    webview
        .with_webview(move |inner| unsafe {
            let failure_tx = tx.clone();
            let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(
                move |result, extensions| {
                    let mut status = UblockRuntimeStatus::default();
                    if result.is_ok() {
                        if let Some(extensions) = extensions {
                            let mut count = 0;
                            if extensions.Count(&mut count).is_ok() {
                                for index in 0..count {
                                    let Ok(extension) = extensions.GetValueAtIndex(index) else {
                                        continue;
                                    };
                                    let mut name = PWSTR::null();
                                    if extension.Name(&mut name).is_err() {
                                        continue;
                                    }
                                    let extension_name = name.to_string().unwrap_or_default();
                                    if !name.is_null() {
                                        windows::Win32::System::Com::CoTaskMemFree(Some(
                                            name.as_ptr().cast(),
                                        ));
                                    }
                                    if !extension_name.contains("uBlock Origin Lite") {
                                        continue;
                                    }
                                    let mut enabled = BOOL::default();
                                    status.installed = true;
                                    status.enabled = extension.IsEnabled(&mut enabled).is_ok()
                                        && enabled.as_bool();
                                    break;
                                }
                            }
                        }
                    }
                    let _ = tx.send(status);
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
            if result.is_err() {
                let _ = failure_tx.send(UblockRuntimeStatus::default());
            }
        })
        .map_err(|error| error.to_string())?;

    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "timed out checking uBlock extension status".to_string())
}

#[cfg(target_os = "windows")]
#[tauri::command]
pub async fn ublock_extension_status(
    app: AppHandle,
    label: String,
) -> Result<UblockRuntimeStatus, String> {
    tauri::async_runtime::spawn_blocking(move || ublock_extension_status_blocking(app, label))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(not(target_os = "windows"))]
#[tauri::command]
pub fn ublock_extension_status(
    _app: AppHandle,
    _label: String,
) -> Result<UblockRuntimeStatus, String> {
    Ok(UblockRuntimeStatus::default())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vendored_extension_has_manifest_and_license() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join("extensions");
        assert!(contains_extension(&root));
        assert!(root
            .join(UBLOCK_FOLDER)
            .join("js")
            .join("nebula-ready.js")
            .is_file());

        let mode_manager =
            std::fs::read_to_string(root.join(UBLOCK_FOLDER).join("js").join("mode-manager.js"))
                .expect("uBlock mode manager should be readable");
        assert!(mode_manager.contains("enforceNebulaInternalExceptions(userModes)"));
        assert!(mode_manager.contains("'tauri.localhost'"));
        assert!(mode_manager.contains("nebulaCompleteFilteringHostnames = [ 'youtube.com' ]"));

        let manifest = std::fs::read_to_string(root.join(UBLOCK_FOLDER).join("manifest.json"))
            .expect("uBlock manifest should be readable");
        let manifest: serde_json::Value =
            serde_json::from_str(&manifest).expect("uBlock manifest should be valid JSON");
        assert_eq!(manifest["version"], UBLOCK_VERSION);
        assert_eq!(
            manifest["content_scripts"][0]["js"][0],
            "/js/nebula-ready.js"
        );
        let experimental_enabled = manifest["declarative_net_request"]["rule_resources"]
            .as_array()
            .expect("uBlock rulesets should be an array")
            .iter()
            .any(|ruleset| ruleset["id"] == "ublock-experimental" && ruleset["enabled"] == true);
        assert!(experimental_enabled);
    }
}
