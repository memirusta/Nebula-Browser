mod browser_bookmarks;
mod browser_passwords;
mod download_manager;
mod google_oauth;
mod password_webview;
mod secure_password_vault;
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

// Browsing keeps the main WRY container full-screen for stable composition.
// The actual WebView2 document child is clipped to the interactive shell area,
// while the WRY container returns HTTRANSPARENT outside that rectangle so
// pointer input falls through to the browser tab below.
#[cfg(target_os = "windows")]
static SHELL_HIT_TEST_ENABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(target_os = "windows")]
static SHELL_HIT_TEST_LEFT: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(0);
#[cfg(target_os = "windows")]
static SHELL_HIT_TEST_TOP: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(0);
#[cfg(target_os = "windows")]
static SHELL_HIT_TEST_RIGHT: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(0);
#[cfg(target_os = "windows")]
static SHELL_HIT_TEST_BOTTOM: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(0);
#[cfg(target_os = "windows")]
static SHELL_HIT_TEST_SUBCLASSED_HWND: std::sync::atomic::AtomicIsize =
    std::sync::atomic::AtomicIsize::new(0);
#[cfg(target_os = "windows")]
static SHELL_HIT_TEST_ORIGINAL_WNDPROC: std::sync::atomic::AtomicIsize =
    std::sync::atomic::AtomicIsize::new(0);

// Dedicated chrome follows the same stable-composition rule as the main shell:
// keep the entire WRY/WebView2 compositor tree full-client and never clip it.
// Every HWND in the chrome input chain returns HTTRANSPARENT outside the
// published Semi-Lunar rectangle so pointer input reaches Home/browser below.
#[cfg(target_os = "windows")]
static CHROME_HIT_TEST_ENABLED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);
#[cfg(target_os = "windows")]
static CHROME_HIT_TEST_LEFT: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(0);
#[cfg(target_os = "windows")]
static CHROME_HIT_TEST_TOP: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(0);
#[cfg(target_os = "windows")]
static CHROME_HIT_TEST_RIGHT: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(0);
#[cfg(target_os = "windows")]
static CHROME_HIT_TEST_BOTTOM: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(0);
#[cfg(target_os = "windows")]
static CHROME_HIT_TEST_ORIGIN_X: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(0);
#[cfg(target_os = "windows")]
static CHROME_HIT_TEST_ORIGIN_Y: std::sync::atomic::AtomicI32 =
    std::sync::atomic::AtomicI32::new(0);
#[cfg(target_os = "windows")]
static CHROME_HIT_TEST_ORIGINAL_WNDPROCS: std::sync::OnceLock<
    std::sync::Mutex<std::collections::HashMap<isize, isize>>,
> = std::sync::OnceLock::new();

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
    webview_branding::setup_webview_branding(&app, &label)?;
    download_manager::setup_tab_downloads(&app, &label)?;
    tab_error_page::setup_tab_error_page(&app, &label)?;
    tab_fullscreen::setup_tab_fullscreen(&app, &label)?;
    tab_shortcuts::setup_tab_shortcuts(&app, &label)?;
    tab_metadata::setup_tab_metadata(&app, &label)
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

