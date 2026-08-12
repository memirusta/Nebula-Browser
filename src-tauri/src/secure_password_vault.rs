use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use tauri::Manager;

const VAULT_FILE_NAME: &str = "password-vault.dpapi";
const MAX_VAULT_JSON_BYTES: usize = 10 * 1024 * 1024;
static VAULT_IO_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

fn validate_vault_json(json: &str) -> Result<(), String> {
    if json.len() > MAX_VAULT_JSON_BYTES {
        return Err("Password vault exceeds the maximum supported size.".to_string());
    }
    let parsed = serde_json::from_str::<serde_json::Value>(json)
        .map_err(|error| format!("Invalid password vault JSON: {error}"))?;
    if !parsed.is_array() {
        return Err("Password vault must be a JSON array.".to_string());
    }
    Ok(())
}

fn vault_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join(VAULT_FILE_NAME))
}

fn backup_path(path: &Path) -> PathBuf {
    let mut backup = path.as_os_str().to_os_string();
    backup.push(".bak");
    PathBuf::from(backup)
}

fn write_synced_temp(path: &Path, data: &[u8]) -> Result<PathBuf, String> {
    let directory = path
        .parent()
        .ok_or_else(|| "Password vault path has no parent directory.".to_string())?;
    let mut temp = tempfile::Builder::new()
        .prefix(".password-vault-")
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
fn replace_synced(path: &Path, temp_path: &Path, backup: Option<&Path>) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        REPLACEFILE_WRITE_THROUGH,
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
        if path.is_file() {
            let backup_wide = backup.map(wide);
            ReplaceFileW(
                PCWSTR(path_wide.as_ptr()),
                PCWSTR(temp_wide.as_ptr()),
                backup_wide
                    .as_ref()
                    .map(|value| PCWSTR(value.as_ptr()))
                    .unwrap_or_else(PCWSTR::null),
                REPLACEFILE_WRITE_THROUGH,
                None,
                None,
            )
            .map_err(|error| error.to_string())
        } else {
            MoveFileExW(
                PCWSTR(temp_wide.as_ptr()),
                PCWSTR(path_wide.as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
            .map_err(|error| error.to_string())
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn replace_synced(path: &Path, temp_path: &Path, backup: Option<&Path>) -> Result<(), String> {
    if let Some(backup) = backup.filter(|_| path.is_file()) {
        std::fs::copy(path, backup).map_err(|error| error.to_string())?;
        std::fs::File::open(backup)
            .and_then(|file| file.sync_all())
            .map_err(|error| error.to_string())?;
    }
    std::fs::rename(temp_path, path).map_err(|error| error.to_string())
}

fn durable_replace(path: &Path, data: &[u8], keep_backup: bool) -> Result<(), String> {
    let temp_path = write_synced_temp(path, data)?;
    let backup = backup_path(path);
    let result = (|| {
        if keep_backup && path.is_file() {
            if backup.is_file() {
                std::fs::remove_file(&backup).map_err(|error| error.to_string())?;
            }
            replace_synced(path, &temp_path, Some(&backup))
        } else {
            replace_synced(path, &temp_path, None)
        }
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temp_path);
    }
    result
}

fn read_with_backup_recovery<T>(
    path: &Path,
    decode: impl Fn(&[u8]) -> Result<T, String>,
) -> Result<Option<T>, String> {
    let backup = backup_path(path);
    if !path.is_file() && !backup.is_file() {
        return Ok(None);
    }

    let primary_error = match std::fs::read(path) {
        Ok(bytes) => match decode(&bytes) {
            Ok(value) => return Ok(Some(value)),
            Err(error) => error,
        },
        Err(error) => error.to_string(),
    };

    let backup_bytes = std::fs::read(&backup).map_err(|backup_error| {
        format!(
            "Password vault is unreadable ({primary_error}); backup recovery failed: {backup_error}"
        )
    })?;
    let recovered = decode(&backup_bytes).map_err(|backup_error| {
        format!("Password vault is unreadable ({primary_error}); backup is invalid: {backup_error}")
    })?;
    durable_replace(path, &backup_bytes, false)?;
    Ok(Some(recovered))
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
    Err("Secure password storage is currently supported on Windows only.".to_string())
}

#[cfg(not(target_os = "windows"))]
fn unprotect(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Secure password storage is currently supported on Windows only.".to_string())
}

#[tauri::command]
pub fn password_vault_load(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let _guard = VAULT_IO_LOCK
        .lock()
        .map_err(|_| "Password vault I/O lock was poisoned.".to_string())?;
    let path = vault_path(&app)?;
    read_with_backup_recovery(&path, |encrypted| {
        let decrypted = unprotect(encrypted)?;
        let json = String::from_utf8(decrypted).map_err(|error| error.to_string())?;
        validate_vault_json(&json)?;
        Ok(json)
    })
}

#[tauri::command]
pub fn password_vault_save(app: tauri::AppHandle, json: String) -> Result<(), String> {
    validate_vault_json(&json)?;

    let _guard = VAULT_IO_LOCK
        .lock()
        .map_err(|_| "Password vault I/O lock was poisoned.".to_string())?;
    let path = vault_path(&app)?;
    let encrypted = protect(json.as_bytes())?;
    durable_replace(&path, &encrypted, true)
}

#[tauri::command]
pub fn password_vault_clear(app: tauri::AppHandle) -> Result<(), String> {
    let _guard = VAULT_IO_LOCK
        .lock()
        .map_err(|_| "Password vault I/O lock was poisoned.".to_string())?;
    let path = vault_path(&app)?;
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    let backup = backup_path(&path);
    if backup.is_file() {
        std::fs::remove_file(backup).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{
        backup_path, durable_replace, protect, read_with_backup_recovery, unprotect,
        validate_vault_json,
    };

    #[test]
    fn vault_payload_must_be_a_json_array() {
        assert!(validate_vault_json("[]").is_ok());
        assert!(validate_vault_json("{}").is_err());
        assert!(validate_vault_json("not-json").is_err());
    }

    #[test]
    fn durable_replace_keeps_the_last_complete_vault_as_backup() {
        let directory = tempfile::tempdir().expect("temp directory should be created");
        let path = directory.path().join("vault.dpapi");

        durable_replace(&path, b"first-complete-vault", true)
            .expect("first vault write should succeed");
        durable_replace(&path, b"second-complete-vault", true)
            .expect("replacement vault write should succeed");

        assert_eq!(std::fs::read(&path).unwrap(), b"second-complete-vault");
        assert_eq!(
            std::fs::read(backup_path(&path)).unwrap(),
            b"first-complete-vault"
        );
    }

    #[test]
    fn invalid_primary_recovers_from_backup_and_repairs_primary() {
        let directory = tempfile::tempdir().expect("temp directory should be created");
        let path = directory.path().join("vault.dpapi");
        std::fs::write(&path, b"corrupt").unwrap();
        std::fs::write(backup_path(&path), b"valid-backup").unwrap();

        let recovered = read_with_backup_recovery(&path, |bytes| {
            if bytes == b"valid-backup" {
                Ok(bytes.to_vec())
            } else {
                Err("invalid payload".to_string())
            }
        })
        .expect("backup recovery should succeed")
        .expect("a recovered value should be returned");

        assert_eq!(recovered, b"valid-backup");
        assert_eq!(std::fs::read(&path).unwrap(), b"valid-backup");
        assert_eq!(std::fs::read(backup_path(&path)).unwrap(), b"valid-backup");
    }

    #[test]
    #[ignore = "requires an interactive Windows user profile for DPAPI"]
    fn dpapi_round_trip_preserves_vault_contents() {
        let plaintext = br#"[{"username":"test@example.com","password":"secret"}]"#;
        let encrypted = protect(plaintext).expect("DPAPI encryption should succeed");

        assert_ne!(encrypted, plaintext);
        assert_eq!(
            unprotect(&encrypted).expect("DPAPI decryption should succeed"),
            plaintext
        );
    }
}
