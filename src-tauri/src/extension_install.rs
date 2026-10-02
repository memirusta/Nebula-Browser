use crate::extension_registry::{package, ExtensionPackage};
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::{
    collections::HashSet,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    sync::{Arc, LazyLock, Mutex},
    time::Duration,
};
use tauri::Manager;

static MUTATING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(|| Mutex::new(HashSet::new()));
pub(crate) struct MutationGuard(String);
impl MutationGuard {
    pub(crate) fn acquire(id: &str) -> Result<Arc<Self>, String> {
        let mut active = MUTATING
            .lock()
            .map_err(|_| "Extension operation lock unavailable")?;
        if !active.insert(id.to_string()) {
            return Err("An operation for this extension is already running".into());
        }
        Ok(Arc::new(Self(id.to_string())))
    }
}
impl Drop for MutationGuard {
    fn drop(&mut self) {
        if let Ok(mut active) = MUTATING.lock() {
            active.remove(&self.0);
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct ExtensionStatus {
    pub(crate) installed: bool,
    pub(crate) enabled: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DownloadCompatibility {
    pub runtime_version: String,
    pub manifest: serde_json::Value,
    pub load_test: &'static str,
    pub functionality_test: &'static str,
    pub source: &'static str,
    pub source_id: String,
    pub sha256: String,
}

struct ProbeEvidence {
    manifest: serde_json::Value,
    source: &'static str,
    source_id: String,
    sha256: String,
}

type ArchiveEntries = Vec<(PathBuf, Vec<u8>)>;

fn verify_existing_directory(target: &Path, entries: &ArchiveEntries) -> Result<(), String> {
    let mut expected = entries
        .iter()
        .map(|(path, content)| (path.clone(), content))
        .collect::<std::collections::HashMap<_, _>>();
    let mut directories = vec![target.to_path_buf()];
    while let Some(directory) = directories.pop() {
        for item in std::fs::read_dir(&directory).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let file_type = item.file_type().map_err(|e| e.to_string())?;
            if file_type.is_symlink() {
                return Err("Cached extension files were modified".into());
            }
            if file_type.is_dir() {
                directories.push(item.path());
                continue;
            }
            if !file_type.is_file() {
                return Err("Cached extension files were modified".into());
            }
            let relative = item
                .path()
                .strip_prefix(target)
                .map_err(|_| "Invalid cached extension path")?
                .to_path_buf();
            let content = expected
                .remove(&relative)
                .ok_or("Cached extension files were modified")?;
            let mut current = Vec::new();
            std::fs::File::open(item.path())
                .map_err(|e| e.to_string())?
                .take(content.len() as u64 + 1)
                .read_to_end(&mut current)
                .map_err(|e| e.to_string())?;
            if current != *content {
                return Err("Cached extension files were modified".into());
            }
        }
    }
    if !expected.is_empty() {
        return Err("Cached extension files were modified".into());
    }
    Ok(())
}

#[derive(Clone)]
pub(crate) struct InstallationLocation {
    pub(crate) root: PathBuf,
    pub(crate) folder: PathBuf,
}

impl InstallationLocation {
    pub(crate) fn registered(root: PathBuf, package: &ExtensionPackage) -> Self {
        let folder = root.join(&package.version);
        Self { root, folder }
    }
}

fn clear_installation_records(root: &Path, expected: &str) -> Result<ExtensionStatus, String> {
    match std::fs::read_to_string(root.join("installed-id")) {
        Ok(current) if current != expected => {
            return Err("Installation record changed during removal; refresh its status".into());
        }
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            return Err(format!("Could not read installation record: {error}"));
        }
        _ => {}
    }
    // Keep verified package caches for a later reinstall. Remove the folder
    // pointer first so a failure retains the ID needed to retry cleanup.
    for name in ["installed-folder", "installed-id"] {
        if let Err(error) = std::fs::remove_file(root.join(name)) {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(format!("Extension was removed but its installation record could not be cleared: {error}"));
            }
        }
    }
    Ok(ExtensionStatus::default())
}

/// Called only on a worker thread, with registry-authenticated bytes.
#[cfg(target_os = "windows")]
pub(crate) fn probe_download(
    app: tauri::AppHandle,
    package: &'static ExtensionPackage,
    bytes: &[u8],
) -> Result<DownloadCompatibility, String> {
    let directory = Arc::new(tempfile::tempdir().map_err(|e| e.to_string())?);
    let root = directory.path().join("extension");
    let folder = prepare_directory(package, &root, bytes)?;
    let manifest: serde_json::Value = serde_json::from_slice(
        &std::fs::read(folder.join("manifest.json")).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    let target = InstallationLocation { root, folder };
    probe_prepared_download(
        app,
        target,
        ProbeEvidence {
            manifest,
            source: "registered-package",
            source_id: package.id.clone(),
            sha256: package.sha256.clone(),
        },
        directory,
    )
}

/// Runs a load/enable/list/remove round-trip in an isolated profile. The
/// target directory always belongs to a temporary directory owned by this call.
#[cfg(target_os = "windows")]
fn probe_prepared_download(
    app: tauri::AppHandle,
    target: InstallationLocation,
    evidence: ProbeEvidence,
    directory: Arc<tempfile::TempDir>,
) -> Result<DownloadCompatibility, String> {
    // Both package sources share this namespace, including concurrent downloads.
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT_PROBE: AtomicU64 = AtomicU64::new(1);
    let nonce = NEXT_PROBE.fetch_add(1, Ordering::Relaxed);
    let ProbeEvidence {
        manifest,
        source,
        source_id,
        sha256,
    } = evidence;
    let label = format!("extension-probe-{nonce}");
    let mut guard = ProbeWindow {
        app: app.clone(),
        label: label.clone(),
        directory: Some(directory.clone()),
    };
    let handle = app.clone();
    let test_label = label.clone();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.run_on_main_thread(move || {
        let result = tauri::WebviewWindowBuilder::new(
            &handle,
            &test_label,
            tauri::WebviewUrl::External("about:blank".parse().expect("valid blank URL")),
        )
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .data_directory(directory.path().join("profile"))
        .browser_extensions_enabled(true)
        .on_navigation(|url| url.as_str() == "about:blank")
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()
        .map_err(|e| e.to_string());
        if let Ok(window) = &result {
            // Keep profile/package files alive until the native window is gone,
            // including a late creation callback after the caller timed out.
            window.on_window_event(move |_| {
                let _keep_alive = &directory;
            });
        }
        match result {
            Ok(window) => {
                if tx.send(Ok(())).is_err() {
                    let _ = window.destroy();
                }
            }
            Err(error) => {
                let _ = tx.send(Err(error));
            }
        }
    })
    .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(30))
        .map_err(|_| "Compatibility window timed out".to_string())??;
    let outcome = (|| {
        let runtime = crate::extension_runtime::read_version(app.clone(), &label)?;
        crate::extension_compatibility::validate_minimum_runtime(&manifest, &runtime)?;
        let loaded = operate(
            app.clone(),
            label.clone(),
            target.clone(),
            "install".into(),
            None,
        )?;
        if !loaded.installed || !loaded.enabled {
            return Err("Extension did not enable in the test profile".into());
        }
        let found = operate(
            app.clone(),
            label.clone(),
            target.clone(),
            "status".into(),
            None,
        )?;
        if !found.installed || !found.enabled {
            return Err("Extension load could not be confirmed".into());
        }
        operate(
            app.clone(),
            label.clone(),
            target.clone(),
            "remove".into(),
            None,
        )?;
        if operate(app, label, target, "status".into(), None)?.installed {
            return Err("Extension removal from the test profile failed".into());
        }
        Ok(DownloadCompatibility {
            runtime_version: runtime,
            manifest,
            load_test: "passed",
            functionality_test: "not-run",
            source,
            source_id,
            sha256,
        })
    })();
    guard.close()?;
    outcome
}

#[cfg(target_os = "windows")]
struct ProbeWindow {
    app: tauri::AppHandle,
    label: String,
    directory: Option<Arc<tempfile::TempDir>>,
}

#[cfg(target_os = "windows")]
impl ProbeWindow {
    fn close(&mut self) -> Result<(), String> {
        let Some(directory) = self.directory.take() else {
            return Ok(());
        };
        let app = self.app.clone();
        let label = self.label.clone();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        self.app
            .run_on_main_thread(move || {
                let result = app
                    .get_webview_window(&label)
                    .map_or(Ok(()), |window| window.destroy().map_err(|e| e.to_string()));
                drop(directory);
                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|_| "Compatibility window cleanup timed out".to_string())?
    }
}

#[cfg(target_os = "windows")]
impl Drop for ProbeWindow {
    fn drop(&mut self) {
        let _ = self.close();
    }
}

fn archive_entries(bytes: &[u8]) -> Result<ArchiveEntries, String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    if archive.len() > 5000 {
        return Err("Too many extension files".into());
    }
    let mut remaining = 256 * 1024 * 1024u64;
    let mut entries = Vec::new();
    for index in 0..archive.len() {
        let file = archive.by_index(index).map_err(|e| e.to_string())?;
        let path = file.enclosed_name().ok_or("Unsafe extension path")?;
        if file.name().contains(['\\', ':'])
            || path
                .components()
                .any(|c| !matches!(c, Component::Normal(_)))
            || file
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("Unsafe extension path".into());
        }
        if file.is_dir() {
            continue;
        }
        if file.size() > remaining {
            return Err("Extension expands beyond its limit".into());
        }
        let mut content = Vec::new();
        file.take(remaining + 1)
            .read_to_end(&mut content)
            .map_err(|e| e.to_string())?;
        remaining = remaining
            .checked_sub(content.len() as u64)
            .ok_or("Extension expands beyond its limit")?;
        entries.push((path, content));
    }
    Ok(entries)
}

