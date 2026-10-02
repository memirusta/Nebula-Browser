//! Opt-in isolation of Nebula's own screens from the browser tabs.
//!
//! Until the user enables the first extension the app is one WebView2 environment, as it
//! always was (`Mode::Single`). The switch to `Mode::Split` moves the shell (its own
//! windows, extensions OFF) into a trusted user data folder and leaves the tabs and
//! the extensions in the default folder. Design: `docs/EXTENSION_OPT_IN_SPLIT.md`.
//!
//! Three things live here:
//!
//! - the marker file (`shell-isolation.json`, outside every WebView2 profile) and the
//!   startup plan derived from it: which mode this run uses, and whether this run has to
//!   hydrate the shell's `localStorage` from the shell state store first;
//! - hydration: the seed script every shell webview of a hydrating run gets, the report
//!   the shell sends back with the digest of what it now holds, the check against the
//!   digest the migration gate recorded, and the automatic rollback when any of it fails;
//! - the migration gate and the switch: a barrier over every shell webview (drain, full
//!   reconcile, equal digests, disk check, no writes since), then the marker, then the
//!   restart.
//!
//! The old environment's data is never touched by a switch, so a rollback is only a marker
//! write and a restart.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Condvar, LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};

const SCHEMA: u32 = 1;
const MARKER_FILE: &str = "shell-isolation.json";
const TRUSTED_FOLDER: &str = "trusted";
/// A hydrating run that has not reported by then is abandoned.
const HYDRATION_TIMEOUT: Duration = Duration::from_secs(15);
/// A switch whose first run died before reporting gets one more try, not a loop.
const MAX_ATTEMPTS: u32 = 2;
const BARRIER_TIMEOUT: Duration = Duration::from_secs(10);
const BARRIER_ROUNDS: usize = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Single,
    Split,
}

impl Mode {
    #[cfg(test)]
    fn other(self) -> Mode {
        match self {
            Mode::Single => Mode::Split,
            Mode::Split => Mode::Single,
        }
    }
}

/// What the migration gate recorded; the hydrating run must end up holding exactly this.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Expected {
    pub store_generation: u64,
    pub key_count: usize,
    pub digest: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub schema: u32,
    /// The environment the shell lives in once nothing is pending. While a switch is
    /// pending this is still the SOURCE environment (the one that is safe to go back to).
    pub mode: Mode,
    #[serde(default)]
    pub pending: Option<Mode>,
    #[serde(default)]
    pub attempts: u32,
    #[serde(default)]
    pub expected: Option<Expected>,
    /// Why the last switch was undone. Shown once, then cleared.
    #[serde(default)]
    pub notice: Option<String>,
    #[serde(default)]
    pub changed_at: u64,
}

impl Default for Marker {
    fn default() -> Self {
        Marker {
            schema: SCHEMA,
            mode: Mode::Single,
            pending: None,
            attempts: 0,
            expected: None,
            notice: None,
            changed_at: 0,
        }
    }
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs())
}

// ---- marker file ---------------------------------------------------------------------

fn marker_path(local_data_dir: &Path) -> PathBuf {
    local_data_dir.join(MARKER_FILE)
}

pub(crate) fn trusted_folder_in(local_data_dir: &Path) -> PathBuf {
    local_data_dir.join(TRUSTED_FOLDER)
}

/// A missing, unreadable or newer-schema marker means `Single`: the safe default that is
/// also what every installation was before this existed.
fn read_marker(local_data_dir: &Path) -> Marker {
    let Ok(bytes) = std::fs::read(marker_path(local_data_dir)) else {
        return Marker::default();
    };
    match serde_json::from_slice::<Marker>(&bytes) {
        Ok(marker) if marker.schema == SCHEMA => marker,
        _ => Marker::default(),
    }
}

fn write_marker(local_data_dir: &Path, marker: &Marker) -> Result<(), String> {
    std::fs::create_dir_all(local_data_dir).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(marker).map_err(|error| error.to_string())?;
    crate::secure_password_vault::durable_replace(&marker_path(local_data_dir), &bytes, false)
}

