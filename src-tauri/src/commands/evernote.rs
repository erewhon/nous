//! Tauri commands for Evernote .enex import

use std::path::Path;

use tauri::State;

use crate::evernote::{import_evernote_enex, preview_evernote_enex, EvernoteImportPreview};
use crate::storage::Notebook;
use crate::AppState;

/// Error type for command results
type CommandResult<T> = Result<T, String>;

/// Preview an Evernote .enex export file
///
/// Returns metadata about the import without actually importing anything.
#[tauri::command]
pub fn preview_evernote_enex_cmd(enex_path: String) -> CommandResult<EvernoteImportPreview> {
    let path = Path::new(&enex_path);

    if !path.exists() {
        return Err("ENEX file not found".to_string());
    }

    preview_evernote_enex(path).map_err(|e| e.to_string())
}

/// Import an Evernote .enex export as a new notebook
///
/// Converts all notes in the ENEX file to a new Katt notebook.
#[tauri::command]
pub fn import_evernote_enex_cmd(
    state: State<AppState>,
    enex_path: String,
    notebook_name: Option<String>,
) -> CommandResult<Notebook> {
    let path = Path::new(&enex_path);

    if !path.exists() {
        return Err("ENEX file not found".to_string());
    }

    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let notebooks_dir = storage.notebooks_base_dir();

    // Import the ENEX file
    let (notebook, pages) =
        import_evernote_enex(path, &notebooks_dir, notebook_name).map_err(|e| e.to_string())?;

    // Index all pages in search
    let mut search_index = state.search_index.lock().map_err(|e| e.to_string())?;
    for page in &pages {
        search_index.index_page(page).map_err(|e| e.to_string())?;
    }

    Ok(notebook)
}
