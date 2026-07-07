use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPassword {
    pub label: String,
    pub url: String,
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone)]
struct PasswordSource {
    browser: String,
    display_name: String,
    user_data: PathBuf,
    login_data: PathBuf,
}

fn local_app_data() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

#[cfg(target_os = "windows")]
fn read_registry_prog_id(subkey: &str) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY_CURRENT_USER, KEY_READ, REG_VALUE_TYPE,
    };

    let subkey_wide: Vec<u16> = OsStr::new(subkey)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let value_name: Vec<u16> = OsStr::new("ProgId")
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut hkey = Default::default();
        if RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey_wide.as_ptr()),
            Some(0),
            KEY_READ,
            &mut hkey,
        )
        .is_err()
        {
            return None;
        }

        let mut data_type = REG_VALUE_TYPE::default();
        let mut buf = [0u16; 256];
        let mut buf_size = (buf.len() * 2) as u32;

        let result = RegQueryValueExW(
            hkey,
            PCWSTR(value_name.as_ptr()),
            None,
            Some(&mut data_type),
            Some(buf.as_mut_ptr().cast()),
            Some(&mut buf_size),
        );

        let _ = RegCloseKey(hkey);

        if result.is_err() {
            return None;
        }

        let char_len = (buf_size as usize / 2).saturating_sub(1);
        Some(String::from_utf16_lossy(&buf[..char_len]))
    }
}

#[cfg(not(target_os = "windows"))]
fn read_registry_prog_id(_subkey: &str) -> Option<String> {
    None
}

fn read_http_prog_id() -> Option<String> {
    const KEYS: &[&str] = &[
        "Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoiceLatest",
        "Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
        "Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoiceLatest",
        "Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\http\\UserChoice",
    ];

    for key in KEYS {
        if let Some(prog_id) = read_registry_prog_id(key) {
            if !prog_id.is_empty() {
                return Some(prog_id);
            }
        }
    }

    None
}

fn browser_id_from_prog_id(prog_id: &str) -> Option<&'static str> {
    let lower = prog_id.to_lowercase();
    if lower.contains("firefox") {
        return Some("firefox");
    }
    if lower.contains("brave") {
        return Some("brave");
    }
    if lower.contains("edge") || lower.contains("msedge") {
        return Some("edge");
    }
    if lower.contains("chrome") {
        return Some("chrome");
    }
    None
}

fn chromium_installations() -> Vec<(&'static str, &'static str, PathBuf)> {
    let Some(local) = local_app_data() else {
        return Vec::new();
    };

    vec![
        (
            "chrome",
            "Google Chrome",
            local.join("Google/Chrome/User Data"),
        ),
        (
            "edge",
            "Microsoft Edge",
            local.join("Microsoft/Edge/User Data"),
        ),
        (
            "brave",
            "Brave",
            local.join("BraveSoftware/Brave-Browser/User Data"),
        ),
    ]
}

fn is_chromium_profile_dir(path: &Path) -> bool {
    path.join("Preferences").is_file()
}

fn login_db_candidates_in_profile(profile_dir: &Path) -> Vec<PathBuf> {
    ["Login Data", "Login Data For Account"]
        .into_iter()
        .map(|name| profile_dir.join(name))
        .filter(|path| path.is_file())
        .collect()
}

fn profile_dirs_in_user_data(user_data: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    let default = user_data.join("Default");
    if is_chromium_profile_dir(&default) {
        dirs.push(default);
    }

    if let Ok(entries) = std::fs::read_dir(user_data) {
        for entry in entries.flatten() {
            let file_type = match entry.file_type() {
                Ok(file_type) => file_type,
                Err(_) => continue,
            };
            if !file_type.is_dir() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            if name == "Default" {
                continue;
            }

            // Skip known non-profile folders under User Data.
            if matches!(
                name.as_str(),
                "System Profile"
                    | "Guest Profile"
                    | "Crashpad"
                    | "ShaderCache"
                    | "GrShaderCache"
                    | "GraphiteDawnCache"
                    | "component_crx_cache"
                    | "extensions_crx_cache"
                    | "optimization_guide_model_store"
                    | "Safe Browsing"
                    | "segmentation_platform"
            ) {
                continue;
            }

            let profile_dir = entry.path();
            if is_chromium_profile_dir(&profile_dir) {
                dirs.push(profile_dir);
            }
        }
    }

    dirs
}