// ---- the startup plan ----------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub struct Hydration {
    pub target: Mode,
    /// Unique per attempt: the seed is applied once per id, whatever number of shell
    /// webviews load it and however often they reload.
    pub id: String,
    pub expected: Expected,
}

#[derive(Debug, PartialEq)]
pub struct StartPlan {
    pub run_mode: Mode,
    pub hydration: Option<Hydration>,
    pub marker: Marker,
    pub write_marker: bool,
}

/// Pure: what this run does, given the marker. The attempt counter is raised BEFORE the
/// run starts, so a run that dies without reporting is counted.
pub fn plan(mut marker: Marker) -> StartPlan {
    let Some(target) = marker.pending else {
        return StartPlan {
            run_mode: marker.mode,
            hydration: None,
            marker,
            write_marker: false,
        };
    };
    let abandon =
        marker.attempts >= MAX_ATTEMPTS || marker.expected.is_none() || target == marker.mode;
    if abandon {
        marker.pending = None;
        marker.attempts = 0;
        marker.expected = None;
        marker.notice = Some("switch-abandoned".to_string());
        marker.changed_at = now_secs();
        return StartPlan {
            run_mode: marker.mode,
            hydration: None,
            marker,
            write_marker: true,
        };
    }
    marker.attempts += 1;
    let hydration = Hydration {
        target,
        id: format!("{}-{}", marker.changed_at, marker.attempts),
        expected: marker.expected.clone().expect("checked above"),
    };
    StartPlan {
        run_mode: target,
        hydration: Some(hydration),
        marker,
        write_marker: true,
    }
}

// ---- seed ------------------------------------------------------------------------------

/// The script a shell webview of a hydrating run gets before any page script. It replaces
/// the webview's `localStorage` with the store's entries once per hydration id, so it needs
/// no IPC and cannot race the app's first read. Only Nebula's own origin is touched.
pub(crate) fn seed_script(
    id: &str,
    entries: &std::collections::BTreeMap<String, String>,
) -> String {
    let seed = serde_json::to_string(entries).unwrap_or_else(|_| "{}".to_string());
    let id_literal = serde_json::to_string(id).unwrap_or_else(|_| "\"\"".to_string());
    format!(
        r#"(() => {{
  try {{
    if (location.hostname !== 'tauri.localhost' && location.hostname !== 'localhost') return;
    const id = {id_literal};
    const seed = {seed};
    if (localStorage.getItem('__nebula_hydration_id') !== id) {{
      localStorage.clear();
      for (const key of Object.keys(seed)) localStorage.setItem(key, seed[key]);
      localStorage.setItem('__nebula_hydration_id', id);
    }}
    window.__NEBULA_HYDRATION__ = {{ id }};
  }} catch (error) {{
    window.__NEBULA_HYDRATION_ERROR__ = String(error);
  }}
}})();"#
    )
}

// ---- process state ---------------------------------------------------------------------

struct Run {
    mode: Mode,
    local_data_dir: PathBuf,
    hydration: Option<Hydration>,
    seed: Option<String>,
    /// The mode forced by the environment (tests); no marker is read or written.
    forced: bool,
}

static RUN: OnceLock<Run> = OnceLock::new();
static MARKER: Mutex<Option<Marker>> = Mutex::new(None);
static HYDRATED: AtomicBool = AtomicBool::new(false);
static COUNTER: AtomicU64 = AtomicU64::new(0);

fn run() -> Option<&'static Run> {
    RUN.get()
}

/// The mode this process runs in.
pub fn mode() -> Mode {
    run().map_or(Mode::Single, |run| run.mode)
}

pub fn split_active() -> bool {
    mode() == Mode::Split
}

