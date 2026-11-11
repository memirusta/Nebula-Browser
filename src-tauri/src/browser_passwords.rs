use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedPassword {
    pub label: String,
    pub url: String,
    pub username: String,
    pub password: String,
    /// Which browser the password came from (the id of its installation, e.g. `chrome`, `opera-gx`).
    pub browser: String,
    /// The profile folder inside the browser (`Default`, `Profile 1`); empty for browsers with a single profile.
    pub profile: String,
    /// When the browser saved the password and when it last filled it, as Unix milliseconds.
    pub created_ms: Option<i64>,
    pub last_used_ms: Option<i64>,
}

#[derive(Debug, Clone)]
struct PasswordSource {
    user_data: PathBuf,
    login_data: PathBuf,
}

pub(crate) fn local_app_data() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

pub(crate) fn roaming_app_data() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(PathBuf::from)
}

/// Seconds between 1601-01-01 (the Windows/Chromium epoch) and 1970-01-01.
const CHROMIUM_EPOCH_OFFSET_MS: i64 = 11_644_473_600_000;

/// Chromium stores times as microseconds since 1601; 0 means "never".
pub(crate) fn chromium_time_to_unix_ms(value: i64) -> Option<i64> {
    if value <= 0 {
        return None;
    }
    let ms = value / 1000 - CHROMIUM_EPOCH_OFFSET_MS;
    (ms > 0).then_some(ms)
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

/// The browser family a Windows ProgId (the registered handler of http/https) belongs to.
fn browser_id_from_prog_id(prog_id: &str) -> Option<&'static str> {
    let lower = prog_id.to_lowercase();
    if lower.contains("firefox") {
        return Some("firefox");
    }
    if lower.contains("opera") {
        return Some(if lower.contains("gx") {
            "opera-gx"
        } else {
            "opera"
        });
    }
    if lower.contains("vivaldi") {
        return Some("vivaldi");
    }
    if lower.contains("brave") {
        return Some("brave");
    }
    if lower.contains("edge") || lower.contains("msedge") {
        return Some("edge");
    }
    if lower.contains("chromium") {
        return Some("chromium");
    }
    if lower.contains("thorium") {
        return Some("thorium");
    }
    if lower.contains("chrome") {
        return Some("chrome");
    }
    None
}

#[derive(Debug, Clone, Copy)]
enum BaseFolder {
    Local,
    Roaming,
}

#[derive(Debug, Clone)]
pub(crate) struct Installation {
    pub(crate) id: &'static str,
    pub(crate) name: &'static str,
    pub(crate) user_data: PathBuf,
}

/// Chromium-based browsers whose passwords Nebula can read: the same `Local State` key and `Login Data` format.
/// Most keep their profiles in a `User Data` folder; Opera keeps its single profile in the folder itself.
/// Yandex is not listed on purpose: it keeps passwords in its own store (`Ya Passman Data`).
const CHROMIUM_BROWSERS: &[(&str, &str, BaseFolder, &str)] = &[
    (
        "chrome",
        "Google Chrome",
        BaseFolder::Local,
        "Google/Chrome/User Data",
    ),
    (
        "chrome-beta",
        "Google Chrome Beta",
        BaseFolder::Local,
        "Google/Chrome Beta/User Data",
    ),
    (
        "chrome-dev",
        "Google Chrome Dev",
        BaseFolder::Local,
        "Google/Chrome Dev/User Data",
    ),
    (
        "chrome-canary",
        "Google Chrome Canary",
        BaseFolder::Local,
        "Google/Chrome SxS/User Data",
    ),
    (
        "edge",
        "Microsoft Edge",
        BaseFolder::Local,
        "Microsoft/Edge/User Data",
    ),
    (
        "edge-beta",
        "Microsoft Edge Beta",
        BaseFolder::Local,
        "Microsoft/Edge Beta/User Data",
    ),
    (
        "edge-dev",
        "Microsoft Edge Dev",
        BaseFolder::Local,
        "Microsoft/Edge Dev/User Data",
    ),
    (
        "edge-canary",
        "Microsoft Edge Canary",
        BaseFolder::Local,
        "Microsoft/Edge SxS/User Data",
    ),
    (
        "brave",
        "Brave",
        BaseFolder::Local,
        "BraveSoftware/Brave-Browser/User Data",
    ),
    (
        "brave-beta",
        "Brave Beta",
        BaseFolder::Local,
        "BraveSoftware/Brave-Browser-Beta/User Data",
    ),
    (
        "brave-nightly",
        "Brave Nightly",
        BaseFolder::Local,
        "BraveSoftware/Brave-Browser-Nightly/User Data",
    ),
    ("vivaldi", "Vivaldi", BaseFolder::Local, "Vivaldi/User Data"),
    (
        "chromium",
        "Chromium",
        BaseFolder::Local,
        "Chromium/User Data",
    ),
    ("thorium", "Thorium", BaseFolder::Local, "Thorium/User Data"),
    (
        "opera",
        "Opera",
        BaseFolder::Roaming,
        "Opera Software/Opera Stable",
    ),
    (
        "opera-gx",
        "Opera GX",
        BaseFolder::Roaming,
        "Opera Software/Opera GX Stable",
    ),
];

