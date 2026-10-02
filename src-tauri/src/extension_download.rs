use std::{io::Write, path::Path, time::Duration};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Manager;

use crate::{
    extension_discovery,
    extension_registry::{package, ExtensionPackage},
};
const PACKAGE_LIMIT: usize = 10 * 1024 * 1024;
const DISCOVERY_PACKAGE_LIMIT: usize = 128 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtensionDownload {
    path: String,
    version: String,
    bytes: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    compatibility: Option<crate::extension_install::DownloadCompatibility>,
}

pub(crate) fn verify_package(package: &ExtensionPackage, bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > PACKAGE_LIMIT
        || !bytes.starts_with(b"PK\x03\x04")
        || format!("{:x}", Sha256::digest(bytes)) != package.sha256
    {
        return Err("The extension package could not be verified".into());
    }
    Ok(())
}

fn save_archive(
    download_name: &str,
    version: &str,
    directory: &Path,
    bytes: &[u8],
) -> Result<ExtensionDownload, String> {
    let mut temporary = tempfile::NamedTempFile::new_in(directory).map_err(|e| e.to_string())?;
    temporary.write_all(bytes).map_err(|e| e.to_string())?;
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    // Publish only complete, verified bytes and never overwrite a user's file.
    for index in 0..1000 {
        let name = if index == 0 {
            format!("{download_name}-{version}.zip")
        } else {
            format!("{}-{} ({index}).zip", download_name, version)
        };
        let path = directory.join(name);
        match temporary.persist_noclobber(&path) {
            Ok(_) => {
                return Ok(ExtensionDownload {
                    path: path.to_string_lossy().into_owned(),
                    version: version.to_string(),
                    bytes: bytes.len(),
                    compatibility: None,
                })
            }
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                temporary = error.file;
            }
            Err(error) => return Err(error.error.to_string()),
        }
    }
    Err("No unused extension download filename is available".into())
}

fn save_package(
    package: &ExtensionPackage,
    directory: &Path,
    bytes: &[u8],
) -> Result<ExtensionDownload, String> {
    save_archive(&package.download_name, &package.version, directory, bytes)
}

#[cfg(test)]
async fn download_package(id: &str, directory: &Path) -> Result<ExtensionDownload, String> {
    let package = package(id)?;
    let bytes = fetch_package(package).await?;
    let directory = directory.to_path_buf();
    tauri::async_runtime::spawn_blocking(move || save_package(package, &directory, &bytes))
        .await
        .map_err(|e| e.to_string())?
}

pub(crate) async fn fetch_package(package: &'static ExtensionPackage) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Nebula/1.8.5")
        .connect_timeout(Duration::from_secs(15))
        // A big package on a slow line takes minutes. Give up when data stops
        // arriving, not when a fixed total runs out.
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(900))
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 5 || !package.allows_url(attempt.url()) {
                attempt.error("Unsupported extension download redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(&package.url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let bytes = crate::http_response::read_bounded_response(
        response,
        PACKAGE_LIMIT,
        "The extension package is too large",
    )
    .await?;
    verify_package(package, &bytes)?;
    Ok(bytes)
}

fn read_varint(bytes: &[u8], position: &mut usize) -> Result<u64, String> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *bytes.get(*position).ok_or("Truncated CRX header")?;
        *position += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(value);
        }
    }
    Err("Invalid CRX header integer".into())
}

fn protobuf_bytes_field(bytes: &[u8], requested: u64) -> Result<Option<&[u8]>, String> {
    let mut position = 0;
    while position < bytes.len() {
        let tag = read_varint(bytes, &mut position)?;
        let field = tag >> 3;
        match tag & 7 {
            0 => {
                let _ = read_varint(bytes, &mut position)?;
            }
            1 => {
                position = position
                    .checked_add(8)
                    .filter(|end| *end <= bytes.len())
                    .ok_or("Truncated CRX header")?
            }
            2 => {
                let length = usize::try_from(read_varint(bytes, &mut position)?)
                    .map_err(|_| "Invalid CRX header length")?;
                let end = position
                    .checked_add(length)
                    .filter(|end| *end <= bytes.len())
                    .ok_or("Truncated CRX header")?;
                let value = &bytes[position..end];
                position = end;
                if field == requested {
                    return Ok(Some(value));
                }
            }
            5 => {
                position = position
                    .checked_add(4)
                    .filter(|end| *end <= bytes.len())
                    .ok_or("Truncated CRX header")?
            }
            _ => return Err("Unsupported CRX header field".into()),
        }
    }
    Ok(None)
}