pub(crate) fn trusted_dir<M: Manager<tauri::Wry>>(manager: &M) -> Result<PathBuf, String> {
    let dir = manager
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?
        .join(TRUSTED_FOLDER);
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

/// The init script for shell webviews of a hydrating run, if this run hydrates.
pub fn hydration_script() -> Option<String> {
    run().and_then(|run| run.seed.clone())
}

pub fn hydrating() -> bool {
    run().is_some_and(|run| run.hydration.is_some()) && !HYDRATED.load(Ordering::Acquire)
}

fn forced_mode(identifier: &str) -> Option<Mode> {
    // For tests and the spike driver only: release builds of the product identity
    // ignore it, a user cannot end up in an unhydrated split by an environment variable.
    if !(cfg!(debug_assertions)
        || identifier.ends_with(".perf")
        || identifier.ends_with(".extensionlab"))
    {
        return None;
    }
    match std::env::var("NEBULA_SHELL_ISOLATION").ok().as_deref() {
        Some("split") => Some(Mode::Split),
        Some("single") => Some(Mode::Single),
        _ => None,
    }
}

/// Reads the marker and decides this run. Call once, in `run()`, before any window exists.
pub fn initialize(identifier: &str) {
    let local = std::env::var_os("LOCALAPPDATA")
        .map(|base| PathBuf::from(base).join(identifier))
        .unwrap_or_else(|| PathBuf::from(identifier));
    let state = if let Some(mode) = forced_mode(identifier) {
        Run {
            mode,
            local_data_dir: local,
            hydration: None,
            seed: None,
            forced: true,
        }
    } else {
        decide(&local)
    };
    let _ = RUN.set(state);
}

fn decide(local: &Path) -> Run {
    let mut plan = plan(read_marker(local));
    let mut seed = None;
    if let Some(hydration) = &plan.hydration {
        match load_seed(local, hydration) {
            Ok(script) => seed = Some(script),
            Err(error) => {
                eprintln!("[shell-isolation] switch abandoned at startup: {error}");
                plan.marker.pending = None;
                plan.marker.attempts = 0;
                plan.marker.expected = None;
                plan.marker.notice = Some("seed-unavailable".to_string());
                plan.marker.changed_at = now_secs();
                plan.run_mode = plan.marker.mode;
                plan.hydration = None;
                plan.write_marker = true;
            }
        }
    }
    if plan.write_marker {
        if let Err(error) = write_marker(local, &plan.marker) {
            eprintln!("[shell-isolation] could not write the marker: {error}");
        }
    }
    // The trusted folder holds the shell's own data (history, sessions). It is created
    // fresh for a switch into split, and removed whenever the shell is not in it.
    let trusted = trusted_folder_in(local);
    let fresh = plan.run_mode == Mode::Split && plan.hydration.is_some();
    if (plan.run_mode == Mode::Single || fresh) && trusted.exists() {
        remove_trusted_folder(trusted, fresh);
    }
    *MARKER.lock().expect("marker lock") = Some(plan.marker.clone());
    Run {
        mode: plan.run_mode,
        local_data_dir: local.to_path_buf(),
        seed,
        hydration: plan.hydration,
        forced: false,
    }
}

/// The browser processes of the run that just ended can still hold files in the folder for a
/// moment after a restart. A fresh trusted folder is needed before the shell windows exist, so
/// that removal waits (a few seconds at most); the leftover folder of a run that is back in
/// the single environment is only privacy hygiene and is retried in the background.
fn remove_trusted_folder(trusted: PathBuf, wait: bool) {
    const ATTEMPTS: u32 = 40;
    let attempt = |trusted: &Path| match std::fs::remove_dir_all(trusted) {
        Ok(()) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
    };
    if attempt(&trusted) {
        return;
    }
    let retry = move || {
        for _ in 0..ATTEMPTS {
            std::thread::sleep(Duration::from_millis(250));
            if attempt(&trusted) {
                return;
            }
        }
        eprintln!("[shell-isolation] could not remove the trusted folder");
    };
    if wait {
        retry();
    } else {
        std::thread::spawn(retry);
    }
}

/// The store's entries as the seed, after proving they are the ones the gate recorded.
fn load_seed(local: &Path, hydration: &Hydration) -> Result<String, String> {
    let path = crate::shell_state_store::store_file_in(local);
    let check = crate::shell_state_store::disk_check_at(&path)?;
    if check.digest != hydration.expected.digest {
        return Err("the store is not the one the migration gate recorded".to_string());
    }
    let snapshot = crate::shell_state_store::snapshot_at(&path)?;
    let live = snapshot
        .entries
        .iter()
        .filter(|(key, _)| !crate::shell_state_store::is_excluded(key));
    let digest = crate::shell_state_store::content_digest(
        live.clone()
            .map(|(key, value)| (key.as_str(), value.as_str())),
    );
    if digest != hydration.expected.digest {
        return Err("the seed does not match the recorded digest".to_string());
    }
    let entries = live
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    Ok(seed_script(&hydration.id, &entries))
}

// ---- marker updates at runtime ------------------------------------------------------------

fn update_marker(change: impl FnOnce(&mut Marker)) -> Result<Marker, String> {
    let local = run()
        .map(|run| run.local_data_dir.clone())
        .ok_or("shell isolation is not initialised")?;
    let mut guard = MARKER
        .lock()
        .map_err(|_| "marker lock poisoned".to_string())?;
    let mut marker = guard.clone().unwrap_or_default();
    change(&mut marker);
    marker.changed_at = now_secs();
    write_marker(&local, &marker)?;
    *guard = Some(marker.clone());
    Ok(marker)
}

/// Undoes a switch that did not verify: back to the source environment (its data was never
/// touched), a notice for the user, restart.
fn roll_back(app: &tauri::AppHandle, notice: &str) {
    let notice = notice.to_string();
    let result = update_marker(|marker| {
        marker.pending = None;
        marker.attempts = 0;
        marker.expected = None;
        marker.notice = Some(notice);
    });
    if let Err(error) = result {
        eprintln!("[shell-isolation] rollback could not write the marker: {error}");
    }
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(300));
        app.restart();
    });
}

