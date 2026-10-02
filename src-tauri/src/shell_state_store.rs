//! A Rust-owned, versioned, DPAPI-protected mirror of the shell's `localStorage`.
//!
//! The shell keeps all of its state in `localStorage`, inside the WebView2 profile the
//! browser tabs also use. That is fine as long as there is one profile; it stops being
//! fine the day the shell has to move to another profile (see
//! `docs/EXTENSION_OPT_IN_SPLIT.md`), because copying a profile's leveldb files is not a
//! supported operation. So the shell reports every `localStorage` change here, and this
//! module keeps the latest value of every key in a file the app owns.
//!
//! Nothing reads the store back yet: this release only mirrors. Rules that make it safe
//! to rely on later:
//!
//! - one writer (a mutex), atomic replace with a kept previous copy, DPAPI protection;
//! - a checksum over the entries, so a damaged file is noticed and the previous copy used;
//! - last writer wins per key by `seq`, removals leave a tombstone so a late `set` from
//!   another window cannot bring a removed key back;
//! - no "clear" operation exists over IPC: emptying the store is `wipe`, a native action;
//! - hard limits on key size, value size, store size, batch size and write rate;
//! - the crash marker of the current run is never mirrored.
use std::collections::{BTreeMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

const SCHEMA: u32 = 1;
const FILE_NAME: &str = "shell-state.v1.dpapi";
const MAX_KEY_BYTES: usize = 256;
const MAX_VALUE_BYTES: usize = 2 * 1024 * 1024;
const MAX_STORE_BYTES: usize = 8 * 1024 * 1024;
const MAX_OPS_PER_BATCH: usize = 512;
const MAX_TOMBSTONES: usize = 512;
const RATE_WINDOW: Duration = Duration::from_secs(10);
const MAX_APPLIES_PER_WINDOW: usize = 40;

/// Keys the store never holds. The run-state marker describes the current process; a
/// restored copy would be a lie.
const EXCLUDED_KEYS: &[&str] = &["nebula-browser-run-state-v1"];

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct Entry {
    /// `None` is a tombstone: the key was removed at `seq`.
    v: Option<String>,
    seq: u64,
}

#[derive(Clone, Debug, Default, PartialEq)]
struct State {
    generation: u64,
    entries: BTreeMap<String, Entry>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    schema: u32,
    generation: u64,
    written_at: u64,
    entries: BTreeMap<String, Entry>,
    checksum: String,
}

/// One change reported by a shell. `seq` orders changes to the same key across windows.
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
pub enum Op {
    Set {
        key: String,
        value: String,
        seq: u64,
    },
    Remove {
        key: String,
        seq: u64,
    },
}

impl Op {
    fn key(&self) -> &str {
        match self {
            Op::Set { key, .. } | Op::Remove { key, .. } => key,
        }
    }
}

#[derive(Debug, Default, PartialEq)]
struct Outcome {
    changed: bool,
    accepted: usize,
    skipped: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    generation: u64,
    accepted: usize,
    skipped: Vec<String>,
    key_count: usize,
    bytes: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreStatus {
    generation: u64,
    key_count: usize,
    bytes: usize,
    /// Why the store does not write, if it does not (a newer app wrote it, or the disk
    /// refused). The mirror stays out of the way instead of guessing.
    disabled: Option<String>,
}

fn checksum(entries: &BTreeMap<String, Entry>) -> String {
    let canonical = serde_json::to_string(entries).unwrap_or_default();
    format!("{:x}", Sha256::digest(canonical.as_bytes()))
}

fn live_bytes(entries: &BTreeMap<String, Entry>) -> usize {
    entries
        .iter()
        .filter_map(|(key, entry)| entry.v.as_ref().map(|value| key.len() + value.len()))
        .sum()
}

fn live_count(entries: &BTreeMap<String, Entry>) -> usize {
    entries.values().filter(|entry| entry.v.is_some()).count()
}

impl State {
    fn apply(&mut self, ops: &[Op]) -> Outcome {
        let mut outcome = Outcome::default();
        if ops.len() > MAX_OPS_PER_BATCH {
            outcome.skipped.push(format!(
                "batch of {} operations exceeds {MAX_OPS_PER_BATCH}",
                ops.len()
            ));
            return outcome;
        }
        for op in ops {
            let key = op.key();
            if key.is_empty() || key.len() > MAX_KEY_BYTES {
                outcome.skipped.push("key size".to_string());
                continue;
            }
            if EXCLUDED_KEYS.contains(&key) {
                outcome.skipped.push(format!("excluded key {key}"));
                continue;
            }
            match op {
                Op::Set { key, value, seq } => {
                    if value.len() > MAX_VALUE_BYTES {
                        outcome.skipped.push(format!("value of {key} is too large"));
                        continue;
                    }
                    let current = self.entries.get(key);
                    if current.is_some_and(|entry| entry.seq >= *seq) {
                        continue;
                    }
                    if current.is_some_and(|entry| entry.v.as_deref() == Some(value.as_str())) {
                        // Same value, newer report: nothing to write.
                        continue;
                    }
                    let previous = current
                        .and_then(|entry| entry.v.as_ref())
                        .map_or(0, |old| key.len() + old.len());
                    if live_bytes(&self.entries) - previous + key.len() + value.len()
                        > MAX_STORE_BYTES
                    {
                        outcome
                            .skipped
                            .push(format!("store is full, {key} not kept"));
                        continue;
                    }
                    self.entries.insert(
                        key.clone(),
                        Entry {
                            v: Some(value.clone()),
                            seq: *seq,
                        },
                    );
                    outcome.changed = true;
                    outcome.accepted += 1;
                }
                Op::Remove { key, seq } => {
                    let current = self.entries.get(key);
                    if current.is_some_and(|entry| entry.seq >= *seq) {
                        continue;
                    }
                    if current.is_none() {
                        // Nothing to remove, and a tombstone for an unknown key would
                        // only fill the file.
                        continue;
                    }
                    if current.is_some_and(|entry| entry.v.is_none()) {
                        continue;
                    }
                    self.entries
                        .insert(key.clone(), Entry { v: None, seq: *seq });
                    outcome.changed = true;
                    outcome.accepted += 1;
                }
            }
        }
        self.prune_tombstones();
        outcome
    }

    /// Keep the newest tombstones: they only have to outlive a late report from another
    /// window, not forever.
    fn prune_tombstones(&mut self) {
        let mut tombstones: Vec<(u64, String)> = self
            .entries
            .iter()
            .filter(|(_, entry)| entry.v.is_none())
            .map(|(key, entry)| (entry.seq, key.clone()))
            .collect();
        if tombstones.len() <= MAX_TOMBSTONES {
            return;
        }
        tombstones.sort_unstable();
        for (_, key) in tombstones.drain(..tombstones.len() - MAX_TOMBSTONES) {
            self.entries.remove(&key);
        }
    }

    fn encode(&self, written_at: u64) -> Result<Vec<u8>, String> {
        serde_json::to_vec(&Document {
            schema: SCHEMA,
            generation: self.generation,
            written_at,
            checksum: checksum(&self.entries),
            entries: self.entries.clone(),
        })
        .map_err(|error| format!("could not encode the shell state store: {error}"))
    }
}

enum Decoded {
    State(State),
    /// Written by a newer app. Never overwritten by this one.
    Newer(u32),
}

fn decode(bytes: &[u8]) -> Result<Decoded, String> {
    let document: Document = serde_json::from_slice(bytes)
        .map_err(|error| format!("the shell state store is not valid: {error}"))?;
    if document.schema > SCHEMA {
        return Ok(Decoded::Newer(document.schema));
    }
    if document.schema != SCHEMA {
        return Err(format!(
            "the shell state store has an unknown schema {}",
            document.schema
        ));
    }
    if checksum(&document.entries) != document.checksum {
        return Err("the shell state store failed its checksum".to_string());
    }
    Ok(Decoded::State(State {
        generation: document.generation,
        entries: document.entries,
    }))
}

// ---- persistence -------------------------------------------------------------------

fn load_from(path: &Path) -> Result<Option<Decoded>, String> {
    crate::secure_password_vault::read_with_backup_recovery(path, |encrypted| {
        let plain = crate::secure_password_vault::unprotect(encrypted)?;
        decode(&plain)
    })
}

fn save_to(path: &Path, state: &State) -> Result<(), String> {
    let written_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_secs());
    let plain = state.encode(written_at)?;
    let protected = crate::secure_password_vault::protect(&plain)?;
    crate::secure_password_vault::durable_replace(path, &protected, true)
}

/// A file that cannot be read is kept aside for diagnosis before it is replaced.
fn keep_unreadable(path: &Path) {
    if path.is_file() {
        let mut aside = path.as_os_str().to_os_string();
        aside.push(".unreadable");
        let _ = std::fs::copy(path, PathBuf::from(aside));
    }
}

// ---- the store ---------------------------------------------------------------------

#[derive(Default)]
struct Runtime {
    state: Option<State>,
    disabled: Option<String>,
    applies: VecDeque<Instant>,
}

static STORE: LazyLock<Mutex<Runtime>> = LazyLock::new(|| Mutex::new(Runtime::default()));

fn store_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    // Local, not roaming: the data is protected for this user on this machine, and it
    // can be large.
    let directory = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(FILE_NAME))
}

