mod browser_bookmarks;
mod browser_passwords;
mod google_oauth;
mod password_webview;
mod system_stats;
mod tab_error_page;
mod site_fullscreen_window;
mod tab_fullscreen;
mod webview_controls;

#[tauri::command]
async fn webview_execute_script(
    app: tauri::AppHandle,
    label: String,
    script: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || password_webview::execute_script(&app, &label, &script))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn webview_setup_tab_error_pages(app: tauri::AppHandle, label: String) -> Result<(), String> {
    tab_error_page::setup_tab_error_page(&app, &label)?;
    tab_fullscreen::setup_tab_fullscreen(&app, &label)
}

#[tauri::command]
fn webview_navigate(app: tauri::AppHandle, label: String, url: String) -> Result<(), String> {
    use tauri::Manager;

    let parsed = url.parse::<url::Url>().map_err(|error| error.to_string())?;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;

    webview.navigate(parsed).map_err(|error| error.to_string())
}

#[tauri::command]
async fn webview_close_tab(app: tauri::AppHandle, label: String) -> Result<(), String> {
    use tauri::Manager;

    tab_fullscreen::teardown_tab_fullscreen(&app, &label);

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;

    if let Ok(parsed) = "about:blank".parse::<url::Url>() {
        let _ = webview.navigate(parsed);
    }

    tauri::async_runtime::spawn_blocking(|| {
        std::thread::sleep(std::time::Duration::from_millis(150));
    })
    .await
    .map_err(|error| error.to_string())?;

    webview.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn webview_current_url(app: tauri::AppHandle, label: String) -> Result<String, String> {
    use tauri::Manager;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;

    #[cfg(target_os = "windows")]
    {
        use windows::core::PWSTR;
        use windows::Win32::System::Com::CoTaskMemFree;

        let (tx, rx) = std::sync::mpsc::sync_channel(1);

        webview
            .with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };

                let mut uri = PWSTR::null();
                if core.Source(&mut uri).is_ok() {
                    if let Ok(url) = uri.to_string() {
                        let _ = tx.send(url);
                    }
                    if !uri.is_null() {
                        CoTaskMemFree(Some(uri.as_ptr().cast()));
                    }
                }
            })
            .map_err(|error| error.to_string())?;

        rx.recv_timeout(std::time::Duration::from_secs(2))
            .map_err(|_| format!("timed out reading '{label}' url"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(current) = webview.url() {
            let href = current.to_string();
            if !href.is_empty() && href != "about:blank" {
                return Ok(href);
            }
        }
        Ok(String::new())
    }
}

#[tauri::command]
fn webview_go_back(app: tauri::AppHandle, label: String) -> Result<bool, String> {
    use tauri::Manager;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;

    #[cfg(target_os = "windows")]
    {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);

        webview
            .with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };

                let mut can_go_back = windows_core::BOOL::default();
                if core.CanGoBack(std::ptr::addr_of_mut!(can_go_back)).is_ok()
                    && can_go_back.as_bool()
                {
                    let _ = core.GoBack();
                    let _ = tx.send(true);
                } else {
                    let _ = tx.send(false);
                }
            })
            .map_err(|error| error.to_string())?;

        rx.recv_timeout(std::time::Duration::from_secs(2))
            .map_err(|_| format!("timed out going back in '{label}'"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = webview;
        Ok(false)
    }
}

#[tauri::command]
fn webview_document_title(app: tauri::AppHandle, label: String) -> Result<String, String> {
    use tauri::Manager;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;

    #[cfg(target_os = "windows")]
    {
        use windows::core::PWSTR;
        use windows::Win32::System::Com::CoTaskMemFree;

        let (tx, rx) = std::sync::mpsc::sync_channel(1);

        webview
            .with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };

                let mut title = PWSTR::null();
                if core.DocumentTitle(&mut title).is_ok() {
                    if let Ok(text) = title.to_string() {
                        let _ = tx.send(text);
                    }
                    if !title.is_null() {
                        CoTaskMemFree(Some(title.as_ptr().cast()));
                    }
                }
            })
            .map_err(|error| error.to_string())?;

        rx.recv_timeout(std::time::Duration::from_secs(2))
            .map_err(|_| format!("timed out reading '{label}' title"))
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = webview;
        Ok(String::new())
    }
}

