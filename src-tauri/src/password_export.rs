//! Exporting the saved passwords as a CSV file, in the format that Chrome, Firefox and Bitwarden import.
//!
//! The whole path stays on the native side: the person picks where the file goes, Windows Hello confirms who is
//! asking, and only then is the encrypted vault read and the file written. The passwords never pass through the
//! shell's JavaScript. A refusal (no Windows Hello, cancelled, a request from anything but the browser shell)
//! exports nothing.

use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PasswordExportResult {
    /// `exported`, `cancelled`, `unavailable` (no Windows Hello) or `failed`.
    status: &'static str,
    count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
}

impl PasswordExportResult {
    fn refused(status: &'static str) -> Self {
        Self {
            status,
            count: 0,
            file_name: None,
        }
    }
}

/// One CSV field, always quoted, with inner quotes doubled.
fn csv_field(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

/// The CSV for the entries of the vault (`label`, `url`, `username`, `password`), and how many there were. The
/// header is Chrome's: `name,url,username,password,note`. Text is written as it is stored; nothing is changed
/// in a password.
fn csv_text(vault_json: &str) -> Option<(String, usize)> {
    let entries = serde_json::from_str::<serde_json::Value>(vault_json).ok()?;
    let entries = entries.as_array()?;
    let text = |entry: &serde_json::Value, key: &str| {
        entry
            .get(key)
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let mut lines = vec!["name,url,username,password,note".to_string()];
    for entry in entries {
        lines.push(
            [
                csv_field(&text(entry, "label")),
                csv_field(&text(entry, "url")),
                csv_field(&text(entry, "username")),
                csv_field(&text(entry, "password")),
                csv_field(""),
            ]
            .join(","),
        );
    }
    Some((lines.join("\r\n") + "\r\n", entries.len()))
}

/// The chosen path, with `.csv` added when the person typed a name without an extension.
fn with_csv_extension(path: PathBuf) -> PathBuf {
    if path.extension().is_some() {
        path
    } else {
        path.with_extension("csv")
    }
}

#[tauri::command]
pub async fn password_export_csv(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    message: String,
    title: String,
    file_name: String,
) -> PasswordExportResult {
    use tauri_plugin_dialog::DialogExt;

    if !crate::password_reveal::trusted_shell(webview.label(), webview.window().label()) {
        return PasswordExportResult::refused("failed");
    }
    let Some(message) = crate::password_reveal::verification_message(&message) else {
        return PasswordExportResult::refused("failed");
    };
    let window = webview.window();
    let title: String = title
        .chars()
        .filter(|c| !c.is_control())
        .take(120)
        .collect();
    let file_name: String = file_name
        .chars()
        .filter(|c| !c.is_control() && !"\\/:*?\"<>|".contains(*c))
        .take(80)
        .collect();
    #[cfg(target_os = "windows")]
    let hwnd = match window.hwnd() {
        Ok(hwnd) => hwnd.0 as isize,
        Err(_) => return PasswordExportResult::refused("failed"),
    };

    tauri::async_runtime::spawn_blocking(move || {
        // Where the file goes is the person's choice, asked before anything is read.
        let Some(chosen) = app
            .dialog()
            .file()
            .set_title(title)
            .set_file_name(if file_name.is_empty() {
                "nebula-passwords.csv".to_string()
            } else {
                file_name
            })
            .add_filter("CSV", &["csv"])
            .set_parent(&window)
            .blocking_save_file()
        else {
            return PasswordExportResult::refused("cancelled");
        };
        let Ok(path) = chosen.into_path() else {
            return PasswordExportResult::refused("failed");
        };
        let path = with_csv_extension(path);

        // Windows Hello confirms that the person asking is the person at the computer, right before the read.
        #[cfg(target_os = "windows")]
        if let Err(reason) = crate::password_reveal::verify_blocking(hwnd, message) {
            return PasswordExportResult::refused(match reason {
                crate::password_reveal::RevealFailure::Cancelled => "cancelled",
                crate::password_reveal::RevealFailure::Unavailable => "unavailable",
                crate::password_reveal::RevealFailure::Failed => "failed",
            });
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = message;
            return PasswordExportResult::refused("unavailable");
        }

        #[cfg(target_os = "windows")]
        {
            let Ok(Some(vault)) = crate::secure_password_vault::password_vault_load(app) else {
                return PasswordExportResult::refused("failed");
            };
            let Some((csv, count)) = csv_text(&vault) else {
                return PasswordExportResult::refused("failed");
            };
            if std::fs::write(&path, csv).is_err() {
                return PasswordExportResult::refused("failed");
            }
            PasswordExportResult {
                status: "exported",
                count,
                file_name: path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned()),
            }
        }
    })
    .await
    .unwrap_or_else(|_| PasswordExportResult::refused("failed"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_csv_has_chromes_columns_and_quotes_every_field() {
        let vault = serde_json::json!([
            { "id": "a", "label": "example.com", "url": "https://example.com/login", "username": "me@example.com", "password": "p4ss,word", "updatedAt": 1 },
            { "label": "say \"hi\"", "url": "", "username": "çağrı", "password": "multi\nline" },
            { "label": "no password at all" },
        ])
        .to_string();
        let (csv, count) = csv_text(&vault).expect("a vault array");
        assert_eq!(count, 3);
        let mut lines = csv.split("\r\n");
        assert_eq!(lines.next(), Some("name,url,username,password,note"));
        assert_eq!(
            lines.next(),
            Some("\"example.com\",\"https://example.com/login\",\"me@example.com\",\"p4ss,word\",\"\"")
        );
        // Inner quotes are doubled, a line break stays inside its quotes, missing fields are empty.
        assert!(csv.contains("\"say \"\"hi\"\"\",\"\",\"çağrı\",\"multi\nline\",\"\""));
        assert!(csv.contains("\"no password at all\",\"\",\"\",\"\",\"\""));
        assert!(csv.ends_with("\r\n"));
    }

    #[test]
    fn passwords_are_written_exactly_as_stored() {
        // A password that looks like a spreadsheet formula or an escape must not be altered.
        let vault =
            serde_json::json!([{ "label": "x", "username": "u", "password": "=1+1\\n\"';--" }])
                .to_string();
        let (csv, _) = csv_text(&vault).unwrap();
        assert!(csv.contains("\"=1+1\\n\"\"';--\""));
    }

    #[test]
    fn only_a_json_array_is_a_vault() {
        assert!(csv_text("{}").is_none());
        assert!(csv_text("not json").is_none());
        let (csv, count) = csv_text("[]").unwrap();
        assert_eq!(count, 0);
        assert_eq!(csv, "name,url,username,password,note\r\n");
    }

    #[test]
    fn a_name_without_an_extension_gets_csv() {
        assert_eq!(
            with_csv_extension(PathBuf::from(r"C:\backup\passwords")),
            PathBuf::from(r"C:\backup\passwords.csv")
        );
        assert_eq!(
            with_csv_extension(PathBuf::from(r"C:\backup\passwords.txt")),
            PathBuf::from(r"C:\backup\passwords.txt")
        );
    }
}
