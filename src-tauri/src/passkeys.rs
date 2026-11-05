//! Passkeys kept by Windows (Windows Hello and the passkey providers registered with it), listed and used through
//! the platform's WebAuthn API (`webauthn.dll`).
//!
//! A page that suggests passkeys would get the web view's own "Saved passkeys" pop-up. Nebula shows the passkeys in
//! its own list instead (`site_scripts/password_suggest.js`), and this module is the native half: it lists what
//! Windows has for a site and, when one is chosen, has Windows sign in with it.
//!
//! What is trusted: the origin comes from the web message's source (never from the page), the relying party id
//! must be that origin's host or a parent domain that is not a public suffix, and the credential must be one of
//! those Windows lists for that relying party. The signed data (`clientDataJSON`) is built here. A passkey's
//! private key never becomes readable: Windows signs, after its own Windows Hello check.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;

/// The most a challenge may be, as bytes. The WebAuthn minimum is 16; the page's own value is signed, so only the
/// upper bound is ours.
const MAX_CHALLENGE_BYTES: usize = 1024;

pub fn encode_b64url(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

pub fn decode_b64url(text: &str, max_bytes: usize) -> Option<Vec<u8>> {
    if text.is_empty() || text.len() > max_bytes.saturating_mul(2) {
        return None;
    }
    let bytes = URL_SAFE_NO_PAD.decode(text).ok()?;
    (!bytes.is_empty() && bytes.len() <= max_bytes).then_some(bytes)
}

/// Whether a page at `origin` may use `rp_id` as its relying party id: the origin must be a secure context (https,
/// or http on localhost) and the id its host or one of the host's parent domains, but never a public suffix.
pub fn rp_id_allowed(rp_id: &str, origin: &str) -> bool {
    let Ok(origin) = url::Url::parse(origin) else {
        return false;
    };
    let Some(host) = origin.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    let secure = origin.scheme() == "https" || (origin.scheme() == "http" && host == "localhost");
    if !secure || rp_id.is_empty() || rp_id.len() > 253 || rp_id != rp_id.to_ascii_lowercase() {
        return false;
    }
    if !rp_id.bytes().all(|byte| {
        byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'.' || byte == b'-'
    }) || rp_id.starts_with('.')
        || rp_id.ends_with('.')
        || rp_id.parse::<std::net::IpAddr>().is_ok()
    {
        return false;
    }
    if rp_id == host {
        return rp_id == "localhost" || psl::suffix_str(rp_id) != Some(rp_id);
    }
    host.ends_with(&format!(".{rp_id}")) && psl::suffix_str(rp_id) != Some(rp_id)
}

/// The `clientDataJSON` of a sign-in, with the origin that Nebula itself verified and the page's challenge.
pub fn client_data_json(challenge: &str, origin: &str) -> Option<String> {
    let challenge = decode_b64url(challenge, MAX_CHALLENGE_BYTES)?;
    serde_json::to_string(&serde_json::json!({
        "type": "webauthn.get",
        "challenge": encode_b64url(&challenge),
        "origin": origin,
        "crossOrigin": false,
    }))
    .ok()
}

/// One passkey as Windows describes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlatformPasskey {
    /// The credential id (what a sign-in must name to use this passkey).
    pub credential_id: Vec<u8>,
    pub rp_id: String,
    pub user_name: String,
    pub display_name: String,
    pub backed_up: bool,
}

impl PlatformPasskey {
    /// What the list shows: the account name, or the display name when there is none.
    pub fn label(&self) -> &str {
        if self.user_name.is_empty() {
            &self.display_name
        } else {
            &self.user_name
        }
    }
}

/// What Windows returns for a sign-in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assertion {
    pub credential_id: Vec<u8>,
    pub authenticator_data: Vec<u8>,
    pub signature: Vec<u8>,
    pub user_handle: Vec<u8>,
}

#[cfg(target_os = "windows")]
mod imp {
    use super::{Assertion, PlatformPasskey};
    use windows::core::{BOOL, HSTRING, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Networking::WindowsWebServices::{
        WebAuthNAuthenticatorGetAssertion, WebAuthNFreeAssertion,
        WebAuthNFreePlatformCredentialList, WebAuthNGetApiVersionNumber,
        WebAuthNGetPlatformCredentialList, WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS,
        WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS_VERSION_4, WEBAUTHN_CLIENT_DATA,
        WEBAUTHN_CLIENT_DATA_CURRENT_VERSION, WEBAUTHN_CREDENTIAL_EX,
        WEBAUTHN_CREDENTIAL_EX_CURRENT_VERSION, WEBAUTHN_CREDENTIAL_LIST,
        WEBAUTHN_CREDENTIAL_TYPE_PUBLIC_KEY, WEBAUTHN_GET_CREDENTIALS_OPTIONS,
        WEBAUTHN_GET_CREDENTIALS_OPTIONS_CURRENT_VERSION, WEBAUTHN_HASH_ALGORITHM_SHA_256,
        WEBAUTHN_USER_VERIFICATION_REQUIREMENT_DISCOURAGED,
        WEBAUTHN_USER_VERIFICATION_REQUIREMENT_PREFERRED,
        WEBAUTHN_USER_VERIFICATION_REQUIREMENT_REQUIRED,
    };

    unsafe fn text(value: PCWSTR) -> String {
        if value.is_null() {
            String::new()
        } else {
            unsafe { value.to_string() }.unwrap_or_default()
        }
    }

    unsafe fn bytes(pointer: *const u8, length: u32) -> Vec<u8> {
        if pointer.is_null() || length == 0 {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(pointer, length as usize) }.to_vec()
        }
    }