#[cfg(target_os = "windows")]
fn resolve_webview_hwnd(
    app: &tauri::AppHandle,
    label: &str,
) -> Result<windows::Win32::Foundation::HWND, String> {
    use tauri::Manager;
    use windows::Win32::Foundation::HWND;

    let webview = app
        .get_webview(label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;

    let (tx, rx) = std::sync::mpsc::sync_channel(1);

    webview
        .with_webview(move |inner| unsafe {
            let mut hwnd = HWND::default();
            if inner.controller().ParentWindow(&mut hwnd).is_ok() && !hwnd.0.is_null() {
                let _ = tx.send(hwnd.0 as isize);
            }
        })
        .map_err(|error| error.to_string())?;

    let hwnd_value = rx
        .recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|_| format!("timed out resolving '{label}' hwnd"))?;

    Ok(HWND(hwnd_value as *mut _))
}

/// Debug helper: list currently registered window and webview labels.
#[cfg(target_os = "windows")]
fn debug_labels(app: &tauri::AppHandle) -> String {
    use tauri::Manager;

    let windows: Vec<String> = app.webview_windows().keys().cloned().collect();
    let webviews: Vec<String> = app.webviews().into_iter().map(|(label, _)| label).collect();

    format!("windows={windows:?} webviews={webviews:?}")
}

/// Force the OS to repaint the whole window tree after z-order/region changes.
/// SetWindowPos/SetWindowRgn with SWP_NOSIZE|SWP_NOMOVE don't always trigger a
/// repaint of areas that changed visibility, leaving stale/ghost pixels behind.
#[cfg(target_os = "windows")]
fn force_redraw(app: &tauri::AppHandle) {
    use windows::Win32::Graphics::Gdi::{
        RedrawWindow, RDW_ALLCHILDREN, RDW_ERASE, RDW_INVALIDATE, RDW_UPDATENOW,
    };

    if let Ok(hwnd) = resolve_webview_hwnd(app, "main") {
        unsafe {
            let _ = RedrawWindow(
                Some(hwnd),
                None,
                None,
                RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_ERASE | RDW_UPDATENOW,
            );
        }
    }
}

/// Clip chrome webview hit-testing to the title/semi-lunar strip.
#[cfg(target_os = "windows")]
fn set_chrome_hit_region(
    app: &tauri::AppHandle,
    logical_height: Option<f64>,
) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, SetWindowRgn};

    let window = app
        .get_window("main")
        .ok_or_else(|| format!("main window not found ({})", debug_labels(app)))?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let chrome_hwnd = resolve_webview_hwnd(app, "nebula-chrome")?;

    unsafe {
        match logical_height {
            None => {
                SetWindowRgn(chrome_hwnd, None, true);
            }
            Some(height) => {
                let physical_height =
                    (height * scale).round().clamp(1.0, size.height as f64) as i32;
                let rgn = CreateRectRgn(0, 0, size.width as i32, physical_height);
                if SetWindowRgn(chrome_hwnd, Some(rgn), true) == 0 {
                    return Err("SetWindowRgn failed for chrome".to_string());
                }
            }
        }
    }

    Ok(())
}

