use tauri::Manager;

const VAULT_FILE_NAME: &str = "password-vault.dpapi";
const MAX_VAULT_JSON_BYTES: usize = 10 * 1024 * 1024;

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
    let path = vault_path(&app)?;
    if !path.is_file() {
        return Ok(None);
    }

    let encrypted = std::fs::read(path).map_err(|error| error.to_string())?;
    let decrypted = unprotect(&encrypted)?;
    String::from_utf8(decrypted)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn password_vault_save(app: tauri::AppHandle, json: String) -> Result<(), String> {
    validate_vault_json(&json)?;

    let path = vault_path(&app)?;
    let encrypted = protect(json.as_bytes())?;
    std::fs::write(path, encrypted).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn password_vault_clear(app: tauri::AppHandle) -> Result<(), String> {
    let path = vault_path(&app)?;
    if path.is_file() {
        std::fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::{protect, unprotect, validate_vault_json};

    #[test]
    fn vault_payload_must_be_a_json_array() {
        assert!(validate_vault_json("[]").is_ok());
        assert!(validate_vault_json("{}").is_err());
        assert!(validate_vault_json("not-json").is_err());
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
