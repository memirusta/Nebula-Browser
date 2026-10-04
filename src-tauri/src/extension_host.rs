//! Common host for catalog extensions. No extension-specific scripts or privileged IPC.
use crate::extension_install::InstallationLocation;
use serde::Serialize;
use serde_json::Value;
use std::{
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};
use tauri::Manager;

#[cfg(all(test, target_os = "windows", feature = "extension-native-smoke"))]
#[path = "extension_host_native_test.rs"]
mod native_tests;

#[cfg(target_os = "windows")]
#[path = "extension_host_windows.rs"]
mod popup_windows;

/// Whether a request for a new window opened by `label` is still being handled: that window must
/// not be closed yet (see `extension_host_windows`).
#[cfg(target_os = "windows")]
pub(crate) fn window_request_pending(label: &str) -> bool {
    popup_windows::has_pending(label)
}

pub(crate) fn valid_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

pub(crate) fn root_for(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    // Never interpret arbitrary IPC input as an on-disk path.
    crate::extension_discovery::extension(id)?;
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("extensions")
        .join(id))
}

pub(crate) fn location(root: PathBuf, id: &str) -> Result<InstallationLocation, String> {
    if let Ok(package) = crate::extension_registry::package(id) {
        return Ok(InstallationLocation::registered(root, package));
    }
    let digest = std::fs::read_to_string(root.join("installed-folder")).unwrap_or_default();
    // Invalid pointers never become filesystem paths, but the runtime ID must
    // remain manageable so a damaged installation can still be removed.
    let folder = root.join(if valid_digest(&digest) {
        &digest
    } else {
        "uninstalled"
    });
    Ok(InstallationLocation { root, folder })
}

pub(crate) fn write_record(root: &Path, name: &str, value: &[u8]) -> Result<(), String> {
    let mut file = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
    file.write_all(value).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(root.join(name)).map_err(|e| e.to_string())?;
    Ok(())
}

pub(crate) fn catalog_profile_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("extension-browsing-profile"))
}