pub(crate) fn chromium_installations_in(
    local: Option<&Path>,
    roaming: Option<&Path>,
) -> Vec<Installation> {
    CHROMIUM_BROWSERS
        .iter()
        .filter_map(|(id, name, base, relative)| {
            let root = match base {
                BaseFolder::Local => local,
                BaseFolder::Roaming => roaming,
            }?;
            Some(Installation {
                id,
                name,
                user_data: root.join(relative),
            })
        })
        .collect()
}

pub(crate) fn chromium_installations() -> Vec<Installation> {
    chromium_installations_in(local_app_data().as_deref(), roaming_app_data().as_deref())
}

/// Firefox keeps its passwords in its own format; Nebula only recognises that it is installed so the user can
/// be pointed at the CSV export.
pub(crate) fn firefox_installed_in(roaming: Option<&Path>) -> bool {
    roaming
        .map(|root| root.join("Mozilla/Firefox/Profiles"))
        .and_then(|profiles| std::fs::read_dir(profiles).ok())
        .is_some_and(|mut entries| entries.next().is_some())
}

pub(crate) fn default_browser_family() -> Option<&'static str> {
    read_http_prog_id().and_then(|prog_id| browser_id_from_prog_id(&prog_id))
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

pub(crate) fn profile_dirs_in_user_data(user_data: &Path) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    // Opera keeps its one profile in the folder itself instead of in `Default`.
    if is_chromium_profile_dir(user_data) {
        dirs.push(user_data.to_path_buf());
    }

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

pub(crate) fn best_login_data_path(user_data: &Path) -> Option<PathBuf> {
    login_data_paths_in_user_data(user_data)
        .into_iter()
        .max_by_key(|path| std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0))
}

fn source_from_installation(user_data: &Path) -> Option<PasswordSource> {
    if !user_data.is_dir() {
        return None;
    }

    let login_data = best_login_data_path(user_data)?;
    Some(PasswordSource {
        user_data: user_data.to_path_buf(),
        login_data,
    })
}

fn resolve_password_source_for(browser_id: Option<&str>) -> Option<PasswordSource> {
    let installations = chromium_installations();

    if let Some(id) = browser_id {
        return installations
            .iter()
            .find(|installation| installation.id == id)
            .and_then(|installation| source_from_installation(&installation.user_data));
    }

    let preferred_id = default_browser_family();

    if let Some(preferred_id) = preferred_id {
        if preferred_id == "firefox" {
            return None;
        }

        if let Some(installation) = installations
            .iter()
            .find(|installation| installation.id == preferred_id)
        {
            if let Some(source) = source_from_installation(&installation.user_data) {
                return Some(source);
            }
        }
    }

    installations
        .into_iter()
        .filter_map(|installation| source_from_installation(&installation.user_data))
        .max_by_key(|source| {
            std::fs::metadata(&source.login_data)
                .map(|meta| meta.len())
                .unwrap_or(0)
        })
}

