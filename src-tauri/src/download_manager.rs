#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{LazyLock, Mutex};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2BytesReceivedChangedEventHandler, ICoreWebView2DownloadOperation,
        ICoreWebView2DownloadStartingEventHandler,
        ICoreWebView2IsDefaultDownloadDialogOpenChangedEventHandler,
        ICoreWebView2StateChangedEventHandler, ICoreWebView2_4, ICoreWebView2_9,
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON,
        COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED, COREWEBVIEW2_DOWNLOAD_STATE,
        COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED, COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED,
    };
    use webview2_com::{
        BytesReceivedChangedEventHandler, DownloadStartingEventHandler,
        IsDefaultDownloadDialogOpenChangedEventHandler, StateChangedEventHandler,
    };
    use windows::core::{PCWSTR, PWSTR};
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::ShellExecuteW;
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows_core::{Interface, BOOL};

    const DOWNLOAD_EVENT: &str = "nebula-download-updated";
    const MAX_FINISHED_DOWNLOADS: usize = 200;
    type StartHandlerTokens = (i64, Option<i64>);
    type StartHandlers = (
        ICoreWebView2DownloadStartingEventHandler,
        Option<ICoreWebView2IsDefaultDownloadDialogOpenChangedEventHandler>,
    );

    static NEXT_DOWNLOAD_ID: AtomicU64 = AtomicU64::new(1);
    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static START_HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, StartHandlerTokens>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static PAUSED_DOWNLOADS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static LAST_PROGRESS_EMITS: LazyLock<Mutex<HashMap<String, Instant>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    thread_local! {
        static START_HANDLERS: RefCell<HashMap<String, StartHandlers>> =
            RefCell::new(HashMap::new());
        static DOWNLOADS: RefCell<HashMap<String, DownloadRegistration>> =
            RefCell::new(HashMap::new());
        static FINISHED_DOWNLOADS: RefCell<HashMap<String, FinishedDownload>> =
            RefCell::new(HashMap::new());
    }

    struct DownloadRegistration {
        operation: ICoreWebView2DownloadOperation,
        _bytes_handler: ICoreWebView2BytesReceivedChangedEventHandler,
        _state_handler: ICoreWebView2StateChangedEventHandler,
        bytes_token: i64,
        state_token: i64,
        label: String,
        started_at_ms: u64,
    }

    #[derive(Clone)]
    struct FinishedDownload {
        file_path: String,
        completed_at_ms: u64,
    }

    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct DownloadPayload {
        id: String,
        tab_label: String,
        source_url: String,
        file_name: String,
        file_path: String,
        mime_type: String,
        total_bytes: i64,
        received_bytes: i64,
        state: String,
        interrupt_reason: i32,
        can_resume: bool,
        paused: bool,
        started_at_ms: u64,
    }

    unsafe fn take_webview_string(
        read: impl FnOnce(*mut PWSTR) -> windows_core::Result<()>,
    ) -> String {
        let mut value = PWSTR::null();
        let text = if read(&mut value).is_ok() {
            value.to_string().unwrap_or_default()
        } else {
            String::new()
        };
        if !value.is_null() {
            CoTaskMemFree(Some(value.as_ptr().cast()));
        }
        text
    }

    fn started_at_ms() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .min(u128::from(u64::MAX)) as u64
    }

    fn file_name_from_path(path: &str, source_url: &str) -> String {
        Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
            .or_else(|| {
                url::Url::parse(source_url)
                    .ok()
                    .and_then(|url| url.path_segments()?.next_back().map(str::to_owned))
                    .filter(|name| !name.is_empty())
            })
            .unwrap_or_else(|| "download".to_string())
    }

    fn read_payload(
        id: &str,
        label: &str,
        operation: &ICoreWebView2DownloadOperation,
        started_at_ms: u64,
    ) -> DownloadPayload {
        unsafe {
            let source_url = take_webview_string(|value| operation.Uri(value));
            let file_path = take_webview_string(|value| operation.ResultFilePath(value));
            let mime_type = take_webview_string(|value| operation.MimeType(value));
            let mut total_bytes = -1i64;
            let mut received_bytes = 0i64;
            let mut download_state = COREWEBVIEW2_DOWNLOAD_STATE::default();
            let mut interrupt_reason = COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON::default();
            let mut can_resume = BOOL::default();
            let _ = operation.TotalBytesToReceive(&mut total_bytes);
            let _ = operation.BytesReceived(&mut received_bytes);
            let _ = operation.State(&mut download_state);
            let _ = operation.InterruptReason(&mut interrupt_reason);
            let _ = operation.CanResume(&mut can_resume);

            let paused = PAUSED_DOWNLOADS
                .lock()
                .map(|paused| paused.contains(id))
                .unwrap_or(false);
            let state = if download_state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
                "completed"
            } else if download_state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED {
                if interrupt_reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED {
                    "cancelled"
                } else {
                    "interrupted"
                }
            } else if paused {
                "paused"
            } else {
                "in_progress"
            };

            DownloadPayload {
                id: id.to_string(),
                tab_label: label.to_string(),
                file_name: file_name_from_path(&file_path, &source_url),
                source_url,
                file_path,
                mime_type,
                total_bytes,
                received_bytes,
                state: state.to_string(),
                interrupt_reason: interrupt_reason.0,
                can_resume: can_resume.as_bool(),
                paused,
                started_at_ms,
            }
        }
    }

    fn emit_download(
        app: &AppHandle,
        id: &str,
        label: &str,
        operation: &ICoreWebView2DownloadOperation,
        started_at_ms: u64,
    ) -> DownloadPayload {
        let payload = read_payload(id, label, operation, started_at_ms);
        if matches!(
            payload.state.as_str(),
            "completed" | "interrupted" | "cancelled"
        ) {
            if let Ok(mut paused) = PAUSED_DOWNLOADS.lock() {
                paused.remove(id);
            }
        }
        let _ = app.emit(DOWNLOAD_EVENT, payload.clone());
        payload
    }

    fn is_terminal(payload: &DownloadPayload) -> bool {
        matches!(
            payload.state.as_str(),
            "completed" | "interrupted" | "cancelled"
        )
    }

    fn remember_finished_download(id: &str, payload: &DownloadPayload) {
        if payload.state != "completed" || payload.file_path.is_empty() {
            return;
        }

        FINISHED_DOWNLOADS.with(|finished| {
            let mut finished = finished.borrow_mut();
            finished.insert(
                id.to_string(),
                FinishedDownload {
                    file_path: payload.file_path.clone(),
                    completed_at_ms: started_at_ms(),
                },
            );

            while finished.len() > MAX_FINISHED_DOWNLOADS {
                let oldest = finished
                    .iter()
                    .min_by_key(|(_, item)| item.completed_at_ms)
                    .map(|(id, _)| id.clone());
                let Some(oldest) = oldest else { break };
                finished.remove(&oldest);
            }
        });
    }

    fn finalize_download(id: &str, payload: &DownloadPayload) {
        remember_finished_download(id, payload);

        let registration = DOWNLOADS.with(|downloads| downloads.borrow_mut().remove(id));
        if let Some(registration) = registration {
            unsafe {
                let _ = registration
                    .operation
                    .remove_BytesReceivedChanged(registration.bytes_token);
                let _ = registration
                    .operation
                    .remove_StateChanged(registration.state_token);
            }
        }

        if let Ok(mut paused) = PAUSED_DOWNLOADS.lock() {
            paused.remove(id);
        }
        if let Ok(mut emits) = LAST_PROGRESS_EMITS.lock() {
            emits.remove(id);
        }
    }

    fn should_emit_progress(id: &str) -> bool {
        let Ok(mut last_emits) = LAST_PROGRESS_EMITS.lock() else {
            return true;
        };
        let now = Instant::now();
        if last_emits
            .get(id)
            .is_some_and(|last| now.duration_since(*last) < Duration::from_millis(120))
        {
            return false;
        }
        last_emits.insert(id.to_string(), now);
        true
    }

    pub fn setup_tab_downloads(app: &AppHandle, label: &str) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") {
            return Ok(());
        }
        if CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            return Ok(());
        }

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let app_handle = app.clone();
        let download_label = label.to_string();
        let label_for_store = label.to_string();

        webview
            .with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };
                let Ok(core4) = core.cast::<ICoreWebView2_4>() else {
                    return;
                };

                // Some WebView2 runtime builds briefly open their own download
                // bubble even when DownloadStarting.Handled is set. Close that
                // native surface whenever its state changes so Nebula remains
                // the only download UI.
                let dialog_registration = core.cast::<ICoreWebView2_9>().ok().and_then(|core9| {
                    let dialog_handler = IsDefaultDownloadDialogOpenChangedEventHandler::create(
                        Box::new(move |sender, _args| {
                            if let Some(core) = sender {
                                if let Ok(core9) = core.cast::<ICoreWebView2_9>() {
                                    let mut open = BOOL::default();
                                    if core9.IsDefaultDownloadDialogOpen(&mut open).is_ok()
                                        && open.as_bool()
                                    {
                                        let _ = core9.CloseDefaultDownloadDialog();
                                    }
                                }
                            }
                            Ok(())
                        }),
                    );
                    let mut dialog_token = 0i64;
                    if core9
                        .add_IsDefaultDownloadDialogOpenChanged(&dialog_handler, &mut dialog_token)
                        .is_ok()
                    {
                        Some((dialog_token, dialog_handler))
                    } else {
                        None
                    }
                });

                let handler =
                    DownloadStartingEventHandler::create(Box::new(move |sender, args| {
                        let Some(args) = args else {
                            return Ok(());
                        };

                        // Set this before reading any optional metadata. If a
                        // runtime cannot provide DownloadOperation, its default
                        // bubble must still remain hidden.
                        let _ = args.SetHandled(true);
                        if let Some(core) = sender {
                            if let Ok(core9) = core.cast::<ICoreWebView2_9>() {
                                let _ = core9.CloseDefaultDownloadDialog();
                            }
                        }
                        let Ok(operation) = args.DownloadOperation() else {
                            return Ok(());
                        };

                        // Keep WebView2's secure, session-aware download pipeline, but
                        // replace its default UI with Nebula's own session manager.
                        let id = format!(
                            "download-{}",
                            NEXT_DOWNLOAD_ID.fetch_add(1, Ordering::Relaxed)
                        );
                        let download_started_at = started_at_ms();

                        let bytes_app = app_handle.clone();
                        let bytes_id = id.clone();
                        let bytes_label = download_label.clone();
                        let bytes_handler = BytesReceivedChangedEventHandler::create(Box::new(
                            move |sender, _args| {
                                if let Some(operation) = sender {
                                    if should_emit_progress(&bytes_id) {
                                        emit_download(
                                            &bytes_app,
                                            &bytes_id,
                                            &bytes_label,
                                            &operation,
                                            download_started_at,
                                        );
                                    }
                                }
                                Ok(())
                            },
                        ));

                        let state_app = app_handle.clone();
                        let state_id = id.clone();
                        let state_label = download_label.clone();
                        let state_handler =
                            StateChangedEventHandler::create(Box::new(move |sender, _args| {
                                if let Some(operation) = sender {
                                    let payload = emit_download(
                                        &state_app,
                                        &state_id,
                                        &state_label,
                                        &operation,
                                        download_started_at,
                                    );
                                    if is_terminal(&payload) {
                                        finalize_download(&state_id, &payload);
                                    }
                                }
                                Ok(())
                            }));

                        let mut bytes_token = 0i64;
                        let mut state_token = 0i64;
                        if operation
                            .add_BytesReceivedChanged(&bytes_handler, &mut bytes_token)
                            .is_err()
                        {
                            return Ok(());
                        }
                        if operation
                            .add_StateChanged(&state_handler, &mut state_token)
                            .is_err()
                        {
                            let _ = operation.remove_BytesReceivedChanged(bytes_token);
                            return Ok(());
                        }

                        let operation_for_emit = operation.clone();
                        DOWNLOADS.with(|downloads| {
                            downloads.borrow_mut().insert(
                                id.clone(),
                                DownloadRegistration {
                                    operation,
                                    _bytes_handler: bytes_handler,
                                    _state_handler: state_handler,
                                    bytes_token,
                                    state_token,
                                    label: download_label.clone(),
                                    started_at_ms: download_started_at,
                                },
                            );
                        });

                        let payload = emit_download(
                            &app_handle,
                            &id,
                            &download_label,
                            &operation_for_emit,
                            download_started_at,
                        );
                        if is_terminal(&payload) {
                            finalize_download(&id, &payload);
                        }
                        Ok(())
                    }));

                let mut token = 0i64;
                if core4.add_DownloadStarting(&handler, &mut token).is_err() {
                    if let Some((dialog_token, _handler)) = &dialog_registration {
                        if let Ok(core9) = core.cast::<ICoreWebView2_9>() {
                            let _ = core9.remove_IsDefaultDownloadDialogOpenChanged(*dialog_token);
                        }
                    }
                    return;
                }
                if let Ok(mut tokens) = START_HANDLER_TOKENS.lock() {
                    tokens.insert(
                        label_for_store.clone(),
                        (
                            token,
                            dialog_registration.as_ref().map(|(token, _handler)| *token),
                        ),
                    );
                }
                START_HANDLERS.with(|handlers| {
                    handlers.borrow_mut().insert(
                        label_for_store.clone(),
                        (
                            handler,
                            dialog_registration.map(|(_token, handler)| handler),
                        ),
                    );
                });
            })
            .map_err(|error| error.to_string())?;

        if !START_HANDLER_TOKENS
            .lock()
            .map_err(|error| error.to_string())?
            .contains_key(label)
        {
            return Err(format!("failed to register downloads for '{label}'"));
        }
        CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string());
        Ok(())
    }

    pub fn teardown_tab_downloads(app: &AppHandle, label: &str) {
        let token = START_HANDLER_TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));
        let label_for_handler = label.to_string();

        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(move |inner| unsafe {
                if let (Ok(core), Some((download_token, dialog_token))) =
                    (inner.controller().CoreWebView2(), token)
                {
                    if let Ok(core4) = core.cast::<ICoreWebView2_4>() {
                        let _ = core4.remove_DownloadStarting(download_token);
                    }
                    if let (Ok(core9), Some(dialog_token)) =
                        (core.cast::<ICoreWebView2_9>(), dialog_token)
                    {
                        let _ = core9.remove_IsDefaultDownloadDialogOpenChanged(dialog_token);
                    }
                }
                START_HANDLERS.with(|handlers| {
                    handlers.borrow_mut().remove(&label_for_handler);
                });
            });
        }
        if let Ok(mut configured) = CONFIGURED_LABELS.lock() {
            configured.remove(label);
        }
    }

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(Some(0)).collect()
    }

    unsafe fn shell_open(file: &str, parameters: Option<&str>) -> Result<(), String> {
        let verb = wide("open");
        let file = wide(file);
        let parameters = parameters.map(wide);
        let result = ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file.as_ptr()),
            parameters
                .as_ref()
                .map_or(PCWSTR::null(), |value| PCWSTR(value.as_ptr())),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        );
        if result.0 as isize <= 32 {
            return Err("Windows could not open the download".to_string());
        }
        Ok(())
    }

    fn finished_download_path(id: &str) -> Option<String> {
        FINISHED_DOWNLOADS
            .with(|finished| finished.borrow().get(id).map(|item| item.file_path.clone()))
    }

    pub fn control_download(app: AppHandle, id: String, action: String) -> Result<(), String> {
        if !matches!(
            action.as_str(),
            "pause" | "resume" | "cancel" | "open" | "reveal"
        ) {
            return Err(format!("unsupported download action '{action}'"));
        }

        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let app_for_main = app.clone();
        app.run_on_main_thread(move || {
            let result = (|| -> Result<(), String> {
                let active = DOWNLOADS.with(|downloads| {
                    downloads.borrow().get(&id).map(|registration| {
                        (
                            registration.operation.clone(),
                            registration.label.clone(),
                            registration.started_at_ms,
                        )
                    })
                });

                match action.as_str() {
                    "pause" | "resume" | "cancel" => {
                        let (operation, label, download_started_at) =
                            active.ok_or_else(|| format!("active download '{id}' not found"))?;

                        match action.as_str() {
                            "pause" => unsafe {
                                operation.Pause().map_err(|error| error.to_string())?;
                                PAUSED_DOWNLOADS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .insert(id.clone());
                            },
                            "resume" => unsafe {
                                operation.Resume().map_err(|error| error.to_string())?;
                                PAUSED_DOWNLOADS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .remove(&id);
                            },
                            "cancel" => unsafe {
                                operation.Cancel().map_err(|error| error.to_string())?;
                                PAUSED_DOWNLOADS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .remove(&id);
                            },
                            _ => unreachable!(),
                        }

                        let payload = emit_download(
                            &app_for_main,
                            &id,
                            &label,
                            &operation,
                            download_started_at,
                        );
                        if is_terminal(&payload) {
                            finalize_download(&id, &payload);
                        }
                    }
                    "open" | "reveal" => {
                        let path = if let Some((operation, _, _)) = active {
                            unsafe { take_webview_string(|value| operation.ResultFilePath(value)) }
                        } else {
                            finished_download_path(&id).unwrap_or_default()
                        };

                        if path.is_empty() || !Path::new(&path).exists() {
                            return Err("downloaded file no longer exists".to_string());
                        }
                        unsafe {
                            if action == "open" {
                                shell_open(&path, None)?;
                            } else {
                                let parameters = format!("/select,\"{path}\"");
                                shell_open("explorer.exe", Some(&parameters))?;
                            }
                        }
                    }
                    _ => unreachable!(),
                }

                Ok(())
            })();
            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;

        rx.recv_timeout(Duration::from_secs(2))
            .map_err(|_| "timed out controlling download".to_string())?
    }
}

#[cfg(target_os = "windows")]
pub use imp::{control_download, setup_tab_downloads, teardown_tab_downloads};

#[cfg(not(target_os = "windows"))]
pub fn setup_tab_downloads(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_tab_downloads(_app: &tauri::AppHandle, _label: &str) {}

#[cfg(not(target_os = "windows"))]
pub fn control_download(
    _app: tauri::AppHandle,
    _id: String,
    _action: String,
) -> Result<(), String> {
    Err("downloads are currently supported on Windows".to_string())
}
