#[cfg(target_os = "windows")]
mod imp {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use std::sync::{LazyLock, Mutex};

    use tauri::{AppHandle, Emitter, Manager};
    use webview2_com::AcceleratorKeyPressedEventHandler;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2AcceleratorKeyPressedEventHandler, COREWEBVIEW2_KEY_EVENT_KIND,
        COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN, COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN,
        COREWEBVIEW2_PHYSICAL_KEY_STATUS,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetKeyState, VK_ADD, VK_CONTROL, VK_MENU, VK_SHIFT,
    };

    static HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    thread_local! {
        static HANDLERS: RefCell<HashMap<String, ICoreWebView2AcceleratorKeyPressedEventHandler>> =
            RefCell::new(HashMap::new());
    }

    fn pressed(key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY) -> bool {
        unsafe { GetKeyState(key.0 as i32) < 0 }
    }

    fn shortcut_for_key(
        virtual_key: u32,
        ctrl: bool,
        shift: bool,
        alt: bool,
    ) -> Option<&'static str> {
        if ctrl && !alt {
            return match virtual_key {
                0x54 if shift => Some("reopen-tab"),
                0x54 => Some("new-tab"),
                0x57 if !shift => Some("close-tab"),
                0x09 if shift => Some("prev-tab"),
                0x09 => Some("next-tab"),
                0x31..=0x38 if !shift => Some(match virtual_key {
                    0x31 => "switch-tab-1",
                    0x32 => "switch-tab-2",
                    0x33 => "switch-tab-3",
                    0x34 => "switch-tab-4",
                    0x35 => "switch-tab-5",
                    0x36 => "switch-tab-6",
                    0x37 => "switch-tab-7",
                    _ => "switch-tab-8",
                }),
                0x39 if !shift => Some("switch-tab-last"),
                0x52 if !shift => Some("reload"),
                0x4C if !shift => Some("focus-url-bar"),
                0x48 if !shift => Some("go-home"),
                0x49 if shift => Some("devtools"),
                0x30 if !shift => Some("zoom-reset"),
                0xBD if !shift => Some("zoom-out"),
                0xBB => Some("zoom-in"),
                value if value == VK_ADD.0 as u32 => Some("zoom-in"),
                _ => None,
            };
        }

        if alt && !ctrl {
            return match virtual_key {
                0x25 => Some("go-back"),
                0x27 => Some("go-forward"),
                0x44 if !shift => Some("focus-url-bar"),
                _ => None,
            };
        }

        match virtual_key {
            0x74 => Some("reload"),
            0x7B => Some("devtools"),
            _ => None,
        }
    }

    pub fn setup_tab_shortcuts(app: &AppHandle, label: &str) -> Result<(), String> {
        if !label.starts_with("nebula-tab-") {
            return Ok(());
        }
        if HANDLER_TOKENS
            .lock()
            .map_err(|error| error.to_string())?
            .contains_key(label)
        {
            return Ok(());
        }

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;
        let app_handle = app.clone();
        let label_for_store = label.to_string();

        webview
            .with_webview(move |inner| unsafe {
                let controller = inner.controller();
                let handler =
                    AcceleratorKeyPressedEventHandler::create(Box::new(move |_sender, args| {
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
                        if kind != COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN
                            && kind != COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN
                        {
                            return Ok(());
                        }
                        if status.WasKeyDown.as_bool() {
                            return Ok(());
                        }
                        if let Some(action) = shortcut_for_key(
                            virtual_key,
                            pressed(VK_CONTROL),
                            pressed(VK_SHIFT),
                            pressed(VK_MENU),
                        ) {
                            let _ = args.SetHandled(true);
                            if action != "devtools" || cfg!(debug_assertions) {
                                let _ = app_handle.emit("nebula-browser-shortcut", action);
                            }
                        }
                        Ok(())
                    }));

                let mut token = 0i64;
                if controller
                    .add_AcceleratorKeyPressed(&handler, &mut token)
                    .is_err()
                {
                    return;
                }
                if let Ok(mut tokens) = HANDLER_TOKENS.lock() {
                    tokens.insert(label_for_store.clone(), token);
                }
                HANDLERS.with(|handlers| {
                    handlers
                        .borrow_mut()
                        .insert(label_for_store.clone(), handler);
                });
            })
            .map_err(|error| error.to_string())?;

        if !HANDLER_TOKENS
            .lock()
            .map_err(|error| error.to_string())?
            .contains_key(label)
        {
            return Err(format!("failed to register shortcuts for '{label}'"));
        }
        Ok(())
    }

    pub fn teardown_tab_shortcuts(app: &AppHandle, label: &str) {
        let token = HANDLER_TOKENS
            .lock()
            .ok()
            .and_then(|mut tokens| tokens.remove(label));
        let label_for_handler = label.to_string();

        if let Some(webview) = app.get_webview(label) {
            let _ = webview.with_webview(move |inner| unsafe {
                if let Some(token) = token {
                    let _ = inner.controller().remove_AcceleratorKeyPressed(token);
                }
                HANDLERS.with(|handlers| {
                    handlers.borrow_mut().remove(&label_for_handler);
                });
            });
        }
    }

    #[cfg(test)]
    mod tests {
        use super::shortcut_for_key;

        #[test]
        fn maps_browser_shortcuts_with_exact_modifiers() {
            assert_eq!(shortcut_for_key(0x54, true, false, false), Some("new-tab"));
            assert_eq!(
                shortcut_for_key(0x54, true, true, false),
                Some("reopen-tab")
            );
            assert_eq!(shortcut_for_key(0x25, false, false, true), Some("go-back"));
            assert_eq!(shortcut_for_key(0x74, false, false, false), Some("reload"));
            assert_eq!(shortcut_for_key(0x54, true, false, true), None);
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{setup_tab_shortcuts, teardown_tab_shortcuts};

#[cfg(not(target_os = "windows"))]
pub fn setup_tab_shortcuts(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_tab_shortcuts(_app: &tauri::AppHandle, _label: &str) {}
