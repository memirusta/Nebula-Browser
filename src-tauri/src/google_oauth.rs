use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::{timeout, Duration};
use tauri::Manager;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleProfileClaims {
    pub name: Option<String>,
    pub email: Option<String>,
    pub picture: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    id_token: Option<String>,
    access_token: Option<String>,
    refresh_token: Option<String>,
    scope: Option<String>,
}

struct OAuthExchange {
    claims: GoogleProfileClaims,
    refresh_token: Option<String>,
    scope: Option<String>,
}

fn runtime_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn embedded_env(name: &str) -> Option<String> {
    let value = match name {
        "GOOGLE_CLIENT_ID" => option_env!("GOOGLE_CLIENT_ID")?,
        "VITE_GOOGLE_CLIENT_ID" => option_env!("VITE_GOOGLE_CLIENT_ID")?,
        "GOOGLE_CLIENT_SECRET" => option_env!("GOOGLE_CLIENT_SECRET")?,
        _ => return None,
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn env_or_embedded(name: &str) -> Option<String> {
    runtime_env(name).or_else(|| embedded_env(name))
}

fn resolve_google_client_id(provided: &str) -> String {
    env_or_embedded("GOOGLE_CLIENT_ID")
        .or_else(|| env_or_embedded("VITE_GOOGLE_CLIENT_ID"))
        .unwrap_or_else(|| provided.to_string())
}

fn google_client_id_configured() -> bool {
    env_or_embedded("GOOGLE_CLIENT_ID")
        .or_else(|| env_or_embedded("VITE_GOOGLE_CLIENT_ID"))
        .is_some()
}

pub(crate) fn resolve_google_client_secret() -> Result<String, String> {
    env_or_embedded("GOOGLE_CLIENT_SECRET").ok_or_else(|| {
        "Google OAuth client secret is not configured. Set GOOGLE_CLIENT_SECRET in the native environment.".to_string()
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleOAuthStatus {
    pub client_id_configured: bool,
    pub appdata_env_path: String,
}

#[tauri::command]
pub fn google_oauth_status() -> GoogleOAuthStatus {
    let appdata_env_path = std::env::var_os("LOCALAPPDATA")
        .map(|local| {
            std::path::PathBuf::from(local)
                .join("com.nebula.browser")
                .join(".env")
                .to_string_lossy()
                .into_owned()
        })
        .unwrap_or_else(|| "%LOCALAPPDATA%\\com.nebula.browser\\.env".to_string());

    let client_id_configured = google_client_id_configured();
    GoogleOAuthStatus {
        client_id_configured,
        appdata_env_path,
    }
}

fn oauth_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())
}

fn token_exchange_form(
    client_id: String,
    client_secret: String,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> HashMap<&'static str, String> {
    HashMap::from([
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("code", code.to_string()),
        ("code_verifier", code_verifier.to_string()),
        ("grant_type", "authorization_code".to_string()),
        ("redirect_uri", redirect_uri.to_string()),
    ])
}

fn decode_jwt_claims(id_token: &str) -> Option<GoogleProfileClaims> {
    let payload = id_token.split('.').nth(1)?;
    let normalized = payload.replace('-', "+").replace('_', "/");
    let padded = match normalized.len() % 4 {
        2 => format!("{normalized}=="),
        3 => format!("{normalized}="),
        _ => normalized,
    };
    let bytes = base64_decode(&padded).ok()?;
    let json: GoogleProfileClaims = serde_json::from_slice(&bytes).ok()?;
    Some(json)
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const TABLE: &[u8; 256] = &{
        let mut table = [255u8; 256];
        let mut index = 0u8;
        while index < 64 {
            table[b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
                [index as usize] as usize] = index;
            index += 1;
        }
        table
    };

    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u32;

    for byte in bytes {
        if *byte == b'=' {
            break;
        }
        let value = TABLE[*byte as usize];
        if value == 255 {
            return Err("invalid base64".to_string());
        }
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }

    Ok(output)
}

async fn fetch_userinfo(access_token: &str) -> Result<GoogleProfileClaims, String> {
    let client = oauth_http_client()?;
    let response = client
        .get("https://www.googleapis.com/oauth2/v3/userinfo")
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("userinfo request failed: {body}"));
    }

    response
        .json::<GoogleProfileClaims>()
        .await
        .map_err(|error| error.to_string())
}

async fn exchange_code(
    client_id: &str,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<OAuthExchange, String> {
    let client_id = resolve_google_client_id(client_id);
    let client_secret = resolve_google_client_secret()?;
    let client = oauth_http_client()?;

    // Keep PKCE for authorization-code protection. Google Desktop OAuth
    // clients can also require the client_secret issued with the client, so
    // supply it only from native runtime/build configuration (never Vite).
    let form = token_exchange_form(client_id, client_secret, code, code_verifier, redirect_uri);

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&form)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Google token exchange failed: {body}"));
    }

    let token: TokenResponse = response.json().await.map_err(|error| error.to_string())?;
    let claims = if let Some(id_token) = token.id_token.as_deref() {
        decode_jwt_claims(id_token)
    } else {
        None
    };
    let claims = match claims {
        Some(claims) => claims,
        None => match token.access_token.as_deref() {
            Some(access_token) => fetch_userinfo(access_token).await?,
            None => return Err("Google token response did not include profile data.".to_string()),
        },
    };

    Ok(OAuthExchange {
        claims,
        refresh_token: token.refresh_token,
        scope: token.scope,
    })
}