fn login_data_paths_in_user_data(user_data: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    for profile_dir in profile_dirs_in_user_data(user_data) {
        paths.extend(login_db_candidates_in_profile(&profile_dir));
    }

    paths.sort();
    paths.dedup();
    paths
}

fn best_login_data_path(user_data: &Path) -> Option<PathBuf> {
    login_data_paths_in_user_data(user_data)
        .into_iter()
        .max_by_key(|path| std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0))
}

fn source_from_installation(id: &str, name: &str, user_data: &Path) -> Option<PasswordSource> {
    if !user_data.is_dir() {
        return None;
    }

    let login_data = best_login_data_path(user_data)?;
    Some(PasswordSource {
        browser: id.to_string(),
        display_name: name.to_string(),
        user_data: user_data.to_path_buf(),
        login_data,
    })
}

fn resolve_password_source_for(browser_id: Option<&str>) -> Option<PasswordSource> {
    let installations = chromium_installations();

    if let Some(id) = browser_id {
        if let Some((bid, name, user_data)) = installations.iter().find(|(bid, _, _)| *bid == id) {
            return source_from_installation(bid, name, user_data);
        }
        return None;
    }

    let preferred_id = read_http_prog_id().and_then(|prog_id| browser_id_from_prog_id(&prog_id));

    if let Some(preferred_id) = preferred_id {
        if preferred_id == "firefox" {
            return None;
        }

        if let Some((id, name, user_data)) =
            installations.iter().find(|(id, _, _)| *id == preferred_id)
        {
            if let Some(source) = source_from_installation(id, name, user_data) {
                return Some(source);
            }
        }
    }

    installations
        .into_iter()
        .filter_map(|(id, name, user_data)| source_from_installation(id, name, &user_data))
        .max_by_key(|source| {
            std::fs::metadata(&source.login_data)
                .map(|meta| meta.len())
                .unwrap_or(0)
        })
}

fn resolve_password_source() -> Option<PasswordSource> {
    resolve_password_source_for(None)
}

#[cfg(target_os = "windows")]
fn dpapi_decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    unsafe {
        let mut input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();

        CryptUnprotectData(&mut input, None, None, None, None, 0, &mut output)
            .map_err(|error| error.to_string())?;

        let slice = std::slice::from_raw_parts(output.pbData, output.cbData as usize);
        let decrypted = slice.to_vec();
        let _ = LocalFree(Some(windows::Win32::Foundation::HLOCAL(
            output.pbData as *mut _,
        )));
        Ok(decrypted)
    }
}

#[cfg(not(target_os = "windows"))]
fn dpapi_decrypt(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("Password import is only supported on Windows.".to_string())
}

fn chromium_master_key(user_data: &Path) -> Result<Vec<u8>, String> {
    let raw = std::fs::read_to_string(user_data.join("Local State"))
        .map_err(|error| error.to_string())?;
    let json: serde_json::Value =
        serde_json::from_str(&raw).map_err(|error| error.to_string())?;
    let encoded = json
        .get("os_crypt")
        .and_then(|value| value.get("encrypted_key"))
        .and_then(|value| value.as_str())
        .ok_or_else(|| "Chromium Local State encrypted_key missing.".to_string())?;

    let decoded = base64_decode(encoded)?;
    if decoded.len() <= 5 || &decoded[..5] != b"DPAPI" {
        return Err("Unexpected Chromium encrypted_key format.".to_string());
    }

    dpapi_decrypt(&decoded[5..])
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const TABLE: &[u8; 256] = &{
        let mut table = [255u8; 256];
        let mut index = 0u8;
        while index < 64 {
            table[b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[index as usize]
                as usize] = index;
            index += 1;
        }
        table
    };

    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u32;

    for byte in bytes {
        if *byte == b'=' {
            break;
        }
        if byte.is_ascii_whitespace() {
            continue;
        }
        let value = TABLE[*byte as usize];
        if value == 255 {
            return Err("invalid base64".to_string());
        }
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }

    Ok(output)
}

