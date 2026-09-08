use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

mod cache;

const UBLOCK_FOLDER: &str = "ubol";
const UBLOCK_VERSION: &str = "2026.804.1653";
const UBLOCK_SHA256: &str = "4cbfae11caf3a3a8d2e98d9c0844229d0ef7d1334785232d4fc667117a526193";
const UBLOCK_BUILD_REVISION: u32 = 3;

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

#[cfg(target_os = "windows")]
#[derive(Deserialize, Serialize)]
struct UblockInstallMarker {
    source_sha256: String,
    bundle_revision: u32,
    extension_id: String,
}

#[cfg(target_os = "windows")]
struct InstalledUblock {
    status: UblockRuntimeStatus,
    extension_id: String,
}

#[cfg(target_os = "windows")]
fn current_runtime_status(expected_id: &str, extensions: &[(String, bool)]) -> UblockRuntimeStatus {
    if extensions.len() != 1 || extensions[0].0 != expected_id {
        return UblockRuntimeStatus::default();
    }
    UblockRuntimeStatus {
        installed: true,
        enabled: extensions[0].1,
    }
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

fn extension_cache_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("extensions").join(UBLOCK_FOLDER))
        .map_err(|error| format!("uBlock data directory unavailable: {error}"))
}

#[cfg(target_os = "windows")]
fn install_marker(app: &AppHandle) -> Option<UblockInstallMarker> {
    let path = extension_cache_root(app).ok()?.join("current.json");
    let marker: UblockInstallMarker = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    (marker.source_sha256 == UBLOCK_SHA256 && marker.bundle_revision == UBLOCK_BUILD_REVISION)
        .then_some(marker)
}

