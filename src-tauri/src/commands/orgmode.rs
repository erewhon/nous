//! Tauri commands for org-mode file import

use std::path::Path;
use tauri::State;

use crate::orgmode::{import_orgmode, preview_orgmode, OrgmodeImportPreview};
use crate::storage::Notebook;
use crate::AppState;

/// Error type for command results
#[derive(Debug, serde::Serialize)]
pub struct OrgmodeCommandError {
    pub message: String,
}

type CommandResult<T> = Result<T, String>;

/// Preview org-mode files before importing
#[tauri::command]
pub fn preview_orgmode_cmd(source_path: String) -> CommandResult<OrgmodeImportPreview> {
    let path = Path::new(&source_path);

    if !path.exists() {
        return Err("Path does not exist".to_string());
    }

    preview_orgmode(path).map_err(|e| e.to_string())
}

/// Import org-mode files as a new notebook
#[tauri::command]
pub fn import_orgmode_cmd(
    state: State<AppState>,
    source_path: String,
    notebook_name: Option<String>,
) -> CommandResult<Notebook> {
    let path = Path::new(&source_path);

    if !path.exists() {
        return Err("Path does not exist".to_string());
    }

    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let notebooks_dir = storage.notebooks_base_dir();

    let (notebook, pages) = import_orgmode(path, &notebooks_dir, notebook_name)
        .map_err(|e| e.to_string())?;

    // Index imported pages for search
    if let Ok(mut search_index) = state.search_index.lock() {
        for page in &pages {
            if let Err(e) = search_index.index_page(page) {
                log::warn!("Failed to index imported page: {}", e);
            }
        }
    }

    Ok(notebook)
}
