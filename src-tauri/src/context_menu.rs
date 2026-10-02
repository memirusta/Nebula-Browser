#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{LazyLock, Mutex};
    use std::time::Duration;

    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::ContextMenuRequestedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2ContextMenuItem, ICoreWebView2ContextMenuItemCollection,
        ICoreWebView2ContextMenuRequestedEventArgs, ICoreWebView2ContextMenuRequestedEventHandler,
        ICoreWebView2Deferral, ICoreWebView2_11, ICoreWebView2_13,
        COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND,
    };
    use windows::Win32::Foundation::POINT;
    use windows_core::{Interface, PWSTR};

    const CONTEXT_MENU_EVENT: &str = "nebula-site-context-menu";
    const CONTEXT_MENU_CANCELLED_EVENT: &str = "nebula-site-context-menu-cancelled";
    const NEBULA_PRINT_COMMAND_ID: i32 = -10_001;
    const NEBULA_INSPECT_COMMAND_ID: i32 = -10_002;
    const NEBULA_OPEN_SELECTION_COMMAND_ID: i32 = -10_003;
    const NEBULA_PASSWORD_SETTINGS_COMMAND_ID: i32 = -10_004;
    // Observed in a real password-field menu: WebView2 exposes Import passwords
    // as Name="other", CommandId=52999, even with its password store disabled.
    // Keep this fallback scoped to that unnamed command, never its translated label.
    const WEBVIEW2_IMPORT_PASSWORDS_COMMAND_ID: i32 = 52_999;
    const CONTEXT_MENU_TIMEOUT: Duration = Duration::from_secs(15);
    const MAX_PENDING_CONTEXT_MENUS_PER_TAB: usize = 1;

    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    static CONFIGURED: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    struct PendingContextMenu {
        tab_label: String,
        args: ICoreWebView2ContextMenuRequestedEventArgs,
        deferral: ICoreWebView2Deferral,
        selected_url: Option<String>,
        private_mode: Option<bool>,
    }

    thread_local! {
        static HANDLERS: RefCell<HashMap<String, ICoreWebView2ContextMenuRequestedEventHandler>> =
            RefCell::new(HashMap::new());
        static PENDING: RefCell<HashMap<String, PendingContextMenu>> =
            RefCell::new(HashMap::new());
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ContextMenuItemPayload {
        command_id: i32,
        label: String,
        name: String,
        shortcut: String,
        kind: String,
        enabled: bool,
        checked: bool,
        children: Vec<ContextMenuItemPayload>,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct ContextMenuPayload {
        id: String,
        tab_label: String,
        x: f64,
        y: f64,
        page_uri: String,
        frame_uri: String,
        link_uri: String,
        source_uri: String,
        selection_text: String,
        editable: bool,
        items: Vec<ContextMenuItemPayload>,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct CancelledPayload {
        id: String,
        tab_label: String,
    }

    fn has_pending_capacity<'a>(
        labels: impl Iterator<Item = &'a str>,
        tab_label: &str,
        limit: usize,
    ) -> bool {
        labels
            .filter(|label| *label == tab_label)
            .take(limit)
            .count()
            < limit
    }

    fn selected_web_address(selection: &str) -> Option<String> {
        let selection = selection.trim();
        if selection.is_empty()
            || selection.len() > 8_192
            || selection
                .chars()
                .any(|ch| ch.is_whitespace() || ch.is_control())
            || selection.contains(['\\', '<', '>', '"'])
        {
            return None;
        }
        let lower = selection.to_ascii_lowercase();
        let explicit_scheme = lower.starts_with("https://") || lower.starts_with("http://");
        let candidate = if explicit_scheme {
            selection.to_string()
        } else {
            format!("https://{selection}")
        };
        let mut parsed = url::Url::parse(&candidate).ok()?;
        if !matches!(parsed.scheme(), "http" | "https")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            return None;
        }
        let host = parsed.host_str()?;
        if !explicit_scheme {
            // Bare text must look like a DNS hostname, not an email, relative
            // path, search phrase, or URL scheme.
            let host = host.trim_end_matches('.');
            let labels: Vec<_> = host.split('.').collect();
            let suffix = labels.last()?;
            if labels.len() < 2
                || host.len() > 253
                || labels.iter().any(|label| {
                    label.is_empty()
                        || label.len() > 63
                        || label.starts_with('-')
                        || label.ends_with('-')
                        || !label
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
                })
                || suffix.len() < 2
                || !(suffix.bytes().all(|byte| byte.is_ascii_alphabetic())
                    || suffix.starts_with("xn--"))
            {
                return None;
            }
            if crate::network_address::is_local_network_host(host) {
                parsed.set_scheme("http").ok()?;
            }
        }
        Some(parsed.into())
    }

    fn complete_context_request(request: PendingContextMenu) {
        unsafe {
            let _ = request.args.SetHandled(true);
            let _ = request.deferral.Complete();
        }
    }

    fn expire_context_request(app: &AppHandle, request_id: &str) {
        let expired = PENDING.with(|pending| pending.borrow_mut().remove(request_id));
        if let Some(request) = expired {
            let tab_label = request.tab_label.clone();
            complete_context_request(request);
            let _ = app.emit(
                CONTEXT_MENU_CANCELLED_EVENT,
                CancelledPayload {
                    id: request_id.to_string(),
                    tab_label,
                },
            );
        }
    }

    fn schedule_context_timeout(app: &AppHandle, request_id: String) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(CONTEXT_MENU_TIMEOUT).await;
            let dispatcher = app.clone();
            let event_app = app.clone();
            let _ = dispatcher.run_on_main_thread(move || {
                expire_context_request(&event_app, &request_id);
            });
        });
    }

    fn enqueue_context_request(
        app: &AppHandle,
        payload: ContextMenuPayload,
        request: PendingContextMenu,
    ) {
        let request_id = payload.id.clone();
        let tab_label = request.tab_label.clone();
        let inserted = PENDING.with(|pending| {
            let mut pending = pending.borrow_mut();
            if !has_pending_capacity(
                pending.values().map(|request| request.tab_label.as_str()),
                &tab_label,
                MAX_PENDING_CONTEXT_MENUS_PER_TAB,
            ) {
                return Err(request);
            }
            pending.insert(request_id.clone(), request);
            Ok(())
        });

        if let Err(request) = inserted {
            complete_context_request(request);
            return;
        }

        if app.emit(CONTEXT_MENU_EVENT, payload).is_err() {
            expire_context_request(app, &request_id);
            return;
        }
        schedule_context_timeout(app, request_id);
    }

    fn take_string<F>(read: F) -> String
    where
        F: FnOnce(*mut PWSTR) -> windows_core::Result<()>,
    {
        let mut value = PWSTR::null();
        if read(&mut value).is_err() || value.is_null() {
            return String::new();
        }
        let text = unsafe { value.to_string().unwrap_or_default() };
        unsafe {
            windows::Win32::System::Com::CoTaskMemFree(Some(value.as_ptr().cast()));
        }
        text
    }

    fn kind_name(kind: COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND) -> &'static str {
        match kind.0 {
            0 => "command",
            1 => "check",
            2 => "radio",
            3 => "separator",
            4 => "submenu",
            _ => "command",
        }
    }

    unsafe fn item_payload(
        item: &ICoreWebView2ContextMenuItem,
        depth: usize,
    ) -> windows_core::Result<ContextMenuItemPayload> {
        let mut command_id = -1i32;
        let _ = item.CommandId(&mut command_id);
        let label = take_string(|value| item.Label(value)).replace('&', "");
        let name = take_string(|value| item.Name(value));
        let shortcut = take_string(|value| item.ShortcutKeyDescription(value));
        let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
        let _ = item.Kind(&mut kind);
        let mut enabled = windows_core::BOOL::default();
        let _ = item.IsEnabled(&mut enabled);
        let mut checked = windows_core::BOOL::default();
        let _ = item.IsChecked(&mut checked);

        let children = if kind.0 == 4 && depth < 3 {
            match item.Children() {
                Ok(collection) => collection_payload(&collection, depth + 1)?,
                Err(_) => Vec::new(),
            }
        } else {
            Vec::new()
        };

        Ok(ContextMenuItemPayload {
            command_id,
            label,
            name,
            shortcut,
            kind: kind_name(kind).to_string(),
            enabled: enabled.as_bool(),
            checked: checked.as_bool(),
            children,
        })
    }

    unsafe fn collection_payload(
        collection: &ICoreWebView2ContextMenuItemCollection,
        depth: usize,
    ) -> windows_core::Result<Vec<ContextMenuItemPayload>> {
        let mut count = 0u32;
        collection.Count(&mut count)?;

        let mut items = Vec::with_capacity(count as usize);

        for index in 0..count {
            let item = collection.GetValueAtIndex(index)?;

            let mut payload = item_payload(&item, depth)?;

            // Route WebView2's native Inspect entry into Nebula Inspector.
            if payload.name == "inspect" {
                payload.command_id = NEBULA_INSPECT_COMMAND_ID;
            }

            // Route Print through Nebula's native
            // system print flow.
            if payload.name == "print" {
                payload.command_id = NEBULA_PRINT_COMMAND_ID;
            }

            if payload.name == "importPasswords"
                || (payload.name == "other"
                    && payload.command_id == WEBVIEW2_IMPORT_PASSWORDS_COMMAND_ID
                    && payload.kind == "command")
            {
                // Never execute Edge's unsupported edge://settings password UI.
                payload.command_id = NEBULA_PASSWORD_SETTINGS_COMMAND_ID;
                payload.name = "nebula-import-passwords".into();
            }

            items.push(payload);
        }

        if depth == 0 {
            // This feature has no real device-sync
            // implementation in Nebula.
            items.retain(|item| item.name != "sendTabToSelf");

            // WebView2 currently puts Share inside
            // More tools. Move the same native command
            // to Nebula's top-level menu instead.
            let share = items
                .iter_mut()
                .find(|item| item.name == "moreTools")
                .and_then(|more_tools| {
                    more_tools
                        .children
                        .iter()
                        .position(|child| child.name == "share")
                        .map(|index| more_tools.children.remove(index))
                });

            if let Some(share) = share {
                let insert_at = items
                    .iter()
                    .position(|item| item.name == "print")
                    .map(|index| index + 1)
                    .unwrap_or(items.len());

                items.insert(insert_at, share);
            }

            // Share was the only current child of
            // More tools, so don't expose an empty
            // submenu.
            items.retain(|item| !(item.name == "moreTools" && item.children.is_empty()));

            // Removing items can leave separators at
            // the end of the menu.
            while matches!(
                items.last(),
                Some(item)
                    if item.kind == "separator"
            ) {
                items.pop();
            }
        }

        Ok(items)
    }

    pub fn setup(app: &AppHandle, label: &str) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") && !label.starts_with("nebula-popup-content-") {
            return Err(
                "context menu setup is limited to browser tabs and popup content".to_string(),
            );
        }
        if CONFIGURED
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            return Ok(());
        }

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let event_app = app.clone();
        let event_label = label.to_string();

        webview
            .with_webview(move |inner| unsafe {
                let result = (|| -> windows_core::Result<i64> {
                    let core = inner.controller().CoreWebView2()?;
                    let core11 = core.cast::<ICoreWebView2_11>()?;
                    // A new tab inherits this WebView's actual profile, even
                    // when the user's default for future tabs has changed.
                    let private_mode = core
                        .cast::<ICoreWebView2_13>()
                        .and_then(|core| core.Profile())
                        .and_then(|profile| {
                            let mut value = windows_core::BOOL::default();
                            profile.IsInPrivateModeEnabled(&mut value)?;
                            Ok(value.as_bool())
                        })
                        .ok();
                    let handler_app = event_app.clone();
                    let handler_label = event_label.clone();
                    let handler =
                        ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                            let Some(args) = args else { return Ok(()) };

                            // Suppress WebView2's visible menu first. If any later
                            // payload read fails, Nebula fails closed instead of
                            // leaking Edge UI.
                            args.SetHandled(true)?;

                            let deferral = match args.GetDeferral() {
                                Ok(deferral) => deferral,
                                Err(_) => return Ok(()),
                            };

                            let payload = (|| -> windows_core::Result<ContextMenuPayload> {
                                let target = args.ContextMenuTarget()?;
                                let collection = args.MenuItems()?;
                                let mut items = collection_payload(&collection, 0)?;
                                let selection_text =
                                    take_string(|value| target.SelectionText(value));
                                if private_mode.is_some()
                                    && selected_web_address(&selection_text).is_some()
                                {
                                    items.insert(
                                        0,
                                        ContextMenuItemPayload {
                                            command_id: NEBULA_OPEN_SELECTION_COMMAND_ID,
                                            label: String::new(),
                                            name: "nebula-open-selected-address".to_string(),
                                            shortcut: String::new(),
                                            kind: "command".to_string(),
                                            enabled: true,
                                            checked: false,
                                            children: Vec::new(),
                                        },
                                    );
                                }
                                let mut location = POINT::default();
                                let _ = args.Location(&mut location);
                                let scale = handler_app
                                    .get_webview(&handler_label)
                                    .map(|webview| webview.window().label().to_string())
                                    .and_then(|window_label| handler_app.get_window(&window_label))
                                    .and_then(|window| window.scale_factor().ok())
                                    .filter(|value| *value > 0.0)
                                    .unwrap_or(1.0);
                                let mut editable = windows_core::BOOL::default();
                                let _ = target.IsEditable(&mut editable);

                                Ok(ContextMenuPayload {
                                    id: format!(
                                        "context-{}",
                                        NEXT_ID.fetch_add(1, Ordering::Relaxed)
                                    ),
                                    tab_label: handler_label.clone(),
                                    x: location.x as f64 / scale,
                                    y: location.y as f64 / scale,
                                    page_uri: take_string(|value| target.PageUri(value)),
                                    frame_uri: take_string(|value| target.FrameUri(value)),
                                    link_uri: take_string(|value| target.LinkUri(value)),
                                    source_uri: take_string(|value| target.SourceUri(value)),
                                    selection_text,
                                    editable: editable.as_bool(),
                                    items,
                                })
                            })();

                            let payload = match payload {
                                Ok(payload) => payload,
                                Err(_) => {
                                    let _ = deferral.Complete();
                                    return Ok(());
                                }
                            };

                            let selected_url = selected_web_address(&payload.selection_text);
                            enqueue_context_request(
                                &handler_app,
                                payload,
                                PendingContextMenu {
                                    tab_label: handler_label.clone(),
                                    args,
                                    deferral,
                                    selected_url,
                                    private_mode,
                                },
                            );
                            Ok(())
                        }));
                    let mut token = 0i64;
                    core11.add_ContextMenuRequested(&handler, &mut token)?;
                    // ContextMenuRequested does not fire when this setting is false.
                    // The handler above always marks requests handled, so WebView2's
                    // own menu remains hidden while Nebula renders the visible UI.
                    core.Settings()?.SetAreDefaultContextMenusEnabled(true)?;
                    HANDLERS.with(|handlers| {
                        handlers.borrow_mut().insert(event_label.clone(), handler);
                    });
                    Ok(token)
                })();

                match result {
                    Ok(token) => {
                        if let Ok(mut tokens) = TOKENS.lock() {
                            tokens.insert(event_label.clone(), token);
                            if let Ok(mut configured) = CONFIGURED.lock() {
                                configured.insert(event_label.clone());
                            }
                        }
                    }
                    Err(_error) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[nebula context menu] {}: {}", event_label, _error);
                    }
                }
            })
            .map_err(|error| error.to_string())?;

        if CONFIGURED
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            Ok(())
        } else {
            Err(format!("failed to configure context menu for '{label}'"))
        }
    }

    pub fn respond(
        app: AppHandle,
        request_id: String,
        command_id: Option<i32>,
    ) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let app_for_response = app.clone();
        app.run_on_main_thread(move || {
            let result = PENDING.with(|pending| {
                let request = pending.borrow_mut().remove(&request_id).ok_or_else(|| {
                    format!("context menu request '{request_id}' is no longer pending")
                })?;
                let native_result = unsafe {
                    (|| -> windows_core::Result<()> {
                        if let Some(command_id) = command_id.filter(|value| *value >= 0) {
                            request.args.SetSelectedCommandId(command_id)?;
                        }
                        request.args.SetHandled(true)?;
                        request.deferral.Complete()?;
                        Ok(())
                    })()
                };
                native_result.map_err(|error| error.to_string())?;
                if command_id == Some(NEBULA_OPEN_SELECTION_COMMAND_ID) {
                    let uri = request
                        .selected_url
                        .ok_or("no selected web address in this menu")?;
                    let private_mode = request
                        .private_mode
                        .ok_or("opener profile is unavailable")?;
                    crate::site_ui::request_new_tab(
                        &app_for_response,
                        &request_id,
                        &request.tab_label,
                        uri,
                        private_mode,
                    )?;
                }
                Ok(())
            });
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;

        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| "timed out completing context menu request".to_string())?
    }

    pub fn cancel_for_tab(app: &AppHandle, label: &str) {
        let app = app.clone();
        let label = label.to_string();
        let _ = app.clone().run_on_main_thread(move || {
            let cancelled = PENDING.with(|pending| {
                let mut pending = pending.borrow_mut();
                let ids: Vec<String> = pending
                    .iter()
                    .filter(|(_, request)| request.tab_label == label)
                    .map(|(id, _)| id.clone())
                    .collect();
                let mut cancelled = Vec::new();
                for id in ids {
                    if let Some(request) = pending.remove(&id) {
                        complete_context_request(request);
                        cancelled.push(id);
                    }
                }
                cancelled
            });
            for id in cancelled {
                let _ = app.emit(
                    CONTEXT_MENU_CANCELLED_EVENT,
                    CancelledPayload {
                        id,
                        tab_label: label.clone(),
                    },
                );
            }
        });
    }

    pub fn teardown(app: &AppHandle, label: &str) {
        let token = TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));
        let handler_label = label.to_string();
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(move |inner| unsafe {
                if let (Ok(core), Some(token)) = (inner.controller().CoreWebView2(), token) {
                    if let Ok(core11) = core.cast::<ICoreWebView2_11>() {
                        let _ = core11.remove_ContextMenuRequested(token);
                    }
                }
                HANDLERS.with(|handlers| {
                    handlers.borrow_mut().remove(&handler_label);
                });
            });
        }
        if let Ok(mut configured) = CONFIGURED.lock() {
            configured.remove(label);
        }
        cancel_for_tab(app, label);
    }

    #[cfg(test)]
    mod tests {
        use super::{has_pending_capacity, selected_web_address};

        #[test]
        fn selected_addresses_accept_http_www_and_bare_domains() {
            for (selected, expected) in [
                (
                    " https://example.com/path?q=1#part ",
                    "https://example.com/path?q=1#part",
                ),
                ("HTTP://example.com", "http://example.com/"),
                ("www.example.com", "https://www.example.com/"),
                ("example.com:8443/path", "https://example.com:8443/path"),
                ("example.co.uk", "https://example.co.uk/"),
                ("bücher.de", "https://xn--bcher-kva.de/"),
                ("router.local", "http://router.local/"),
                ("http://192.168.1.1", "http://192.168.1.1/"),
            ] {
                assert_eq!(
                    selected_web_address(selected).as_deref(),
                    Some(expected),
                    "{selected}"
                );
            }
        }

        #[test]
        fn selected_addresses_reject_plain_text_email_and_unsafe_schemes() {
            for selected in [
                "",
                "hello world",
                "example",
                "example.com other.com",
                "example.com\nother.com",
                "hello@example.com",
                "https://user:password@example.com",
                "javascript:alert(1)",
                "data:text/html,hi",
                "file:///C:/test.html",
                "ftp://example.com",
                "/some/path",
                "C:\\test.html",
                "example..com",
                "-example.com",
                "example.com\\path",
                "https://example.com/\u{0000}",
            ] {
                assert!(selected_web_address(selected).is_none(), "{selected:?}");
            }
        }

        #[test]
        fn context_menu_queue_allows_only_one_pending_request_per_tab() {
            let labels = ["tab-a", "tab-b"];
            assert!(!has_pending_capacity(labels.into_iter(), "tab-a", 1));
            assert!(has_pending_capacity(labels.into_iter(), "tab-c", 1));
        }
    }

    #[cfg(all(test, feature = "extension-native-smoke"))]
    mod native_test {
        include!("context_menu_native_test.rs");
    }
    #[cfg(test)]
    mod native_tests {
        include!("context_menu_native_test.rs");
    }
}

#[cfg(target_os = "windows")]
pub use imp::{respond, setup, teardown};

#[cfg(not(target_os = "windows"))]
pub fn setup(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown(_app: &tauri::AppHandle, _label: &str) {}

#[cfg(not(target_os = "windows"))]
pub fn respond(
    _app: tauri::AppHandle,
    _request_id: String,
    _command_id: Option<i32>,
) -> Result<(), String> {
    Ok(())
}
