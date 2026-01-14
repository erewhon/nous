//! Tauri commands for Obsidian vault import

use std::path::Path;

use tauri::State;

use crate::obsidian::{import_obsidian_vault, preview_obsidian_vault, ObsidianImportPreview};
use crate::storage::Notebook;
use crate::AppState;

/// Error type for command results
type CommandResult<T> = Result<T, String>;

/// Preview an Obsidian vault folder
///
/// Returns metadata about the import without actually importing anything.
#[tauri::command]
pub fn preview_obsidian_vault_cmd(vault_path: String) -> CommandResult<ObsidianImportPreview> {
    let path = Path::new(&vault_path);

    if !path.exists() {
        return Err("Vault folder not found".to_string());
    }

    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    preview_obsidian_vault(path).map_err(|e| e.to_string())
}

/// Import an Obsidian vault as a new notebook
///
/// Converts all markdown files in the vault to a new Katt notebook.
#[tauri::command]
pub fn import_obsidian_vault_cmd(
    state: State<AppState>,
    vault_path: String,
    notebook_name: Option<String>,
) -> CommandResult<Notebook> {
    let path = Path::new(&vault_path);

    if !path.exists() {
        return Err("Vault folder not found".to_string());
    }

    if !path.is_dir() {
        return Err("Path is not a directory".to_string());
    }

    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let notebooks_dir = storage.notebooks_base_dir();

    // Import the vault
    let (notebook, pages) =
        import_obsidian_vault(path, &notebooks_dir, notebook_name).map_err(|e| e.to_string())?;

    // Index all pages in search
    let mut search_index = state.search_index.lock().map_err(|e| e.to_string())?;
    for page in &pages {
        search_index.index_page(page).map_err(|e| e.to_string())?;
    }

    Ok(notebook)
}
