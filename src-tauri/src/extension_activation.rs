//! When and where extension code may start.
//!
//! Installing a third-party extension has two halves. Getting the package (download,
//! signature/digest check, the isolated load check, unpacking into the extension's
//! folder) can happen at any time: it only writes files. Starting it, registering it with
//! the browsing profile where the tabs live, is activation, and it may only happen when
//! the shell is in its own environment (`shell_isolation::split_committed`): extension
//! code in the tabs' profile must not be able to reach Nebula's own screens.
//!
//! So an install in the single environment ends with a record, `pending-activation`, and
//! the app offers the switch (restart, verified hydration). The activation runs after the
//! switch is final. Nothing here copies profile files: extensions that were installed in
//! the old separate "trial" profile are moved by reinstalling the same, already reviewed
//! package into the browsing profile (see `migrate_legacy`), not by copying their data.
//!
//! Records live next to the extension's other records (`extensions/<id>/`):
//! - `pending-activation`: JSON `{ "action": "install" | "enable", "requestedAt": secs }`;
//! - `installed-profile`: `browsing` once the extension is registered with the browsing
//!   profile. An installed extension without it is a legacy trial-profile install;
//! - `activation-error`: why the last activation failed (shown, then replaced on retry);
//! - `migration-review`: why a legacy install could not be moved without a new review;
//! - `legacy-cleanup`: the old trial-profile registration id of an extension that already
//!   moved, whose removal from the trial profile has not succeeded yet. The new install is
//!   kept; the removal is retried at the next start and the trial profile stays until it is
//!   done.
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::extension_install::ExtensionStatus;

/// The text of the refusal when something asks to start extension code in the shared
/// profile before the shell is separated. The shell maps it to the switch offer.
pub const NEEDS_ISOLATION: &str =
    "needs-isolation: extensions can only be turned on after Nebula's own screens are separated from them";

/// Enabling a trial-profile install is refused: it moves to the browsing profile first.
pub const NEEDS_MIGRATION: &str =
    "needs-migration: this extension still lives in the old trial profile and moves to the main profile first";

const PENDING: &str = "pending-activation";
const PROFILE: &str = "installed-profile";
const ERROR: &str = "activation-error";
const REVIEW: &str = "migration-review";
const CLEANUP: &str = "legacy-cleanup";

/// What the install, enable and status commands answer.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManageResult {
    pub installed: bool,
    pub enabled: bool,
    /// The package is ready but starting it waits for the isolated shell.
    pub pending_activation: bool,
    /// Why the last attempt to start it after the switch failed.
    pub activation_error: Option<String>,
}

