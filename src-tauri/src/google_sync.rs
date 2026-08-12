use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;
use tauri::Manager;

const SYNC_TOKEN_FILE: &str = "google-sync-token.dpapi";
const SYNC_FILE_NAME: &str = "nebula-sync-v1.json";
const MAX_SYNC_BYTES: usize = 8 * 1024 * 1024;
static TOKEN_IO_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredGoogleSyncCredential {
    email: String,
    refresh_token: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleSyncStatus {
    pub enabled: bool,
    pub email: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleSyncCloudData {
    pub content: String,
    pub modified_time: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RefreshResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
struct DriveFileList {
    files: Vec<DriveFile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DriveFile {
    id: String,
    modified_time: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DriveCreatedFile {
    id: String,
}

fn oauth_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())
}

fn credential_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(SYNC_TOKEN_FILE))
}

fn write_synced_temp(path: &Path, data: &[u8]) -> Result<PathBuf, String> {
    let directory = path
        .parent()
        .ok_or_else(|| "Google sync token path has no parent directory.".to_string())?;
    let mut temp = tempfile::Builder::new()
        .prefix(".google-sync-token-")
        .tempfile_in(directory)
        .map_err(|error| error.to_string())?;
    temp.write_all(data).map_err(|error| error.to_string())?;
    temp.flush().map_err(|error| error.to_string())?;
    temp.as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    let (file, temp_path) = temp.keep().map_err(|error| error.error.to_string())?;
    drop(file);
    Ok(temp_path)
}

#[cfg(target_os = "windows")]
fn replace_file(path: &Path, temp_path: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };
    use windows_core::PCWSTR;

    let wide = |value: &Path| {
        value
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect::<Vec<_>>()
    };
    let path_wide = wide(path);
    let temp_wide = wide(temp_path);
    unsafe {
        MoveFileExW(
            PCWSTR(temp_wide.as_ptr()),
            PCWSTR(path_wide.as_ptr()),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
        .map_err(|error| error.to_string())
    }
}

#[cfg(not(target_os = "windows"))]
fn replace_file(path: &Path, temp_path: &Path) -> Result<(), String> {
    std::fs::rename(temp_path, path).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn protect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptProtectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptProtectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| error.to_string())?;
        let encrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(encrypted)
    }
}

#[cfg(target_os = "windows")]
fn unprotect(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{
        CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB,
    };

    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();
        CryptUnprotectData(
            &input,
            None,
            None,
            None,
            None,
            CRYPTPROTECT_UI_FORBIDDEN,
            &mut output,
        )
        .map_err(|error| error.to_string())?;
        let decrypted = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(output.pbData.cast())));
        Ok(decrypted)
    }
}

#[cfg(not(target_os = "windows"))]
fn protect(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Google sync credential storage is currently supported on Windows only.".to_string())
}

#[cfg(not(target_os = "windows"))]
fn unprotect(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Google sync credential storage is currently supported on Windows only.".to_string())
}

pub(crate) fn store_refresh_token(
    app: &tauri::AppHandle,
    email: &str,
    refresh_token: &str,
) -> Result<(), String> {
    if email.trim().is_empty() || refresh_token.trim().is_empty() {
        return Err("Google sync credential is incomplete.".to_string());
    }
    let _guard = TOKEN_IO_LOCK
        .lock()
        .map_err(|_| "Google sync token lock was poisoned.".to_string())?;
    let record = StoredGoogleSyncCredential {
        email: email.trim().to_string(),
        refresh_token: refresh_token.trim().to_string(),
    };
    let json = serde_json::to_vec(&record).map_err(|error| error.to_string())?;
    let encrypted = protect(&json)?;
    let path = credential_path(app)?;
    let temp_path = write_synced_temp(&path, &encrypted)?;
    let result = replace_file(&path, &temp_path);
    if result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    result
}

fn load_refresh_token(
    app: &tauri::AppHandle,
) -> Result<Option<StoredGoogleSyncCredential>, String> {
    let _guard = TOKEN_IO_LOCK
        .lock()
        .map_err(|_| "Google sync token lock was poisoned.".to_string())?;
    let path = credential_path(app)?;
    if !path.is_file() {
        return Ok(None);
    }
    let encrypted = std::fs::read(path).map_err(|error| error.to_string())?;
    let plaintext = unprotect(&encrypted)?;
    let record = serde_json::from_slice::<StoredGoogleSyncCredential>(&plaintext)
        .map_err(|error| format!("Invalid Google sync credential: {error}"))?;
    Ok(Some(record))
}

