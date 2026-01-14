//! Tauri commands for Scrivener .scriv import

use std::path::Path;

use tauri::State;

use crate::scrivener::{import_scrivener_project, preview_scrivener_project, ScrivenerImportPreview};
use crate::storage::Notebook;
use crate::AppState;

/// Error type for command results
type CommandResult<T> = Result<T, String>;

/// Preview a Scrivener .scriv project folder
///
/// Returns metadata about the import without actually importing anything.
#[tauri::command]
pub fn preview_scrivener_project_cmd(scriv_path: String) -> CommandResult<ScrivenerImportPreview> {
    let path = Path::new(&scriv_path);

    if !path.exists() {
        return Err("Scrivener project folder not found".to_string());
    }

    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    preview_scrivener_project(path).map_err(|e| e.to_string())
}

/// Import a Scrivener .scriv project as a new notebook
///
/// Converts all documents in the project to a new Katt notebook.
#[tauri::command]
pub fn import_scrivener_project_cmd(
    state: State<AppState>,
    scriv_path: String,
    notebook_name: Option<String>,
) -> CommandResult<Notebook> {
    let path = Path::new(&scriv_path);

    if !path.exists() {
        return Err("Scrivener project folder not found".to_string());
    }

    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let notebooks_dir = storage.notebooks_base_dir();

    // Import the project
    let (notebook, pages) =
        import_scrivener_project(path, &notebooks_dir, notebook_name).map_err(|e| e.to_string())?;

    // Index all pages in search
    let mut search_index = state.search_index.lock().map_err(|e| e.to_string())?;
    for page in &pages {
        search_index.index_page(page).map_err(|e| e.to_string())?;
    }

    Ok(notebook)
}