    /// The version of the Windows WebAuthn API (7 or more can list passkeys).
    pub fn api_version() -> u32 {
        unsafe { WebAuthNGetApiVersionNumber() }
    }

    /// The passkeys Windows has for a relying party id (the site's domain, such as `login.microsoft.com`).
    pub fn list_for_rp(rp_id: &str, private_mode: bool) -> Result<Vec<PlatformPasskey>, String> {
        if api_version() < 7 {
            return Err("this Windows cannot list passkeys".to_string());
        }
        let rp = HSTRING::from(rp_id);
        let options = WEBAUTHN_GET_CREDENTIALS_OPTIONS {
            dwVersion: WEBAUTHN_GET_CREDENTIALS_OPTIONS_CURRENT_VERSION,
            pwszRpId: PCWSTR(rp.as_ptr()),
            bBrowserInPrivateMode: BOOL::from(private_mode),
        };
        let list = unsafe { WebAuthNGetPlatformCredentialList(&options) }
            .map_err(|error| error.to_string())?;
        if list.is_null() {
            return Ok(Vec::new());
        }
        let mut found = Vec::new();
        unsafe {
            let details = &*list;
            for index in 0..details.cCredentialDetails as usize {
                let entry = *details.ppCredentialDetails.add(index);
                if entry.is_null() {
                    continue;
                }
                let entry = &*entry;
                let credential_id = bytes(entry.pbCredentialID, entry.cbCredentialID);
                if credential_id.is_empty() {
                    continue;
                }
                let (user_name, display_name) = if entry.pUserInformation.is_null() {
                    (String::new(), String::new())
                } else {
                    let user = &*entry.pUserInformation;
                    (text(user.pwszName), text(user.pwszDisplayName))
                };
                let rp_id = if entry.pRpInformation.is_null() {
                    String::new()
                } else {
                    text((*entry.pRpInformation).pwszId)
                };
                found.push(PlatformPasskey {
                    credential_id,
                    rp_id,
                    user_name,
                    display_name,
                    backed_up: entry.bBackedUp.as_bool(),
                });
            }
            WebAuthNFreePlatformCredentialList(list);
        }
        Ok(found)
    }

