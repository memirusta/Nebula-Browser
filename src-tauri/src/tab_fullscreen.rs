#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::{Arc, LazyLock, Mutex};
    use std::time::Duration;

    use serde::Serialize;
    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2AcceleratorKeyPressedEventHandler,
        ICoreWebView2ContainsFullScreenElementChangedEventHandler,
        ICoreWebView2WebMessageReceivedEventArgs, ICoreWebView2WebMessageReceivedEventHandler,
        COREWEBVIEW2_KEY_EVENT_KIND, COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN,
        COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN, COREWEBVIEW2_PHYSICAL_KEY_STATUS,
    };
    use webview2_com::{
        AcceleratorKeyPressedEventHandler, AddScriptToExecuteOnDocumentCreatedCompletedHandler,
        ContainsFullScreenElementChangedEventHandler, ExecuteScriptCompletedHandler,
        WebMessageReceivedEventHandler,
    };
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetForegroundWindow, GA_ROOT};
    use windows_core::{BOOL, HSTRING, PWSTR};

    const FULLSCREEN_LOSS_SETTLE: Duration = Duration::from_millis(120);

    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static WEBMESSAGE_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static ACCELERATOR_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static PERSISTENT_FULLSCREEN_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static FULLSCREEN_LOSS_GENERATIONS: LazyLock<Mutex<HashMap<String, u64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    thread_local! {
        static HANDLERS: RefCell<HashMap<String, (ICoreWebView2ContainsFullScreenElementChangedEventHandler, ICoreWebView2WebMessageReceivedEventHandler, ICoreWebView2AcceleratorKeyPressedEventHandler)>> =
            RefCell::new(HashMap::new());
    }
    static LAST_FULLSCREEN_STATES: LazyLock<Mutex<HashMap<String, bool>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    const FULLSCREEN_FALLBACK_SCRIPT: &str = r#"
