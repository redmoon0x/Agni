use futures_util::StreamExt;
use serde::Serialize;
use tauri::ipc::Channel;

/// Events streamed from the Rust-side HTTP request to the frontend.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum HttpEvent {
    /// Response headers arrived; body will follow in chunks.
    Head {
        status: u16,
        status_text: String,
        headers: Vec<(String, String)>,
    },
    /// A chunk of the response body (UTF-8 lossy).
    Body { chunk: String },
    /// Request finished.
    Done { latency_ms: u64 },
    /// The request failed. Errors are streamed rather than returned so a
    /// partial body can still reach the UI.
    Error { message: String },
}

const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);
const MAX_BODY_BYTES: u64 = 10 * 1024 * 1024; // 10 MiB cap

/// Fire an HTTP request from the backend (bypasses browser CORS), streaming
/// the response back through `on_event`.
#[tauri::command]
pub async fn http_request(
    method: String,
    url: String,
    headers: Option<Vec<(String, String)>>,
    body: Option<String>,
    on_event: Channel<HttpEvent>,
) -> Result<(), String> {
    let method = method.to_uppercase();
    let parsed = reqwest::Url::parse(&url)
        .map_err(|e| format!("invalid URL: {e}"))?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("unsupported scheme: {other}")),
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| e.to_string())?;

    let mut builder = match method.as_str() {
        "GET" => client.get(url),
        "POST" => client.post(url),
        "PUT" => client.put(url),
        "PATCH" => client.patch(url),
        "DELETE" => client.delete(url),
        "HEAD" => client.head(url),
        other => return Err(format!("unsupported method: {other}")),
    };
    for (name, value) in headers.unwrap_or_default() {
        let name = name.trim();
        if name.is_empty() || value.trim().is_empty() {
            continue;
        }
        builder = builder.header(name, value);
    }
    if let Some(body) = body {
        if !body.trim().is_empty() {
            builder = builder.body(body);
        }
    }

    let started = std::time::Instant::now();
    let response = match tokio::time::timeout(REQUEST_TIMEOUT, builder.send()).await {
        Ok(Ok(response)) => response,
        Ok(Err(e)) => {
            let _ = on_event.send(HttpEvent::Error {
                message: e.to_string(),
            });
            return Ok(());
        }
        Err(_) => {
            let _ = on_event.send(HttpEvent::Error {
                message: "request timed out".into(),
            });
            return Ok(());
        }
    };

    let status = response.status();
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .map(|(name, value)| {
            (
                name.as_str().to_string(),
                String::from_utf8_lossy(value.as_bytes()).into_owned(),
            )
        })
        .collect();
    let _ = on_event.send(HttpEvent::Head {
        status: status.as_u16(),
        status_text: status.canonical_reason().unwrap_or("").to_string(),
        headers,
    });

    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;
    loop {
        let chunk = tokio::time::timeout(REQUEST_TIMEOUT, stream.next()).await;
        match chunk {
            Ok(Some(Ok(bytes))) => {
                received += bytes.len() as u64;
                let _ = on_event.send(HttpEvent::Body {
                    chunk: String::from_utf8_lossy(&bytes).into_owned(),
                });
                if received > MAX_BODY_BYTES {
                    let _ = on_event.send(HttpEvent::Error {
                        message: format!("response exceeds {MAX_BODY_BYTES} byte cap"),
                    });
                    break;
                }
            }
            Ok(Some(Err(e))) => {
                let _ = on_event.send(HttpEvent::Error {
                    message: e.to_string(),
                });
                break;
            }
            Ok(None) => break,
            Err(_) => {
                let _ = on_event.send(HttpEvent::Error {
                    message: "response read timed out".into(),
                });
                break;
            }
        }
    }

    let _ = on_event.send(HttpEvent::Done {
        latency_ms: started.elapsed().as_millis() as u64,
    });
    Ok(())
}