fn extension_id_from_bytes(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() != 16 {
        return Err("Invalid Chrome Web Store package identity".into());
    }
    Ok(bytes
        .iter()
        .flat_map(|byte| {
            [
                char::from(b'a' + (byte >> 4)),
                char::from(b'a' + (byte & 0x0f)),
            ]
        })
        .collect())
}

fn crx3_zip<'a>(expected_id: &str, bytes: &'a [u8]) -> Result<&'a [u8], String> {
    if bytes.len() < 12
        || &bytes[..4] != b"Cr24"
        || u32::from_le_bytes(bytes[4..8].try_into().unwrap()) != 3
    {
        return Err("Chrome Web Store did not return a CRX3 package".into());
    }
    let header_length = usize::try_from(u32::from_le_bytes(bytes[8..12].try_into().unwrap()))
        .map_err(|_| "Invalid CRX header length")?;
    if header_length == 0 || header_length > 128 * 1024 {
        return Err("Invalid CRX header length".into());
    }
    let zip_offset = 12usize
        .checked_add(header_length)
        .filter(|offset| *offset < bytes.len())
        .ok_or("Truncated CRX package")?;
    let header = &bytes[12..zip_offset];
    // CRX3 signed header data carries the 16-byte package identity. We obtain
    // packages only from Google's exact HTTPS update service and reject a
    // package whose signed identity differs from the catalog's store ID.
    // A CRX3 header must also contain at least one proof section; accepting a
    // header made only of an arbitrary identity field would weaken this gate.
    if protobuf_bytes_field(header, 2)?.is_none() && protobuf_bytes_field(header, 3)?.is_none() {
        return Err("Missing CRX package proof".into());
    }
    let signed = protobuf_bytes_field(header, 10_000)?.ok_or("Missing CRX package identity")?;
    let id = protobuf_bytes_field(signed, 1)?.ok_or("Missing CRX package identity")?;
    if extension_id_from_bytes(id)? != expected_id {
        return Err("Chrome Web Store package identity mismatch".into());
    }
    let zip = &bytes[zip_offset..];
    if !zip.starts_with(b"PK\x03\x04") {
        return Err("CRX package does not contain a ZIP archive".into());
    }
    Ok(zip)
}

pub(crate) async fn fetch_discovery_package(id: &str) -> Result<Vec<u8>, String> {
    let entry = extension_discovery::extension(id)?;
    let store_id = &entry.store_id;
    let url = format!("https://clients2.google.com/service/update2/crx?response=redirect&prodversion=152.0.4191.66&acceptformat=crx3&x=id%3D{store_id}%26uc");
    let client = reqwest::Client::builder()
        .user_agent("Nebula/1.8.5")
        .connect_timeout(Duration::from_secs(15))
        // See fetch_package: stop when data stops arriving, not after a fixed total.
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(900))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let allowed = attempt.url().scheme() == "https"
                && attempt.url().username().is_empty()
                && attempt.url().password().is_none()
                && attempt.url().port_or_known_default() == Some(443)
                && matches!(
                    attempt.url().host_str(),
                    Some("clients2.google.com" | "clients2.googleusercontent.com")
                );
            if attempt.previous().len() >= 3 || !allowed {
                attempt.error("Unsupported Chrome Web Store redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let bytes = crate::http_response::read_bounded_response(
        response,
        DISCOVERY_PACKAGE_LIMIT,
        "The Chrome Web Store package is too large",
    )
    .await?;
    Ok(crx3_zip(store_id, &bytes)?.to_vec())
}

