//! The owner of the browser profile.
//!
//! Native code that works on the profile tabs live in (extensions, site permissions,
//! clearing browsing data, the user data folder) has to go through a webview of that
//! profile. It used to use "the webview of the window label it was given", which is the
//! shell's `main`. That only worked while the shell and the tabs shared one profile.
//! With the shell in its own trusted environment (see `shell_split`) `main` has the
//! wrong profile, and an environment that refuses extensions outright.
//!
//! So there is one owner: a hidden webview in the BROWSING environment that does
//! nothing else. It is created on first use, it has no capability (no Tauri bridge at
//! all), it can only ever show `about:blank`, it has no taskbar button and is never
//! shown. Profile operations take a `ProfileOwner` and cannot be handed another webview,
//! and there is no fallback to `main`: if the owner cannot be created the operation
//! fails.
//!
//! The owner costs a renderer process, and profile operations are rare (a status check
//! at startup, clearing data, an extension action). So it is leased: it exists while an
//! operation holds a `ProfileOwner` and for `IDLE_TEARDOWN` after the last use, then it is
//! destroyed and the next operation creates it again.
//!
//! Operations on ONE webview (privacy settings of a tab, its context menu, printing)
//! are not profile operations and keep using that webview's label. The shell's own
//! environment is reached through `shell_webview`, named so that it stays visible.
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::Manager;

/// The label starts with `extension-` so the app lifecycle treats this window as a
/// background window (it never keeps the process alive).
pub const OWNER_LABEL: &str = "extension-browse-host";

/// How long the owner stays after its last use.
const IDLE_TEARDOWN: Duration = Duration::from_secs(60);

static LEASES: AtomicUsize = AtomicUsize::new(0);
static LAST_USED: Mutex<Option<Instant>> = Mutex::new(None);
static TEARDOWN_SCHEDULED: AtomicBool = AtomicBool::new(false);
static STRUCTURE: Mutex<()> = Mutex::new(());
// Counters for measuring create/destroy churn.
static CREATED: AtomicU64 = AtomicU64::new(0);
static DESTROYED: AtomicU64 = AtomicU64::new(0);
static CREATE_MICROS: AtomicU64 = AtomicU64::new(0);

/// (owners created, owners destroyed, total microseconds spent creating them).
#[cfg(feature = "split-driver")]
pub fn churn_counters() -> (u64, u64, u64) {
    (
        CREATED.load(Ordering::Relaxed),
        DESTROYED.load(Ordering::Relaxed),
        CREATE_MICROS.load(Ordering::Relaxed),
    )
}

/// A lease on the browsing profile's owner. Only `owner()` makes one.
pub struct ProfileOwner {
    webview: tauri::Webview,
    app: tauri::AppHandle,
}

impl ProfileOwner {
    pub fn with_webview<F>(&self, f: F) -> tauri::Result<()>
    where
        F: FnOnce(tauri::webview::PlatformWebview) + Send + 'static,
    {
        self.webview.with_webview(f)
    }

    pub(crate) fn webview(&self) -> &tauri::Webview {
        &self.webview
    }
}

impl Drop for ProfileOwner {
    fn drop(&mut self) {
        LEASES.fetch_sub(1, Ordering::AcqRel);
        touch();
        schedule_teardown(self.app.clone());
    }
}

pub fn is_owner(label: &str) -> bool {
    label == OWNER_LABEL
}

fn touch() {
    if let Ok(mut last) = LAST_USED.lock() {
        *last = Some(Instant::now());
    }
}

fn idle_for(duration: Duration) -> bool {
    LAST_USED
        .lock()
        .ok()
        .and_then(|last| *last)
        .map_or(true, |at| at.elapsed() >= duration)
}

