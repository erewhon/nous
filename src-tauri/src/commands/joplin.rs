//! Tauri commands for Joplin import (JEX/RAW)

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::joplin::{import_joplin_with_progress, preview_joplin_import, JoplinImportPreview};
use crate::storage::Notebook;
use crate::AppState;

/// Error type for command results
type CommandResult<T> = Result<T, String>;

/// Progress event payload
#[derive(Clone, Serialize)]
struct ImportProgress {
    current: usize,
    total: usize,
    message: String,
}

/// Preview a Joplin export (JEX archive or RAW directory)
///
/// Returns metadata about the import without actually importing anything.
#[tauri::command]
pub fn preview_joplin_import_cmd(path: String) -> CommandResult<JoplinImportPreview> {
    let path = Path::new(&path);

    if !path.exists() {
        return Err("Joplin export not found".to_string());
    }

    preview_joplin_import(path).map_err(|e| e.to_string())
}

/// Import a Joplin export as a new notebook
///
/// Converts all notes from the JEX archive or RAW directory to a new Katt notebook.
/// Handles notes, folders, tags, and resources.
#[tauri::command]
pub fn import_joplin_cmd(
    app: AppHandle,
    state: State<AppState>,
    path: String,
    notebook_name: Option<String>,
) -> CommandResult<Notebook> {
    let path = Path::new(&path);

    if !path.exists() {
        return Err("Joplin export not found".to_string());
    }

    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let notebooks_dir = storage.notebooks_base_dir();

    // Create progress callback
    let app_clone = app.clone();
    let progress_callback = move |current: usize, total: usize, message: &str| {
        let _ = app_clone.emit(
            "import-progress",
            ImportProgress {
                current,
                total,
                message: message.to_string(),
            },
        );
    };

    // Import the Joplin export with progress reporting
    let (notebook, pages) =
        import_joplin_with_progress(path, &notebooks_dir, notebook_name, progress_callback)
            .map_err(|e| e.to_string())?;

    // Index all pages in search
    let total_pages = pages.len();
    let mut search_index = state.search_index.lock().map_err(|e| e.to_string())?;
    for (i, page) in pages.iter().enumerate() {
        let _ = app.emit(
            "import-progress",
            ImportProgress {
                current: i + 1,
                total: total_pages,
                message: "Indexing pages...".to_string(),
            },
        );
        search_index.index_page(page).map_err(|e| e.to_string())?;
    }

    Ok(notebook)
}