fn archive_manifest(entries: &ArchiveEntries) -> Result<serde_json::Value, String> {
    let manifest = entries
        .iter()
        .find(|(path, _)| path == Path::new("manifest.json"))
        .ok_or("Missing extension manifest")?;
    serde_json::from_slice(&manifest.1).map_err(|e| e.to_string())
}

fn package_entries(package: &ExtensionPackage, bytes: &[u8]) -> Result<ArchiveEntries, String> {
    let entries = archive_entries(bytes)?;
    let value = archive_manifest(&entries)?;
    if value["manifest_version"] != 3
        || value["version"] != package.version
        || value[&package.manifest_name_field] != package.manifest_name
        || value["host_permissions"] != serde_json::json!(package.access)
    {
        return Err("Unexpected extension manifest".into());
    }
    crate::extension_compatibility::validate_manifest_files(&value, &entries)?;
    Ok(entries)
}

fn prepare_directory(
    package: &ExtensionPackage,
    root: &Path,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    crate::extension_download::verify_package(package, bytes)?;
    let entries = package_entries(package, bytes)?;
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let target = root.join(&package.version);
    if target.exists() {
        // Never rewrite files of a registered WebView2 extension.
        verify_existing_directory(&target, &entries)?;
    } else {
        let staging = tempfile::tempdir_in(root).map_err(|e| e.to_string())?;
        for (path, content) in entries {
            let target = staging.path().join(path);
            std::fs::create_dir_all(target.parent().ok_or("Invalid extension path")?)
                .map_err(|e| e.to_string())?;
            std::fs::write(target, content).map_err(|e| e.to_string())?;
        }
        std::fs::rename(staging.path(), &target).map_err(|e| e.to_string())?;
    }
    // Keep the verified archive for subsequent installs without another download.
    let cache = root.join("package.zip");
    if !cache.exists() {
        std::fs::write(cache, bytes).map_err(|e| e.to_string())?;
    }
    target.canonicalize().map_err(|e| e.to_string())
}

