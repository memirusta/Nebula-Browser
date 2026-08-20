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
    use windows::Win32::Security::WinTrust::{
        WinVerifyTrust, WINTRUST_ACTION_GENERIC_VERIFY_V2, WINTRUST_DATA, WINTRUST_DATA_0,
        WINTRUST_FILE_INFO, WTD_CACHE_ONLY_URL_RETRIEVAL, WTD_CHOICE_FILE,
        WTD_REVOCATION_CHECK_NONE, WTD_REVOKE_NONE, WTD_STATEACTION_IGNORE, WTD_UI_NONE,
    };
    use windows::Win32::System::Com::{CoTaskMemFree, IBindCtx, IDataObject};
    use windows::Win32::System::Ole::{IDropSource, DROPEFFECT_COPY};
    use windows::Win32::UI::Shell::{
        BHID_DataObject, IShellItem, SHCreateItemFromParsingName, SHDoDragDrop, ShellExecuteW,
    };
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
    static DOWNLOAD_WARNINGS: LazyLock<Mutex<HashMap<String, String>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static RISKY_DOWNLOADS: LazyLock<Mutex<HashMap<String, String>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static SIGNATURE_CHECKS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static LAST_PROGRESS_EMITS: LazyLock<Mutex<HashMap<String, Instant>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static COMPLETION_FALLBACKS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static SYNTHETIC_COMPLETIONS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static RECENT_DOWNLOADS: LazyLock<Mutex<HashMap<String, Instant>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    thread_local! {
        static START_HANDLERS: RefCell<HashMap<String, StartHandlers>> =
            RefCell::new(HashMap::new());
        static DOWNLOADS: RefCell<HashMap<String, DownloadRegistration>> =
            RefCell::new(HashMap::new());
        static FINISHED_DOWNLOADS: RefCell<HashMap<String, FinishedDownload>> =
            RefCell::new(HashMap::new());
        static FAILED_DOWNLOADS: RefCell<HashMap<String, FailedDownload>> =
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

    #[derive(Clone)]
    struct FailedDownload {
        source_url: String,
        label: String,
        failed_at_ms: u64,
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
        danger_reason: Option<String>,
        requires_confirmation: bool,
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

    fn dangerous_file_reason(file_name: &str) -> Option<&'static str> {
        const DANGEROUS_EXTENSIONS: &[&str] = &[
            "appref-ms",
            "appx",
            "appxbundle",
            "application",
            "bat",
            "chm",
            "cmd",
            "com",
            "cpl",
            "dll",
            "exe",
            "hta",
            "inf",
            "ins",
            "iso",
            "jar",
            "js",
            "jse",
            "lnk",
            "msi",
            "msix",
            "msixbundle",
            "msp",
            "pif",
            "ps1",
            "ps1xml",
            "reg",
            "scr",
            "sct",
            "sys",
            "vbe",
            "vbs",
            "wsf",
            "wsh",
        ];
        let extension = Path::new(file_name)
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase);
        if extension
            .as_deref()
            .is_some_and(|extension| DANGEROUS_EXTENSIONS.contains(&extension))
        {
            Some("dangerous_file_type")
        } else {
            None
        }
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
            let danger_reason = DOWNLOAD_WARNINGS
                .lock()
                .ok()
                .and_then(|warnings| warnings.get(id).cloned());
            let synthetic_completion = SYNTHETIC_COMPLETIONS
                .lock()
                .map(|completed| completed.contains(id))
                .unwrap_or(false);
            let state = if download_state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED
                || synthetic_completion
            {
                "completed"
            } else if paused {
                "paused"
            } else if download_state == COREWEBVIEW2_DOWNLOAD_STATE_INTERRUPTED {
                if interrupt_reason == COREWEBVIEW2_DOWNLOAD_INTERRUPT_REASON_USER_CANCELED {
                    "cancelled"
                } else {
                    "interrupted"
                }
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
                requires_confirmation: danger_reason.is_some(),
                danger_reason,
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
        if !payload.requires_confirmation
            && matches!(
                payload.state.as_str(),
                "completed" | "interrupted" | "cancelled"
            )
        {
            if let Ok(mut paused) = PAUSED_DOWNLOADS.lock() {
                paused.remove(id);
            }
        }
        let _ = app.emit(DOWNLOAD_EVENT, payload.clone());
        payload
    }

    fn is_terminal(payload: &DownloadPayload) -> bool {
        !payload.requires_confirmation
            && (matches!(payload.state.as_str(), "completed" | "cancelled")
                || (payload.state == "interrupted" && !payload.can_resume))
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

    fn remember_failed_download(id: &str, payload: &DownloadPayload) {
        if payload.state != "interrupted" || payload.source_url.is_empty() {
            return;
        }

        FAILED_DOWNLOADS.with(|failed| {
            let mut failed = failed.borrow_mut();
            failed.insert(
                id.to_string(),
                FailedDownload {
                    source_url: payload.source_url.clone(),
                    label: payload.tab_label.clone(),
                    failed_at_ms: started_at_ms(),
                },
            );

            while failed.len() > MAX_FINISHED_DOWNLOADS {
                let oldest = failed
                    .iter()
                    .min_by_key(|(_, item)| item.failed_at_ms)
                    .map(|(id, _)| id.clone());
                let Some(oldest) = oldest else { break };
                failed.remove(&oldest);
            }
        });
    }

    fn finalize_download(id: &str, payload: &DownloadPayload) {
        remember_finished_download(id, payload);
        remember_failed_download(id, payload);

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
        if let Ok(mut warnings) = DOWNLOAD_WARNINGS.lock() {
            warnings.remove(id);
        }
        if let Ok(mut risky) = RISKY_DOWNLOADS.lock() {
            risky.remove(id);
        }
        if let Ok(mut checks) = SIGNATURE_CHECKS.lock() {
            checks.remove(id);
        }
        if let Ok(mut emits) = LAST_PROGRESS_EMITS.lock() {
            emits.remove(id);
        }
        if let Ok(mut fallbacks) = COMPLETION_FALLBACKS.lock() {
            fallbacks.remove(id);
        }
        if let Ok(mut completions) = SYNTHETIC_COMPLETIONS.lock() {
            completions.remove(id);
        }
    }

    fn has_trusted_authenticode_signature(file_path: &str) -> bool {
        let file_path = wide(file_path);
        let mut file_info = WINTRUST_FILE_INFO {
            cbStruct: std::mem::size_of::<WINTRUST_FILE_INFO>() as u32,
            pcwszFilePath: PCWSTR(file_path.as_ptr()),
            ..Default::default()
        };
        let mut trust_data = WINTRUST_DATA {
            cbStruct: std::mem::size_of::<WINTRUST_DATA>() as u32,
            dwUIChoice: WTD_UI_NONE,
            fdwRevocationChecks: WTD_REVOKE_NONE,
            dwUnionChoice: WTD_CHOICE_FILE,
            Anonymous: WINTRUST_DATA_0 {
                pFile: &mut file_info,
            },
            dwStateAction: WTD_STATEACTION_IGNORE,
            dwProvFlags: WTD_CACHE_ONLY_URL_RETRIEVAL | WTD_REVOCATION_CHECK_NONE,
            ..Default::default()
        };
        let mut action = WINTRUST_ACTION_GENERIC_VERIFY_V2;

        unsafe {
            WinVerifyTrust(
                windows::Win32::Foundation::HWND::default(),
                &mut action,
                (&mut trust_data as *mut WINTRUST_DATA).cast(),
            ) == 0
        }
    }

    fn maybe_schedule_signature_check(
        app: &AppHandle,
        id: &str,
        operation: &ICoreWebView2DownloadOperation,
    ) -> bool {
        if DOWNLOAD_WARNINGS
            .lock()
            .map(|warnings| warnings.contains_key(id))
            .unwrap_or(false)
        {
            return true;
        }

        let reason = RISKY_DOWNLOADS
            .lock()
            .ok()
            .and_then(|risky| risky.get(id).cloned());
        let Some(reason) = reason else {
            return false;
        };

        let synthetic_completion = SYNTHETIC_COMPLETIONS
            .lock()
            .map(|completed| completed.contains(id))
            .unwrap_or(false);
        let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
        if unsafe { operation.State(&mut state) }.is_err()
            || (state != COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED && !synthetic_completion)
        {
            return false;
        }

        let should_start = SIGNATURE_CHECKS
            .lock()
            .map(|mut checks| checks.insert(id.to_string()))
            .unwrap_or(false);
        if !should_start {
            return true;
        }

        let file_path = unsafe { take_webview_string(|value| operation.ResultFilePath(value)) };
        let app = app.clone();
        let id = id.to_string();
        std::thread::spawn(move || {
            let trusted = has_trusted_authenticode_signature(&file_path);
            let app_for_main = app.clone();
            let id_for_main = id.clone();
            if app
                .run_on_main_thread(move || {
                    if let Ok(mut checks) = SIGNATURE_CHECKS.lock() {
                        checks.remove(&id_for_main);
                    }
                    if !trusted {
                        if let Ok(mut warnings) = DOWNLOAD_WARNINGS.lock() {
                            warnings.insert(id_for_main.clone(), reason);
                        }
                    }

                    let active = DOWNLOADS.with(|downloads| {
                        downloads.borrow().get(&id_for_main).map(|registration| {
                            (
                                registration.operation.clone(),
                                registration.label.clone(),
                                registration.started_at_ms,
                            )
                        })
                    });
                    let Some((operation, label, download_started_at)) = active else {
                        return;
                    };
                    let payload = emit_download(
                        &app_for_main,
                        &id_for_main,
                        &label,
                        &operation,
                        download_started_at,
                    );
                    if is_terminal(&payload) {
                        finalize_download(&id_for_main, &payload);
                    }
                })
                .is_err()
            {
                if let Ok(mut checks) = SIGNATURE_CHECKS.lock() {
                    checks.remove(&id);
                }
            }
        });
        true
    }

    pub(crate) fn has_recent_or_active_download_for_label(label: &str) -> bool {
        let recent = RECENT_DOWNLOADS
            .lock()
            .map(|downloads| {
                downloads
                    .get(label)
                    .is_some_and(|started| started.elapsed() <= Duration::from_secs(5))
            })
            .unwrap_or(false);

        if recent {
            return true;
        }

        DOWNLOADS.with(|downloads| {
            downloads
                .borrow()
                .values()
                .any(|registration| registration.label == label)
        })
    }

    fn schedule_completion_fallback(
        app: AppHandle,
        id: String,
        file_path: String,
        expected_size: i64,
    ) {
        if expected_size <= 0 || file_path.is_empty() {
            return;
        }

        let should_schedule = COMPLETION_FALLBACKS
            .lock()
            .map(|mut pending| pending.insert(id.clone()))
            .unwrap_or(false);

        if !should_schedule {
            return;
        }

        std::thread::spawn(move || {
            let expected_size = expected_size as u64;
            let mut file_ready = false;

            // Give WebView2 up to five seconds to expose the final file.
            for _ in 0..20 {
                std::thread::sleep(Duration::from_millis(250));

                file_ready = std::fs::metadata(&file_path)
                    .map(|metadata| metadata.len() >= expected_size)
                    .unwrap_or(false);

                if file_ready {
                    break;
                }
            }

            if !file_ready {
                if let Ok(mut pending) = COMPLETION_FALLBACKS.lock() {
                    pending.remove(&id);
                }
                return;
            }

            let app_for_main = app.clone();
            let id_for_main = id.clone();

            if app
                .run_on_main_thread(move || {
                    let active = DOWNLOADS.with(|downloads| {
                        downloads.borrow().get(&id_for_main).map(|registration| {
                            (
                                registration.operation.clone(),
                                registration.label.clone(),
                                registration.started_at_ms,
                            )
                        })
                    });

                    let Some((operation, label, download_started_at)) = active else {
                        if let Ok(mut pending) = COMPLETION_FALLBACKS.lock() {
                            pending.remove(&id_for_main);
                        }
                        return;
                    };

                    let mut payload =
                        read_payload(&id_for_main, &label, &operation, download_started_at);

                    if maybe_schedule_signature_check(&app_for_main, &id_for_main, &operation) {
                        return;
                    }

                    if is_terminal(&payload) {
                        let _ = app_for_main.emit(DOWNLOAD_EVENT, payload.clone());
                        finalize_download(&id_for_main, &payload);
                        return;
                    }

                    let target_is_complete = payload.total_bytes > 0
                        && payload.received_bytes >= payload.total_bytes
                        && payload.interrupt_reason == 0
                        && !payload.paused
                        && !payload.file_path.is_empty()
                        && std::fs::metadata(&payload.file_path)
                            .map(|metadata| metadata.len() >= payload.total_bytes as u64)
                            .unwrap_or(false);

                    if target_is_complete {
                        // Some WebView2 runtimes can finish the file without
                        // delivering the final StateChanged/Completed event.
                        // Only fall back when both WebView2's byte counters and
                        // the final on-disk file agree that the transfer is done.
                        if let Ok(mut completions) = SYNTHETIC_COMPLETIONS.lock() {
                            completions.insert(id_for_main.clone());
                        }
                        if maybe_schedule_signature_check(&app_for_main, &id_for_main, &operation) {
                            return;
                        }

                        payload.state = "completed".to_string();
                        payload.can_resume = false;

                        let _ = app_for_main.emit(DOWNLOAD_EVENT, payload.clone());
                        finalize_download(&id_for_main, &payload);
                    } else if let Ok(mut pending) = COMPLETION_FALLBACKS.lock() {
                        pending.remove(&id_for_main);
                    }
                })
                .is_err()
            {
                if let Ok(mut pending) = COMPLETION_FALLBACKS.lock() {
                    pending.remove(&id);
                }
            }
        });
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

    fn remove_partial_download_when_released(file_path: String) {
        if file_path.is_empty() {
            return;
        }

        std::thread::spawn(move || {
            for _ in 0..20 {
                match std::fs::remove_file(&file_path) {
                    Ok(()) => return,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
                    Err(_) => std::thread::sleep(Duration::from_millis(100)),
                }
            }
        });
    }

    pub fn setup_tab_downloads(app: &AppHandle, label: &str) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") && !label.starts_with("nebula-popup-content-") {
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

                        if let Ok(mut recent) = RECENT_DOWNLOADS.lock() {
                            recent.insert(download_label.clone(), Instant::now());
                        }

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
                                    let payload = read_payload(
                                        &bytes_id,
                                        &bytes_label,
                                        &operation,
                                        download_started_at,
                                    );

                                    if should_emit_progress(&bytes_id) {
                                        let _ = bytes_app.emit(DOWNLOAD_EVENT, payload.clone());
                                    }

                                    if payload.state == "in_progress"
                                        && payload.total_bytes > 0
                                        && payload.received_bytes >= payload.total_bytes
                                    {
                                        schedule_completion_fallback(
                                            bytes_app.clone(),
                                            bytes_id.clone(),
                                            payload.file_path.clone(),
                                            payload.total_bytes,
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
                                    if maybe_schedule_signature_check(
                                        &state_app, &state_id, &operation,
                                    ) {
                                        return Ok(());
                                    }
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
                        let initial_payload = read_payload(
                            &id,
                            &download_label,
                            &operation_for_emit,
                            download_started_at,
                        );
                        if let Some(reason) = dangerous_file_reason(&initial_payload.file_name) {
                            if let Ok(mut risky) = RISKY_DOWNLOADS.lock() {
                                risky.insert(id.clone(), reason.to_string());
                            }
                        }
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

                        if maybe_schedule_signature_check(&app_handle, &id, &operation_for_emit) {
                            return Ok(());
                        }

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
        if let Ok(mut recent) = RECENT_DOWNLOADS.lock() {
            recent.remove(label);
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

    unsafe fn start_shell_file_drag(
        hwnd: windows::Win32::Foundation::HWND,
        file_path: &str,
    ) -> Result<(), String> {
        let file_path = wide(file_path);
        let shell_item: IShellItem =
            SHCreateItemFromParsingName(PCWSTR(file_path.as_ptr()), None::<&IBindCtx>)
                .map_err(|error| error.to_string())?;

        let data_object: IDataObject = shell_item
            .BindToHandler(None::<&IBindCtx>, &BHID_DataObject)
            .map_err(|error| error.to_string())?;

        SHDoDragDrop(
            Some(hwnd),
            &data_object,
            None::<&IDropSource>,
            DROPEFFECT_COPY,
        )
        .map_err(|error| error.to_string())?;

        Ok(())
    }

    pub fn start_download_drag(app: AppHandle, id: String) -> Result<(), String> {
        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let app_for_main = app.clone();

        app.run_on_main_thread(move || {
            let result = (|| -> Result<(), String> {
                let path = finished_download_path(&id)
                    .ok_or_else(|| format!("completed download '{id}' not found"))?;
                let metadata = std::fs::metadata(&path)
                    .map_err(|_| "downloaded file no longer exists".to_string())?;
                if !metadata.is_file() {
                    return Err("downloaded path is not a file".to_string());
                }

                let window = app_for_main
                    .get_window("main")
                    .ok_or_else(|| "main window not found".to_string())?;
                let hwnd = window.hwnd().map_err(|error| error.to_string())?;

                unsafe { start_shell_file_drag(hwnd, &path) }
            })();

            let _ = tx.send(result);
        })
        .map_err(|error| error.to_string())?;

        rx.recv()
            .map_err(|_| "native download drag ended unexpectedly".to_string())?
    }

    pub fn control_download(app: AppHandle, id: String, action: String) -> Result<(), String> {
        if !matches!(
            action.as_str(),
            "pause" | "resume" | "cancel" | "retry" | "keep" | "delete" | "open" | "reveal"
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
                    "pause" | "resume" | "cancel" | "keep" | "delete" => {
                        let (operation, label, download_started_at) =
                            active.ok_or_else(|| format!("active download '{id}' not found"))?;

                        let should_emit_immediately = match action.as_str() {
                            "pause" => unsafe {
                                PAUSED_DOWNLOADS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .insert(id.clone());

                                if let Err(error) = operation.Pause() {
                                    if let Ok(mut paused) = PAUSED_DOWNLOADS.lock() {
                                        paused.remove(&id);
                                    }

                                    return Err(error.to_string());
                                }
                                true
                            },
                            "resume" => unsafe {
                                if DOWNLOAD_WARNINGS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .contains_key(&id)
                                {
                                    return Err(
                                        "confirm this potentially unsafe download before resuming"
                                            .to_string(),
                                    );
                                }
                                PAUSED_DOWNLOADS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .remove(&id);
                                if let Err(error) = operation.Resume() {
                                    if let Ok(mut paused) = PAUSED_DOWNLOADS.lock() {
                                        paused.insert(id.clone());
                                    }
                                    return Err(error.to_string());
                                }
                                false
                            },
                            "cancel" => unsafe {
                                operation.Cancel().map_err(|error| error.to_string())?;
                                PAUSED_DOWNLOADS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .remove(&id);
                                DOWNLOAD_WARNINGS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .remove(&id);

                                // WebView2 may stop the transfer before its
                                // StateChanged notification becomes observable.
                                // Publish the user's successful cancellation as
                                // the authoritative state so the shell cannot
                                // retain a stale in-progress percentage.
                                let mut payload =
                                    read_payload(&id, &label, &operation, download_started_at);
                                payload.state = "cancelled".to_string();
                                payload.can_resume = false;
                                payload.paused = false;
                                payload.requires_confirmation = false;
                                payload.danger_reason = None;
                                let _ = app_for_main.emit(DOWNLOAD_EVENT, payload.clone());
                                finalize_download(&id, &payload);
                                return Ok(());
                            },
                            "keep" => {
                                DOWNLOAD_WARNINGS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .remove(&id)
                                    .ok_or_else(|| {
                                        format!("download '{id}' is not waiting for confirmation")
                                    })?;
                                PAUSED_DOWNLOADS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .remove(&id);
                                true
                            }
                            "delete" => unsafe {
                                let downloaded_file =
                                    take_webview_string(|value| operation.ResultFilePath(value));
                                DOWNLOAD_WARNINGS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .remove(&id)
                                    .ok_or_else(|| {
                                        format!("download '{id}' is not waiting for confirmation")
                                    })?;
                                PAUSED_DOWNLOADS
                                    .lock()
                                    .map_err(|error| error.to_string())?
                                    .remove(&id);
                                remove_partial_download_when_released(downloaded_file);

                                let mut payload =
                                    read_payload(&id, &label, &operation, download_started_at);
                                payload.state = "cancelled".to_string();
                                payload.can_resume = false;
                                payload.paused = false;
                                payload.requires_confirmation = false;
                                payload.danger_reason = None;
                                let _ = app_for_main.emit(DOWNLOAD_EVENT, payload.clone());
                                finalize_download(&id, &payload);
                                return Ok(());
                            },
                            _ => unreachable!(),
                        };

                        // Resume can synchronously expose WebView2's old
                        // Interrupted/UserCanceled state. Let StateChanged publish
                        // the authoritative post-resume state instead of finalizing
                        // a healthy transfer as cancelled. Keep only clears a
                        // completed file after the signature decision is visible.
                        if should_emit_immediately {
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
                    }
                    "retry" => {
                        if let Some((operation, _, _)) = active {
                            let mut can_resume = BOOL::default();
                            unsafe {
                                operation
                                    .CanResume(&mut can_resume)
                                    .map_err(|error| error.to_string())?;
                                if can_resume.as_bool() {
                                    operation.Resume().map_err(|error| error.to_string())?;
                                    return Ok(());
                                }
                            }
                        }

                        let failed = FAILED_DOWNLOADS
                            .with(|downloads| downloads.borrow().get(&id).cloned())
                            .ok_or_else(|| format!("failed download '{id}' cannot be retried"))?;
                        let parsed = url::Url::parse(&failed.source_url).map_err(|_| {
                            "the original download URL is no longer valid".to_string()
                        })?;
                        if !matches!(parsed.scheme(), "http" | "https") {
                            return Err(
                                "this download source cannot be restarted safely".to_string()
                            );
                        }
                        let webview = app_for_main.get_webview(&failed.label).ok_or_else(|| {
                            "the original download tab is no longer open".to_string()
                        })?;
                        webview
                            .navigate(parsed)
                            .map_err(|error| error.to_string())?;
                        FAILED_DOWNLOADS.with(|downloads| {
                            downloads.borrow_mut().remove(&id);
                        });
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

        rx.recv_timeout(Duration::from_secs(10))
            .map_err(|_| "timed out controlling download".to_string())?
    }

    #[cfg(test)]
    mod tests {
        use super::{dangerous_file_reason, has_trusted_authenticode_signature};

        #[test]
        fn executable_and_script_downloads_require_confirmation() {
            assert_eq!(
                dangerous_file_reason("Nebula-Setup.EXE"),
                Some("dangerous_file_type")
            );
            assert_eq!(
                dangerous_file_reason("cleanup.ps1"),
                Some("dangerous_file_type")
            );
            assert_eq!(dangerous_file_reason("manual.pdf"), None);
            assert_eq!(dangerous_file_reason("archive.zip"), None);
            assert_eq!(dangerous_file_reason("photo.png"), None);
        }

        #[test]
        fn unsigned_test_binary_is_not_trusted() {
            let current_exe = std::env::current_exe().expect("test binary path");
            assert!(!has_trusted_authenticode_signature(
                current_exe.to_string_lossy().as_ref()
            ));
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{control_download, setup_tab_downloads, start_download_drag, teardown_tab_downloads};

#[cfg(target_os = "windows")]
pub(crate) use imp::has_recent_or_active_download_for_label;

#[cfg(not(target_os = "windows"))]
pub fn setup_tab_downloads(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_tab_downloads(_app: &tauri::AppHandle, _label: &str) {}

#[cfg(not(target_os = "windows"))]
pub fn start_download_drag(_app: tauri::AppHandle, _id: String) -> Result<(), String> {
    Err("download drag-out is currently supported on Windows".to_string())
}

#[cfg(not(target_os = "windows"))]
pub fn control_download(
    _app: tauri::AppHandle,
    _id: String,
    _action: String,
) -> Result<(), String> {
    Err("downloads are currently supported on Windows".to_string())
}