impl Runtime {
    fn ensure_loaded(&mut self, path: &Path) {
        if self.state.is_some() || self.disabled.is_some() {
            return;
        }
        match load_from(path) {
            Ok(Some(Decoded::State(state))) => self.state = Some(state),
            Ok(Some(Decoded::Newer(schema))) => {
                self.disabled = Some(format!(
                    "the store was written by a newer app (schema {schema})"
                ));
            }
            Ok(None) => self.state = Some(State::default()),
            Err(error) => {
                eprintln!("[shell-state] {error}; starting an empty store");
                keep_unreadable(path);
                self.state = Some(State::default());
            }
        }
    }

    fn apply(&mut self, path: &Path, ops: &[Op], now: Instant) -> Result<ApplyResult, String> {
        self.ensure_loaded(path);
        if let Some(reason) = &self.disabled {
            return Err(format!("the shell state store is disabled: {reason}"));
        }
        while self
            .applies
            .front()
            .is_some_and(|at| now.duration_since(*at) > RATE_WINDOW)
        {
            self.applies.pop_front();
        }
        if self.applies.len() >= MAX_APPLIES_PER_WINDOW {
            return Err("the shell state store is receiving changes too fast".to_string());
        }
        self.applies.push_back(now);

        let current = self.state.as_ref().expect("loaded above");
        let mut next = current.clone();
        let outcome = next.apply(ops);
        if outcome.changed {
            next.generation += 1;
            // The in-memory copy follows the disk: a failed write changes nothing.
            save_to(path, &next)?;
            self.state = Some(next);
        }
        let state = self.state.as_ref().expect("loaded above");
        Ok(ApplyResult {
            generation: state.generation,
            accepted: outcome.accepted,
            skipped: outcome.skipped,
            key_count: live_count(&state.entries),
            bytes: live_bytes(&state.entries),
        })
    }

