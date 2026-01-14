use tauri::State;
use uuid::Uuid;

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
    system_prompt: Option<String>,
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
    // Allow setting system_prompt to None (empty string clears it)
    if let Some(prompt) = system_prompt {
        notebook.system_prompt = if prompt.is_empty() { None } else { Some(prompt) };
    }
    notebook.updated_at = chrono::Utc::now();

    storage.update_notebook(&notebook)?;
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
