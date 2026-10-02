//! Self-documenting UI-thread stalls.
//!
//! A frozen window cannot log its own freeze, and Windows records nothing for a
//! hang the user ends manually. A background thread pings the UI thread; when a
//! ping is not answered in time it writes the breadcrumbs that entered but never
//! exited, which name the native operation the UI thread is stuck in.
use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};

const RING_CAPACITY: usize = 96;
const PING_INTERVAL: Duration = Duration::from_millis(250);
const STALL_THRESHOLD_MS: u64 = 1_500;

static START: OnceLock<Instant> = OnceLock::new();
static RING: LazyLock<Mutex<Ring>> = LazyLock::new(|| Mutex::new(Ring::default()));

fn now_ms() -> u64 {
    START.get_or_init(Instant::now).elapsed().as_millis() as u64
}

#[derive(Clone)]
struct Entry {
    seq: u64,
    name: &'static str,
    thread: String,
    enter_ms: u64,
    exit_ms: Option<u64>,
}

#[derive(Default)]
struct Ring {
    next_seq: u64,
    entries: VecDeque<Entry>,
}

/// Marks a native operation as running until the guard is dropped.
pub struct Breadcrumb {
    seq: u64,
}

pub fn enter(name: &'static str) -> Breadcrumb {
    let enter_ms = now_ms();
    let thread = format!("{:?}", std::thread::current().id());
    let mut ring = RING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let seq = ring.next_seq;
    ring.next_seq += 1;
    if ring.entries.len() >= RING_CAPACITY {
        ring.entries.pop_front();
    }
    ring.entries.push_back(Entry {
        seq,
        name,
        thread,
        enter_ms,
        exit_ms: None,
    });
    Breadcrumb { seq }
}

impl Drop for Breadcrumb {
    fn drop(&mut self) {
        let exit_ms = now_ms();
        let mut ring = RING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(entry) = ring.entries.iter_mut().rev().find(|e| e.seq == self.seq) {
            entry.exit_ms = Some(exit_ms);
        }
    }
}

fn describe(now: u64) -> serde_json::Value {
    let ring = RING.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let in_flight: Vec<_> = ring
        .entries
        .iter()
        .filter(|entry| entry.exit_ms.is_none())
        .map(|entry| {
            serde_json::json!({
                "name": entry.name,
                "thread": entry.thread,
                "runningMs": now.saturating_sub(entry.enter_ms),
            })
        })
        .collect();
    let recent: Vec<_> = ring
        .entries
        .iter()
        .filter(|entry| entry.exit_ms.is_some())
        .rev()
        .take(12)
        .map(|entry| {
            let exit = entry.exit_ms.unwrap_or(entry.enter_ms);
            serde_json::json!({
                "name": entry.name,
                "thread": entry.thread,
                "durationMs": exit.saturating_sub(entry.enter_ms),
                "endedAgoMs": now.saturating_sub(exit),
            })
        })
        .collect();
    serde_json::json!({ "inFlight": in_flight, "recent": recent })
}

/// Start the watchdog thread. Logging is best-effort and never touches the UI
/// thread, which is the thing that may be blocked.
pub fn start(app: tauri::AppHandle) {
    let _ = START.get_or_init(Instant::now);
    let builder = std::thread::Builder::new().name("nebula-ui-watchdog".to_string());
    let _ = builder.spawn(move || {
        let last_pong = Arc::new(AtomicU64::new(now_ms()));
        let mut outstanding: Option<u64> = None;
        let mut reported = false;
        let mut announced = false;
        loop {
            std::thread::sleep(PING_INTERVAL);
            let now = now_ms();
            match outstanding {
                None => {
                    let pong = Arc::clone(&last_pong);
                    if app
                        .run_on_main_thread(move || pong.store(now_ms(), Ordering::SeqCst))
                        .is_ok()
                    {
                        outstanding = Some(now);
                    }
                }
                Some(sent) => {
                    if last_pong.load(Ordering::SeqCst) >= sent {
                        if !announced {
                            // Positive control: proves the ping/pong round trip
                            // works, so a log without stalls means no stall.
                            announced = true;
                            let _ = crate::write_transition_log(
                                app.clone(),
                                serde_json::json!({
                                    "stage": "ui.watchdog.ready",
                                    "status": "info",
                                    "pongLatencyMs": last_pong
                                        .load(Ordering::SeqCst)
                                        .saturating_sub(sent),
                                }),
                            );
                        }
                        if reported {
                            let mut entry = describe(now);
                            entry["stage"] = "ui.watchdog.recovered".into();
                            entry["status"] = "error".into();
                            entry["stalledMs"] = now.saturating_sub(sent).into();
                            let _ = crate::write_transition_log(app.clone(), entry);
                        }
                        outstanding = None;
                        reported = false;
                    } else if !reported && now.saturating_sub(sent) >= STALL_THRESHOLD_MS {
                        reported = true;
                        let mut entry = describe(now);
                        entry["stage"] = "ui.watchdog.stall".into();
                        entry["status"] = "error".into();
                        entry["stalledMs"] = now.saturating_sub(sent).into();
                        let _ = crate::write_transition_log(app.clone(), entry);
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn breadcrumb_is_in_flight_until_dropped() {
        let crumb = enter("unit.test.in-flight");
        let running = describe(now_ms());
        assert!(running["inFlight"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["name"] == "unit.test.in-flight"));
        drop(crumb);
        let finished = describe(now_ms());
        assert!(!finished["inFlight"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["name"] == "unit.test.in-flight"));
        assert!(finished["recent"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["name"] == "unit.test.in-flight"));
    }

    #[test]
    fn ring_keeps_only_the_newest_entries() {
        for _ in 0..(RING_CAPACITY + 10) {
            drop(enter("unit.test.ring"));
        }
        let ring = RING.lock().unwrap();
        assert!(ring.entries.len() <= RING_CAPACITY);
    }
}
