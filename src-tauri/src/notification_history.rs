use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};

use serde::Deserialize;

// Only opaque identifiers are retained until process exit; never message content.
#[derive(Default)]
struct HistoryState {
    deleted: HashSet<String>,
    private_tabs: HashSet<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryIdentity {
    pub id: String,
    pub tab_label: Option<String>,
}

impl HistoryState {
    fn permits(&self, item: &HistoryIdentity) -> bool {
        !self.deleted.contains(&item.id)
            && !item
                .tab_label
                .as_ref()
                .is_some_and(|label| self.private_tabs.contains(label))
    }
}

static HISTORY: LazyLock<Mutex<HistoryState>> =
    LazyLock::new(|| Mutex::new(HistoryState::default()));

pub fn remember_private_tab(label: &str) -> Result<(), String> {
    HISTORY
        .lock()
        .map_err(|error| error.to_string())?
        .private_tabs
        .insert(label.to_string());
    Ok(())
}

pub fn is_private_tab(label: &str) -> bool {
    HISTORY
        .lock()
        .map(|state| state.private_tabs.contains(label))
        .unwrap_or(true)
}

pub fn allowed_ids(items: Vec<HistoryIdentity>) -> Result<Vec<String>, String> {
    let state = HISTORY.lock().map_err(|error| error.to_string())?;
    Ok(items
        .into_iter()
        .filter(|item| state.permits(item))
        .map(|item| item.id)
        .collect())
}

pub fn forget(ids: &[String]) -> Result<(), String> {
    HISTORY
        .lock()
        .map_err(|error| error.to_string())?
        .deleted
        .extend(ids.iter().cloned());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn private_and_deleted_notifications_cannot_return_to_history() {
        let mut state = HistoryState::default();
        let site = HistoryIdentity {
            id: "site-1".into(),
            tab_label: Some("tab-private".into()),
        };
        let download = HistoryIdentity {
            id: "download-1".into(),
            tab_label: None,
        };
        assert!(state.permits(&site));
        state.private_tabs.insert("tab-private".into());
        assert!(!state.permits(&site));
        assert!(state.permits(&download));
        state.deleted.insert(download.id.clone());
        assert!(!state.permits(&download));
        assert!(!state.permits(&site));
    }
}
