//! Audio generation Tauri commands — TTS narration, podcast discussion, recording, and transcription.

use base64::Engine;
use serde::{Deserialize, Serialize};
use std::fs;
use tauri::State;
use uuid::Uuid;

use crate::python_bridge::{
    AIConfig, AudioGenerationResult, TranscriptionResult, TTSProviderInfo, TTSVoiceInfo,
};
use crate::AppState;

use super::notebook::CommandError;

/// TTS configuration from the frontend
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TTSConfig {
    pub provider: String,
    pub voice: String,
    pub api_key: Option<String>,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub speed: Option<f64>,
}

/// Extract plain text from EditorData blocks for TTS input.
/// Handles paragraph, header, list, quote, code, and checklist blocks.
fn extract_text_from_blocks(blocks: &[serde_json::Value]) -> String {
    let mut parts: Vec<String> = Vec::new();

    for block in blocks {
        let block_type = block
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        let data = block.get("data").cloned().unwrap_or(serde_json::Value::Null);

        match block_type {
            "paragraph" | "header" | "quote" => {
                if let Some(text) = data.get("text").and_then(|v| v.as_str()) {
                    // Strip HTML tags
                    let clean = strip_html_tags(text);
                    let trimmed = clean.trim();
                    if !trimmed.is_empty() {
                        parts.push(trimmed.to_string());
                    }
                }
            }
            "list" => {
                if let Some(items) = data.get("items").and_then(|v| v.as_array()) {
                    for item in items {
                        let text = if let Some(s) = item.as_str() {
                            s.to_string()
                        } else if let Some(content) = item.get("content").and_then(|v| v.as_str())
                        {
                            content.to_string()
                        } else {
                            continue;
                        };
                        let clean = strip_html_tags(&text);
                        let trimmed = clean.trim();
                        if !trimmed.is_empty() {
                            parts.push(trimmed.to_string());
                        }
                    }
                }
            }
            "checklist" => {
                if let Some(items) = data.get("items").and_then(|v| v.as_array()) {
                    for item in items {
                        if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                            let clean = strip_html_tags(text);
                            let trimmed = clean.trim();
                            if !trimmed.is_empty() {
                                parts.push(trimmed.to_string());
                            }
                        }
                    }
                }
            }
            "code" => {
                if let Some(code) = data.get("code").and_then(|v| v.as_str()) {
                    let trimmed = code.trim();
                    if !trimmed.is_empty() {
                        parts.push(format!("Code block: {}", trimmed));
                    }
                }
            }
            _ => {
                // Skip image, video, embed, delimiter, etc.
            }
        }
    }

    parts.join("\n\n")
}

/// Simple HTML tag stripper
fn strip_html_tags(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut in_tag = false;
    for ch in input.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(ch);
        }
    }
    result
}

