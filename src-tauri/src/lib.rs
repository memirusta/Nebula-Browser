mod browser_bookmarks;
mod browser_passwords;
mod context_menu;
mod devtools_bridge;
mod download_manager;
mod google_oauth;
mod password_webview;
mod secure_password_vault;
mod site_ui;
mod site_fullscreen_window;
mod system_stats;
mod tab_error_page;
mod tab_fullscreen;
mod tab_metadata;
mod tab_shortcuts;
mod ublock_extension;
mod webview_branding;
mod webview_controls;
mod webview_privacy;

static TRANSITION_LOG_LOCK: std::sync::Mutex<()> =
    std::sync::Mutex::new(());

#[tauri::command]
async fn search_suggestions(
    query: String,
    engine: String,
) -> Result<Vec<String>, String> {
    use std::collections::HashSet;
    use std::time::Duration;

    let query = query.trim();

    if query.len() < 2 {
        return Ok(Vec::new());
    }

    let encoded = urlencoding::encode(query);

    let url = match engine.as_str() {
        "duckduckgo" => {
            format!("https://duckduckgo.com/ac/?q={encoded}")
        }

        "bing" => {
            format!(
                "https://api.bing.com/osjson.aspx?query={encoded}"
            )
        }

        _ => {
            format!(
                "https://suggestqueries.google.com/complete/search?client=firefox&q={encoded}"
            )
        }
    };

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 NebulaBrowser/1.2")
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|error| error.to_string())?;

    let retry_delays = [
        Duration::from_millis(0),
        Duration::from_millis(250),
        Duration::from_millis(700),
    ];

    let mut data: Option<serde_json::Value> = None;

    for (attempt, delay) in retry_delays.iter().enumerate() {
        if !delay.is_zero() {
            tokio::time::sleep(*delay).await;
        }

        match client.get(&url).send().await {
            Ok(response) => {
                let status = response.status();

                if status.is_success() {
                    match response.json::<serde_json::Value>().await {
                        Ok(json) => {
                            data = Some(json);
                            break;
                        }

                        Err(error) => {
                            #[cfg(debug_assertions)]
                            eprintln!(
                                "[nebula suggestions] attempt {} JSON error: {}",
                                attempt + 1,
                                error
                            );
                        }
                    }
                } else {
                    #[cfg(debug_assertions)]
                    eprintln!(
                        "[nebula suggestions] attempt {} HTTP {}",
                        attempt + 1,
                        status
                    );

                    // 4xx hatalarında 429 dışında tekrar denemenin
                    // pek anlamı yok.
                    if status.is_client_error()
                        && status != reqwest::StatusCode::TOO_MANY_REQUESTS
                    {
                        return Ok(Vec::new());
                    }
                }
            }

            Err(error) => {
                #[cfg(debug_assertions)]
                eprintln!(
                    "[nebula suggestions] attempt {} network error: {}",
                    attempt + 1,
                    error
                );
            }
        }
    }

    let Some(data) = data else {
        return Ok(Vec::new());
    };

    let mut suggestions: Vec<String> = Vec::new();

    if engine == "duckduckgo" {
        if let Some(entries) = data.as_array() {
            for entry in entries {
                if let Some(phrase) = entry
                    .get("phrase")
                    .and_then(|value| value.as_str())
                {
                    suggestions.push(phrase.to_string());
                }
            }
        }
    } else if let Some(entries) = data
        .get(1)
        .and_then(|value| value.as_array())
    {
        for entry in entries {
            if let Some(text) = entry.as_str() {
                suggestions.push(text.to_string());
            }
        }
    }

    let needle = query.to_lowercase();
    let mut seen = HashSet::<String>::new();
    let mut cleaned = Vec::<String>::new();

    for suggestion in suggestions {
        let suggestion = suggestion.trim().to_string();

        if suggestion.is_empty() {
            continue;
        }

        let normalized = suggestion.to_lowercase();

        if normalized == needle {
            continue;
        }

        if !seen.insert(normalized) {
            continue;
        }

        cleaned.push(suggestion);

        if cleaned.len() >= 6 {
            break;
        }
    }

    Ok(cleaned)
}