impl From<ExtensionStatus> for ManageResult {
    fn from(status: ExtensionStatus) -> Self {
        ManageResult {
            installed: status.installed,
            enabled: status.enabled,
            ..ManageResult::default()
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PendingRecord {
    action: String,
    requested_at: u64,
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

fn write_atomic(root: &Path, name: &str, value: &[u8]) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
    crate::secure_password_vault::durable_replace(&root.join(name), value, false)
}

fn remove_record(root: &Path, name: &str) {
    let _ = std::fs::remove_file(root.join(name));
}

// ---- records ------------------------------------------------------------------------------

/// Records that starting the extension waits for the isolated shell.
pub(crate) fn request(root: &Path, action: &str) -> Result<(), String> {
    if !matches!(action, "install" | "enable") {
        return Err("Only install and enable can wait for activation".into());
    }
    // A waiting install already includes turning it on: a later enable must not turn it
    // into "enable", which would find nothing registered.
    let action = if pending_action(root).as_deref() == Some("install") {
        "install"
    } else {
        action
    };
    let record = serde_json::to_vec(&PendingRecord {
        action: action.to_string(),
        requested_at: now_secs(),
    })
    .map_err(|error| error.to_string())?;
    remove_record(root, ERROR);
    write_atomic(root, PENDING, &record)
}

/// "install" or "enable" if starting this extension is waiting.
pub(crate) fn pending_action(root: &Path) -> Option<String> {
    let bytes = std::fs::read(root.join(PENDING)).ok()?;
    let record: PendingRecord = serde_json::from_slice(&bytes).ok()?;
    matches!(record.action.as_str(), "install" | "enable").then_some(record.action)
}

pub(crate) fn clear_pending(root: &Path) {
    remove_record(root, PENDING);
}

pub(crate) fn activation_error(root: &Path) -> Option<String> {
    std::fs::read_to_string(root.join(ERROR))
        .ok()
        .filter(|text| !text.is_empty())
}

fn record_error(root: &Path, message: &str) {
    let _ = write_atomic(
        root,
        ERROR,
        message.chars().take(400).collect::<String>().as_bytes(),
    );
}

pub(crate) fn mark_browsing(root: &Path) -> Result<(), String> {
    write_atomic(root, PROFILE, b"browsing")
}

pub(crate) fn is_browsing(root: &Path) -> bool {
    std::fs::read_to_string(root.join(PROFILE)).is_ok_and(|text| text.trim() == "browsing")
}

/// Removes every record this module keeps (an extension that is being removed).
pub(crate) fn forget(root: &Path) {
    for name in [PENDING, PROFILE, ERROR, REVIEW] {
        remove_record(root, name);
    }
}

/// An install made before this existed: registered with the separate catalog ("trial")
/// profile, not with the browsing profile. Registry packages never lived there.
pub(crate) fn is_legacy(root: &Path, is_registry_package: bool) -> bool {
    !is_registry_package && root.join("installed-id").is_file() && !is_browsing(root)
}

/// Remembers that the old trial-profile registration `old_id` still has to be removed.
pub(crate) fn request_cleanup(root: &Path, old_id: &str) -> Result<(), String> {
    write_atomic(root, CLEANUP, old_id.as_bytes())
}

/// The old registration id waiting to be removed from the trial profile, if any.
pub(crate) fn pending_cleanup(root: &Path) -> Option<String> {
    let id = std::fs::read_to_string(root.join(CLEANUP)).ok()?;
    let id = id.trim();
    crate::extension_discovery::valid_store_id(id).then(|| id.to_string())
}

pub(crate) fn clear_cleanup(root: &Path) {
    remove_record(root, CLEANUP);
}

pub(crate) fn needs_review(root: &Path) -> Option<String> {
    std::fs::read_to_string(root.join(REVIEW))
        .ok()
        .filter(|text| !text.is_empty())
}

/// The status a pending-only extension (package ready, not started) reports.
pub(crate) fn pending_result(root: &Path) -> Option<ManageResult> {
    let action = pending_action(root)?;
    Some(ManageResult {
        installed: action == "enable",
        enabled: false,
        pending_activation: true,
        activation_error: None,
    })
}

// ---- the decision ----------------------------------------------------------------------------

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Activation {
    Now,
    Waiting,
}

/// Decides whether `action` (install or enable) may start extension code now. When not, it
/// leaves the pending record so the activation follows the switch.
pub(crate) fn decide(root: &Path, action: &str) -> Result<Activation, String> {
    if crate::shell_isolation::split_committed() {
        clear_pending(root);
        Ok(Activation::Now)
    } else {
        request(root, action)?;
        Ok(Activation::Waiting)
    }
}

/// The guard behind every registration with the browsing profile (`operate`): the shared
/// profile never runs third-party extension code while the shell lives in it.
pub(crate) fn require_split(action: &str, label: &str) -> Result<(), String> {
    let starts_code = matches!(action, "install" | "enable");
    let shared_profile =
        crate::browser_profile::is_owner(label) || label == "extension-catalog-host";
    if starts_code && shared_profile && !crate::shell_isolation::split_committed() {
        return Err(NEEDS_ISOLATION.to_string());
    }
    Ok(())
}

// ---- listing and commands ----------------------------------------------------------------

fn root_of(app: &tauri::AppHandle, id: &str) -> Result<PathBuf, String> {
    crate::extension_host::root_for(app, id)
}

fn is_package(id: &str) -> bool {
    crate::extension_registry::package(id).is_ok()
}

/// Every known extension id (the catalog's, which includes the registry's).
fn known_ids() -> impl Iterator<Item = &'static str> {
    crate::extension_discovery::DISCOVERY
        .iter()
        .map(|entry| entry.id.as_str())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingActivation {
    pub id: String,
    pub action: String,
    pub error: Option<String>,
}

/// Extensions whose package is ready and whose start waits for the isolated shell, and
/// those whose last start failed, so the catalog can say so.
#[tauri::command]
pub fn extension_pending_activations(
    app: tauri::AppHandle,
) -> Result<Vec<PendingActivation>, String> {
    let mut found = Vec::new();
    for id in known_ids() {
        let root = root_of(&app, id)?;
        let action = pending_action(&root);
        let error = activation_error(&root);
        if action.is_some() || error.is_some() {
            found.push(PendingActivation {
                id: id.to_string(),
                action: action.unwrap_or_default(),
                error,
            });
        }
    }
    Ok(found)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyInstall {
    pub id: String,
    /// Moving it needs the user to review the package again (the store changed it).
    pub needs_review: Option<String>,
}

/// Installs from the old separate trial profile that have not moved yet.
#[tauri::command]
pub fn extension_legacy_installs(app: tauri::AppHandle) -> Result<Vec<LegacyInstall>, String> {
    legacy_installs(&app)
}

pub(crate) fn legacy_installs(app: &tauri::AppHandle) -> Result<Vec<LegacyInstall>, String> {
    let mut found = Vec::new();
    for id in known_ids() {
        let root = root_of(app, id)?;
        if is_legacy(&root, is_package(id)) {
            found.push(LegacyInstall {
                id: id.to_string(),
                needs_review: needs_review(&root),
            });
        }
    }
    Ok(found)
}

// ---- after the split is final ------------------------------------------------------------

/// Starts what waited for the isolated shell, then moves legacy trial-profile installs.
/// Runs after the hydration check made the split final, and again at later starts to retry.
pub(crate) async fn run_after_commit(app: tauri::AppHandle) {
    #[cfg(target_os = "windows")]
    {
        if let Err(error) = activate_pending(&app).await {
            eprintln!("[extension-activation] {error}");
        }
        if let Err(error) = migrate_legacy(&app).await {
            eprintln!("[extension-migration] {error}");
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = app;
}

#[cfg(target_os = "windows")]
fn activate_one(app: &tauri::AppHandle, id: &str, root: &Path, action: &str) -> Result<(), String> {
    use crate::extension_install::{operate, MutationGuard};
    // Nothing registered yet means there is nothing to enable: the package is installed.
    let action = if action == "enable" && !root.join("installed-id").is_file() {
        "install"
    } else {
        action
    };
    let guard = MutationGuard::acquire(id)?;
    let label = crate::browser_profile::owner_label(app)?;
    let target = crate::extension_host::location(root.to_path_buf(), id)?;
    let status = operate(app.clone(), label, target, action.to_string(), Some(guard))?;
    if !status.installed || !status.enabled {
        return Err("The browser did not turn the extension on".into());
    }
    if action == "install" {
        mark_browsing(root)?;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
async fn activate_pending(app: &tauri::AppHandle) -> Result<(), String> {
    for id in known_ids().map(str::to_string).collect::<Vec<_>>() {
        let root = root_of(app, &id)?;
        let Some(action) = pending_action(&root) else {
            continue;
        };
        eprintln!("[extension-activation] {id}: starting pending {action}");
        let (worker_app, worker_id, worker_root, worker_action) =
            (app.clone(), id.clone(), root.clone(), action.clone());
        let outcome = tauri::async_runtime::spawn_blocking(move || {
            activate_one(&worker_app, &worker_id, &worker_root, &worker_action)
        })
        .await
        .map_err(|error| error.to_string())?;
        eprintln!("[extension-activation] {id}: finished: {outcome:?}");
        // A failure is recorded and shown; it is not retried in a loop.
        clear_pending(&root);
        if let Err(error) = outcome {
            eprintln!("[extension-activation] {id}: {error}");
            record_error(&root, &error);
        }
    }
    Ok(())
}

/// Removes the old registration `old_id` from the trial profile. Its id travels in a scratch
/// folder, because `operate` finds an extension by the id recorded next to its folder. Removing
/// something that is not registered any more succeeds.
#[cfg(target_os = "windows")]
async fn remove_old_registration(
    app: &tauri::AppHandle,
    tag: &str,
    old_id: &str,
) -> Result<(), String> {
    use crate::extension_install::{operate, InstallationLocation};
    // Harness only: the live test makes this step fail to prove the new install survives it and
    // that the removal is retried at the next start.
    #[cfg(feature = "split-driver")]
    if std::env::var("NEBULA_FIXTURE_FAIL_LEGACY_CLEANUP").is_ok() {
        return Err("fault injected: the trial profile could not be cleaned".into());
    }
    let scratch = std::env::temp_dir().join(format!("nebula-legacy-{}-{tag}", std::process::id()));
    std::fs::create_dir_all(&scratch).map_err(|e| e.to_string())?;
    std::fs::write(scratch.join("installed-id"), old_id).map_err(|e| e.to_string())?;
    let (remove_app, remove_scratch) = (app.clone(), scratch.clone());
    let removal = tauri::async_runtime::spawn_blocking(move || {
        let label = crate::extension_host::catalog_host(&remove_app)?;
        operate(
            remove_app,
            label,
            InstallationLocation {
                folder: remove_scratch.join("none"),
                root: remove_scratch,
            },
            "remove".into(),
            None,
        )
    })
    .await
    .map_err(|e| e.to_string());
    let _ = std::fs::remove_dir_all(&scratch);
    removal?.map(|_| ())
}

/// Retries the removals that did not succeed at an earlier start. The new installs they belong
/// to are already in place; only the old trial-profile copies are left.
#[cfg(target_os = "windows")]
async fn finish_legacy_cleanups(app: &tauri::AppHandle) -> Result<(), String> {
    for id in known_ids().map(str::to_string).collect::<Vec<_>>() {
        let root = root_of(app, &id)?;
        let Some(old_id) = pending_cleanup(&root) else {
            continue;
        };
        match remove_old_registration(app, &id, &old_id).await {
            Ok(()) => clear_cleanup(&root),
            Err(error) => {
                eprintln!("[extension-migration] {id}: trial cleanup still pending: {error}")
            }
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn cleanup_pending_anywhere(app: &tauri::AppHandle) -> bool {
    known_ids().any(|id| root_of(app, id).is_ok_and(|root| pending_cleanup(&root).is_some()))
}

/// Moves one trial-profile install to the browsing profile WITHOUT touching its profile
/// files: the package that was reviewed and installed is fetched again from the same
/// allowlisted source, and only if its digest is still the recorded one is it prepared
/// and registered with the browsing profile. Then the old registration is removed from the
/// trial profile. The extension's own data (a login) does not move.
#[cfg(target_os = "windows")]
async fn migrate_one(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    use crate::extension_install::{operate, MutationGuard};
    use sha2::Digest;
    let entry = crate::extension_discovery::extension(id)?;
    let root = root_of(app, id)?;
    let recorded = std::fs::read_to_string(root.join("installed-folder")).unwrap_or_default();
    if !crate::extension_host::valid_digest(&recorded) {
        std::fs::write(
            root.join(REVIEW),
            "there is no record of the installed package",
        )
        .ok();
        return Err("no recorded package digest".into());
    }
    let old_id = std::fs::read_to_string(root.join("installed-id")).map_err(|e| e.to_string())?;

    // Whether it was on, and that it is still registered where we think.
    let (status_app, status_root, status_id) = (app.clone(), root.clone(), id.to_string());
    let before = tauri::async_runtime::spawn_blocking(move || {
        let label = crate::extension_host::catalog_host(&status_app)?;
        let target = crate::extension_host::location(status_root, &status_id)?;
        operate(status_app, label, target, "status".into(), None)
    })
    .await
    .map_err(|e| e.to_string())??;

    let bytes = crate::extension_download::fetch_discovery_package(&entry.id).await?;
    let digest = format!("{:x}", sha2::Sha256::digest(&bytes));
    if digest != recorded {
        // The store changed the package since the user reviewed it: never install it silently.
        std::fs::write(
            root.join(REVIEW),
            "the store package changed since it was installed; review and install it again",
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let (prepare_app, prepare_root, store_id, prepare_digest) = (
        app.clone(),
        root.clone(),
        entry.store_id.clone(),
        digest.clone(),
    );
    tauri::async_runtime::spawn_blocking(move || {
        crate::extension_install::probe_discovery_download(
            prepare_app,
            store_id.clone(),
            &bytes,
            prepare_digest.clone(),
        )
        .map_err(|e| format!("Isolated load check failed: {e}"))?;
        let (entries, _) = crate::extension_install::discovery_entries(&bytes, &store_id)
            .map_err(|e| format!("Package check failed: {e}"))?;
        crate::extension_install::prepare_discovery_directory(
            &prepare_root,
            &prepare_digest,
            entries,
        )
        .map_err(|e| format!("Could not prepare the extension folder: {e}"))
    })
    .await
    .map_err(|e| e.to_string())??;

    // Register with the browsing profile (the guard inside `operate` allows it: the split is final).
    crate::extension_host::close_controls(app, id)?;
    let (install_app, install_root, install_id) = (app.clone(), root.clone(), id.to_string());
    let guard = MutationGuard::acquire(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let label = crate::browser_profile::owner_label(&install_app)?;
        let target = crate::extension_host::location(install_root, &install_id)?;
        operate(install_app, label, target, "install".into(), Some(guard))
    })
    .await
    .map_err(|e| e.to_string())??;
    mark_browsing(&root)?;

    // The new install is in place. The old trial-profile registration is removed now; if that
    // fails, the record below keeps the removal retryable at the next start and the trial profile
    // is not deleted until it is done. Being registered in both profiles does not touch the shell
    // (the trial profile is its own environment).
    request_cleanup(&root, &old_id)?;
    match remove_old_registration(app, id, &old_id).await {
        Ok(()) => clear_cleanup(&root),
        Err(error) => {
            eprintln!("[extension-migration] {id}: moved, trial cleanup pending: {error}")
        }
    }

    if !before.enabled {
        let (off_app, off_root, off_id) = (app.clone(), root.clone(), id.to_string());
        tauri::async_runtime::spawn_blocking(move || {
            let label = crate::browser_profile::owner_label(&off_app)?;
            let target = crate::extension_host::location(off_root, &off_id)?;
            operate(off_app, label, target, "disable".into(), None)
        })
        .await
        .map_err(|e| e.to_string())??;
    }
    remove_record(&root, REVIEW);
    Ok(())
}

#[cfg(target_os = "windows")]
async fn migrate_legacy(app: &tauri::AppHandle) -> Result<(), String> {
    // What a previous start could not clean up comes first.
    finish_legacy_cleanups(app).await?;
    for item in legacy_installs(app)? {
        if item.needs_review.is_some() {
            continue;
        }
        if let Err(error) = migrate_one(app, &item.id).await {
            eprintln!("[extension-migration] {}: {error}", item.id);
            let root = root_of(app, &item.id)?;
            record_error(
                &root,
                &format!("could not move to the main profile: {error}"),
            );
        }
    }
    // The trial profile goes when nothing is left in it: no install to move, no removal waiting.
    if legacy_installs(app)?.is_empty() && !cleanup_pending_anywhere(app) {
        remove_trial_profile(app);
    }
    Ok(())
}

/// The old separate profile: its host window, its windows, then its folder. It only held
/// the extensions that moved (and the trial sites' browsing data, which is the point of
/// retiring it).
#[cfg(target_os = "windows")]
fn remove_trial_profile(app: &tauri::AppHandle) {
    use tauri::Manager;
    for (label, window) in app.webview_windows() {
        if label == "extension-catalog-host" || label.starts_with("extension-trial-site-") {
            let _ = window.destroy();
        }
    }
    let Ok(directory) = crate::extension_host::catalog_profile_directory(app) else {
        return;
    };
    if !directory.exists() {
        return;
    }
    let directory_for_retry = directory.clone();
    std::thread::spawn(move || {
        for _ in 0..40 {
            if std::fs::remove_dir_all(&directory_for_retry).is_ok()
                || !directory_for_retry.exists()
            {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(500));
        }
        eprintln!("[extension-migration] could not remove the trial profile folder");
    });
}

// ---- harness only: an install in the OLD trial-profile format ------------------------------

/// Creates legacy installs the way the app did before extensions moved to the browsing
/// profile, from `NEBULA_FIXTURE_LEGACY_INSTALL="<catalog id>:enabled,<catalog id>:disabled"`:
/// the real package is fetched from the store, checked, unpacked, recorded, and registered
/// with the separate catalog profile, with no `installed-profile` marker. Only the live
/// migration test uses this; it needs `NEBULA_FIXTURE_ALLOW_SHARED_PROFILE` too (the guard
/// refuses registrations with the catalog host otherwise).
#[cfg(all(target_os = "windows", feature = "split-driver"))]
pub(crate) fn fixture_legacy_installs_from_env(app: &tauri::AppHandle) {
    let Ok(spec) = std::env::var("NEBULA_FIXTURE_LEGACY_INSTALL") else {
        return;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        for item in spec.split(',').filter(|item| !item.is_empty()) {
            let (id, state) = item.split_once(':').unwrap_or((item, "enabled"));
            match fixture_legacy_install(&app, id, state == "enabled").await {
                Ok(()) => eprintln!("[fixture-legacy] {id}: installed ({state})"),
                Err(error) => eprintln!("[fixture-legacy] {id}: failed: {error}"),
            }
        }
    });
}

#[cfg(all(target_os = "windows", feature = "split-driver"))]
async fn fixture_legacy_install(
    app: &tauri::AppHandle,
    id: &str,
    enabled: bool,
) -> Result<(), String> {
    use crate::extension_install::{operate, MutationGuard};
    use sha2::Digest;
    let entry = crate::extension_discovery::extension(id)?;
    let root = root_of(app, id)?;
    let bytes = crate::extension_download::fetch_discovery_package(&entry.id).await?;
    let digest = format!("{:x}", sha2::Sha256::digest(&bytes));
    let (prepare_app, prepare_root, store_id, prepare_digest) = (
        app.clone(),
        root.clone(),
        entry.store_id.clone(),
        digest.clone(),
    );
    tauri::async_runtime::spawn_blocking(move || {
        crate::extension_install::probe_discovery_download(
            prepare_app,
            store_id.clone(),
            &bytes,
            prepare_digest.clone(),
        )?;
        let (entries, _) = crate::extension_install::discovery_entries(&bytes, &store_id)?;
        crate::extension_install::prepare_discovery_directory(
            &prepare_root,
            &prepare_digest,
            entries,
        )?;
        crate::extension_host::write_record(
            &prepare_root,
            "installed-folder",
            prepare_digest.as_bytes(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    let (install_app, install_root, install_id) = (app.clone(), root.clone(), id.to_string());
    let guard = MutationGuard::acquire(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        let label = crate::extension_host::catalog_host(&install_app)?;
        let target = crate::extension_host::location(install_root, &install_id)?;
        operate(
            install_app.clone(),
            label.clone(),
            target.clone(),
            "install".into(),
            Some(guard),
        )?;
        if !enabled {
            operate(install_app, label, target, "disable".into(), None)?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("nebula-activation-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_waiting_activation_is_recorded_and_cleared() {
        let root = dir("pending");
        assert_eq!(pending_action(&root), None);
        request(&root, "install").unwrap();
        assert_eq!(pending_action(&root).as_deref(), Some("install"));
        let result = pending_result(&root).unwrap();
        assert!(result.pending_activation && !result.installed && !result.enabled);
        // A later enable must not downgrade a waiting install: nothing is registered yet.
        request(&root, "enable").unwrap();
        assert_eq!(pending_action(&root).as_deref(), Some("install"));
        assert!(!pending_result(&root).unwrap().installed);
        clear_pending(&root);
        request(&root, "enable").unwrap();
        let result = pending_result(&root).unwrap();
        assert!(
            result.installed,
            "an enable waits on something already installed"
        );
        clear_pending(&root);
        assert_eq!(pending_action(&root), None);
        assert!(
            request(&root, "remove").is_err(),
            "only install and enable can wait"
        );
    }

    #[test]
    fn a_damaged_pending_record_does_not_start_anything() {
        let root = dir("damaged");
        std::fs::write(root.join(PENDING), b"not json").unwrap();
        assert_eq!(pending_action(&root), None);
        std::fs::write(
            root.join(PENDING),
            br#"{"action":"remove","requestedAt":1}"#,
        )
        .unwrap();
        assert_eq!(
            pending_action(&root),
            None,
            "an unknown action is never run"
        );
    }

    #[test]
    fn legacy_means_installed_without_the_browsing_profile_marker() {
        let root = dir("legacy");
        assert!(!is_legacy(&root, false), "nothing installed");
        std::fs::write(root.join("installed-id"), "runtime").unwrap();
        assert!(is_legacy(&root, false));
        assert!(
            !is_legacy(&root, true),
            "registry packages never lived in the trial profile"
        );
        mark_browsing(&root).unwrap();
        assert!(!is_legacy(&root, false));
        assert!(is_browsing(&root));
    }

    #[test]
    fn forget_removes_every_record_but_not_the_install_pointers() {
        let root = dir("forget");
        request(&root, "install").unwrap();
        mark_browsing(&root).unwrap();
        record_error(&root, "boom");
        std::fs::write(root.join(REVIEW), "changed").unwrap();
        std::fs::write(root.join("installed-id"), "runtime").unwrap();
        assert_eq!(activation_error(&root).as_deref(), Some("boom"));
        assert_eq!(needs_review(&root).as_deref(), Some("changed"));
        forget(&root);
        assert!(pending_action(&root).is_none() && !is_browsing(&root));
        assert!(activation_error(&root).is_none() && needs_review(&root).is_none());
        assert!(
            root.join("installed-id").exists(),
            "the pointers belong to the removal itself"
        );
    }

    #[test]
    fn a_cleanup_that_failed_stays_recorded_until_it_succeeds() {
        let root = dir("cleanup");
        assert_eq!(pending_cleanup(&root), None);
        let old = "abcdefghijklmnopabcdefghijklmnop";
        request_cleanup(&root, old).unwrap();
        assert_eq!(pending_cleanup(&root).as_deref(), Some(old));
        // The new install's own records do not touch it: it belongs to the trial profile.
        mark_browsing(&root).unwrap();
        clear_pending(&root);
        assert_eq!(pending_cleanup(&root).as_deref(), Some(old));
        // Removing the extension later does not forget a cleanup that is still owed.
        forget(&root);
        assert_eq!(pending_cleanup(&root).as_deref(), Some(old));
        clear_cleanup(&root);
        assert_eq!(pending_cleanup(&root), None);
    }

    #[test]
    fn a_damaged_cleanup_record_is_not_acted_on() {
        let root = dir("cleanup-bad");
        std::fs::write(root.join(CLEANUP), "../../somewhere").unwrap();
        assert_eq!(
            pending_cleanup(&root),
            None,
            "only a valid registration id is ever used"
        );
    }

    #[test]
    fn a_new_request_replaces_an_old_error() {
        let root = dir("error");
        record_error(&root, "old failure");
        request(&root, "install").unwrap();
        assert!(activation_error(&root).is_none());
    }

    #[test]
    fn extension_code_never_starts_in_the_shared_profile_before_the_split_is_final() {
        // The test process runs in the default (single) mode.
        assert!(!crate::shell_isolation::split_committed());
        let owner = crate::browser_profile::OWNER_LABEL;
        assert_eq!(
            require_split("install", owner).unwrap_err(),
            NEEDS_ISOLATION
        );
        assert_eq!(require_split("enable", owner).unwrap_err(), NEEDS_ISOLATION);
        assert_eq!(
            require_split("install", "extension-catalog-host").unwrap_err(),
            NEEDS_ISOLATION
        );
        // Reading, switching off and removing are always allowed.
        for action in ["status", "disable", "remove"] {
            assert!(require_split(action, owner).is_ok(), "{action}");
        }
        // The isolated load check and tests use their own temporary profiles.
        assert!(require_split("install", "extension-probe-1").is_ok());
        assert!(require_split("install", "extension-test").is_ok());
    }

    #[test]
    fn deciding_in_the_single_environment_leaves_a_pending_record() {
        let root = dir("decide");
        assert_eq!(decide(&root, "install").unwrap(), Activation::Waiting);
        assert_eq!(pending_action(&root).as_deref(), Some("install"));
    }
}
