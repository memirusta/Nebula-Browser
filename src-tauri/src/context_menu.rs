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
        ICoreWebView2Deferral, ICoreWebView2_11, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND,
    };
    use windows::Win32::Foundation::POINT;
    use windows_core::{Interface, PWSTR};

    const CONTEXT_MENU_EVENT: &str = "nebula-site-context-menu";
    const CONTEXT_MENU_CANCELLED_EVENT: &str = "nebula-site-context-menu-cancelled";
    const NEBULA_PRINT_COMMAND_ID: i32 = -10_001;
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
            // The native "Inspect" command opens Edge DevTools. Nebula has its own
            // inspector, so never expose that Edge-branded entry in our menu.
            if payload.name == "inspect" {
                continue;
            }
            // Keep the visible Print entry, but route it through Nebula so the
            // system print dialog is used instead of Edge's browser preview.
            if payload.name == "print" {
                payload.command_id = NEBULA_PRINT_COMMAND_ID;
            }
            items.push(payload);
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
                                let items = collection_payload(&collection, 0)?;
                                let mut location = POINT::default();
                                let _ = args.Location(&mut location);
                                let scale = handler_app
                                    .get_window("main")
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
                                    selection_text: take_string(|value| {
                                        target.SelectionText(value)
                                    }),
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

                            enqueue_context_request(
                                &handler_app,
                                payload,
                                PendingContextMenu {
                                    tab_label: handler_label.clone(),
                                    args,
                                    deferral,
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
                    Err(error) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[nebula context menu] {}: {}", event_label, error);
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
                native_result.map_err(|error| error.to_string())
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
        use super::has_pending_capacity;

        #[test]
        fn context_menu_queue_allows_only_one_pending_request_per_tab() {
            let labels = ["tab-a", "tab-b"];
            assert!(!has_pending_capacity(labels.into_iter(), "tab-a", 1));
            assert!(has_pending_capacity(labels.into_iter(), "tab-c", 1));
        }
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