#[cfg(target_os = "windows")]
fn decrypt_chromium_blob(blob: &[u8], master_key: &[u8]) -> Result<String, String> {
    if blob.is_empty() {
        return Ok(String::new());
    }

    if blob.starts_with(b"v20") {
        return Err("app-bound-v20".to_string());
    }

    if blob.starts_with(b"v10") || blob.starts_with(b"v11") {
        if blob.len() < 31 {
            return Err("Encrypted blob too short.".to_string());
        }

        use aes_gcm::aead::{Aead, KeyInit};
        use aes_gcm::{Aes256Gcm, Nonce};

        let cipher = Aes256Gcm::new_from_slice(master_key)
            .map_err(|error| format!("AES key error: {error}"))?;
        let nonce = Nonce::from_slice(&blob[3..15]);
        let ciphertext = &blob[15..];
        let plain = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|error| format!("AES decrypt failed: {error}"))?;
        return String::from_utf8(plain).map_err(|error| error.to_string());
    }

    if let Ok(text) = std::str::from_utf8(blob) {
        let trimmed = text.trim();
        if !trimmed.is_empty() && !trimmed.starts_with("v1") {
            return Ok(trimmed.to_string());
        }
    }

    let plain = dpapi_decrypt(blob)?;
    String::from_utf8(plain).map_err(|error| error.to_string())
}

#[cfg(not(target_os = "windows"))]
fn decrypt_chromium_blob(_blob: &[u8], _master_key: &[u8]) -> Result<String, String> {
    Err("Password import is only supported on Windows.".to_string())
}

fn label_from_url(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|host| host.to_string()))
        .unwrap_or_else(|| url.to_string())
}

fn copy_login_db_to_temp(login_data: &Path) -> Result<PathBuf, String> {
    let temp = std::env::temp_dir().join(format!(
        "nebula-login-{}.db",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or(0)
    ));
    std::fs::copy(login_data, &temp).map_err(|error| {
        format!(
            "Login Data kopyalanamadı (tarayıcı açıksa kilitli olabilir — kapatıp tekrar dene): {error}"
        )
    })?;

    let source_stem = login_data
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Login Data");
    let source_parent = login_data.parent().unwrap_or_else(|| Path::new("."));
    let temp_stem = temp
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("nebula-login.db");
    let temp_parent = temp.parent().unwrap_or_else(|| Path::new("."));

    for suffix in ["-wal", "-shm", "-journal"] {
        let sidecar = source_parent.join(format!("{source_stem}{suffix}"));
        if sidecar.is_file() {
            let temp_sidecar = temp_parent.join(format!("{temp_stem}{suffix}"));
            let _ = std::fs::copy(&sidecar, &temp_sidecar);
        }
    }

    Ok(temp)
}

fn cleanup_temp_login_db(temp: &Path) {
    let _ = std::fs::remove_file(temp);
    let temp_stem = temp
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("nebula-login.db");
    let temp_parent = temp.parent().unwrap_or_else(|| Path::new("."));
    for suffix in ["-wal", "-shm", "-journal"] {
        let _ = std::fs::remove_file(temp_parent.join(format!("{temp_stem}{suffix}")));
    }
}

