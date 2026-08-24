#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::{HashMap, HashSet};
    use std::sync::{Arc, LazyLock, Mutex};

    use serde::{Deserialize, Serialize};
    use tauri::{AppHandle, Manager};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2NavigationCompletedEventHandler,
        ICoreWebView2NavigationStartingEventHandler,
    };
    use webview2_com::{
        AddScriptToExecuteOnDocumentCreatedCompletedHandler,
        CallDevToolsProtocolMethodCompletedHandler, ExecuteScriptCompletedHandler,
        NavigationCompletedEventHandler, NavigationStartingEventHandler,
    };
    use windows::core::PCWSTR;
    use windows_core::{HSTRING, PWSTR};

    const FORCE_DARK_RUNTIME: &str = r###"
(() => {
  'use strict';
  if (window.__nebulaForceDark && window.__nebulaForceDark.version === 1) return;

  const MEDIA_SELECTOR = 'img,video,canvas,svg,picture,iframe,object,embed,[role="img"]';
  const MARK_SELECTOR = '[data-nebula-dark-bg],[data-nebula-dark-text],[data-nebula-dark-border]';
  const STYLE_ID = 'nebula-force-dark-style';
  const canReportToHost =
    location.protocol === 'http:' || location.protocol === 'https:';
  const postToHost = canReportToHost && typeof window.chrome?.webview?.postMessage === 'function'
    ? window.chrome.webview.postMessage.bind(window.chrome.webview)
    : null;
  let observer = null;
  let scheduled = false;
  let active = false;
  let queue = [];
  let statusTimer = 0;
  let mutationStatusReported = false;

  function reportStatus(mode, mutationObserved) {
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      try {
        const media = Array.from(document.querySelectorAll(MEDIA_SELECTOR));
        const mediaProtected = media.every((element) =>
          !element.hasAttribute('data-nebula-dark-bg') &&
          !element.hasAttribute('data-nebula-dark-text') &&
          !element.hasAttribute('data-nebula-dark-border')
        );
        postToHost?.(JSON.stringify({
          type: 'nebula-force-dark-status',
          origin: location.origin,
          mode,
          mediaProtected,
          mutationObserved: Boolean(mutationObserved)
        }));
      } catch (_) {}
    }, 80);
  }

  function parseColor(value) {
    const match = String(value || '').match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?/i);
    if (!match) return null;
    return {
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
      a: match[4] === undefined ? 1 : Number(match[4])
    };
  }

  function luminance(color) {
    if (!color) return 0;
    const channels = [color.r, color.g, color.b].map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  }

  function nativeDarkPage() {
    const candidates = [document.documentElement, document.body].filter(Boolean);
    if (document.body) {
      const selectors = 'main,header,nav,section,article,aside,[role="main"],[role="dialog"]';
      for (const element of document.body.querySelectorAll(selectors)) {
        if (candidates.length >= 64) break;
        const rect = element.getBoundingClientRect();
        if (rect.width > 80 && rect.height > 40) candidates.push(element);
      }
    }

    let dark = 0;
    let light = 0;
    for (const element of candidates) {
      const color = parseColor(getComputedStyle(element).backgroundColor);
      if (!color || color.a < 0.15) continue;
      const value = luminance(color);
      if (value < 0.28) dark += 1;
      if (value > 0.62) light += 1;
    }
    return dark > 0 && (light === 0 || dark / (dark + light) >= 0.6);
  }

  function ensureStyle() {
    let style = document.getElementById(STYLE_ID);
    if (style) return style;
    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      html[data-nebula-force-dark="algorithm"] {
        color-scheme: dark !important;
        background-color: #111315 !important;
      }
      html[data-nebula-force-dark="algorithm"] body {
        background-color: #111315 !important;
      }
      html[data-nebula-force-dark="algorithm"] [data-nebula-dark-bg="deep"] {
        background-color: #181a1b !important;
      }
      html[data-nebula-force-dark="algorithm"] [data-nebula-dark-bg="soft"] {
        background-color: #202326 !important;
      }
      html[data-nebula-force-dark="algorithm"] [data-nebula-dark-text] {
        color: #e8e6e3 !important;
      }
      html[data-nebula-force-dark="algorithm"] a[data-nebula-dark-text] {
        color: #8ab4f8 !important;
      }
      html[data-nebula-force-dark="algorithm"] [data-nebula-dark-border] {
        border-color: #4b5155 !important;
        outline-color: #6a7278 !important;
      }
      html[data-nebula-force-dark="algorithm"] :is(input,textarea,select,button) {
        color-scheme: dark !important;
      }
      html[data-nebula-force-dark="algorithm"] ::placeholder {
        color: #a9a49c !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    return style;
  }

  function shouldSkip(element) {
    return !(element instanceof Element) || element.matches(MEDIA_SELECTOR) || Boolean(element.closest('svg'));
  }

  function markElement(element) {
    if (shouldSkip(element)) return;
    const style = getComputedStyle(element);
    const background = parseColor(style.backgroundColor);
    if (background && background.a >= 0.12) {
      const value = luminance(background);
      if (value > 0.72) element.dataset.nebulaDarkBg = 'deep';
      else if (value > 0.42) element.dataset.nebulaDarkBg = 'soft';
      else delete element.dataset.nebulaDarkBg;
    } else {
      delete element.dataset.nebulaDarkBg;
    }

    const foreground = parseColor(style.color);
    const hasText = Array.from(element.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent && node.textContent.trim())
    );
    if (foreground && hasText && luminance(foreground) < 0.48) {
      element.dataset.nebulaDarkText = 'true';
    } else {
      delete element.dataset.nebulaDarkText;
    }

    const border = parseColor(style.borderTopColor);
    if (border && border.a >= 0.12 && luminance(border) > 0.58) {
      element.dataset.nebulaDarkBorder = 'true';
    } else {
      delete element.dataset.nebulaDarkBorder;
    }
  }

  function schedulePump() {
    if (scheduled || !active) return;
    scheduled = true;
    const run = (deadline) => {
      scheduled = false;
      let budget = 900;
      while (active && queue.length && budget > 0) {
        const element = queue.shift();
        if (!(element instanceof Element) || !element.isConnected) continue;
        markElement(element);
        for (const child of element.children) queue.push(child);
        budget -= 1;
        if (deadline && deadline.timeRemaining() < 2) break;
      }
      if (queue.length) schedulePump();
    };
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(run, { timeout: 120 });
    } else {
      setTimeout(() => run(null), 16);
    }
  }

  function enqueue(element) {
    if (!(element instanceof Element)) return;
    queue.push(element);
    schedulePump();
  }

  function disableAlgorithm() {
    active = false;
    queue = [];
    observer?.disconnect();
    observer = null;
    document.documentElement?.removeAttribute('data-nebula-force-dark');
    document.getElementById(STYLE_ID)?.remove();
    for (const element of document.querySelectorAll(MARK_SELECTOR)) {
      element.removeAttribute('data-nebula-dark-bg');
      element.removeAttribute('data-nebula-dark-text');
      element.removeAttribute('data-nebula-dark-border');
    }
  }

  function enableAlgorithm() {
    disableAlgorithm();
    active = true;
    mutationStatusReported = false;
    ensureStyle();
    document.documentElement.dataset.nebulaForceDark = 'algorithm';
    enqueue(document.body || document.documentElement);
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') enqueue(mutation.target);
        for (const node of mutation.addedNodes) enqueue(node);
      }
      if (!mutationStatusReported) {
        mutationStatusReported = true;
        reportStatus('algorithm', true);
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
    reportStatus('algorithm', false);
  }

  function matchingOverride(overrides) {
    const hostname = location.hostname.toLowerCase();
    let matched = '';
    for (const host of Object.keys(overrides || {})) {
      if ((hostname === host || hostname.endsWith(`.${host}`)) && host.length > matched.length) {
        matched = host;
      }
    }
    return matched ? overrides[matched] : null;
  }

  function apply(options) {
    const override = matchingOverride(options.siteOverrides);
    const mode = override || options.mode;
    const environmentDark = options.theme === 'forest' || options.theme === 'dark' || options.systemDark;
    const wantsDark = mode === 'always' || (mode === 'auto' && environmentDark);
    if (!wantsDark) {
      disableAlgorithm();
      reportStatus('off', false);
      return;
    }

    const evaluate = () => {
      if (nativeDarkPage()) {
        disableAlgorithm();
        document.documentElement.dataset.nebulaForceDark = 'native';
        reportStatus('native', false);
      } else {
        enableAlgorithm();
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', evaluate, { once: true });
    } else {
      queueMicrotask(evaluate);
    }
  }

  Object.defineProperty(window, '__nebulaForceDark', {
    configurable: false,
    enumerable: false,
    value: { version: 1, apply }
  });
})();
"###;

    #[derive(Clone, Debug, Deserialize, Serialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ForceDarkOptions {
        mode: String,
        theme: String,
        system_dark: bool,
        site_overrides: HashMap<String, String>,
    }

    impl Default for ForceDarkOptions {
        fn default() -> Self {
            Self {
                mode: "off".to_string(),
                theme: "forest".to_string(),
                system_dark: false,
                site_overrides: HashMap::new(),
            }
        }
    }

    impl ForceDarkOptions {
        fn normalize(mut self) -> Self {
            if !matches!(self.mode.as_str(), "off" | "auto" | "always") {
                self.mode = "off".to_string();
            }
            if !matches!(self.theme.as_str(), "forest" | "dark" | "light") {
                self.theme = "forest".to_string();
            }
            let mut entries = self.site_overrides.into_iter().collect::<Vec<_>>();
            entries.sort_by(|left, right| left.0.cmp(&right.0));
            self.site_overrides = entries
                .into_iter()
                .filter_map(|(host, mode)| {
                    let host = host.trim().to_ascii_lowercase();
                    let valid_host = !host.is_empty()
                        && host.len() <= 253
                        && host.bytes().all(|value| {
                            value.is_ascii_lowercase()
                                || value.is_ascii_digit()
                                || value == b'.'
                                || value == b'-'
                        });
                    (valid_host && matches!(mode.as_str(), "off" | "always"))
                        .then_some((host, mode))
                })
                .take(256)
                .collect();
            self
        }

        fn matching_override(&self, hostname: &str) -> Option<&str> {
            self.site_overrides
                .iter()
                .filter(|(host, _)| {
                    hostname == host.as_str()
                        || hostname
                            .strip_suffix(host.as_str())
                            .is_some_and(|prefix| prefix.ends_with('.'))
                })
                .max_by_key(|(host, _)| host.len())
                .map(|(_, mode)| mode.as_str())
        }

        fn wants_dark_for_url(&self, target_url: &str) -> bool {
            let hostname = url::Url::parse(target_url)
                .ok()
                .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
                .unwrap_or_default();
            let mode = self.matching_override(&hostname).unwrap_or(&self.mode);
            mode == "always"
                || mode == "auto"
                    && (self.theme == "forest" || self.theme == "dark" || self.system_dark)
        }
    }

    #[derive(Clone, Copy)]
    struct HandlerTokens {
        navigation_starting: i64,
        navigation_completed: i64,
    }

    struct Handlers {
        _navigation_starting: ICoreWebView2NavigationStartingEventHandler,
        _navigation_completed: ICoreWebView2NavigationCompletedEventHandler,
    }

    static OPTIONS: LazyLock<Mutex<HashMap<String, ForceDarkOptions>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static TOKENS: LazyLock<Mutex<HashMap<String, HandlerTokens>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static CONFIGURED: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));

    thread_local! {
        static HANDLERS: RefCell<HashMap<String, Handlers>> = RefCell::new(HashMap::new());
    }

    fn is_site_label(label: &str) -> bool {
        label.starts_with("nebula-tab-") || label.starts_with("nebula-popup-content-")
    }

    fn options(label: &str) -> ForceDarkOptions {
        OPTIONS
            .lock()
            .ok()
            .and_then(|values| values.get(label).cloned())
            .unwrap_or_default()
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

    unsafe fn set_preferred_media(
        core: &ICoreWebView2,
        current: &ForceDarkOptions,
        target_url: &str,
    ) {
        let params = if current.wants_dark_for_url(target_url) {
            r#"{"features":[{"name":"prefers-color-scheme","value":"dark"}]}"#
        } else {
            r#"{"features":[]}"#
        };
        let handler =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_result, _value| Ok(())));
        let method = HSTRING::from("Emulation.setEmulatedMedia");
        let params = HSTRING::from(params);
        let _ = core.CallDevToolsProtocolMethod(
            PCWSTR(method.as_ptr()),
            PCWSTR(params.as_ptr()),
            &handler,
        );
    }

    unsafe fn apply_runtime(
        core: &ICoreWebView2,
        current: &ForceDarkOptions,
    ) -> windows_core::Result<()> {
        let options_json = serde_json::to_string(current).unwrap_or_else(|_| "{}".to_string());
        let script = HSTRING::from(format!("window.__nebulaForceDark?.apply({options_json});"));
        let handler = ExecuteScriptCompletedHandler::create(Box::new(|_result, _value| Ok(())));
        core.ExecuteScript(PCWSTR(script.as_ptr()), &handler)
    }

    pub fn setup(app: &AppHandle, label: &str) -> Result<(), String> {
        if !is_site_label(label) {
            return Err(
                "force dark pages is limited to browser tabs and popup content".to_string(),
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
        let setup_error = Arc::new(Mutex::new(None::<String>));
        let failure_slot = setup_error.clone();
        let setup_label = label.to_string();

        webview
            .with_webview(move |inner| unsafe {
                let result = (|| -> windows_core::Result<()> {
                    let core = inner.controller().CoreWebView2()?;
                    let script = HSTRING::from(FORCE_DARK_RUNTIME);
                    let document_handler =
                        AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
                            |_result, _id| Ok(()),
                        ));
                    core.AddScriptToExecuteOnDocumentCreated(
                        PCWSTR(script.as_ptr()),
                        &document_handler,
                    )?;

                    let starting_label = setup_label.clone();
                    let navigation_starting =
                        NavigationStartingEventHandler::create(Box::new(move |sender, args| {
                            let (Some(sender), Some(args)) = (sender, args) else {
                                return Ok(());
                            };
                            let target_url = take_string(|value| args.Uri(value));
                            set_preferred_media(&sender, &options(&starting_label), &target_url);
                            Ok(())
                        }));
                    let completed_label = setup_label.clone();
                    let navigation_completed =
                        NavigationCompletedEventHandler::create(Box::new(move |sender, _| {
                            let Some(sender) = sender else { return Ok(()) };
                            let current = options(&completed_label);
                            let target_url = take_string(|value| sender.Source(value));
                            set_preferred_media(&sender, &current, &target_url);
                            let _ = apply_runtime(&sender, &current);
                            Ok(())
                        }));

                    let mut starting_token = 0i64;
                    core.add_NavigationStarting(&navigation_starting, &mut starting_token)?;
                    let mut completed_token = 0i64;
                    if let Err(error) =
                        core.add_NavigationCompleted(&navigation_completed, &mut completed_token)
                    {
                        let _ = core.remove_NavigationStarting(starting_token);
                        return Err(error);
                    }

                    if let Ok(mut tokens) = TOKENS.lock() {
                        tokens.insert(
                            setup_label.clone(),
                            HandlerTokens {
                                navigation_starting: starting_token,
                                navigation_completed: completed_token,
                            },
                        );
                    } else {
                        let _ = core.remove_NavigationStarting(starting_token);
                        let _ = core.remove_NavigationCompleted(completed_token);
                        return Err(windows_core::Error::from_hresult(windows_core::HRESULT(
                            0x80004005u32 as i32,
                        )));
                    }
                    HANDLERS.with(|handlers| {
                        handlers.borrow_mut().insert(
                            setup_label.clone(),
                            Handlers {
                                _navigation_starting: navigation_starting,
                                _navigation_completed: navigation_completed,
                            },
                        );
                    });

                    let execute_handler =
                        ExecuteScriptCompletedHandler::create(Box::new(|_result, _value| Ok(())));
                    core.ExecuteScript(PCWSTR(script.as_ptr()), &execute_handler)?;
                    let current = options(&setup_label);
                    let target_url = take_string(|value| core.Source(value));
                    set_preferred_media(&core, &current, &target_url);
                    apply_runtime(&core, &current)
                })();

                if let Err(error) = result {
                    if let Ok(mut failure) = failure_slot.lock() {
                        *failure = Some(error.to_string());
                    }
                }
            })
            .map_err(|error| error.to_string())?;

        if let Some(error) = setup_error
            .lock()
            .map_err(|error| error.to_string())?
            .take()
        {
            teardown(app, label);
            return Err(error);
        }
        if !TOKENS
            .lock()
            .map_err(|error| error.to_string())?
            .contains_key(label)
        {
            return Err(format!(
                "failed to register force dark handlers for '{label}'"
            ));
        }
        CONFIGURED
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string());
        Ok(())
    }

    pub fn apply(app: &AppHandle, label: &str, incoming: ForceDarkOptions) -> Result<(), String> {
        setup(app, label)?;
        let current = incoming.normalize();
        OPTIONS
            .lock()
            .map_err(|error| error.to_string())?
            .insert(label.to_string(), current.clone());

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let apply_error = Arc::new(Mutex::new(None::<String>));
        let failure_slot = apply_error.clone();
        webview
            .with_webview(move |inner| unsafe {
                let result = (|| -> windows_core::Result<()> {
                    let core = inner.controller().CoreWebView2()?;
                    let target_url = take_string(|value| core.Source(value));
                    set_preferred_media(&core, &current, &target_url);
                    apply_runtime(&core, &current)
                })();
                if let Err(error) = result {
                    if let Ok(mut failure) = failure_slot.lock() {
                        *failure = Some(error.to_string());
                    }
                }
            })
            .map_err(|error| error.to_string())?;
        if let Some(error) = apply_error
            .lock()
            .map_err(|error| error.to_string())?
            .take()
        {
            return Err(error);
        }
        Ok(())
    }

    pub fn teardown(app: &AppHandle, label: &str) {
        let tokens = TOKENS
            .lock()
            .ok()
            .and_then(|mut values| values.remove(label));
        let handler_label = label.to_string();
        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(move |inner| unsafe {
                if let (Ok(core), Some(tokens)) = (inner.controller().CoreWebView2(), tokens) {
                    let _ = core.remove_NavigationStarting(tokens.navigation_starting);
                    let _ = core.remove_NavigationCompleted(tokens.navigation_completed);
                }
                HANDLERS.with(|handlers| {
                    handlers.borrow_mut().remove(&handler_label);
                });
            });
        }
        OPTIONS.lock().ok().map(|mut values| values.remove(label));
        CONFIGURED
            .lock()
            .ok()
            .map(|mut values| values.remove(label));
    }

    #[cfg(test)]
    mod tests {
        use super::ForceDarkOptions;
        use std::collections::HashMap;

        #[test]
        fn site_override_is_more_specific_than_global_mode() {
            let options = ForceDarkOptions {
                mode: "always".to_string(),
                theme: "dark".to_string(),
                system_dark: true,
                site_overrides: HashMap::from([("example.com".to_string(), "off".to_string())]),
            };
            assert!(!options.wants_dark_for_url("https://mail.example.com/inbox"));
            assert!(options.wants_dark_for_url("https://example.org"));
        }

        #[test]
        fn auto_follows_nebula_or_system_dark_environment() {
            let mut options = ForceDarkOptions {
                mode: "auto".to_string(),
                theme: "light".to_string(),
                system_dark: false,
                site_overrides: HashMap::new(),
            };
            assert!(!options.wants_dark_for_url("https://example.com"));
            options.system_dark = true;
            assert!(options.wants_dark_for_url("https://example.com"));
        }
    }
}

#[cfg(not(target_os = "windows"))]
mod imp {
    use serde::Deserialize;
    use std::collections::HashMap;
    use tauri::AppHandle;

    #[derive(Clone, Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct ForceDarkOptions {
        mode: String,
        theme: String,
        system_dark: bool,
        site_overrides: HashMap<String, String>,
    }

    pub fn setup(_app: &AppHandle, _label: &str) -> Result<(), String> {
        Ok(())
    }

    pub fn apply(_app: &AppHandle, _label: &str, options: ForceDarkOptions) -> Result<(), String> {
        let _ = (
            options.mode,
            options.theme,
            options.system_dark,
            options.site_overrides,
        );
        Ok(())
    }

    pub fn teardown(_app: &AppHandle, _label: &str) {}
}

pub use imp::{apply, setup, teardown, ForceDarkOptions};