#[tauri::command]
fn webview_document_title(app: tauri::AppHandle, label: String) -> Result<String, String> {
    use tauri::Manager;

    if !label.starts_with("nebula-tab-") {
        return Err("title reads are limited to browser tabs".to_string());
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
    let webviews: Vec<String> = app.webviews().into_keys().collect();

    format!("windows={windows:?} webviews={webviews:?}")
}

/// Force the OS to repaint the whole window tree after z-order/region changes.
/// SetWindowPos/SetWindowRgn with SWP_NOSIZE|SWP_NOMOVE don't always trigger a
/// repaint of areas that changed visibility, leaving stale/ghost pixels behind.
#[cfg(target_os = "windows")]
fn force_redraw(app: &tauri::AppHandle) {
    use tauri::Manager;
    use windows::Win32::Graphics::Gdi::{
        RedrawWindow, RDW_ALLCHILDREN, RDW_INVALIDATE, RDW_NOERASE, RDW_UPDATENOW,
    };

    // Redraw the top-level Nebula window, not only the main/Home WRY child.
    // Home, browser tabs, and dedicated chrome are sibling child HWNDs. After
    // SetWindowRgn changes the chrome surface, invalidating only `main` can
    // leave WebView2's composition visually stale until Windows performs a
    // full activation repaint (for example after Alt+Tab).
    //
    // RDW_UPDATENOW makes this an actual synchronous repaint rather than merely
    // marking the tree dirty for some later WM_PAINT cycle. RDW_ALLCHILDREN is
    // required so the sibling WRY/WebView2 child hierarchy participates too.
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

/// Route input for every HWND that can receive pointer hit-tests inside the
/// dedicated chrome WebView without clipping any compositor surface.
///
/// Chromium/WebView2 has several nested child HWNDs under WRY_WEBVIEW. Hooking
/// only the WRY host is not enough: Windows can hit-test the deepest renderer
/// child directly and that child will otherwise swallow input even when the
/// host itself would return HTTRANSPARENT.
#[cfg(target_os = "windows")]
fn chrome_hit_test_original_wndprocs(
) -> &'static std::sync::Mutex<std::collections::HashMap<isize, isize>> {
    CHROME_HIT_TEST_ORIGINAL_WNDPROCS
        .get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

#[cfg(target_os = "windows")]
unsafe extern "system" fn chrome_hit_test_wndproc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use std::sync::atomic::Ordering;
    use windows::Win32::Foundation::LRESULT;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, HTTRANSPARENT, WM_NCHITTEST,
    };

    if msg == WM_NCHITTEST && CHROME_HIT_TEST_ENABLED.load(Ordering::Acquire) {
        // WM_NCHITTEST lParam is in screen coordinates. Convert it to the
        // chrome container's client coordinates using the container's screen
        // origin published alongside the hit rectangle.
        let packed = lparam.0 as usize;
        let screen_x = (packed as u16 as i16) as i32;
        let screen_y = ((packed >> 16) as u16 as i16) as i32;
        let point_x = screen_x - CHROME_HIT_TEST_ORIGIN_X.load(Ordering::Relaxed);
        let point_y = screen_y - CHROME_HIT_TEST_ORIGIN_Y.load(Ordering::Relaxed);

        let left = CHROME_HIT_TEST_LEFT.load(Ordering::Relaxed);
        let top = CHROME_HIT_TEST_TOP.load(Ordering::Relaxed);
        let right = CHROME_HIT_TEST_RIGHT.load(Ordering::Relaxed);
        let bottom = CHROME_HIT_TEST_BOTTOM.load(Ordering::Relaxed);

        if point_x < left || point_x >= right || point_y < top || point_y >= bottom {
            return LRESULT(HTTRANSPARENT as isize);
        }
    }

    let original = chrome_hit_test_original_wndprocs()
        .lock()
        .ok()
        .and_then(|map| map.get(&(hwnd.0 as isize)).copied());

    if let Some(original) = original {
        if original != 0 {
            return CallWindowProcW(
                std::mem::transmute(original),
                hwnd,
                msg,
                wparam,
                lparam,
            );
        }
    }

    DefWindowProcW(hwnd, msg, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn chrome_hit_test_should_subclass(
    hwnd: windows::Win32::Foundation::HWND,
    include_root: bool,
) -> bool {
    if include_root {
        return true;
    }

    let class_name = hwnd_debug_class_name(hwnd);
    class_name.starts_with("Chrome_WidgetWin_")
        || class_name == "Chrome_RenderWidgetHostHWND"
        || class_name == "Intermediate D3D Window"
}

#[cfg(target_os = "windows")]
fn collect_chrome_hit_test_hwnds(
    root: windows::Win32::Foundation::HWND,
    output: &mut Vec<windows::Win32::Foundation::HWND>,
    depth: usize,
) {
    use windows::Win32::UI::WindowsAndMessaging::{GetWindow, GW_CHILD, GW_HWNDNEXT};

    if depth == 0 {
        return;
    }

    let mut child = unsafe { GetWindow(root, GW_CHILD).ok() };
    while let Some(hwnd) = child {
        if chrome_hit_test_should_subclass(hwnd, false) {
            output.push(hwnd);
        }
        collect_chrome_hit_test_hwnds(hwnd, output, depth - 1);
        child = unsafe { GetWindow(hwnd, GW_HWNDNEXT).ok() };
    }
}

#[cfg(target_os = "windows")]
fn ensure_chrome_hit_test_subclass_for_hwnd(
    hwnd: windows::Win32::Foundation::HWND,
) -> Result<(), String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWLP_WNDPROC,
    };

    let hwnd_value = hwnd.0 as isize;
    if chrome_hit_test_original_wndprocs()
        .lock()
        .map_err(|_| "chrome hit-test wndproc map poisoned".to_string())?
        .contains_key(&hwnd_value)
    {
        return Ok(());
    }

    unsafe {
        let original = GetWindowLongPtrW(hwnd, GWLP_WNDPROC);
        if original == 0 {
            return Err(format!(
                "failed to read chrome hit-test wndproc for {} ({hwnd_value})",
                hwnd_debug_class_name(hwnd)
            ));
        }

        // Publish the original before installing our proc so even a synchronous
        // message during subclass installation can safely chain onward.
        chrome_hit_test_original_wndprocs()
            .lock()
            .map_err(|_| "chrome hit-test wndproc map poisoned".to_string())?
            .insert(hwnd_value, original);

        let previous = SetWindowLongPtrW(
            hwnd,
            GWLP_WNDPROC,
            chrome_hit_test_wndproc as *const () as isize,
        );

        if previous == 0 {
            if let Ok(mut map) = chrome_hit_test_original_wndprocs().lock() {
                map.remove(&hwnd_value);
            }
            return Err(format!(
                "failed to subclass chrome hit-test wndproc for {} ({hwnd_value})",
                hwnd_debug_class_name(hwnd)
            ));
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn ensure_chrome_hit_test_subclasses(
    app: &tauri::AppHandle,
) -> Result<windows::Win32::Foundation::HWND, String> {
    use windows::Win32::Graphics::Gdi::SetWindowRgn;

    let container_hwnd = resolve_webview_hwnd(app, "nebula-chrome")?;
    let mut targets = vec![container_hwnd];
    collect_chrome_hit_test_hwnds(container_hwnd, &mut targets, 4);

    for hwnd in targets {
        ensure_chrome_hit_test_subclass_for_hwnd(hwnd)?;
    }

    unsafe {
        // Undo any host clipping left by earlier experiments. No descendant is
        // visually clipped in this implementation.
        SetWindowRgn(container_hwnd, None, true);
    }

    Ok(container_hwnd)
}

#[cfg(target_os = "windows")]
fn chrome_debug_tree_node(
    hwnd: windows::Win32::Foundation::HWND,
    depth: usize,
    max_depth: usize,
) -> serde_json::Value {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindow, GetWindowThreadProcessId, IsWindowVisible, GW_CHILD, GW_HWNDNEXT,
    };

    let mut process_id = 0u32;
    let thread_id = unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
    let hooked = chrome_hit_test_original_wndprocs()
        .lock()
        .ok()
        .map(|map| map.contains_key(&(hwnd.0 as isize)))
        .unwrap_or(false);

    let mut children = Vec::new();
    if depth < max_depth {
        let mut child = unsafe { GetWindow(hwnd, GW_CHILD) }
            .ok()
            .unwrap_or(HWND::default());
        let mut guard = 0usize;
        while !child.0.is_null() && guard < 32 {
            children.push(chrome_debug_tree_node(child, depth + 1, max_depth));
            child = unsafe { GetWindow(child, GW_HWNDNEXT) }
                .ok()
                .unwrap_or(HWND::default());
            guard += 1;
        }
    }

    serde_json::json!({
        "hwnd": hwnd.0 as isize,
        "class": hwnd_debug_class_name(hwnd),
        "visible": unsafe { IsWindowVisible(hwnd) }.as_bool(),
        "rect": hwnd_debug_rect(hwnd),
        "threadId": thread_id,
        "processId": process_id,
        "hitTestHooked": hooked,
        "children": children,
    })
}

#[cfg(target_os = "windows")]
fn log_chrome_region_snapshot(
    app: &tauri::AppHandle,
    phase: &str,
    logical_top: Option<f64>,
    logical_height: Option<f64>,
    logical_left: Option<f64>,
    logical_width: Option<f64>,
    physical_rect: Option<(i32, i32, i32, i32)>,
    container_hwnd: windows::Win32::Foundation::HWND,
    document_hwnd: Option<windows::Win32::Foundation::HWND>,
) {
    use std::sync::atomic::Ordering;
    use tauri::Manager;

    let window_size = app
        .get_window("main")
        .and_then(|window| window.inner_size().ok())
        .map(|size| serde_json::json!({ "width": size.width, "height": size.height }));
    let scale = app
        .get_window("main")
        .and_then(|window| window.scale_factor().ok());

    let main_surface = resolve_webview_hwnd(app, "main").ok();
    let main_surface_debug = main_surface.map(|hwnd| chrome_debug_tree_node(hwnd, 0, 2));

    let entry = serde_json::json!({
        "frontendTimestamp": serde_json::Value::Null,
        "stage": "native.chrome-region.snapshot",
        "status": "info",
        "phase": phase,
        "logical": {
            "top": logical_top,
            "height": logical_height,
            "left": logical_left,
            "width": logical_width,
        },
        "physical": physical_rect.map(|(left, top, right, bottom)| serde_json::json!({
            "left": left,
            "top": top,
            "right": right,
            "bottom": bottom,
            "width": right - left,
            "height": bottom - top,
        })),
        "windowSize": window_size,
        "scaleFactor": scale,
        "hitTest": {
            "enabled": CHROME_HIT_TEST_ENABLED.load(Ordering::Acquire),
            "left": CHROME_HIT_TEST_LEFT.load(Ordering::Relaxed),
            "top": CHROME_HIT_TEST_TOP.load(Ordering::Relaxed),
            "right": CHROME_HIT_TEST_RIGHT.load(Ordering::Relaxed),
            "bottom": CHROME_HIT_TEST_BOTTOM.load(Ordering::Relaxed),
        },
        "container": chrome_debug_tree_node(container_hwnd, 0, 4),
        "mainSurface": main_surface_debug,
        "selectedDocumentHwnd": document_hwnd.map(|hwnd| hwnd.0 as isize),
        "selectedDocumentClass": document_hwnd.map(hwnd_debug_class_name),
        "selectedDocumentRect": document_hwnd.map(hwnd_debug_rect),
    });

    let _ = write_transition_log(app.clone(), entry);
}

#[cfg(target_os = "windows")]
fn set_chrome_hit_region(
    app: &tauri::AppHandle,
    logical_top: Option<f64>,
    logical_height: Option<f64>,
    logical_left: Option<f64>,
    logical_width: Option<f64>,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri::Manager;
    use windows::Win32::Graphics::Gdi::SetWindowRgn;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindow, SetWindowPos, GW_CHILD, SWP_NOACTIVATE, SWP_NOZORDER,
    };

    let window = app
        .get_window("main")
        .ok_or_else(|| format!("main window not found ({})", debug_labels(app)))?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let container_hwnd = ensure_chrome_hit_test_subclasses(app)?;

    // The dedicated chrome WebView is a transparent overlay. Keep its complete
    // WRY/WebView2 compositor tree intact and full-client at all times. Visual
    // clipping with SetWindowRgn caused stale/partially-presented WebView2
    // frames; only native hit testing should decide where this overlay accepts
    // pointer input.
    unsafe {
        SetWindowPos(
            container_hwnd,
            None,
            0,
            0,
            size.width.max(1) as i32,
            size.height.max(1) as i32,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(|error| error.to_string())?;
        // Clear only legacy clipping that may have been left on the WRY host.
        // No descendant gets a region in this implementation.
        SetWindowRgn(container_hwnd, None, false);
    }

    // WM_NCHITTEST arrives in screen coordinates even for child windows. Store
    // the WRY container screen origin so every nested Chromium child can use
    // the same Semi-Lunar rectangle.
    let container_rect = hwnd_debug_rect(container_hwnd);
    if let (Some(left), Some(top)) = (
        container_rect.get("left").and_then(|value| value.as_i64()),
        container_rect.get("top").and_then(|value| value.as_i64()),
    ) {
        CHROME_HIT_TEST_ORIGIN_X.store(left as i32, Ordering::Relaxed);
        CHROME_HIT_TEST_ORIGIN_Y.store(top as i32, Ordering::Relaxed);
    }

    // The Chromium child HWNDs can be created/recreated after the WRY host.
    // Re-scan on every layout publication; already-subclassed handles are cheap
    // no-ops, while newly-created renderer children become click-through too.
    ensure_chrome_hit_test_subclasses(app)?;

    // Resolve the first child for diagnostic snapshots only. The log proved it
    // is Chrome_WidgetWin_0, not the renderer/document surface, so it must not
    // be used as a clipping target.
    let diagnostic_child = unsafe { GetWindow(container_hwnd, GW_CHILD).ok() };

    log_chrome_region_snapshot(
        app,
        "before-hit-test-update",
        logical_top,
        logical_height,
        logical_left,
        logical_width,
        None,
        container_hwnd,
        diagnostic_child,
    );

    match logical_height {
        None => {
            CHROME_HIT_TEST_ENABLED.store(false, Ordering::Release);
        }
        Some(height) => {
            // Disable filtering while publishing the four coordinates, then
            // enable it only after the rectangle is complete.
            CHROME_HIT_TEST_ENABLED.store(false, Ordering::Release);

            let top = logical_top.unwrap_or(0.0);
            let physical_top =
                (top * scale).round().clamp(0.0, size.height.saturating_sub(1) as f64) as i32;
            let physical_bottom = (physical_top as f64 + height * scale)
                .round()
                .clamp(physical_top as f64 + 1.0, size.height as f64)
                as i32;
            let physical_left = logical_left
                .map(|left| {
                    (left * scale)
                        .round()
                        .clamp(0.0, size.width.saturating_sub(1) as f64)
                        as i32
                })
                .unwrap_or(0);
            let physical_right = logical_width
                .map(|width| {
                    (physical_left as f64 + width * scale)
                        .round()
                        .clamp(physical_left as f64 + 1.0, size.width as f64)
                        as i32
                })
                .unwrap_or(size.width as i32);

            CHROME_HIT_TEST_LEFT.store(physical_left, Ordering::Relaxed);
            CHROME_HIT_TEST_TOP.store(physical_top, Ordering::Relaxed);
            CHROME_HIT_TEST_RIGHT.store(physical_right, Ordering::Relaxed);
            CHROME_HIT_TEST_BOTTOM.store(physical_bottom, Ordering::Relaxed);
            CHROME_HIT_TEST_ENABLED.store(true, Ordering::Release);

            log_chrome_region_snapshot(
                app,
                "after-hit-test-update",
                logical_top,
                logical_height,
                logical_left,
                logical_width,
                Some((physical_left, physical_top, physical_right, physical_bottom)),
                container_hwnd,
                diagnostic_child,
            );
        }
    }

    // Intentionally no SetWindowRgn on Chrome_WidgetWin_0, WidgetWin_1,
    // RenderWidgetHost, or the D3D child, and no forced redraw. The transparent
    // WebView2 compositor stays geometrically stable across open/close.
    Ok(())
}

#[cfg(target_os = "windows")]
fn hwnd_debug_class_name(
    hwnd: windows::Win32::Foundation::HWND,
) -> String {
    use windows::Win32::UI::WindowsAndMessaging::GetClassNameW;

    let mut buffer = [0u16; 256];
    let length = unsafe { GetClassNameW(hwnd, &mut buffer) };
    if length <= 0 {
        return String::new();
    }

    String::from_utf16_lossy(&buffer[..length as usize])
}

#[cfg(target_os = "windows")]
fn hwnd_debug_rect(
    hwnd: windows::Win32::Foundation::HWND,
) -> serde_json::Value {
    use windows::Win32::Foundation::RECT;
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

    let mut rect = RECT::default();
    if unsafe { GetWindowRect(hwnd, &mut rect) }.is_err() {
        return serde_json::Value::Null;
    }

    serde_json::json!({
        "left": rect.left,
        "top": rect.top,
        "right": rect.right,
        "bottom": rect.bottom,
        "width": rect.right - rect.left,
        "height": rect.bottom - rect.top,
    })
}

#[cfg(target_os = "windows")]
fn hwnd_debug_entry(
    hwnd: windows::Win32::Foundation::HWND,
    role: Option<&str>,
) -> serde_json::Value {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindow, IsWindowVisible, GW_CHILD, GW_HWNDPREV, GW_HWNDNEXT,
    };

    let first_child = unsafe { GetWindow(hwnd, GW_CHILD) }
        .ok()
        .unwrap_or(HWND::default());
    let previous = unsafe { GetWindow(hwnd, GW_HWNDPREV) }
        .ok()
        .unwrap_or(HWND::default());
    let next = unsafe { GetWindow(hwnd, GW_HWNDNEXT) }
        .ok()
        .unwrap_or(HWND::default());

    serde_json::json!({
        "role": role,
        "hwnd": hwnd.0 as isize,
        "class": hwnd_debug_class_name(hwnd),
        "visible": unsafe { IsWindowVisible(hwnd) }.as_bool(),
        "rect": hwnd_debug_rect(hwnd),
        "firstChildHwnd": first_child.0 as isize,
        "firstChildClass": if first_child.0.is_null() { String::new() } else { hwnd_debug_class_name(first_child) },
        "previousSiblingHwnd": previous.0 as isize,
        "nextSiblingHwnd": next.0 as isize,
    })
}

/// Persist the actual Win32 sibling order of Tauri/Wry child surfaces.
/// This is intentionally diagnostic-only: it does not mutate z-order.
#[cfg(target_os = "windows")]
fn log_native_webview_stack(
    app: &tauri::AppHandle,
    phase: &str,
    active_tab_label: Option<&str>,
) {
    use tauri::Manager;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindow, GW_CHILD, GW_HWNDNEXT};

    let parent_hwnd = match app.get_window("main").and_then(|window| window.hwnd().ok()) {
        Some(hwnd) => hwnd,
        None => return,
    };

    let main_hwnd = resolve_webview_hwnd(app, "main").ok();
    let chrome_hwnd = resolve_webview_hwnd(app, "nebula-chrome").ok();
    let active_hwnd = active_tab_label.and_then(|label| resolve_webview_hwnd(app, label).ok());

    let mut children = Vec::new();
    let mut current = unsafe { GetWindow(parent_hwnd, GW_CHILD) }
        .ok()
        .unwrap_or(HWND::default());
    let mut guard = 0usize;

    while !current.0.is_null() && guard < 64 {
        let role = if Some(current) == chrome_hwnd {
            Some("chrome")
        } else if Some(current) == active_hwnd {
            Some("active-browser")
        } else if Some(current) == main_hwnd {
            Some("main-home")
        } else {
            None
        };

        children.push(hwnd_debug_entry(current, role));
        current = unsafe { GetWindow(current, GW_HWNDNEXT) }
            .ok()
            .unwrap_or(HWND::default());
        guard += 1;
    }

    let entry = serde_json::json!({
        "frontendTimestamp": serde_json::Value::Null,
        "stage": "native.stack.snapshot",
        "status": "info",
        "phase": phase,
        "activeTabLabel": active_tab_label,
        "parentHwnd": parent_hwnd.0 as isize,
        "parentClass": hwnd_debug_class_name(parent_hwnd),
        "resolvedMain": main_hwnd.map(|hwnd| hwnd.0 as isize),
        "resolvedChrome": chrome_hwnd.map(|hwnd| hwnd.0 as isize),
        "resolvedActive": active_hwnd.map(|hwnd| hwnd.0 as isize),
        // GetWindow(parent, GW_CHILD) returns the top child; GW_HWNDNEXT walks downward.
        "childrenTopToBottom": children,
    });

    let _ = write_transition_log(app.clone(), entry);
}

