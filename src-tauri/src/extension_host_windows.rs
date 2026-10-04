//! Popup requests retain WebView2's native opener and profile. The queue avoids
//! nested synchronous WebView creation while the first builder pumps messages.
//!
//! A page that opens a window (`chrome.tabs.create`, `window.open`) often closes itself right
//! after, and wry destroys the closing window at once. `SetNewWindow` on an opener that is
//! already gone does not fail: the runtime crashes with an access violation inside its own
//! code, which ends the whole browser. So the window is bound to its opener only while the
//! opener is alive; when it is closing, the window the page asked for is opened on its address
//! on its own (there is no opener left to belong to).
use super::website_url;
use std::collections::{HashMap, HashSet};
use std::sync::{LazyLock, Mutex};
use std::{cell::RefCell, collections::VecDeque};
use tauri::Manager;
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2Deferral, ICoreWebView2Environment,
        ICoreWebView2NewWindowRequestedEventArgs, ICoreWebView2_2,
    },
    NewWindowRequestedEventHandler, WindowCloseRequestedEventHandler,
};
use windows_core::{Interface, PWSTR};

struct Request {
    args: ICoreWebView2NewWindowRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
    environment: ICoreWebView2Environment,
    owner: String,
    url: tauri::Url,
    title: String,
    visible: bool,
    width: f64,
    height: f64,
}

#[derive(Default)]
struct Queue {
    busy: bool,
    current: Option<Request>,
    requests: VecDeque<Request>,
}

thread_local! {
    // COM objects stay on the UI apartment, including deferral completion.
    static QUEUE: RefCell<Queue> = RefCell::new(Queue::default());
}

/// How many requests of each opener are in flight: from the moment one is queued until its
/// deferral is completed. Shared across threads (a popup's focus watcher asks too).
static PENDING: LazyLock<Mutex<HashMap<String, usize>>> = LazyLock::new(Mutex::default);
/// Windows that were asked to close. Wry destroys such a window straight away; a request of
/// it that is still queued must not be bound to it.
static CLOSING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Mutex::default);

/// Whether `owner` has a request in flight. Closing it by hand now would lose that window.
pub(crate) fn has_pending(owner: &str) -> bool {
    PENDING
        .lock()
        .is_ok_and(|pending| pending.get(owner).is_some_and(|count| *count > 0))
}

fn begin_request(owner: &str) {
    if let Ok(mut pending) = PENDING.lock() {
        *pending.entry(owner.to_string()).or_insert(0) += 1;
    }
}

fn end_request(owner: &str) {
    if let Ok(mut pending) = PENDING.lock() {
        match pending.get_mut(owner) {
            Some(count) if *count > 1 => *count -= 1,
            _ => {
                pending.remove(owner);
            }
        }
    }
}

fn mark_closing(label: &str) {
    if let Ok(mut closing) = CLOSING.lock() {
        closing.insert(label.to_string());
    }
}

/// A label is reused by the next window of the same extension view.
fn clear_closing(label: &str) {
    if let Ok(mut closing) = CLOSING.lock() {
        closing.remove(label);
    }
}

fn is_closing(label: &str) -> bool {
    CLOSING.lock().is_ok_and(|closing| closing.contains(label))
}

/// Whether the new window can still be bound to the page that asked for it.
fn opener_alive(app: &tauri::AppHandle, owner: &str) -> bool {
    !is_closing(owner) && app.get_webview(owner).is_some()
}

fn schedule(app: &tauri::AppHandle) {
    let app = app.clone();
    // Dispatch from outside the COM callback, not a nested message loop.
    tauri::async_runtime::spawn_blocking(move || {
        let dispatcher = app.clone();
        let _ = dispatcher.run_on_main_thread(move || process_next(app));
    });
}

fn finish(app: &tauri::AppHandle) {
    QUEUE.with(|queue| queue.borrow_mut().busy = false);
    schedule(app);
}