/// Browsing: tabs at bottom, main shell for semi-lunar overlay, title-bar chrome on top.
#[cfg(target_os = "windows")]
fn stack_chrome_above_browser(
    app: &tauri::AppHandle,
    _active_tab_label: Option<&str>,
    chrome_logical_height: Option<f64>,
) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_BOTTOM, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    if let Some(main) = app.get_webview("main") {
        let _ = main.show();
    }

    for (label, _) in app.webviews() {
        if label.starts_with("nebula-tab-") || label == "nebula-browser" {
            if let Ok(browser_hwnd) = resolve_webview_hwnd(app, &label) {
                unsafe {
                    SetWindowPos(
                        browser_hwnd,
                        Some(HWND_BOTTOM),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                    )
                    .map_err(|error| error.to_string())?;
                }
            }
        }
    }

    if let Ok(main_hwnd) = resolve_webview_hwnd(app, "main") {
        unsafe {
            SetWindowPos(
                main_hwnd,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
            .map_err(|error| error.to_string())?;
        }
    }

    if chrome_logical_height.is_some() && resolve_webview_hwnd(app, "nebula-chrome").is_ok() {
        set_chrome_hit_region(app, chrome_logical_height)?;
    }

    if let Ok(chrome_hwnd) = resolve_webview_hwnd(app, "nebula-chrome") {
        unsafe {
            SetWindowPos(
                chrome_hwnd,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
            .map_err(|error| error.to_string())?;
        }
    }

    force_redraw(app);

    Ok(())
}

/// Shell above site: lower browser HWND, then raise shell HWND.
#[cfg(target_os = "windows")]
fn stack_shell_above_browser(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_BOTTOM, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    let ui_hwnd = resolve_webview_hwnd(app, "main")?;

    for (label, _) in app.webviews() {
        if label.starts_with("nebula-tab-") || label == "nebula-browser" {
            if let Ok(browser_hwnd) = resolve_webview_hwnd(app, &label) {
                unsafe {
                    SetWindowPos(
                        browser_hwnd,
                        Some(HWND_BOTTOM),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                    )
                    .map_err(|error| error.to_string())?;
                }
            }
        }
    }

    unsafe {
        SetWindowPos(
            ui_hwnd,
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|error| error.to_string())?;
    }

    force_redraw(app);

    Ok(())
}

/// Quick menu overlay: tabs at bottom, main shell interactive, chrome strip on top.
#[cfg(target_os = "windows")]
fn stack_overlay_mode(
    app: &tauri::AppHandle,
    chrome_logical_height: Option<f64>,
) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_BOTTOM, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    if let Some(main) = app.get_webview("main") {
        let _ = main.show();
    }

    for (label, _) in app.webviews() {
        if label.starts_with("nebula-tab-") || label == "nebula-browser" {
            if let Ok(browser_hwnd) = resolve_webview_hwnd(app, &label) {
                unsafe {
                    SetWindowPos(
                        browser_hwnd,
                        Some(HWND_BOTTOM),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                    )
                    .map_err(|error| error.to_string())?;
                }
            }
        }
    }

    let main_hwnd = resolve_webview_hwnd(app, "main")?;
    unsafe {
        SetWindowPos(
            main_hwnd,
            Some(HWND_TOP),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        )
        .map_err(|error| error.to_string())?;
    }

    if chrome_logical_height.is_some() && resolve_webview_hwnd(app, "nebula-chrome").is_ok() {
        set_chrome_hit_region(app, chrome_logical_height)?;
    }

    if let Ok(chrome_hwnd) = resolve_webview_hwnd(app, "nebula-chrome") {
        unsafe {
            SetWindowPos(
                chrome_hwnd,
                Some(HWND_TOP),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )
            .map_err(|error| error.to_string())?;
        }
    }

    force_redraw(app);

    Ok(())
}

/// Parent window client area in physical pixels.
#[cfg(target_os = "windows")]
fn main_client_physical_rect(app: &tauri::AppHandle) -> Result<(i32, i32, i32, i32), String> {
    use tauri::Manager;
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

    let window = app
        .get_window("main")
        .ok_or_else(|| format!("main window not found ({})", debug_labels(app)))?;
    let parent_hwnd = window.hwnd().map_err(|error| error.to_string())?;

    unsafe {
        let mut rect = RECT::default();
        GetClientRect(parent_hwnd, &mut rect).map_err(|error| error.to_string())?;
        let width = (rect.right - rect.left).max(1);
        let height = (rect.bottom - rect.top).max(1);
        Ok((0, 0, width, height))
    }
}