#[cfg(target_os = "windows")]
fn write_install_marker(app: &AppHandle, extension_id: &str) -> Result<(), String> {
    let root = extension_cache_root(app)?;
    std::fs::create_dir_all(&root)
        .map_err(|error| format!("Could not create uBlock marker directory: {error}"))?;
    let marker = serde_json::to_vec(&UblockInstallMarker {
        source_sha256: UBLOCK_SHA256.to_string(),
        bundle_revision: UBLOCK_BUILD_REVISION,
        extension_id: extension_id.to_string(),
    })
    .map_err(|error| format!("Could not encode uBlock install marker: {error}"))?;
    std::fs::write(root.join("current.json"), marker)
        .map_err(|error| format!("Could not write uBlock install marker: {error}"))
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
fn remove_stale_ublock_extensions_blocking(
    app: &AppHandle,
    label: &str,
    keep_id: &str,
) -> Result<usize, String> {
    use std::time::Duration;

    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Profile7, ICoreWebView2_13};
    use webview2_com::{
        BrowserExtensionRemoveCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler,
    };
    use windows_core::{Interface, PWSTR};

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;
    let keep_id = keep_id.to_string();
    let (count_tx, count_rx) = std::sync::mpsc::sync_channel(1);
    let (completion_tx, completion_rx) = std::sync::mpsc::channel();

    webview
        .with_webview(move |inner| unsafe {
            let failure_tx = count_tx.clone();
            let completion_tx_for_handler = completion_tx.clone();
            let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(
                move |result, extensions| {
                    if result.is_err() {
                        let _ = count_tx.send(Err(format!(
                            "WebView2 could not enumerate browser extensions: {result:?}"
                        )));
                        return Ok(());
                    }

                    let mut stale = Vec::new();
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

                                let mut id = PWSTR::null();
                                let extension_id = if extension.Id(&mut id).is_ok() {
                                    id.to_string().unwrap_or_default()
                                } else {
                                    String::new()
                                };
                                if !id.is_null() {
                                    windows::Win32::System::Com::CoTaskMemFree(Some(
                                        id.as_ptr().cast(),
                                    ));
                                }
                                if extension_id != keep_id {
                                    stale.push(extension);
                                }
                            }
                        }
                    }

                    let stale_count = stale.len();
                    let _ = count_tx.send(Ok(stale_count));
                    for extension in stale {
                        let completion_tx = completion_tx_for_handler.clone();
                        let remove_handler =
                            BrowserExtensionRemoveCompletedHandler::create(Box::new(
                                move |remove_result| {
                                    let outcome = if remove_result.is_err() {
                                        Err(format!(
                                            "WebView2 could not remove a stale uBlock extension: {remove_result:?}"
                                        ))
                                    } else {
                                        Ok(())
                                    };
                                    let _ = completion_tx.send(outcome);
                                    Ok(())
                                },
                            ));
                        if let Err(error) = extension.Remove(&remove_handler) {
                            let _ = completion_tx_for_handler.send(Err(format!(
                                "WebView2 could not start stale uBlock removal: {error}"
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

    let stale_count = count_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "timed out enumerating browser extensions".to_string())??;
    for _ in 0..stale_count {
        completion_rx
            .recv_timeout(Duration::from_secs(10))
            .map_err(|_| "timed out removing a stale uBlock extension".to_string())??;
    }
    Ok(stale_count)
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

    let bundled_extension = extension_root(&app)?.join(UBLOCK_FOLDER);
    let cache_root = extension_cache_root(&app)?;
    let extension_dir = cache::prepare(&bundled_extension, &cache_root, UBLOCK_VERSION)
        .map_err(|error| format!("Could not prepare writable uBlock extension: {error}"))?;
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
                    let mut extension_id = String::new();
                    if let Some(extension) = extension {
                        let mut enabled = BOOL::default();
                        status.enabled =
                            extension.IsEnabled(&mut enabled).is_ok() && enabled.as_bool();
                        let mut id = windows_core::PWSTR::null();
                        if extension.Id(&mut id).is_ok() {
                            extension_id = id.to_string().unwrap_or_default();
                        }
                        if !id.is_null() {
                            windows::Win32::System::Com::CoTaskMemFree(Some(id.as_ptr().cast()));
                        }
                    }
                    if extension_id.is_empty() {
                        let _ = tx.send(Err(
                            "WebView2 installed uBlock without returning an extension ID"
                                .to_string(),
                        ));
                    } else {
                        let _ = tx.send(Ok(InstalledUblock {
                            status,
                            extension_id,
                        }));
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
                .and_then(|profile| {
                    profile.AddBrowserExtension(&HSTRING::from(extension_dir.as_path()), &handler)
                });
            if let Err(error) = result {
                let _ = failure_tx.send(Err(error.to_string()));
            }
        })
        .map_err(|error| error.to_string())?;

    let installed = rx
        .recv_timeout(Duration::from_secs(10))
        .map_err(|_| "timed out installing uBlock Origin Lite".to_string())??;
    remove_stale_ublock_extensions_blocking(&app, &label, &installed.extension_id)?;
    write_install_marker(&app, &installed.extension_id)?;
    Ok(installed.status)
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

    let Some(marker) = install_marker(&app) else {
        return Ok(UblockRuntimeStatus::default());
    };
    let expected_id = marker.extension_id;
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);

    webview
        .with_webview(move |inner| unsafe {
            let failure_tx = tx.clone();
            let handler = ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(
                move |result, extensions| {
                    let mut ublock_extensions = Vec::new();
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
                                    let mut id = PWSTR::null();
                                    let extension_id = if extension.Id(&mut id).is_ok() {
                                        id.to_string().unwrap_or_default()
                                    } else {
                                        String::new()
                                    };
                                    if !id.is_null() {
                                        windows::Win32::System::Com::CoTaskMemFree(Some(
                                            id.as_ptr().cast(),
                                        ));
                                    }
                                    let mut enabled = BOOL::default();
                                    let is_enabled = extension.IsEnabled(&mut enabled).is_ok()
                                        && enabled.as_bool();
                                    ublock_extensions.push((extension_id, is_enabled));
                                }
                            }
                        }
                    }
                    let status = current_runtime_status(&expected_id, &ublock_extensions);
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
        assert!(mode_manager.contains("optimal: [ 'all-urls' ]"));

        let manifest = std::fs::read_to_string(root.join(UBLOCK_FOLDER).join("manifest.json"))
            .expect("uBlock manifest should be readable");
        let manifest: serde_json::Value =
            serde_json::from_str(&manifest).expect("uBlock manifest should be valid JSON");
        assert_eq!(manifest["version"], UBLOCK_VERSION);
        assert_eq!(
            manifest["content_scripts"][0]["js"][0],
            "/js/nebula-ready.js"
        );
        let rule_resources = manifest["declarative_net_request"]["rule_resources"]
            .as_array()
            .expect("uBlock rulesets should be an array");
        let standard_enabled = rule_resources
            .iter()
            .any(|ruleset| ruleset["id"] == "ublock-filters" && ruleset["enabled"] == true);
        let experimental_enabled = rule_resources
            .iter()
            .any(|ruleset| ruleset["id"] == "ublock-experimental" && ruleset["enabled"] == true);
        assert!(standard_enabled);
        assert!(!experimental_enabled);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn current_status_rejects_stale_and_duplicate_ublock_instances() {
        let current = [("current".to_string(), true)];
        let status = current_runtime_status("current", &current);
        assert!(status.installed);
        assert!(status.enabled);

        let stale = [("stale".to_string(), true)];
        assert!(!current_runtime_status("current", &stale).installed);

        let duplicate = [("current".to_string(), true), ("stale".to_string(), true)];
        assert!(!current_runtime_status("current", &duplicate).installed);
    }
}
