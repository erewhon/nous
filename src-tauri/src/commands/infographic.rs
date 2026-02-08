//! Infographic generation Tauri commands — visual summaries from study tools content.

use serde::Deserialize;
use std::fs;
use tauri::State;
use uuid::Uuid;

use crate::python_bridge::InfographicResult;
use crate::AppState;

use super::notebook::CommandError;

/// Infographic configuration from the frontend
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InfographicConfig {
    pub template: String, // key_concepts, executive_summary, timeline, concept_map
    #[serde(default = "default_width")]
    pub width: i32,
    #[serde(default = "default_height")]
    pub height: i32,
    #[serde(default = "default_theme")]
    pub theme: String, // light, dark
    pub title: Option<String>,
    pub accent_color: Option<String>, // Custom accent color hex
}

fn default_width() -> i32 {
    1200
}

fn default_height() -> i32 {
    800
}

fn default_theme() -> String {
    "light".to_string()
}

/// Generate an infographic from study tools data
#[tauri::command]
pub async fn generate_infographic(
    state: State<'_, AppState>,
    notebook_id: String,
    template: String,
    data: serde_json::Value,
    config: Option<InfographicConfig>,
    export_png: Option<bool>,
) -> Result<InfographicResult, CommandError> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    // Get assets directory from storage
    let output_dir = {
        let storage = state.storage.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire storage lock: {}", e),
        })?;

        // Output directory: {notebook_assets}/infographics/
        let assets_dir = storage.notebook_assets_dir(nb_id);
        let infographics_dir = assets_dir.join("infographics");
        fs::create_dir_all(&infographics_dir).map_err(|e| CommandError {
            message: format!("Failed to create infographics directory: {}", e),
        })?;

        infographics_dir
            .to_str()
            .map(|s| s.to_string())
            .ok_or_else(|| CommandError {
                message: "Invalid path encoding".to_string(),
            })?
    };

    // Clone python_ai Arc for spawn_blocking
    let python_ai = state.python_ai.clone();
    let export_png = export_png.unwrap_or(true);

    tauri::async_runtime::spawn_blocking(move || {
        let python_ai = python_ai.lock().map_err(|e| CommandError {
            message: format!("Failed to acquire Python AI lock: {}", e),
        })?;

        python_ai
            .generate_infographic(
                &template,
                data,
                &output_dir,
                config.as_ref(),
                export_png,
            )
            .map_err(|e| CommandError {
                message: format!("Infographic generation error: {}", e),
            })
    })
    .await
    .map_err(|e| CommandError {
        message: format!("Task join error: {}", e),
    })?
}

/// Check availability of infographic features
#[tauri::command]
pub fn check_infographic_availability(
    state: State<AppState>,
) -> Result<serde_json::Value, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .check_infographic_availability()
        .map_err(|e| CommandError {
            message: format!("Failed to check infographic availability: {}", e),
        })
}