/// Starts the 15 s watchdog of a hydrating run. Call from `setup`, after the shell
/// windows were created.
pub fn start_hydration_watchdog(app: &tauri::AppHandle) {
    if !hydrating() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let deadline = Instant::now() + HYDRATION_TIMEOUT;
        while Instant::now() < deadline {
            if HYDRATED.load(Ordering::Acquire) {
                return;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        if !HYDRATED.load(Ordering::Acquire) {
            eprintln!("[shell-isolation] hydration did not report in time; rolling back");
            roll_back(&app, "hydration-timeout");
        }
    });
}

// ---- commands: status and hydration --------------------------------------------------------

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IsolationStatus {
    mode: Mode,
    pending: Option<Mode>,
    notice: Option<String>,
    hydrating: bool,
    forced: bool,
}

#[tauri::command]
pub fn shell_isolation_status() -> IsolationStatus {
    let marker = MARKER.lock().ok().and_then(|guard| guard.clone());
    IsolationStatus {
        mode: mode(),
        pending: marker.as_ref().and_then(|marker| marker.pending),
        notice: marker.and_then(|marker| marker.notice),
        hydrating: hydrating(),
        forced: run().is_some_and(|run| run.forced),
    }
}

#[tauri::command]
pub fn shell_isolation_ack_notice() -> Result<(), String> {
    update_marker(|marker| marker.notice = None).map(|_| ())
}

