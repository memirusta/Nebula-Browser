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
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VK_CONTROL, VK_MENU, VK_SHIFT};

    static HANDLER_TOKENS: LazyLock<Mutex<HashMap<String, i64>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));
    static SHORTCUT_BINDINGS: LazyLock<Mutex<HashMap<String, Vec<String>>>> =
        LazyLock::new(|| Mutex::new(default_bindings()));

    thread_local! {
        static HANDLERS: RefCell<HashMap<String, ICoreWebView2AcceleratorKeyPressedEventHandler>> =
            RefCell::new(HashMap::new());
    }

    fn default_bindings() -> HashMap<String, Vec<String>> {
        HashMap::from([
            ("new-window".into(), vec!["Ctrl+N".into()]),
            ("close-tab".into(), vec!["Ctrl+W".into()]),
            ("reopen-tab".into(), vec!["Ctrl+Shift+T".into()]),
            ("next-tab".into(), vec!["Ctrl+Tab".into()]),
            ("prev-tab".into(), vec!["Ctrl+Shift+Tab".into()]),
            ("switch-tab-1".into(), vec!["Ctrl+1".into()]),
            ("switch-tab-2".into(), vec!["Ctrl+2".into()]),
            ("switch-tab-3".into(), vec!["Ctrl+3".into()]),
            ("switch-tab-4".into(), vec!["Ctrl+4".into()]),
            ("switch-tab-5".into(), vec!["Ctrl+5".into()]),
            ("switch-tab-6".into(), vec!["Ctrl+6".into()]),
            ("switch-tab-7".into(), vec!["Ctrl+7".into()]),
            ("switch-tab-8".into(), vec!["Ctrl+8".into()]),
            ("switch-tab-last".into(), vec!["Ctrl+9".into()]),
            ("reload".into(), vec!["Ctrl+R".into(), "F5".into()]),
            (
                "focus-url-bar".into(),
                vec!["Ctrl+L".into(), "Alt+D".into()],
            ),
            ("go-back".into(), vec!["Alt+ArrowLeft".into()]),
            ("go-forward".into(), vec!["Alt+ArrowRight".into()]),
            ("go-home".into(), vec!["Ctrl+T".into()]),
            ("open-history".into(), vec!["Ctrl+H".into()]),
            ("open-tab-search".into(), vec!["Ctrl+Shift+A".into()]),
            ("zoom-in".into(), vec!["Ctrl++".into(), "Ctrl+=".into()]),
            ("zoom-out".into(), vec!["Ctrl+-".into()]),
            ("zoom-reset".into(), vec!["Ctrl+0".into()]),
            ("print".into(), vec!["Ctrl+P".into()]),
            ("toggle-fullscreen".into(), vec!["F11".into()]),
            ("devtools".into(), vec!["Ctrl+Shift+I".into(), "F12".into()]),
        ])
    }

    fn pressed(key: windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY) -> bool {
        unsafe { GetKeyState(key.0 as i32) < 0 }
    }

    fn key_name(virtual_key: u32, shift: bool) -> Option<(&'static str, bool)> {
        let key = match virtual_key {
            0x30..=0x39 => match virtual_key {
                0x30 => "0",
                0x31 => "1",
                0x32 => "2",
                0x33 => "3",
                0x34 => "4",
                0x35 => "5",
                0x36 => "6",
                0x37 => "7",
                0x38 => "8",
                _ => "9",
            },
            0x41..=0x5A => match virtual_key {
                0x41 => "A",
                0x42 => "B",
                0x43 => "C",
                0x44 => "D",
                0x45 => "E",
                0x46 => "F",
                0x47 => "G",
                0x48 => "H",
                0x49 => "I",
                0x4A => "J",
                0x4B => "K",
                0x4C => "L",
                0x4D => "M",
                0x4E => "N",
                0x4F => "O",
                0x50 => "P",
                0x51 => "Q",
                0x52 => "R",
                0x53 => "S",
                0x54 => "T",
                0x55 => "U",
                0x56 => "V",
                0x57 => "W",
                0x58 => "X",
                0x59 => "Y",
                _ => "Z",
            },
            0x09 => "Tab",
            0x0D => "Enter",
            0x1B => "Escape",
            0x08 => "Backspace",
            0x2D => "Insert",
            0x2E => "Delete",
            0x24 => "Home",
            0x23 => "End",
            0x21 => "PageUp",
            0x22 => "PageDown",
            0x25 => "ArrowLeft",
            0x26 => "ArrowUp",
            0x27 => "ArrowRight",
            0x28 => "ArrowDown",
            0x70 => "F1",
            0x71 => "F2",
            0x72 => "F3",
            0x73 => "F4",
            0x74 => "F5",
            0x75 => "F6",
            0x76 => "F7",
            0x77 => "F8",
            0x78 => "F9",
            0x79 => "F10",
            0x7A => "F11",
            0x7B => "F12",
            0x6B => "+",          // VK_ADD
            0xBD => "-",          // VK_OEM_MINUS
            0xBB if shift => "+", // VK_OEM_PLUS with Shift
            0xBB => "=",
            _ => return None,
        };

        // Shift is only a glyph-producing detail for '+'.
        Some((key, key == "+" && shift))
    }

    fn canonical_binding(virtual_key: u32, ctrl: bool, shift: bool, alt: bool) -> Option<String> {
        let (key, implicit_shift) = key_name(virtual_key, shift)?;
        let mut parts: Vec<&str> = Vec::new();

        if ctrl {
            parts.push("Ctrl");
        }
        if alt {
            parts.push("Alt");
        }
        if shift && !implicit_shift {
            parts.push("Shift");
        }
        parts.push(key);

        Some(parts.join("+"))
    }

    fn action_for_binding(binding: &str) -> Option<String> {
        let bindings = SHORTCUT_BINDINGS.lock().ok()?;
        bindings.iter().find_map(|(action, values)| {
            values
                .iter()
                .any(|candidate| candidate == binding)
                .then(|| action.clone())
        })
    }

    pub fn set_shortcut_bindings(bindings: HashMap<String, Vec<String>>) -> Result<(), String> {
        let defaults = default_bindings();
        let mut next = HashMap::new();

        for (action, default_values) in defaults {
            let values = bindings
                .get(&action)
                .filter(|values| !values.is_empty())
                .cloned()
                .unwrap_or(default_values);
            next.insert(action, values);
        }

        *SHORTCUT_BINDINGS
            .lock()
            .map_err(|error| error.to_string())? = next;
        Ok(())
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
        let label_for_event = label.to_string();

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

                        let binding = canonical_binding(
                            virtual_key,
                            pressed(VK_CONTROL),
                            pressed(VK_SHIFT),
                            pressed(VK_MENU),
                        );

                        if let Some(action) = binding.as_deref().and_then(action_for_binding) {
                            let _ = args.SetHandled(true);
                            if let Some(webview) = app_handle.get_webview(&label_for_event) {
                                let target = webview.window().label().to_string();
                                let _ =
                                    app_handle.emit_to(target, "nebula-browser-shortcut", action);
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
        use super::{canonical_binding, default_bindings, set_shortcut_bindings};
        use std::collections::HashMap;

        #[test]
        fn canonicalizes_browser_shortcuts() {
            assert_eq!(
                canonical_binding(0x54, true, false, false).as_deref(),
                Some("Ctrl+T")
            );
            assert_eq!(
                canonical_binding(0x54, true, true, false).as_deref(),
                Some("Ctrl+Shift+T")
            );
            assert_eq!(
                canonical_binding(0x25, false, false, true).as_deref(),
                Some("Alt+ArrowLeft")
            );
            assert_eq!(
                canonical_binding(0x7A, false, false, false).as_deref(),
                Some("F11")
            );
            assert_eq!(
                canonical_binding(0xBB, true, true, false).as_deref(),
                Some("Ctrl++")
            );
        }

        #[test]
        fn custom_binding_map_can_replace_defaults() {
            let mut custom: HashMap<String, Vec<String>> = HashMap::new();
            custom.insert("go-home".into(), vec!["Ctrl+G".into()]);
            set_shortcut_bindings(custom).unwrap();

            let defaults = default_bindings();
            assert_eq!(
                defaults.get("go-home").unwrap(),
                &vec!["Ctrl+T".to_string()]
            );
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{set_shortcut_bindings, setup_tab_shortcuts, teardown_tab_shortcuts};

#[cfg(not(target_os = "windows"))]
pub fn set_shortcut_bindings(
    _bindings: std::collections::HashMap<String, Vec<String>>,
) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn setup_tab_shortcuts(_app: &tauri::AppHandle, _label: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_tab_shortcuts(_app: &tauri::AppHandle, _label: &str) {}
