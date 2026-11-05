//! What Nebula can bring over from the browsers on this computer: which browsers there are, and their bookmarks.
//! (Passwords have their own commands in `browser_passwords.rs`; both use the same list of browsers.)

use crate::browser_passwords::{
    best_login_data_path, chromium_installations_in, chromium_time_to_unix_ms, count_logins,
    default_browser_family, firefox_installed_in, local_app_data, profile_dirs_in_user_data,
    roaming_app_data, with_readonly_database,
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// One browser the user can pick in the import step.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserImportSource {
    browser: String,
    display_name: String,
    /// The browser Windows opens links with.
    is_default: bool,
    /// Saved logins Nebula can read (counted, not decrypted); `None` when there is no readable password store.
    login_count: Option<usize>,
    /// Whether the passwords can be read directly. Firefox is recognised, but its passwords only come over with
    /// its CSV export.
    passwords_direct: bool,
    /// The passwords can only be brought over with the browser's own CSV export (Firefox).
    passwords_csv_only: bool,
    bookmark_count: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedBookmark {
    pub title: String,
    pub url: String,
    /// The id of the browser it came from (`chrome`, `firefox`, ...).
    pub browser: String,
    /// When it was added and when it was last used, as Unix milliseconds.
    pub date_added_ms: Option<i64>,
    pub last_used_ms: Option<i64>,
}

#[derive(Debug, Deserialize)]
struct BookmarksFile {
    #[serde(default)]
    roots: BookmarksRoots,
}

#[derive(Debug, Default, Deserialize)]
struct BookmarksRoots {
    bookmark_bar: Option<BookmarkNode>,
    other: Option<BookmarkNode>,
    synced: Option<BookmarkNode>,
}

#[derive(Debug, Deserialize)]
struct BookmarkNode {
    #[serde(rename = "type")]
    node_type: Option<String>,
    name: Option<String>,
    url: Option<String>,
    date_added: Option<String>,
    date_last_used: Option<String>,
    children: Option<Vec<BookmarkNode>>,
}

fn is_web_address(value: &str) -> bool {
    value.starts_with("http://") || value.starts_with("https://")
}

fn chromium_time(value: Option<&String>) -> Option<i64> {
    value
        .and_then(|text| text.trim().parse::<i64>().ok())
        .and_then(chromium_time_to_unix_ms)
}

fn collect_bookmarks(node: &BookmarkNode, browser: &str, out: &mut Vec<ImportedBookmark>) {
    if node.node_type.as_deref() == Some("url") {
        if let Some(url) = node.url.as_deref().map(str::trim) {
            if is_web_address(url) {
                out.push(ImportedBookmark {
                    title: node.name.as_deref().unwrap_or_default().trim().to_string(),
                    url: url.to_string(),
                    browser: browser.to_string(),
                    date_added_ms: chromium_time(node.date_added.as_ref()),
                    last_used_ms: chromium_time(node.date_last_used.as_ref()),
                });
            }
        }
    }

    for child in node.children.iter().flatten() {
        collect_bookmarks(child, browser, out);
    }
}

fn parse_chromium_bookmarks(path: &Path, browser: &str) -> Result<Vec<ImportedBookmark>, String> {
    let raw = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
    let file: BookmarksFile = serde_json::from_str(&raw).map_err(|error| error.to_string())?;

    let mut bookmarks = Vec::new();
    for root in [
        &file.roots.bookmark_bar,
        &file.roots.other,
        &file.roots.synced,
    ]
    .into_iter()
    .flatten()
    {
        collect_bookmarks(root, browser, &mut bookmarks);
    }
    Ok(bookmarks)
}

/// The bookmark files of every profile of a Chromium browser (`Bookmarks` and the signed-in `AccountBookmarks`).
fn bookmark_files_in_user_data(user_data: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    for profile in profile_dirs_in_user_data(user_data) {
        for name in ["Bookmarks", "AccountBookmarks"] {
            let path = profile.join(name);
            if path.is_file() {
                files.push(path);
            }
        }
    }
    files.sort();
    files.dedup();
    files
}

fn firefox_places_files(roaming: Option<&Path>) -> Vec<PathBuf> {
    let Some(profiles) = roaming.map(|root| root.join("Mozilla/Firefox/Profiles")) else {
        return Vec::new();
    };
    let Ok(entries) = std::fs::read_dir(profiles) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .flatten()
        .map(|entry| entry.path().join("places.sqlite"))
        .filter(|path| path.is_file())
        .collect();
    files.sort();
    files
}

/// Firefox keeps bookmarks unencrypted in `places.sqlite`; microseconds since 1970.
fn read_firefox_bookmarks(path: &Path) -> Result<Vec<ImportedBookmark>, String> {
    fn micros_to_ms(value: Option<i64>) -> Option<i64> {
        value.map(|micros| micros / 1000).filter(|ms| *ms > 0)
    }

    with_readonly_database(path, |conn| {
        let mut statement = conn
            .prepare(
                "SELECT COALESCE(NULLIF(b.title, ''), p.title, ''), p.url, b.dateAdded, p.last_visit_date
                 FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk
                 WHERE b.type = 1 AND (p.url LIKE 'http://%' OR p.url LIKE 'https://%')",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok(ImportedBookmark {
                    title: row.get::<_, String>(0)?.trim().to_string(),
                    url: row.get::<_, String>(1)?.trim().to_string(),
                    browser: "firefox".to_string(),
                    date_added_ms: micros_to_ms(row.get::<_, Option<i64>>(2)?),
                    last_used_ms: micros_to_ms(row.get::<_, Option<i64>>(3)?),
                })
            })
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    })
}