pub(crate) fn close_controls(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    for (label, window) in app.webview_windows() {
        if label.starts_with(&format!("extension-ui-{id}-"))
            || label.starts_with(&format!("extension-auth-extension-ui-{id}-"))
        {
            window.destroy().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Catalog code must not share the privileged React shell's profile. The
/// dedicated coordinator has no capability entry and never navigates to app UI.
#[cfg(target_os = "windows")]
pub(crate) fn catalog_host(app: &tauri::AppHandle) -> Result<String, String> {
    static CREATING: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _creating = CREATING
        .lock()
        .map_err(|_| "Extension profile unavailable")?;
    let label = "extension-catalog-host";
    if app.get_webview(label).is_none() {
        let directory = catalog_profile_directory(app)?;
        let host = tauri::WebviewWindowBuilder::new(
            app,
            label,
            tauri::WebviewUrl::External("about:blank".parse().unwrap()),
        )
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .data_directory(directory)
        .browser_extensions_enabled(true)
        .on_navigation(|url| url.as_str() == "about:blank")
        .build()
        .map_err(|e| e.to_string())?;
        // A window an extension's service worker asks for (a sign-in window after
        // pressing Log in) reaches this host. It used to refuse every one, so
        // `chrome.windows.create` reported success and nothing opened. Now it goes
        // through the same window policy as extension pages, which also requires
        // a recent action of the user.
        if let Err(error) = popup_windows::attach(app, &host, true) {
            let _ = host.destroy();
            return Err(error);
        }
    }
    Ok(label.into())
}

pub(crate) async fn manage_discovery(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    action: String,
    id: String,
    expected_sha256: Option<String>,
) -> Result<crate::extension_activation::ManageResult, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, webview, action, id, expected_sha256);
        Err("Browser extensions require Windows".into())
    }
    #[cfg(target_os = "windows")]
    {
        use crate::extension_activation::{self as activation, Activation, ManageResult};
        use crate::extension_install::{operate, MutationGuard};
        use sha2::Digest;
        let entry = crate::extension_discovery::extension(&id)?;
        if !matches!(
            action.as_str(),
            "status" | "install" | "enable" | "disable" | "remove"
        ) {
            return Err("Unknown extension action".into());
        }
        let guard = if action == "status" {
            None
        } else {
            Some(MutationGuard::acquire(&id)?)
        };
        let root = root_for(&app, &id)?;
        let installed = root.join("installed-id").is_file();
        // Installed before extensions moved to the browsing profile: registered with the
        // separate catalog profile. It stays manageable there until it is moved.
        let legacy = activation::is_legacy(&root, false);
        let _ = webview;
        if action == "status" && !installed {
            let mut result = activation::pending_result(&root).unwrap_or_default();
            result.activation_error = activation::activation_error(&root);
            return Ok(result);
        }
        if matches!(action.as_str(), "disable" | "remove") {
            close_controls(&app, &id)?;
        }
        if action == "remove" && !installed {
            // Only a prepared package that was waiting to start: nothing is registered.
            activation::forget(&root);
            let _ = std::fs::remove_file(root.join("installed-folder"));
            return Ok(ManageResult::default());
        }
        if action == "enable" && legacy {
            return Err(activation::NEEDS_MIGRATION.into());
        }
        // The profile the extension is registered with now: the browsing profile through
        // its owner, or (legacy) the catalog host.
        let host_app = app.clone();
        let label = tauri::async_runtime::spawn_blocking(move || {
            if legacy {
                catalog_host(&host_app)
            } else {
                crate::browser_profile::owner_label(&host_app)
            }
        })
        .await
        .map_err(|e| e.to_string())??;
        if action == "install" {
            let expected = expected_sha256
                .filter(|value| valid_digest(value))
                .ok_or("Review the downloaded package before installing it")?;
            if installed {
                let status_app = app.clone();
                let status_label = label.clone();
                let target = location(root.clone(), &id)?;
                let current = tauri::async_runtime::spawn_blocking(move || {
                    operate(status_app, status_label, target, "status".into(), None)
                })
                .await
                .map_err(|e| e.to_string())??;
                if current.installed {
                    return Err(
                        "Extension is already installed; enable it or remove it before reinstalling"
                            .into(),
                    );
                }
            }
            // Re-fetch from the same allowlisted source, then bind installation
            // to the exact bytes whose manifest the user reviewed. A store update
            // causes a new review, never a silent permission/version change.
            // The fetcher takes the *catalog* id. Four catalog ids are slugs that
            // differ from their store id (bitwarden, languagetool, ...), so passing
            // the store id broke installing exactly those.
            let bytes = crate::extension_download::fetch_discovery_package(&entry.id).await?;
            let digest = format!("{:x}", sha2::Sha256::digest(&bytes));
            if digest != expected {
                return Err(
                    "The store package changed. Download and review it again before installing"
                        .into(),
                );
            }
            let prepare_app = app.clone();
            let prepare_root = root.clone();
            let store_id = entry.store_id.clone();
            // Each step names itself: a bare "Access is denied" from WebView2 does
            // not say whether the package check, the folder or the registration failed.
            // Everything up to here only writes files; nothing runs yet.
            tauri::async_runtime::spawn_blocking(move || {
                crate::extension_install::probe_discovery_download(
                    prepare_app,
                    store_id.clone(),
                    &bytes,
                    digest.clone(),
                )
                .map_err(|e| format!("Isolated load check failed: {e}"))?;
                let (entries, _) = crate::extension_install::discovery_entries(&bytes, &store_id)
                    .map_err(|e| format!("Package check failed: {e}"))?;
                crate::extension_install::prepare_discovery_directory(
                    &prepare_root,
                    &digest,
                    entries,
                )
                .map_err(|e| format!("Could not prepare the extension folder: {e}"))?;
                write_record(&prepare_root, "installed-folder", digest.as_bytes())
            })
            .await
            .map_err(|e| e.to_string())??;
        }
        // Starting extension code waits for the isolated shell.
        if matches!(action.as_str(), "install" | "enable")
            && activation::decide(&root, &action)? == Activation::Waiting
        {
            return Ok(activation::pending_result(&root).unwrap_or_default());
        }
        let target = location(root.clone(), &id)?;
        let stage = action.clone();
        let done = action.clone();
        let result = tauri::async_runtime::spawn_blocking(move || {
            operate(app, label, target, action, guard)
        })
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| {
            // Installation errors keep their own wording; only label the step.
            if stage == "install" {
                format!("Registration failed: {e}")
            } else {
                e
            }
        })?;
        match done.as_str() {
            "install" if result.installed => activation::mark_browsing(&root)?,
            "remove" => activation::forget(&root),
            _ => {}
        }
        let mut result = ManageResult::from(result);
        if action_is_status(&done) {
            result.pending_activation = activation::pending_action(&root).is_some();
            result.activation_error = activation::activation_error(&root);
        }
        Ok(result)
    }
}

