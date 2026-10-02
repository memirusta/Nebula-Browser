use std::{
    fs::{self, File},
    io,
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::Manager;

const ALLOWED_VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "m4v", "mov"];
static WALLPAPER_IO_LOCK: Mutex<()> = Mutex::new(());

fn wallpaper_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("wallpapers"))
        .map_err(|error| error.to_string())
}

fn validated_extension(path: &Path) -> Result<String, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "video file has no extension".to_string())?;
    if !ALLOWED_VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        return Err(format!(
            "unsupported wallpaper video extension: {extension}"
        ));
    }
    Ok(extension)
}

fn import_video(source: &Path, directory: &Path) -> Result<PathBuf, String> {
    let _guard = WALLPAPER_IO_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    if !fs::metadata(source)
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err("selected wallpaper path is not a file".to_string());
    }
    let extension = validated_extension(source)?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let mut temporary = tempfile::Builder::new()
        .prefix(".wallpaper-")
        .suffix(".tmp")
        .tempfile_in(directory)
        .map_err(|error| error.to_string())?;
    let name = temporary
        .path()
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "temporary wallpaper path is not valid UTF-8".to_string())?
        .trim_start_matches('.')
        .to_string();
    let destination = directory.join(format!("{name}.{extension}"));
    let mut input = File::open(source).map_err(|error| error.to_string())?;
    io::copy(&mut input, temporary.as_file_mut()).map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist_noclobber(&destination)
        .map_err(|error| error.to_string())?;
    // The old selected video stays valid until the frontend commits the new path.
    Ok(destination)
}

fn clear_videos(directory: &Path, paths: &[PathBuf]) -> Result<(), String> {
    let _guard = WALLPAPER_IO_LOCK
        .lock()
        .map_err(|error| error.to_string())?;
    if !directory.exists() {
        return Ok(());
    }
    let canonical_directory = directory
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let mut validated = Vec::new();
    for path in paths {
        let metadata = match fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.to_string()),
        };
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err("wallpaper cleanup target is not a regular file".to_string());
        }
        let canonical = path.canonicalize().map_err(|error| error.to_string())?;
        let owned_name = canonical
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|name| name.starts_with("wallpaper-"));
        if canonical.parent() != Some(canonical_directory.as_path()) || !owned_name {
            return Err(
                "wallpaper cleanup target is outside the managed wallpaper files".to_string(),
            );
        }
        validated_extension(&canonical)?;
        validated.push(canonical);
    }
    for path in validated {
        match fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn wallpaper_import_video(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<String, String> {
    let directory = wallpaper_directory(&app)?;
    let destination = tauri::async_runtime::spawn_blocking(move || {
        import_video(Path::new(&source_path), &directory)
    })
    .await
    .map_err(|error| error.to_string())??;
    destination
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| "wallpaper path is not valid UTF-8".to_string())
}

#[tauri::command]
pub async fn wallpaper_clear_videos(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<(), String> {
    let directory = wallpaper_directory(&app)?;
    let paths = paths.into_iter().map(PathBuf::from).collect::<Vec<_>>();
    tauri::async_runtime::spawn_blocking(move || clear_videos(&directory, &paths))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{clear_videos, import_video};
    use std::{
        fs,
        sync::{Arc, Barrier},
        thread,
    };

    #[test]
    fn concurrent_imports_keep_distinct_complete_files_and_the_old_selection() {
        let directory = tempfile::tempdir().unwrap();
        let wallpapers = directory.path().join("wallpapers");
        let source = directory.path().join("input.mp4");
        fs::write(&source, vec![7_u8; 1024 * 1024]).unwrap();
        let old = import_video(&source, &wallpapers).unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let jobs = (0..2)
            .map(|_| {
                let source = source.clone();
                let wallpapers = wallpapers.clone();
                let barrier = barrier.clone();
                thread::spawn(move || {
                    barrier.wait();
                    import_video(&source, &wallpapers).unwrap()
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        let first = jobs
            .into_iter()
            .map(|job| job.join().unwrap())
            .collect::<Vec<_>>();
        assert_ne!(first[0], first[1]);
        assert!(old.is_file());
        for path in &first {
            assert_eq!(fs::read(path).unwrap(), fs::read(&source).unwrap());
        }
        clear_videos(&wallpapers, &[old]).unwrap();
        assert!(first.iter().all(|path| path.is_file()));
        assert!(fs::read_dir(&wallpapers).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .ends_with(".tmp")));
    }

    #[test]
    fn failed_import_and_scoped_cleanup_preserve_existing_and_unrelated_files() {
        let directory = tempfile::tempdir().unwrap();
        let wallpapers = directory.path().join("wallpapers");
        fs::create_dir(&wallpapers).unwrap();
        let old = wallpapers.join("wallpaper-old.mp4");
        let unrelated = wallpapers.join("notes.mp4");
        let outside = directory.path().join("wallpaper-outside.mp4");
        fs::write(&old, "old selection").unwrap();
        fs::write(&unrelated, "unrelated").unwrap();
        fs::write(&outside, "outside").unwrap();
        assert!(import_video(&directory.path().join("missing.mp4"), &wallpapers).is_err());
        assert!(clear_videos(&wallpapers, std::slice::from_ref(&outside)).is_err());
        assert!(clear_videos(&wallpapers, std::slice::from_ref(&unrelated)).is_err());
        assert!(clear_videos(&wallpapers, &[old.clone(), unrelated.clone()]).is_err());
        assert!(old.is_file() && unrelated.is_file() && outside.is_file());
        clear_videos(&wallpapers, std::slice::from_ref(&old)).unwrap();
        assert!(!old.exists());
        assert!(unrelated.is_file() && outside.is_file());
    }
}