    fn status(&mut self, path: &Path) -> StoreStatus {
        self.ensure_loaded(path);
        let (generation, key_count, bytes) = self.state.as_ref().map_or((0, 0, 0), |state| {
            (
                state.generation,
                live_count(&state.entries),
                live_bytes(&state.entries),
            )
        });
        StoreStatus {
            generation,
            key_count,
            bytes,
            disabled: self.disabled.clone(),
        }
    }

    /// Native factory reset: the store, its previous copy and its bookkeeping go.
    fn wipe(&mut self, path: &Path) -> Result<(), String> {
        let mut backup = path.as_os_str().to_os_string();
        backup.push(".bak");
        let mut aside = path.as_os_str().to_os_string();
        aside.push(".unreadable");
        for file in [
            path.to_path_buf(),
            PathBuf::from(backup),
            PathBuf::from(aside),
        ] {
            match std::fs::remove_file(&file) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("could not remove {}: {error}", file.display())),
            }
        }
        self.state = Some(State::default());
        self.disabled = None;
        self.applies.clear();
        Ok(())
    }
}

fn locked() -> Result<std::sync::MutexGuard<'static, Runtime>, String> {
    STORE
        .lock()
        .map_err(|_| "the shell state store lock was poisoned".to_string())
}

/// Reports a batch of `localStorage` changes. Only trusted shell webviews can call it
/// (see `capabilities/shell-state-store.json`).
#[tauri::command]
pub async fn shell_store_apply(app: tauri::AppHandle, ops: Vec<Op>) -> Result<ApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = store_path(&app)?;
        locked()?.apply(&path, &ops, Instant::now())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn shell_store_status(app: tauri::AppHandle) -> Result<StoreStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = store_path(&app)?;
        Ok(locked()?.status(&path))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Factory reset. Called from the shell after it has cleared its own storage, so the