/// Browsing stack for the separated-surface architecture:
/// opaque Home/main at bottom, active site in the middle, dedicated chrome top.
#[cfg(target_os = "windows")]
fn stack_chrome_above_browser(
    app: &tauri::AppHandle,
    active_tab_label: Option<&str>,
    _chrome_logical_height: Option<f64>,
) -> Result<(), String> {
    use tauri::Manager;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_BOTTOM, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    log_native_webview_stack(app, "before-stack", active_tab_label);

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
        if label.starts_with("nebula-tab-") || label == "nebula-browser" {
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

    log_native_webview_stack(app, "after-stack", active_tab_label);
    force_redraw(app);
    log_native_webview_stack(app, "after-redraw", active_tab_label);
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
    use windows::Win32::Graphics::Gdi::SetWindowRgn;
    use windows::Win32::UI::WindowsAndMessaging::{HWND_BOTTOM, HWND_TOP};

    let (x, y, width, height) = main_client_physical_rect(app)?;

    if let Ok(ui_hwnd) = resolve_webview_hwnd(app, "main") {
        unsafe {
            SetWindowRgn(ui_hwnd, None, false);
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
    use windows::Win32::UI::WindowsAndMessaging::HWND_BOTTOM;

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
    logical_top: Option<f64>,
    logical_height: Option<f64>,
    logical_left: Option<f64>,
    logical_width: Option<f64>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        set_chrome_hit_region(
            &app,
            logical_top,
            logical_height,
            logical_left,
            logical_width,
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, logical_top, logical_height, logical_left, logical_width);
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

/// Main-shell input routing without resizing/clipping the WRY container.
///
/// Wry 0.55 creates a `WRY_WEBVIEW` container HWND and hosts the actual
/// WebView2 document as its first child. Keeping the container full-screen
/// avoids the compositor gap caused by resizing/region-clipping that host.
/// While browsing we clip only the document child to the Semi-Lunar area and
/// return HTTRANSPARENT from the container outside that rectangle, allowing
/// the browser-tab sibling underneath to receive pointer input.
#[cfg(target_os = "windows")]
unsafe extern "system" fn shell_hit_test_wndproc(
    hwnd: windows::Win32::Foundation::HWND,
    msg: u32,
    wparam: windows::Win32::Foundation::WPARAM,
    lparam: windows::Win32::Foundation::LPARAM,
) -> windows::Win32::Foundation::LRESULT {
    use std::sync::atomic::Ordering;
    use windows::Win32::Foundation::{LRESULT, POINT};
    use windows::Win32::Graphics::Gdi::ScreenToClient;
    use windows::Win32::UI::WindowsAndMessaging::{
        CallWindowProcW, DefWindowProcW, HTTRANSPARENT, WM_NCHITTEST,
    };

    if msg == WM_NCHITTEST && SHELL_HIT_TEST_ENABLED.load(Ordering::Acquire) {
        // WM_NCHITTEST packs signed screen coordinates into LPARAM.
        let packed = lparam.0 as usize;
        let screen_x = (packed as u16 as i16) as i32;
        let screen_y = ((packed >> 16) as u16 as i16) as i32;
        let mut point = POINT {
            x: screen_x,
            y: screen_y,
        };

        let _ = ScreenToClient(hwnd, &mut point);

        let left = SHELL_HIT_TEST_LEFT.load(Ordering::Relaxed);
        let top = SHELL_HIT_TEST_TOP.load(Ordering::Relaxed);
        let right = SHELL_HIT_TEST_RIGHT.load(Ordering::Relaxed);
        let bottom = SHELL_HIT_TEST_BOTTOM.load(Ordering::Relaxed);

        if point.x < left || point.x >= right || point.y < top || point.y >= bottom {
            return LRESULT(HTTRANSPARENT as isize);
        }
    }

    let original = SHELL_HIT_TEST_ORIGINAL_WNDPROC.load(Ordering::Acquire);
    if original != 0 {
        return CallWindowProcW(
            std::mem::transmute(original),
            hwnd,
            msg,
            wparam,
            lparam,
        );
    }

    DefWindowProcW(hwnd, msg, wparam, lparam)
}

#[cfg(target_os = "windows")]
fn ensure_shell_hit_test_subclass(
    app: &tauri::AppHandle,
) -> Result<windows::Win32::Foundation::HWND, String> {
    use std::sync::atomic::Ordering;
    use windows::Win32::Graphics::Gdi::SetWindowRgn;
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWLP_WNDPROC,
    };

    let container_hwnd = resolve_webview_hwnd(app, "main")?;
    let hwnd_value = container_hwnd.0 as isize;

    if SHELL_HIT_TEST_SUBCLASSED_HWND.load(Ordering::Acquire) != hwnd_value {
        unsafe {
            let original = GetWindowLongPtrW(container_hwnd, GWLP_WNDPROC);
            if original == 0 {
                return Err("failed to read main WRY container wndproc".to_string());
            }

            SHELL_HIT_TEST_ORIGINAL_WNDPROC.store(original, Ordering::Release);

            let previous = SetWindowLongPtrW(
                container_hwnd,
                GWLP_WNDPROC,
                shell_hit_test_wndproc as *const () as isize,
            );

            if previous == 0 {
                SHELL_HIT_TEST_ORIGINAL_WNDPROC.store(0, Ordering::Release);
                return Err("failed to subclass main WRY container wndproc".to_string());
            }

            // Remove any region left behind by older diagnostic implementations.
            SetWindowRgn(container_hwnd, None, true);
        }

        SHELL_HIT_TEST_SUBCLASSED_HWND.store(hwnd_value, Ordering::Release);
    }

    Ok(container_hwnd)
}

#[cfg(target_os = "windows")]
fn set_shell_hit_region(
    app: &tauri::AppHandle,
    logical_top: Option<f64>,
    logical_height: Option<f64>,
    logical_left: Option<f64>,
    logical_width: Option<f64>,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri::Manager;
    use windows::Win32::Graphics::Gdi::{CreateRectRgn, SetWindowRgn};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindow, SetWindowPos, GW_CHILD, SWP_NOACTIVATE, SWP_NOZORDER,
    };

    let window = app
        .get_window("main")
        .ok_or_else(|| format!("main window not found ({})", debug_labels(app)))?;
    let size = window.inner_size().map_err(|error| error.to_string())?;
    let scale = window.scale_factor().map_err(|error| error.to_string())?;
    let container_hwnd = ensure_shell_hit_test_subclass(app)?;

    // The container must stay full-client at all times. Resizing this HWND is
    // what produced the Home -> browsing transparent compositor frame.
    unsafe {
        SetWindowPos(
            container_hwnd,
            None,
            0,
            0,
            size.width.max(1) as i32,
            size.height.max(1) as i32,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(|error| error.to_string())?;

        SetWindowRgn(container_hwnd, None, false);
    }

    // Wry's Windows backend places the WebView2 document as the first child
    // of the WRY_WEBVIEW container.
    let document_hwnd = unsafe {
        GetWindow(container_hwnd, GW_CHILD)
            .map_err(|error| format!("failed to resolve main WebView2 document hwnd: {error}"))?
    };

    match logical_height {
        None => {
            // Home/overlay: restore the complete document and normal input.
            SHELL_HIT_TEST_ENABLED.store(false, Ordering::Release);
            unsafe {
                SetWindowRgn(document_hwnd, None, true);
            }
        }
        Some(height) => {
            // Disable hit filtering while publishing the new rectangle.
            SHELL_HIT_TEST_ENABLED.store(false, Ordering::Release);

            let top = logical_top.unwrap_or(0.0);
            let physical_top =
                (top * scale).round().clamp(0.0, size.height.saturating_sub(1) as f64) as i32;
            let physical_bottom = (physical_top as f64 + height * scale)
                .round()
                .clamp(physical_top as f64 + 1.0, size.height as f64)
                as i32;
            let physical_left = logical_left
                .map(|left| (left * scale).round().clamp(0.0, size.width.saturating_sub(1) as f64) as i32)
                .unwrap_or(0);
            let physical_right = logical_width
                .map(|width| {
                    (physical_left as f64 + width * scale)
                        .round()
                        .clamp(physical_left as f64 + 1.0, size.width as f64)
                        as i32
                })
                .unwrap_or(size.width as i32);

            SHELL_HIT_TEST_LEFT.store(physical_left, Ordering::Relaxed);
            SHELL_HIT_TEST_TOP.store(physical_top, Ordering::Relaxed);
            SHELL_HIT_TEST_RIGHT.store(physical_right, Ordering::Relaxed);
            SHELL_HIT_TEST_BOTTOM.store(physical_bottom, Ordering::Relaxed);

            unsafe {
                let region = CreateRectRgn(
                    physical_left,
                    physical_top,
                    physical_right,
                    physical_bottom,
                );

                if SetWindowRgn(document_hwnd, Some(region), true) == 0 {
                    return Err("SetWindowRgn failed for main WebView2 document child".to_string());
                }
            }

            SHELL_HIT_TEST_ENABLED.store(true, Ordering::Release);
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
    webview_document_title,
    webview_raise_ui,
    webview_raise_overlay,
    webview_raise_chrome,
    webview_raise_tab_fullscreen,
    window_enter_site_fullscreen,
    window_exit_site_fullscreen,
    webview_restore_browsing_layout,
    webview_set_chrome_hit_region,
    webview_set_shell_hit_region,
    webview_setup_tab_error_pages,
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