(function () {
  if (window.__nebulaFullscreenHookInstalled) return;
  window.__nebulaFullscreenHookInstalled = true;
  const nebulaWebMessageBridge = window.chrome && window.chrome.webview;
  const persistentAttribute = 'data-nebula-persistent-fullscreen';
  const persistentRootAttribute = 'data-nebula-persistent-fullscreen-active';
  let lastFullscreenElement = null;
  let persistentFullscreenElement = null;
  const nativeExitFullscreen = typeof document.exitFullscreen === 'function'
    ? document.exitFullscreen.bind(document)
    : null;
  const nativeWebkitExitFullscreen = typeof document.webkitExitFullscreen === 'function'
    ? document.webkitExitFullscreen.bind(document)
    : null;
  const nativeWebkitCancelFullScreen = typeof document.webkitCancelFullScreen === 'function'
    ? document.webkitCancelFullScreen.bind(document)
    : null;
  try {
    Object.defineProperty(window.chrome, 'webview', {
      value: undefined,
      configurable: false,
      enumerable: false,
      writable: false
    });
  } catch (_) {
    try {
      const maskedChrome = Object.create(window.chrome || null);
      Object.defineProperty(maskedChrome, 'webview', { value: undefined });
      Object.defineProperty(window, 'chrome', { value: maskedChrome });
    } catch (_) {}
  }
  function notifyHost(message) {
    try { nebulaWebMessageBridge.postMessage(message); } catch (_) {}
  }

  function currentFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
  }

  function ensurePersistentStyle() {
    if (document.getElementById('__nebulaPersistentFullscreenStyle')) return;
    const style = document.createElement('style');
    style.id = '__nebulaPersistentFullscreenStyle';
    style.textContent = `
      html[${persistentRootAttribute}],
      html[${persistentRootAttribute}] body {
        overflow: hidden !important;
      }
      [${persistentAttribute}] {
        position: fixed !important;
        inset: 0 !important;
        display: block !important;
        width: 100vw !important;
        height: 100vh !important;
        min-width: 100vw !important;
        min-height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        padding: 0 !important;
        transform: none !important;
        z-index: 2147483647 !important;
        background: #000 !important;
        visibility: visible !important;
      }
      [${persistentAttribute}] video,
      video[${persistentAttribute}],
      [${persistentAttribute}] iframe {
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: none !important;
        object-fit: contain !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function reconcilePageAfterPersistentExit(element) {
    window.setTimeout(function () {
      try {
        if (element && element.isConnected) element.getBoundingClientRect();
      } catch (_) {}

      try {
        document.dispatchEvent(new Event('fullscreenchange'));
      } catch (_) {}

      try {
        document.dispatchEvent(new Event('webkitfullscreenchange'));
      } catch (_) {}

      try {
        window.dispatchEvent(new Event('resize'));
      } catch (_) {}

      window.requestAnimationFrame(function () {
        try {
          if (element && element.isConnected) element.getBoundingClientRect();
        } catch (_) {}

        try {
          window.dispatchEvent(new Event('resize'));
        } catch (_) {}
      });
    }, 0);
  }

  function clearPersistentFullscreen(notify) {
    const element = persistentFullscreenElement;
    persistentFullscreenElement = null;
    if (element && element.removeAttribute) {
      element.removeAttribute(persistentAttribute);
    }
    document.documentElement.removeAttribute(persistentRootAttribute);
    if (document.body) document.body.removeAttribute(persistentRootAttribute);
    lastFullscreenElement = null;
    if (element) reconcilePageAfterPersistentExit(element);
    if (notify && element) notifyHost('nebula-persistent-fullscreen-exit');
    return Boolean(element);
  }

  function installPersistentFullscreenExitBridge(property, nativeExit) {
    if (!nativeExit) return;
    try {
      Object.defineProperty(document, property, {
        configurable: true,
        value: function () {
          if (persistentFullscreenElement) {
            clearPersistentFullscreen(true);
            return Promise.resolve();
          }

          return nativeExit();
        }
      });
    } catch (_) {}
  }

  // After Alt+Tab, WebView2 has already cleared document.fullscreenElement and
  // Nebula is displaying the former fullscreen element through the persistent
  // fallback. Site fullscreen controls still call the standard exit methods,
  // so bridge those methods to the fallback instead of leaving the page and
  // host window in two different fullscreen states.
  installPersistentFullscreenExitBridge('exitFullscreen', nativeExitFullscreen);
  installPersistentFullscreenExitBridge('webkitExitFullscreen', nativeWebkitExitFullscreen);
  installPersistentFullscreenExitBridge('webkitCancelFullScreen', nativeWebkitCancelFullScreen);

  function activatePersistentFullscreen(element) {
    if (!element || !element.isConnected) return false;
    if (persistentFullscreenElement === element) return true;
    ensurePersistentStyle();
    persistentFullscreenElement = element;
    element.setAttribute(persistentAttribute, '');
    document.documentElement.setAttribute(persistentRootAttribute, '');
    if (document.body) document.body.setAttribute(persistentRootAttribute, '');
    notifyHost('nebula-persistent-fullscreen-enter');
    return true;
  }

  function handleFullscreenChange() {
    const current = currentFullscreenElement();
    if (current) {
      if (persistentFullscreenElement) clearPersistentFullscreen(false);
      lastFullscreenElement = current;
    }
    notifyHost('nebula-fullscreen-state-changed');
  }

  window.__nebulaExitPersistentFullscreen = function () {
    return clearPersistentFullscreen(true);
  };
  window.__nebulaEnterPersistentFullscreenFromHost = function () {
    return activatePersistentFullscreen(lastFullscreenElement);
  };
  window.__nebulaExitPersistentFullscreenFromHost = function () {
    return clearPersistentFullscreen(false);
  };

  document.addEventListener('keydown', function (event) {
    if (!persistentFullscreenElement) return;
    const target = event.target;
    const editable = target && (
      target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || '')
    );
    const exitKey = event.key === 'Escape' || (
      !editable &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.metaKey &&
      event.key &&
      event.key.toLowerCase() === 'f'
    );
    if (!exitKey) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    clearPersistentFullscreen(true);
  }, true);

  // Some iframe players blur the top-level page while focus merely moves
  // inside the same Nebula window. Blur may help retain the last element, but
  // it must never decide whether persistent fullscreen is entered.
  window.addEventListener('blur', function () {
    const current = currentFullscreenElement();
    if (current) lastFullscreenElement = current;
  }, true);

  document.addEventListener('fullscreenchange', handleFullscreenChange, true);
  document.addEventListener('webkitfullscreenchange', handleFullscreenChange, true);
})();
"#;

    unsafe fn web_message_string(args: &ICoreWebView2WebMessageReceivedEventArgs) -> String {
        let mut value = PWSTR::null();
        if args.TryGetWebMessageAsString(&mut value).is_err() || value.is_null() {
            return String::new();
        }
        let message = value.to_string().unwrap_or_default();
        windows::Win32::System::Com::CoTaskMemFree(Some(value.as_ptr().cast()));
        message
    }

    #[derive(Clone, Serialize)]
    struct TabFullscreenPayload {
        label: String,
        is_fullscreen: bool,
    }

    fn emit_fullscreen_event(app: &AppHandle, label: &str, is_fullscreen: bool) {
        let Some(webview) = app.get_webview(label) else {
            return;
        };
        let target = webview.window().label().to_string();
        let event_name = format!("nebula-tab-fullscreen:{target}");
        let _ = app.emit_to(
            &target,
            &event_name,
            TabFullscreenPayload {
                label: label.to_string(),
                is_fullscreen,
            },
        );
    }

    fn commit_fullscreen_state(app: &AppHandle, label: &str, is_fullscreen: bool) {
        if let Ok(mut labels) = PERSISTENT_FULLSCREEN_LABELS.lock() {
            if is_fullscreen {
                labels.remove(label);
            }
        }

        let changed = LAST_FULLSCREEN_STATES
            .lock()
            .map(|mut states| {
                states.insert(label.to_string(), is_fullscreen) != Some(is_fullscreen)
            })
            .unwrap_or(true);
        if !changed {
            return;
        }
        #[cfg(debug_assertions)]
        eprintln!(
            "[nebula fullscreen] {label}: emitting real state change is_fullscreen={is_fullscreen}"
        );
        emit_fullscreen_event(app, label, is_fullscreen);
    }

    fn advance_fullscreen_loss_generation(label: &str) -> u64 {
        FULLSCREEN_LOSS_GENERATIONS
            .lock()
            .map(|mut generations| {
                let generation = generations.entry(label.to_string()).or_default();
                *generation = generation.wrapping_add(1);
                *generation
            })
            .unwrap_or(0)
    }

    fn fullscreen_loss_generation_is_current(label: &str, generation: u64) -> bool {
        FULLSCREEN_LOSS_GENERATIONS
            .lock()
            .ok()
            .and_then(|generations| generations.get(label).copied())
            == Some(generation)
    }

    fn root_hwnd(hwnd: HWND) -> HWND {
        let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
        if root.is_invalid() {
            hwnd
        } else {
            root
        }
    }

    fn nebula_parent_is_foreground(app: &AppHandle, label: &str) -> Option<bool> {
        let foreground = unsafe { GetForegroundWindow() };
        if foreground.is_invalid() {
            return None;
        }

        let parent = app.get_webview(label)?.window().hwnd().ok()?;
        Some(root_hwnd(foreground) == root_hwnd(parent))
    }

    fn webview_contains_fullscreen(app: &AppHandle, label: &str) -> Option<bool> {
        let webview = app.get_webview(label)?;
        let result = Arc::new(Mutex::new(None));
        let callback_result = Arc::clone(&result);
        webview
            .with_webview(move |inner| unsafe {
                let Ok(core) = inner.controller().CoreWebView2() else {
                    return;
                };
                let mut contains_fullscreen = BOOL::default();
                if core
                    .ContainsFullScreenElement(&mut contains_fullscreen)
                    .is_ok()
                {
                    if let Ok(mut slot) = callback_result.lock() {
                        *slot = Some(contains_fullscreen.as_bool());
                    }
                }
            })
            .ok()?;
        result.lock().ok().and_then(|slot| *slot)
    }

    fn execute_page_fullscreen_command(app: &AppHandle, label: &str, script: &'static str) {
        let Some(webview) = app.get_webview(label) else {
            return;
        };
        let _ = webview.with_webview(move |inner| unsafe {
            let Ok(core) = inner.controller().CoreWebView2() else {
                return;
            };
            let script = HSTRING::from(script);
            let execute_handler =
                ExecuteScriptCompletedHandler::create(Box::new(|_result, _value| Ok(())));
            let _ = core.ExecuteScript(PCWSTR(script.as_ptr()), &execute_handler);
        });
    }

    fn confirm_site_fullscreen_exit(app: &AppHandle, label: &str) {
        advance_fullscreen_loss_generation(label);
        if let Ok(mut labels) = PERSISTENT_FULLSCREEN_LABELS.lock() {
            labels.remove(label);
        }
        execute_page_fullscreen_command(
            app,
            label,
            "window.__nebulaExitPersistentFullscreenFromHost?.()",
        );
        commit_fullscreen_state(app, label, false);
    }

    fn reconcile_native_fullscreen_loss(app: &AppHandle, label: &str, generation: u64) {
        if !fullscreen_loss_generation_is_current(label, generation) {
            return;
        }

        let still_logically_fullscreen = LAST_FULLSCREEN_STATES
            .lock()
            .ok()
            .and_then(|states| states.get(label).copied())
            == Some(true);
        if !still_logically_fullscreen {
            return;
        }

        let nebula_foreground = nebula_parent_is_foreground(app, label);
        #[cfg(debug_assertions)]
        match nebula_foreground {
            Some(value) => {
                eprintln!("[nebula fullscreen] {label}: foreground reconciliation: nebula={value}")
            }
            None => {
                eprintln!("[nebula fullscreen] {label}: foreground reconciliation: nebula=unknown")
            }
        }

        // A false edge can be followed by a true edge while an iframe hands
        // fullscreen ownership to another element. Re-read WebView2 after the
        // settle window so the transient false never tears down the host state.
        if webview_contains_fullscreen(app, label) == Some(true) {
            #[cfg(debug_assertions)]
            eprintln!("[nebula fullscreen] {label}: document fullscreen restored; no fallback");
            return;
        }

        match nebula_foreground {
            Some(false) => {
                #[cfg(debug_assertions)]
                eprintln!(
                    "[nebula fullscreen] {label}: preserving site fullscreen via persistent fallback"
                );
                execute_page_fullscreen_command(
                    app,
                    label,
                    "window.__nebulaEnterPersistentFullscreenFromHost?.()",
                );
            }
            Some(true) => {
                #[cfg(debug_assertions)]
                eprintln!(
                    "[nebula fullscreen] {label}: explicit/native site exit confirmed; no fallback"
                );
                confirm_site_fullscreen_exit(app, label);
            }
            None => {
                // Enter fallback only after a positively identified app switch.
                // An unavailable foreground handle is therefore a normal exit,
                // avoiding a sticky fullscreen loop on transient iframe blur.
                #[cfg(debug_assertions)]
                eprintln!("[nebula fullscreen] {label}: foreground unavailable; no fallback");
                confirm_site_fullscreen_exit(app, label);
            }
        }
    }

    fn schedule_native_fullscreen_loss(app: &AppHandle, label: &str) {
        let generation = advance_fullscreen_loss_generation(label);
        #[cfg(debug_assertions)]
        eprintln!(
            "[nebula fullscreen] {label}: native fullscreen loss scheduled generation={generation}"
        );

        let app = app.clone();
        let label = label.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(FULLSCREEN_LOSS_SETTLE).await;
            let dispatcher = app.clone();
            let reconcile_app = app.clone();
            let _ = dispatcher.run_on_main_thread(move || {
                reconcile_native_fullscreen_loss(&reconcile_app, &label, generation);
            });
        });
    }

    fn handle_native_fullscreen_state(app: &AppHandle, label: &str, is_fullscreen: bool) {
        let was_fullscreen = LAST_FULLSCREEN_STATES
            .lock()
            .ok()
            .and_then(|states| states.get(label).copied())
            == Some(true);

        if is_fullscreen {
            advance_fullscreen_loss_generation(label);
            commit_fullscreen_state(app, label, true);
        } else if was_fullscreen {
            schedule_native_fullscreen_loss(app, label);
        } else {
            commit_fullscreen_state(app, label, false);
        }
    }

    fn clear_tab_state(label: &str) {
        if let Ok(mut configured) = CONFIGURED_LABELS.lock() {
            configured.remove(label);
        }
        if let Ok(mut tokens) = HANDLER_TOKENS.lock() {
            tokens.remove(label);
        }
        if let Ok(mut tokens) = WEBMESSAGE_TOKENS.lock() {
            tokens.remove(label);
        }
        if let Ok(mut tokens) = ACCELERATOR_TOKENS.lock() {
            tokens.remove(label);
        }
        if let Ok(mut labels) = PERSISTENT_FULLSCREEN_LABELS.lock() {
            labels.remove(label);
        }
        if let Ok(mut generations) = FULLSCREEN_LOSS_GENERATIONS.lock() {
            generations.remove(label);
        }
        if let Ok(mut states) = LAST_FULLSCREEN_STATES.lock() {
            states.remove(label);
        }
    }

    pub fn setup_tab_fullscreen(app: &AppHandle, label: &str) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") {
            return Ok(());
        }

        {
            let configured = CONFIGURED_LABELS
                .lock()
                .map_err(|error| error.to_string())?;
            if configured.contains(label) {
                return Ok(());
            }
        }

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;

        let app_handle = app.clone();
        let tab_label = label.to_string();
        let label_for_store = label.to_string();
        let registered_token = Arc::new(Mutex::new(None::<i64>));
        let registered_webmessage = Arc::new(Mutex::new(None::<i64>));
        let registered_accelerator = Arc::new(Mutex::new(None::<i64>));

        let setup_result = webview.with_webview({
            let registered_token = Arc::clone(&registered_token);
            let registered_webmessage = Arc::clone(&registered_webmessage);
            let registered_accelerator = Arc::clone(&registered_accelerator);
            move |inner| unsafe {
                let controller = inner.controller();
                let Ok(core) = controller.CoreWebView2() else {
                    return;
                };

                let native_app = app_handle.clone();
                let label_for_handler = tab_label.clone();
                let handler = ContainsFullScreenElementChangedEventHandler::create(Box::new(
                    move |sender, _| {
                        let Some(webview) = sender else {
                            return Ok(());
                        };

                        let mut contains_fullscreen = BOOL::default();
                        if webview
                            .ContainsFullScreenElement(&mut contains_fullscreen)
                            .is_err()
                        {
                            return Ok(());
                        }

                        handle_native_fullscreen_state(
                            &native_app,
                            &label_for_handler,
                            contains_fullscreen.as_bool(),
                        );
                        Ok(())
                    },
                ));

                let mut token: i64 = 0;
                if core
                    .add_ContainsFullScreenElementChanged(&handler, &mut token)
                    .is_err()
                {
                    return;
                }

                if let Ok(mut slot) = registered_token.lock() {
                    *slot = Some(token);
                }

                if let Ok(mut tokens) = HANDLER_TOKENS.lock() {
                    tokens.insert(tab_label.clone(), token);
                }

                // Some sites (notably YouTube in affected WebView2 runtimes) update the
                // DOM fullscreen state without reliably raising the native changed event.
                // The page message is only a wake-up signal: never trust its payload.
                // Always read the authoritative fullscreen state back from WebView2.
                let fallback_app = app_handle.clone();
                let fallback_label = tab_label.clone();
                let webmessage_handler =
                    WebMessageReceivedEventHandler::create(Box::new(move |sender, args| {
                        let Some(webview) = sender else {
                            return Ok(());
                        };
                        let Some(args) = args else {
                            return Ok(());
                        };
                        let message = web_message_string(&args);
                        if crate::site_ui::validated_web_message_source(&webview, &args).is_none() {
                            return Ok(());
                        }
                        if message == "nebula-persistent-fullscreen-enter" {
                            #[cfg(debug_assertions)]
                            eprintln!("[nebula fullscreen] {fallback_label}: page entered persistent fallback");
                            if let Ok(mut labels) = PERSISTENT_FULLSCREEN_LABELS.lock() {
                                labels.insert(fallback_label.clone());
                            }
                            return Ok(());
                        }
                        if message == "nebula-persistent-fullscreen-exit" {
                            #[cfg(debug_assertions)]
                            eprintln!("[nebula fullscreen] {fallback_label}: page exited persistent fallback");
                            confirm_site_fullscreen_exit(
                                &fallback_app,
                                &fallback_label,
                            );
                            return Ok(());
                        }
                        if message != "nebula-fullscreen-state-changed" {
                            return Ok(());
                        }
                        let mut contains_fullscreen = BOOL::default();
                        if webview
                            .ContainsFullScreenElement(&mut contains_fullscreen)
                            .is_err()
                        {
                            return Ok(());
                        }
                        handle_native_fullscreen_state(
                            &fallback_app,
                            &fallback_label,
                            contains_fullscreen.as_bool(),
                        );
                        Ok(())
                    }));

                let mut webmessage_token = 0i64;
                if core
                    .add_WebMessageReceived(&webmessage_handler, &mut webmessage_token)
                    .is_err()
                {
                    return;
                }
                if let Ok(mut slot) = registered_webmessage.lock() {
                    *slot = Some(webmessage_token);
                }
                if let Ok(mut tokens) = WEBMESSAGE_TOKENS.lock() {
                    tokens.insert(tab_label.clone(), webmessage_token);
                }

                // WebView2 consumes Escape before the page receives a DOM key event in
                // some post-Alt+Tab states. Handle only Nebula's persistent fallback;
                // ordinary document fullscreen keeps WebView2's native Escape flow.
                let accelerator_app = app_handle.clone();
                let accelerator_label = tab_label.clone();
                let accelerator_handler =
                    AcceleratorKeyPressedEventHandler::create(Box::new(move |sender, args| {
                        let Some(controller) = sender else {
                            return Ok(());
                        };
                        let Some(args) = args else {
                            return Ok(());
                        };
                        let mut kind = COREWEBVIEW2_KEY_EVENT_KIND::default();
                        let mut virtual_key = 0u32;
                        let mut status = COREWEBVIEW2_PHYSICAL_KEY_STATUS::default();
                        if args.KeyEventKind(&mut kind).is_err()
                            || args.VirtualKey(&mut virtual_key).is_err()
                            || args.PhysicalKeyStatus(&mut status).is_err()
                        {
                            return Ok(());
                        }
                        if (kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                            && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN)
                            || status.WasKeyDown.as_bool()
                            || virtual_key != 0x1B
                        {
                            return Ok(());
                        }

                        let persistent = PERSISTENT_FULLSCREEN_LABELS
                            .lock()
                            .map(|mut labels| labels.remove(&accelerator_label))
                            .unwrap_or(false);
                        if !persistent {
                            return Ok(());
                        }

                        let _ = args.SetHandled(true);
                        if let Ok(core) = controller.CoreWebView2() {
                            let script = HSTRING::from(
                                "window.__nebulaExitPersistentFullscreenFromHost?.()",
                            );
                            let execute_handler = ExecuteScriptCompletedHandler::create(Box::new(
                                |_result, _value| Ok(()),
                            ));
                            let _ = core.ExecuteScript(PCWSTR(script.as_ptr()), &execute_handler);
                        }
                        confirm_site_fullscreen_exit(&accelerator_app, &accelerator_label);
                        Ok(())
                    }));

                let mut accelerator_token = 0i64;
                if controller
                    .add_AcceleratorKeyPressed(&accelerator_handler, &mut accelerator_token)
                    .is_err()
                {
                    return;
                }
                if let Ok(mut slot) = registered_accelerator.lock() {
                    *slot = Some(accelerator_token);
                }
                if let Ok(mut tokens) = ACCELERATOR_TOKENS.lock() {
                    tokens.insert(tab_label.clone(), accelerator_token);
                }
                HANDLERS.with(|handlers| {
                    handlers.borrow_mut().insert(
                        tab_label.clone(),
                        (handler, webmessage_handler, accelerator_handler),
                    );
                });

                let script = HSTRING::from(FULLSCREEN_FALLBACK_SCRIPT);
                let execute_handler =
                    ExecuteScriptCompletedHandler::create(Box::new(|_result, _value| Ok(())));
                let _ = core.ExecuteScript(PCWSTR(script.as_ptr()), &execute_handler);

                let document_handler = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(
                    Box::new(|_result, _id| Ok(())),
                );
                let _ = core.AddScriptToExecuteOnDocumentCreated(
                    PCWSTR(script.as_ptr()),
                    &document_handler,
                );
            }
        });

        if let Err(error) = setup_result {
            teardown_tab_fullscreen(app, label);
            return Err(error.to_string());
        }

        let registered = registered_token.lock().ok().and_then(|slot| *slot);
        let fallback_registered = registered_webmessage.lock().ok().and_then(|slot| *slot);
        let accelerator_registered = registered_accelerator.lock().ok().and_then(|slot| *slot);
        if registered.is_none() || fallback_registered.is_none() || accelerator_registered.is_none()
        {
            teardown_tab_fullscreen(app, label);
            return Err(format!(
                "failed to register fullscreen handler for '{label}'"
            ));
        }

        let mut configured = CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?;
        configured.insert(label_for_store);

        Ok(())
    }

    pub fn teardown_tab_fullscreen(app: &AppHandle, label: &str) {
        if !label.starts_with("nebula-tab-") {
            return;
        }

        let token = HANDLER_TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));

        let webmessage_token = WEBMESSAGE_TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));
        let accelerator_token = ACCELERATOR_TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));
        let label_for_handler = label.to_string();

        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(move |inner| unsafe {
                let controller = inner.controller();
                if let Ok(core) = controller.CoreWebView2() {
                    if let Some(token) = token {
                        let _ = core.remove_ContainsFullScreenElementChanged(token);
                    }
                    if let Some(token) = webmessage_token {
                        let _ = core.remove_WebMessageReceived(token);
                    }
                }
                if let Some(token) = accelerator_token {
                    let _ = controller.remove_AcceleratorKeyPressed(token);
                }
                HANDLERS.with(|handlers| {
                    handlers.borrow_mut().remove(&label_for_handler);
                });
            });
        }

        clear_tab_state(label);
    }
}

#[cfg(target_os = "windows")]
pub use imp::{setup_tab_fullscreen, teardown_tab_fullscreen};

#[cfg(not(target_os = "windows"))]
pub fn setup_tab_fullscreen(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_tab_fullscreen(_app: &tauri::AppHandle, _label: &str) {}