#[tauri::command]
pub async fn extension_download_checked(
    app: tauri::AppHandle,
    id: String,
) -> Result<ExtensionDownload, String> {
    #[cfg(target_os = "windows")]
    {
        let directory = app.path().download_dir().map_err(|e| e.to_string())?;
        if let Ok(package) = package(&id) {
            let bytes = fetch_package(package).await?;
            tauri::async_runtime::spawn_blocking(move || {
                complete_checked_download(app, package, &directory, &bytes)
            })
            .await
            .map_err(|e| e.to_string())?
        } else {
            let entry = extension_discovery::extension(&id)?;
            let store_id = entry.store_id.clone();
            let bytes = fetch_discovery_package(&id).await?;
            tauri::async_runtime::spawn_blocking(move || {
                complete_discovery_checked_download(app, store_id, &directory, &bytes)
            })
            .await
            .map_err(|e| e.to_string())?
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, id);
        Err("Extension compatibility tests require Windows".into())
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn complete_discovery_checked_download(
    app: tauri::AppHandle,
    store_id: String,
    directory: &Path,
    bytes: &[u8],
) -> Result<ExtensionDownload, String> {
    let sha256 = format!("{:x}", Sha256::digest(bytes));
    let compatibility =
        crate::extension_install::probe_discovery_download(app, store_id.clone(), bytes, sha256)?;
    let version = compatibility.manifest["version"]
        .as_str()
        .ok_or("Missing extension version")?;
    // The archive is written only after the exact Chrome Web Store identity
    // loaded, enabled, enumerated and removed from an isolated profile.
    let mut saved = save_archive(&format!("Chrome-{}", store_id), version, directory, bytes)?;
    saved.compatibility = Some(compatibility);
    Ok(saved)
}

#[cfg(target_os = "windows")]
pub(crate) fn complete_checked_download(
    app: tauri::AppHandle,
    package: &'static ExtensionPackage,
    directory: &Path,
    bytes: &[u8],
) -> Result<ExtensionDownload, String> {
    let compatibility = crate::extension_install::probe_download(app, package, bytes)?;
    // Never publish a successful download until the isolated load test
    // and cleanup both finish. No installation touches the user profile.
    let mut saved = save_package(package, directory, bytes)?;
    saved.compatibility = Some(compatibility);
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn download_redirects_reject_untrusted_destinations() {
        let package = package("sponsorblock").unwrap();
        for value in [
            "http://github.com/a",
            "https://github.com.evil.test/a",
            "https://user@github.com/a",
            "https://github.com:444/a",
            "https://127.0.0.1/a",
        ] {
            assert!(!package.allows_url(&value.parse().unwrap()));
        }
        assert!(package.allows_url(&package.url.parse().unwrap()));
        assert!(package.allows_url(
            &"https://release-assets.githubusercontent.com/a"
                .parse()
                .unwrap()
        ));
    }

    #[test]
    fn modified_or_html_packages_are_rejected() {
        assert!(verify_package(
            package("sponsorblock").unwrap(),
            b"<html>rate limited</html>"
        )
        .is_err());
        assert!(verify_package(
            package("sponsorblock").unwrap(),
            b"PK\x03\x04modified archive"
        )
        .is_err());
    }

    #[test]
    fn crx3_identity_must_match_the_requested_store_entry() {
        fn varint(mut value: u64, bytes: &mut Vec<u8>) {
            while value >= 0x80 {
                bytes.push((value as u8 & 0x7f) | 0x80);
                value >>= 7;
            }
            bytes.push(value as u8);
        }
        let requested = "efaidnbmnnnibpcajpcglclefindmkaj";
        let identity: Vec<u8> = requested
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| ((pair[0] - b'a') << 4) | (pair[1] - b'a'))
            .collect();
        let mut signed = vec![0x0a, 16];
        signed.extend(identity);
        let mut header = Vec::new();
        varint((10_000 << 3) | 2, &mut header);
        varint(signed.len() as u64, &mut header);
        header.extend(signed);
        // Field 2 is an asymmetric-key proof. The parser only needs its
        // presence here; the Google HTTPS update service is the package source.
        header.extend([0x12, 0]);
        let mut crx = b"Cr24".to_vec();
        crx.extend(3u32.to_le_bytes());
        crx.extend((header.len() as u32).to_le_bytes());
        crx.extend(header);
        crx.extend(b"PK\x03\x04fixture");

        assert_eq!(crx3_zip(requested, &crx).unwrap(), b"PK\x03\x04fixture");
        assert!(crx3_zip("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", &crx).is_err());
        crx[12] = 0;
        assert!(crx3_zip(requested, &crx).is_err());
    }

    #[test]
    fn downloads_preserve_existing_files_and_leave_no_temporary_files() {
        let directory = tempfile::tempdir().unwrap();
        let existing = directory.path().join("SponsorBlock-6.1.7.zip");
        std::fs::write(&existing, b"user data").unwrap();
        let result = save_package(
            package("sponsorblock").unwrap(),
            directory.path(),
            b"new data",
        )
        .unwrap();
        assert_eq!(std::fs::read(existing).unwrap(), b"user data");
        assert_eq!(std::fs::read(result.path).unwrap(), b"new data");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 2);
    }

    #[tokio::test]
    async fn unknown_extension_is_rejected_before_network_or_disk_access() {
        assert!(download_package("../other", Path::new("missing-directory"))
            .await
            .is_err());
    }

    #[tokio::test]
    #[ignore = "Downloads the official package from GitHub; requires network access"]
    async fn official_registry_download_round_trip() {
        let directory =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("target/extension-download-smoke");
        std::fs::create_dir_all(&directory).unwrap();
        for package in crate::extension_registry::PACKAGES.iter() {
            let result = download_package(&package.id, &directory).await.unwrap();
            let saved = std::fs::read(&result.path).unwrap();
            verify_package(package, &saved).unwrap();
            assert_eq!(result.bytes, saved.len());
            println!("Downloaded {} bytes to {}", result.bytes, result.path);
        }
    }
}