#[cfg(target_os = "windows")]
fn dpapi_decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB};

    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: data.len() as u32,
            pbData: data.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB::default();

        CryptUnprotectData(&input, None, None, None, None, 0, &mut output)
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
    let json: serde_json::Value = serde_json::from_str(&raw).map_err(|error| error.to_string())?;
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
            table[b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
                [index as usize] as usize] = index;
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
        // v10/v11/v20 blobs were handled above, so a text that is left is a plain value (a user name that merely
        // starts with "v1" is not an encrypted blob).
        if !trimmed.is_empty() {
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
    std::fs::copy(login_data, &temp)
        .map_err(|error| import_error("copy-failed", &[&error.to_string()]))?;

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

pub(crate) fn with_readonly_database<T>(
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
pub struct ChromiumPasswordSource {
    browser: String,
    display_name: String,
    /// Saved logins found (counted, not decrypted); `None` when the database could not be read.
    login_count: Option<usize>,
    is_default: bool,
    /// Recognised, but its passwords can only be brought over with its CSV export (Firefox).
    csv_only: bool,
}

pub(crate) fn count_logins(user_data: &Path) -> Option<usize> {
    let mut total = 0usize;
    for login_data in login_data_paths_in_user_data(user_data) {
        let count = with_readonly_database(&login_data, |conn| {
            conn.query_row(
                "SELECT COUNT(*) FROM logins WHERE blacklisted_by_user = 0",
                [],
                |row| row.get::<_, i64>(0),
            )
            .or_else(|_| {
                conn.query_row("SELECT COUNT(*) FROM logins", [], |row| {
                    row.get::<_, i64>(0)
                })
            })
            .map_err(|error| error.to_string())
        })
        .ok()?;
        total += count.max(0) as usize;
    }
    Some(total)
}

/// Every browser that has passwords to offer, the default browser first.
fn password_sources_in(
    local: Option<&Path>,
    roaming: Option<&Path>,
    default_family: Option<&str>,
) -> Vec<ChromiumPasswordSource> {
    let mut sources: Vec<ChromiumPasswordSource> = chromium_installations_in(local, roaming)
        .into_iter()
        .filter(|installation| best_login_data_path(&installation.user_data).is_some())
        .map(|installation| ChromiumPasswordSource {
            browser: installation.id.to_string(),
            display_name: installation.name.to_string(),
            login_count: count_logins(&installation.user_data),
            is_default: default_family == Some(installation.id),
            csv_only: false,
        })
        .collect();

    if firefox_installed_in(roaming) {
        sources.push(ChromiumPasswordSource {
            browser: "firefox".to_string(),
            display_name: "Firefox".to_string(),
            login_count: None,
            is_default: default_family == Some("firefox"),
            csv_only: true,
        });
    }

    sources.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| a.display_name.cmp(&b.display_name))
    });
    sources
}

#[tauri::command]
pub fn list_chromium_password_sources() -> Vec<ChromiumPasswordSource> {
    password_sources_in(
        local_app_data().as_deref(),
        roaming_app_data().as_deref(),
        default_browser_family(),
    )
}

/// What an import says when it fails for a reason the person can act on: `nebula-import:<code>[:<detail>...]`. The
/// window turns the code into a sentence in the person's language, so no sentence is written here.
fn import_error(code: &str, details: &[&str]) -> String {
    let mut message = format!("nebula-import:{code}");
    for detail in details {
        message.push(':');
        message.push_str(detail);
    }
    message
}

