//! Tauri commands for Notion import

use std::path::Path;

use tauri::State;

use crate::notion::{import_notion_zip, preview_notion_import, NotionImportPreview};
use crate::storage::Notebook;
use crate::AppState;

/// Error type for command results
type CommandResult<T> = Result<T, String>;

/// Preview a Notion export ZIP file
///
/// Returns metadata about the import without actually importing anything.
#[tauri::command]
pub fn preview_notion_export(zip_path: String) -> CommandResult<NotionImportPreview> {
    let path = Path::new(&zip_path);

    if !path.exists() {
        return Err("File not found".to_string());
    }

    preview_notion_import(path).map_err(|e| e.to_string())
}

/// Import a Notion export ZIP as a new notebook
///
/// Converts all markdown files and databases in the ZIP to a new Katt notebook.
#[tauri::command]
pub fn import_notion_export(
    state: State<AppState>,
    zip_path: String,
    notebook_name: Option<String>,
) -> CommandResult<Notebook> {
    let path = Path::new(&zip_path);

    if !path.exists() {
        return Err("File not found".to_string());
    }

    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let notebooks_dir = storage.notebooks_base_dir();

    // Import the notebook
    let (notebook, pages) =
        import_notion_zip(path, &notebooks_dir, notebook_name).map_err(|e| e.to_string())?;

    // Index all pages in search
    let mut search_index = state.search_index.lock().map_err(|e| e.to_string())?;
    for page in &pages {
        search_index.index_page(page).map_err(|e| e.to_string())?;
    }

    Ok(notebook)
}