/// Every bookmark of one browser, all its profiles. A file that cannot be read is skipped as long as another one
/// can; the caller decides what to keep (the most recent ones, one per site).
fn bookmarks_for_browser_in(
    local: Option<&Path>,
    roaming: Option<&Path>,
    browser: &str,
) -> Result<Vec<ImportedBookmark>, String> {
    let mut all = Vec::new();
    let mut last_error = None;

    if browser == "firefox" {
        let files = firefox_places_files(roaming);
        if files.is_empty() {
            return Err("Firefox yer işaretleri dosyası bulunamadı.".to_string());
        }
        for file in files {
            match read_firefox_bookmarks(&file) {
                Ok(mut found) => all.append(&mut found),
                Err(error) => last_error = Some(error),
            }
        }
    } else {
        let installation = chromium_installations_in(local, roaming)
            .into_iter()
            .find(|installation| installation.id == browser)
            .ok_or_else(|| format!("{browser} bulunamadı."))?;
        let files = bookmark_files_in_user_data(&installation.user_data);
        if files.is_empty() {
            return Err("Yer işaretleri dosyası bulunamadı.".to_string());
        }
        for file in files {
            match parse_chromium_bookmarks(&file, browser) {
                Ok(mut found) => all.append(&mut found),
                Err(error) => last_error = Some(error),
            }
        }
    }

    match (all.is_empty(), last_error) {
        (true, Some(error)) => Err(error),
        _ => Ok(all),
    }
}

/// Every browser that has bookmarks or readable passwords to offer, the default browser first.
fn import_sources_in(
    local: Option<&Path>,
    roaming: Option<&Path>,
    default_family: Option<&str>,
) -> Vec<BrowserImportSource> {
    let mut sources = Vec::new();

    for installation in chromium_installations_in(local, roaming) {
        let has_logins = best_login_data_path(&installation.user_data).is_some();
        let bookmark_count = bookmarks_for_browser_in(local, roaming, installation.id)
            .ok()
            .map(|found| found.len())
            .filter(|count| *count > 0);
        if !has_logins && bookmark_count.is_none() {
            continue;
        }
        sources.push(BrowserImportSource {
            browser: installation.id.to_string(),
            display_name: installation.name.to_string(),
            is_default: default_family == Some(installation.id),
            login_count: if has_logins {
                count_logins(&installation.user_data)
            } else {
                None
            },
            passwords_direct: has_logins,
            passwords_csv_only: false,
            bookmark_count,
        });
    }

    if firefox_installed_in(roaming) {
        sources.push(BrowserImportSource {
            browser: "firefox".to_string(),
            display_name: "Firefox".to_string(),
            is_default: default_family == Some("firefox"),
            login_count: None,
            passwords_direct: false,
            passwords_csv_only: true,
            bookmark_count: bookmarks_for_browser_in(local, roaming, "firefox")
                .ok()
                .map(|found| found.len())
                .filter(|count| *count > 0),
        });
    }

    sources.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| a.display_name.cmp(&b.display_name))
    });
    sources
}