#[tauri::command]
fn write_transition_log(
    app: tauri::AppHandle,
    entry: serde_json::Value,
) -> Result<String, String> {
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::Manager;

    let _guard = TRANSITION_LOG_LOCK
        .lock()
        .map_err(|_| {
            "native-tab transition log lock was poisoned".to_string()
        })?;

    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| error.to_string())?;

    std::fs::create_dir_all(&log_dir)
        .map_err(|error| error.to_string())?;

    let path =
        log_dir.join("native-tab-transitions.jsonl");

    let mut record = match entry {
        serde_json::Value::Object(map) => map,

        value => {
            let mut map = serde_json::Map::new();

            map.insert(
                "entry".to_string(),
                value,
            );

            map
        }
    };

    let timestamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();

    record.insert(
        "hostTimestampMs".to_string(),
        serde_json::Value::String(
            timestamp_ms.to_string(),
        ),
    );

    let mut file =
        std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|error| error.to_string())?;

    serde_json::to_writer(
        &mut file,
        &record,
    )
    .map_err(|error| error.to_string())?;

    file.write_all(b"\n")
        .map_err(|error| error.to_string())?;

    file.flush()
        .map_err(|error| error.to_string())?;

    Ok(path.to_string_lossy().into_owned())
}

#[cfg(all(not(debug_assertions), dev))]
compile_error!(
    "Nebula release builds must use `npm run tauri:build:binary` or `tauri build`; direct `cargo build --release` would load devUrl/localhost."
);

