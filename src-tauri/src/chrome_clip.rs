//! Let clicks through the parts of the Semi-Lunar overlay that show nothing.
//!
//! The overlay is one transparent webview as wide as the window. While a small floating
//! bubble (a camera or microphone in use, the zoom level) needs room below the top edge the
//! overlay is made taller, and a transparent webview still takes every click: the top of the
//! page under it could not be clicked at all. The host window of the overlay can be given a
//! region instead: only the parts inside it draw and take input, the rest belongs to the page
//! below. The shell decides which rectangles matter; this applies them.
use serde::Deserialize;

#[derive(Debug, Clone, Copy, Deserialize, PartialEq, Eq)]
pub struct ClipRect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

const MAX_RECTS: usize = 8;
const MAX_COORDINATE: i32 = 100_000;

/// Rectangles that can be handed to Windows: few, positive, inside a sane range.
fn validated(rects: &[ClipRect]) -> Result<Vec<ClipRect>, String> {
    if rects.is_empty() || rects.len() > MAX_RECTS {
        return Err(format!("a clip has 1 to {MAX_RECTS} rectangles"));
    }
    for rect in rects {
        let right = rect.x.checked_add(rect.width);
        let bottom = rect.y.checked_add(rect.height);
        let (Some(right), Some(bottom)) = (right, bottom) else {
            return Err("clip rectangle overflows".to_string());
        };
        if rect.width < 1
            || rect.height < 1
            || rect.x < -MAX_COORDINATE
            || rect.y < -MAX_COORDINATE
            || right > MAX_COORDINATE
            || bottom > MAX_COORDINATE
        {
            return Err("clip rectangle is empty or out of range".to_string());
        }
    }
    Ok(rects.to_vec())
}

#[cfg(target_os = "windows")]
fn apply_blocking(
    app: &tauri::AppHandle,
    window_label: &str,
    rects: Option<Vec<ClipRect>>,
) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HGDIOBJ, RGN_OR,
    };

    let _crumb = crate::ui_watchdog::enter("cmd.webview_set_chrome_clip");
    let chrome_label = if window_label == "main" {
        "nebula-chrome".to_string()
    } else {
        format!("nebula-chrome-{window_label}")
    };
    let webview = app
        .get_webview(&chrome_label)
        .ok_or_else(|| format!("chrome webview '{chrome_label}' not found"))?;
    if webview.window().label() != window_label {
        return Err("chrome webview belongs to another window".to_string());
    }
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    webview
        .with_webview(move |inner| unsafe {
            let result = (|| -> Result<(), String> {
                let mut host = HWND::default();
                inner
                    .controller()
                    .ParentWindow(&mut host)
                    .map_err(|error| error.to_string())?;
                let Some(rects) = rects else {
                    // No region: the whole host draws and takes input again.
                    SetWindowRgn(host, None, true);
                    return Ok(());
                };
                let combined = CreateRectRgn(0, 0, 0, 0);
                for rect in &rects {
                    let part =
                        CreateRectRgn(rect.x, rect.y, rect.x + rect.width, rect.y + rect.height);
                    CombineRgn(Some(combined), Some(combined), Some(part), RGN_OR);
                    let _ = DeleteObject(HGDIOBJ(part.0));
                }
                // The system owns the region from here; it must not be deleted.
                if SetWindowRgn(host, Some(combined), true) == 0 {
                    let _ = DeleteObject(HGDIOBJ(combined.0));
                    return Err("SetWindowRgn failed".to_string());
                }
                Ok(())
            })();
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|_| "the chrome clip was not applied in time".to_string())?
}

/// Restrict the Semi-Lunar overlay to `rects` (physical pixels, overlay coordinates), or lift the
/// restriction with `null`.
#[tauri::command]
pub async fn webview_set_chrome_clip(
    app: tauri::AppHandle,
    window_label: String,
    rects: Option<Vec<ClipRect>>,
) -> Result<bool, String> {
    let rects = match rects {
        Some(rects) => Some(validated(&rects)?),
        None => None,
    };
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            apply_blocking(&app, &window_label, rects).map(|()| true)
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, window_label, rects);
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: i32, height: i32) -> ClipRect {
        ClipRect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn sensible_rectangles_pass() {
        let rects = [rect(0, 0, 32_000, 10), rect(1500, 14, 380, 36)];
        assert_eq!(validated(&rects).unwrap(), rects.to_vec());
    }

    #[test]
    fn empty_many_or_absurd_clips_are_refused() {
        assert!(validated(&[]).is_err());
        assert!(validated(&[rect(0, 0, 1, 1); MAX_RECTS + 1]).is_err());
        assert!(validated(&[rect(0, 0, 0, 10)]).is_err());
        assert!(validated(&[rect(0, 0, 10, -1)]).is_err());
        assert!(validated(&[rect(i32::MAX, 0, 10, 10)]).is_err());
        assert!(validated(&[rect(0, 0, 200_000, 10)]).is_err());
    }
}
