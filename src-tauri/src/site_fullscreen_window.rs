#[cfg(target_os = "windows")]
mod imp {
    use std::sync::{LazyLock, Mutex};

    use tauri::{AppHandle, Manager};
    use windows::core::GUID;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::ITaskbarList2;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowPlacement, SetForegroundWindow, SetWindowPlacement, SetWindowPos, WINDOWPLACEMENT,
        HWND_TOP, SWP_FRAMECHANGED, SWP_SHOWWINDOW,
    };

    const CLSID_TASKBARLIST: GUID = GUID::from_values(
        0x56FDF344,
        0xFD6D,
        0x11d0,
        [0x95, 0x8A, 0x00, 0x60, 0x97, 0xC9, 0xA0, 0x90],
    );

    static SAVED_PLACEMENT: LazyLock<Mutex<Option<WINDOWPLACEMENT>>> =
        LazyLock::new(|| Mutex::new(None));

    fn main_window_hwnd(app: &AppHandle) -> Result<HWND, String> {
        let window = app
            .get_window("main")
            .ok_or_else(|| "main window not found".to_string())?;
        window.hwnd().map_err(|error| error.to_string())
    }

    fn mark_taskbar_fullscreen(hwnd: HWND, fullscreen: bool) -> Result<(), String> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let taskbar: ITaskbarList2 =
                CoCreateInstance(&CLSID_TASKBARLIST, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
            taskbar.HrInit().map_err(|e| e.to_string())?;
            taskbar
                .MarkFullscreenWindow(hwnd, fullscreen)
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Cover the entire monitor (including taskbar area) and push the taskbar behind.
    pub fn enter_site_fullscreen_window(app: &AppHandle) -> Result<(), String> {
        let hwnd = main_window_hwnd(app)?;

        unsafe {
            let mut placement = WINDOWPLACEMENT {
                length: std::mem::size_of::<WINDOWPLACEMENT>() as u32,
                ..Default::default()
            };
            GetWindowPlacement(hwnd, &mut placement).map_err(|e| e.to_string())?;

            {
                let mut saved = SAVED_PLACEMENT.lock().map_err(|e| e.to_string())?;
                *saved = Some(placement);
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

            SetWindowPos(
                hwnd,
                Some(HWND_TOP),
                rect.left,
                rect.top,
                width,
                height,
                SWP_SHOWWINDOW | SWP_FRAMECHANGED,
            )
            .map_err(|e| e.to_string())?;

            let _ = SetForegroundWindow(hwnd);
            mark_taskbar_fullscreen(hwnd, true)?;
        }

        Ok(())
    }

    pub fn exit_site_fullscreen_window(app: &AppHandle) -> Result<(), String> {
        let hwnd = main_window_hwnd(app)?;

        unsafe {
            mark_taskbar_fullscreen(hwnd, false)?;

            let placement = {
                let mut saved = SAVED_PLACEMENT.lock().map_err(|e| e.to_string())?;
                saved.take()
            };

            if let Some(mut placement) = placement {
                placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                SetWindowPlacement(hwnd, &placement).map_err(|e| e.to_string())?;
            }
        }

        Ok(())
    }
}

#[cfg(target_os = "windows")]
pub use imp::{enter_site_fullscreen_window, exit_site_fullscreen_window};

#[cfg(not(target_os = "windows"))]
pub fn enter_site_fullscreen_window(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn exit_site_fullscreen_window(_app: &tauri::AppHandle) -> Result<(), String> {
    Ok(())
}