#[cfg(target_os = "windows")]
fn layout_webview_hwnd(
    hwnd: windows::Win32::Foundation::HWND,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    z: Option<windows::Win32::Foundation::HWND>,
) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE};

    unsafe {
        SetWindowPos(
            hwnd,
            z,
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Raise a tab webview above shell/chrome for HTML5 fullscreen video.
#[cfg(target_os = "windows")]
fn stack_tab_fullscreen(app: &tauri::AppHandle, tab_label: &str) -> Result<(), String> {
    use windows::Win32::Graphics::Gdi::SetWindowRgn;
    use windows::Win32::UI::WindowsAndMessaging::{HWND_BOTTOM, HWND_TOP};

    let (x, y, width, height) = main_client_physical_rect(app)?;

    if let Ok(ui_hwnd) = resolve_webview_hwnd(app, "main") {
        unsafe {
            SetWindowRgn(ui_hwnd, None, true);
        }
    }

    for label in ["main", "nebula-chrome"] {
        if let Ok(hwnd) = resolve_webview_hwnd(app, label) {
            layout_webview_hwnd(hwnd, x, y, width, height, Some(HWND_BOTTOM))?;
        }
    }

    if let Ok(tab_hwnd) = resolve_webview_hwnd(app, tab_label) {
        layout_webview_hwnd(tab_hwnd, x, y, width, height, Some(HWND_TOP))?;
    }

    force_redraw(app);

    Ok(())
}

/// Reset tab + shell HWND geometry after leaving site fullscreen.
#[cfg(target_os = "windows")]
fn restore_browsing_webview_layout(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::Graphics::Gdi::SetWindowRgn;
    use windows::Win32::UI::WindowsAndMessaging::{HWND_BOTTOM, HWND_TOP};

    let (x, y, width, height) = main_client_physical_rect(app)?;

    for (label, _) in app.webviews() {
        if label.starts_with("nebula-tab-") || label == "nebula-browser" {
            if let Ok(tab_hwnd) = resolve_webview_hwnd(app, &label) {
                layout_webview_hwnd(tab_hwnd, x, y, width, height, Some(HWND_BOTTOM))?;
            }
        }
    }

    if let Ok(main_hwnd) = resolve_webview_hwnd(app, "main") {
        unsafe {
            SetWindowRgn(main_hwnd, None, true);
        }
        layout_webview_hwnd(main_hwnd, x, y, width, height, Some(HWND_TOP))?;
    }

    if let Some(main) = app.get_webview("main") {
        let _ = main.show();
    }

    force_redraw(app);

    Ok(())
}

#[tauri::command]
fn window_enter_site_fullscreen(app: tauri::AppHandle) -> Result<(), String> {
    site_fullscreen_window::enter_site_fullscreen_window(&app)
}

#[tauri::command]
fn window_exit_site_fullscreen(app: tauri::AppHandle) -> Result<(), String> {
    site_fullscreen_window::exit_site_fullscreen_window(&app)
}

#[tauri::command]
fn window_toggle_monitor_maximize(app: tauri::AppHandle) -> Result<bool, String> {
    site_fullscreen_window::toggle_monitor_maximize(&app)
}

#[tauri::command]
fn window_is_monitor_maximized() -> bool {
    site_fullscreen_window::is_monitor_maximized()
}

#[tauri::command]
fn webview_restore_browsing_layout(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        restore_browsing_webview_layout(&app)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
fn webview_raise_tab_fullscreen(app: tauri::AppHandle, label: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        stack_tab_fullscreen(&app, &label)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, label);
        Ok(())
    }
}

#[tauri::command]
fn webview_raise_overlay(
    app: tauri::AppHandle,
    chrome_logical_height: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        stack_overlay_mode(&app, chrome_logical_height)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, chrome_logical_height);
        Ok(())
    }
}

#[tauri::command]
fn webview_raise_chrome(
    app: tauri::AppHandle,
    active_tab_label: Option<String>,
    chrome_logical_height: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        stack_chrome_above_browser(&app, active_tab_label.as_deref(), chrome_logical_height)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, active_tab_label, chrome_logical_height);
        Ok(())
    }
}

