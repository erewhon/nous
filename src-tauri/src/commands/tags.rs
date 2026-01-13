//! Tag management Tauri commands.

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

#[derive(Serialize)]
pub struct TagInfo {
    pub name: String,
    pub count: usize,
}

/// Get all tags across all notebooks
#[tauri::command]
pub fn get_all_tags(state: State<AppState>) -> CommandResult<Vec<TagInfo>> {
    let storage = state.storage.lock().unwrap();
    let tags = storage.get_all_tags().map_err(|e| CommandError {
        message: format!("Failed to get tags: {}", e),
    })?;

    Ok(tags
        .into_iter()
        .map(|(name, count)| TagInfo { name, count })
        .collect())
}

/// Get tags for a specific notebook
#[tauri::command]
pub fn get_notebook_tags(state: State<AppState>, notebook_id: String) -> CommandResult<Vec<TagInfo>> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let tags = storage.get_notebook_tags(id).map_err(|e| CommandError {
        message: format!("Failed to get tags: {}", e),
    })?;

    Ok(tags
        .into_iter()
        .map(|(name, count)| TagInfo { name, count })
        .collect())
}

/// Rename a tag across all pages in a notebook
#[tauri::command]
pub fn rename_tag(
    state: State<AppState>,
    notebook_id: String,
    old_tag: String,
    new_tag: String,
) -> CommandResult<usize> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    storage
        .rename_tag(id, &old_tag, &new_tag)
        .map_err(|e| CommandError {
            message: format!("Failed to rename tag: {}", e),
        })
}

/// Merge multiple tags into one
#[tauri::command]
pub fn merge_tags(
    state: State<AppState>,
    notebook_id: String,
    tags_to_merge: Vec<String>,
    target_tag: String,
) -> CommandResult<usize> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    storage
        .merge_tags(id, &tags_to_merge, &target_tag)
        .map_err(|e| CommandError {
            message: format!("Failed to merge tags: {}", e),
        })
}

/// Delete a tag from all pages in a notebook
#[tauri::command]
pub fn delete_tag(state: State<AppState>, notebook_id: String, tag: String) -> CommandResult<usize> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    storage.delete_tag(id, &tag).map_err(|e| CommandError {
        message: format!("Failed to delete tag: {}", e),
    })
}