/// Reads the saved passwords of one browser (all of its profiles). `limit` is only a safety valve for callers
/// that want one; the importer passes none, so every saved login comes over.
#[tauri::command]
pub fn import_default_browser_passwords(
    limit: Option<usize>,
    browser: Option<String>,
) -> Result<Vec<ImportedPassword>, String> {
    let browser_id = browser.as_deref();
    let source = resolve_password_source_for(browser_id)
        .ok_or_else(|| import_error("database-missing", &[browser_id.unwrap_or("")]))?;

    let master_key = chromium_master_key(&source.user_data)
        .map_err(|detail| import_error("key-unavailable", &[&detail]))?;
    let source_id = browser_id
        .map(str::to_string)
        .or_else(|| installation_id_for(&source.user_data))
        .unwrap_or_default();
    import_from_user_data(&source.user_data, &master_key, limit, &source_id)
}

fn installation_id_for(user_data: &Path) -> Option<String> {
    chromium_installations()
        .into_iter()
        .find(|installation| installation.user_data == user_data)
        .map(|installation| installation.id.to_string())
}

struct ImportStats {
    total_rows: usize,
    decryptable: usize,
    decrypt_failed: usize,
    app_bound_skipped: usize,
}

/// Why nothing came over: the browser shows passwords but its file has no rows, its newer app-bound encryption cannot
/// be opened from outside, or the rows could not be decrypted. Each is a code (see `import_error`).
fn import_failure_message(stats: &ImportStats) -> String {
    if stats.total_rows == 0 {
        return import_error("unreadable", &[]);
    }

    let total = stats.total_rows.to_string();
    if stats.app_bound_skipped > 0 && stats.decryptable == 0 {
        return import_error("app-bound-all", &[&total]);
    }

    if stats.app_bound_skipped > 0 {
        return import_error(
            "app-bound-some",
            &[&total, &stats.app_bound_skipped.to_string()],
        );
    }

    import_error("undecryptable", &[&total])
}

fn read_cell_bytes(row: &rusqlite::Row<'_>, index: usize) -> Result<Vec<u8>, rusqlite::Error> {
    match row.get_ref(index)? {
        rusqlite::types::ValueRef::Blob(bytes) => Ok(bytes.to_vec()),
        rusqlite::types::ValueRef::Text(bytes) => Ok(bytes.to_vec()),
        rusqlite::types::ValueRef::Null => Ok(Vec::new()),
        _ => Ok(Vec::new()),
    }
}