fn configure(
    app: &tauri::AppHandle,
    core: &ICoreWebView2,
    label: String,
    owner: String,
    visible: bool,
) -> windows_core::Result<()> {
    clear_closing(&label);
    let environment = unsafe { core.cast::<ICoreWebView2_2>()?.Environment()? };
    let close_app = app.clone();
    let close_handler = WindowCloseRequestedEventHandler::create(Box::new(move |_, _| {
        mark_closing(&label);
        // Wry destroys the HWND. Also tell Tauri to remove its managed window
        // and webview records; a native DestroyWindow alone leaves stale entries.
        if let Some(window) = close_app.get_webview_window(&label) {
            let _ = window.destroy();
        }
        Ok(())
    }));
    unsafe {
        core.add_WindowCloseRequested(&close_handler, &mut 0)?;
    }
    let app = app.clone();
    let handler = NewWindowRequestedEventHandler::create(Box::new(move |_, args| unsafe {
        let Some(args) = args else { return Ok(()) };
        args.SetHandled(true)?;
        let mut value = PWSTR::null();
        args.Uri(&mut value)?;
        let uri = value.to_string().unwrap_or_default();
        if !value.is_null() {
            windows::Win32::System::Com::CoTaskMemFree(Some(value.as_ptr().cast()));
        }
        let Ok(url) = uri.parse::<tauri::Url>() else {
            return Ok(());
        };
        let url_allowed = website_url(&url) || url.as_str() == "about:blank";
        if app.get_webview(&owner).is_none() {
            return Ok(());
        }
        let capacity = QUEUE.with(|queue| queue.borrow().requests.len() < 16);
        if !capacity {
            return Ok(());
        }
        let mut user_initiated = windows_core::BOOL::default();
        // Not knowing whether a click started it counts as not started by one.
        let user_initiated =
            args.IsUserInitiated(&mut user_initiated).is_ok() && user_initiated.as_bool();
        let mut requested_size = None;
        if let Ok(features) = args.WindowFeatures() {
            let mut has_size = windows_core::BOOL::default();
            if features.HasSize(&mut has_size).is_ok() && has_size.as_bool() {
                let (mut width, mut height) = (0, 0);
                if features.Width(&mut width).is_ok() && features.Height(&mut height).is_ok() {
                    requested_size = Some((width as f64, height as f64));
                }
            }
        }
        // Windows this page already has, open or waiting to be created.
        let owner_prefix = format!("extension-auth-{owner}-");
        let (open_for_owner, open_total) = {
            let windows = app.webview_windows();
            (
                windows
                    .keys()
                    .filter(|label| label.starts_with(&owner_prefix))
                    .count(),
                windows
                    .keys()
                    .filter(|label| label.starts_with("extension-auth-"))
                    .count(),
            )
        };
        let (queued_for_owner, queued_total) = QUEUE.with(|queue| {
            let queue = queue.borrow();
            (
                queue
                    .requests
                    .iter()
                    .filter(|request| request.owner == owner)
                    .count(),
                queue.requests.len(),
            )
        });
        let work_area = app
            .get_window(&owner)
            .and_then(|window| window.current_monitor().ok().flatten())
            .map(|monitor| {
                let area = monitor.work_area().size;
                let scale = monitor.scale_factor().max(0.1);
                (area.width as f64 / scale, area.height as f64 / scale)
            });
        let (width, height) =
            match crate::extension_window_policy::decide(&crate::extension_window_policy::Request {
                user_initiated,
                url_allowed,
                requested_size,
                owner_windows: open_for_owner + queued_for_owner,
                total_windows: open_total + queued_total,
                work_area,
                // Not an extension page that Nebula shows: the profile's own host,
                // reached by an extension's background code (service worker).
                background: !owner.starts_with("extension-ui-"),
                recent_user_action: crate::extension_window_policy::recent_user_action(),
            }) {
                crate::extension_window_policy::Decision::Allow { size } => size,
                crate::extension_window_policy::Decision::Deny(reason) => {
                    crate::extension_window_policy::record_denial(&owner, reason);
                    return Ok(());
                }
            };
        let deferral = args.GetDeferral()?;
        begin_request(&owner);
        QUEUE.with(|queue| {
            queue.borrow_mut().requests.push_back(Request {
                args,
                deferral,
                environment: environment.clone(),
                owner: owner.clone(),
                title: url.host_str().unwrap_or("Nebula · Extension").to_string(),
                url,
                visible,
                width,
                height,
            })
        });
        schedule(&app);
        Ok(())
    }));
    unsafe { core.add_NewWindowRequested(&handler, &mut 0) }
}

