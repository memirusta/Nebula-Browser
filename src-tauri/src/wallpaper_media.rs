use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use tauri::Manager;

const ALLOWED_VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "m4v", "mov"];

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

fn cleanup_old_videos(directory: &Path, keep: Option<&Path>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if keep.is_some_and(|keep| keep == path) {
            continue;
        }

        if !path.is_file() {
            continue;
        }

        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
pub async fn wallpaper_import_video(
    app: tauri::AppHandle,
    source_path: String,
) -> Result<String, String> {
    let source = PathBuf::from(source_path);

    let metadata = fs::metadata(&source).map_err(|error| error.to_string())?;

    if !metadata.is_file() {
        return Err("selected wallpaper path is not a file".to_string());
    }

    let extension = validated_extension(&source)?;

    let directory = wallpaper_directory(&app)?;

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();

    let destination = directory.join(format!("wallpaper-{timestamp}.{extension}"));

    let temporary = directory.join(format!(".wallpaper-{timestamp}.{extension}.tmp"));

    let destination_for_task = destination.clone();

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        fs::create_dir_all(&directory).map_err(|error| error.to_string())?;

        fs::copy(&source, &temporary).map_err(|error| error.to_string())?;

        if let Err(error) = fs::rename(&temporary, &destination_for_task) {
            let _ = fs::remove_file(&temporary);

            return Err(error.to_string());
        }

        cleanup_old_videos(&directory, Some(&destination_for_task));

        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;

    destination
        .to_str()
        .map(str::to_string)
        .ok_or_else(|| "wallpaper path is not valid UTF-8".to_string())
}

#[tauri::command]
pub async fn wallpaper_clear_videos(app: tauri::AppHandle) -> Result<(), String> {
    let directory = wallpaper_directory(&app)?;

    tauri::async_runtime::spawn_blocking(move || {
        cleanup_old_videos(&directory, None);
    })
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}
