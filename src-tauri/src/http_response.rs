/// A body that stops arriving is reported by reqwest as "error decoding response
/// body", which says nothing about the connection. Say what happened instead.
fn download_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "The connection stalled while downloading. Check the internet connection and try again."
            .to_string()
    } else {
        format!("The download was interrupted: {error}")
    }
}

pub(crate) async fn read_bounded_response(
    mut response: reqwest::Response,
    max_bytes: usize,
    limit_error: &str,
) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > max_bytes as u64)
    {
        return Err(limit_error.to_string());
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| download_error(&error))?
    {
        if chunk.len() > max_bytes.saturating_sub(bytes.len()) {
            return Err(limit_error.to_string());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::read_bounded_response;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    const LIMIT_ERROR: &str = "response is too large";

    async fn response_from_server(
        wire_response: &'static [u8],
        keep_open: bool,
    ) -> (reqwest::Response, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut connection, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            let mut buffer = [0; 1024];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let count = connection.read(&mut buffer).await.unwrap();
                assert!(count > 0);
                request.extend_from_slice(&buffer[..count]);
            }
            connection.write_all(wire_response).await.unwrap();
            if keep_open {
                // The client must reject oversized data without waiting for EOF.
                std::future::pending::<()>().await;
            }
        });
        let response = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap()
            .get(format!("http://{address}/"))
            .send()
            .await
            .unwrap();
        (response, server)
    }

    #[tokio::test(flavor = "current_thread")]
    async fn chunked_response_accepts_exact_limit() {
        let (response, server) = response_from_server(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nabcd\r\n4\r\nefgh\r\n0\r\n\r\n",
            false,
        )
        .await;
        assert_eq!(response.content_length(), None);
        assert_eq!(
            read_bounded_response(response, 8, LIMIT_ERROR)
                .await
                .unwrap(),
            b"abcdefgh"
        );
        server.await.unwrap();
    }

    #[tokio::test(flavor = "current_thread")]
    async fn chunked_response_rejects_limit_plus_one_before_eof() {
        let (response, server) = response_from_server(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n4\r\nabcd\r\n4\r\nefgh\r\n1\r\ni\r\n",
            true,
        )
        .await;
        assert_eq!(response.content_length(), None);
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            read_bounded_response(response, 8, LIMIT_ERROR),
        )
        .await;
        server.abort();
        assert_eq!(result.unwrap(), Err(LIMIT_ERROR.to_string()));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn a_stalled_body_reports_the_connection_not_a_decoding_error() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut connection, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 1024];
            let _ = connection.read(&mut buffer).await.unwrap();
            connection
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nabcd")
                .await
                .unwrap();
            std::future::pending::<()>().await;
        });
        let response = reqwest::Client::builder()
            .no_proxy()
            .read_timeout(Duration::from_millis(300))
            .build()
            .unwrap()
            .get(format!("http://{address}/"))
            .send()
            .await
            .unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            read_bounded_response(response, 64, LIMIT_ERROR),
        )
        .await;
        server.abort();
        let message = result.unwrap().unwrap_err();
        assert!(message.contains("stalled"), "{message}");
        assert!(!message.contains("decoding"), "{message}");
    }

    #[tokio::test(flavor = "current_thread")]
    async fn oversized_content_length_is_rejected_before_body_arrives() {
        let (response, server) =
            response_from_server(b"HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\n", true).await;
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            read_bounded_response(response, 8, LIMIT_ERROR),
        )
        .await;
        server.abort();
        assert_eq!(result.unwrap(), Err(LIMIT_ERROR.to_string()));
    }
}