pub(crate) fn discovery_entries(
    bytes: &[u8],
    expected_store_id: &str,
) -> Result<(ArchiveEntries, serde_json::Value), String> {
    let entries = archive_entries(bytes)?;
    let manifest = archive_manifest(&entries)?;
    crate::extension_compatibility::validate_manifest_files(&manifest, &entries)?;
    if manifest["manifest_version"] != 3 {
        return Err("Only Manifest V3 Chrome Web Store packages are supported".into());
    }
    if let Some(key) = manifest.get("key") {
        use base64::Engine as _;
        let key = key.as_str().ok_or("Invalid extension manifest key")?;
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(key)
            .map_err(|_| "Invalid extension manifest key")?;
        let digest = sha2::Sha256::digest(decoded);
        let id: String = digest[..16]
            .iter()
            .flat_map(|byte| {
                [
                    char::from(b'a' + (byte >> 4)),
                    char::from(b'a' + (byte & 0x0f)),
                ]
            })
            .collect();
        if id != expected_store_id {
            return Err("Manifest key identity does not match the Chrome Web Store entry".into());
        }
    }
    // Chrome behaviour WebView2 lacks (see extension_compat). Applied here so the
    // isolated load check, the cached folder and the registration all see the same
    // bytes, and re-validated because the manifest changed.
    let (entries, manifest) = crate::extension_compat::apply(entries, &manifest)?;
    crate::extension_compatibility::validate_manifest_files(&manifest, &entries)?;
    Ok((entries, manifest))
}

pub(crate) fn prepare_discovery_directory(
    root: &Path,
    version: &str,
    entries: ArchiveEntries,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let target = root.join(version);
    if target.exists() {
        // Never mutate a folder registered with WebView2. Reuse only exact bytes.
        verify_existing_directory(&target, &entries)?;
        return target.canonicalize().map_err(|e| e.to_string());
    }
    let staging = tempfile::tempdir_in(root).map_err(|e| e.to_string())?;
    for (path, content) in entries {
        let target = staging.path().join(path);
        std::fs::create_dir_all(target.parent().ok_or("Invalid extension path")?)
            .map_err(|e| e.to_string())?;
        std::fs::write(target, content).map_err(|e| e.to_string())?;
    }
    std::fs::rename(staging.path(), &target).map_err(|e| e.to_string())?;
    target.canonicalize().map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
pub(crate) fn probe_discovery_download(
    app: tauri::AppHandle,
    store_id: String,
    bytes: &[u8],
    sha256: String,
) -> Result<DownloadCompatibility, String> {
    let directory = Arc::new(tempfile::tempdir().map_err(|e| e.to_string())?);
    let root = directory.path().join("extension");
    let (entries, manifest) = discovery_entries(bytes, &store_id)?;
    let version = manifest["version"]
        .as_str()
        .ok_or("Missing extension version")?;
    let folder = prepare_discovery_directory(&root, version, entries)?;
    let target = InstallationLocation { root, folder };
    probe_prepared_download(
        app,
        target,
        ProbeEvidence {
            manifest,
            source: "chrome-web-store-crx",
            source_id: store_id,
            sha256,
        },
        directory,
    )
}

fn read_package(package: &ExtensionPackage, path: &Path) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .ok()?
        .take(10 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    crate::extension_download::verify_package(package, &bytes).ok()?;
    Some(bytes)
}

#[cfg(target_os = "windows")]
pub(crate) fn enumerate(
    app: tauri::AppHandle,
    label: String,
) -> Result<std::collections::HashMap<String, bool>, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Profile7, ICoreWebView2_13};
    use webview2_com::ProfileGetBrowserExtensionsCompletedHandler;
    use windows_core::{Interface, BOOL, PWSTR};
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    app.get_webview(&label)
        .ok_or("Browser window unavailable")?
        .with_webview(move |inner| unsafe {
            let failure = tx.clone();
            let result = (|| -> windows_core::Result<()> {
                let profile = inner
                    .controller()
                    .CoreWebView2()?
                    .cast::<ICoreWebView2_13>()?
                    .Profile()?
                    .cast::<ICoreWebView2Profile7>()?;
                profile.GetBrowserExtensions(&ProfileGetBrowserExtensionsCompletedHandler::create(
                    Box::new(move |result, extensions| {
                        let result = (|| -> Result<_, String> {
                            result.map_err(|e| e.to_string())?;
                            let extensions =
                                extensions.ok_or("Extension enumeration unavailable")?;
                            let mut count = 0;
                            extensions.Count(&mut count).map_err(|e| e.to_string())?;
                            let mut values = std::collections::HashMap::new();
                            for index in 0..count {
                                let extension = extensions
                                    .GetValueAtIndex(index)
                                    .map_err(|e| e.to_string())?;
                                let mut id = PWSTR::null();
                                let id_result = extension.Id(&mut id);
                                let value = id.to_string().unwrap_or_default();
                                if !id.is_null() {
                                    windows::Win32::System::Com::CoTaskMemFree(Some(
                                        id.as_ptr().cast(),
                                    ));
                                }
                                id_result.map_err(|e| e.to_string())?;
                                let mut enabled = BOOL::default();
                                extension
                                    .IsEnabled(&mut enabled)
                                    .map_err(|e| e.to_string())?;
                                if !value.is_empty() {
                                    values.insert(value, enabled.as_bool());
                                }
                            }
                            Ok(values)
                        })();
                        let _ = tx.send(result);
                        Ok(())
                    }),
                ))
            })();
            if let Err(error) = result {
                let _ = failure.send(Err(error.to_string()));
            }
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(30))
        .map_err(|_| "Extension enumeration timed out".to_string())?
}