/// Kept for the shell's chrome webview code, which asks whether it must be created natively.
#[tauri::command]
pub fn shell_split_enabled() -> bool {
    split_active()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HydrationReport {
    id: String,
    digest: String,
    key_count: usize,
}

/// The shell reports what its `localStorage` holds after the seed was applied. Equal to the
/// gate's record: the switch is final. Anything else: rollback.
#[tauri::command]
pub fn shell_isolation_hydrated(
    app: tauri::AppHandle,
    report: HydrationReport,
) -> Result<bool, String> {
    let Some(run) = run() else {
        return Err("shell isolation is not initialised".into());
    };
    let Some(hydration) = &run.hydration else {
        return Ok(false);
    };
    if HYDRATED.load(Ordering::Acquire) {
        return Ok(true);
    }
    if report.id != hydration.id {
        return Err("the hydration report is for another attempt".into());
    }
    if report.digest != hydration.expected.digest
        || report.key_count != hydration.expected.key_count
    {
        eprintln!(
            "[shell-isolation] hydration mismatch (keys {} vs {}); rolling back",
            report.key_count, hydration.expected.key_count
        );
        roll_back(&app, "hydration-mismatch");
        return Ok(false);
    }
    let target = hydration.target;
    update_marker(|marker| {
        marker.mode = target;
        marker.pending = None;
        marker.attempts = 0;
        marker.expected = None;
        marker.notice = None;
    })?;
    HYDRATED.store(true, Ordering::Release);
    if target == Mode::Split {
        clear_browsing_residue(&app);
    }
    Ok(true)
}

/// After a switch into split the browsing profile still holds the shell's old
/// `localStorage` (the data was never touched, that is what makes a rollback safe).
/// Extensions run in that profile, so once the switch is final it is cleared there: a
/// hidden webview with no IPC loads a page of the app's origin that clears its storage.
fn clear_browsing_residue(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let label = "extension-residue-cleanup";
        let url: tauri::Url = match "http://tauri.localhost/residue-clear.html".parse() {
            Ok(url) => url,
            Err(_) => return,
        };
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let built = tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::External(url))
            .title("")
            .inner_size(1.0, 1.0)
            .decorations(false)
            .visible(false)
            .focused(false)
            .skip_taskbar(true)
            .browser_extensions_enabled(true)
            .on_navigation(move |target| {
                if target.as_str() == "about:blank#residue-cleared" {
                    let _ = tx.send(());
                }
                matches!(target.host_str(), Some("tauri.localhost")) || target.scheme() == "about"
            })
            .build();
        match built {
            Ok(window) => {
                if rx.recv_timeout(Duration::from_secs(20)).is_err() {
                    eprintln!("[shell-isolation] the residue cleanup did not finish");
                }
                let _ = window.destroy();
            }
            Err(error) => eprintln!("[shell-isolation] residue cleanup could not start: {error}"),
        }
    });
}

// ---- the migration gate --------------------------------------------------------------------