/// The profile folder a Login Data file belongs to; empty when the browser keeps its single profile in the
/// user-data folder itself (Opera).
fn profile_name_for(user_data: &Path, login_data: &Path) -> String {
    match login_data.parent() {
        Some(parent) if parent != user_data => parent
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn import_from_user_data(
    user_data: &Path,
    master_key: &[u8],
    limit: Option<usize>,
    browser_id: &str,
) -> Result<Vec<ImportedPassword>, String> {
    let login_paths = login_data_paths_in_user_data(user_data);
    if login_paths.is_empty() {
        return Err(import_error("login-data-missing", &[]));
    }

    let mut imported = Vec::new();
    let mut stats = ImportStats {
        total_rows: 0,
        decryptable: 0,
        decrypt_failed: 0,
        app_bound_skipped: 0,
    };

    for login_data in login_paths {
        let remaining = match limit {
            Some(limit) if imported.len() >= limit => break,
            Some(limit) => Some(limit - imported.len()),
            None => None,
        };
        let profile = profile_name_for(user_data, &login_data);
        let (batch, batch_stats) =
            read_password_rows(&login_data, master_key, remaining, browser_id, &profile)?;
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

fn read_password_rows(
    login_data: &Path,
    master_key: &[u8],
    limit: Option<usize>,
    browser_id: &str,
    profile: &str,
) -> Result<(Vec<ImportedPassword>, ImportStats), String> {
    with_readonly_database(login_data, |conn| {
        // Older databases have no date_last_used column; the dates only help the user choose between copies.
        let with_dates = "SELECT origin_url, action_url, username_value, password_value, date_created, date_last_used
           FROM logins
           ORDER BY date_created DESC";
        let without_last_used =
            "SELECT origin_url, action_url, username_value, password_value, date_created, 0
           FROM logins
           ORDER BY date_created DESC";
        let mut stmt = conn
            .prepare(with_dates)
            .or_else(|_| conn.prepare(without_last_used))
            .map_err(|error| error.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                let origin_url: String = row.get(0)?;
                let action_url: String = row.get(1)?;
                let username_blob = read_cell_bytes(row, 2)?;
                let password_blob = read_cell_bytes(row, 3)?;
                let created = row.get::<_, i64>(4).unwrap_or(0);
                let last_used = row.get::<_, i64>(5).unwrap_or(0);
                Ok((
                    origin_url,
                    action_url,
                    username_blob,
                    password_blob,
                    created,
                    last_used,
                ))
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
            let (origin_url, action_url, username_blob, password_blob, created, last_used) =
                row.map_err(|error| error.to_string())?;
            stats.total_rows += 1;

            let url = origin_url.trim();
            let url = if url.is_empty() {
                action_url.trim()
            } else {
                url
            };
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
                browser: browser_id.to_string(),
                profile: profile.to_string(),
                created_ms: chromium_time_to_unix_ms(created),
                last_used_ms: chromium_time_to_unix_ms(last_used),
            });

            if limit.is_some_and(|limit| imported.len() >= limit) {
                break;
            }
        }

        Ok((imported, stats))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    type Row<'a> = (&'a str, &'a str, Vec<u8>, i64, i64);

    /// Makes a `Login Data` database the way Chromium lays it out (plain user names, passwords as given).
    fn make_login_db(path: &Path, rows: &[Row<'_>], with_last_used: bool) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let conn = Connection::open(path).unwrap();
        let last_used = if with_last_used {
            ", date_last_used INTEGER NOT NULL DEFAULT 0"
        } else {
            ""
        };
        conn.execute_batch(&format!(
            "CREATE TABLE logins (origin_url TEXT, action_url TEXT, username_value TEXT, password_value BLOB, \
             date_created INTEGER NOT NULL DEFAULT 0{last_used}, blacklisted_by_user INTEGER NOT NULL DEFAULT 0);"
        ))
        .unwrap();
        for (url, user, password, created, used) in rows {
            if with_last_used {
                conn.execute(
                    "INSERT INTO logins (origin_url, action_url, username_value, password_value, date_created, date_last_used) \
                     VALUES (?1, '', ?2, ?3, ?4, ?5)",
                    rusqlite::params![url, user, password, created, used],
                )
                .unwrap();
            } else {
                conn.execute(
                    "INSERT INTO logins (origin_url, action_url, username_value, password_value, date_created) \
                     VALUES (?1, '', ?2, ?3, ?4)",
                    rusqlite::params![url, user, password, created],
                )
                .unwrap();
            }
        }
    }

    fn touch(path: &Path) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"{}").unwrap();
    }

    /// A Chromium user-data folder with one profile that has a (possibly empty) login database. An empty profile
    /// name puts the profile in the folder itself, as Opera does.
    fn chromium_user_data(user_data: &Path, profile: &str, rows: &[Row<'_>]) {
        let profile_dir = if profile.is_empty() {
            user_data.to_path_buf()
        } else {
            user_data.join(profile)
        };
        touch(&profile_dir.join("Preferences"));
        make_login_db(&profile_dir.join("Login Data"), rows, true);
    }

    #[test]
    fn chromium_times_become_unix_milliseconds() {
        // 2026-01-01T00:00:00Z as Chromium writes it (microseconds since 1601).
        let unix_ms = 1_767_225_600_000_i64;
        assert_eq!(
            chromium_time_to_unix_ms((unix_ms + CHROMIUM_EPOCH_OFFSET_MS) * 1000),
            Some(unix_ms)
        );
        assert_eq!(chromium_time_to_unix_ms(0), None);
        assert_eq!(chromium_time_to_unix_ms(-5), None);
    }

    #[test]
    fn every_supported_chromium_browser_is_looked_for_in_its_own_folder() {
        let local = Path::new("C:/L");
        let roaming = Path::new("C:/R");
        let found = chromium_installations_in(Some(local), Some(roaming));
        let by_id = |id: &str| {
            found
                .iter()
                .find(|item| item.id == id)
                .map(|item| item.user_data.clone())
        };

        for id in [
            "chrome",
            "chrome-beta",
            "chrome-dev",
            "chrome-canary",
            "edge",
            "edge-beta",
            "edge-dev",
            "edge-canary",
            "brave",
            "brave-beta",
            "brave-nightly",
            "vivaldi",
            "chromium",
            "thorium",
        ] {
            assert!(
                by_id(id).unwrap().starts_with(local),
                "{id} lives under Local AppData"
            );
        }
        // Opera keeps its profile in Roaming, in the folder itself.
        assert_eq!(
            by_id("opera").unwrap(),
            roaming.join("Opera Software/Opera Stable")
        );
        assert_eq!(
            by_id("opera-gx").unwrap(),
            roaming.join("Opera Software/Opera GX Stable")
        );
        // Without the folders nothing is guessed.
        assert!(chromium_installations_in(None, None).is_empty());
        let ids: Vec<_> = found.iter().map(|item| item.id).collect();
        let mut unique = ids.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(ids.len(), unique.len(), "ids are unique");
    }

    #[test]
    fn default_browser_progids_map_to_the_right_family() {
        for (prog_id, family) in [
            ("ChromeHTML", "chrome"),
            ("ChromeBHTML", "chrome"),
            ("MSEdgeHTM", "edge"),
            ("BraveHTML", "brave"),
            ("VivaldiHTM.ABC", "vivaldi"),
            ("OperaStable", "opera"),
            ("Opera GX Stable", "opera-gx"),
            ("ChromiumHTM", "chromium"),
            ("FirefoxURL-308046B0AF4A39CB", "firefox"),
        ] {
            assert_eq!(browser_id_from_prog_id(prog_id), Some(family), "{prog_id}");
        }
        assert_eq!(browser_id_from_prog_id("SafariHTML"), None);
    }

    #[test]
    fn found_browsers_are_listed_with_their_counts_and_the_default_first() {
        let dir = tempfile::tempdir().unwrap();
        let local = dir.path().join("Local");
        let roaming = dir.path().join("Roaming");
        let blob = b"x".to_vec();

        chromium_user_data(
            &local.join("Google/Chrome/User Data"),
            "Default",
            &[
                ("https://a.example/", "me", blob.clone(), 1, 0),
                ("https://b.example/", "me", blob.clone(), 1, 0),
            ],
        );
        chromium_user_data(
            &local.join("BraveSoftware/Brave-Browser/User Data"),
            "Default",
            &[("https://a.example/", "me", blob.clone(), 1, 0)],
        );
        // Opera GX: the profile is the folder itself.
        chromium_user_data(
            &roaming.join("Opera Software/Opera GX Stable"),
            "",
            &[("https://c.example/", "me", blob.clone(), 1, 0)],
        );
        // Installed but never used (no login database): not offered.
        touch(&local.join("Vivaldi/User Data/Default/Preferences"));
        std::fs::create_dir_all(roaming.join("Mozilla/Firefox/Profiles/x.default-release"))
            .unwrap();

        let sources = password_sources_in(Some(&local), Some(&roaming), Some("brave"));
        let names: Vec<_> = sources.iter().map(|s| s.display_name.as_str()).collect();
        assert_eq!(names, ["Brave", "Firefox", "Google Chrome", "Opera GX"]);
        assert!(sources[0].is_default);
        assert!(!sources[1..].iter().any(|s| s.is_default));
        let count = |name: &str| {
            sources
                .iter()
                .find(|s| s.display_name == name)
                .unwrap()
                .login_count
        };
        assert_eq!(count("Google Chrome"), Some(2));
        assert_eq!(count("Brave"), Some(1));
        assert_eq!(count("Opera GX"), Some(1));
        let firefox = sources.iter().find(|s| s.browser == "firefox").unwrap();
        assert!(firefox.csv_only && firefox.login_count.is_none());
        assert!(sources
            .iter()
            .filter(|s| s.browser != "firefox")
            .all(|s| !s.csv_only));
    }

    #[test]
    fn firefox_is_only_recognised_when_it_has_a_profile() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!firefox_installed_in(Some(dir.path())));
        std::fs::create_dir_all(dir.path().join("Mozilla/Firefox/Profiles")).unwrap();
        assert!(
            !firefox_installed_in(Some(dir.path())),
            "an empty profiles folder is not a profile"
        );
        std::fs::create_dir_all(dir.path().join("Mozilla/Firefox/Profiles/abc.default")).unwrap();
        assert!(firefox_installed_in(Some(dir.path())));
        assert!(!firefox_installed_in(None));
    }

    #[test]
    fn a_single_profile_browser_has_its_login_data_in_the_folder_itself() {
        let dir = tempfile::tempdir().unwrap();
        let opera = dir.path().join("Opera Stable");
        chromium_user_data(&opera, "", &[]);
        let paths = login_data_paths_in_user_data(&opera);
        assert_eq!(paths, vec![opera.join("Login Data")]);
        assert_eq!(profile_name_for(&opera, &paths[0]), "");

        let chrome = dir.path().join("User Data");
        chromium_user_data(&chrome, "Profile 2", &[]);
        let paths = login_data_paths_in_user_data(&chrome);
        assert_eq!(profile_name_for(&chrome, &paths[0]), "Profile 2");
    }

    #[cfg(target_os = "windows")]
    mod decrypting {
        use super::*;

        const KEY: [u8; 32] = [7; 32];

        fn v10(plain: &str, nonce_seed: u8) -> Vec<u8> {
            use aes_gcm::aead::{Aead, KeyInit};
            use aes_gcm::{Aes256Gcm, Nonce};
            let nonce = [nonce_seed; 12];
            let cipher = Aes256Gcm::new_from_slice(&KEY).unwrap();
            let sealed = cipher
                .encrypt(Nonce::from_slice(&nonce), plain.as_bytes())
                .unwrap();
            let mut blob = b"v10".to_vec();
            blob.extend_from_slice(&nonce);
            blob.extend(sealed);
            blob
        }

        #[test]
        fn every_profile_is_read_and_each_password_says_where_it_came_from() {
            let dir = tempfile::tempdir().unwrap();
            let user_data = dir.path().join("User Data");
            let created = (1_700_000_000_000_i64 + CHROMIUM_EPOCH_OFFSET_MS) * 1000;
            let used = (1_760_000_000_000_i64 + CHROMIUM_EPOCH_OFFSET_MS) * 1000;
            chromium_user_data(
                &user_data,
                "Default",
                &[(
                    "https://shop.example/",
                    "me",
                    v10("first-pw", 1),
                    created,
                    used,
                )],
            );
            chromium_user_data(
                &user_data,
                "Profile 1",
                &[(
                    "https://shop.example/",
                    "me",
                    v10("second-pw", 2),
                    created,
                    0,
                )],
            );

            let imported = import_from_user_data(&user_data, &KEY, None, "chrome").unwrap();
            assert_eq!(imported.len(), 2);
            let default = imported
                .iter()
                .find(|item| item.profile == "Default")
                .unwrap();
            assert_eq!(default.password, "first-pw");
            assert_eq!(default.browser, "chrome");
            assert_eq!(default.created_ms, Some(1_700_000_000_000));
            assert_eq!(default.last_used_ms, Some(1_760_000_000_000));
            let other = imported
                .iter()
                .find(|item| item.profile == "Profile 1")
                .unwrap();
            assert_eq!(other.password, "second-pw");
            assert_eq!(other.last_used_ms, None, "never used");
        }

        #[test]
        fn there_is_no_cap_on_how_many_passwords_come_over() {
            let dir = tempfile::tempdir().unwrap();
            let user_data = dir.path().join("User Data");
            let rows: Vec<(String, Vec<u8>)> = (0..1200)
                .map(|index| {
                    (
                        format!("https://site{index}.example/"),
                        v10("pw", (index % 250) as u8),
                    )
                })
                .collect();
            let borrowed: Vec<Row<'_>> = rows
                .iter()
                .map(|(url, blob)| (url.as_str(), "me", blob.clone(), 5, 0))
                .collect();
            chromium_user_data(&user_data, "Default", &borrowed);

            assert_eq!(
                import_from_user_data(&user_data, &KEY, None, "brave")
                    .unwrap()
                    .len(),
                1200
            );
            // A caller that asks for a limit still gets one.
            assert_eq!(
                import_from_user_data(&user_data, &KEY, Some(10), "brave")
                    .unwrap()
                    .len(),
                10
            );
        }

        #[test]
        fn a_database_without_a_last_used_column_still_imports() {
            let dir = tempfile::tempdir().unwrap();
            let user_data = dir.path().join("User Data");
            let profile = user_data.join("Default");
            touch(&profile.join("Preferences"));
            make_login_db(
                &profile.join("Login Data"),
                &[("https://old.example/", "me", v10("pw", 3), 5, 0)],
                false,
            );
            let imported = import_from_user_data(&user_data, &KEY, None, "chromium").unwrap();
            assert_eq!(imported.len(), 1);
            assert_eq!(imported[0].last_used_ms, None);
        }

        #[test]
        fn a_failed_import_says_why_with_a_code_the_window_can_put_in_words() {
            let stats = |total_rows, decryptable, app_bound_skipped| ImportStats {
                total_rows,
                decryptable,
                decrypt_failed: 0,
                app_bound_skipped,
            };
            assert_eq!(
                import_failure_message(&stats(0, 0, 0)),
                "nebula-import:unreadable"
            );
            assert_eq!(
                import_failure_message(&stats(12, 0, 12)),
                "nebula-import:app-bound-all:12"
            );
            assert_eq!(
                import_failure_message(&stats(12, 7, 5)),
                "nebula-import:app-bound-some:12:5"
            );
            assert_eq!(
                import_failure_message(&stats(12, 0, 0)),
                "nebula-import:undecryptable:12"
            );
            assert_eq!(
                import_error("database-missing", &["brave"]),
                "nebula-import:database-missing:brave"
            );
            assert_eq!(
                import_error("login-data-missing", &[]),
                "nebula-import:login-data-missing"
            );
        }

        #[test]
        fn a_missing_login_database_is_reported_as_a_code() {
            let dir = tempfile::tempdir().unwrap();
            let user_data = dir.path().join("User Data");
            std::fs::create_dir_all(&user_data).unwrap();
            assert_eq!(
                import_from_user_data(&user_data, &KEY, None, "chrome").unwrap_err(),
                "nebula-import:login-data-missing"
            );
        }

        #[test]
        fn a_user_name_that_starts_with_v1_is_not_mistaken_for_an_encrypted_value() {
            assert_eq!(
                decrypt_chromium_blob(b"v1ctor@example.com", &KEY).unwrap(),
                "v1ctor@example.com"
            );
            assert_eq!(
                decrypt_chromium_blob(&v10("secret", 9), &KEY).unwrap(),
                "secret"
            );
            assert_eq!(
                decrypt_chromium_blob(b"v20....", &KEY),
                Err("app-bound-v20".to_string())
            );
        }
    }
}
