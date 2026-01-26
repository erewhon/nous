//! Video transcription and playback Tauri commands.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};

use crate::python_bridge::TranscriptionResult;
use crate::storage::FileStorage;
use crate::AppState;

use super::notebook::CommandError;

/// Video metadata for streaming
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub size_bytes: u64,
    pub mime_type: String,
    pub duration_seconds: Option<f64>,
}

/// Transcribe a video file using faster-whisper
#[tauri::command]
pub async fn transcribe_video(
    state: State<'_, AppState>,
    video_path: String,
    model_size: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResult, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .transcribe_video(
            &video_path,
            model_size.as_deref(),
            language.as_deref(),
        )
        .map_err(|e| CommandError {
            message: format!("Transcription error: {}", e),
        })
}

/// Get video duration in seconds
#[tauri::command]
pub fn get_video_duration(
    state: State<AppState>,
    video_path: String,
) -> Result<f64, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .get_video_duration(&video_path)
        .map_err(|e| CommandError {
            message: format!("Failed to get video duration: {}", e),
        })
}

/// Check if a file is a supported video format
#[tauri::command]
pub fn is_supported_video(
    state: State<AppState>,
    file_path: String,
) -> Result<bool, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .is_supported_video(&file_path)
        .map_err(|e| CommandError {
            message: format!("Failed to check video support: {}", e),
        })
}

/// Get list of supported video extensions
#[tauri::command]
pub fn get_supported_video_extensions(
    state: State<AppState>,
) -> Result<Vec<String>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .get_supported_video_extensions()
        .map_err(|e| CommandError {
            message: format!("Failed to get video extensions: {}", e),
        })
}

/// Link an external video file by creating a symlink in the app's cache directory.
/// Returns the path to the symlink which can be used with convertFileSrc.
#[tauri::command]
pub fn link_external_video(app: AppHandle, source_path: String) -> Result<String, CommandError> {
    // Get app cache directory
    let cache_dir = FileStorage::default_data_dir()
        .map_err(|e| CommandError {
            message: format!("Failed to get data directory: {}", e),
        })?
        .join("video_links");

    // Ensure cache directory exists
    fs::create_dir_all(&cache_dir).map_err(|e| CommandError {
        message: format!("Failed to create cache directory: {}", e),
    })?;

    let source = PathBuf::from(&source_path);

    // Get filename from source path
    let filename = source
        .file_name()
        .ok_or_else(|| CommandError {
            message: "Invalid source path".to_string(),
        })?
        .to_string_lossy();

    // Create unique link name using hash of source path
    let hash = format!("{:x}", md5::compute(source_path.as_bytes()));
    let ext = source
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_else(|| "mp4".to_string());
    let link_name = format!("{}-{}.{}", &hash[..8], filename, ext);
    let link_path = cache_dir.join(&link_name);

    // Remove existing link if present
    if link_path.exists() {
        let _ = fs::remove_file(&link_path);
    }

    // Create symlink (Unix) or copy file (Windows fallback)
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&source, &link_path).map_err(|e| CommandError {
            message: format!("Failed to create symlink: {}", e),
        })?;
    }

    #[cfg(windows)]
    {
        // On Windows, try symlink first, fall back to hard link, then copy
        if std::os::windows::fs::symlink_file(&source, &link_path).is_err() {
            fs::copy(&source, &link_path).map_err(|e| CommandError {
                message: format!("Failed to copy file: {}", e),
            })?;
        }
    }

    // Register the file with the asset protocol scope so it can be accessed via convertFileSrc
    if let Err(e) = app.asset_protocol_scope().allow_file(&link_path) {
        log::warn!("Failed to add file to asset protocol scope: {}", e);
    }

    link_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| CommandError {
            message: "Invalid path encoding".to_string(),
        })
}

/// Generate a thumbnail from a video file.
/// Returns the path to the generated thumbnail.
#[tauri::command]
pub async fn generate_video_thumbnail(
    state: State<'_, AppState>,
    video_path: String,
    timestamp_seconds: Option<f64>,
) -> Result<String, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .extract_video_thumbnail(
            &video_path,
            None, // Use default output path (alongside video)
            timestamp_seconds,
            Some(480), // Default width
        )
        .map_err(|e| CommandError {
            message: format!("Thumbnail generation error: {}", e),
        })
}