fn create(app: &tauri::AppHandle) -> Result<(), String> {
    let _structure = STRUCTURE
        .lock()
        .map_err(|_| "browser profile owner lock poisoned".to_string())?;
    if app.get_webview(OWNER_LABEL).is_some() {
        return Ok(());
    }
    let started = Instant::now();
    // No `data_directory`: the default folder is where tabs live, whether the shell
    // shares it (today) or has its own (split). Extensions on, like the tabs.
    let built = tauri::WebviewWindowBuilder::new(
        app,
        OWNER_LABEL,
        tauri::WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .title("")
    .inner_size(1.0, 1.0)
    .decorations(false)
    .visible(false)
    .focused(false)
    .skip_taskbar(true)
    .browser_extensions_enabled(true)
    .on_navigation(|url| url.as_str() == "about:blank")
    .build()
    .map(|_| ())
    .map_err(|error| format!("could not create the browser profile owner: {error}"));
    if built.is_ok() {
        CREATED.fetch_add(1, Ordering::Relaxed);
        CREATE_MICROS.fetch_add(started.elapsed().as_micros() as u64, Ordering::Relaxed);
    }
    built
}

/// Destroys the owner once nobody holds it and it has been idle. One thread at a time.
fn schedule_teardown(app: tauri::AppHandle) {
    if TEARDOWN_SCHEDULED.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        if LEASES.load(Ordering::Acquire) != 0 || !idle_for(IDLE_TEARDOWN) {
            continue;
        }
        let Ok(_structure) = STRUCTURE.lock() else {
            break;
        };
        // Re-check under the lock: an operation may have just taken a lease.
        if LEASES.load(Ordering::Acquire) != 0 || !idle_for(IDLE_TEARDOWN) {
            continue;
        }
        if let Some(window) = app.get_webview_window(OWNER_LABEL) {
            let _ = window.destroy();
            DESTROYED.fetch_add(1, Ordering::Relaxed);
            let deadline = Instant::now() + Duration::from_secs(3);
            while app.get_webview(OWNER_LABEL).is_some() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(50));
            }
        }
        TEARDOWN_SCHEDULED.store(false, Ordering::Release);
        break;
    });
}

/// Call from a worker thread (an async command or `spawn_blocking`), never from the
/// UI thread: creating the window waits for the UI thread.
pub fn owner(app: &tauri::AppHandle) -> Result<ProfileOwner, String> {
    LEASES.fetch_add(1, Ordering::AcqRel);
    touch();
    let lease = |webview| ProfileOwner {
        webview,
        app: app.clone(),
    };
    let result = create(app).and_then(|()| {
        app.get_webview(OWNER_LABEL)
            .ok_or_else(|| "the browser profile owner is not available".to_string())
    });
    match result {
        Ok(webview) => Ok(lease(webview)),
        Err(error) => {
            LEASES.fetch_sub(1, Ordering::AcqRel);
            Err(error)
        }
    }
}

/// The owner's label, for code that passes a label on (extension operations). It holds
/// no lease: the owner lives `IDLE_TEARDOWN` past this call, long enough for the
/// operation that follows.
pub fn owner_label(app: &tauri::AppHandle) -> Result<String, String> {
    touch();
    create(app)?;
    schedule_teardown(app.clone());
    Ok(OWNER_LABEL.to_string())
}

/// The shell's own webview, for the few jobs that are about the shell's environment
/// (its processes, wiping its state). Never a stand-in for the browsing profile.
pub fn shell_webview(app: &tauri::AppHandle) -> Result<tauri::Webview, String> {
    app.get_webview("main")
        .ok_or_else(|| "the shell webview is not available".to_string())
}

/// The browsing profile's user data folder, read from the owner's own environment.
#[cfg(target_os = "windows")]
pub fn user_data_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment7, ICoreWebView2_2,
    };
    use windows_core::{Interface, PWSTR};
    let owner = owner(app)?;
    let (tx, rx) = std::sync::mpsc::sync_channel(1);
    owner
        .with_webview(move |inner| unsafe {
            let result = (|| -> Result<PathBuf, String> {
                let environment = inner
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.cast::<ICoreWebView2_2>())
                    .and_then(|core| core.Environment())
                    .and_then(|env| env.cast::<ICoreWebView2Environment7>())
                    .map_err(|e| e.to_string())?;
                let mut value = PWSTR::null();
                let read = environment.UserDataFolder(&mut value);
                let path = value.to_string().unwrap_or_default();
                if !value.is_null() {
                    windows::Win32::System::Com::CoTaskMemFree(Some(value.as_ptr().cast()));
                }
                read.map_err(|e| e.to_string())?;
                if path.is_empty() {
                    return Err("the browser profile has no user data folder".into());
                }
                Ok(PathBuf::from(path))
            })();
            let _ = tx.send(result);
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| "reading the browser profile folder timed out".to_string())?
}
