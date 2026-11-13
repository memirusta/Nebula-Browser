//! Keeps the list of live malware addresses (URLhaus) up to date, when the person has asked for it.
//!
//! The lists that ship with the app never change after the release, and for most of them that is fine. This one cannot be: it names
//! addresses that serve malware right now, and an address stays on it for days, not months, so a copy made at build time is full of
//! dead addresses by the time anyone reads it. It is therefore the one thing Nebula downloads for the shield, and only after the person
//! turned "keep the malware list up to date" on (it is off otherwise, and turning it off deletes what was downloaded).
//!
//! What is asked of the network, and nothing else: one `GET` of one fixed address over HTTPS, every twelve hours at most, with no
//! cookies, no identifier and a generic user agent. What comes back is checked before it is used and written in one piece.
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Manager};

use crate::shield::{self, ListText};

/// The list, in the syntax the engine reads, as published by the malware-filter project from URLhaus's data (CC0).
const LIST_URL: &str =
    "https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-vivaldi-online.txt";
/// The file the list is kept in, under the app's local data folder.
const FOLDER: &str = "shield";
const FILE: &str = "urlhaus.txt";
/// It is published every twelve hours (and says so in its header); asking more often would only be impolite.
const REFRESH_AFTER: Duration = Duration::from_secs(12 * 60 * 60);
/// How often the running app looks at whether the copy has become old enough to replace.
const LOOK_EVERY: Duration = Duration::from_secs(30 * 60);
/// The list is about twelve megabytes; anything several times bigger is not it.
const MAX_BYTES: usize = 48 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(90);
/// A list with fewer addresses than this is an error page or a half-written file, not the list.
const MIN_RULES: usize = 1000;

static ENABLED: AtomicBool = AtomicBool::new(false);
static RUNNING: AtomicBool = AtomicBool::new(false);
static CURRENT: RwLock<Option<ListText>> = RwLock::new(None);

/// The downloaded list the shield is using now, if any.
pub fn current() -> Option<ListText> {
    CURRENT.read().ok().and_then(|current| current.clone())
}

fn store(list: Option<ListText>) {
    if let Ok(mut current) = CURRENT.write() {
        *current = list.clone();
    }
    shield::set_urlhaus(list);
}

fn list_path(app: &AppHandle) -> Option<PathBuf> {
    Some(
        app.path()
            .app_local_data_dir()
            .ok()?
            .join(FOLDER)
            .join(FILE),
    )
}

/// Whether `bytes` is the list: text, in the lists' syntax, with a believable number of rules and no sign of being a page.
pub fn validate(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > MAX_BYTES {
        return Err("the list is too big".to_string());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| "the list is not text".to_string())?;
    let head: String = text
        .chars()
        .take(2000)
        .collect::<String>()
        .to_ascii_lowercase();
    if head.contains("<html") || head.contains("<!doctype") {
        return Err("this is a web page, not the list".to_string());
    }
    let rules = text
        .lines()
        .filter(|line| line.starts_with("||") && line.contains('^'))
        .count();
    if rules < MIN_RULES {
        return Err(format!("only {rules} rules, which is not the list"));
    }
    Ok(text.to_string())
}

/// How old the saved copy is, or `None` if there is none (or its date cannot be read).
fn age_of(path: &Path, now: SystemTime) -> Option<Duration> {
    let modified = std::fs::metadata(path).ok()?.modified().ok()?;
    now.duration_since(modified).ok()
}

/// Whether a copy of this age (or none) is to be replaced.
pub fn is_due(age: Option<Duration>) -> bool {
    age.map_or(true, |age| age >= REFRESH_AFTER)
}

/// The saved copy, if it is there and still the list.
fn read_saved(path: &Path) -> Option<ListText> {
    let bytes = std::fs::read(path).ok()?;
    validate(&bytes).ok().map(|text| ListText(Arc::new(text)))
}

/// Writes the list in one piece: a half-written file is never what the next start reads.
fn save(path: &Path, text: &str) -> Result<(), String> {
    let folder = path.parent().ok_or("no folder")?;
    std::fs::create_dir_all(folder).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("txt.part");
    std::fs::write(&temporary, text).map_err(|error| error.to_string())?;
    std::fs::rename(&temporary, path).map_err(|error| error.to_string())
}

async fn download() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(3))
        .user_agent("Nebula")
        .https_only(true)
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(LIST_URL)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("the server answered {}", response.status()));
    }
    let bytes =
        crate::http_response::read_bounded_response(response, MAX_BYTES, "the list is too big")
            .await?;
    validate(&bytes)
}

