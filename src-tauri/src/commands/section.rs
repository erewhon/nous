//! Tauri commands for section operations

use tauri::State;
use uuid::Uuid;

use crate::git;
use crate::storage::{Page, Section};
use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

/// List all sections in a notebook
#[tauri::command]
pub fn list_sections(state: State<AppState>, notebook_id: String) -> CommandResult<Vec<Section>> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    storage.list_sections(id).map_err(Into::into)
}

/// Get a specific section
#[tauri::command]
pub fn get_section(
    state: State<AppState>,
    notebook_id: String,
    section_id: String,
) -> CommandResult<Section> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let sec_id = Uuid::parse_str(&section_id).map_err(|e| CommandError {
        message: format!("Invalid section ID: {}", e),
    })?;
    storage.get_section(nb_id, sec_id).map_err(Into::into)
}

/// Create a new section in a notebook
#[tauri::command]
pub fn create_section(
    state: State<AppState>,
    notebook_id: String,
    name: String,
    color: Option<String>,
) -> CommandResult<Section> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let section = storage.create_section(nb_id, name.clone(), color)?;

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Create section: {}", name);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit section creation: {}", e);
        }
    }

    Ok(section)
}

/// Update a section's properties
#[tauri::command]
pub fn update_section(
    state: State<AppState>,
    notebook_id: String,
    section_id: String,
    name: Option<String>,
    description: Option<Option<String>>, // None = don't change, Some(None) = clear, Some(Some(d)) = set
    color: Option<Option<String>>, // None = don't change, Some(None) = clear color, Some(Some(c)) = set color
    system_prompt: Option<Option<String>>, // None = don't change, Some(None) = clear, Some(Some(p)) = set
    system_prompt_mode: Option<String>, // None = don't change, Some("override") or Some("concatenate")
) -> CommandResult<Section> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let sec_id = Uuid::parse_str(&section_id).map_err(|e| CommandError {
        message: format!("Invalid section ID: {}", e),
    })?;

    let mut section = storage.get_section(nb_id, sec_id)?;

    if let Some(new_name) = name {
        section.name = new_name;
    }

    if let Some(new_description) = description {
        section.description = new_description;
    }

    if let Some(new_color) = color {
        section.color = new_color;
    }

    if let Some(new_prompt) = system_prompt {
        section.system_prompt = new_prompt;
    }

    if let Some(mode) = system_prompt_mode {
        section.system_prompt_mode = match mode.as_str() {
            "concatenate" => crate::storage::SystemPromptMode::Concatenate,
            _ => crate::storage::SystemPromptMode::Override,
        };
    }

    section.updated_at = chrono::Utc::now();
    storage.update_section(&section)?;

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Update section: {}", section.name);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit section update: {}", e);
        }
    }

    Ok(section)
}

/// Delete a section
#[tauri::command]
pub fn delete_section(
    state: State<AppState>,
    notebook_id: String,
    section_id: String,
    move_items_to: Option<String>,
) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let sec_id = Uuid::parse_str(&section_id).map_err(|e| CommandError {
        message: format!("Invalid section ID: {}", e),
    })?;
    let target = move_items_to
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid target section ID: {}", e),
            })
        })
        .transpose()?;

    storage.delete_section(nb_id, sec_id, target)?;

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = "Delete section".to_string();
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit section deletion: {}", e);
        }
    }

    Ok(())
}

/// Reorder sections in a notebook
#[tauri::command]
pub fn reorder_sections(
    state: State<AppState>,
    notebook_id: String,
    section_ids: Vec<String>,
) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let ids: Result<Vec<Uuid>, _> = section_ids
        .iter()
        .map(|id| {
            Uuid::parse_str(id).map_err(|e| CommandError {
                message: format!("Invalid section ID: {}", e),
            })
        })
        .collect();

    let section_ids = ids?;
    storage.reorder_sections(nb_id, &section_ids)?;

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = "Reorder sections".to_string();
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit section reorder: {}", e);
        }
    }

    Ok(())
}

// ===== Cover Page Commands =====

/// Get the cover page for a notebook
#[tauri::command]
pub fn get_cover_page(state: State<AppState>, notebook_id: String) -> CommandResult<Option<Page>> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    storage.get_cover_page(nb_id).map_err(Into::into)
}

/// Create a cover page for a notebook
#[tauri::command]
pub fn create_cover_page(state: State<AppState>, notebook_id: String) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    storage.create_cover_page(nb_id).map_err(Into::into)
}

/// Set or unset the cover page for a notebook
#[tauri::command]
pub fn set_cover_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: Option<String>,
) -> CommandResult<Option<Page>> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = page_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid page ID: {}", e),
            })
        })
        .transpose()?;

    storage.set_cover_page(nb_id, pg_id).map_err(Into::into)
}
