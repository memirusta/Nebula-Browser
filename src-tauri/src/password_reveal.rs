use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RevealFailure {
    Unavailable,
    Cancelled,
    Failed,
}

#[derive(Debug, Serialize)]
pub struct PasswordRevealResult {
    verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<RevealFailure>,
}

impl PasswordRevealResult {
    fn denied(reason: RevealFailure) -> Self {
        Self {
            verified: false,
            reason: Some(reason),
        }
    }
}

fn trusted_shell(webview_label: &str, window_label: &str) -> bool {
    webview_label == window_label
        && (webview_label == "main" || webview_label.starts_with("nebula-window-"))
}

fn verification_message(message: &str) -> Option<String> {
    let message = message
        .trim()
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect::<String>();
    if message.is_empty() {
        None
    } else {
        Some(message)
    }
}

#[cfg(target_os = "windows")]
mod windows_hello {
    use super::{PasswordRevealResult, RevealFailure};
    use std::sync::Mutex;
    use windows::{
        core::{factory, HSTRING},
        Security::Credentials::UI::{
            UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
        },
        Win32::{
            Foundation::HWND,
            System::WinRT::{
                IUserConsentVerifierInterop, RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED,
            },
            UI::WindowsAndMessaging::IsWindow,
        },
    };
    use windows_future::IAsyncOperation;

    static VERIFICATION_LOCK: Mutex<()> = Mutex::new(());

    struct RuntimeApartment;
    impl Drop for RuntimeApartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }

    fn classify(result: UserConsentVerificationResult) -> PasswordRevealResult {
        match result {
            UserConsentVerificationResult::Verified => PasswordRevealResult {
                verified: true,
                reason: None,
            },
            UserConsentVerificationResult::Canceled => {
                PasswordRevealResult::denied(RevealFailure::Cancelled)
            }
            UserConsentVerificationResult::DeviceNotPresent
            | UserConsentVerificationResult::NotConfiguredForUser
            | UserConsentVerificationResult::DisabledByPolicy => {
                PasswordRevealResult::denied(RevealFailure::Unavailable)
            }
            _ => PasswordRevealResult::denied(RevealFailure::Failed),
        }
    }

    fn classify_error(error: windows::core::Error) -> PasswordRevealResult {
        // HRESULT_FROM_WIN32(ERROR_CANCELLED) and E_ABORT never authorize access.
        let reason = match error.code().0 as u32 {
            0x800704C7 | 0x80004004 => RevealFailure::Cancelled,
            _ => RevealFailure::Failed,
        };
        PasswordRevealResult::denied(reason)
    }

    pub(super) fn verify(hwnd_value: isize, message: String) -> PasswordRevealResult {
        let Ok(_guard) = VERIFICATION_LOCK.try_lock() else {
            return PasswordRevealResult::denied(RevealFailure::Failed);
        };
        if unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.is_err() {
            return PasswordRevealResult::denied(RevealFailure::Unavailable);
        }
        let _apartment = RuntimeApartment;
        let hwnd = HWND(hwnd_value as *mut _);
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            return PasswordRevealResult::denied(RevealFailure::Failed);
        }
        let availability = match UserConsentVerifier::CheckAvailabilityAsync()
            .and_then(|operation| operation.get())
        {
            Ok(availability) => availability,
            Err(_) => return PasswordRevealResult::denied(RevealFailure::Unavailable),
        };
        if availability != UserConsentVerifierAvailability::Available {
            return PasswordRevealResult::denied(RevealFailure::Unavailable);
        }
        let interop = match factory::<UserConsentVerifier, IUserConsentVerifierInterop>() {
            Ok(interop) => interop,
            Err(_) => return PasswordRevealResult::denied(RevealFailure::Unavailable),
        };
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            return PasswordRevealResult::denied(RevealFailure::Failed);
        }
        // Desktop interop associates Windows Hello with the requesting shell HWND.
        // This runs on a worker; the owning UI thread remains free to process messages.
        let operation: IAsyncOperation<UserConsentVerificationResult> = match unsafe {
            interop.RequestVerificationForWindowAsync(hwnd, &HSTRING::from(message))
        } {
            Ok(operation) => operation,
            Err(error) => return classify_error(error),
        };
        let result = operation.get().map(classify).unwrap_or_else(classify_error);
        if !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
            return PasswordRevealResult::denied(RevealFailure::Failed);
        }
        result
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn only_the_explicit_verified_result_authorizes_reveal() {
            assert!(classify(UserConsentVerificationResult::Verified).verified);
            for code in [-1, 1, 2, 3, 4, 5, 6, 7, i32::MAX] {
                assert!(!classify(UserConsentVerificationResult(code)).verified);
            }
            assert_eq!(
                classify(UserConsentVerificationResult::Canceled).reason,
                Some(RevealFailure::Cancelled)
            );
            assert_eq!(
                classify(UserConsentVerificationResult::NotConfiguredForUser).reason,
                Some(RevealFailure::Unavailable)
            );
        }

        #[test]
        fn os_errors_and_cancellation_fail_closed() {
            for code in [0x800704C7_u32, 0x80004004] {
                let result = classify_error(windows::core::Error::from_hresult(
                    windows::core::HRESULT(code as i32),
                ));
                assert!(!result.verified);
                assert_eq!(result.reason, Some(RevealFailure::Cancelled));
            }
            assert!(
                !classify_error(windows::core::Error::from_hresult(windows::core::HRESULT(
                    0x80004005_u32 as i32
                )))
                .verified
            );
        }
    }
}

#[tauri::command]
pub async fn password_verify_reveal(
    webview: tauri::Webview,
    message: String,
) -> PasswordRevealResult {
    if !trusted_shell(webview.label(), webview.window().label()) {
        return PasswordRevealResult::denied(RevealFailure::Failed);
    }
    let Some(message) = verification_message(&message) else {
        return PasswordRevealResult::denied(RevealFailure::Failed);
    };
    #[cfg(target_os = "windows")]
    {
        let hwnd = match webview.window().hwnd() {
            Ok(hwnd) => hwnd.0 as isize,
            Err(_) => return PasswordRevealResult::denied(RevealFailure::Failed),
        };
        tauri::async_runtime::spawn_blocking(move || windows_hello::verify(hwnd, message))
            .await
            .unwrap_or_else(|_| PasswordRevealResult::denied(RevealFailure::Failed))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = message;
        PasswordRevealResult::denied(RevealFailure::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_requesting_browser_shell_can_request_verification() {
        assert!(trusted_shell("main", "main"));
        assert!(trusted_shell("nebula-window-two", "nebula-window-two"));
        assert!(!trusted_shell("nebula-chrome", "main"));
        assert!(!trusted_shell("nebula-tab-main-site", "main"));
        assert!(!trusted_shell("nebula-window-two", "main"));
    }

    #[test]
    fn explanatory_messages_are_bounded_and_do_not_accept_empty_control_text() {
        assert_eq!(
            verification_message("  Nebula şifreyi göstermek istiyor.  "),
            Some("Nebula şifreyi göstermek istiyor.".into())
        );
        assert_eq!(verification_message("\0\r\n"), None);
        assert_eq!(
            verification_message(&"ü".repeat(300))
                .unwrap()
                .chars()
                .count(),
            240
        );
    }
}