/// mirror does not keep what the user just erased.
#[tauri::command]
pub async fn shell_store_wipe(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = store_path(&app)?;
        locked()?.wipe(&path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn set(key: &str, value: &str, seq: u64) -> Op {
        Op::Set {
            key: key.into(),
            value: value.into(),
            seq,
        }
    }

    fn remove(key: &str, seq: u64) -> Op {
        Op::Remove {
            key: key.into(),
            seq,
        }
    }

    fn live(state: &State, key: &str) -> Option<String> {
        state.entries.get(key).and_then(|entry| entry.v.clone())
    }

    #[test]
    fn set_and_remove_follow_seq_per_key() {
        let mut state = State::default();
        state.apply(&[set("a", "1", 10), set("b", "x", 10)]);
        state.apply(&[set("a", "stale", 5)]);
        assert_eq!(live(&state, "a").as_deref(), Some("1"));
        state.apply(&[set("a", "2", 11)]);
        assert_eq!(live(&state, "a").as_deref(), Some("2"));
        state.apply(&[remove("a", 12)]);
        assert_eq!(live(&state, "a"), None);
        // A late set from another window cannot bring a removed key back.
        state.apply(&[set("a", "late", 11)]);
        assert_eq!(live(&state, "a"), None);
        // A genuinely newer one can.
        state.apply(&[set("a", "again", 13)]);
        assert_eq!(live(&state, "a").as_deref(), Some("again"));
    }

    #[test]
    fn identical_reports_and_unknown_removals_change_nothing() {
        let mut state = State::default();
        assert!(state.apply(&[set("a", "1", 10)]).changed);
        assert!(!state.apply(&[set("a", "1", 20)]).changed);
        assert!(!state.apply(&[remove("never-seen", 30)]).changed);
        assert_eq!(state.entries.len(), 1);
        assert!(state.apply(&[remove("a", 40)]).changed);
        assert!(!state.apply(&[remove("a", 50)]).changed);
    }

    #[test]
    fn limits_are_enforced_and_reported() {
        let mut state = State::default();
        let long_key = "k".repeat(MAX_KEY_BYTES + 1);
        let big = "v".repeat(MAX_VALUE_BYTES + 1);
        let outcome = state.apply(&[
            set(&long_key, "x", 1),
            set("", "x", 1),
            set("big", &big, 1),
            set("nebula-browser-run-state-v1", "{}", 1),
            set("ok", "fine", 1),
        ]);
        assert_eq!(outcome.accepted, 1);
        assert_eq!(outcome.skipped.len(), 4);
        assert_eq!(live(&state, "ok").as_deref(), Some("fine"));

        let too_many: Vec<Op> = (0..=MAX_OPS_PER_BATCH)
            .map(|index| set(&format!("key-{index}"), "x", 2))
            .collect();
        let before = state.clone();
        let outcome = state.apply(&too_many);
        assert!(!outcome.changed);
        assert_eq!(state, before);
    }

    #[test]
    fn the_store_size_is_capped() {
        let mut state = State::default();
        let chunk = "v".repeat(MAX_VALUE_BYTES - 1000);
        let ops: Vec<Op> = (0..6)
            .map(|i| set(&format!("big-{i}"), &chunk, 1))
            .collect();
        let outcome = state.apply(&ops);
        assert_eq!(outcome.accepted, 4);
        assert!(live_bytes(&state.entries) <= MAX_STORE_BYTES);
        // Replacing a value is measured against the value it replaces.
        let replaced = state.apply(&[set("big-0", &"w".repeat(MAX_VALUE_BYTES - 1000), 2)]);
        assert_eq!(replaced.accepted, 1);
    }

    #[test]
    fn tombstones_are_bounded_and_keep_the_newest() {
        let mut state = State::default();
        for round in 0..2u64 {
            let sets: Vec<Op> = (0..MAX_OPS_PER_BATCH)
                .map(|i| set(&format!("r{round}-k{i}"), "x", 1))
                .collect();
            state.apply(&sets);
            let removals: Vec<Op> = (0..MAX_OPS_PER_BATCH)
                .map(|i| remove(&format!("r{round}-k{i}"), 100 + round * 1000 + i as u64))
                .collect();
            state.apply(&removals);
        }
        let tombstones = state.entries.values().filter(|e| e.v.is_none()).count();
        assert_eq!(tombstones, MAX_TOMBSTONES);
        // The newest removals (round 1) survive, the oldest (round 0) were dropped first.
        assert!(state
            .entries
            .contains_key(&format!("r1-k{}", MAX_OPS_PER_BATCH - 1)));
        assert!(!state.entries.contains_key("r0-k0"));
    }

    #[test]
    fn encode_decode_round_trip_and_checksum() {
        let mut state = State::default();
        state.apply(&[
            set("a", "1", 1),
            set("b", "ü😀", 2),
            set("c", "3", 3),
            remove("c", 4),
        ]);
        state.generation = 7;
        let bytes = state.encode(123).unwrap();
        let Ok(Decoded::State(back)) = decode(&bytes) else {
            panic!("decode failed");
        };
        assert_eq!(back, state);

        let mut document: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        document["entries"]["a"]["v"] = serde_json::json!("tampered");
        assert!(decode(document.to_string().as_bytes()).is_err());
        assert!(decode(b"not json").is_err());
    }

    #[test]
    fn a_newer_schema_is_recognised_not_misread() {
        let json = serde_json::json!({
            "schema": SCHEMA + 1, "generation": 1, "writtenAt": 1,
            "entries": {}, "checksum": "whatever"
        });
        assert!(matches!(
            decode(json.to_string().as_bytes()),
            Ok(Decoded::Newer(_))
        ));
    }

    #[cfg(target_os = "windows")]
    mod on_disk {
        use super::*;

        fn temp_path(name: &str) -> PathBuf {
            let dir = std::env::temp_dir()
                .join(format!("nebula-shell-state-{}-{name}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            dir.join(FILE_NAME)
        }

        fn runtime_apply(runtime: &mut Runtime, path: &Path, ops: &[Op]) -> ApplyResult {
            runtime.apply(path, ops, Instant::now()).unwrap()
        }

        #[test]
        fn a_new_process_sees_what_the_last_one_wrote() {
            let path = temp_path("persist");
            let mut first = Runtime::default();
            let result = runtime_apply(&mut first, &path, &[set("a", "1", 1), set("b", "2", 1)]);
            assert_eq!((result.generation, result.key_count), (1, 2));
            runtime_apply(&mut first, &path, &[remove("a", 2)]);

            let mut second = Runtime::default();
            let status = second.status(&path);
            assert_eq!((status.generation, status.key_count), (2, 1));
            // The file is not readable as plain text: it is DPAPI-protected.
            let raw = std::fs::read(&path).unwrap();
            assert!(!String::from_utf8_lossy(&raw).contains("\"entries\""));
        }

        #[test]
        fn a_damaged_file_falls_back_to_the_previous_copy() {
            let path = temp_path("damaged");
            let mut runtime = Runtime::default();
            runtime_apply(&mut runtime, &path, &[set("a", "1", 1)]);
            runtime_apply(&mut runtime, &path, &[set("a", "2", 2)]);
            std::fs::write(&path, b"garbage").unwrap();

            let mut restarted = Runtime::default();
            let status = restarted.status(&path);
            assert_eq!(status.key_count, 1);
            assert_eq!(
                status.generation, 1,
                "the previous generation is the one restored"
            );
        }

        #[test]
        fn an_unreadable_store_starts_empty_and_keeps_a_copy_for_diagnosis() {
            let path = temp_path("both-bad");
            std::fs::write(&path, b"garbage").unwrap();
            let mut runtime = Runtime::default();
            let status = runtime.status(&path);
            assert_eq!(status.key_count, 0);
            let mut aside = path.as_os_str().to_os_string();
            aside.push(".unreadable");
            assert!(PathBuf::from(aside).is_file());
            // And it can be written again.
            runtime_apply(&mut runtime, &path, &[set("a", "1", 1)]);
        }

        #[test]
        fn a_failed_write_changes_nothing_in_memory() {
            let path = temp_path("failed-write");
            let mut runtime = Runtime::default();
            runtime_apply(&mut runtime, &path, &[set("a", "1", 1)]);
            // The folder disappears: the next write cannot succeed.
            std::fs::remove_dir_all(path.parent().unwrap()).unwrap();
            assert!(runtime
                .apply(&path, &[set("a", "2", 2)], Instant::now())
                .is_err());
            assert_eq!(
                live(runtime.state.as_ref().unwrap(), "a").as_deref(),
                Some("1")
            );
        }

        #[test]
        fn writes_are_rate_limited() {
            let path = temp_path("rate");
            let mut runtime = Runtime::default();
            let now = Instant::now();
            for index in 0..MAX_APPLIES_PER_WINDOW {
                runtime
                    .apply(
                        &path,
                        &[set("a", &index.to_string(), index as u64 + 1)],
                        now,
                    )
                    .unwrap();
            }
            assert!(runtime.apply(&path, &[set("a", "x", 1000)], now).is_err());
            // The window moves on.
            let later = now + RATE_WINDOW + Duration::from_secs(1);
            assert!(runtime.apply(&path, &[set("a", "x", 1000)], later).is_ok());
        }

        #[test]
        fn wipe_removes_the_store_and_its_copies() {
            let path = temp_path("wipe");
            let mut runtime = Runtime::default();
            runtime_apply(&mut runtime, &path, &[set("a", "1", 1)]);
            runtime_apply(&mut runtime, &path, &[set("a", "2", 2)]);
            runtime.wipe(&path).unwrap();
            assert!(!path.exists());
            let mut backup = path.as_os_str().to_os_string();
            backup.push(".bak");
            assert!(!PathBuf::from(backup).exists());
            assert_eq!(runtime.status(&path).key_count, 0);
            let mut fresh = Runtime::default();
            assert_eq!(fresh.status(&path).key_count, 0);
        }

        #[test]
        fn a_store_from_a_newer_app_is_left_alone() {
            let path = temp_path("newer");
            let json = serde_json::json!({
                "schema": SCHEMA + 1, "generation": 9, "writtenAt": 1,
                "entries": {}, "checksum": "x"
            });
            let protected =
                crate::secure_password_vault::protect(json.to_string().as_bytes()).unwrap();
            std::fs::write(&path, &protected).unwrap();
            let mut runtime = Runtime::default();
            assert!(runtime
                .apply(&path, &[set("a", "1", 1)], Instant::now())
                .is_err());
            assert!(runtime.status(&path).disabled.is_some());
            assert_eq!(std::fs::read(&path).unwrap(), protected);
        }
    }
}