/// Generate audio from a page's content
#[tauri::command]
pub async fn generate_page_audio(
    state: State<'_, AppState>,
    notebook_id: String,
    page_id: String,
    mode: String,
    tts_config: TTSConfig,
    ai_config: Option<AIConfig>,
    voice_b: Option<String>,
    target_length: Option<String>,
    custom_instructions: Option<String>,
) -> Result<AudioGenerationResult, CommandError> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    // Get page content and assets directory from storage
    let (content, title, output_dir) = {
        let storage = state.storage.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire storage lock: {}", e),
        })?;

        let page = storage.get_page(nb_id, pg_id).map_err(|e| CommandError {
            message: format!("Failed to get page: {}", e),
        })?;

        // Extract text from blocks
        let blocks: Vec<serde_json::Value> = page
            .content
            .blocks
            .iter()
            .map(|b| {
                serde_json::json!({
                    "type": b.block_type,
                    "data": b.data,
                })
            })
            .collect();
        let text = extract_text_from_blocks(&blocks);

        if text.trim().is_empty() {
            return Err(CommandError {
                message: "Page has no text content to convert to audio".to_string(),
            });
        }

        // Output directory: {notebook_assets}/audio/
        let assets_dir = storage.notebook_assets_dir(nb_id);
        let audio_dir = assets_dir.join("audio");
        fs::create_dir_all(&audio_dir).map_err(|e| CommandError {
            message: format!("Failed to create audio directory: {}", e),
        })?;

        let dir_str = audio_dir.to_str().map(|s| s.to_string()).ok_or_else(|| {
            CommandError {
                message: "Invalid path encoding".to_string(),
            }
        })?;

        (text, page.title, dir_str)
    };

    // Clone python_ai Arc for spawn_blocking
    let python_ai = state.python_ai.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .generate_page_audio(
                &content,
                &title,
                &output_dir,
                &mode,
                &tts_config.provider,
                &tts_config.voice,
                tts_config.api_key.as_deref(),
                tts_config.base_url.as_deref(),
                tts_config.model.as_deref(),
                tts_config.speed,
                ai_config.as_ref(),
                voice_b.as_deref(),
                target_length.as_deref(),
                custom_instructions.as_deref(),
            )
            .map_err(|e| CommandError {
                message: format!("Audio generation error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// List available TTS providers
#[tauri::command]
pub fn get_tts_providers(state: State<AppState>) -> Result<Vec<TTSProviderInfo>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai.get_tts_providers().map_err(|e| CommandError {
        message: format!("Failed to get TTS providers: {}", e),
    })
}

/// List voices for a TTS provider
#[tauri::command]
pub fn list_tts_voices(
    state: State<AppState>,
    provider: String,
    api_key: Option<String>,
    base_url: Option<String>,
) -> Result<Vec<TTSVoiceInfo>, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .list_tts_voices(&provider, api_key.as_deref(), base_url.as_deref())
        .map_err(|e| CommandError {
            message: format!("Failed to list TTS voices: {}", e),
        })
}

// ===== Audio Recording & Transcription Commands =====

/// Result from saving an audio recording
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAudioResult {
    pub path: String,
    pub filename: String,
}

/// Transcribe an audio file using faster-whisper
#[tauri::command]
pub async fn transcribe_audio(
    state: State<'_, AppState>,
    audio_path: String,
    model_size: Option<String>,
    language: Option<String>,
) -> Result<TranscriptionResult, CommandError> {
    let python_ai = state.python_ai.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .transcribe_audio(
                &audio_path,
                model_size.as_deref(),
                language.as_deref(),
            )
            .map_err(|e| CommandError {
                message: format!("Audio transcription error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// Save a base64-encoded audio recording to the notebook's assets directory
#[tauri::command]
pub async fn save_audio_recording(
    state: State<'_, AppState>,
    notebook_id: String,
    audio_data_base64: String,
    format: String,
) -> Result<SaveAudioResult, CommandError> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let audio_dir = {
        let storage = state.storage.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire storage lock: {}", e),
        })?;
        let assets_dir = storage.notebook_assets_dir(nb_id);
        let audio_dir = assets_dir.join("audio");
        fs::create_dir_all(&audio_dir).map_err(|e| CommandError {
            message: format!("Failed to create audio directory: {}", e),
        })?;
        audio_dir
    };

    // Decode base64 audio data
    let audio_bytes =
        base64::engine::general_purpose::STANDARD
            .decode(&audio_data_base64)
            .map_err(|e| CommandError {
                message: format!("Failed to decode base64 audio data: {}", e),
            })?;

    // Generate unique filename
    let ext = if format.starts_with('.') {
        format.clone()
    } else {
        format!(".{}", format)
    };
    let filename = format!("recording_{}{}", Uuid::new_v4(), ext);
    let file_path = audio_dir.join(&filename);

    fs::write(&file_path, &audio_bytes).map_err(|e| CommandError {
        message: format!("Failed to write audio file: {}", e),
    })?;

    let path_str = file_path.to_str().map(|s| s.to_string()).ok_or_else(|| CommandError {
        message: "Invalid path encoding".to_string(),
    })?;

    Ok(SaveAudioResult {
        path: path_str,
        filename,
    })
}

/// Synthesize text to speech without requiring a page context
#[tauri::command]
pub async fn synthesize_text(
    state: State<'_, AppState>,
    text: String,
    tts_config: TTSConfig,
) -> Result<AudioGenerationResult, CommandError> {
    if text.trim().is_empty() {
        return Err(CommandError {
            message: "No text to synthesize".to_string(),
        });
    }

    let python_ai = state.python_ai.clone();

    // Use system temp dir for output
    let output_dir = std::env::temp_dir().join("nous_tts");
    fs::create_dir_all(&output_dir).map_err(|e| CommandError {
        message: format!("Failed to create temp directory: {}", e),
    })?;
    let output_dir_str = output_dir.to_str().map(|s| s.to_string()).ok_or_else(|| CommandError {
        message: "Invalid path encoding".to_string(),
    })?;

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .synthesize_text(
                &text,
                &output_dir_str,
                &tts_config.provider,
                &tts_config.voice,
                tts_config.api_key.as_deref(),
                tts_config.base_url.as_deref(),
                tts_config.model.as_deref(),
                tts_config.speed,
            )
            .map_err(|e| CommandError {
                message: format!("Text synthesis error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}
