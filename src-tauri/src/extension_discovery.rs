use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Debug, Deserialize)]
struct DiscoveryCatalog {
    entries: Vec<DiscoveryExtension>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DiscoveryExtension {
    pub id: String,
    pub store_id: String,
}

pub(crate) static DISCOVERY: LazyLock<Vec<DiscoveryExtension>> = LazyLock::new(|| {
    let catalog: DiscoveryCatalog = serde_json::from_str(include_str!(
        "../../src/core/extensionDiscoveryCatalog.json"
    ))
    .expect("invalid bundled extension discovery catalog");
    let mut ids = std::collections::HashSet::new();
    let mut store_ids = std::collections::HashSet::new();
    for entry in &catalog.entries {
        assert!(
            valid_catalog_id(&entry.id) && ids.insert(&entry.id),
            "invalid discovery identifier"
        );
        assert!(
            valid_store_id(&entry.store_id) && store_ids.insert(&entry.store_id),
            "invalid discovery store identifier"
        );
    }
    catalog.entries
});

pub(crate) fn valid_catalog_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !value.starts_with('-')
        && !value.ends_with('-')
}

pub(crate) fn valid_store_id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|byte| (b'a'..=b'p').contains(&byte))
}

pub(crate) fn extension(id: &str) -> Result<&'static DiscoveryExtension, String> {
    DISCOVERY
        .iter()
        .find(|entry| entry.id == id)
        .ok_or_else(|| "This extension is not in Nebula's discovery catalog".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_has_unique_chrome_store_identifiers() {
        assert_eq!(DISCOVERY.len(), 200);
        assert!(extension("dark-reader").is_ok());
        assert!(extension("../dark-reader").is_err());
        assert!(DISCOVERY.iter().all(|entry| valid_catalog_id(&entry.id)));
        assert!(!valid_catalog_id("../dark-reader"));
        assert!(!valid_catalog_id("DarkReader"));
        // Lookups are by catalog id, never by store id. Four catalog ids are slugs,
        // so code that passes a store id here silently fails for exactly those.
        let slugs: Vec<_> = DISCOVERY
            .iter()
            .filter(|entry| entry.id != entry.store_id)
            .collect();
        assert!(slugs.len() >= 4);
        for entry in slugs {
            assert!(extension(&entry.id).is_ok(), "{}", entry.id);
            assert!(extension(&entry.store_id).is_err(), "{}", entry.id);
        }
        assert!(valid_store_id("efaidnbmnnnibpcajpcglclefindmkaj"));
        assert!(!valid_store_id("EFaidnbmnnnibpcajpcglclefindmkaj"));
    }
}
