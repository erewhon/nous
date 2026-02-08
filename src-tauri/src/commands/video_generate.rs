//! Video generation Tauri commands — narrated presentations from study content.

use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::mpsc;
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use crate::python_bridge::{SlideContent, VideoGenerationResult};
use crate::AppState;

use super::notebook::CommandError;

/// Progress event payload for video generation
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoProgressPayload {
    pub current_slide: i32,
    pub total_slides: i32,
    pub status: String,
    pub notebook_id: String,
}

/// TTS configuration for video narration
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoTTSConfig {
    pub provider: String,
    pub voice: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub speed: Option<f64>,
}

/// Video configuration from the frontend
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoConfig {
    #[serde(default = "default_video_width")]
    pub width: i32,
    #[serde(default = "default_video_height")]
    pub height: i32,
    #[serde(default = "default_theme")]
    pub theme: String, // light, dark
    #[serde(default = "default_transition")]
    pub transition: String, // cut, fade
    pub title: Option<String>,
    pub accent_color: Option<String>, // Custom accent color hex
}

fn default_video_width() -> i32 {
    1920
}

fn default_video_height() -> i32 {
    1080
}

fn default_theme() -> String {
    "light".to_string()
}

fn default_transition() -> String {
    "cut".to_string()
}

/// Generate a narrated video from study content slides
#[tauri::command]
pub async fn generate_study_video(
    app_handle: AppHandle,
    state: State<'_, AppState>,
    notebook_id: String,
    slides: Vec<SlideContent>,
    tts_config: VideoTTSConfig,
    video_config: Option<VideoConfig>,
) -> Result<VideoGenerationResult, CommandError> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    if slides.is_empty() {
        return Err(CommandError {
            message: "No slides provided for video generation".to_string(),
        });
    }

    // Get assets directory from storage
    let output_dir = {
        let storage = state.storage.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire storage lock: {}", e),
        })?;

        // Output directory: {notebook_assets}/videos/
        let assets_dir = storage.notebook_assets_dir(nb_id);
        let videos_dir = assets_dir.join("videos");
        fs::create_dir_all(&videos_dir).map_err(|e| CommandError {
            message: format!("Failed to create videos directory: {}", e),
        })?;

        videos_dir
            .to_str()
            .map(|s| s.to_string())
            .ok_or_else(|| CommandError {
                message: "Invalid path encoding".to_string(),
            })?
    };

    // Clone python_ai Arc for spawn_blocking
    let python_ai = state.python_ai.clone();
    let config = video_config.unwrap_or(VideoConfig {
        width: default_video_width(),
        height: default_video_height(),
        theme: default_theme(),
        transition: default_transition(),
        title: None,
    });

    // Create a channel for progress updates
    let (progress_tx, progress_rx) = mpsc::channel::<(i32, i32, String)>();
    let notebook_id_clone = notebook_id.clone();

    // Spawn a task to emit progress events
    let app_handle_clone = app_handle.clone();
    std::thread::spawn(move || {
        while let Ok((current, total, status)) = progress_rx.recv() {
            let payload = VideoProgressPayload {
                current_slide: current,
                total_slides: total,
                status,
                notebook_id: notebook_id_clone.clone(),
            };
            let _ = app_handle_clone.emit("video-generation-progress", payload);
        }
    });

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .generate_video_with_progress(
                slides,
                &output_dir,
                &tts_config.provider,
                &tts_config.voice,
                tts_config.api_key.as_deref(),
                tts_config.base_url.as_deref(),
                tts_config.model.as_deref(),
                tts_config.speed,
                config.width,
                config.height,
                &config.theme,
                &config.transition,
                config.title.as_deref(),
                progress_tx,
            )
            .map_err(|e| CommandError {
                message: format!("Video generation error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// Check availability of video generation features
#[tauri::command]
pub fn check_video_generation_availability(
    state: State<AppState>,
) -> Result<serde_json::Value, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .check_video_generation_availability()
        .map_err(|e| CommandError {
            message: format!("Failed to check video generation availability: {}", e),
        })
}