/// Where Nebula looked for one browser, and what it found there (for the "details" under an empty list).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserLookupDetail {
    browser: String,
    folder: String,
    folder_exists: bool,
    profiles: usize,
    password_store: bool,
    bookmark_files: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserLookupDiagnostics {
    local_app_data: Option<String>,
    roaming_app_data: Option<String>,
    firefox_installed: bool,
    browsers: Vec<BrowserLookupDetail>,
}

fn lookup_diagnostics_in(local: Option<&Path>, roaming: Option<&Path>) -> BrowserLookupDiagnostics {
    BrowserLookupDiagnostics {
        local_app_data: local.map(|path| path.display().to_string()),
        roaming_app_data: roaming.map(|path| path.display().to_string()),
        firefox_installed: firefox_installed_in(roaming),
        browsers: chromium_installations_in(local, roaming)
            .into_iter()
            .map(|installation| BrowserLookupDetail {
                browser: installation.id.to_string(),
                folder: installation.user_data.display().to_string(),
                folder_exists: installation.user_data.is_dir(),
                profiles: profile_dirs_in_user_data(&installation.user_data).len(),
                password_store: best_login_data_path(&installation.user_data).is_some(),
                bookmark_files: bookmark_files_in_user_data(&installation.user_data).len(),
            })
            .collect(),
    }
}

/// What the lookup sees on this computer; shown to the user when the list of browsers comes out empty.
#[tauri::command]
pub fn browser_import_diagnostics() -> BrowserLookupDiagnostics {
    lookup_diagnostics_in(local_app_data().as_deref(), roaming_app_data().as_deref())
}

#[tauri::command]
pub fn list_browser_import_sources() -> Vec<BrowserImportSource> {
    import_sources_in(
        local_app_data().as_deref(),
        roaming_app_data().as_deref(),
        default_browser_family(),
    )
}