#[cfg(target_os = "windows")]
pub(crate) fn operate(
    app: tauri::AppHandle,
    label: String,
    target: InstallationLocation,
    action: String,
    guard: Option<Arc<MutationGuard>>,
) -> Result<ExtensionStatus, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2BrowserExtension, ICoreWebView2Profile7, ICoreWebView2_13,
    };
    use webview2_com::{
        BrowserExtensionEnableCompletedHandler, BrowserExtensionRemoveCompletedHandler,
        ProfileAddBrowserExtensionCompletedHandler, ProfileGetBrowserExtensionsCompletedHandler,
    };
    use windows_core::{Interface, BOOL, HSTRING, PWSTR};
    let marker = target.root.join("installed-id");
    let expected = std::fs::read_to_string(&marker).unwrap_or_default();
    let webview = app
        .get_webview(&label)
        .ok_or("Browser window unavailable")?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    webview.with_webview(move |inner| unsafe {
        let failure = tx.clone();
        let result = (|| -> windows_core::Result<()> {
            let profile = inner.controller().CoreWebView2()?.cast::<ICoreWebView2_13>()?.Profile()?.cast::<ICoreWebView2Profile7>()?;
            if action == "install" {
                let folder = target.folder.clone();
                profile.AddBrowserExtension(&HSTRING::from(folder.as_path()), &ProfileAddBrowserExtensionCompletedHandler::create(Box::new(move |result, extension| {
                    let _keep_alive = &guard;
                    let registered = result.is_ok();
                    let outcome = (|| -> Result<ICoreWebView2BrowserExtension, String> {
                        result.map_err(|e| e.to_string())?;
                        let extension = extension.clone().ok_or("WebView2 returned no extension")?;
                        let mut id = PWSTR::null();
                        let id_result = extension.Id(&mut id);
                        let value = id.to_string().unwrap_or_default();
                        if !id.is_null() { windows::Win32::System::Com::CoTaskMemFree(Some(id.as_ptr().cast())); }
                        id_result.map_err(|e| e.to_string())?;
                        if !crate::extension_discovery::valid_store_id(&value) { return Err("Invalid runtime extension ID".into()); }
                        if value == expected { return Ok(extension); }
                        // The Chrome Web Store identity was already checked in
                        // the CRX3 header. WebView2 receives an unpacked folder
                        // and assigns that copy a separate runtime identifier.
                        // Persist identity even if enabling fails, so the user can remove it.
                        let mut temporary = tempfile::NamedTempFile::new_in(marker.parent().ok_or("Invalid marker directory")?).map_err(|e| e.to_string())?;
                        std::io::Write::write_all(&mut temporary, value.as_bytes()).map_err(|e| e.to_string())?;
                        temporary.as_file().sync_all().map_err(|e| e.to_string())?;
                        temporary.persist(&marker).map_err(|e| e.to_string())?;
                        Ok(extension)
                    })();
                    match outcome {
                        Err(error) => {
                            // AddBrowserExtension can succeed before persisting
                            // the ID fails. Roll that registration back instead
                            // of leaving invisible, unmanageable extension code.
                            if let Some(extension) = extension.filter(|_| registered) {
                                let completed = tx.clone();
                                let completion_guard = guard.clone();
                                let original_error = error.clone();
                                let handler = BrowserExtensionRemoveCompletedHandler::create(Box::new(move |result| {
                                    let _keep_alive = &completion_guard;
                                    let message = match result {
                                        Ok(()) => format!("{original_error}; installation rolled back"),
                                        Err(rollback) => format!("{original_error}; registration rollback failed: {rollback}"),
                                    };
                                    let _ = completed.send(Err(message));
                                    Ok(())
                                }));
                                if let Err(rollback) = extension.Remove(&handler) {
                                    let _ = tx.send(Err(format!("{error}; registration rollback failed: {rollback}")));
                                }
                            } else { let _ = tx.send(Err(error)); }
                        }
                        Ok(extension) => {
                            let completed = tx.clone();
                            let check = extension.clone();
                            let completion_guard = guard.clone();
                            let handler = BrowserExtensionEnableCompletedHandler::create(Box::new(move |result| {
                                let _keep_alive = &completion_guard;
                                let mut enabled = BOOL::default();
                                let status = result.and_then(|_| check.IsEnabled(&mut enabled)).map(|_| ExtensionStatus { installed: true, enabled: enabled.as_bool() }).map_err(|e| e.to_string());
                                let _ = completed.send(status);
                                Ok(())
                            }));
                            if let Err(error) = extension.Enable(true, &handler) { let _ = tx.send(Err(error.to_string())); }
                        }
                    }
                    Ok(())
                })))
            } else {
                profile.GetBrowserExtensions(&ProfileGetBrowserExtensionsCompletedHandler::create(Box::new(move |result, extensions| {
                    let _keep_alive = &guard;
                    let outcome = (|| -> Result<Option<ICoreWebView2BrowserExtension>, String> {
                        result.map_err(|e| e.to_string())?;
                        let extensions = extensions.ok_or("Extension enumeration unavailable")?;
                        let mut count = 0;
                        extensions.Count(&mut count).map_err(|e| e.to_string())?;
                        for index in 0..count {
                            let extension = extensions.GetValueAtIndex(index).map_err(|e| e.to_string())?;
                            let mut id = PWSTR::null();
                            let id_result = extension.Id(&mut id);
                            let value = id.to_string().unwrap_or_default();
                            if !id.is_null() { windows::Win32::System::Com::CoTaskMemFree(Some(id.as_ptr().cast())); }
                            id_result.map_err(|e| e.to_string())?;
                            if !expected.is_empty() && value == expected { return Ok(Some(extension)); }
                        }
                        Ok(None)
                    })();
                    match outcome {
                        Err(error) => { let _ = tx.send(Err(error)); }
                        Ok(None) => {
                            let status = if action == "remove" { clear_installation_records(&target.root, &expected) } else { Ok(ExtensionStatus::default()) };
                            let _ = tx.send(status);
                        }
                        Ok(Some(extension)) if action == "remove" => {
                            let completed = tx.clone();
                            let completion_guard = guard.clone();
                            let handler = BrowserExtensionRemoveCompletedHandler::create(Box::new(move |result| {
                                let _keep_alive = &completion_guard;
                                let status = result.map_err(|e| e.to_string()).and_then(|_| clear_installation_records(&target.root, &expected));
                                let _ = completed.send(status);
                                Ok(())
                            }));
                            if let Err(error) = extension.Remove(&handler) { let _ = tx.send(Err(error.to_string())); }
                        }
                        Ok(Some(extension)) if action == "enable" || action == "disable" => {
                            let completed = tx.clone();
                            let check = extension.clone();
                            let completion_guard = guard.clone();
                            let handler = BrowserExtensionEnableCompletedHandler::create(Box::new(move |result| {
                                let _keep_alive = &completion_guard;
                                let mut enabled = BOOL::default();
                                let status = result.and_then(|_| check.IsEnabled(&mut enabled)).map(|_| ExtensionStatus { installed: true, enabled: enabled.as_bool() }).map_err(|e| e.to_string());
                                let _ = completed.send(status);
                                Ok(())
                            }));
                            if let Err(error) = extension.Enable(action == "enable", &handler) { let _ = tx.send(Err(error.to_string())); }
                        }
                        Ok(Some(extension)) => {
                            let mut enabled = BOOL::default();
                            let result = extension.IsEnabled(&mut enabled).map(|_| ExtensionStatus { installed: true, enabled: enabled.as_bool() }).map_err(|e| e.to_string());
                            let _ = tx.send(result);
                        }
                    }
                    Ok(())
                })))
            }
        })();
        if let Err(error) = result { let _ = failure.send(Err(error.to_string())); }
    }).map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(30))
        .map_err(|_| "Extension operation timed out; check its status again".to_string())?
}

