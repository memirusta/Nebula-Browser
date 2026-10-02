use serde_json::Value;
use std::{
    collections::HashMap,
    sync::{LazyLock, Mutex},
    time::{Duration, Instant},
};

#[derive(Default)]
struct TransferStore {
    entries: HashMap<String, (Instant, Value)>,
}

impl TransferStore {
    fn prune(&mut self) {
        self.entries
            .retain(|_, (updated, _)| updated.elapsed() < Duration::from_secs(120));
    }

    fn set(&mut self, value: Value) -> Result<(), String> {
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty() && id.len() <= 120)
            .ok_or("invalid transfer id")?
            .to_string();
        if serde_json::to_vec(&value).map_err(|e| e.to_string())?.len() > 2 * 1024 * 1024 {
            return Err("tab transfer is too large".into());
        }
        self.prune();
        // Creation is idempotent. Only advance() may change an existing record;
        // a delayed full snapshot must not restore an old state or private payload.
        if self.entries.contains_key(&id) {
            return Ok(());
        }
        if self.entries.len() >= 64 {
            return Err("too many pending tab transfers".into());
        }
        self.entries.insert(id, (Instant::now(), value));
        Ok(())
    }

    fn advance(
        &mut self,
        id: &str,
        state: &str,
        target_window_id: Option<&str>,
    ) -> Result<Option<Value>, String> {
        if !matches!(
            state,
            "pending" | "target-ready" | "ready" | "claimed" | "cancelled"
        ) {
            return Err("invalid transfer state".into());
        }
        self.prune();
        let Some((updated, transfer)) = self.entries.get_mut(id) else {
            return Ok(None);
        };
        if target_window_id.is_some_and(|target| {
            transfer.get("targetWindowId").and_then(Value::as_str) != Some(target)
        }) {
            return Ok(None);
        }
        let current = transfer
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let allowed = matches!(
            (current, state),
            ("pending", "target-ready" | "ready" | "cancelled")
                | ("target-ready", "ready" | "cancelled")
                | ("ready", "claimed" | "cancelled")
        );
        if allowed {
            transfer["state"] = Value::String(state.to_string());
            *updated = Instant::now();
        }
        Ok(Some(transfer.clone()))
    }
}

static TRANSFERS: LazyLock<Mutex<TransferStore>> =
    LazyLock::new(|| Mutex::new(TransferStore::default()));

