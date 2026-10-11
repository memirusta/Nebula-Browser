//! Keep Home at the current native client size without changing Tauri's 1:1
//! auto-resize rates. A cached full-size set_bounds while minimized would store
//! 1920/181 and 1140/24 as rates, then multiply them again on restore.
use tauri::Manager;
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::ClientToScreen;
use windows::Win32::UI::WindowsAndMessaging::{
    GetClientRect, GetWindowRect, IsIconic, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
};

pub fn repair(window: &tauri::Window) -> Result<(), String> {
    let _crumb = crate::ui_watchdog::enter("main_webview_layout.repair");
    let Some(main) = window.app_handle().get_webview(window.label()) else {
        return Ok(());
    };
    let window = window.clone();
    main.with_webview(move |inner| {
        let _callback_crumb = crate::ui_watchdog::enter("main_webview_layout.repair.callback");
        let apply = || -> Result<(), String> {
            let hwnd = window.hwnd().map_err(|error| error.to_string())?;
            unsafe {
                // Read and apply in the same UI-thread callback. A JS check
                // before IPC cannot exclude another minimize in between.
                if IsIconic(hwnd).as_bool() {
                    return Ok(());
                }
                let mut client = RECT::default();
                GetClientRect(hwnd, &mut client).map_err(|error| error.to_string())?;
                let width = client.right - client.left;
                let height = client.bottom - client.top;
                if width < 256 || height < 160 {
                    return Ok(());
                }

                let controller = inner.controller();
                let mut host = HWND::default();
                controller
                    .ParentWindow(&mut host)
                    .map_err(|error| error.to_string())?;
                let mut origin = POINT::default();
                ClientToScreen(hwnd, &mut origin)
                    .ok()
                    .map_err(|error| error.to_string())?;
                let mut host_rect = RECT::default();
                GetWindowRect(host, &mut host_rect).map_err(|error| error.to_string())?;
                if host_rect.left != origin.x
                    || host_rect.top != origin.y
                    || host_rect.right - host_rect.left != width
                    || host_rect.bottom - host_rect.top != height
                {
                    // Preserve visibility, focus and stack; avoid a redundant
                    // WM_SIZE/repaint when only focus changed.
                    SetWindowPos(
                        host,
                        None,
                        0,
                        0,
                        width,
                        height,
                        SWP_NOACTIVATE | SWP_NOZORDER,
                    )
                    .map_err(|error| error.to_string())?;
                }
                let mut bounds = RECT::default();
                controller
                    .Bounds(&mut bounds)
                    .map_err(|error| error.to_string())?;
                if bounds != client {
                    controller
                        .SetBounds(client)
                        .map_err(|error| error.to_string())?;
                }
                Ok(())
            }
        };
        if let Err(error) = apply() {
            eprintln!("[nebula main layout] {error}");
        }
    })
    .map_err(|error| error.to_string())
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if matches!(
        event,
        tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(true)
    ) {
        if let Err(error) = repair(window) {
            eprintln!("[nebula main layout] {error}");
        }
    }
}
