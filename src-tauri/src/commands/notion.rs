//! Tauri commands for Notion import

use std::path::Path;

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::notion::{import_notion_zip_with_progress, preview_notion_import, NotionImportPreview};
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
    app: AppHandle,
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

    // Import the notebook with progress reporting
    let (notebook, pages) =
        import_notion_zip_with_progress(path, &notebooks_dir, notebook_name, progress_callback)
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
