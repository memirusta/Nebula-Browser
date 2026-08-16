pub fn is_nebula_webview_label(label: &str) -> bool {
    label == "main"
        || label == "nebula-chrome"
        || label.starts_with("nebula-tab-")
        || label.starts_with("nebula-popup-content-")
}

#[cfg(target_os = "windows")]
mod imp {
    use std::collections::{HashMap, HashSet};
    use std::sync::{LazyLock, Mutex};
    use std::time::Duration;

    use tauri::{AppHandle, Manager};
    use webview2_com::{
        take_pwstr, CallDevToolsProtocolMethodCompletedHandler,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Settings2, ICoreWebView2Settings3,
            ICoreWebView2Settings4,
        },
    };
    use windows_core::{HSTRING, Interface, PWSTR};

    use super::is_nebula_webview_label;

    static CONFIGURED_LABELS: LazyLock<Mutex<HashSet<String>>> =
        LazyLock::new(|| Mutex::new(HashSet::new()));
    static IDENTITY_PARAMS: LazyLock<Mutex<HashMap<String, String>>> =
        LazyLock::new(|| Mutex::new(HashMap::new()));

    fn is_site_webview_label(label: &str) -> bool {
        label.starts_with("nebula-tab-") || label.starts_with("nebula-popup-content-")
    }

    fn nebula_full_version() -> &'static str {
        env!("CARGO_PKG_VERSION")
    }

    fn nebula_major_version() -> String {
        nebula_full_version()
            .split('.')
            .next()
            .filter(|segment| !segment.is_empty())
            .unwrap_or("1")
            .to_string()
    }

    fn generic_chromium_user_agent(current: &str) -> Option<String> {
        let current = current.trim();
        if current.is_empty() {
            return None;
        }

        // Preserve WebView2's real Chromium/runtime compatibility tokens and
        // remove only the Microsoft Edge product token. This avoids pinning a
        // fake Chrome version that can drift away from the installed runtime.
        let base = current
            .split_ascii_whitespace()
            .filter(|token| !token.starts_with("Edg/"))
            .collect::<Vec<_>>()
            .join(" ");

        if base.is_empty() {
            return None;
        }

        let nebula_token = format!("Nebula/{}", nebula_full_version());
        let rewritten = if base
            .split_ascii_whitespace()
            .any(|token| token == nebula_token)
        {
            base
        } else {
            format!("{base} {nebula_token}")
        };

        if rewritten == current {
            None
        } else {
            Some(rewritten)
        }
    }

    fn chromium_version_from_user_agent(user_agent: &str) -> Option<(String, String)> {
        let full = user_agent
            .split_ascii_whitespace()
            .find_map(|token| token.strip_prefix("Chrome/"))?
            .trim();

        if full.is_empty() {
            return None;
        }

        let major = full.split('.').next()?.trim();
        if major.is_empty() || !major.chars().all(|character| character.is_ascii_digit()) {
            return None;
        }

        Some((major.to_string(), full.to_string()))
    }

    fn client_hints_override_json(user_agent: &str) -> Result<String, String> {
        let (major, full) = chromium_version_from_user_agent(user_agent)
            .ok_or_else(|| "Chromium version was not found in User-Agent".to_string())?;
        let nebula_major = nebula_major_version();
        let nebula_full = nebula_full_version();

        Ok(serde_json::json!({
            "userAgent": user_agent,
            "userAgentMetadata": {
                "brands": [
                    {
                        "brand": "Chromium",
                        "version": major,
                    },
                    {
                        "brand": "Nebula",
                        "version": nebula_major,
                    },
                    {
                        "brand": "Not_A Brand",
                        "version": "99",
                    },
                ],
                "fullVersionList": [
                    {
                        "brand": "Chromium",
                        "version": full,
                    },
                    {
                        "brand": "Nebula",
                        "version": nebula_full,
                    },
                    {
                        "brand": "Not_A Brand",
                        "version": "99.0.0.0",
                    },
                ],
                "fullVersion": full,
                "platform": "Windows",
                // Mandatory CDP UserAgentMetadata fields.
                "platformVersion": "",
                "architecture": "x86",
                "model": "",
                "mobile": false,
                "bitness": "64",
                "wow64": false,
            },
        })
        .to_string())
    }

    unsafe fn apply_site_user_agent(
        settings: &ICoreWebView2Settings2,
    ) -> Result<String, String> {
        let mut raw_user_agent = PWSTR::null();
        settings
            .UserAgent(&mut raw_user_agent)
            .map_err(|error| error.to_string())?;

        let current = take_pwstr(raw_user_agent);
        let current = current.trim();
        if current.is_empty() {
            return Err("WebView2 returned an empty User-Agent".to_string());
        }

        let rewritten =
            generic_chromium_user_agent(current).unwrap_or_else(|| current.to_string());

        if rewritten != current {
            let rewritten_hstring = HSTRING::from(&rewritten);
            settings
                .SetUserAgent(&rewritten_hstring)
                .map_err(|error| error.to_string())?;
        }

        Ok(rewritten)
    }

    unsafe fn apply_settings(
        inner: tauri::webview::PlatformWebview,
        label: &str,
    ) -> Result<(), String> {
        let core = inner
            .controller()
            .CoreWebView2()
            .map_err(|error| error.to_string())?;
        let settings = core.Settings().map_err(|error| error.to_string())?;

        settings
            .SetIsBuiltInErrorPageEnabled(false)
            .map_err(|error| error.to_string())?;
        settings
            .SetAreDefaultContextMenusEnabled(false)
            .map_err(|error| error.to_string())?;
        settings
            .SetIsStatusBarEnabled(false)
            .map_err(|error| error.to_string())?;
        settings
            .SetIsZoomControlEnabled(false)
            .map_err(|error| error.to_string())?;
        settings
            .SetAreHostObjectsAllowed(false)
            .map_err(|error| error.to_string())?;
        settings
            .SetAreDevToolsEnabled(false)
            .map_err(|error| error.to_string())?;

        // Only internet-facing WebViews receive the browser identity override.
        // Settings2 is synchronous, so the UA token is ready before setup returns.
        // The matching CDP Client-Hints override is stored here and applied by a
        // separate async Tauri command before the first external navigation.
        if is_site_webview_label(label) {
            if let Ok(settings2) = settings.cast::<ICoreWebView2Settings2>() {
                let user_agent = apply_site_user_agent(&settings2)?;
                let params = client_hints_override_json(&user_agent)?;
                IDENTITY_PARAMS
                    .lock()
                    .map_err(|error| error.to_string())?
                    .insert(label.to_string(), params);
            }
        }

        if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
            let _ = settings3.SetAreBrowserAcceleratorKeysEnabled(false);
        }

        if let Ok(settings4) = settings.cast::<ICoreWebView2Settings4>() {
            // Nebula owns credential storage and password UX. Keep WebView2's
            // separate password/general-autofill stores disabled so users never
            // see two competing password managers.
            let _ = settings4.SetIsPasswordAutosaveEnabled(false);
            let _ = settings4.SetIsGeneralAutofillEnabled(false);
        }

        Ok(())
    }

    pub fn setup_webview_branding(app: &AppHandle, label: &str) -> Result<(), String> {
        if !is_nebula_webview_label(label) {
            return Err(format!("webview branding is not allowed for '{label}'"));
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
        let label_for_setup = label.to_string();

        webview
            .with_webview(move |inner| {
                let result = unsafe { apply_settings(inner, &label_for_setup) };
                match result {
                    Ok(()) => {
                        if let Ok(mut configured) = CONFIGURED_LABELS.lock() {
                            configured.insert(label_for_setup.clone());
                        }
                    }
                    Err(error) => {
                        #[cfg(debug_assertions)]
                        eprintln!("[nebula branding] {}: {}", label_for_setup, error);
                    }
                }
            })
            .map_err(|error| error.to_string())?;

        if CONFIGURED_LABELS
            .lock()
            .map_err(|error| error.to_string())?
            .contains(label)
        {
            Ok(())
        } else {
            Err(format!("failed to configure webview '{label}'"))
        }
    }

    pub fn apply_browser_identity(app: &AppHandle, label: &str) -> Result<(), String> {
        if !is_site_webview_label(label) {
            return Err(format!("browser identity is not allowed for '{label}'"));
        }

        let params = IDENTITY_PARAMS
            .lock()
            .map_err(|error| error.to_string())?
            .get(label)
            .cloned()
            .ok_or_else(|| format!("browser identity is not prepared for '{label}'"))?;

        let webview = app
            .get_webview(label)
            .ok_or_else(|| format!("webview '{label}' not found"))?;

        let (tx, rx) = std::sync::mpsc::sync_channel(1);
        let label_for_callback = label.to_string();

        webview
            .with_webview(move |inner| unsafe {
                let core = match inner.controller().CoreWebView2() {
                    Ok(core) => core,
                    Err(error) => {
                        let _ = tx.send(Err(error.to_string()));
                        return;
                    }
                };

                let failure_tx = tx.clone();
                let method = HSTRING::from("Network.setUserAgentOverride");
                let params = HSTRING::from(params);
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |result, response| {
                        let output = result
                            .map(|_| response)
                            .map_err(|error| {
                                format!(
                                    "CDP User-Agent override failed for '{}': {}",
                                    label_for_callback, error
                                )
                            });
                        let _ = tx.send(output);
                        Ok(())
                    },
                ));

                if let Err(error) =
                    core.CallDevToolsProtocolMethod(&method, &params, &handler)
                {
                    let _ = failure_tx.send(Err(error.to_string()));
                }
            })
            .map_err(|error| error.to_string())?;

        let response = rx
            .recv_timeout(Duration::from_secs(3))
            .map_err(|_| format!("timed out applying browser identity to '{label}'"))??;

        if response.contains(r#""error""#) {
            return Err(format!(
                "CDP rejected browser identity for '{label}': {response}"
            ));
        }

        Ok(())
    }

    pub fn teardown_webview_branding(label: &str) {
        if let Ok(mut configured) = CONFIGURED_LABELS.lock() {
            configured.remove(label);
        }
        if let Ok(mut identities) = IDENTITY_PARAMS.lock() {
            identities.remove(label);
        }
    }
    #[cfg(test)]
    mod tests {
        use super::generic_chromium_user_agent;

        #[test]
        fn removes_only_edge_product_token() {
            let current = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0";

            assert_eq!(
                generic_chromium_user_agent(current).as_deref(),
                Some(
                    concat!(
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ",
                        "AppleWebKit/537.36 (KHTML, like Gecko) ",
                        "Chrome/151.0.0.0 Safari/537.36 ",
                        "Nebula/",
                        env!("CARGO_PKG_VERSION")
                    )
                )
            );
        }

        #[test]
        fn leaves_non_edge_user_agent_untouched() {
            let current = concat!(
                "Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36 ",
                "Nebula/",
                env!("CARGO_PKG_VERSION")
            );
            assert_eq!(generic_chromium_user_agent(current), None);
        }

        #[test]
        fn preserves_real_runtime_version_tokens() {
            let current =
                "Mozilla/5.0 Chrome/152.7.1234.5 Safari/537.36 Edg/152.7.1234.5";
            let expected = format!(
                "Mozilla/5.0 Chrome/152.7.1234.5 Safari/537.36 Nebula/{}",
                env!("CARGO_PKG_VERSION")
            );

            assert_eq!(
                generic_chromium_user_agent(current).as_deref(),
                Some(expected.as_str())
            );
        }

        #[test]
        fn derives_client_hint_versions_from_runtime_user_agent() {
            assert_eq!(
                super::chromium_version_from_user_agent(
                    "Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36"
                ),
                Some(("151".to_string(), "151.0.0.0".to_string()))
            );
        }

        #[test]
        fn derives_nebula_major_version_from_package_version() {
            assert_eq!(
                super::nebula_major_version(),
                env!("CARGO_PKG_VERSION")
                    .split('.')
                    .next()
                    .unwrap_or("1")
                    .to_string()
            );
        }

        #[test]
        fn client_hint_metadata_contains_no_edge_brands() {
            let json = super::client_hints_override_json(
                "Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36",
            )
            .expect("client-hints JSON should be generated");

            assert!(json.contains(r#""brand":"Chromium""#));
            assert!(json.contains(r#""brand":"Nebula""#));
            assert!(json.contains(r#""version":"151""#));
            assert!(json.contains(r#""version":"151.0.0.0""#));
            assert!(json.contains(&format!(
                r#""version":"{}""#,
                env!("CARGO_PKG_VERSION")
            )));
            assert!(json.contains(r#""platform":"Windows""#));
            assert!(json.contains(r#""platformVersion":"""#));
            assert!(json.contains(r#""architecture":"x86""#));
            assert!(json.contains(r#""model":"""#));
            assert!(json.contains(r#""bitness":"64""#));
            assert!(json.contains(r#""wow64":false"#));
            assert!(!json.contains("Microsoft Edge"));
            assert!(!json.contains("WebView2"));
        }
    }


}

#[cfg(target_os = "windows")]
pub use imp::{apply_browser_identity, setup_webview_branding, teardown_webview_branding};

#[cfg(not(target_os = "windows"))]
pub fn setup_webview_branding(_app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    if is_nebula_webview_label(label) {
        Ok(())
    } else {
        Err(format!("webview branding is not allowed for '{label}'"))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn apply_browser_identity(_app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    if label.starts_with("nebula-tab-") || label.starts_with("nebula-popup-content-") {
        Ok(())
    } else {
        Err(format!("browser identity is not allowed for '{label}'"))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn teardown_webview_branding(_label: &str) {}
