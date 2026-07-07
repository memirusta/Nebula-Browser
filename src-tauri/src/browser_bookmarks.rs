use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInfo {
  pub browser: String,
  pub display_name: String,
  pub bookmarks_available: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedBookmark {
  pub title: String,
  pub url: String,
}

#[derive(Debug, Deserialize)]
struct BookmarksFile {
  roots: BookmarksRoots,
}

#[derive(Debug, Deserialize)]
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
  children: Option<Vec<BookmarkNode>>,
}

struct BookmarksSource {
  browser: String,
  display_name: String,
  path: PathBuf,
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

fn profile_bookmark_candidates(profile_dir: &Path) -> Vec<PathBuf> {
  ["Bookmarks", "AccountBookmarks"]
    .into_iter()
    .map(|name| profile_dir.join(name))
    .filter(|path| path.is_file())
    .collect()
}

fn bookmarks_files_in_user_data(user_data: &Path) -> Vec<PathBuf> {
  let mut paths = Vec::new();

  paths.extend(profile_bookmark_candidates(&user_data.join("Default")));

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
      if name == "Default" || !name.starts_with("Profile ") {
        continue;
      }

      paths.extend(profile_bookmark_candidates(&entry.path()));
    }
  }

  paths
}

fn count_url_bookmarks(path: &Path) -> usize {
  parse_bookmarks_file(path, 120).map(|items| items.len()).unwrap_or(0)
}

fn source_from_installation(id: &str, name: &str, user_data: &Path) -> Option<BookmarksSource> {
  if !user_data.is_dir() {
    return None;
  }

  let mut best_path: Option<PathBuf> = None;
  let mut best_count = 0usize;

  for path in bookmarks_files_in_user_data(user_data) {
    let count = count_url_bookmarks(&path);
    if count > best_count {
      best_count = count;
      best_path = Some(path);
    } else if best_path.is_none() && path.is_file() {
      best_path = Some(path);
    }
  }

  let path = best_path?;
  Some(BookmarksSource {
    browser: id.to_string(),
    display_name: name.to_string(),
    path,
  })
}

fn resolve_bookmarks_target() -> Option<BookmarksSource> {
  let installations = chromium_installations();
  let preferred_id = read_http_prog_id().and_then(|prog_id| browser_id_from_prog_id(&prog_id));

  if let Some(preferred_id) = preferred_id {
    if preferred_id == "firefox" {
      return None;
    }

    if let Some((id, name, user_data)) = installations
      .iter()
      .find(|(id, _, _)| *id == preferred_id)
    {
      if let Some(source) = source_from_installation(id, name, user_data) {
        if source.path.is_file() {
          return Some(source);
        }
      }
    }
  }

  let mut best: Option<BookmarksSource> = None;
  let mut best_count = 0usize;

  for (id, name, user_data) in installations {
    let Some(source) = source_from_installation(id, name, &user_data) else {
      continue;
    };
    let count = count_url_bookmarks(&source.path);
    if count > best_count {
      best_count = count;
      best = Some(source);
    } else if best.is_none() {
      best = Some(source);
    }
  }

  best
}

fn collect_bookmarks(node: &BookmarkNode, out: &mut Vec<ImportedBookmark>, limit: usize) {
  if out.len() >= limit {
    return;
  }

  if node.node_type.as_deref() == Some("url") {
    if let (Some(title), Some(url)) = (&node.name, &node.url) {
      let trimmed = url.trim();
      if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        out.push(ImportedBookmark {
          title: title.trim().to_string(),
          url: trimmed.to_string(),
        });
      }
    }
  }

  if let Some(children) = &node.children {
    for child in children {
      collect_bookmarks(child, out, limit);
      if out.len() >= limit {
        break;
      }
    }
  }
}

fn parse_bookmarks_file(path: &Path, limit: usize) -> Result<Vec<ImportedBookmark>, String> {
  let raw = std::fs::read_to_string(path).map_err(|error| error.to_string())?;
  let file: BookmarksFile = serde_json::from_str(&raw).map_err(|error| error.to_string())?;

  let mut bookmarks = Vec::new();
  if let Some(bar) = &file.roots.bookmark_bar {
    collect_bookmarks(bar, &mut bookmarks, limit);
  }
  if bookmarks.len() < limit {
    if let Some(other) = &file.roots.other {
      collect_bookmarks(other, &mut bookmarks, limit);
    }
  }
  if bookmarks.len() < limit {
    if let Some(synced) = &file.roots.synced {
      collect_bookmarks(synced, &mut bookmarks, limit);
    }
  }

  Ok(bookmarks)
}

#[tauri::command]
pub fn detect_default_browser() -> BrowserInfo {
  let Some(source) = resolve_bookmarks_target() else {
    return BrowserInfo {
      browser: "unknown".into(),
      display_name: "Tarayıcı".into(),
      bookmarks_available: false,
    };
  };

  let bookmark_count = count_url_bookmarks(&source.path);

  BrowserInfo {
    browser: source.browser,
    display_name: source.display_name,
    bookmarks_available: source.path.is_file() && bookmark_count > 0,
  }
}

#[tauri::command]
pub fn import_default_browser_bookmarks(limit: Option<u32>) -> Result<Vec<ImportedBookmark>, String> {
  let max = limit.unwrap_or(40).clamp(1, 120) as usize;
  let Some(source) = resolve_bookmarks_target() else {
    return Err("Yer işaretleri dosyası bulunamadı.".into());
  };

  if !source.path.is_file() {
    return Err("Yer işaretleri dosyası bulunamadı.".into());
  }

  let bookmarks = parse_bookmarks_file(&source.path, max)?;
  if bookmarks.is_empty() {
    return Err("İçe aktarılacak yer işareti bulunamadı.".into());
  }

  Ok(bookmarks)
}