fn with_login_database<T>(
    login_data: &Path,
    f: impl FnOnce(&rusqlite::Connection) -> Result<T, String>,
) -> Result<T, String> {
    use rusqlite::OpenFlags;

    let immutable_uri = format!(
        "file:{}?mode=ro&immutable=1",
        login_data.to_string_lossy().replace('\\', "/")
    );
    if let Ok(conn) = rusqlite::Connection::open_with_flags(
        &immutable_uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_URI,
    ) {
        return f(&conn);
    }

    let temp_db = copy_login_db_to_temp(login_data)?;
    let conn = rusqlite::Connection::open(&temp_db).map_err(|error| error.to_string())?;
    let result = f(&conn);
    cleanup_temp_login_db(&temp_db);
    result
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordImportResult {
    browser: String,
    display_name: String,
    passwords_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromiumPasswordSource {
    browser: String,
    display_name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PasswordImportDiagnostics {
    browser: String,
    display_name: String,
    total_rows: usize,
    decryptable: usize,
    app_bound: usize,
    failed: usize,
}

#[tauri::command]
pub fn list_chromium_password_sources() -> Vec<ChromiumPasswordSource> {
    chromium_installations()
        .into_iter()
        .filter_map(|(id, name, user_data)| {
            if best_login_data_path(&user_data).is_some() {
                Some(ChromiumPasswordSource {
                    browser: id.to_string(),
                    display_name: name.to_string(),
                })
            } else {
                None
            }
        })
        .collect()
}

#[tauri::command]
pub fn inspect_browser_passwords(browser: Option<String>) -> Result<PasswordImportDiagnostics, String> {
    let browser_id = browser.as_deref();
    let source = resolve_password_source_for(browser_id).ok_or_else(|| {
        if let Some(id) = browser_id {
            return format!("{id} şifre veritabanı bulunamadı.");
        }
        "Chromium tabanlı tarayıcı şifre veritabanı bulunamadı.".to_string()
    })?;

    let master_key = chromium_master_key(&source.user_data)?;
    let stats = collect_import_stats(&source.user_data, &master_key)?;

    Ok(PasswordImportDiagnostics {
        browser: source.browser,
        display_name: source.display_name,
        total_rows: stats.total_rows,
        decryptable: stats.decryptable,
        app_bound: stats.app_bound_skipped,
        failed: stats.decrypt_failed,
    })
}

#[tauri::command]
pub fn detect_browser_passwords() -> PasswordImportResult {
    let Some(source) = resolve_password_source() else {
        return PasswordImportResult {
            browser: "unknown".to_string(),
            display_name: "Tarayici".to_string(),
            passwords_available: false,
        };
    };

    PasswordImportResult {
        browser: source.browser,
        display_name: source.display_name,
        passwords_available: true,
    }
}

#[tauri::command]
pub fn import_default_browser_passwords(
    limit: usize,
    browser: Option<String>,
) -> Result<Vec<ImportedPassword>, String> {
    let browser_id = browser.as_deref();
    let source = resolve_password_source_for(browser_id).ok_or_else(|| {
        if let Some(id) = browser_id {
            return format!("{id} şifre veritabanı bulunamadı.");
        }
        "Chromium tabanlı tarayıcı şifre veritabanı bulunamadı.".to_string()
    })?;

    let master_key = chromium_master_key(&source.user_data)?;
    import_from_user_data(&source.user_data, &master_key, limit)
}

struct ImportStats {
    total_rows: usize,
    decryptable: usize,
    decrypt_failed: usize,
    app_bound_skipped: usize,
}

fn import_failure_message(stats: &ImportStats) -> String {
    if stats.total_rows == 0 {
        return "Chrome'da şifre görünüyor ama dosyadan okunamadı. chrome://password-manager/passwords → sağ üst ⚙️ → Dışa aktar (CSV) ile «CSV içe aktar» kullan.".to_string();
    }

    if stats.app_bound_skipped > 0 && stats.decryptable == 0 {
        return format!(
            "{} şifre kaydı var ama Chrome/Edge'in yeni app-bound şifrelemesi dışarıdan açılamıyor. \
             Tarayıcıda Şifreler → Dışa aktar (CSV) yapıp buradan «CSV içe aktar» kullan.",
            stats.total_rows
        );
    }

    if stats.app_bound_skipped > 0 {
        return format!(
            "{} kayıttan {} tanesi yeni app-bound şifrelemede; dışarıdan aktarılamıyor. \
             Kalanlar için CSV dışa aktarmayı dene.",
            stats.total_rows,
            stats.app_bound_skipped
        );
    }

    format!(
        "{} şifre kaydı var ama çözülemedi. Farklı Windows kullanıcısı veya bozuk veritabanı olabilir; CSV dene.",
        stats.total_rows
    )
}

fn collect_import_stats(user_data: &Path, master_key: &[u8]) -> Result<ImportStats, String> {
    let login_paths = login_data_paths_in_user_data(user_data);
    if login_paths.is_empty() {
        return Err("Login Data dosyası bulunamadı.".to_string());
    }

    let mut stats = ImportStats {
        total_rows: 0,
        decryptable: 0,
        decrypt_failed: 0,
        app_bound_skipped: 0,
    };

    for login_data in login_paths {
        let batch_stats = read_password_stats(&login_data, master_key)?;
        stats.total_rows += batch_stats.total_rows;
        stats.decryptable += batch_stats.decryptable;
        stats.decrypt_failed += batch_stats.decrypt_failed;
        stats.app_bound_skipped += batch_stats.app_bound_skipped;
    }

    Ok(stats)
}

fn read_cell_bytes(row: &rusqlite::Row<'_>, index: usize) -> Result<Vec<u8>, rusqlite::Error> {
    match row.get_ref(index)? {
        rusqlite::types::ValueRef::Blob(bytes) => Ok(bytes.to_vec()),
        rusqlite::types::ValueRef::Text(bytes) => Ok(bytes.to_vec()),
        rusqlite::types::ValueRef::Null => Ok(Vec::new()),
        _ => Ok(Vec::new()),
    }
}

fn import_from_user_data(
    user_data: &Path,
    master_key: &[u8],
    limit: usize,
) -> Result<Vec<ImportedPassword>, String> {
    let login_paths = login_data_paths_in_user_data(user_data);
    if login_paths.is_empty() {
        return Err("Login Data dosyası bulunamadı.".to_string());
    }

    let mut imported = Vec::new();
    let mut stats = ImportStats {
        total_rows: 0,
        decryptable: 0,
        decrypt_failed: 0,
        app_bound_skipped: 0,
    };

    for login_data in login_paths {
        if imported.len() >= limit {
            break;
        }
        let (batch, batch_stats) =
            read_password_rows(&login_data, master_key, limit.saturating_sub(imported.len()))?;
        stats.total_rows += batch_stats.total_rows;
        stats.decryptable += batch_stats.decryptable;
        stats.decrypt_failed += batch_stats.decrypt_failed;
        stats.app_bound_skipped += batch_stats.app_bound_skipped;
        imported.extend(batch);
    }

    if imported.is_empty() {
        return Err(import_failure_message(&stats));
    }

    Ok(imported)
}

fn read_password_stats(login_data: &Path, master_key: &[u8]) -> Result<ImportStats, String> {
    with_login_database(login_data, |conn| {
        let sql = "SELECT origin_url, action_url, username_value, password_value
           FROM logins
           ORDER BY date_created DESC";
        let mut stmt = conn.prepare(sql).map_err(|error| error.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let origin_url: String = row.get(0)?;
                let action_url: String = row.get(1)?;
                let username_blob = read_cell_bytes(row, 2)?;
                let password_blob = read_cell_bytes(row, 3)?;
                Ok((origin_url, action_url, username_blob, password_blob))
            })
            .map_err(|error| error.to_string())?;

        let mut stats = ImportStats {
            total_rows: 0,
            decryptable: 0,
            decrypt_failed: 0,
            app_bound_skipped: 0,
        };

        for row in rows {
            let (origin_url, action_url, username_blob, password_blob) =
                row.map_err(|error| error.to_string())?;
            stats.total_rows += 1;

            let url = origin_url.trim();
            let url = if url.is_empty() { action_url.trim() } else { url };
            if url.is_empty() {
                continue;
            }

            if password_blob.starts_with(b"v20") || username_blob.starts_with(b"v20") {
                stats.app_bound_skipped += 1;
                continue;
            }

            let username = match decrypt_chromium_blob(&username_blob, master_key) {
                Ok(value) => value.trim().to_string(),
                Err(err) if err == "app-bound-v20" => {
                    stats.app_bound_skipped += 1;
                    continue;
                }
                Err(_) => {
                    stats.decrypt_failed += 1;
                    continue;
                }
            };

            let password = match decrypt_chromium_blob(&password_blob, master_key) {
                Ok(value) => value,
                Err(err) if err == "app-bound-v20" => {
                    stats.app_bound_skipped += 1;
                    continue;
                }
                Err(_) => {
                    stats.decrypt_failed += 1;
                    continue;
                }
            };

            if username.is_empty() || password.is_empty() {
                stats.decrypt_failed += 1;
                continue;
            }

            stats.decryptable += 1;
        }

        Ok(stats)
    })
}

fn read_password_rows(
    login_data: &Path,
    master_key: &[u8],
    limit: usize,
) -> Result<(Vec<ImportedPassword>, ImportStats), String> {
    with_login_database(login_data, |conn| {
        let sql = "SELECT origin_url, action_url, username_value, password_value
           FROM logins
           ORDER BY date_created DESC";
        let mut stmt = conn.prepare(sql).map_err(|error| error.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let origin_url: String = row.get(0)?;
                let action_url: String = row.get(1)?;
                let username_blob = read_cell_bytes(row, 2)?;
                let password_blob = read_cell_bytes(row, 3)?;
                Ok((origin_url, action_url, username_blob, password_blob))
            })
            .map_err(|error| error.to_string())?;

        let mut imported = Vec::new();
        let mut stats = ImportStats {
            total_rows: 0,
            decryptable: 0,
            decrypt_failed: 0,
            app_bound_skipped: 0,
        };

        for row in rows {
            let (origin_url, action_url, username_blob, password_blob) =
                row.map_err(|error| error.to_string())?;
            stats.total_rows += 1;

            let url = origin_url.trim();
            let url = if url.is_empty() { action_url.trim() } else { url };
            if url.is_empty() {
                continue;
            }

            if password_blob.starts_with(b"v20") || username_blob.starts_with(b"v20") {
                stats.app_bound_skipped += 1;
                continue;
            }

            let username = match decrypt_chromium_blob(&username_blob, master_key) {
                Ok(value) => value.trim().to_string(),
                Err(err) if err == "app-bound-v20" => {
                    stats.app_bound_skipped += 1;
                    continue;
                }
                Err(_) => {
                    stats.decrypt_failed += 1;
                    continue;
                }
            };

            let password = match decrypt_chromium_blob(&password_blob, master_key) {
                Ok(value) => value,
                Err(err) if err == "app-bound-v20" => {
                    stats.app_bound_skipped += 1;
                    continue;
                }
                Err(_) => {
                    stats.decrypt_failed += 1;
                    continue;
                }
            };

            if username.is_empty() || password.is_empty() {
                stats.decrypt_failed += 1;
                continue;
            }

            stats.decryptable += 1;
            imported.push(ImportedPassword {
                label: label_from_url(url),
                url: url.to_string(),
                username,
                password,
            });

            if imported.len() >= limit {
                break;
            }
        }

        Ok((imported, stats))
    })
}