#[tauri::command]
async fn webview_execute_script(
    app: tauri::AppHandle,
    label: String,
    script: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        password_webview::execute_script(&app, &label, &script)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn webview_setup_tab_error_pages(app: tauri::AppHandle, label: String) -> Result<(), String> {
    // WebView registration must run from Tauri's WebView/main context. Several
    // setup helpers intentionally rely on `with_webview` completing inline so
    // their COM handlers are installed before navigation begins. Moving this
    // entire command to `spawn_blocking` makes those helpers observe an
    // unconfigured WebView and abort tab activation.
    webview_branding::setup_webview_branding(&app, &label)?;
    site_ui::setup(&app, &label)?;
    // Context-menu interception requires a newer WebView2 interface. Keep tab
    // creation resilient on an unexpectedly old runtime; in that case the
    // branding layer still leaves the native Edge menu disabled.
    if let Err(error) = context_menu::setup(&app, &label) {
        #[cfg(debug_assertions)]
        eprintln!("[nebula context menu] {label}: {error}");
    }
    download_manager::setup_tab_downloads(&app, &label)?;
    tab_error_page::setup_tab_error_page(&app, &label)?;
    tab_fullscreen::setup_tab_fullscreen(&app, &label)?;
    tab_shortcuts::setup_tab_shortcuts(&app, &label)?;
    tab_metadata::setup_tab_metadata(&app, &label)
}

#[tauri::command]
async fn site_ui_respond(
    app: tauri::AppHandle,
    request_id: String,
    response: site_ui::SiteUiResponse,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || site_ui::respond(app, request_id, response))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn site_context_menu_respond(
    app: tauri::AppHandle,
    request_id: String,
    command_id: Option<i32>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        context_menu::respond(app, request_id, command_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn webview_devtools_call(
    app: tauri::AppHandle,
    label: String,
    method: String,
    params_json: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        devtools_bridge::call(&app, &label, &method, &params_json)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn webview_devtools_subscribe(
    app: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || devtools_bridge::subscribe(&app, &label))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn webview_devtools_unsubscribe(
    app: tauri::AppHandle,
    label: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || devtools_bridge::unsubscribe(&app, &label))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn webview_apply_privacy(
    app: tauri::AppHandle,
    label: String,
    options: webview_privacy::PrivacyOptions,
) -> Result<(), String> {
    webview_privacy::apply(&app, &label, options)
}

#[tauri::command]
fn webview_clear_browsing_data(
    app: tauri::AppHandle,
    label: String,
    kind: String,
) -> Result<(), String> {
    webview_privacy::clear_browsing_data(&app, &label, &kind)
}

#[tauri::command]
fn webview_setup_branding(app: tauri::AppHandle, label: String) -> Result<(), String> {
    webview_branding::setup_webview_branding(&app, &label)?;
    tab_error_page::setup_tab_error_page(&app, &label)
}

#[tauri::command]
fn webview_navigate(app: tauri::AppHandle, label: String, url: String) -> Result<(), String> {
    use tauri::Manager;

    if !label.starts_with("nebula-tab-") {
        return Err("navigation is limited to browser tabs".to_string());
    }
    let parsed = url.parse::<url::Url>().map_err(|error| error.to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "about")
        || (parsed.scheme() == "about" && parsed.as_str() != "about:blank")
    {
        return Err(format!(
            "navigation scheme '{}' is not allowed",
            parsed.scheme()
        ));
    }

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;

    webview.navigate(parsed).map_err(|error| error.to_string())
}

#[tauri::command]
async fn webview_close_tab(app: tauri::AppHandle, label: String) -> Result<(), String> {
    use tauri::Manager;

    if !label.starts_with("nebula-tab-") {
        return Err("close is limited to browser tabs".to_string());
    }
    tab_fullscreen::teardown_tab_fullscreen(&app, &label);
    devtools_bridge::teardown(&app, &label);
    context_menu::teardown(&app, &label);
    site_ui::teardown(&app, &label);
    download_manager::teardown_tab_downloads(&app, &label);
    webview_privacy::teardown(&app, &label);
    tab_error_page::teardown_tab_error_page(&app, &label);
    tab_shortcuts::teardown_tab_shortcuts(&app, &label);
    tab_metadata::teardown_tab_metadata(&app, &label);
    webview_branding::teardown_webview_branding(&label);

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
fn download_control(app: tauri::AppHandle, id: String, action: String) -> Result<(), String> {
    download_manager::control_download(app, id, action)
}

#[tauri::command]
fn webview_current_url(app: tauri::AppHandle, label: String) -> Result<String, String> {
    use tauri::Manager;

    if !label.starts_with("nebula-tab-") {
        return Err("URL reads are limited to browser tabs".to_string());
    }
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

    if !label.starts_with("nebula-tab-") {
        return Err("history navigation is limited to browser tabs".to_string());
    }
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
    let webviews: Vec<String> = app.webviews().into_keys().collect();

    format!("windows={windows:?} webviews={webviews:?}")
}

/// Force the OS to repaint the whole window tree after native z-order changes.
#[cfg(target_os = "windows")]
fn force_redraw(app: &tauri::AppHandle) {
    use tauri::Manager;
    use windows::Win32::Graphics::Gdi::{
        RedrawWindow, RDW_ALLCHILDREN, RDW_INVALIDATE, RDW_NOERASE, RDW_UPDATENOW,
    };

    // Home, browser tabs, and dedicated chrome are sibling child HWNDs.
    // Repaint the top-level window and all children immediately so composition
    // catches up with native z-order changes in the same transition.
    if let Some(window) = app.get_window("main") {
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let _ = RedrawWindow(
                    Some(hwnd),
                    None,
                    None,
                    RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_NOERASE | RDW_UPDATENOW,
                );
            }
        }
    }
}

/// Browsing stack for the separated-surface architecture:
/// opaque Home/main at bottom, active site in the middle, dedicated chrome top.
#[cfg(target_os = "windows")]
fn stack_chrome_above_browser(
    app: &tauri::AppHandle,
    active_tab_label: Option<&str>,
) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_BOTTOM, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };


    if let Some(main) = app.get_webview("main") {
        let _ = main.show();
    }

    // Home is deliberately kept alive and opaque underneath every browser tab.
    if let Ok(main_hwnd) = resolve_webview_hwnd(app, "main") {
        unsafe {
            SetWindowPos(
                main_hwnd,
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

    // Non-active browser WebViews are hidden by the JS tab manager. Keep their
    // native containers low as an additional guard, then raise only the active tab.
    for (label, _) in app.webviews() {
        if label.starts_with("nebula-tab-") {
            if active_tab_label == Some(label.as_str()) {
                continue;
            }
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

    if let Some(label) = active_tab_label {
        if let Ok(browser_hwnd) = resolve_webview_hwnd(app, label) {
            unsafe {
                SetWindowPos(
                    browser_hwnd,
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

/// Quick menu overlay: tabs at bottom, main shell interactive, chrome strip on top.
#[cfg(target_os = "windows")]
fn stack_overlay_mode(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_BOTTOM, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    if let Some(main) = app.get_webview("main") {
        let _ = main.show();
    }

    for (label, _) in app.webviews() {
        if label.starts_with("nebula-tab-") {
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
        SetWindowPos(hwnd, z, x, y, width, height, SWP_NOACTIVATE)
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// Raise a tab webview above shell/chrome for HTML5 fullscreen video.
#[cfg(target_os = "windows")]
fn stack_tab_fullscreen(app: &tauri::AppHandle, tab_label: &str) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{HWND_BOTTOM, HWND_TOP};

    let (x, y, width, height) = main_client_physical_rect(app)?;

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
    use windows::Win32::UI::WindowsAndMessaging::HWND_BOTTOM;

    let (x, y, width, height) = main_client_physical_rect(app)?;

    for (label, _) in app.webviews() {
        if label.starts_with("nebula-tab-") {
            if let Ok(tab_hwnd) = resolve_webview_hwnd(app, &label) {
                layout_webview_hwnd(tab_hwnd, x, y, width, height, Some(HWND_BOTTOM))?;
            }
        }
    }

    if let Ok(main_hwnd) = resolve_webview_hwnd(app, "main") {
        layout_webview_hwnd(main_hwnd, x, y, width, height, Some(HWND_BOTTOM))?;
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
    if !label.starts_with("nebula-tab-") {
        return Err("fullscreen is limited to browser tabs".to_string());
    }
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
fn webview_raise_overlay(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        stack_overlay_mode(&app)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
fn webview_raise_chrome(
    app: tauri::AppHandle,
    active_tab_label: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        stack_chrome_above_browser(&app, active_tab_label.as_deref())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, active_tab_label);
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

            webview_branding::setup_webview_branding(app.handle(), "main")
                .map_err(std::io::Error::other)?;
            tab_error_page::setup_tab_error_page(app.handle(), "main")
                .map_err(std::io::Error::other)?;

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
    write_transition_log,
    search_suggestions,
    webview_navigate,
    webview_close_tab,
    webview_current_url,
    webview_go_back,
    webview_controls::webview_go_forward,
    webview_controls::webview_reload,
    webview_controls::webview_zoom,
    webview_controls::webview_open_devtools,
    webview_controls::webview_set_memory_usage,
    webview_controls::webview_is_playing_audio,
    webview_controls::webview_set_suspended,
    webview_raise_overlay,
    webview_raise_chrome,
    webview_raise_tab_fullscreen,
    window_enter_site_fullscreen,
    window_exit_site_fullscreen,
    webview_restore_browsing_layout,
    webview_setup_tab_error_pages,
    site_ui_respond,
    site_context_menu_respond,
    webview_devtools_call,
    webview_devtools_subscribe,
    webview_devtools_unsubscribe,
    webview_apply_privacy,
    webview_clear_browsing_data,
    ublock_extension::ublock_extension_info,
    ublock_extension::ublock_extension_install,
    ublock_extension::ublock_extension_status,
    webview_setup_branding,
    webview_execute_script,
    download_control,
    secure_password_vault::password_vault_load,
    secure_password_vault::password_vault_save,
    secure_password_vault::password_vault_clear,
    system_stats::get_system_stats,
    system_stats::get_system_memory_pressure,
    browser_bookmarks::detect_default_browser,
    browser_bookmarks::import_default_browser_bookmarks,
    browser_passwords::list_chromium_password_sources,
    browser_passwords::import_default_browser_passwords,
    google_oauth::exchange_google_oauth_token,
    google_oauth::google_oauth_sign_in_loopback,
    google_oauth::google_oauth_status,
])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