// Runtime ownership handoffs must never put private URLs in disk-backed Web Storage.
#[tauri::command]
pub fn browser_tab_transfer_store(
    action: String,
    id: Option<String>,
    transfer: Option<Value>,
    state: Option<String>,
    target_window_id: Option<String>,
) -> Result<Value, String> {
    let mut store = TRANSFERS.lock().map_err(|e| e.to_string())?;
    store.prune();
    match action.as_str() {
        "set" => {
            store.set(transfer.ok_or("missing transfer")?)?;
            Ok(Value::Null)
        }
        "get" => Ok(store
            .entries
            .get(id.as_deref().ok_or("missing id")?)
            .map(|(_, value)| value.clone())
            .unwrap_or(Value::Null)),
        "advance" => Ok(store
            .advance(
                id.as_deref().ok_or("missing id")?,
                state.as_deref().ok_or("missing state")?,
                target_window_id.as_deref(),
            )?
            .unwrap_or(Value::Null)),
        "remove" => {
            store.entries.remove(id.as_deref().ok_or("missing id")?);
            Ok(Value::Null)
        }
        "list" => Ok(Value::Array(
            store
                .entries
                .values()
                .map(|(_, value)| value.clone())
                .collect(),
        )),
        _ => Err("invalid transfer operation".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pending_transfer() -> Value {
        serde_json::json!({
            "id": "transfer-race",
            "state": "pending",
            "targetWindowId": "target",
            "tab": {"isPrivate": true, "url": "https://private.example/secret"}
        })
    }

    #[test]
    fn stale_receiver_readiness_cannot_regress_ready_or_terminal_states() {
        for state in ["ready", "claimed", "cancelled"] {
            let mut store = TransferStore::default();
            let initial = pending_transfer();
            store.set(initial.clone()).unwrap();
            store
                .advance("transfer-race", "ready", Some("target"))
                .unwrap();
            store
                .advance("transfer-race", state, Some("target"))
                .unwrap();
            let latest = store
                .advance("transfer-race", "target-ready", Some("target"))
                .unwrap()
                .unwrap();
            assert_eq!(latest["state"], state);
            assert_eq!(latest["tab"], initial["tab"]);

            // A delayed create/save also cannot replace the immutable descriptor.
            store
                .set(serde_json::json!({
                    "id": "transfer-race", "state": "pending", "tab": {"isPrivate": false}
                }))
                .unwrap();
            assert_eq!(store.entries["transfer-race"].1, latest);
        }
    }

    #[test]
    fn cancellation_and_claim_are_terminal_and_missing_transfers_stay_missing() {
        let mut store = TransferStore::default();
        store.set(pending_transfer()).unwrap();
        store
            .advance("transfer-race", "cancelled", Some("target"))
            .unwrap();
        for state in ["pending", "target-ready", "ready", "claimed"] {
            let actual = store
                .advance("transfer-race", state, Some("target"))
                .unwrap()
                .unwrap();
            assert_eq!(actual["state"], "cancelled");
        }
        store.entries.remove("transfer-race");
        assert!(store
            .advance("transfer-race", "ready", Some("target"))
            .unwrap()
            .is_none());

        store.set(pending_transfer()).unwrap();
        assert!(store
            .advance("transfer-race", "target-ready", Some("wrong-target"))
            .unwrap()
            .is_none());
        assert_eq!(store.entries["transfer-race"].1["state"], "pending");
        store
            .advance("transfer-race", "ready", Some("target"))
            .unwrap();
        store
            .advance("transfer-race", "claimed", Some("target"))
            .unwrap();
        let actual = store
            .advance("transfer-race", "cancelled", Some("target"))
            .unwrap()
            .unwrap();
        assert_eq!(actual["state"], "claimed");
    }

    #[test]
    fn competing_claim_and_cancellation_have_one_terminal_winner() {
        use std::sync::{Arc, Barrier};

        let mut store = TransferStore::default();
        store.set(pending_transfer()).unwrap();
        store
            .advance("transfer-race", "ready", Some("target"))
            .unwrap();
        let store = Arc::new(Mutex::new(store));
        let barrier = Arc::new(Barrier::new(3));
        let workers = ["claimed", "cancelled"].map(|state| {
            let store = store.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                store
                    .lock()
                    .unwrap()
                    .advance("transfer-race", state, Some("target"))
                    .unwrap()
                    .unwrap()["state"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
        });
        barrier.wait();
        let [first, second] = workers.map(|worker| worker.join().unwrap());
        assert_eq!(first, second);
        assert!(matches!(first.as_str(), "claimed" | "cancelled"));
        assert_eq!(
            store.lock().unwrap().entries["transfer-race"].1["state"],
            first
        );
    }

    #[test]
    fn private_transfer_keeps_its_mode_until_claimed_and_expires_in_memory() {
        let mut store = TransferStore::default();
        let value = serde_json::json!({"id":"private-transfer","state":"ready","tab":{"isPrivate":true,"url":"https://private.example/secret"}});
        store.set(value.clone()).unwrap();
        assert_eq!(store.entries["private-transfer"].1, value);
        store.entries.get_mut("private-transfer").unwrap().0 =
            Instant::now() - Duration::from_secs(121);
        store.prune();
        assert!(store.entries.is_empty());
    }
    #[test]
    fn invalid_or_oversized_transfers_are_rejected() {
        let mut store = TransferStore::default();
        assert!(store.set(serde_json::json!({"id":""})).is_err());
        assert!(store
            .set(serde_json::json!({"id":"large","data":"x".repeat(2 * 1024 * 1024)}))
            .is_err());
        assert!(store.entries.is_empty());
    }
}