    /// Has Windows sign in with one passkey. Shows Windows Hello's own check and blocks until the person answers or
    /// cancels, so it must not run on the UI thread. `client_data_json` is signed as given.
    pub fn get_assertion(
        window: HWND,
        rp_id: &str,
        credential_id: &[u8],
        client_data_json: &str,
        user_verification: &str,
    ) -> Result<Assertion, String> {
        let rp = HSTRING::from(rp_id);
        let mut client_json = client_data_json.as_bytes().to_vec();
        let client_data = WEBAUTHN_CLIENT_DATA {
            dwVersion: WEBAUTHN_CLIENT_DATA_CURRENT_VERSION,
            cbClientDataJSON: client_json.len() as u32,
            pbClientDataJSON: client_json.as_mut_ptr(),
            pwszHashAlgId: WEBAUTHN_HASH_ALGORITHM_SHA_256,
        };
        let mut id = credential_id.to_vec();
        let mut credential = WEBAUTHN_CREDENTIAL_EX {
            dwVersion: WEBAUTHN_CREDENTIAL_EX_CURRENT_VERSION,
            cbId: id.len() as u32,
            pbId: id.as_mut_ptr(),
            pwszCredentialType: WEBAUTHN_CREDENTIAL_TYPE_PUBLIC_KEY,
            dwTransports: 0,
        };
        let mut credential_pointer: *mut WEBAUTHN_CREDENTIAL_EX = &mut credential;
        let mut allowed = WEBAUTHN_CREDENTIAL_LIST {
            cCredentials: 1,
            ppCredentials: &mut credential_pointer,
        };
        let mut options: WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS =
            unsafe { std::mem::zeroed() };
        options.dwVersion = WEBAUTHN_AUTHENTICATOR_GET_ASSERTION_OPTIONS_VERSION_4;
        options.dwTimeoutMilliseconds = 120_000;
        options.dwUserVerificationRequirement = match user_verification {
            "required" => WEBAUTHN_USER_VERIFICATION_REQUIREMENT_REQUIRED,
            "discouraged" => WEBAUTHN_USER_VERIFICATION_REQUIREMENT_DISCOURAGED,
            _ => WEBAUTHN_USER_VERIFICATION_REQUIREMENT_PREFERRED,
        };
        options.pAllowCredentialList = &mut allowed;

        let assertion =
            unsafe { WebAuthNAuthenticatorGetAssertion(window, &rp, &client_data, Some(&options)) }
                .map_err(|error| error.to_string())?;
        if assertion.is_null() {
            return Err("Windows returned no assertion".to_string());
        }
        let result = unsafe {
            let assertion_ref = &*assertion;
            let answered_id = bytes(assertion_ref.Credential.pbId, assertion_ref.Credential.cbId);
            let result = Assertion {
                credential_id: if answered_id.is_empty() {
                    id.clone()
                } else {
                    answered_id
                },
                authenticator_data: bytes(
                    assertion_ref.pbAuthenticatorData,
                    assertion_ref.cbAuthenticatorData,
                ),
                signature: bytes(assertion_ref.pbSignature, assertion_ref.cbSignature),
                user_handle: bytes(assertion_ref.pbUserId, assertion_ref.cbUserId),
            };
            WebAuthNFreeAssertion(assertion);
            result
        };
        if result.authenticator_data.is_empty() || result.signature.is_empty() {
            return Err("Windows returned an incomplete assertion".to_string());
        }
        Ok(result)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        /// Reads this machine's passkeys: the answer depends on the machine, so it only prints. Run with
        /// `cargo test --features extension-native-smoke passkeys -- --ignored --nocapture`.
        #[test]
        #[ignore = "reads this computer's passkeys"]
        fn lists_the_passkeys_windows_has_for_a_few_sites() {
            println!("WebAuthn API version: {}", api_version());
            for rp in [
                "login.microsoft.com",
                "login.live.com",
                "microsoft.com",
                "google.com",
                "github.com",
            ] {
                match list_for_rp(rp, false) {
                    Ok(list) => {
                        println!("{rp}: {} passkey(s)", list.len());
                        for passkey in list {
                            println!(
                                "  - {} ({}) id={} bytes, backed up: {}",
                                passkey.user_name,
                                passkey.display_name,
                                passkey.credential_id.len(),
                                passkey.backed_up
                            );
                        }
                    }
                    Err(error) => println!("{rp}: {error}"),
                }
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub use imp::{get_assertion, list_for_rp};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_may_only_use_its_own_host_or_a_parent_domain_that_is_not_a_public_suffix() {
        let ok = |rp: &str, origin: &str| rp_id_allowed(rp, origin);
        assert!(ok("login.microsoft.com", "https://login.microsoft.com"));
        assert!(ok("microsoft.com", "https://login.microsoft.com"));
        assert!(ok("example.co.uk", "https://www.example.co.uk"));
        assert!(ok("localhost", "http://localhost:3000"));

        // Another site, a suffix of the name that is not a domain boundary, a public suffix, a sibling.
        assert!(!ok("evil.com", "https://login.microsoft.com"));
        assert!(!ok("oft.com", "https://login.microsoft.com"));
        assert!(!ok("com", "https://login.microsoft.com"));
        assert!(!ok("co.uk", "https://www.example.co.uk"));
        assert!(!ok("other.microsoft.com", "https://login.microsoft.com"));
        // A sub-domain of the page is not a parent.
        assert!(!ok("login.microsoft.com", "https://microsoft.com"));
        // Not a secure context, an address, odd spellings.
        assert!(!ok("example.com", "http://example.com"));
        assert!(!ok("127.0.0.1", "https://127.0.0.1"));
        assert!(!ok("Example.com", "https://example.com"));
        assert!(!ok("", "https://example.com"));
        assert!(!ok(".example.com", "https://www.example.com"));
        assert!(!ok("example.com.", "https://example.com"));
        assert!(!ok("exa mple.com", "https://example.com"));
        assert!(!ok("example.com", "not a url"));
    }

    #[test]
    fn the_signed_data_carries_the_verified_origin_and_the_pages_challenge() {
        let challenge = encode_b64url(&[7u8; 32]);
        let json = client_data_json(&challenge, "https://login.microsoft.com").expect("valid");
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["type"], "webauthn.get");
        assert_eq!(value["challenge"], challenge);
        assert_eq!(value["origin"], "https://login.microsoft.com");
        assert_eq!(value["crossOrigin"], false);

        // Padding and odd characters are not accepted; neither are empty or oversized challenges.
        assert!(client_data_json("not base64!", "https://example.com").is_none());
        assert!(client_data_json("", "https://example.com").is_none());
        assert!(client_data_json(&encode_b64url(&[1u8; 2000]), "https://example.com").is_none());
    }

    #[test]
    fn credential_ids_survive_the_round_trip_and_oversized_ones_are_refused() {
        let id = vec![1u8, 2, 3, 250, 251, 252];
        assert_eq!(decode_b64url(&encode_b64url(&id), 1024), Some(id));
        assert_eq!(decode_b64url(&encode_b64url(&[0u8; 2000]), 1024), None);
        assert_eq!(decode_b64url("", 1024), None);
        assert_eq!(
            decode_b64url("a+b/", 1024),
            None,
            "only the URL-safe alphabet"
        );
    }
}
