use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

// Chromium writes DNR indexes inside the unpacked extension's _metadata folder.
// Never load an unpacked extension directly from a read-only MSIX installation.
fn files(root: &Path, relative: &Path, output: &mut Vec<(PathBuf, Vec<u8>)>) -> io::Result<()> {
    for entry in fs::read_dir(root.join(relative))? {
        let entry = entry?;
        if relative.as_os_str().is_empty() && entry.file_name() == "_metadata" {
            continue;
        }
        let path = relative.join(entry.file_name());
        let kind = entry.file_type()?;
        if kind.is_dir() {
            files(root, &path, output)?;
        } else if kind.is_file() {
            output.push((path, fs::read(entry.path())?));
        } else {
            return Err(io::Error::other(
                "extension contains a link or special file",
            ));
        }
    }
    Ok(())
}

fn read_bundle(root: &Path) -> io::Result<Vec<(PathBuf, Vec<u8>)>> {
    if !fs::symlink_metadata(root)?.file_type().is_dir() {
        return Err(io::Error::other(
            "extension root is not a regular directory",
        ));
    }
    let mut result = Vec::new();
    files(root, Path::new(""), &mut result)?;
    result.sort_by(|a, b| a.0.cmp(&b.0));
    if !result
        .iter()
        .any(|(path, _)| path == Path::new("manifest.json"))
        || !result
            .iter()
            .any(|(path, _)| path == Path::new("LICENSE.txt"))
    {
        return Err(io::Error::other("extension manifest or license is missing"));
    }
    Ok(result)
}

fn matches_bundle(root: &Path, expected: &[(PathBuf, Vec<u8>)]) -> bool {
    read_bundle(root).is_ok_and(|actual| actual == expected)
}

