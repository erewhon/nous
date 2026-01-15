//! Video transcription Tauri commands.

use tauri::State;

use crate::python_bridge::TranscriptionResult;
use crate::AppState;

use super::notebook::CommandError;

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