/// Whether `label` is a webview of the trusted shell: the ones the `shell-state-store`
/// capability covers.
pub(crate) fn is_shell_label(label: &str) -> bool {
    label == "main" || label.starts_with("nebula-chrome") || label.starts_with("nebula-window-")
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BarrierAck {
    id: String,
    phase: String,
    #[serde(default)]
    digest: String,
    #[serde(default)]
    key_count: usize,
    #[serde(default)]
    pending_empty: bool,
    #[serde(default)]
    writes_since: u64,
    #[serde(default)]
    unmirrorable: Vec<String>,
    #[serde(default)]
    error: Option<String>,
}

struct BarrierState {
    id: String,
    expected: Vec<String>,
    drain: HashMap<String, BarrierAck>,
    commit: HashMap<String, BarrierAck>,
}

static BARRIER: LazyLock<Mutex<Option<BarrierState>>> = LazyLock::new(|| Mutex::new(None));
static BARRIER_CV: Condvar = Condvar::new();

/// While the gate runs no new shell window may appear: it would not be part of the proof.
pub fn barrier_open() -> bool {
    BARRIER.lock().map_or(true, |guard| guard.is_some())
}

#[tauri::command]
pub fn shell_isolation_barrier_ack(webview: tauri::Webview, ack: BarrierAck) -> Result<(), String> {
    let label = webview.label().to_string();
    if !is_shell_label(&label) {
        return Err("not a shell webview".into());
    }
    let mut guard = BARRIER
        .lock()
        .map_err(|_| "barrier lock poisoned".to_string())?;
    let Some(state) = guard.as_mut() else {
        return Err("no barrier is open".into());
    };
    if state.id != ack.id || !state.expected.contains(&label) {
        return Err("not part of this barrier".into());
    }
    match ack.phase.as_str() {
        "drain" => state.drain.insert(label, ack),
        "commit" => state.commit.insert(label, ack),
        _ => return Err("unknown barrier phase".into()),
    };
    BARRIER_CV.notify_all();
    Ok(())
}

fn new_barrier_id() -> String {
    format!(
        "{}-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis()),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateFailure {
    step: &'static str,
    message: String,
}

fn fail<T>(step: &'static str, message: impl Into<String>) -> Result<T, GateFailure> {
    Err(GateFailure {
        step,
        message: message.into(),
    })
}

fn emit_phase(app: &tauri::AppHandle, labels: &[String], id: &str, phase: &str) {
    for label in labels {
        let _ = app.emit_to(
            label.as_str(),
            "nebula-shell-barrier",
            serde_json::json!({ "id": id, "phase": phase }),
        );
    }
}

fn wait_for_acks(phase: &'static str) -> Result<Vec<(String, BarrierAck)>, GateFailure> {
    let deadline = Instant::now() + BARRIER_TIMEOUT;
    let mut guard = BARRIER.lock().map_err(|_| GateFailure {
        step: phase,
        message: "barrier lock poisoned".into(),
    })?;
    loop {
        let Some(state) = guard.as_ref() else {
            return fail(phase, "the barrier was closed");
        };
        let acks = if phase == "drain" {
            &state.drain
        } else {
            &state.commit
        };
        if state.expected.iter().all(|label| acks.contains_key(label)) {
            return Ok(state
                .expected
                .iter()
                .map(|label| (label.clone(), acks[label].clone()))
                .collect());
        }
        let now = Instant::now();
        if now >= deadline {
            let missing: Vec<&String> = state
                .expected
                .iter()
                .filter(|l| !acks.contains_key(*l))
                .collect();
            return fail(
                phase,
                format!("no answer from {missing:?} within {BARRIER_TIMEOUT:?}"),
            );
        }
        guard = BARRIER_CV
            .wait_timeout(guard, deadline - now)
            .map_err(|_| GateFailure {
                step: phase,
                message: "barrier lock poisoned".into(),
            })?
            .0;
    }
}

fn close_barrier(app: &tauri::AppHandle, labels: &[String], id: &str, resume: bool) {
    if resume {
        emit_phase(app, labels, id, "abort");
    }
    if let Ok(mut guard) = BARRIER.lock() {
        *guard = None;
    }
    crate::shell_state_store::close_barrier();
}

/// One round of the gate. `Ok(Some(expected))`: passed, nothing wrote since.
/// `Ok(None)`: a shell wrote after it had answered; run another round.
fn gate_round(
    app: &tauri::AppHandle,
    labels: &[String],
    id: &str,
) -> Result<Option<Expected>, GateFailure> {
    emit_phase(app, labels, id, "drain");
    let drained = wait_for_acks("drain")?;

    for (label, ack) in &drained {
        if let Some(error) = &ack.error {
            return fail("drain", format!("{label}: {error}"));
        }
        if !ack.pending_empty {
            return fail("drain", format!("{label} still had changes waiting"));
        }
        if !ack.unmirrorable.is_empty() {
            return fail(
                "agreement",
                format!(
                    "{label}: these values cannot be carried over: {}",
                    ack.unmirrorable.join(", ")
                ),
            );
        }
    }
    let (generation, key_count, store_digest) = crate::shell_state_store::live_digest(app)
        .map_err(|message| GateFailure {
            step: "agreement",
            message,
        })?;
    for (label, ack) in &drained {
        if ack.digest != store_digest {
            return fail(
                "agreement",
                format!(
                    "{label} holds different state than the store ({} keys vs {key_count})",
                    ack.key_count
                ),
            );
        }
    }
    let disk = crate::shell_state_store::store_file(app)
        .and_then(|path| crate::shell_state_store::disk_check_at(&path))
        .map_err(|message| GateFailure {
            step: "disk-check",
            message,
        })?;
    if disk.digest != store_digest || disk.generation != generation {
        return fail(
            "disk-check",
            "the file on disk is not what the store holds in memory",
        );
    }

    emit_phase(app, labels, id, "commit");
    let committed = wait_for_acks("commit")?;
    if committed.iter().any(|(_, ack)| ack.writes_since > 0) {
        return Ok(None);
    }
    Ok(Some(Expected {
        store_generation: generation,
        key_count,
        digest: store_digest,
    }))
}

/// Runs the gate and, when it passes, writes the marker and restarts into `target`.
fn run_switch(app: &tauri::AppHandle, target: Mode) -> Result<(), GateFailure> {
    let current = mode();
    if run().is_some_and(|run| run.forced) {
        return fail("precondition", "the mode is forced by the environment");
    }
    if target == current {
        return fail("precondition", "Nebula already runs in that mode");
    }
    if hydrating() {
        return fail(
            "precondition",
            "the previous switch is still being verified",
        );
    }
    if MARKER
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|marker| marker.pending.is_some()))
        .unwrap_or(false)
    {
        return fail("precondition", "a switch is already pending");
    }
    let labels: Vec<String> = {
        let mut labels: Vec<String> = app
            .webviews()
            .into_keys()
            .filter(|label| is_shell_label(label))
            .collect();
        labels.sort();
        labels
    };
    if labels.is_empty() {
        return fail("precondition", "no shell webview is available");
    }

    for _round in 0..BARRIER_ROUNDS {
        let id = new_barrier_id();
        crate::shell_state_store::open_barrier(&id).map_err(|message| GateFailure {
            step: "barrier",
            message,
        })?;
        {
            let mut guard = BARRIER.lock().map_err(|_| GateFailure {
                step: "barrier",
                message: "barrier lock poisoned".into(),
            })?;
            *guard = Some(BarrierState {
                id: id.clone(),
                expected: labels.clone(),
                drain: HashMap::new(),
                commit: HashMap::new(),
            });
        }
        match gate_round(app, &labels, &id) {
            Ok(Some(expected)) => {
                // The barrier stays open: nothing may write between the proof and the restart.
                update_marker(|marker| {
                    marker.pending = Some(target);
                    marker.attempts = 0;
                    marker.expected = Some(expected);
                    marker.notice = None;
                })
                .map_err(|message| {
                    close_barrier(app, &labels, &id, true);
                    GateFailure {
                        step: "marker",
                        message,
                    }
                })?;
                let app = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_millis(300));
                    app.restart();
                });
                return Ok(());
            }
            Ok(None) => close_barrier(app, &labels, &id, true),
            Err(failure) => {
                close_barrier(app, &labels, &id, true);
                return Err(failure);
            }
        }
    }
    fail("commit", "the shell kept changing; try again in a moment")
}

