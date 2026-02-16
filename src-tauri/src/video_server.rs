//! Embedded HTTP server for video streaming with range request support.
//!
//! This server runs on localhost and serves video files with proper HTTP range
//! request handling, enabling seeking in large video files without loading them
//! entirely into memory.

use axum::{
    body::Body,
    extract::{Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use rand::Rng;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use tokio::fs::File;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Server state shared across requests.
#[derive(Clone)]
pub struct VideoServerState {
    /// Random access token required for all requests.
    pub token: String,
    /// Allowed base directories for serving videos (dynamically updatable).
    pub allowed_dirs: Arc<RwLock<Vec<PathBuf>>>,
}

/// Query parameters for video requests.
#[derive(serde::Deserialize)]
pub struct VideoQuery {
    /// Path to the video file.
    pub path: String,
    /// Access token for authorization.
    pub token: String,
}

/// Video server handle for managing the server lifecycle.
pub struct VideoServer {
    /// Port the server is listening on.
    pub port: u16,
    /// Access token for this server instance.
    pub token: String,
    /// Shutdown signal sender.
    shutdown_tx: Option<oneshot::Sender<()>>,
    /// Shared reference to the allowed directories list.
    allowed_dirs: Arc<RwLock<Vec<PathBuf>>>,
}

impl VideoServer {
    /// Get the base URL for this server.
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    /// Generate a streaming URL for a video file.
    pub fn stream_url(&self, video_path: &str) -> String {
        let encoded_path = urlencoding::encode(video_path);
        format!(
            "{}/video?path={}&token={}",
            self.base_url(),
            encoded_path,
            self.token
        )
    }

    /// Add a directory to the allowed list for serving videos.
    pub fn add_allowed_dir(&self, dir: PathBuf) {
        if let Ok(mut dirs) = self.allowed_dirs.write() {
            if !dirs.contains(&dir) {
                log::info!("Video server: adding allowed dir {:?}", dir);
                dirs.push(dir);
            }
        }
    }

    /// Stop the server gracefully.
    pub fn stop(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

/// Allowed video MIME types.
const VIDEO_MIME_TYPES: &[(&str, &str)] = &[
    ("mp4", "video/mp4"),
    ("webm", "video/webm"),
    ("mov", "video/quicktime"),
    ("mkv", "video/x-matroska"),
    ("avi", "video/x-msvideo"),
    ("m4v", "video/x-m4v"),
    ("flv", "video/x-flv"),
    ("ogv", "video/ogg"),
];

/// Get MIME type for a video file based on extension.
fn get_video_mime_type(path: &PathBuf) -> Option<&'static str> {
    let ext = path.extension()?.to_str()?.to_lowercase();
    VIDEO_MIME_TYPES
        .iter()
        .find(|(e, _)| *e == ext)
        .map(|(_, mime)| *mime)
}

/// Validate that a path is within allowed directories and doesn't contain traversal attempts.
fn validate_path(path: &str, allowed_dirs: &RwLock<Vec<PathBuf>>) -> Result<PathBuf, &'static str> {
    let path = PathBuf::from(path);

    // Check for path traversal attempts in the original path
    let path_str = path.to_string_lossy();
    if path_str.contains("..") {
        return Err("Path traversal detected");
    }

    // Canonicalize to resolve any symlinks
    let canonical = path
        .canonicalize()
        .map_err(|_| "Failed to resolve path")?;

    let dirs = allowed_dirs.read().map_err(|_| "Failed to read allowed dirs")?;

    // If allowed_dirs is empty, allow any path (for development)
    if dirs.is_empty() {
        return Ok(canonical);
    }

    // Check if the canonical path is within any allowed directory
    for allowed in dirs.iter() {
        if let Ok(allowed_canonical) = allowed.canonicalize() {
            if canonical.starts_with(&allowed_canonical) {
                return Ok(canonical);
            }
        }
    }

    Err("Path not in allowed directories")
}

/// Parse HTTP Range header.
/// Returns (start, end) where end is exclusive.
fn parse_range(range_header: &str, file_size: u64) -> Option<(u64, u64)> {
    // Parse "bytes=start-end" or "bytes=start-"
    let range_str = range_header.strip_prefix("bytes=")?;

    let parts: Vec<&str> = range_str.split('-').collect();
    if parts.len() != 2 {
        return None;
    }

    let start: u64 = parts[0].parse().ok()?;
    let end: u64 = if parts[1].is_empty() {
        file_size
    } else {
        parts[1].parse::<u64>().ok()? + 1 // +1 because HTTP range is inclusive
    };

    if start >= file_size || end > file_size || start >= end {
        return None;
    }

    Some((start, end))
}

/// Chunk size for streaming (1MB)
const CHUNK_SIZE: usize = 1024 * 1024;

/// Handle video streaming requests.
async fn stream_video(
    State(state): State<Arc<VideoServerState>>,
    headers: HeaderMap,
    Query(query): Query<VideoQuery>,
) -> Response {
    // Verify access token
    if query.token != state.token {
        return (StatusCode::UNAUTHORIZED, "Invalid token").into_response();
    }

    // Validate and resolve path
    let video_path = match validate_path(&query.path, &state.allowed_dirs) {
        Ok(p) => p,
        Err(e) => return (StatusCode::BAD_REQUEST, e).into_response(),
    };

    // Check if it's a video file
    let mime_type = match get_video_mime_type(&video_path) {
        Some(m) => m,
        None => return (StatusCode::BAD_REQUEST, "Not a supported video format").into_response(),
    };

    // Open the file
    let file = match File::open(&video_path).await {
        Ok(f) => f,
        Err(_) => return (StatusCode::NOT_FOUND, "Video file not found").into_response(),
    };

    let metadata = match file.metadata().await {
        Ok(m) => m,
        Err(_) => {
            return (StatusCode::INTERNAL_SERVER_ERROR, "Failed to read file metadata")
                .into_response()
        }
    };

    let file_size = metadata.len();

    // Check for Range header
    let range_header = headers.get(header::RANGE).and_then(|v| v.to_str().ok());

    if let Some(range_str) = range_header {
        // Handle range request
        if let Some((start, end)) = parse_range(range_str, file_size) {
            let length = end - start;

            // Create async stream for the range
            let stream = async_stream::stream! {
                let mut file = match File::open(&video_path).await {
                    Ok(f) => f,
                    Err(e) => {
                        yield Err(std::io::Error::new(std::io::ErrorKind::Other, e));
                        return;
                    }
                };

                if let Err(e) = file.seek(std::io::SeekFrom::Start(start)).await {
                    yield Err(e);
                    return;
                }

                let mut remaining = length as usize;
                let mut buffer = vec![0u8; CHUNK_SIZE];

                while remaining > 0 {
                    let to_read = remaining.min(CHUNK_SIZE);
                    match file.read(&mut buffer[..to_read]).await {
                        Ok(0) => break, // EOF
                        Ok(n) => {
                            remaining -= n;
                            yield Ok(bytes::Bytes::copy_from_slice(&buffer[..n]));
                        }
                        Err(e) => {
                            yield Err(e);
                            return;
                        }
                    }
                }
            };

            Response::builder()
                .status(StatusCode::PARTIAL_CONTENT)
                .header(header::CONTENT_TYPE, mime_type)
                .header(header::CONTENT_LENGTH, length)
                .header(header::ACCEPT_RANGES, "bytes")
                .header(
                    header::CONTENT_RANGE,
                    format!("bytes {}-{}/{}", start, end - 1, file_size),
                )
                .body(Body::from_stream(stream))
                .unwrap_or_else(|_| {
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response").into_response()
                })
        } else {
            // Invalid range
            Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header(header::CONTENT_RANGE, format!("bytes */{}", file_size))
                .body(Body::empty())
                .unwrap_or_else(|_| {
                    (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response").into_response()
                })
        }
    } else {
        // Full file request
        let stream = async_stream::stream! {
            let mut file = match File::open(&video_path).await {
                Ok(f) => f,
                Err(e) => {
                    yield Err(std::io::Error::new(std::io::ErrorKind::Other, e));
                    return;
                }
            };

            let mut buffer = vec![0u8; CHUNK_SIZE];

            loop {
                match file.read(&mut buffer).await {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        yield Ok(bytes::Bytes::copy_from_slice(&buffer[..n]));
                    }
                    Err(e) => {
                        yield Err(e);
                        return;
                    }
                }
            }
        };

        Response::builder()
            .status(StatusCode::OK)
            .header(header::CONTENT_TYPE, mime_type)
            .header(header::CONTENT_LENGTH, file_size)
            .header(header::ACCEPT_RANGES, "bytes")
            .body(Body::from_stream(stream))
            .unwrap_or_else(|_| {
                (StatusCode::INTERNAL_SERVER_ERROR, "Failed to build response").into_response()
            })
    }
}

/// Start the video streaming server.
///
/// Returns a VideoServer handle that can be used to get the port, token, and stop the server.
pub async fn start_server(
    allowed_dirs: Vec<PathBuf>,
) -> Result<VideoServer, Box<dyn std::error::Error + Send + Sync>> {
    // Generate random token
    let token: String = rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(32)
        .map(char::from)
        .collect();

    let shared_dirs = Arc::new(RwLock::new(allowed_dirs));
    let state = Arc::new(VideoServerState {
        token: token.clone(),
        allowed_dirs: Arc::clone(&shared_dirs),
    });

    let app = Router::new()
        .route("/video", get(stream_video))
        .with_state(state);

    // Bind to random available port on localhost
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let port = addr.port();

    log::info!(
        "Video streaming server started on http://127.0.0.1:{}",
        port
    );

    // Create shutdown channel
    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

    // Spawn server task
    tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
                log::info!("Video streaming server shutting down");
            })
            .await
            .ok();
    });

    Ok(VideoServer {
        port,
        token,
        shutdown_tx: Some(shutdown_tx),
        allowed_dirs: shared_dirs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_range() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 100)));
        assert_eq!(parse_range("bytes=500-999", 1000), Some((500, 1000)));
        assert_eq!(parse_range("bytes=500-", 1000), Some((500, 1000)));
        assert_eq!(parse_range("bytes=0-", 1000), Some((0, 1000)));

        // Invalid ranges
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=500-400", 1000), None);
        assert_eq!(parse_range("invalid", 1000), None);
    }

    #[test]
    fn test_get_video_mime_type() {
        assert_eq!(
            get_video_mime_type(&PathBuf::from("video.mp4")),
            Some("video/mp4")
        );
        assert_eq!(
            get_video_mime_type(&PathBuf::from("video.webm")),
            Some("video/webm")
        );
        assert_eq!(get_video_mime_type(&PathBuf::from("video.txt")), None);
    }
}
