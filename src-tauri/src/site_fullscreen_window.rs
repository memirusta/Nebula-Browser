#[cfg(target_os = "windows")]
mod imp {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};

    use tauri::{AppHandle, Manager};
    use windows::core::GUID;
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::ITaskbarList2;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetClientRect, GetWindowPlacement, SetForegroundWindow, SetWindowPlacement, SetWindowPos,
        ShowWindow, HWND_NOTOPMOST, HWND_TOP, HWND_TOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOWMAXIMIZED, WINDOWPLACEMENT,
    };

    const CLSID_TASKBARLIST: GUID = GUID::from_values(
        0x56FDF344,
        0xFD6D,
        0x11d0,
        [0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90],
    );

    static SITE_SAVED_PLACEMENT: LazyLock<Mutex<HashMap<String, WINDOWPLACEMENT>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    // F11 browser fullscreen has its own saved placement. It must not share
    // state with HTML5/document fullscreen.
    static BROWSER_SAVED_PLACEMENT: LazyLock<Mutex<HashMap<String, WINDOWPLACEMENT>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    static BROWSER_SAVED_RESIZABLE: LazyLock<Mutex<HashMap<String, bool>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    fn window_hwnd(app: &AppHandle, window_label: &str) -> Result<HWND, String> {
        let window = app
            .get_window(window_label)
            .ok_or_else(|| format!("window '{window_label}' not found"))?;
        window.hwnd().map_err(|error| error.to_string())
    }

    fn mark_taskbar_fullscreen(hwnd: HWND, fullscreen: bool) -> Result<(), String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let taskbar: ITaskbarList2 = CoCreateInstance(&CLSID_TASKBARLIST, None, CLSCTX_ALL)
                .map_err(|e| e.to_string())?;
            taskbar.HrInit().map_err(|e| e.to_string())?;
            taskbar
                .MarkFullscreenWindow(hwnd, fullscreen)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    fn cover_monitor(
        hwnd: HWND,
        saved: &Mutex<HashMap<String, WINDOWPLACEMENT>>,
        window_label: &str,
        topmost: bool,
    ) -> Result<(), String> {
        unsafe {
            let mut was_maximized = false;
            if !saved
                .lock()
                .map_err(|e| e.to_string())?
                .contains_key(window_label)
            {
                let mut placement = WINDOWPLACEMENT {
                    length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                    ..Default::default()
                };
                GetWindowPlacement(hwnd, &mut placement).map_err(|e| e.to_string())?;
                was_maximized = placement.showCmd == SW_SHOWMAXIMIZED.0 as u32;
                saved
                    .lock()
                    .map_err(|e| e.to_string())?
                    .insert(window_label.to_string(), placement);
            }

            // A maximized Win32 window is constrained to the monitor work area,
            // so resizing it directly leaves the taskbar visible. Temporarily
            // restore it before covering rcMonitor; the saved placement restores
            // the original maximized state when site fullscreen exits.
            if was_maximized {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }

            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut monitor_info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            GetMonitorInfoW(monitor, &mut monitor_info)
                .ok()
                .map_err(|e| e.to_string())?;

            let rect = monitor_info.rcMonitor;
            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;

            // HTML5 fullscreen is temporarily topmost. F11 fullscreen stays a
            // normal foreground window so Alt+Tab continues to behave normally.
            let z_order = if topmost { HWND_TOPMOST } else { HWND_TOP };

            SetWindowPos(
                hwnd,
                Some(z_order),
                rect.left,
                rect.top,
                width,
                height,
                SWP_SHOWWINDOW | SWP_FRAMECHANGED,
            )
            .map_err(|e| e.to_string())?;

            // Correct the invisible non-client frame.
            //
            // SetWindowPos above aligns the OUTER window to rcMonitor, but
            // Nebula's WebViews fill the Win32 CLIENT area. Frameless/
            // resizable Windows windows can still retain a small invisible
            // non-client inset. Measure that inset instead of hard-coding a
            // pixel value, then expand/offset the outer window so the client
            // area itself becomes exactly rcMonitor.
            let mut client_rect = RECT::default();
            GetClientRect(hwnd, &mut client_rect).map_err(|e| e.to_string())?;

            let mut client_origin = POINT { x: 0, y: 0 };
            ClientToScreen(hwnd, &mut client_origin)
                .ok()
                .map_err(|e| e.to_string())?;

            let client_width = client_rect.right - client_rect.left;
            let client_height = client_rect.bottom - client_rect.top;

            let left_inset = client_origin.x - rect.left;
            let top_inset = client_origin.y - rect.top;

            let right_inset = rect.right - (client_origin.x + client_width);

            let bottom_inset = rect.bottom - (client_origin.y + client_height);

            if left_inset != 0 || top_inset != 0 || right_inset != 0 || bottom_inset != 0 {
                SetWindowPos(
                    hwnd,
                    Some(z_order),
                    rect.left - left_inset,
                    rect.top - top_inset,
                    width + left_inset + right_inset,
                    height + top_inset + bottom_inset,
                    SWP_SHOWWINDOW | SWP_FRAMECHANGED,
                )
                .map_err(|e| e.to_string())?;
            }

            let _ = SetForegroundWindow(hwnd);
            mark_taskbar_fullscreen(hwnd, true)?;
        }

        Ok(())
    }

    fn uncover_monitor(
        hwnd: HWND,
        saved: &Mutex<HashMap<String, WINDOWPLACEMENT>>,
        window_label: &str,
    ) -> Result<(), String> {
        unsafe {
            // Restoring the window is mandatory even when Explorer's taskbar API
            // is temporarily unavailable. Report that error only after the window
            // has been taken out of TOPMOST and its placement has been restored.
            let taskbar_result = mark_taskbar_fullscreen(hwnd, false);

            let _ = SetWindowPos(
                hwnd,
                Some(HWND_NOTOPMOST),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );

            let placement = {
                let mut slot = saved.lock().map_err(|e| e.to_string())?;
                slot.remove(window_label)
            };

            if let Some(mut placement) = placement {
                placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                SetWindowPlacement(hwnd, &placement).map_err(|e| e.to_string())?;
            }

            taskbar_result?;
        }

        Ok(())
    }

    /// Cover the entire monitor for HTML5 site fullscreen.
    pub fn enter_site_fullscreen_window(app: &AppHandle, window_label: &str) -> Result<(), String> {
        let hwnd = window_hwnd(app, window_label)?;
        cover_monitor(hwnd, &SITE_SAVED_PLACEMENT, window_label, true)
    }

    pub fn exit_site_fullscreen_window(app: &AppHandle, window_label: &str) -> Result<(), String> {
        let hwnd = window_hwnd(app, window_label)?;
        let result = uncover_monitor(hwnd, &SITE_SAVED_PLACEMENT, window_label);

        // A page may enter HTML5 fullscreen while Nebula itself is already in
        // F11 fullscreen. Returning from document fullscreen must return to the
        // browser fullscreen state rather than exposing the taskbar.
        let browser_fullscreen_active = BROWSER_SAVED_PLACEMENT
            .lock()
            .map_err(|error| error.to_string())?
            .contains_key(window_label);

        if browser_fullscreen_active {
            cover_monitor(hwnd, &BROWSER_SAVED_PLACEMENT, window_label, false)?;
        }

        result
    }

    /// Toggle Nebula browser-window fullscreen (F11).
    ///
    /// The saved WINDOWPLACEMENT preserves whether the user was maximized or
    /// windowed, including the original window bounds.
    pub fn toggle_browser_fullscreen_window(
        app: &AppHandle,
        window_label: &str,
    ) -> Result<bool, String> {
        let hwnd = window_hwnd(app, window_label)?;
        let window = app
            .get_window(window_label)
            .ok_or_else(|| format!("window '{window_label}' not found"))?;

        let active = BROWSER_SAVED_PLACEMENT
            .lock()
            .map_err(|error| error.to_string())?
            .contains_key(window_label);

        if active {
            // Restore placement first, but always restore the original
            // resizable state even if the fullscreen-exit helper reports an
            // Explorer/taskbar error afterwards.
            let uncover_result = uncover_monitor(hwnd, &BROWSER_SAVED_PLACEMENT, window_label);

            let saved_resizable = BROWSER_SAVED_RESIZABLE
                .lock()
                .map_err(|error| error.to_string())?
                .remove(window_label);

            let resize_result = match saved_resizable {
                Some(resizable) => window
                    .set_resizable(resizable)
                    .map_err(|error| error.to_string()),
                None => Ok(()),
            };

            uncover_result?;
            resize_result?;

            Ok(false)
        } else {
            let was_resizable = window.is_resizable().map_err(|error| error.to_string())?;

            BROWSER_SAVED_RESIZABLE
                .lock()
                .map_err(|error| error.to_string())?
                .insert(window_label.to_string(), was_resizable);

            if let Err(error) = window.set_resizable(false) {
                BROWSER_SAVED_RESIZABLE
                    .lock()
                    .map_err(|lock_error| lock_error.to_string())?
                    .remove(window_label);

                return Err(error.to_string());
            }

            if let Err(error) = cover_monitor(hwnd, &BROWSER_SAVED_PLACEMENT, window_label, false) {
                let _ = window.set_resizable(was_resizable);

                BROWSER_SAVED_RESIZABLE
                    .lock()
                    .map_err(|lock_error| lock_error.to_string())?
                    .remove(window_label);

                return Err(error);
            }

            Ok(true)
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{
    enter_site_fullscreen_window, exit_site_fullscreen_window, toggle_browser_fullscreen_window,
};

#[cfg(not(target_os = "windows"))]
pub fn enter_site_fullscreen_window(
    _app: &tauri::AppHandle,
    _window_label: &str,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn exit_site_fullscreen_window(
    _app: &tauri::AppHandle,
    _window_label: &str,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn toggle_browser_fullscreen_window(
    _app: &tauri::AppHandle,
    _window_label: &str,
) -> Result<bool, String> {
    Ok(false)
}
