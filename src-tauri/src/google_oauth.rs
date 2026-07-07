use serde::{Deserialize, Serialize};

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
      table[b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[index as usize] as usize] =
        index;
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

#[tauri::command]
pub async fn exchange_google_oauth_token(
  code: String,
  code_verifier: String,
  redirect_uri: String,
  client_id: String,
) -> Result<GoogleProfileClaims, String> {
  let client_secret = std::env::var("GOOGLE_CLIENT_SECRET").map_err(|_| {
    "GOOGLE_CLIENT_SECRET eksik. Proje kökündeki .env dosyasına Google Console client secret ekle."
      .to_string()
  })?;

  let client = reqwest::Client::new();
  let response = client
    .post("https://oauth2.googleapis.com/token")
    .form(&[
      ("client_id", client_id.as_str()),
      ("client_secret", client_secret.as_str()),
      ("code", code.as_str()),
      ("code_verifier", code_verifier.as_str()),
      ("grant_type", "authorization_code"),
      ("redirect_uri", redirect_uri.as_str()),
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