fn clear_refresh_token(app: &tauri::AppHandle) -> Result<(), String> {
    let _guard = TOKEN_IO_LOCK
        .lock()
        .map_err(|_| "Google sync token lock was poisoned.".to_string())?;
    let path = credential_path(app)?;
    if path.is_file() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

async fn refresh_access_token(
    client_id: &str,
    client_secret: &str,
    refresh_token: &str,
) -> Result<String, String> {
    let client = oauth_http_client()?;
    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id),
            ("client_secret", client_secret),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Google sync token refresh failed ({status}): {body}"
        ));
    }
    response
        .json::<RefreshResponse>()
        .await
        .map(|token| token.access_token)
        .map_err(|error| error.to_string())
}

async fn find_sync_file(
    client: &reqwest::Client,
    access_token: &str,
) -> Result<Option<DriveFile>, String> {
    let response = client
        .get("https://www.googleapis.com/drive/v3/files")
        .bearer_auth(access_token)
        .query(&[
            ("spaces", "appDataFolder"),
            ("q", "name = 'nebula-sync-v1.json' and trashed = false"),
            ("fields", "files(id,modifiedTime)"),
            ("orderBy", "modifiedTime desc"),
            ("pageSize", "10"),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Google Drive list failed ({status}): {body}"));
    }

    let list = response
        .json::<DriveFileList>()
        .await
        .map_err(|error| error.to_string())?;
    Ok(list.files.into_iter().next())
}

async fn access_for_app(app: &tauri::AppHandle, client_id: &str) -> Result<String, String> {
    let credential = load_refresh_token(app)?
        .ok_or_else(|| "Google sync is not enabled on this device.".to_string())?;
    let client_secret = crate::google_oauth::resolve_google_client_secret()?;
    refresh_access_token(client_id, &client_secret, &credential.refresh_token).await
}

#[tauri::command]
pub fn google_sync_status(app: tauri::AppHandle) -> Result<GoogleSyncStatus, String> {
    let record = load_refresh_token(&app)?;
    Ok(GoogleSyncStatus {
        enabled: record.is_some(),
        email: record.map(|value| value.email),
    })
}

#[tauri::command]
pub fn google_sync_forget(app: tauri::AppHandle) -> Result<(), String> {
    clear_refresh_token(&app)
}

#[tauri::command]
pub async fn google_sync_pull(
    app: tauri::AppHandle,
    client_id: String,
) -> Result<Option<GoogleSyncCloudData>, String> {
    let access_token = access_for_app(&app, &client_id).await?;
    let client = oauth_http_client()?;
    let Some(file) = find_sync_file(&client, &access_token).await? else {
        return Ok(None);
    };
    let url = format!(
        "https://www.googleapis.com/drive/v3/files/{}",
        urlencoding::encode(&file.id)
    );
    let response = client
        .get(url)
        .bearer_auth(&access_token)
        .query(&[("alt", "media")])
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Google Drive download failed ({status}): {body}"));
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_SYNC_BYTES {
        return Err("Cloud sync data exceeds Nebula's supported size.".to_string());
    }
    let content = String::from_utf8(bytes.to_vec()).map_err(|error| error.to_string())?;
    Ok(Some(GoogleSyncCloudData {
        content,
        modified_time: file.modified_time,
    }))
}

#[tauri::command]
pub async fn google_sync_push(
    app: tauri::AppHandle,
    client_id: String,
    content: String,
) -> Result<(), String> {
    if content.len() > MAX_SYNC_BYTES {
        return Err("Sync payload exceeds Nebula's 8 MiB limit.".to_string());
    }
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|error| format!("Sync payload is not valid JSON: {error}"))?;

    let access_token = access_for_app(&app, &client_id).await?;
    let client = oauth_http_client()?;
    let file = find_sync_file(&client, &access_token).await?;
    let file_id = if let Some(file) = file {
        file.id
    } else {
        let response = client
            .post("https://www.googleapis.com/drive/v3/files")
            .bearer_auth(&access_token)
            .query(&[("fields", "id")])
            .json(&serde_json::json!({
                "name": SYNC_FILE_NAME,
                "parents": ["appDataFolder"]
            }))
            .send()
            .await
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(format!("Google Drive create failed ({status}): {body}"));
        }
        response
            .json::<DriveCreatedFile>()
            .await
            .map_err(|error| error.to_string())?
            .id
    };

    let upload_url = format!(
        "https://www.googleapis.com/upload/drive/v3/files/{}",
        urlencoding::encode(&file_id)
    );
    let response = client
        .patch(upload_url)
        .bearer_auth(&access_token)
        .query(&[("uploadType", "media")])
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/json; charset=utf-8",
        )
        .body(content)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Google Drive upload failed ({status}): {body}"));
    }
    Ok(())
}