async fn exchange_code_for_claims(
    client_id: &str,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
) -> Result<GoogleProfileClaims, String> {
    Ok(exchange_code(client_id, code, code_verifier, redirect_uri)
        .await?
        .claims)
}

fn parse_query_params(query: &str) -> HashMap<String, String> {
    let mut params = HashMap::new();
    for pair in query.split('&') {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or_default();
        let value = parts.next().unwrap_or_default();
        if key.is_empty() {
            continue;
        }
        let decoded = urlencoding::decode(value)
            .map(|cow| cow.into_owned())
            .unwrap_or_else(|_| value.to_string());
        params.insert(key.to_string(), decoded);
    }
    params
}

fn open_google_oauth_popup(
    app: &tauri::AppHandle,
    auth_url: &str,
) -> Result<tauri::WebviewWindow, String> {
    let parsed_url = auth_url
        .parse()
        .map_err(|error: url::ParseError| error.to_string())?;
    let label = format!(
        "nebula-google-oauth-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis()
    );

    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        label,
        tauri::WebviewUrl::External(parsed_url),
    )
    .title("")
    .inner_size(520.0, 680.0)
    .center()
    .prevent_overflow()
    .decorations(true)
    .resizable(true)
    .maximizable(false)
    .minimizable(false)
    .closable(true)
    .focused(true)
    .visible(true)
    .theme(Some(tauri::Theme::Dark))
    .incognito(false)
    .browser_extensions_enabled(true);

    if let Some(main) = app.get_webview_window("main") {
        builder = builder.parent(&main).map_err(|error| error.to_string())?;
    }

    builder.build().map_err(|error| error.to_string())
}

fn open_in_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    #[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
    {
        let _ = url;
        Err("Opening the system browser is not supported on this platform.".to_string())
    }
}

async fn write_loopback_response(socket: &mut tokio::net::TcpStream, success: bool) {
    let html = if success {
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Nebula</title></head><body style=\"font-family:sans-serif;text-align:center;padding:48px\"><h1>Giris basarili</h1><p>Nebula penceresine donebilirsin. Bu sekmeyi kapatabilirsin.</p></body></html>"
    } else {
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Nebula</title></head><body style=\"font-family:sans-serif;text-align:center;padding:48px\"><h1>Giris tamamlanamadi</h1><p>Nebula penceresine donup tekrar deneyebilirsin.</p></body></html>"
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{}",
        html.len(), html
    );
    let _ = timeout(
        Duration::from_secs(1),
        socket.write_all(response.as_bytes()),
    )
    .await;
    let _ = timeout(Duration::from_secs(1), socket.shutdown()).await;
}