pub(super) fn attach(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    visible: bool,
) -> Result<(), String> {
    let owner = window.label().to_string();
    let app = app.clone();
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    window
        .with_webview(move |inner| {
            let result = unsafe { inner.controller().CoreWebView2() }
                .and_then(|core| configure(&app, &core, owner.clone(), owner, visible));
            let _ = tx.send(result.map_err(|e| e.to_string()));
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?
}

fn process_next(app: tauri::AppHandle) {
    let request = QUEUE.with(|queue| {
        let mut queue = queue.borrow_mut();
        if queue.busy {
            return None;
        }
        let request = queue.requests.pop_front()?;
        queue.busy = true;
        Some(request)
    });
    let Some(request) = request else { return };
    let prefix = format!("extension-auth-{}-", request.owner);
    if app.get_webview(&request.owner).is_none()
        || app
            .webview_windows()
            .keys()
            .filter(|label| label.starts_with(&prefix))
            .count()
            >= crate::extension_window_policy::MAX_WINDOWS_PER_OWNER
    {
        unsafe {
            let _ = request.deferral.Complete();
        }
        end_request(&request.owner);
        finish(&app);
        return;
    }
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let nonce = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let window = tauri::WebviewWindowBuilder::new(
        &app,
        format!("{prefix}{nonce}"),
        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title(&request.title)
    .inner_size(request.width, request.height)
    .visible(request.visible)
    .focused(request.visible)
    .with_environment(request.environment.clone())
    .browser_extensions_enabled(true)
    .on_navigation(|url| url.as_str() == "about:blank" || website_url(url))
    .build();
    let window = match window {
        Ok(window) => window,
        Err(error) => {
            eprintln!("Extension popup creation failed: {error}");
            unsafe {
                let _ = request.deferral.Complete();
            }
            end_request(&request.owner);
            finish(&app);
            return;
        }
    };
    let completion_app = app.clone();
    let completion_window = window.clone();
    QUEUE.with(|queue| queue.borrow_mut().current = Some(request));
    if let Err(error) = window.with_webview(move |inner| unsafe {
        let request = QUEUE.with(|queue| queue.borrow_mut().current.take());
        let Some(request) = request else {
            finish(&completion_app);
            return;
        };
        let result = (|| -> windows_core::Result<()> {
            let core = inner.controller().CoreWebView2()?;
            configure(
                &completion_app,
                &core,
                completion_window.label().to_string(),
                request.owner.clone(),
                request.visible,
            )?;
            if !opener_alive(&completion_app, &request.owner) {
                // The page that asked is closing (it often closes itself right after asking).
                // Binding the window to it would crash the runtime, so the window the page
                // wanted is opened on its own address, with no opener.
                return core.Navigate(&windows_core::HSTRING::from(request.url.as_str()));
            }
            request.args.SetNewWindow(&core)
        })();
        if let Err(error) = result {
            eprintln!("Extension popup attachment failed: {error}");
            let _ = completion_window.destroy();
        }
        let _ = request.deferral.Complete();
        end_request(&request.owner);
        finish(&completion_app);
    }) {
        eprintln!("Extension popup dispatch failed: {error}");
        let _ = window.destroy();
        if let Some(request) = QUEUE.with(|queue| queue.borrow_mut().current.take()) {
            unsafe {
                let _ = request.deferral.Complete();
            }
            end_request(&request.owner);
        }
        finish(&app);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_in_flight_are_counted_per_opener() {
        let owner = "test-opener-1";
        assert!(!has_pending(owner));
        begin_request(owner);
        begin_request(owner);
        assert!(has_pending(owner));
        end_request(owner);
        assert!(has_pending(owner), "one request is still in flight");
        end_request(owner);
        assert!(!has_pending(owner));
        // An end without a begin is harmless, and openers do not affect each other.
        end_request(owner);
        begin_request("test-opener-2");
        assert!(!has_pending("test-opener-3"));
        end_request("test-opener-2");
    }

    #[test]
    fn a_window_asked_to_close_stays_closing_until_its_label_is_reused() {
        let label = "extension-ui-test-popup";
        assert!(!is_closing(label));
        mark_closing(label);
        assert!(is_closing(label));
        assert!(!is_closing("extension-ui-test-other"));
        // The next window of the same view gets the same label and must not inherit the mark.
        clear_closing(label);
        assert!(!is_closing(label));
    }
}
