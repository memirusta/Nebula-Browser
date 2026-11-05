//! Opening a document from disk (a .html file, a PDF, a picture) in a tab. Only a person can ask for it: from the
//! address bar, or by opening the file with Nebula from Windows. Pages cannot send a tab to a local file (the shell
//! refuses that, see `src/core/localDocument.ts`), so the shell's navigation command may accept these addresses.

use std::path::Path;

/// The kinds of file a tab shows. The same list as `OPENABLE_LOCAL_EXTENSIONS` in `src/core/localDocument.ts`
/// (a test keeps them equal). Programs, scripts and folders are not on it on purpose.
pub const OPENABLE_EXTENSIONS: &[&str] = &[
    "html", "htm", "xhtml", "xht", "shtml", "svg", "pdf", "txt", "json", "xml", "png", "jpg",
    "jpeg", "gif", "webp", "avif", "bmp", "ico", "mp4", "webm", "mp3", "wav", "ogg", "m4a",
];

fn has_openable_extension(path: &Path) -> bool {
    path.file_stem().is_some_and(|stem| !stem.is_empty())
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .is_some_and(|extension| {
                OPENABLE_EXTENSIONS
                    .iter()
                    .any(|allowed| allowed.eq_ignore_ascii_case(extension))
            })
}

/// A file address of a document a tab may show.
pub fn is_openable_local_url(url: &url::Url) -> bool {
    url.scheme() == "file"
        && url
            .to_file_path()
            .is_ok_and(|path| has_openable_extension(&path))
}

/// The file address for a path Windows handed to Nebula ("Open with Nebula"): only an existing file of a known
/// kind, given by its full path.
pub fn file_url_for_document(path: &str) -> Option<String> {
    let path = Path::new(path.trim().trim_matches('"'));
    if !path.is_absolute() || !path.is_file() || !has_openable_extension(path) {
        return None;
    }
    url::Url::from_file_path(path).ok().map(String::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_file_addresses_of_known_kinds_of_documents_are_accepted() {
        let ok = |text: &str| is_openable_local_url(&url::Url::parse(text).unwrap());
        assert!(ok("file:///C:/Users/me/page.html"));
        assert!(ok("file:///C:/Users/me/My%20Page.HTM"));
        assert!(ok("file:///C:/docs/paper.pdf"));
        assert!(ok("file://server/share/page.html"));
        // Programs, scripts, folders, shortcuts and files without an extension are not documents.
        for refused in [
            "file:///C:/Windows/notepad.exe",
            "file:///C:/tools/run.bat",
            "file:///C:/tools/run.ps1",
            "file:///C:/Users/me/",
            "file:///C:/Users/me/page",
            "file:///C:/Users/me/.html",
            "file:///C:/Users/me/link.lnk",
            "https://example.com/page.html",
        ] {
            assert!(!ok(refused), "{refused}");
        }
    }

    #[test]
    fn a_path_from_windows_becomes_a_file_address_only_for_an_existing_document() {
        let dir = tempfile::tempdir().unwrap();
        let page = dir.path().join("my page.html");
        std::fs::write(&page, "<p>hi</p>").unwrap();
        let program = dir.path().join("tool.exe");
        std::fs::write(&program, "x").unwrap();

        let url = file_url_for_document(page.to_str().unwrap()).expect("an existing html file");
        assert!(
            url.starts_with("file:///") && url.ends_with("my%20page.html"),
            "{url}"
        );
        // Explorer's "Copy as path" adds quotes.
        assert!(file_url_for_document(&format!("\"{}\"", page.display())).is_some());
        assert!(file_url_for_document(program.to_str().unwrap()).is_none());
        assert!(file_url_for_document(dir.path().join("missing.html").to_str().unwrap()).is_none());
        assert!(
            file_url_for_document("page.html").is_none(),
            "a relative path is not trusted"
        );
        assert!(file_url_for_document("https://example.com/").is_none());
    }
}
