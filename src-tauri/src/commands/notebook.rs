use tauri::State;
use uuid::Uuid;

use crate::git;
use crate::storage::{Notebook, NotebookType, StorageError};
use crate::AppState;

#[derive(Debug, serde::Serialize)]
pub struct CommandError {
    pub message: String,
}

impl From<StorageError> for CommandError {
    fn from(err: StorageError) -> Self {
        Self {
            message: err.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, CommandError>;

#[tauri::command]
pub fn list_notebooks(state: State<AppState>) -> CommandResult<Vec<Notebook>> {
    let storage = state.storage.lock().unwrap();
    storage.list_notebooks().map_err(Into::into)
}

#[tauri::command]
pub fn get_notebook(state: State<AppState>, notebook_id: String) -> CommandResult<Notebook> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    storage.get_notebook(id).map_err(Into::into)
}

#[tauri::command]
pub fn create_notebook(
    state: State<AppState>,
    name: String,
    notebook_type: Option<String>,
) -> CommandResult<Notebook> {
    let storage = state.storage.lock().unwrap();
    let nb_type = match notebook_type.as_deref() {
        Some("zettelkasten") => NotebookType::Zettelkasten,
        _ => NotebookType::Standard,
    };
    storage.create_notebook(name, nb_type).map_err(Into::into)
}

#[tauri::command]
pub fn update_notebook(
    state: State<AppState>,
    notebook_id: String,
    name: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    sections_enabled: Option<bool>,
    archived: Option<bool>,
    system_prompt: Option<String>,
    system_prompt_mode: Option<String>,
    ai_provider: Option<String>,
    ai_model: Option<String>,
    is_pinned: Option<bool>,
    page_sort_by: Option<String>,
) -> CommandResult<Notebook> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let mut notebook = storage.get_notebook(id)?;

    if let Some(name) = name {
        notebook.name = name;
    }
    if let Some(icon) = icon {
        notebook.icon = Some(icon);
    }
    if let Some(color) = color {
        notebook.color = Some(color);
    }
    if let Some(enabled) = sections_enabled {
        notebook.sections_enabled = enabled;
    }
    if let Some(archived_val) = archived {
        notebook.archived = archived_val;
    }
    // Allow setting system_prompt to None (empty string clears it)
    if let Some(prompt) = system_prompt {
        notebook.system_prompt = if prompt.is_empty() { None } else { Some(prompt) };
    }
    // Set system_prompt_mode
    if let Some(mode) = system_prompt_mode {
        notebook.system_prompt_mode = match mode.as_str() {
            "concatenate" => crate::storage::SystemPromptMode::Concatenate,
            _ => crate::storage::SystemPromptMode::Override,
        };
    }
    // Allow setting ai_provider to None (empty string clears it)
    if let Some(provider) = ai_provider {
        notebook.ai_provider = if provider.is_empty() { None } else { Some(provider) };
    }
    // Allow setting ai_model to None (empty string clears it)
    if let Some(model) = ai_model {
        notebook.ai_model = if model.is_empty() { None } else { Some(model) };
    }
    // Set is_pinned if provided
    if let Some(pinned) = is_pinned {
        notebook.is_pinned = pinned;
    }
    // Allow setting page_sort_by to None (empty string clears it)
    if let Some(sort) = page_sort_by {
        notebook.page_sort_by = if sort.is_empty() { None } else { Some(sort) };
    }
    notebook.updated_at = chrono::Utc::now();

    storage.update_notebook(&notebook)?;

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Update notebook: {}", notebook.name);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit notebook update: {}", e);
        }
    }

    Ok(notebook)
}

#[tauri::command]
pub fn delete_notebook(state: State<AppState>, notebook_id: String) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    storage.delete_notebook(id).map_err(Into::into)
}

#[tauri::command]
pub fn reorder_notebooks(
    state: State<AppState>,
    notebook_ids: Vec<String>,
) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();
    let ids: Result<Vec<Uuid>, _> = notebook_ids
        .iter()
        .map(|id| {
            Uuid::parse_str(id).map_err(|e| CommandError {
                message: format!("Invalid notebook ID: {}", e),
            })
        })
        .collect();

    let notebook_ids = ids?;
    storage.reorder_notebooks(&notebook_ids).map_err(Into::into)
}
