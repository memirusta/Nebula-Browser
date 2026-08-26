#[derive(Clone, Copy, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPresentationState {
    pub browser_fullscreen: bool,
    pub site_fullscreen: bool,
    pub maximized: bool,
    pub focused: bool,
}

#[cfg(target_os = "windows")]
mod imp {
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};

    use super::WindowPresentationState;
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
        GetClientRect, GetForegroundWindow, GetWindowPlacement, GetWindowRect, SetWindowPlacement,
        SetWindowPos, ShowWindow, HWND_NOTOPMOST, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOSIZE, SWP_NOZORDER, SWP_SHOWWINDOW, SW_RESTORE, SW_SHOWMAXIMIZED, WINDOWPLACEMENT,
    };

    const CLSID_TASKBARLIST: GUID = GUID::from_values(
        0x56FDF344,
        0xFD6D,
        0x11d0,
        [0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90],
    );

    #[derive(Clone, Copy)]
    struct SavedWindowState {
        placement: WINDOWPLACEMENT,
        outer_rect: RECT,
        restore_on_exit: bool,
    }

    static SITE_SAVED_PLACEMENT: LazyLock<Mutex<HashMap<String, SavedWindowState>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    // F11 browser fullscreen has its own saved placement. It must not share
    // state with HTML5/document fullscreen.
    static BROWSER_SAVED_PLACEMENT: LazyLock<Mutex<HashMap<String, SavedWindowState>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    static BROWSER_SAVED_RESIZABLE: LazyLock<Mutex<HashMap<String, bool>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    fn window_hwnd(app: &AppHandle, window_label: &str) -> Result<HWND, String> {
        let window = app
            .get_window(window_label)
            .ok_or_else(|| format!("window '{window_label}' not found"))?;
        window.hwnd().map_err(|error| error.to_string())
    }

    fn map_contains(
        saved: &Mutex<HashMap<String, SavedWindowState>>,
        window_label: &str,
    ) -> Result<bool, String> {
        saved
            .lock()
            .map_err(|error| error.to_string())
            .map(|slot| slot.contains_key(window_label))
    }

    fn saved_state(
        saved: &Mutex<HashMap<String, SavedWindowState>>,
        window_label: &str,
    ) -> Option<SavedWindowState> {
        saved
            .lock()
            .ok()
            .and_then(|slot| slot.get(window_label).copied())
    }

    fn rect_log_value(rect: RECT) -> serde_json::Value {
        serde_json::json!({
            "left": rect.left,
            "top": rect.top,
            "right": rect.right,
            "bottom": rect.bottom,
            "width": rect.right - rect.left,
            "height": rect.bottom - rect.top,
        })
    }

    fn log_window_geometry(
        app: &AppHandle,
        stage: &str,
        status: &str,
        window_label: &str,
        hwnd: HWND,
        saved: Option<SavedWindowState>,
        error: Option<&str>,
    ) {
        let mut placement = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        let mut outer_rect = RECT::default();

        let placement_result = unsafe { GetWindowPlacement(hwnd, &mut placement) };
        let outer_result = unsafe { GetWindowRect(hwnd, &mut outer_rect) };
        let client_result = client_screen_rect(hwnd);

        let current = if placement_result.is_ok() && outer_result.is_ok() {
            serde_json::json!({
                "showCmd": placement.showCmd,
                "placementFlags": placement.flags.0,
                "normalRect": rect_log_value(placement.rcNormalPosition),
                "outerRect": rect_log_value(outer_rect),
                "clientRect": client_result.ok().map(rect_log_value),
            })
        } else {
            serde_json::json!({
                "placementError": placement_result.err().map(|value| value.to_string()),
                "outerRectError": outer_result.err().map(|value| value.to_string()),
                "clientRectError": client_result.err(),
            })
        };

        let saved = saved.map(|value| {
            serde_json::json!({
                "showCmd": value.placement.showCmd,
                "placementFlags": value.placement.flags.0,
                "normalRect": rect_log_value(value.placement.rcNormalPosition),
                "outerRect": rect_log_value(value.outer_rect),
                "restoreOnExit": value.restore_on_exit,
            })
        });

        let _ = crate::write_transition_log(
            app.clone(),
            serde_json::json!({
                "stage": stage,
                "status": status,
                "windowLabel": window_label,
                "current": current,
                "saved": saved,
                "error": error,
            }),
        );
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

    fn monitor_rect(hwnd: HWND) -> Result<RECT, String> {
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut monitor_info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            GetMonitorInfoW(monitor, &mut monitor_info)
                .ok()
                .map_err(|e| e.to_string())?;
            Ok(monitor_info.rcMonitor)
        }
    }

    fn client_screen_rect(hwnd: HWND) -> Result<RECT, String> {
        unsafe {
            let mut client_rect = RECT::default();
            GetClientRect(hwnd, &mut client_rect).map_err(|e| e.to_string())?;

            let mut origin = POINT { x: 0, y: 0 };
            ClientToScreen(hwnd, &mut origin)
                .ok()
                .map_err(|e| e.to_string())?;

            let width = client_rect.right - client_rect.left;
            let height = client_rect.bottom - client_rect.top;
            Ok(RECT {
                left: origin.x,
                top: origin.y,
                right: origin.x + width,
                bottom: origin.y + height,
            })
        }
    }

    fn rects_match(left: &RECT, right: &RECT) -> bool {
        left.left == right.left
            && left.top == right.top
            && left.right == right.right
            && left.bottom == right.bottom
    }

    fn capture_window_state(hwnd: HWND, restore_on_exit: bool) -> Result<SavedWindowState, String> {
        let mut placement = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        let mut outer_rect = RECT::default();

        unsafe {
            GetWindowPlacement(hwnd, &mut placement).map_err(|e| e.to_string())?;
            GetWindowRect(hwnd, &mut outer_rect).map_err(|e| e.to_string())?;
        }

        Ok(SavedWindowState {
            placement,
            outer_rect,
            restore_on_exit,
        })
    }

    /// Make the parent client area exactly cover rcMonitor without changing
    /// activation or z-order. The operation is deliberately idempotent because
    /// focus/resize repair may call it repeatedly after Alt+Tab.
    fn cover_monitor(
        hwnd: HWND,
        saved: &Mutex<HashMap<String, SavedWindowState>>,
        window_label: &str,
        capture_restore_state: bool,
    ) -> Result<(), String> {
        unsafe {
            let current_state = capture_window_state(hwnd, capture_restore_state)?;
            let current_placement = current_state.placement;

            let currently_maximized = current_placement.showCmd == SW_SHOWMAXIMIZED.0 as u32;

            // The saved placement answers "where do we restore on exit?" and is
            // captured exactly once. current_placement answers "what state is
            // Windows using right now?" and must be inspected on every reassert.
            {
                let mut slot = saved.lock().map_err(|e| e.to_string())?;
                slot.entry(window_label.to_string())
                    .or_insert(current_state);
            }

            let rect = monitor_rect(hwnd)?;

            // Maximized Win32 windows are constrained to rcWork. Windows can put
            // Nebula back into this state after an Alt+Tab cycle, so this check is
            // intentionally repeated on every cover_monitor call.
            if currently_maximized {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            } else {
                let current_client = client_screen_rect(hwnd)?;

                // Reasserting an already-correct fullscreen must not generate
                // another resize event; otherwise the fullscreen repair can loop.
                if rects_match(&current_client, &rect) {
                    return mark_taskbar_fullscreen(hwnd, true);
                }
            }

            let width = rect.right - rect.left;
            let height = rect.bottom - rect.top;
            let flags = SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOZORDER;

            SetWindowPos(hwnd, None, rect.left, rect.top, width, height, flags)
                .map_err(|e| e.to_string())?;

            // SetWindowPos aligns the OUTER window to rcMonitor, while Nebula's
            // WebViews fill the CLIENT area. Frameless/resizable Windows windows
            // can keep an invisible non-client inset, so expand the outer window
            // by the measured inset until the client area itself equals rcMonitor.
            let client = client_screen_rect(hwnd)?;
            let left_inset = client.left - rect.left;
            let top_inset = client.top - rect.top;
            let right_inset = rect.right - client.right;
            let bottom_inset = rect.bottom - client.bottom;

            if left_inset != 0 || top_inset != 0 || right_inset != 0 || bottom_inset != 0 {
                SetWindowPos(
                    hwnd,
                    None,
                    rect.left - left_inset,
                    rect.top - top_inset,
                    width + left_inset + right_inset,
                    height + top_inset + bottom_inset,
                    flags,
                )
                .map_err(|e| e.to_string())?;
            }

            mark_taskbar_fullscreen(hwnd, true)?;
        }

        Ok(())
    }

    fn uncover_monitor(
        hwnd: HWND,
        saved: &Mutex<HashMap<String, SavedWindowState>>,
        window_label: &str,
        restore_geometry: bool,
    ) -> Result<(), String> {
        unsafe {
            // Restoring placement is mandatory even if Explorer's taskbar API
            // is temporarily unavailable. Surface that error only afterwards.
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

            let saved_state = {
                let mut slot = saved.lock().map_err(|e| e.to_string())?;
                slot.remove(window_label)
            };

            if let Some(mut saved_state) =
                saved_state.filter(|state| restore_geometry && state.restore_on_exit)
            {
                let placement = &mut saved_state.placement;
                placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                SetWindowPlacement(hwnd, placement).map_err(|e| e.to_string())?;

                // SetWindowPlacement restores the show state, but a normal
                // frameless window's rcNormalPosition can be rewritten to the
                // monitor work area while fullscreen SetWindowPos calls are in
                // flight. For a window that was not maximized, finish with the
                // exact pre-fullscreen outer rect captured in screen pixels.
                if placement.showCmd != SW_SHOWMAXIMIZED.0 as u32 {
                    let rect = saved_state.outer_rect;
                    SetWindowPos(
                        hwnd,
                        None,
                        rect.left,
                        rect.top,
                        rect.right - rect.left,
                        rect.bottom - rect.top,
                        SWP_SHOWWINDOW | SWP_FRAMECHANGED | SWP_NOACTIVATE | SWP_NOZORDER,
                    )
                    .map_err(|e| e.to_string())?;
                }
            }

            taskbar_result?;
        }

        Ok(())
    }

    pub fn window_presentation_state(
        app: &AppHandle,
        window_label: &str,
    ) -> Result<WindowPresentationState, String> {
        let hwnd = window_hwnd(app, window_label)?;
        let browser_fullscreen = map_contains(&BROWSER_SAVED_PLACEMENT, window_label)?;
        let site_fullscreen = map_contains(&SITE_SAVED_PLACEMENT, window_label)?;

        let mut placement = WINDOWPLACEMENT {
            length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
            ..Default::default()
        };
        unsafe {
            GetWindowPlacement(hwnd, &mut placement).map_err(|e| e.to_string())?;
        }

        Ok(WindowPresentationState {
            browser_fullscreen,
            site_fullscreen,
            maximized: placement.showCmd == SW_SHOWMAXIMIZED.0 as u32,
            focused: unsafe { GetForegroundWindow() == hwnd },
        })
    }

    /// Cover the entire monitor for HTML5 site fullscreen.
    pub fn enter_site_fullscreen_window(app: &AppHandle, window_label: &str) -> Result<(), String> {
        let hwnd = window_hwnd(app, window_label)?;
        let already_active = map_contains(&SITE_SAVED_PLACEMENT, window_label)?;
        log_window_geometry(
            app,
            "site-fullscreen.native-enter.before",
            "info",
            window_label,
            hwnd,
            saved_state(&SITE_SAVED_PLACEMENT, window_label),
            None,
        );
        // Tauri/Wry observes WebView2 fullscreen first and owns the original
        // window placement. This call only repairs monitor/client geometry; it
        // must not save the already-fullscreen HWND as an exit destination.
        let result = cover_monitor(hwnd, &SITE_SAVED_PLACEMENT, window_label, false);

        log_window_geometry(
            app,
            "site-fullscreen.native-enter.after",
            if result.is_ok() { "ok" } else { "error" },
            window_label,
            hwnd,
            saved_state(&SITE_SAVED_PLACEMENT, window_label),
            result.as_ref().err().map(String::as_str),
        );

        if result.is_err() && !already_active {
            let _ = uncover_monitor(hwnd, &SITE_SAVED_PLACEMENT, window_label, false);
        }

        result
    }

    /// Repair site fullscreen geometry only while this top-level Nebula window
    /// is the foreground application. This lets resize/focus handlers recover
    /// rcWork fallback without raising Nebula over the app selected by Alt+Tab.
    pub fn reassert_site_fullscreen_window(
        app: &AppHandle,
        window_label: &str,
    ) -> Result<bool, String> {
        if !map_contains(&SITE_SAVED_PLACEMENT, window_label)? {
            return Ok(false);
        }

        let hwnd = window_hwnd(app, window_label)?;
        if unsafe { GetForegroundWindow() != hwnd } {
            return Ok(false);
        }

        let monitor = monitor_rect(hwnd)?;
        let client = client_screen_rect(hwnd)?;

        if !rects_match(&client, &monitor) {
            // When WebView2 loses native fullscreen during an Alt+Tab handoff,
            // Tauri restores the real window placement before Nebula applies
            // its persistent fullscreen fallback. Capture that restored state
            // so only the fallback path needs an explicit exit restore.
            let restore_state = capture_window_state(hwnd, true)?;
            SITE_SAVED_PLACEMENT
                .lock()
                .map_err(|error| error.to_string())?
                .insert(window_label.to_string(), restore_state);
        }

        cover_monitor(hwnd, &SITE_SAVED_PLACEMENT, window_label, false)?;
        Ok(true)
    }

    pub fn exit_site_fullscreen_window(app: &AppHandle, window_label: &str) -> Result<(), String> {
        let hwnd = window_hwnd(app, window_label)?;
        let saved_site_state = saved_state(&SITE_SAVED_PLACEMENT, window_label);
        log_window_geometry(
            app,
            "site-fullscreen.native-exit.before",
            "info",
            window_label,
            hwnd,
            saved_site_state,
            None,
        );
        let monitor = monitor_rect(hwnd)?;
        let client = client_screen_rect(hwnd)?;
        let restore_fallback_geometry = rects_match(&client, &monitor)
            && saved_site_state
                .map(|state| state.restore_on_exit)
                .unwrap_or(false);

        // On the ordinary HTML5 exit path Tauri has already restored the
        // parent HWND. Never overwrite that correct windowed/maximized state.
        // Explicit restoration is reserved for Nebula's persistent Alt+Tab
        // fallback, where our own monitor cover is still active here.
        let result = uncover_monitor(
            hwnd,
            &SITE_SAVED_PLACEMENT,
            window_label,
            restore_fallback_geometry,
        );

        log_window_geometry(
            app,
            "site-fullscreen.native-exit.after",
            if result.is_ok() { "ok" } else { "error" },
            window_label,
            hwnd,
            saved_site_state,
            result.as_ref().err().map(String::as_str),
        );

        // A page may enter HTML5 fullscreen while Nebula itself is already in
        // F11 fullscreen. Returning from document fullscreen must return to the
        // browser fullscreen state rather than exposing the taskbar.
        let browser_fullscreen_active = map_contains(&BROWSER_SAVED_PLACEMENT, window_label)?;

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

        let active = map_contains(&BROWSER_SAVED_PLACEMENT, window_label)?;

        if active {
            // Restore placement first, but always restore the original
            // resizable state even if the fullscreen-exit helper reports an
            // Explorer/taskbar error afterwards.
            let uncover_result =
                uncover_monitor(hwnd, &BROWSER_SAVED_PLACEMENT, window_label, true);

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

            if let Err(error) = cover_monitor(hwnd, &BROWSER_SAVED_PLACEMENT, window_label, true) {
                let _ = uncover_monitor(hwnd, &BROWSER_SAVED_PLACEMENT, window_label, true);
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
    enter_site_fullscreen_window, exit_site_fullscreen_window, reassert_site_fullscreen_window,
    toggle_browser_fullscreen_window, window_presentation_state,
};

#[cfg(not(target_os = "windows"))]
pub fn window_presentation_state(
    app: &tauri::AppHandle,
    window_label: &str,
) -> Result<WindowPresentationState, String> {
    use tauri::Manager;

    let window = app
        .get_window(window_label)
        .ok_or_else(|| format!("window '{window_label}' not found"))?;

    Ok(WindowPresentationState {
        browser_fullscreen: false,
        site_fullscreen: false,
        maximized: window.is_maximized().map_err(|error| error.to_string())?,
        focused: window.is_focused().map_err(|error| error.to_string())?,
    })
}

#[cfg(not(target_os = "windows"))]
pub fn enter_site_fullscreen_window(
    _app: &tauri::AppHandle,
    _window_label: &str,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn reassert_site_fullscreen_window(
    _app: &tauri::AppHandle,
    _window_label: &str,
) -> Result<bool, String> {
    Ok(false)
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