/// One round: use the saved copy if nothing is in use yet, and replace it if it has become old.
async fn refresh(path: &Path) {
    if current().is_none() {
        if let Some(saved) = read_saved(path) {
            store(Some(saved));
        }
    }
    if !is_due(age_of(path, SystemTime::now())) {
        return;
    }
    // A download that fails leaves what was there; the next look, half an hour later, tries again.
    let Ok(text) = download().await else {
        return;
    };
    if !ENABLED.load(Ordering::SeqCst) {
        return;
    }
    if save(path, &text).is_ok() {
        store(Some(ListText(Arc::new(text))));
    }
}

/// Starts keeping the list up to date, or stops and forgets it. Called with every change of settings; asking for what is already
/// so does nothing.
pub fn set_enabled(app: &AppHandle, enabled: bool) {
    let was = ENABLED.swap(enabled, Ordering::SeqCst);
    if !enabled {
        if was {
            if let Some(path) = list_path(app) {
                let _ = std::fs::remove_file(&path);
            }
            store(None);
        }
        return;
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(path) = list_path(app) else {
        RUNNING.store(false, Ordering::SeqCst);
        return;
    };
    tauri::async_runtime::spawn(async move {
        while ENABLED.load(Ordering::SeqCst) {
            refresh(&path).await;
            // Looking again is cheap; waiting in small steps lets a switch-off take effect at once.
            let mut waited = Duration::ZERO;
            while waited < LOOK_EVERY && ENABLED.load(Ordering::SeqCst) {
                tokio::time::sleep(Duration::from_secs(30)).await;
                waited += Duration::from_secs(30);
            }
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(rules: usize) -> String {
        let mut text =
            String::from("! Title: Online Malicious URL Blocklist\n! Expires: 12 hours\n");
        for index in 0..rules {
            text.push_str(&format!(
                "||10.0.{}.{}^$document\n",
                index / 250,
                index % 250
            ));
        }
        text
    }

    #[test]
    fn a_list_is_taken_when_it_is_the_list_and_refused_when_it_is_anything_else() {
        let good = list(MIN_RULES + 5);
        assert_eq!(validate(good.as_bytes()).as_deref(), Ok(good.as_str()));
        assert!(validate(list(10).as_bytes()).is_err(), "too few rules");
        assert!(validate(b"<!DOCTYPE html><html><body>Not found</body></html>").is_err());
        assert!(validate(&[0xff, 0xfe, 0x00]).is_err(), "not text");
        let page = format!("<html>{}", list(MIN_RULES + 5));
        assert!(
            validate(page.as_bytes()).is_err(),
            "a page that happens to contain rules"
        );
        assert!(validate(&vec![b'a'; MAX_BYTES + 1]).is_err(), "too big");
    }

    #[test]
    fn a_copy_is_replaced_when_it_is_twelve_hours_old_or_there_is_none() {
        assert!(is_due(None));
        assert!(!is_due(Some(Duration::from_secs(60))));
        assert!(!is_due(Some(REFRESH_AFTER - Duration::from_secs(1))));
        assert!(is_due(Some(REFRESH_AFTER)));
    }

    #[test]
    fn the_list_is_saved_in_one_piece_and_read_back_only_while_it_is_still_the_list() {
        let folder = std::env::temp_dir().join(format!("nebula-urlhaus-{}", std::process::id()));
        let path = folder.join("shield").join(FILE);
        let text = list(MIN_RULES + 1);
        save(&path, &text).unwrap();
        assert!(
            !path.with_extension("txt.part").exists(),
            "no half-written file is left"
        );
        assert_eq!(
            read_saved(&path).map(|saved| saved.0.len()),
            Some(text.len())
        );
        assert!(age_of(&path, SystemTime::now()).unwrap() < Duration::from_secs(60));
        std::fs::write(&path, "damaged").unwrap();
        assert!(read_saved(&path).is_none(), "a damaged copy is not used");
        let _ = std::fs::remove_dir_all(&folder);
    }

    /// Asks the real server once. Not part of the usual run: it needs the network.
    #[test]
    #[ignore = "needs the network"]
    fn the_real_list_downloads_and_passes_the_check() {
        let text = tauri::async_runtime::block_on(download()).expect("the list downloads");
        assert!(text.lines().filter(|line| line.starts_with("||")).count() >= MIN_RULES);
    }
}