async fn wait_for_loopback_code(
    listener: TcpListener,
    expected_state: &str,
) -> Result<String, String> {
    loop {
        let (mut socket, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let mut buffer = vec![0u8; 16_384];
        let read = match timeout(Duration::from_secs(2), socket.read(&mut buffer)).await {
            Ok(Ok(0)) | Ok(Err(_)) | Err(_) => {
                write_loopback_response(&mut socket, false).await;
                continue;
            }
            Ok(Ok(read)) => read,
        };
        let request = String::from_utf8_lossy(&buffer[..read]);
        let request_line = request.lines().next().unwrap_or_default();
        let path = request_line.split_whitespace().nth(1).unwrap_or_default();
        let query = path
            .split_once('?')
            .map(|(_, query)| query)
            .unwrap_or_default();
        let params = parse_query_params(query);

        let Some(state) = params.get("state") else {
            write_loopback_response(&mut socket, false).await;
            continue;
        };
        if state != expected_state {
            write_loopback_response(&mut socket, false).await;
            continue;
        }

        if let Some(error) = params.get("error") {
            write_loopback_response(&mut socket, false).await;
            return Err(params
                .get("error_description")
                .cloned()
                .unwrap_or_else(|| format!("Google sign-in failed: {error}")));
        }

        let Some(code) = params.get("code").cloned() else {
            write_loopback_response(&mut socket, false).await;
            return Err("Google redirect did not include authorization code.".to_string());
        };

        write_loopback_response(&mut socket, true).await;
        return Ok(code);
    }
}

#[tauri::command]
pub async fn exchange_google_oauth_token(
    code: String,
    code_verifier: String,
    redirect_uri: String,
    client_id: String,
) -> Result<GoogleProfileClaims, String> {
    exchange_code_for_claims(&client_id, &code, &code_verifier, &redirect_uri).await
}

#[tauri::command]
pub async fn google_oauth_sign_in_loopback(
    client_id: String,
    code_verifier: String,
    code_challenge: String,
    state: String,
) -> Result<GoogleProfileClaims, String> {
    let client_id = resolve_google_client_id(&client_id);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let auth_url = format!(
    "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&prompt=select_account",
    urlencoding::encode(&client_id),
    urlencoding::encode(&redirect_uri),
    urlencoding::encode("openid email profile"),
    urlencoding::encode(&state),
    urlencoding::encode(&code_challenge),
  );

    open_in_system_browser(&auth_url)?;

    let code = timeout(
        Duration::from_secs(180),
        wait_for_loopback_code(listener, &state),
    )
    .await
    .map_err(|_| "Google sign-in timed out. Try again.".to_string())??;

    exchange_code_for_claims(&client_id, &code, &code_verifier, &redirect_uri).await
}

#[tauri::command]
pub async fn google_sync_enable_loopback(
    app: tauri::AppHandle,
    client_id: String,
    code_verifier: String,
    code_challenge: String,
    state: String,
    expected_email: String,
) -> Result<GoogleProfileClaims, String> {
    const DRIVE_APPDATA_SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";

    let client_id = resolve_google_client_id(&client_id);
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let redirect_uri = format!("http://127.0.0.1:{port}");
    let scopes = format!("openid email profile {DRIVE_APPDATA_SCOPE}");
    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&prompt={}&access_type=offline&include_granted_scopes=true&login_hint={}",
        urlencoding::encode(&client_id),
        urlencoding::encode(&redirect_uri),
        urlencoding::encode(&scopes),
        urlencoding::encode(&state),
        urlencoding::encode(&code_challenge),
        urlencoding::encode("consent select_account"),
        urlencoding::encode(expected_email.trim()),
    );

    let popup = open_google_oauth_popup(&app, &auth_url)?;
    let code_result = timeout(
        Duration::from_secs(180),
        wait_for_loopback_code(listener, &state),
    )
    .await
    .map_err(|_| "Google sync authorization timed out. Try again.".to_string());

    let _ = popup.close();
    let code = code_result??;

    let exchange = exchange_code(&client_id, &code, &code_verifier, &redirect_uri).await?;
    let email = exchange
        .claims
        .email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Google account did not provide an email address.".to_string())?;
    let expected = expected_email.trim();
    if !expected.is_empty() && !email.eq_ignore_ascii_case(expected) {
        return Err(
            "Google sync must use the same Google account as the Nebula profile.".to_string(),
        );
    }
    if let Some(scope) = exchange.scope.as_deref() {
        if !scope
            .split_whitespace()
            .any(|value| value == DRIVE_APPDATA_SCOPE)
        {
            return Err("Google Drive app-data permission was not granted.".to_string());
        }
    }
    let refresh_token = exchange
        .refresh_token
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "Google did not return an offline refresh token. Try enabling sync again.".to_string()
        })?;

    crate::google_sync::store_refresh_token(&app, email, refresh_token)?;
    Ok(exchange.claims)
}