#[tauri::command]
pub async fn extension_package_manage(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    action: String,
    id: String,
    expected_sha256: Option<String>,
) -> Result<ExtensionStatus, String> {
    if package(&id).is_err() {
        return crate::extension_host::manage_discovery(app, webview, action, id, expected_sha256)
            .await;
    }
    let package = package(&id)?;
    if !matches!(
        action.as_str(),
        "status" | "install" | "remove" | "enable" | "disable"
    ) {
        return Err("Unknown extension action".into());
    }
    let guard = if action != "status" {
        Some(MutationGuard::acquire(&id)?)
    } else {
        None
    };
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("extensions")
        .join(&package.id);
    if action == "status" && !root.join("installed-id").is_file() {
        return Ok(ExtensionStatus::default());
    }
    if matches!(action.as_str(), "disable" | "remove") {
        crate::extension_host::close_controls(&app, &id)?;
    }
    if action == "install" {
        let cached = read_package(package, &root.join("package.zip")).or_else(|| {
            app.path()
                .download_dir()
                .ok()
                .and_then(|dir| read_package(package, &dir.join(package.filename())))
        });
        let bytes = match cached {
            Some(bytes) => bytes,
            None => crate::extension_download::fetch_package(package).await?,
        };
        let cache_root = root.clone();
        #[cfg(target_os = "windows")]
        let probe_app = app.clone();
        #[cfg(target_os = "windows")]
        let runtime = {
            let handle = app.clone();
            let label = crate::browser_profile::owner_label(&app)?;
            tauri::async_runtime::spawn_blocking(move || {
                crate::extension_runtime::read_version(handle, &label)
            })
            .await
            .map_err(|e| e.to_string())??
        };
        tauri::async_runtime::spawn_blocking(move || {
            #[cfg(target_os = "windows")]
            {
                crate::extension_download::verify_package(package, &bytes)?;
                let entries = package_entries(package, &bytes)?;
                let manifest = entries
                    .iter()
                    .find(|(path, _)| path == Path::new("manifest.json"))
                    .ok_or("Missing manifest")?;
                let manifest = serde_json::from_slice(&manifest.1).map_err(|e| e.to_string())?;
                crate::extension_compatibility::validate_minimum_runtime(&manifest, &runtime)?;
                // Installing directly also downloads packages; it must not
                // bypass the isolated compatibility test used by Download.
                probe_download(probe_app, package, &bytes)?;
            }
            prepare_directory(package, &cache_root, &bytes)
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    // The browser profile's owner, never the shell window that called and never a
    // selected private tab's profile.
    #[cfg(target_os = "windows")]
    let label = crate::browser_profile::owner_label(&app)?;
    #[cfg(not(target_os = "windows"))]
    let label = String::new();
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(move || {
        operate(
            app,
            label,
            InstallationLocation::registered(root, package),
            action,
            guard,
        )
    })
    .await
    .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label, root, guard);
        Err("Browser extensions require Windows".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn removal_clears_registration_pointers_but_preserves_verified_cache() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::write(root.join("installed-id"), "runtime-id").unwrap();
        std::fs::write(root.join("installed-folder"), "digest").unwrap();
        std::fs::write(root.join("package.zip"), "cached bytes").unwrap();
        assert!(
            !clear_installation_records(root, "runtime-id")
                .unwrap()
                .installed
        );
        assert!(!root.join("installed-id").exists());
        assert!(!root.join("installed-folder").exists());
        assert_eq!(
            std::fs::read(root.join("package.zip")).unwrap(),
            b"cached bytes"
        );
        assert!(!clear_installation_records(root, "").unwrap().installed);
    }

    #[test]
    fn removal_never_erases_a_newer_installation_record() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::write(root.join("installed-id"), "new-runtime-id").unwrap();
        std::fs::write(root.join("installed-folder"), "new-digest").unwrap();
        assert!(clear_installation_records(root, "old-runtime-id").is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("installed-id")).unwrap(),
            "new-runtime-id"
        );
        assert_eq!(
            std::fs::read_to_string(root.join("installed-folder")).unwrap(),
            "new-digest"
        );
    }

    #[test]
    fn failed_record_cleanup_keeps_identity_for_retry() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::write(root.join("installed-id"), "runtime-id").unwrap();
        std::fs::create_dir(root.join("installed-folder")).unwrap();
        assert!(clear_installation_records(root, "runtime-id").is_err());
        assert_eq!(
            std::fs::read_to_string(root.join("installed-id")).unwrap(),
            "runtime-id"
        );
    }

    fn archive(path: &str) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file(path, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(br#"{"manifest_version":3,"name":"SponsorBlock","version":"6.1.7","short_name":"SponsorBlock","host_permissions":["https://*.youtube.com/*","https://sponsor.ajay.app/*"]}"#)
            .unwrap();
        zip.finish().unwrap().into_inner()
    }

    #[test]
    fn archive_paths_cannot_escape_installation_directory() {
        for path in [
            "../manifest.json",
            "/manifest.json",
            "C:/manifest.json",
            "dir\\manifest.json",
            "manifest.json:stream",
        ] {
            assert!(
                package_entries(package("sponsorblock").unwrap(), &archive(path)).is_err(),
                "{path}"
            );
        }
        assert_eq!(
            package_entries(package("sponsorblock").unwrap(), &archive("manifest.json"))
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn unverified_archive_never_creates_installation_directory() {
        let parent = tempfile::tempdir().unwrap();
        let root = parent.path().join("extension");
        assert!(prepare_directory(
            package("sponsorblock").unwrap(),
            &root,
            &archive("manifest.json")
        )
        .is_err());
        assert!(!root.exists());
    }

    #[test]
    #[ignore = "Requires the official package downloaded by the network smoke test"]
    fn official_package_extracts_and_detects_cache_modification() {
        let package_path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/extension-download-smoke/SponsorBlock-6.1.7.zip");
        let bytes = std::fs::read(package_path).unwrap();
        let root = tempfile::tempdir().unwrap();
        let target =
            prepare_directory(package("sponsorblock").unwrap(), root.path(), &bytes).unwrap();
        assert!(target.join("js/content.js").is_file());
        assert_eq!(
            prepare_directory(package("sponsorblock").unwrap(), root.path(), &bytes).unwrap(),
            target
        );
        std::fs::write(target.join("js/content.js"), "modified").unwrap();
        assert!(prepare_directory(package("sponsorblock").unwrap(), root.path(), &bytes).is_err());
        std::fs::remove_dir_all(&target).unwrap();
        let target =
            prepare_directory(package("sponsorblock").unwrap(), root.path(), &bytes).unwrap();
        std::fs::write(target.join("unexpected.js"), "extra").unwrap();
        assert!(prepare_directory(package("sponsorblock").unwrap(), root.path(), &bytes).is_err());
    }

    #[test]
    fn independent_extensions_do_not_share_a_mutation_lock() {
        let first = MutationGuard::acquire("test-one").unwrap();
        assert!(MutationGuard::acquire("test-one").is_err());
        let other = MutationGuard::acquire("test-two").unwrap();
        drop(first);
        assert!(MutationGuard::acquire("test-one").is_ok());
        drop(other);
    }

    #[test]
    fn another_extensions_manifest_is_rejected() {
        assert!(
            package_entries(package("dark-reader").unwrap(), &archive("manifest.json")).is_err()
        );
    }

    #[test]
    #[ignore = "Requires locally cached registry packages; exports manifests without executing extension code"]
    fn cached_registry_compatibility_report() {
        let target = Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
        let mut reports = Vec::new();
        for package in crate::extension_registry::PACKAGES.iter() {
            let bytes = std::fs::read(
                target
                    .join("extension-download-smoke")
                    .join(package.filename()),
            )
            .unwrap();
            crate::extension_download::verify_package(package, &bytes).unwrap();
            let entries = package_entries(package, &bytes).unwrap();
            let manifest = entries
                .iter()
                .find(|(path, _)| path == Path::new("manifest.json"))
                .unwrap();
            let manifest: serde_json::Value = serde_json::from_slice(&manifest.1).unwrap();
            reports.push(serde_json::json!({"id": package.id, "version": package.version, "sha256": package.sha256,
                "packageIntegrity": "passed", "manifestFiles": "passed", "manifest": manifest}));
        }
        let output = target.join("extension-compatibility");
        std::fs::create_dir_all(&output).unwrap();
        std::fs::write(
            output.join("packages.json"),
            serde_json::to_vec_pretty(&reports).unwrap(),
        )
        .unwrap();
        println!(
            "Validated {} cached package manifests and resources",
            reports.len()
        );
    }

    #[cfg(all(target_os = "windows", feature = "extension-native-smoke"))]
    fn test_script(app: &tauri::AppHandle, script: &str) -> Result<String, String> {
        test_script_at(app, "extension-test", script)
    }

    #[cfg(all(target_os = "windows", feature = "extension-native-smoke"))]
    fn test_script_at(app: &tauri::AppHandle, label: &str, script: &str) -> Result<String, String> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let script = script.to_string();
        app.get_webview(label)
            .ok_or("Missing test webview")?
            .with_webview(move |inner| unsafe {
                let failure = tx.clone();
                let handler = webview2_com::ExecuteScriptCompletedHandler::create(Box::new(
                    move |result, value| {
                        let _ = tx.send(result.map(|_| value).map_err(|e| e.to_string()));
                        Ok(())
                    },
                ));
                let script = windows_core::HSTRING::from(script);
                let result = inner
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.ExecuteScript(&script, &handler));
                if let Err(error) = result {
                    let _ = failure.send(Err(error.to_string()));
                }
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(5))
            .map_err(|e| e.to_string())?
    }

    #[cfg(all(target_os = "windows", feature = "extension-native-smoke"))]
    fn common_host_probe(app: &tauri::AppHandle, root: &Path) -> Result<serde_json::Value, String> {
        let manifest = serde_json::json!({
            "manifest_version":3,"name":"Nebula owned host fixture","version":"1.0.0",
            "permissions":["storage","tabs"],"host_permissions":["http://127.0.0.1/*"],
            "background":{"service_worker":"worker.js"},"action":{"default_popup":"popup.html"},
            "options_ui":{"page":"popup.html"},
            "content_scripts":[{"matches":["http://127.0.0.1/*"],"js":["content.js"]}]
        });
        let entries = vec![
            (PathBuf::from("manifest.json"), serde_json::to_vec(&manifest).unwrap()),
            (PathBuf::from("popup.html"), br#"<!doctype html><title>Host fixture</title><script src="popup.js"></script><body>Host fixture</body>"#.to_vec()),
            (PathBuf::from("popup.js"), br#"chrome.runtime.sendMessage('host-probe').then(result => { globalThis.__hostProbe = {origin:location.origin, runtimeId:chrome.runtime.id, ...result}; }).catch(error => {globalThis.__hostProbe={error:String(error)}});"#.to_vec()),
            (PathBuf::from("worker.js"), br#"chrome.runtime.onMessage.addListener((message, sender, reply) => { if(message!=='host-probe')return; (async()=>{await chrome.storage.local.set({probe:'stored'}); return {worker:'replied',storage:await chrome.storage.local.get('probe'),tabs:await chrome.tabs.query({}),activeTabs:await chrome.tabs.query({active:true,lastFocusedWindow:true})};})().then(reply,error=>reply({error:String(error)})); return true; });"#.to_vec()),
            (PathBuf::from("content.js"), b"document.documentElement.dataset.nebulaHostFixture='running';".to_vec()),
        ];
        crate::extension_compatibility::validate_manifest_files(&manifest, &entries)?;
        let root = root.join("owned-host-fixture");
        let folder = prepare_discovery_directory(&root, "1.0.0", entries)?;
        let target = InstallationLocation { root, folder };
        operate(
            app.clone(),
            "extension-test".into(),
            target.clone(),
            "install".into(),
            None,
        )?;
        // Reload the disposable localhost page so the fixture's content script runs.
        app.get_webview("extension-test")
            .ok_or("Missing fixture tab")?
            .reload()
            .map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        while test_script(
            app,
            "document.documentElement.dataset.nebulaHostFixture === 'running'",
        )? != "true"
        {
            if std::time::Instant::now() > deadline {
                return Err("Host fixture content script did not run".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let label = "extension-ui-owned-fixture-popup";
        crate::extension_host::open_controls(
            app,
            ("extension-test", "extension-test"),
            label,
            &target,
            "popup",
            false,
        )?;
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let evidence = loop {
            let evidence: serde_json::Value = serde_json::from_str(&test_script_at(
                app,
                label,
                "globalThis.__hostProbe ?? null",
            )?)
            .map_err(|e| e.to_string())?;
            if !evidence.is_null() {
                break evidence;
            }
            if std::time::Instant::now() > deadline {
                return Err("Extension controls did not complete worker/storage probe".into());
            }
            std::thread::sleep(Duration::from_millis(100));
        };
        if evidence["worker"] != "replied"
            || evidence["storage"]["probe"] != "stored"
            || !evidence["origin"]
                .as_str()
                .is_some_and(|origin| origin.starts_with("chrome-extension://"))
        {
            return Err(format!("Extension controls probe failed: {evidence}"));
        }
        // Record active-tab evidence honestly; creating a controls WebView does
        // not prove it has Chrome popup semantics or correct page targeting.
        println!("Common host fixture (popup, worker, storage, tab query): {evidence}");
        app.get_webview_window(label)
            .ok_or("Missing controls")?
            .destroy()
            .map_err(|e| e.to_string())?;
        for action in ["disable", "enable"] {
            let status = operate(
                app.clone(),
                "extension-test".into(),
                target.clone(),
                action.into(),
                None,
            )?;
            if !status.installed || status.enabled != (action == "enable") {
                return Err(format!("Host fixture {action} failed"));
            }
        }
        operate(
            app.clone(),
            "extension-test".into(),
            target.clone(),
            "remove".into(),
            None,
        )?;
        if operate(
            app.clone(),
            "extension-test".into(),
            target,
            "status".into(),
            None,
        )?
        .installed
        {
            return Err("Host fixture survived removal".into());
        }
        Ok(evidence)
    }

    #[cfg(all(target_os = "windows", feature = "extension-native-smoke"))]
    #[test]
    #[ignore = "Starts a hidden WebView2 with an isolated temporary profile; requires a Windows desktop session"]
    fn native_install_status_remove_round_trip() {
        use crate::extension_registry::PACKAGES;
        // WebView creation itself can hang in a restricted Windows job. Bound
        // the entire opt-in test, including setup before the event loop starts.
        let (_watchdog, deadline) = std::sync::mpsc::channel::<()>();
        std::thread::spawn(move || {
            if matches!(
                deadline.recv_timeout(Duration::from_secs(90)),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            ) {
                eprintln!("Extension runtime test exceeded 90 seconds; no compatibility result was certified");
                std::process::exit(1);
            }
        });
        let report_dir =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("target/extension-compatibility");
        std::fs::create_dir_all(&report_dir).unwrap();
        std::fs::write(report_dir.join("runtime.json"), br#"{"status":"running"}"#).unwrap();
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("extensions");
        for package in PACKAGES.iter() {
            let fixture = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target/extension-download-smoke")
                .join(package.filename());
            prepare_directory(
                package,
                &root.join(&package.id),
                &std::fs::read(fixture).unwrap(),
            )
            .unwrap();
        }
        let profile = directory.path().join("profile");
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let page_url = format!("http://{}/", server.local_addr().unwrap());
        server.set_nonblocking(true).unwrap();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stopped = stop.clone();
        let server_thread = std::thread::spawn(move || {
            while !stopped.load(std::sync::atomic::Ordering::Acquire) {
                if let Ok((mut connection, _)) = server.accept() {
                    let _ = connection.set_read_timeout(Some(Duration::from_secs(2)));
                    let mut request = [0; 4096];
                    let _ = connection.read(&mut request);
                    let body = "<html><head><title>Extension test</title></head><body id='fixture' style='background:white;color:black'>Extension content test</body></html>";
                    let _ = write!(connection, "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
                } else {
                    std::thread::sleep(Duration::from_millis(10));
                }
            }
        });
        let mut context = tauri::generate_context!();
        context.config_mut().app.windows.clear();
        context.config_mut().identifier = "com.nebula.extension-test".into();
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let app = tauri::Builder::default().any_thread().setup(move |app| {
            tauri::WebviewWindowBuilder::new(app, "extension-test", tauri::WebviewUrl::External("about:blank".parse().unwrap()))
                .visible(false).skip_taskbar(true).data_directory(profile).browser_extensions_enabled(true).build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = (|| -> Result<(), String> {
                    let runtime = crate::extension_runtime::read_version(handle.clone(), "extension-test")?;
                    println!("Actual WebView2 runtime: {runtime}");
                    let downloads = tempfile::tempdir().map_err(|e| e.to_string())?;
                    let first_package = PACKAGES.first().ok_or("No test packages")?;
                    if crate::extension_download::complete_checked_download(handle.clone(), first_package, downloads.path(), b"corrupt").is_ok()
                        || std::fs::read_dir(downloads.path()).map_err(|e| e.to_string())?.count() != 0 {
                        return Err("Failed compatibility check published a download".into());
                    }
                    for package in PACKAGES.iter() {
                        let bytes = std::fs::read(root.join(&package.id).join("package.zip")).map_err(|e| e.to_string())?;
                        let saved = crate::extension_download::complete_checked_download(handle.clone(), package, downloads.path(), &bytes)?;
                        let value = serde_json::to_value(saved).map_err(|e| e.to_string())?;
                        if value["compatibility"]["loadTest"] != "passed" || value["compatibility"]["functionalityTest"] != "not-run" {
                            return Err("Download returned incomplete compatibility evidence".into());
                        }
                        if std::fs::read(value["path"].as_str().ok_or("Missing download path")?).map_err(|e| e.to_string())? != bytes {
                            return Err("Checked download bytes changed".into());
                        }
                        if handle.webview_windows().keys().any(|label| label.starts_with("extension-probe-")) {
                            return Err("Download compatibility probe window was left open".into());
                        }
                        println!("Automatic download compatibility and cleanup passed for {}", package.id);
                    }
                    // Exercise the catalog path with a real Chrome Web Store
                    // CRX, including persistent registration in the disposable profile.
                    let store_id = "efaidnbmnnnibpcajpcglclefindmkaj";
                    let chrome_store_package = tauri::async_runtime::block_on(
                        crate::extension_download::fetch_discovery_package(store_id),
                    )?;
                    let saved = crate::extension_download::complete_discovery_checked_download(
                        handle.clone(),
                        store_id.into(),
                        downloads.path(),
                        &chrome_store_package,
                    )?;
                    let value = serde_json::to_value(saved).map_err(|e| e.to_string())?;
                    if value["compatibility"]["loadTest"] != "passed"
                        || value["compatibility"]["source"] != "chrome-web-store-crx"
                        || value["compatibility"]["sourceId"] != store_id
                    {
                        return Err("Chrome Web Store download returned incomplete compatibility evidence".into());
                    }
                    if std::fs::read(value["path"].as_str().ok_or("Missing download path")?)
                        .map_err(|e| e.to_string())?
                        != chrome_store_package
                    {
                        return Err("Chrome Web Store download bytes changed".into());
                    }
                    if handle.webview_windows().keys().any(|label| label.starts_with("extension-probe-")) {
                        return Err("Chrome Web Store compatibility probe window was left open".into());
                    }
                    println!("Chrome Web Store package passed automatic compatibility and cleanup");
                    let generic_root = root.join("store-fixture");
                    let (entries, _) = discovery_entries(&chrome_store_package, store_id)?;
                    let digest = format!("{:x}", sha2::Sha256::digest(&chrome_store_package));
                    let generic_folder = prepare_discovery_directory(&generic_root, &digest, entries)?;
                    let generic = InstallationLocation { root: generic_root, folder: generic_folder };
                    let installed = operate(handle.clone(), "extension-test".into(), generic.clone(), "install".into(), None)?;
                    if !installed.enabled { return Err("Catalog fixture did not install".into()); }
                    operate(handle.clone(), "extension-test".into(), generic, "remove".into(), None)?;
                    println!("Real catalog package installed and removed in the disposable profile");
                    for package in PACKAGES.iter() {
                        let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(root.join(&package.id).join(&package.version).join("manifest.json")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                        crate::extension_compatibility::validate_minimum_runtime(&manifest, &runtime)?;
                        let guard = MutationGuard::acquire(&package.id)?;
                        let installed = operate(handle.clone(), "extension-test".into(), InstallationLocation::registered(root.join(&package.id), package), "install".into(), Some(guard))?;
                        if !installed.installed || !installed.enabled { return Err(format!("{} was not enabled", package.id)); }
                        println!("Installed and enabled {}", package.id);
                    }
                    for package in PACKAGES.iter() {
                        let status = operate(handle.clone(), "extension-test".into(), InstallationLocation::registered(root.join(&package.id), package), "status".into(), None)?;
                        if !status.installed || !status.enabled { return Err(format!("{} was not found alongside other extensions", package.id)); }
                    }
                    let enumerated = enumerate(handle.clone(), "extension-test".into())?;
                    for package in PACKAGES.iter() {
                        let runtime_id = std::fs::read_to_string(root.join(&package.id).join("installed-id")).map_err(|e| e.to_string())?;
                        if enumerated.get(&runtime_id) != Some(&true) { return Err(format!("{} was absent from batched enumeration", package.id)); }
                    }
                    // Functionality probes are explicit; an extension without a
                    // dedicated probe remains not-run in the runtime report.
                    if PACKAGES.iter().any(|package| package.id == "dark-reader") {
                    // Exercise a real content script on a local page, without loading a user's tabs.
                    handle.get_webview("extension-test").ok_or("Missing test webview")?.navigate(page_url.parse().unwrap()).map_err(|e| e.to_string())?;
                    let deadline = std::time::Instant::now() + Duration::from_secs(15);
                    let mut darkened = false;
                    while std::time::Instant::now() < deadline {
                        if test_script(&handle, "!!document.querySelector('body#fixture') && !!document.querySelector('style.darkreader') && getComputedStyle(document.body).backgroundColor !== 'rgb(255, 255, 255)'")? == "true" {
                            darkened = true; break;
                        }
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    if !darkened { return Err("Dark Reader did not darken the test page".into()); }
                    println!("Dark Reader content script darkened the local test page");
                    }
                    let common_host = common_host_probe(&handle, &root)?;
                    for (index, package) in PACKAGES.iter().enumerate() {
                        let guard = MutationGuard::acquire(&package.id)?;
                        operate(handle.clone(), "extension-test".into(), InstallationLocation::registered(root.join(&package.id), package), "remove".into(), Some(guard))?;
                        let removed = operate(handle.clone(), "extension-test".into(), InstallationLocation::registered(root.join(&package.id), package), "status".into(), None)?;
                        if removed.installed { return Err(format!("{} was not removed", package.id)); }
                        for remaining in &PACKAGES[index + 1..] {
                            if !operate(handle.clone(), "extension-test".into(), InstallationLocation::registered(root.join(&remaining.id), remaining), "status".into(), None)?.enabled {
                                return Err("Removing one extension affected another".into());
                            }
                        }
                        println!("Removed {} independently", package.id);
                    }
                    let reports: Vec<_> = PACKAGES.iter().map(|package| serde_json::json!({
                        "id": package.id, "version": package.version, "sha256": package.sha256,
                        "install": "passed", "enabled": "passed", "enumeration": "passed", "remove": "passed",
                        "functionality": if package.id == "dark-reader" { "local-page-darkening-passed" } else { "not-run" }
                    })).collect();
                    let report = serde_json::json!({"status":"passed", "runtimeVersion":runtime,
                        "checkedAtUnixSeconds": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_secs(),
                        "profile":"isolated-temporary", "packages":reports, "commonHost":common_host});
                    std::fs::write(report_dir.join("runtime.json"), serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                    Ok(())
                })();
                let _ = tx.send(result);
                handle.exit(0);
            });
            Ok(())
        }).build(context).unwrap();
        app.run_return(|_, _| {});
        stop.store(true, std::sync::atomic::Ordering::Release);
        server_thread.join().unwrap();
        rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    }
}