/// Asks to move the shell into `target` ("split" or "single"). Resolves when the gate has
/// passed and the restart is scheduled; rejects with the step that failed otherwise.
#[tauri::command]
pub async fn shell_isolation_switch(
    app: tauri::AppHandle,
    target: Mode,
) -> Result<(), GateFailure> {
    tauri::async_runtime::spawn_blocking(move || run_switch(&app, target))
        .await
        .map_err(|error| GateFailure {
            step: "internal",
            message: error.to_string(),
        })?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expected() -> Expected {
        Expected {
            store_generation: 4,
            key_count: 3,
            digest: "abc".into(),
        }
    }

    fn pending(target: Mode, attempts: u32) -> Marker {
        Marker {
            mode: target.other(),
            pending: Some(target),
            attempts,
            expected: Some(expected()),
            changed_at: 100,
            ..Marker::default()
        }
    }

    #[test]
    fn a_missing_or_settled_marker_changes_nothing() {
        let plan = plan(Marker::default());
        assert_eq!(plan.run_mode, Mode::Single);
        assert!(plan.hydration.is_none() && !plan.write_marker);

        let settled = Marker {
            mode: Mode::Split,
            ..Marker::default()
        };
        let plan = super::plan(settled);
        assert_eq!(plan.run_mode, Mode::Split);
        assert!(plan.hydration.is_none() && !plan.write_marker);
    }

    #[test]
    fn a_pending_switch_hydrates_the_target_and_counts_the_attempt_first() {
        let plan = plan(pending(Mode::Split, 0));
        assert_eq!(plan.run_mode, Mode::Split);
        let hydration = plan.hydration.expect("hydration");
        assert_eq!(hydration.target, Mode::Split);
        assert_eq!(hydration.id, "100-1");
        assert_eq!(hydration.expected, expected());
        assert!(plan.write_marker);
        assert_eq!(plan.marker.attempts, 1);
        // The marker still names the source: that is where a rollback goes.
        assert_eq!(plan.marker.mode, Mode::Single);
        assert_eq!(plan.marker.pending, Some(Mode::Split));
    }

    #[test]
    fn a_run_that_died_without_reporting_gets_one_more_attempt_then_the_switch_is_abandoned() {
        let second = plan(pending(Mode::Split, 1));
        assert_eq!(second.run_mode, Mode::Split);
        assert_eq!(second.hydration.expect("hydration").id, "100-2");

        let abandoned = plan(pending(Mode::Split, MAX_ATTEMPTS));
        assert_eq!(
            abandoned.run_mode,
            Mode::Single,
            "back in the source environment"
        );
        assert!(abandoned.hydration.is_none() && abandoned.write_marker);
        assert_eq!(abandoned.marker.pending, None);
        assert_eq!(abandoned.marker.notice.as_deref(), Some("switch-abandoned"));
    }

    #[test]
    fn a_pending_switch_without_a_recorded_digest_is_never_run() {
        let mut marker = pending(Mode::Split, 0);
        marker.expected = None;
        let plan = plan(marker);
        assert_eq!(plan.run_mode, Mode::Single);
        assert!(plan.hydration.is_none());
        assert_eq!(plan.marker.notice.as_deref(), Some("switch-abandoned"));
    }

    #[test]
    fn a_switch_to_the_mode_already_in_use_is_dropped() {
        let mut marker = pending(Mode::Split, 0);
        marker.mode = Mode::Split;
        assert_eq!(plan(marker).run_mode, Mode::Split);
    }

    #[test]
    fn the_marker_round_trips_and_bad_files_mean_single() {
        let dir = std::env::temp_dir().join(format!("nebula-isolation-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(read_marker(&dir), Marker::default());
        let marker = pending(Mode::Split, 1);
        write_marker(&dir, &marker).unwrap();
        assert_eq!(read_marker(&dir), marker);
        std::fs::write(marker_path(&dir), b"not json").unwrap();
        assert_eq!(read_marker(&dir), Marker::default());
        std::fs::write(marker_path(&dir), br#"{"schema":99,"mode":"split"}"#).unwrap();
        assert_eq!(
            read_marker(&dir),
            Marker::default(),
            "a newer schema is not guessed at"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_seed_script_is_inert_outside_the_app_origin_and_applies_once_per_id() {
        let mut entries = std::collections::BTreeMap::new();
        entries.insert("a".to_string(), "va\"lue\u{2028}</script>".to_string());
        let script = seed_script("100-1", &entries);
        assert!(script.contains("location.hostname !== 'tauri.localhost'"));
        assert!(script.contains("__nebula_hydration_id"));
        assert!(script.contains("\"100-1\""));
        // The value is embedded as JSON, so quotes and line separators cannot end the literal.
        assert!(script.contains(r#"va\"lue"#));
    }

    #[test]
    fn only_the_shell_webviews_are_shell_labels() {
        for label in [
            "main",
            "nebula-chrome",
            "nebula-chrome-nebula-window-x",
            "nebula-window-x",
        ] {
            assert!(is_shell_label(label), "{label}");
        }
        for label in [
            "nebula-tab-1",
            "nebula-popup-content-1",
            "nebula-google-oauth-1",
            "extension-browse-host",
            "extension-residue-cleanup",
        ] {
            assert!(!is_shell_label(label), "{label}");
        }
    }
}