#[cfg(test)]
mod tests {
    use super::{token_exchange_form, wait_for_loopback_code};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::{TcpListener, TcpStream};
    use tokio::time::{timeout, Duration};

    async fn request(port: u16, query: &str) -> String {
        let mut stream = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("loopback connection should succeed");
        let request = format!("GET /?{query} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
        stream
            .write_all(request.as_bytes())
            .await
            .expect("request should be written");
        let mut response = String::new();
        stream
            .read_to_string(&mut response)
            .await
            .expect("response should be read");
        response
    }

    #[tokio::test(flavor = "current_thread")]
    async fn loopback_rejects_wrong_state_then_accepts_expected_state() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener should bind");
        let port = listener.local_addr().expect("address should exist").port();
        let receiver =
            tokio::spawn(async move { wait_for_loopback_code(listener, "expected").await });

        assert!(request(port, "error=access_denied&state=wrong")
            .await
            .contains("Giris tamamlanamadi"));
        assert!(request(port, "code=bad&state=wrong")
            .await
            .contains("Giris tamamlanamadi"));
        assert!(request(port, "code=good%20code&state=expected")
            .await
            .contains("Giris basarili"));
        assert_eq!(
            receiver
                .await
                .expect("receiver should finish")
                .expect("valid callback should succeed"),
            "good code"
        );
    }

    #[test]
    fn desktop_token_exchange_uses_pkce_and_native_client_secret() {
        let form = token_exchange_form(
            "desktop-client".to_string(),
            "desktop-secret".to_string(),
            "authorization-code",
            "pkce-verifier",
            "http://127.0.0.1:49152",
        );

        assert_eq!(
            form.get("code_verifier").map(String::as_str),
            Some("pkce-verifier")
        );
        assert_eq!(
            form.get("client_secret").map(String::as_str),
            Some("desktop-secret")
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn stalled_loopback_client_cannot_hold_sign_in_until_global_timeout() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("listener should bind");
        let port = listener.local_addr().expect("address should exist").port();
        let receiver =
            tokio::spawn(async move { wait_for_loopback_code(listener, "expected").await });
        let stalled = TcpStream::connect(("127.0.0.1", port))
            .await
            .expect("stalled client should connect");

        let valid_response = timeout(
            Duration::from_secs(5),
            request(port, "code=good&state=expected"),
        )
        .await
        .expect("valid callback should not wait for the global sign-in timeout");
        assert!(valid_response.contains("Giris basarili"));
        drop(stalled);
        assert_eq!(
            receiver
                .await
                .expect("receiver should finish")
                .expect("valid callback should succeed"),
            "good"
        );
    }
}
