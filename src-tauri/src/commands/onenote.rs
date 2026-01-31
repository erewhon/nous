use std::path::Path;

use tauri::State;

use crate::onenote::{import_onenote, preview_onenote, OneNoteImportPreview};
use crate::storage::Notebook;
use crate::AppState;

type CommandResult<T> = Result<T, String>;

/// Preview a OneNote section file or notebook directory
#[tauri::command]
pub fn preview_onenote_cmd(path: String) -> CommandResult<OneNoteImportPreview> {
    let source = Path::new(&path);

    if !source.exists() {
        return Err("Path does not exist".to_string());
    }

    preview_onenote(source).map_err(|e| e.to_string())
}

/// Import a OneNote section file or notebook directory as a new notebook
#[tauri::command]
pub fn import_onenote_cmd(
    state: State<AppState>,
    path: String,
    notebook_name: Option<String>,
) -> CommandResult<Notebook> {
    let source = Path::new(&path);

    if !source.exists() {
        return Err("Path does not exist".to_string());
    }

    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let notebooks_dir = storage.notebooks_base_dir();
    drop(storage);

    let (notebook, pages) =
        import_onenote(source, &notebooks_dir, notebook_name).map_err(|e| e.to_string())?;

    // Index all pages in search
    let mut search_index = state.search_index.lock().map_err(|e| e.to_string())?;
    for page in &pages {
        search_index.index_page(page).map_err(|e| e.to_string())?;
    }

    Ok(notebook)
}