#[tauri::command]
fn webview_set_chrome_hit_region(
    app: tauri::AppHandle,
    logical_height: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        set_chrome_hit_region(&app, logical_height)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, logical_height);
        Ok(())
    }
}

#[tauri::command]
fn webview_raise_ui(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        stack_shell_above_browser(&app)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Clip shell webview hit-testing so clicks reach tab webviews outside the strip.
#[cfg(target_os = "windows")]
fn set_shell_hit_region(
    app: &tauri::AppHandle,
    logical_top: Option<f64>,
    logical_height: Option<f64>,
    logical_left: Option<f64>,
    logical_width: Option<f64>,
) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, SetWindowRgn};

    let window = app
        .get_window("main")
        .ok_or_else(|| format!("main window not found ({})", debug_labels(app)))?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let ui_hwnd = resolve_webview_hwnd(app, "main")?;

    unsafe {
        match logical_height {
            None => {
                SetWindowRgn(ui_hwnd, None, true);
            }
            Some(height) => {
                let top = logical_top.unwrap_or(0.0);
                let physical_top = (top * scale).round().clamp(0.0, size.height as f64) as i32;
                let physical_bottom = (physical_top as f64 + height * scale)
                    .round()
                    .clamp(physical_top as f64 + 1.0, size.height as f64)
                    as i32;
                let physical_left = logical_left
                    .map(|left| (left * scale).round().clamp(0.0, size.width as f64) as i32)
                    .unwrap_or(0);
                let physical_right = logical_width
                    .map(|width| {
                        ((physical_left as f64 + width * scale)
                            .round()
                            .clamp(physical_left as f64 + 1.0, size.width as f64))
                            as i32
                    })
                    .unwrap_or(size.width as i32);
                let rgn = CreateRectRgn(
                    physical_left,
                    physical_top,
                    physical_right,
                    physical_bottom,
                );
                if SetWindowRgn(ui_hwnd, Some(rgn), true) == 0 {
                    return Err("SetWindowRgn failed".to_string());
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn webview_set_shell_hit_region(
    app: tauri::AppHandle,
    logical_top: Option<f64>,
    logical_height: Option<f64>,
    logical_left: Option<f64>,
    logical_width: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        set_shell_hit_region(
            &app,
            logical_top,
            logical_height,
            logical_left,
            logical_width,
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (
            app,
            logical_top,
            logical_height,
            logical_left,
            logical_width,
        );
        Ok(())
    }
}

fn load_runtime_env() {
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let config = std::path::PathBuf::from(local)
            .join("com.nebula.browser")
            .join(".env");
        if config.exists() {
            let _ = dotenvy::from_path(&config);
        }
    }

    let _ = dotenvy::from_filename("../.env");
    let _ = dotenvy::dotenv();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            load_runtime_env();

            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_global_shortcut::Builder::new().build())?;
            }

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            webview_navigate,
            webview_close_tab,
            webview_current_url,
            webview_go_back,
            webview_controls::webview_go_forward,
            webview_controls::webview_reload,
            webview_controls::webview_zoom,
            webview_controls::webview_open_devtools,
            webview_document_title,
            webview_raise_ui,
            webview_raise_overlay,
            webview_raise_chrome,
            webview_raise_tab_fullscreen,
            window_enter_site_fullscreen,
            window_exit_site_fullscreen,
            window_toggle_monitor_maximize,
            window_is_monitor_maximized,
            webview_restore_browsing_layout,
            webview_set_chrome_hit_region,
            webview_set_shell_hit_region,
            webview_setup_tab_error_pages,
            webview_execute_script,
            system_stats::get_system_stats,
      browser_bookmarks::detect_default_browser,
      browser_bookmarks::import_default_browser_bookmarks,
      browser_passwords::detect_browser_passwords,
      browser_passwords::list_chromium_password_sources,
      browser_passwords::inspect_browser_passwords,
      browser_passwords::import_default_browser_passwords,
      google_oauth::exchange_google_oauth_token,
      google_oauth::google_oauth_sign_in_loopback,
      google_oauth::google_oauth_status,
    ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
