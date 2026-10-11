//! Fetches the icon of a site the user has visited, for the address field's suggestions.
//!
//! The shell keeps a local icon per site (see `core/faviconCache.ts`); it asks here only for a site that
//! has none yet, once, and keeps the answer. The icon is looked for where the user already goes first:
//! the site's own `/favicon.ico`. Only if the site has none is a favicon service asked, which then
//! learns that host. Nothing is returned that is not a small image, and only public sites are asked
//! (no local or private addresses, no names without a dot).
use std::net::IpAddr;
use std::sync::LazyLock;
use std::time::Duration;

use base64::Engine;
use tokio::sync::Semaphore;

/// An icon is a few kilobytes; anything bigger is not one.
const MAX_ICON_BYTES: usize = 64 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
/// A list of suggestions can ask for several sites at once; not for all of them at once.
static SLOTS: LazyLock<Semaphore> = LazyLock::new(|| Semaphore::new(3));

/// A host that may be asked for an icon: a public domain name, nothing else.
pub(crate) fn public_host(raw: &str) -> Option<String> {
    let host = raw.trim().trim_end_matches('.').to_ascii_lowercase();
    if host.is_empty() || host.len() > 253 || !host.contains('.') {
        return None;
    }
    if host.parse::<IpAddr>().is_ok() || crate::network_address::is_local_network_host(&host) {
        return None;
    }
    let plain = host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    });
    plain.then_some(host)
}

/// The kind of image the bytes are, judged by the bytes and not by what the server said.
pub(crate) fn image_mime(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("image/png")
    } else if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if bytes.starts_with(&[0x00, 0x00, 0x01, 0x00]) {
        Some("image/x-icon")
    } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

/// The bytes of a small image at `url`, or nothing: an error status, a body that is too big or not an image.
pub(crate) async fn fetch_image(client: &reqwest::Client, url: &str) -> Option<Vec<u8>> {
    let mut response = client.get(url).send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    if response
        .content_length()
        .is_some_and(|length| length as usize > MAX_ICON_BYTES)
    {
        return None;
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        body.extend_from_slice(&chunk);
        if body.len() > MAX_ICON_BYTES {
            return None;
        }
    }
    image_mime(&body).map(|_| body)
}

fn data_url(bytes: &[u8]) -> Option<String> {
    let mime = image_mime(bytes)?;
    Some(format!(
        "data:{mime};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    ))
}

/// The icon of `host` as a data URL, or nothing. Never an error the page could learn something from.
#[tauri::command]
pub async fn favicon_fetch(host: String) -> Result<Option<String>, String> {
    let Some(host) = public_host(&host) else {
        return Ok(None);
    };
    let _slot = SLOTS.acquire().await.map_err(|error| error.to_string())?;
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 NebulaBrowser/1.8")
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|error| error.to_string())?;
    // The site itself first. The service answers 404 when it has no icon either (`fallback_opts`
    // asks for exactly that), so a default globe is never taken for the site's icon.
    let sources = [
        format!("https://{host}/favicon.ico"),
        format!(
            "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://{host}&size=64"
        ),
    ];
    for url in sources {
        if let Some(bytes) = fetch_image(&client, &url).await {
            return Ok(data_url(&bytes));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    const PNG: &[u8] = &[
        0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, b'I', b'H', b'D', b'R',
    ];

    /// A server that answers every request with `response`, until the test ends.
    fn serve(response: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut buffer = [0u8; 1024];
                let _ = stream.read(&mut buffer);
                let _ = stream.write_all(&response);
            }
        });
        format!("http://{address}/favicon.ico")
    }

    fn http(status: &str, body: &[u8]) -> Vec<u8> {
        let mut out = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        out.extend_from_slice(body);
        out
    }

    fn client() -> reqwest::Client {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap()
    }

    #[test]
    fn only_public_domain_names_are_asked() {
        assert_eq!(
            public_host("Www.YouTube.com."),
            Some("www.youtube.com".into())
        );
        assert_eq!(public_host("example.co.uk"), Some("example.co.uk".into()));
        for refused in [
            "",
            "localhost",
            "intranet",
            "192.168.1.4",
            "10.0.0.1",
            "127.0.0.1",
            "8.8.8.8",
            "[::1]",
            "printer.local",
            "a.localhost",
            "example.com:8080",
            "example.com/path",
            "user@example.com",
            "exa mple.com",
            "-bad-.com",
            "evil.com#x",
            "ex..ample.com",
        ] {
            assert_eq!(public_host(refused), None, "{refused:?}");
        }
        assert_eq!(
            public_host(&format!("{}.com", "a".repeat(64))),
            None,
            "label too long"
        );
    }

    #[test]
    fn the_kind_of_image_comes_from_its_bytes() {
        assert_eq!(image_mime(PNG), Some("image/png"));
        assert_eq!(image_mime(&[0xFF, 0xD8, 0xFF, 0xE0]), Some("image/jpeg"));
        assert_eq!(image_mime(b"GIF89a...."), Some("image/gif"));
        assert_eq!(image_mime(&[0, 0, 1, 0, 1, 0]), Some("image/x-icon"));
        assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        // Text, markup and scripts are not icons, whatever the server called them.
        for not_an_image in [&b"<svg onload=alert(1)>"[..], b"<html>", b"", b"MZ\x90\0"] {
            assert_eq!(image_mime(not_an_image), None);
        }
    }

    #[test]
    fn a_small_image_is_taken_and_nothing_else() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let client = client();
            assert_eq!(
                fetch_image(&client, &serve(http("200 OK", PNG)))
                    .await
                    .as_deref(),
                Some(PNG)
            );
            assert!(fetch_image(&client, &serve(http("404 Not Found", PNG)))
                .await
                .is_none());
            assert!(
                fetch_image(&client, &serve(http("200 OK", b"<html>not an icon</html>")))
                    .await
                    .is_none()
            );
            let big = [PNG, &vec![0u8; MAX_ICON_BYTES][..]].concat();
            assert!(
                fetch_image(&client, &serve(http("200 OK", &big)))
                    .await
                    .is_none(),
                "too big"
            );
        });
    }

    #[test]
    fn the_icon_is_returned_as_a_data_url_of_its_real_type() {
        let url = data_url(PNG).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        assert_eq!(data_url(b"<svg/>"), None);
    }
}
