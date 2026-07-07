use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::time::{timeout, Duration};

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
}

fn runtime_env(name: &str) -> Option<String> {
  std::env::var(name)
    .ok()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
}

fn embedded_env(name: &str) -> Option<String> {
  let value = match name {
    "GOOGLE_CLIENT_SECRET" => option_env!("GOOGLE_CLIENT_SECRET")?,
    "GOOGLE_CLIENT_ID" => option_env!("GOOGLE_CLIENT_ID")?,
    "VITE_GOOGLE_CLIENT_ID" => option_env!("VITE_GOOGLE_CLIENT_ID")?,
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

fn google_client_secret() -> Result<String, String> {
  env_or_embedded("GOOGLE_CLIENT_SECRET").ok_or_else(|| {
    "Google OAuth yapilandirmasi eksik. Gelistirici release build sirasinda GOOGLE_CLIENT_SECRET tanimlamali."
      .to_string()
  })
}

fn resolve_google_client_id(provided: &str) -> String {
  env_or_embedded("GOOGLE_CLIENT_ID")
    .or_else(|| env_or_embedded("VITE_GOOGLE_CLIENT_ID"))
    .unwrap_or_else(|| provided.to_string())
}

fn google_secret_configured() -> bool {
  env_or_embedded("GOOGLE_CLIENT_SECRET").is_some()
}

fn google_client_id_configured() -> bool {
  env_or_embedded("GOOGLE_CLIENT_ID")
    .or_else(|| env_or_embedded("VITE_GOOGLE_CLIENT_ID"))
    .is_some()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleOAuthStatus {
  pub client_id_configured: bool,
  pub secret_configured: bool,
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
  let secret_configured = google_secret_configured();

  GoogleOAuthStatus {
    client_id_configured,
    secret_configured,
    appdata_env_path,
  }
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
    let client = reqwest::Client::new();
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

async fn exchange_code_for_claims(
  client_id: &str,
  code: &str,
  code_verifier: &str,
  redirect_uri: &str,
) -> Result<GoogleProfileClaims, String> {
  let client_id = resolve_google_client_id(client_id);
  let client_secret = google_client_secret()?;
    let client = reqwest::Client::new();
    let response = client
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("code", code),
            ("code_verifier", code_verifier),
            ("grant_type", "authorization_code"),
            ("redirect_uri", redirect_uri),
        ])
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Google token exchange failed: {body}"));
    }

    let token: TokenResponse = response.json().await.map_err(|error| error.to_string())?;

    if let Some(id_token) = token.id_token.as_deref() {
        if let Some(claims) = decode_jwt_claims(id_token) {
            return Ok(claims);
        }
    }

    if let Some(access_token) = token.access_token.as_deref() {
        return fetch_userinfo(access_token).await;
    }

    Err("Google token response did not include profile data.".to_string())
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

fn open_in_system_browser(url: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", url])
            .spawn()
            .map_err(|error| error.to_string())?;
        return Ok(());
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

async fn wait_for_loopback_code(port: u16, expected_state: &str) -> Result<String, String> {
    let listener = TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .map_err(|error| error.to_string())?;

    let (mut socket, _) = listener.accept().await.map_err(|error| error.to_string())?;

    let mut buffer = vec![0u8; 16_384];
    let read = socket
        .read(&mut buffer)
        .await
        .map_err(|error| error.to_string())?;
    let request = String::from_utf8_lossy(&buffer[..read]);

    let request_line = request.lines().next().unwrap_or_default();
    let path = request_line.split_whitespace().nth(1).unwrap_or_default();
    let query = path.split('?').nth(1).unwrap_or_default();
    let params = parse_query_params(query);

    let success_html = "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Nebula</title></head><body style=\"font-family:sans-serif;text-align:center;padding:48px\"><h1>Giris basarili</h1><p>Nebula penceresine donebilirsin. Bu sekmeyi kapatabilirsin.</p></body></html>";
    let response = format!(
    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
    success_html.len(),
    success_html
  );
    let _ = socket.write_all(response.as_bytes()).await;
    let _ = socket.shutdown().await;

    if params.get("error").is_some() {
        return Err(params
            .get("error_description")
            .cloned()
            .unwrap_or_else(|| "Google sign-in was cancelled.".to_string()));
    }

    let state = params
        .get("state")
        .ok_or_else(|| "Google redirect did not include state.".to_string())?;
    if state != expected_state {
        return Err("Google OAuth state mismatch.".to_string());
    }

    params
        .get("code")
        .cloned()
        .ok_or_else(|| "Google redirect did not include authorization code.".to_string())
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
    drop(listener);

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
        wait_for_loopback_code(port, &state),
    )
    .await
    .map_err(|_| "Google sign-in timed out. Try again.".to_string())??;

    exchange_code_for_claims(&client_id, &code, &code_verifier, &redirect_uri).await
}