/// Every bookmark of one browser (all profiles), with when it was added and last used.
#[tauri::command]
pub fn import_browser_bookmarks(browser: String) -> Result<Vec<ImportedBookmark>, String> {
    bookmarks_for_browser_in(
        local_app_data().as_deref(),
        roaming_app_data().as_deref(),
        &browser,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    const ADDED: i64 = (1_700_000_000_000 + 11_644_473_600_000) * 1000;
    const USED: i64 = (1_760_000_000_000 + 11_644_473_600_000) * 1000;

    fn write(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn bookmarks_json(bar: &str, other: &str) -> String {
        format!(
            r#"{{"roots":{{"bookmark_bar":{{"type":"folder","name":"Bar","children":[{bar}]}},
            "other":{{"type":"folder","name":"Other","children":[{other}]}}}}}}"#
        )
    }

    fn url_node(name: &str, url: &str, added: i64, used: i64) -> String {
        format!(
            r#"{{"type":"url","name":"{name}","url":"{url}","date_added":"{added}","date_last_used":"{used}"}}"#
        )
    }

    /// A Chromium profile with a Preferences file, a bookmark file and optionally a login database.
    fn chromium_profile(profile_dir: &Path, bookmarks: Option<&str>, with_logins: bool) {
        write(&profile_dir.join("Preferences"), "{}");
        if let Some(json) = bookmarks {
            write(&profile_dir.join("Bookmarks"), json);
        }
        if with_logins {
            let conn = Connection::open(profile_dir.join("Login Data")).unwrap();
            conn.execute_batch(
                "CREATE TABLE logins (origin_url TEXT, action_url TEXT, username_value TEXT, password_value BLOB, \
                 date_created INTEGER, blacklisted_by_user INTEGER DEFAULT 0); \
                 INSERT INTO logins (origin_url, action_url, username_value, password_value, date_created) \
                 VALUES ('https://a.example/', '', 'me', x'00', 1);",
            )
            .unwrap();
        }
    }

    fn firefox_profile(roaming: &Path, name: &str, rows: &[(&str, &str, i64, i64)]) {
        let dir = roaming.join("Mozilla/Firefox/Profiles").join(name);
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(dir.join("places.sqlite")).unwrap();
        conn.execute_batch(
            "CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER); \
             CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, title TEXT, dateAdded INTEGER);",
        )
        .unwrap();
        for (index, (url, title, added, visited)) in rows.iter().enumerate() {
            let id = index as i64 + 1;
            conn.execute(
                "INSERT INTO moz_places (id, url, title, last_visit_date) VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![id, url, title, visited],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO moz_bookmarks (id, type, fk, title, dateAdded) VALUES (?1, 1, ?1, ?2, ?3)",
                rusqlite::params![id, title, added],
            )
            .unwrap();
        }
        // A folder is a bookmark row of another type, without a place.
        conn.execute(
            "INSERT INTO moz_bookmarks (id, type, fk, title, dateAdded) VALUES (100, 2, NULL, 'Folder', 1)",
            [],
        )
        .unwrap();
    }

    #[test]
    fn bookmarks_of_every_profile_come_with_their_dates_and_only_web_addresses() {
        let dir = tempfile::tempdir().unwrap();
        let local = dir.path().join("Local");
        let user_data = local.join("Google/Chrome/User Data");
        chromium_profile(
            &user_data.join("Default"),
            Some(&bookmarks_json(
                &format!(
                    "{},{},{}",
                    url_node("Shop", "https://shop.example/", ADDED, USED),
                    url_node("Settings", "chrome://settings", ADDED, 0),
                    url_node("Local file", "file:///C:/x.html", ADDED, 0),
                ),
                &url_node("News", "http://news.example/", ADDED, 0),
            )),
            false,
        );
        chromium_profile(
            &user_data.join("Profile 1"),
            Some(&bookmarks_json(
                &url_node("Work", "https://work.example/", ADDED, USED),
                "",
            )),
            false,
        );
        // The signed-in account's own file is read too.
        write(
            &user_data.join("Profile 1/AccountBookmarks"),
            &bookmarks_json(&url_node("Synced", "https://synced.example/", ADDED, 0), ""),
        );

        let found = bookmarks_for_browser_in(Some(&local), None, "chrome").unwrap();
        let mut urls: Vec<_> = found.iter().map(|item| item.url.as_str()).collect();
        urls.sort_unstable();
        assert_eq!(
            urls,
            [
                "http://news.example/",
                "https://shop.example/",
                "https://synced.example/",
                "https://work.example/",
            ]
        );
        let shop = found.iter().find(|item| item.title == "Shop").unwrap();
        assert_eq!(shop.browser, "chrome");
        assert_eq!(shop.date_added_ms, Some(1_700_000_000_000));
        assert_eq!(shop.last_used_ms, Some(1_760_000_000_000));
        let news = found.iter().find(|item| item.title == "News").unwrap();
        assert_eq!(news.last_used_ms, None, "never used");
    }

    #[test]
    fn opera_keeps_its_bookmarks_in_the_folder_itself() {
        let dir = tempfile::tempdir().unwrap();
        let roaming = dir.path().join("Roaming");
        chromium_profile(
            &roaming.join("Opera Software/Opera GX Stable"),
            Some(&bookmarks_json(
                &url_node("Speed Dial", "https://gx.example/", ADDED, 0),
                "",
            )),
            false,
        );
        let found = bookmarks_for_browser_in(None, Some(&roaming), "opera-gx").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].browser, "opera-gx");
        assert!(bookmarks_for_browser_in(None, Some(&roaming), "opera").is_err());
        assert!(bookmarks_for_browser_in(None, Some(&roaming), "no-such-browser").is_err());
    }

    #[test]
    fn firefox_bookmarks_are_read_directly_and_folders_are_left_out() {
        let dir = tempfile::tempdir().unwrap();
        let roaming = dir.path().join("Roaming");
        firefox_profile(
            &roaming,
            "abc.default-release",
            &[
                (
                    "https://shop.example/",
                    "Shop",
                    1_700_000_000_000_000,
                    1_760_000_000_000_000,
                ),
                ("place:sort=8&maxResults=10", "Recent", 1, 1),
                ("https://untitled.example/", "", 1_650_000_000_000_000, 0),
            ],
        );
        let found = bookmarks_for_browser_in(None, Some(&roaming), "firefox").unwrap();
        assert_eq!(found.len(), 2, "only web addresses");
        let shop = found
            .iter()
            .find(|item| item.url == "https://shop.example/")
            .unwrap();
        assert_eq!(shop.title, "Shop");
        assert_eq!(shop.browser, "firefox");
        assert_eq!(shop.date_added_ms, Some(1_700_000_000_000));
        assert_eq!(shop.last_used_ms, Some(1_760_000_000_000));
        let untitled = found
            .iter()
            .find(|item| item.url == "https://untitled.example/")
            .unwrap();
        assert_eq!(untitled.last_used_ms, None);
    }

    #[test]
    fn the_diagnostics_say_where_each_browser_was_looked_for_and_what_was_there() {
        let dir = tempfile::tempdir().unwrap();
        let local = dir.path().join("Local");
        let roaming = dir.path().join("Roaming");
        let one = bookmarks_json(&url_node("A", "https://a.example/", ADDED, 0), "");
        chromium_profile(
            &local.join("BraveSoftware/Brave-Browser/User Data/Default"),
            Some(&one),
            true,
        );

        let report = lookup_diagnostics_in(Some(&local), Some(&roaming));
        assert_eq!(
            report.local_app_data.as_deref(),
            Some(local.to_str().unwrap())
        );
        assert!(!report.firefox_installed);
        assert_eq!(
            report.browsers.len(),
            16,
            "every supported browser is reported, found or not"
        );
        let brave = report
            .browsers
            .iter()
            .find(|item| item.browser == "brave")
            .unwrap();
        assert!(brave.folder_exists && brave.password_store);
        assert_eq!((brave.profiles, brave.bookmark_files), (1, 1));
        let chrome = report
            .browsers
            .iter()
            .find(|item| item.browser == "chrome")
            .unwrap();
        assert!(!chrome.folder_exists && !chrome.password_store);
        assert_eq!((chrome.profiles, chrome.bookmark_files), (0, 0));

        // Without the environment folders there is nothing to look in, and that is said too.
        let nothing = lookup_diagnostics_in(None, None);
        assert!(nothing.local_app_data.is_none() && nothing.browsers.is_empty());
    }

    #[test]
    fn the_listing_offers_browsers_with_bookmarks_or_passwords_and_the_default_first() {
        let dir = tempfile::tempdir().unwrap();
        let local = dir.path().join("Local");
        let roaming = dir.path().join("Roaming");
        let one = bookmarks_json(&url_node("A", "https://a.example/", ADDED, 0), "");

        // Bookmarks and passwords.
        chromium_profile(
            &local.join("Google/Chrome/User Data/Default"),
            Some(&one),
            true,
        );
        // Only bookmarks (a browser the user never saved a password in).
        chromium_profile(
            &local.join("BraveSoftware/Brave-Browser/User Data/Default"),
            Some(&one),
            false,
        );
        // Only passwords.
        chromium_profile(&local.join("Vivaldi/User Data/Default"), None, true);
        // Installed but empty: not offered.
        chromium_profile(&local.join("Chromium/User Data/Default"), None, false);
        // Opera GX with its profile in the folder itself.
        chromium_profile(
            &roaming.join("Opera Software/Opera GX Stable"),
            Some(&one),
            true,
        );
        firefox_profile(
            &roaming,
            "x.default",
            &[("https://a.example/", "A", 1_700_000_000_000_000, 0)],
        );

        let sources = import_sources_in(Some(&local), Some(&roaming), Some("brave"));
        let names: Vec<_> = sources.iter().map(|s| s.display_name.as_str()).collect();
        assert_eq!(
            names,
            ["Brave", "Firefox", "Google Chrome", "Opera GX", "Vivaldi"]
        );
        assert!(sources[0].is_default && !sources[1..].iter().any(|s| s.is_default));

        let by = |name: &str| sources.iter().find(|s| s.display_name == name).unwrap();
        assert_eq!(
            (
                by("Google Chrome").bookmark_count,
                by("Google Chrome").login_count
            ),
            (Some(1), Some(1))
        );
        assert_eq!(
            (by("Brave").bookmark_count, by("Brave").login_count),
            (Some(1), None)
        );
        assert!(!by("Brave").passwords_direct);
        assert_eq!(
            (by("Vivaldi").bookmark_count, by("Vivaldi").login_count),
            (None, Some(1))
        );
        assert_eq!(by("Opera GX").login_count, Some(1));
        // Firefox: bookmarks are read directly, passwords need its CSV export.
        assert_eq!(by("Firefox").bookmark_count, Some(1));
        assert!(!by("Firefox").passwords_direct && by("Firefox").login_count.is_none());
        assert!(by("Firefox").passwords_csv_only);
        // A browser with bookmarks only has no passwords to read, but that is not a CSV matter.
        assert!(!by("Brave").passwords_csv_only);
        assert!(by("Google Chrome").passwords_direct);
    }
}
