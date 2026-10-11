use serde::Deserialize;
use std::sync::LazyLock;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ExtensionPackage {
    pub id: String,
    pub display: serde_json::Value,
    pub version: String,
    pub download_name: String,
    pub url: String,
    pub sha256: String,
    pub manifest_name_field: String,
    pub manifest_name: String,
    pub access: Vec<String>,
    pub redirect_hosts: Vec<String>,
}

impl ExtensionPackage {
    pub fn filename(&self) -> String {
        format!("{}-{}.zip", self.download_name, self.version)
    }

    fn validate(&self) -> Result<(), String> {
        if !self.display["name"].is_string()
            || !self.display["description"].is_string()
            || !matches!(
                self.display["category"].as_str(),
                Some("privacy" | "appearance" | "productivity" | "media")
            )
        {
            return Err("Invalid extension display metadata".into());
        }
        let safe = |value: &str| {
            !value.is_empty()
                && value.len() < 100
                && value
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'.'))
                && !value.starts_with('.')
                && !value.ends_with('.')
        };
        if !safe(&self.id)
            || !safe(&self.download_name)
            || !safe(&self.version)
            || self.sha256.len() != 64
            || !self.sha256.bytes().all(|c| c.is_ascii_hexdigit())
            || !matches!(self.manifest_name_field.as_str(), "name" | "short_name")
            || self.manifest_name.is_empty()
            || self.access.is_empty()
        {
            return Err("Invalid extension registry record".into());
        }
        let url = reqwest::Url::parse(&self.url).map_err(|e| e.to_string())?;
        if !self.allows_url(&url) {
            return Err("Invalid extension package source".into());
        }
        Ok(())
    }

    pub fn allows_url(&self, url: &reqwest::Url) -> bool {
        url.scheme() == "https"
            && url.username().is_empty()
            && url.password().is_none()
            && url.port_or_known_default() == Some(443)
            && url
                .host_str()
                .is_some_and(|host| self.redirect_hosts.iter().any(|allowed| allowed == host))
    }
}

pub(crate) static PACKAGES: LazyLock<Vec<ExtensionPackage>> = LazyLock::new(|| {
    #[allow(unused_mut)]
    let mut packages: Vec<ExtensionPackage> =
        serde_json::from_str(include_str!("../../src/core/extensionPackages.json"))
            .expect("invalid bundled extension registry");
    // The acceptance test installs a fixture extension through the real install path: its
    // package comes from a file (and is pre-placed in the extension's cache, so nothing is
    // downloaded). Only in the harness build, never in a product build.
    #[cfg(feature = "split-driver")]
    if let Some(extra) = fixture_packages() {
        packages.extend(extra);
    }
    let mut ids = std::collections::HashSet::new();
    for package in &packages {
        package
            .validate()
            .expect("unsafe bundled extension registry");
        assert!(ids.insert(&package.id), "duplicate extension ID");
    }
    packages
});

#[cfg(feature = "split-driver")]
fn fixture_packages() -> Option<Vec<ExtensionPackage>> {
    let path = std::env::var_os("NEBULA_FIXTURE_PACKAGES")?;
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// The ids of the fixture packages (harness build only), for the discovery catalog.
#[cfg(feature = "split-driver")]
pub(crate) fn fixture_package_ids() -> Vec<String> {
    fixture_packages()
        .map(|packages| packages.into_iter().map(|package| package.id).collect())
        .unwrap_or_default()
}

pub(crate) fn package(id: &str) -> Result<&'static ExtensionPackage, String> {
    PACKAGES
        .iter()
        .find(|package| package.id == id)
        .ok_or_else(|| "This extension is not supported by the package registry".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn registry_rejects_unknown_ids_and_separates_extension_storage() {
        assert!(package("../sponsorblock").is_err());
        assert!(package("bitwarden").is_err());
        let sponsor = package("sponsorblock").unwrap();
        let dark = package("dark-reader").unwrap();
        assert_ne!(sponsor.id, dark.id);
        assert_ne!(sponsor.filename(), dark.filename());
        assert_ne!(sponsor.sha256, dark.sha256);
    }
}