/// Get a video thumbnail as a data URL (base64 encoded).
/// Suitable for embedding directly in img src attributes.
#[tauri::command]
pub fn get_video_thumbnail_data_url(thumbnail_path: String) -> Result<String, CommandError> {
    let path = PathBuf::from(&thumbnail_path);

    if !path.exists() {
        return Err(CommandError {
            message: format!("Thumbnail file not found: {}", thumbnail_path),
        });
    }

    // Read the thumbnail file
    let data = fs::read(&path).map_err(|e| CommandError {
        message: format!("Failed to read thumbnail: {}", e),
    })?;

    // Determine MIME type from extension
    let mime_type = match path.extension().and_then(|e| e.to_str()) {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/jpeg", // Default to JPEG
    };

    // Encode as base64 data URL
    let base64_data = BASE64.encode(&data);
    Ok(format!("data:{};base64,{}", mime_type, base64_data))
}

/// Get video metadata (size, MIME type, duration).
#[tauri::command]
pub fn get_video_metadata(
    state: State<AppState>,
    video_path: String,
) -> Result<VideoMetadata, CommandError> {
    let path = PathBuf::from(&video_path);

    if !path.exists() {
        return Err(CommandError {
            message: format!("Video file not found: {}", video_path),
        });
    }

    // Get file size
    let metadata = fs::metadata(&path).map_err(|e| CommandError {
        message: format!("Failed to get file metadata: {}", e),
    })?;
    let size_bytes = metadata.len();

    // Determine MIME type from extension
    let mime_type = match path.extension().and_then(|e| e.to_str()) {
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("m4v") => "video/x-m4v",
        Some("flv") => "video/x-flv",
        _ => "video/mp4", // Default
    }
    .to_string();

    // Try to get duration via Python
    let duration_seconds = {
        let python_ai = state.python_ai.lock().ok();
        python_ai.and_then(|ai| ai.get_video_duration(&video_path).ok())
    };

    Ok(VideoMetadata {
        size_bytes,
        mime_type,
        duration_seconds,
    })
}

/// Open a video file with the system's default player.
#[tauri::command]
pub fn open_video_with_system_player(video_path: String) -> Result<(), CommandError> {
    let path = PathBuf::from(&video_path);

    if !path.exists() {
        return Err(CommandError {
            message: format!("Video file not found: {}", video_path),
        });
    }

    // Use the system's default application to open the file
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&video_path)
            .spawn()
            .map_err(|e| CommandError {
                message: format!("Failed to open video: {}", e),
            })?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&video_path)
            .spawn()
            .map_err(|e| CommandError {
                message: format!("Failed to open video: {}", e),
            })?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &video_path])
            .spawn()
            .map_err(|e| CommandError {
                message: format!("Failed to open video: {}", e),
            })?;
    }

    Ok(())
}

/// Read a chunk of video data for streaming.
/// Returns base64-encoded string for efficient IPC transfer.
#[tauri::command]
pub fn read_video_chunk(
    video_path: String,
    offset: u64,
    chunk_size: Option<u64>,
) -> Result<String, CommandError> {
    let chunk_size = chunk_size.unwrap_or(2 * 1024 * 1024); // Default 2MB
    let path = PathBuf::from(&video_path);

    if !path.exists() {
        return Err(CommandError {
            message: format!("Video file not found: {}", video_path),
        });
    }

    let mut file = File::open(&path).map_err(|e| CommandError {
        message: format!("Failed to open video file: {}", e),
    })?;

    // Seek to offset
    file.seek(SeekFrom::Start(offset)).map_err(|e| CommandError {
        message: format!("Failed to seek in video file: {}", e),
    })?;

    // Read chunk
    let mut buffer = vec![0u8; chunk_size as usize];
    let bytes_read = file.read(&mut buffer).map_err(|e| CommandError {
        message: format!("Failed to read video chunk: {}", e),
    })?;

    // Truncate buffer to actual bytes read
    buffer.truncate(bytes_read);

    // Return as base64 for efficient IPC transfer
    Ok(BASE64.encode(&buffer))
}
