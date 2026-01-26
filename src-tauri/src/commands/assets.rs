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

/// Move a video file to a non-hidden directory for asset protocol access.
/// The Tauri asset protocol has issues with hidden directories (.local) on Linux.
#[tauri::command]
pub fn save_video_asset(
    app: AppHandle,
    notebook_id: String,
    filename: String,
    source_path: String,
) -> CommandResult<String> {
    // Use /tmp/katt-videos/ which has no hidden directories in the path
    let video_dir = PathBuf::from("/tmp/katt-videos").join(&notebook_id);

    fs::create_dir_all(&video_dir).map_err(|e| CommandError {
        message: format!("Failed to create video directory: {}", e),
    })?;

    let dest_path = video_dir.join(&filename);
    let source = PathBuf::from(&source_path);

    // Move the file from the hidden location to /tmp
    fs::rename(&source, &dest_path).or_else(|_| {
        // If rename fails (cross-device), copy and delete
        fs::copy(&source, &dest_path).and_then(|_| fs::remove_file(&source))
    }).map_err(|e| CommandError {
        message: format!("Failed to move video file: {}", e),
    })?;

    // Register with asset protocol scope
    if let Err(e) = app.asset_protocol_scope().allow_file(&dest_path) {
        log::warn!("Failed to register video with asset protocol: {}", e);
    }

    dest_path
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| CommandError {
            message: "Invalid path encoding".to_string(),
        })
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