pub(super) fn prepare(source: &Path, cache: &Path, version: &str) -> io::Result<PathBuf> {
    let bundle = read_bundle(source)?;
    let mut digest = Sha256::new();
    for (path, bytes) in &bundle {
        let name = path.to_string_lossy().replace('\\', "/");
        digest.update((name.len() as u64).to_le_bytes());
        digest.update(name.as_bytes());
        digest.update((bytes.len() as u64).to_le_bytes());
        digest.update(bytes);
    }
    let revision = cache.join(format!("{version}-{:x}", digest.finalize()));
    fs::create_dir_all(&revision)?;

    // Publish complete directories by rename. Concurrent processes converge on
    // the same path (and therefore extension ID). Never edit an in-use copy:
    // damaged copies are retained and replaced with the next immutable slot.
    for slot in 0..100 {
        let destination = revision.join(slot.to_string());
        let extension = destination.join("ubol");
        if matches_bundle(&extension, &bundle) {
            return Ok(extension);
        }
        if destination.try_exists()? {
            continue;
        }
        let staging = tempfile::Builder::new()
            .prefix(".staging-")
            .tempdir_in(&revision)?;
        let staged_extension = staging.path().join("ubol");
        for (relative, bytes) in &bundle {
            let target = staged_extension.join(relative);
            fs::create_dir_all(target.parent().expect("extension file has a parent"))?;
            // fs::copy preserves source permissions. New files must be writable
            // even when the bundled source has the Windows read-only attribute.
            fs::write(target, bytes)?;
        }
        if !matches_bundle(&staged_extension, &bundle) {
            return Err(io::Error::other("extension copy verification failed"));
        }
        match fs::rename(staging.path(), &destination) {
            Ok(()) => return Ok(extension),
            Err(_) if matches_bundle(&extension, &bundle) => return Ok(extension),
            Err(_) if destination.try_exists()? => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::other("too many damaged extension cache copies"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source(root: &Path) -> PathBuf {
        let source = root.join("bundle");
        fs::create_dir_all(source.join("js")).unwrap();
        fs::write(source.join("manifest.json"), b"{}").unwrap();
        fs::write(source.join("LICENSE.txt"), b"license").unwrap();
        fs::write(source.join("js/worker.js"), b"original").unwrap();
        source
    }

    #[test]
    fn reuses_verified_copy_and_preserves_generated_rules() {
        let temp = tempfile::tempdir().unwrap();
        let source = source(temp.path());
        fs::create_dir(source.join("_metadata")).unwrap();
        fs::write(source.join("_metadata/stale"), b"do not ship").unwrap();
        let cache = temp.path().join("cache");
        let first = prepare(&source, &cache, "1").unwrap();
        assert!(!first.join("_metadata").exists());
        fs::create_dir(first.join("_metadata")).unwrap();
        fs::write(first.join("_metadata/generated-index"), b"keep").unwrap();
        assert_eq!(prepare(&source, &cache, "1").unwrap(), first);
        assert_eq!(
            fs::read(first.join("_metadata/generated-index")).unwrap(),
            b"keep"
        );
    }

    #[test]
    fn corrupt_or_incomplete_copies_are_replaced_without_mutating_them() {
        let temp = tempfile::tempdir().unwrap();
        let source = source(temp.path());
        let cache = temp.path().join("cache");
        let first = prepare(&source, &cache, "1").unwrap();
        fs::write(first.join("js/worker.js"), b"corrupt").unwrap();
        let repaired = prepare(&source, &cache, "1").unwrap();
        assert_ne!(first, repaired);
        assert_eq!(fs::read(first.join("js/worker.js")).unwrap(), b"corrupt");
        assert_eq!(
            fs::read(repaired.join("js/worker.js")).unwrap(),
            b"original"
        );
        fs::remove_file(repaired.join("manifest.json")).unwrap();
        assert_ne!(prepare(&source, &cache, "1").unwrap(), repaired);
    }

    #[test]
    fn bundled_changes_get_new_path_even_without_upstream_version_change() {
        let temp = tempfile::tempdir().unwrap();
        let source = source(temp.path());
        let cache = temp.path().join("cache");
        let first = prepare(&source, &cache, "1").unwrap();
        fs::write(source.join("js/worker.js"), b"updated").unwrap();
        let next = prepare(&source, &cache, "1").unwrap();
        assert_ne!(first, next);
        assert_eq!(fs::read(first.join("js/worker.js")).unwrap(), b"original");
    }

    #[test]
    fn concurrent_preparation_publishes_one_stable_path() {
        let temp = tempfile::tempdir().unwrap();
        let source = source(temp.path());
        let cache = temp.path().join("cache");
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(4));
        let threads: Vec<_> = (0..4)
            .map(|_| {
                let (source, cache, barrier) = (source.clone(), cache.clone(), barrier.clone());
                std::thread::spawn(move || {
                    barrier.wait();
                    prepare(&source, &cache, "1").unwrap()
                })
            })
            .collect();
        let paths: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert!(paths.iter().all(|path| path == &paths[0]));
    }

    #[test]
    fn incomplete_source_is_not_published() {
        let temp = tempfile::tempdir().unwrap();
        let source = source(temp.path());
        fs::remove_file(source.join("manifest.json")).unwrap();
        let cache = temp.path().join("cache");
        assert!(prepare(&source, &cache, "1").is_err());
        assert!(!cache.exists());
    }

    #[cfg(windows)]
    #[test]
    fn read_only_bundle_produces_writable_copy() {
        let temp = tempfile::tempdir().unwrap();
        let source = source(temp.path());
        let manifest = source.join("manifest.json");
        let original_permissions = fs::metadata(&manifest).unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(&manifest, permissions).unwrap();
        let result = prepare(&source, &temp.path().join("cache"), "1");
        fs::set_permissions(&manifest, original_permissions).unwrap();
        let cached = result.unwrap();
        assert!(!fs::metadata(cached.join("manifest.json"))
            .unwrap()
            .permissions()
            .readonly());
        fs::create_dir(cached.join("_metadata")).unwrap();
        fs::write(cached.join("_metadata/index"), b"rules").unwrap();
    }
}
