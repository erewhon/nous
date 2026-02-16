use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

/// Register a file path with the asset protocol scope so it can be accessed via convertFileSrc.
/// This should be called after writing a file using the fs plugin.
#[tauri::command]
pub fn register_asset_path(app: AppHandle, file_path: String) -> CommandResult<()> {
    let path = PathBuf::from(&file_path);

    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|e| CommandError {
            message: format!("Failed to register asset path: {}", e),
        })?;

    log::info!("Registered asset path: {}", file_path);
    Ok(())
}

/// Read a file and return it as a base64 data URL.
/// This bypasses the asset protocol entirely for cases where scope issues occur.
#[tauri::command]
pub fn get_asset_data_url(file_path: String) -> CommandResult<String> {
    let path = PathBuf::from(&file_path);

    // Read the file
    let data = fs::read(&path).map_err(|e| CommandError {
        message: format!("Failed to read file: {}", e),
    })?;

    // Determine MIME type from extension
    let mime_type = match path.extension().and_then(|e| e.to_str()) {
        Some("mp4") => "video/mp4",
        Some("webm") => "video/webm",
        Some("mov") => "video/quicktime",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("m4v") => "video/x-m4v",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        _ => "application/octet-stream",
    };

    // Encode as base64
    let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &data);

    Ok(format!("data:{};base64,{}", mime_type, b64))
}

/// Return the source path for a video asset.
///
/// Videos are now served via the embedded HTTP video server, so they can stay
/// in the notebook's assets directory (no need to copy to /tmp).
#[tauri::command]
pub fn save_video_asset(
    _app: AppHandle,
    _notebook_id: String,
    _filename: String,
    source_path: String,
) -> CommandResult<String> {
    let path = PathBuf::from(&source_path);
    if !path.exists() {
        return Err(CommandError {
            message: format!("Video file not found: {}", source_path),
        });
    }
    Ok(source_path)
}

/// Get the assets directory path for a notebook
#[tauri::command]
pub fn get_notebook_assets_path(
    state: State<AppState>,
    notebook_id: String,
) -> CommandResult<String> {
    let storage = state.storage.lock().unwrap();

    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let assets_path = storage.notebook_assets_dir(nb_id);

    // Ensure directory exists
    fs::create_dir_all(&assets_path).map_err(|e| CommandError {
        message: format!("Failed to create assets directory: {}", e),
    })?;

    assets_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| CommandError {
            message: "Invalid path encoding".to_string(),
        })
}

/// Save an asset file to a notebook's assets directory
/// Returns the full path where the file was saved
#[tauri::command]
pub fn save_notebook_asset(
    app: AppHandle,
    state: State<AppState>,
    notebook_id: String,
    filename: String,
    data: Vec<u8>,
) -> CommandResult<String> {
    let storage = state.storage.lock().unwrap();

    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let assets_path = storage.notebook_assets_dir(nb_id);

    // Ensure directory exists
    fs::create_dir_all(&assets_path).map_err(|e| CommandError {
        message: format!("Failed to create assets directory: {}", e),
    })?;

    let file_path = assets_path.join(&filename);

    // Write the file
    fs::write(&file_path, &data).map_err(|e| CommandError {
        message: format!("Failed to write asset file: {}", e),
    })?;

    // Register the file with the asset protocol scope so it can be accessed via convertFileSrc
    if let Err(e) = app.asset_protocol_scope().allow_file(&file_path) {
        log::warn!("Failed to add file to asset protocol scope: {}", e);
    }

    file_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| CommandError {
            message: "Invalid path encoding".to_string(),
        })
}

/// Media asset info returned from listing
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAssetInfo {
    pub path: String,
    pub filename: String,
    pub media_type: String, // "video" or "infographic"
    pub size_bytes: u64,
    pub created_at: Option<String>,
}

/// List media assets (videos and infographics) for a notebook
#[tauri::command]
pub fn list_notebook_media_assets(
    state: State<AppState>,
    notebook_id: String,
) -> CommandResult<Vec<MediaAssetInfo>> {
    let storage = state.storage.lock().unwrap();

    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let assets_path = storage.notebook_assets_dir(nb_id);
    let mut media_assets = Vec::new();

    // List videos
    let videos_dir = assets_path.join("videos");
    if videos_dir.exists() {
        if let Ok(entries) = fs::read_dir(&videos_dir) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_file() {
                        let path = entry.path();
                        let filename = path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string();

                        // Only include video files
                        if filename.ends_with(".mp4") || filename.ends_with(".webm") {
                            let created_at = metadata.created().ok().map(|t| {
                                chrono::DateTime::<chrono::Utc>::from(t)
                                    .format("%Y-%m-%dT%H:%M:%SZ")
                                    .to_string()
                            });

                            media_assets.push(MediaAssetInfo {
                                path: path.to_str().unwrap_or("").to_string(),
                                filename,
                                media_type: "video".to_string(),
                                size_bytes: metadata.len(),
                                created_at,
                            });
                        }
                    }
                }
            }
        }
    }

    // List infographics
    let infographics_dir = assets_path.join("infographics");
    if infographics_dir.exists() {
        if let Ok(entries) = fs::read_dir(&infographics_dir) {
            for entry in entries.flatten() {
                if let Ok(metadata) = entry.metadata() {
                    if metadata.is_file() {
                        let path = entry.path();
                        let filename = path.file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("")
                            .to_string();

                        // Only include image files
                        if filename.ends_with(".svg") || filename.ends_with(".png") {
                            let created_at = metadata.created().ok().map(|t| {
                                chrono::DateTime::<chrono::Utc>::from(t)
                                    .format("%Y-%m-%dT%H:%M:%SZ")
                                    .to_string()
                            });

                            media_assets.push(MediaAssetInfo {
                                path: path.to_str().unwrap_or("").to_string(),
                                filename,
                                media_type: "infographic".to_string(),
                                size_bytes: metadata.len(),
                                created_at,
                            });
                        }
                    }
                }
            }
        }
    }

    // Sort by created_at descending (newest first)
    media_assets.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(media_assets)
}

/// Delete a media asset from a notebook
#[tauri::command]
pub fn delete_notebook_media_asset(
    state: State<AppState>,
    notebook_id: String,
    asset_path: String,
) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();

    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let assets_path = storage.notebook_assets_dir(nb_id);
    let file_path = PathBuf::from(&asset_path);

    // Security: ensure the path is within the notebook's assets directory
    if !file_path.starts_with(&assets_path) {
        return Err(CommandError {
            message: "Invalid asset path".to_string(),
        });
    }

    fs::remove_file(&file_path).map_err(|e| CommandError {
        message: format!("Failed to delete asset: {}", e),
    })?;

    Ok(())
}