#[cfg(target_os = "windows")]
fn action_is_status(action: &str) -> bool {
    action == "status"
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledExtension {
    id: String,
    enabled: bool,
    version: String,
    icon_data_url: Option<String>,
    has_popup: bool,
    has_options: bool,
    has_side_panel: bool,
    primary_view: Option<String>,
    runs_in_profile: bool,
    requires_native_app: bool,
    needs_action_host: bool,
    needs_side_panel: bool,
    isolated_profile: bool,
    metadata_available: bool,
}

fn has_permission(manifest: &Value, permission: &str) -> bool {
    manifest["permissions"]
        .as_array()
        .is_some_and(|permissions| permissions.iter().any(|value| value == permission))
}

fn runs_in_profile(manifest: &Value) -> bool {
    manifest["content_scripts"]
        .as_array()
        .is_some_and(|scripts| !scripts.is_empty())
        || manifest.pointer("/background/service_worker").is_some()
        || manifest.pointer("/background/scripts").is_some()
        || [
            "declarativeNetRequest",
            "declarativeNetRequestWithHostAccess",
            "webRequest",
        ]
        .iter()
        .any(|permission| has_permission(manifest, permission))
}

fn manifest_at(folder: &Path) -> Result<Value, String> {
    let mut bytes = Vec::new();
    std::fs::File::open(packaged_file(folder, "manifest.json").ok_or("Missing packaged manifest")?)
        .map_err(|e| e.to_string())?
        .take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("Extension manifest is too large".into());
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn safe_relative_path(value: &str) -> Option<&str> {
    let value = value.strip_prefix("./").unwrap_or(value);
    (!value.is_empty()
        && !value.contains(['\\', ':', '%', '?', '#', '\0'])
        && !value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
        && Path::new(value)
            .components()
            .all(|part| matches!(part, Component::Normal(_))))
    .then_some(value)
}

fn icon_path(manifest: &Value) -> Option<&str> {
    fn largest_icon(value: &Value) -> Option<&str> {
        if let Some(path) = value.as_str() {
            return safe_relative_path(path);
        }
        value
            .as_object()?
            .iter()
            .filter_map(|(size, path)| {
                Some((
                    size.parse::<u32>().ok()?,
                    safe_relative_path(path.as_str()?)?,
                ))
            })
            .max_by_key(|(size, _)| *size)
            .map(|(_, path)| path)
    }
    manifest
        .pointer("/action/default_icon")
        .and_then(largest_icon)
        .or_else(|| manifest.get("icons").and_then(largest_icon))
}

fn packaged_file(folder: &Path, path: &str) -> Option<PathBuf> {
    let root = folder.canonicalize().ok()?;
    let file = root.join(safe_relative_path(path)?).canonicalize().ok()?;
    (file.starts_with(&root) && file.is_file()).then_some(file)
}

fn has_controls_page(folder: &Path, manifest: &Value, kind: &str) -> bool {
    page_path(manifest, kind)
        .ok()
        .and_then(|path| packaged_file(folder, &path))
        .is_some()
}

fn icon_data_url(folder: &Path, manifest: &Value) -> Option<String> {
    use base64::Engine as _;
    let path = icon_path(manifest)?;
    let mime = match Path::new(path)
        .extension()?
        .to_str()?
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        _ => return None,
    };
    let mut bytes = Vec::new();
    std::fs::File::open(packaged_file(folder, path)?)
        .ok()?
        .take(512 * 1024 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.is_empty() || bytes.len() > 512 * 1024 {
        return None;
    }
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

fn page_path(manifest: &Value, kind: &str) -> Result<String, String> {
    let declared = match kind {
        "popup" => manifest
            .pointer("/action/default_popup")
            .and_then(Value::as_str),
        "options" => manifest
            .pointer("/options_ui/page")
            .or_else(|| manifest.get("options_page"))
            .and_then(Value::as_str),
        "side-panel" => manifest
            .pointer("/side_panel/default_path")
            .and_then(Value::as_str)
            .or_else(|| {
                manifest["permissions"]
                    .as_array()
                    .is_some_and(|permissions| permissions.iter().any(|p| p == "sidePanel"))
                    .then_some("sidepanel.html")
            }),
        _ => return Err("Unknown extension view".into()),
    }
    .ok_or("This extension has no declared controls page; action and dynamic side panel support are not available yet")?;
    let value = safe_relative_path(declared).ok_or("Unsafe extension view path")?;
    Ok(value.to_string())
}

#[tauri::command]
pub async fn extension_host_list(
    app: tauri::AppHandle,
    _webview: tauri::Webview,
) -> Result<Vec<InstalledExtension>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, _webview);
        Err("Browser extensions require Windows".into())
    }
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let mut installed = Vec::new();
            // The browser profile's extensions are asked of its owner, never of the shell
            // window that called: the shell's environment may not allow extensions at all.
            let regular = crate::extension_install::enumerate(
                app.clone(),
                crate::browser_profile::owner_label(&app)?,
            )?;
            let has_catalog_install = crate::extension_discovery::DISCOVERY.iter().any(|entry| {
                root_for(&app, &entry.id).is_ok_and(|root| {
                    crate::extension_activation::is_legacy(
                        &root,
                        crate::extension_registry::package(&entry.id).is_ok(),
                    )
                })
            });
            let catalog = if has_catalog_install {
                let label = catalog_host(&app)?;
                crate::extension_install::enumerate(app.clone(), label)?
            } else {
                std::collections::HashMap::new()
            };
            for entry in crate::extension_discovery::DISCOVERY.iter() {
                let root = root_for(&app, &entry.id)?;
                if !root.join("installed-id").is_file() {
                    continue;
                }
                let target = location(root, &entry.id)?;
                let isolated_profile = crate::extension_activation::is_legacy(
                    &target.root,
                    crate::extension_registry::package(&entry.id).is_ok(),
                );
                let runtime_id = std::fs::read_to_string(target.root.join("installed-id"))
                    .map_err(|e| e.to_string())?;
                let enabled = if isolated_profile {
                    catalog.get(&runtime_id)
                } else {
                    regular.get(&runtime_id)
                };
                let Some(enabled) = enabled else {
                    continue;
                };
                // A missing/corrupt manifest must not hide every installed item,
                // including the controls used to disable or remove this one.
                let manifest = manifest_at(&target.folder).unwrap_or(Value::Null);
                let has_popup = has_controls_page(&target.folder, &manifest, "popup");
                let has_side_panel = has_controls_page(&target.folder, &manifest, "side-panel");
                let primary_view = if has_popup {
                    Some("popup".into())
                } else if has_side_panel {
                    Some("side-panel".into())
                } else {
                    None
                };
                installed.push(InstalledExtension {
                    id: entry.id.clone(),
                    enabled: *enabled,
                    version: manifest["version"].as_str().unwrap_or("").into(),
                    icon_data_url: icon_data_url(&target.folder, &manifest),
                    has_popup,
                    has_options: has_controls_page(&target.folder, &manifest, "options"),
                    has_side_panel,
                    primary_view,
                    runs_in_profile: runs_in_profile(&manifest),
                    requires_native_app: has_permission(&manifest, "nativeMessaging"),
                    needs_action_host: manifest.get("action").is_some() && !has_popup,
                    needs_side_panel: manifest.get("side_panel").is_some()
                        || manifest["permissions"]
                            .as_array()
                            .is_some_and(|permissions| {
                                permissions.iter().any(|p| p == "sidePanel")
                            }),
                    isolated_profile,
                    metadata_available: manifest.is_object(),
                });
            }
            Ok(installed)
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn open_controls(
    app: &tauri::AppHandle,
    owners: (&str, &str),
    label: &str,
    target: &InstallationLocation,
    kind: &str,
    visible: bool,
) -> Result<(), String> {
    let manifest = manifest_at(&target.folder)?;
    let path = page_path(&manifest, kind)?;
    open_controls_page(app, owners, label, target, &path, visible)
}

/// Open a packaged extension page. `path` must name an existing file inside the
/// package; the caller is responsible for it being a path the extension declared
/// or set, never a URL.
#[cfg(target_os = "windows")]
pub(crate) fn open_controls_page(
    app: &tauri::AppHandle,
    owners: (&str, &str),
    label: &str,
    target: &InstallationLocation,
    path: &str,
    visible: bool,
) -> Result<(), String> {
    // Every way a user opens an extension view comes through here.
    crate::extension_window_policy::note_user_action();
    let runtime_id =
        std::fs::read_to_string(target.root.join("installed-id")).map_err(|e| e.to_string())?;
    if !crate::extension_discovery::valid_store_id(&runtime_id) {
        return Err("Invalid runtime extension identifier".into());
    }
    if packaged_file(&target.folder, path).is_none() {
        return Err("Extension controls page is missing".into());
    }
    let mut url: tauri::Url = format!("chrome-extension://{runtime_id}/")
        .parse()
        .map_err(|e: url::ParseError| e.to_string())?;
    url.set_path(path);
    if let Some(window) = app.get_webview_window(label) {
        if visible {
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let profile = if owners.1 == "extension-catalog-host" {
        catalog_profile_directory(app)?
    } else if crate::browser_profile::is_owner(owners.1) {
        crate::browser_profile::user_data_folder(app)?
    } else {
        return Err("Unknown extension profile".into());
    };
    // How this window looks is decided by what the extension declared (see
    // extension_window_profile): a toolbar popup is a frameless box that follows
    // its content and closes when it loses focus, an options page opened in a tab
    // is large, a side panel is docked to its browser window, and only a window
    // with nothing declared gets the fixed default size.
    use crate::extension_window_profile as window_profile;
    let kind = window_profile::kind_of(label);
    let hints = manifest_at(&target.folder)
        .map(|manifest| window_profile::hints(&manifest))
        .unwrap_or_default();
    // Own the panel by its browser window. `get_webview_window` cannot find a
    // Nebula browser window (its WebViews carry different labels), which left the
    // panel unowned: no taskbar button (skip_taskbar), no Alt+Tab entry, and
    // nothing to bring it back once another app covered it.
    let owner_window = app.get_window(owners.0);
    let owner_rect = owner_window.as_ref().and_then(|owner| {
        let scale = owner.scale_factor().ok()?;
        let position = owner.outer_position().ok()?;
        let size = owner.outer_size().ok()?;
        Some(window_profile::Rect {
            x: position.x as f64 / scale,
            y: position.y as f64 / scale,
            width: size.width as f64 / scale,
            height: size.height as f64 / scale,
        })
    });
    let work_area = owner_window
        .as_ref()
        .and_then(|owner| owner.current_monitor().ok().flatten())
        .map(|monitor| {
            let area = monitor.work_area().size;
            let scale = monitor.scale_factor().max(0.1);
            (area.width as f64 / scale, area.height as f64 / scale)
        });
    let look = window_profile::profile(kind, hints, owner_rect, work_area);
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title("Nebula · Extension")
    .inner_size(look.size.0, look.size.1)
    .min_inner_size(look.min_size.0, look.min_size.1)
    .decorations(look.decorations)
    .resizable(look.resizable)
    .visible(visible)
    .focused(visible)
    .skip_taskbar(true)
    .data_directory(profile)
    .browser_extensions_enabled(true)
    .on_navigation(move |url| {
        url.as_str() == "about:blank"
            || (url.scheme() == "chrome-extension" && url.host_str() == Some(runtime_id.as_str()))
    });
    if let Some(hwnd) = owner_window
        .as_ref()
        .and_then(|owner_window| owner_window.hwnd().ok())
    {
        builder = builder.owner_raw(hwnd);
    }
    // A frameless popup cannot be dragged, so every window is placed against its
    // browser window instead of wherever Windows would put it.
    if let Some((x, y)) = look.position {
        builder = builder.position(x, y);
    }
    let window = builder.build().map_err(|e| e.to_string())?;
    if let Err(error) = popup_windows::attach(app, &window, visible) {
        let _ = window.destroy();
        return Err(error);
    }
    // Opt-in evidence trace (Extension Lab). When it is on it opens the page itself,
    // once the trace is in place; navigating here as well would race with it.
    if !crate::extension_trace::attach(app, label, url.as_str()) {
        if let Err(error) = window.navigate(url) {
            let _ = window.destroy();
            return Err(error.to_string());
        }
    }
    crate::extension_popup_size::watch(app, label, look.follow_content);
    if kind == window_profile::Kind::Popup {
        crate::extension_popup_size::close_on_blur(app, &window);
    }
    Ok(())
}

#[tauri::command]
pub async fn extension_host_open(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
    kind: String,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, webview, id, kind);
        Err("Browser extensions require Windows".into())
    }
    #[cfg(target_os = "windows")]
    {
        // The user is opening an extension: its background code may now ask for a
        // window (see extension_window_policy).
        crate::extension_window_policy::note_user_action();
        let guard = crate::extension_install::MutationGuard::acquire(&id)?;
        let target = location(root_for(&app, &id)?, &id)?;
        let owner = webview.window().label().to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let _keep_alive = guard;
            let profile_label = if crate::extension_activation::is_legacy(
                &target.root,
                crate::extension_registry::package(&id).is_ok(),
            ) {
                catalog_host(&app)?
            } else {
                crate::browser_profile::owner_label(&app)?
            };
            let status = crate::extension_install::operate(
                app.clone(),
                profile_label.clone(),
                target.clone(),
                "status".into(),
                None,
            )?;
            if !status.enabled {
                return Err("Extension is disabled or no longer installed".into());
            }
            open_controls(
                &app,
                (&owner, &profile_label),
                &format!("extension-ui-{id}-{kind}"),
                &target,
                &kind,
                true,
            )
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

/// Emulate a click on an installed extension's toolbar icon. WebView2 has no
/// toolbar, so it never raises `chrome.action.onClicked`; Nebula does, through a
/// fixed operation in the extension's worker (see `extension_worker`).
#[tauri::command]
pub async fn extension_host_click(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    id: String,
) -> Result<crate::extension_worker::ActionClick, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, webview, id);
        Err("Browser extensions require Windows".into())
    }
    #[cfg(target_os = "windows")]
    {
        // A click on the extension's icon: its background code may react by opening a
        // window (a sign-in page), which is exactly what the policy waits for.
        crate::extension_window_policy::note_user_action();
        let guard = crate::extension_install::MutationGuard::acquire(&id)?;
        let target = location(root_for(&app, &id)?, &id)?;
        let owner = webview.window().label().to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let _keep_alive = guard;
            let profile_label = if crate::extension_activation::is_legacy(
                &target.root,
                crate::extension_registry::package(&id).is_ok(),
            ) {
                catalog_host(&app)?
            } else {
                crate::browser_profile::owner_label(&app)?
            };
            let status = crate::extension_install::operate(
                app.clone(),
                profile_label.clone(),
                target.clone(),
                "status".into(),
                None,
            )?;
            if !status.enabled {
                return Err("Extension is disabled or no longer installed".into());
            }
            let runtime_id = std::fs::read_to_string(target.root.join("installed-id"))
                .map_err(|e| e.to_string())?;
            if !crate::extension_discovery::valid_store_id(&runtime_id) {
                return Err("Invalid runtime extension identifier".into());
            }
            let result = crate::extension_worker::click_action(&app, &profile_label, &runtime_id)?;
            if result.side_panel_requested {
                // Chrome would open the panel itself; the host does it instead.
                let manifest = manifest_at(&target.folder).unwrap_or(Value::Null);
                let path = result
                    .side_panel_path
                    .clone()
                    .or_else(|| page_path(&manifest, "side-panel").ok());
                if let Some(path) = path {
                    open_controls_page(
                        &app,
                        (&owner, &profile_label),
                        &format!("extension-ui-{id}-side-panel"),
                        &target,
                        &path,
                        true,
                    )?;
                }
            }
            Ok(result)
        })
        .await
        .map_err(|e| e.to_string())?
    }
}

