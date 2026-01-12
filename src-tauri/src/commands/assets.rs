use std::fs;
use tauri::State;
use uuid::Uuid;

use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

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