#[tauri::command]
pub async fn extension_host_browse(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let url: tauri::Url = url.parse().map_err(|_| "Invalid website address")?;
    if !website_url(&url) {
        return Err("Only websites can be opened in the extension trial profile".into());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, url);
        Err("Browser extensions require Windows".into())
    }
    #[cfg(target_os = "windows")]
    tauri::async_runtime::spawn_blocking(move || {
        // Legacy installs still run in the trial profile; everything else is registered
        // with the browsing profile, which only runs extension code after the split.
        let legacy = crate::extension_activation::legacy_installs(&app)?;
        let profile = if legacy.is_empty() {
            if !crate::shell_isolation::split_committed() {
                return Err(crate::extension_activation::NEEDS_ISOLATION.into());
            }
            None
        } else {
            catalog_host(&app)?;
            Some(catalog_profile_directory(&app)?)
        };
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let nonce = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let mut builder = tauri::WebviewWindowBuilder::new(
            &app,
            format!("extension-trial-site-{nonce}"),
            tauri::WebviewUrl::External("about:blank".parse().unwrap()),
        )
        .title("Nebula · Extension trial")
        .inner_size(1100.0, 760.0)
        .browser_extensions_enabled(true);
        if let Some(profile) = profile {
            builder = builder.data_directory(profile);
        }
        let window = builder
            .on_navigation(|url| url.as_str() == "about:blank" || website_url(url))
            .build()
            .map_err(|e| e.to_string())?;
        if let Err(error) = popup_windows::attach(&app, &window, true) {
            let _ = window.destroy();
            return Err(error);
        }
        if let Err(error) = window.navigate(url) {
            let _ = window.destroy();
            return Err(error.to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

fn website_url(url: &tauri::Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| {
            let host = host.trim_end_matches('.');
            host != "tauri.localhost" && !host.ends_with(".tauri.localhost")
        })
        && url.username().is_empty()
        && url.password().is_none()
}

#[cfg(target_os = "windows")]
pub(crate) async fn unregister_all(app: &tauri::AppHandle) -> Result<(), String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog_label: Option<String> = None;
        for entry in crate::extension_discovery::DISCOVERY.iter() {
            let root = root_for(&app, &entry.id)?;
            if !root.join("installed-id").is_file() {
                // A prepared package that was waiting to start leaves nothing registered.
                crate::extension_activation::forget(&root);
                continue;
            }
            let guard = crate::extension_install::MutationGuard::acquire(&entry.id)?;
            close_controls(&app, &entry.id)?;
            let legacy = crate::extension_activation::is_legacy(
                &root,
                crate::extension_registry::package(&entry.id).is_ok(),
            );
            let label = if legacy {
                if catalog_label.is_none() {
                    catalog_label = Some(catalog_host(&app)?);
                }
                catalog_label.clone().unwrap_or_default()
            } else {
                crate::browser_profile::owner_label(&app)?
            };
            let forget_root = root.clone();
            crate::extension_install::operate(
                app.clone(),
                label,
                location(root, &entry.id)?,
                "remove".into(),
                Some(guard),
            )?;
            crate::extension_activation::forget(&forget_root);
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(not(target_os = "windows"))]
pub(crate) async fn unregister_all(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

pub(crate) async fn finish_factory_reset(app: &tauri::AppHandle) -> Result<(), String> {
    for (label, window) in app.webview_windows() {
        if label == "extension-catalog-host"
            || label.starts_with("extension-ui-")
            || label.starts_with("extension-auth-")
            || label.starts_with("extension-trial-site-")
        {
            window.destroy().map_err(|e| e.to_string())?;
        }
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let data = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        for path in [
            data.join("extensions"),
            data.join("extension-browsing-profile"),
        ] {
            if !path.exists() {
                continue;
            }
            let mut last = None;
            for _ in 0..20 {
                match std::fs::remove_dir_all(&path) {
                    Ok(()) => {
                        last = None;
                        break;
                    }
                    Err(error) => {
                        last = Some(error);
                        std::thread::sleep(std::time::Duration::from_millis(50));
                    }
                }
            }
            if let Some(error) = last {
                return Err(format!("Failed to remove extension data: {error}"));
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn corrupt_folder_pointers_keep_the_runtime_registration_manageable() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let id = crate::extension_discovery::DISCOVERY
            .iter()
            .find(|entry| crate::extension_registry::package(&entry.id).is_err())
            .unwrap()
            .id
            .clone();
        for pointer in ["../outside", "C:/outside", "not-a-digest", ""] {
            std::fs::write(root.join("installed-folder"), pointer).unwrap();
            let target = location(root.to_path_buf(), &id).unwrap();
            assert_eq!(target.root, root);
            assert_eq!(target.folder, root.join("uninstalled"));
        }
    }
    #[test]
    fn website_windows_cannot_navigate_into_app_routes_or_external_protocols() {
        for value in [
            "tauri://localhost",
            "https://tauri.localhost/",
            "http://tauri.localhost./",
            "https://sub.tauri.localhost/",
            "https://user:password@example.com/",
            "file:///C:/secret",
            "javascript:alert(1)",
        ] {
            assert!(!website_url(&value.parse().unwrap()), "{value}");
        }
        for value in [
            "https://example.com/login?state=fixture",
            "http://127.0.0.1:1234/",
            "https://test.chromiumapp.org/",
        ] {
            assert!(website_url(&value.parse().unwrap()), "{value}");
        }
    }
    #[test]
    fn controls_paths_stay_inside_the_extension_origin() {
        for value in [
            "../secret",
            "/absolute",
            "//evil.test/a",
            "https://evil.test",
            "a%2f..%2fb",
            "a\\b",
            "a/../b",
            "a?x=1",
            "a#b",
        ] {
            assert!(
                page_path(
                    &serde_json::json!({"action":{"default_popup":value}}),
                    "popup"
                )
                .is_err(),
                "{value}"
            );
        }
        assert_eq!(
            page_path(
                &serde_json::json!({"action":{"default_popup":"./ui/popup.html"}}),
                "popup"
            )
            .unwrap(),
            "ui/popup.html"
        );
        assert!(page_path(
            &serde_json::json!({"action":{"default_title":"Claude"}}),
            "popup"
        )
        .is_err());
        assert_eq!(
            page_path(
                &serde_json::json!({"options_page":"options.html"}),
                "options"
            )
            .unwrap(),
            "options.html"
        );
        assert_eq!(
            page_path(
                &serde_json::json!({"permissions":["sidePanel"]}),
                "side-panel"
            )
            .unwrap(),
            "sidepanel.html"
        );
        assert_eq!(
            page_path(
                &serde_json::json!({"side_panel":{"default_path":"ui/panel.html"}}),
                "side-panel"
            )
            .unwrap(),
            "ui/panel.html"
        );
    }
    #[test]
    fn reviewed_digest_cannot_be_a_path() {
        assert!(valid_digest(&"a".repeat(64)));
        for value in ["../package", "", &"A".repeat(64), &"g".repeat(64)] {
            assert!(!valid_digest(value));
        }
    }

    #[test]
    fn profile_runtime_is_derived_from_manifest_capabilities() {
        for manifest in [
            serde_json::json!({"background":{"service_worker":"worker.js"}}),
            serde_json::json!({"content_scripts":[{"matches":["https://example.com/*"],"js":["content.js"]}]}),
            serde_json::json!({"permissions":["declarativeNetRequest"]}),
        ] {
            assert!(runs_in_profile(&manifest));
        }
        assert!(!runs_in_profile(&serde_json::json!({
            "action":{"default_popup":"popup.html"}
        })));
    }

    #[test]
    fn toolbar_icon_uses_the_largest_safe_manifest_asset() {
        let manifest = serde_json::json!({
            "action":{"default_icon":{"16":"icons/16.png","128":"icons/128.png"}},
            "icons":{"256":"icons/fallback.png"}
        });
        assert_eq!(icon_path(&manifest), Some("icons/128.png"));
        assert_eq!(
            icon_path(&serde_json::json!({"icons":{"128":"../outside.png"}})),
            None
        );
        assert_eq!(
            icon_path(
                &serde_json::json!({"action":{"default_icon":"../outside.png"},"icons":{"128":"fallback.png"}})
            ),
            Some("fallback.png")
        );
    }

    #[test]
    fn controls_require_existing_packaged_files_and_icons_have_a_read_limit() {
        let directory = tempfile::tempdir().unwrap();
        let manifest =
            serde_json::json!({"action":{"default_popup":"popup.html"},"icons":{"128":"icon.png"}});
        assert!(!has_controls_page(directory.path(), &manifest, "popup"));
        std::fs::write(directory.path().join("popup.html"), "<body>fixture</body>").unwrap();
        assert!(has_controls_page(directory.path(), &manifest, "popup"));
        let icon = directory.path().join("icon.png");
        std::fs::write(&icon, [1, 2, 3]).unwrap();
        assert!(icon_data_url(directory.path(), &manifest)
            .unwrap()
            .starts_with("data:image/png;base64,"));
        let file = std::fs::File::create(icon).unwrap();
        file.set_len(512 * 1024 + 1).unwrap();
        assert!(icon_data_url(directory.path(), &manifest).is_none());
    }
}
