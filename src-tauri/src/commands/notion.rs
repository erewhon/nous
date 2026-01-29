//! Tauri commands for Notion import

use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

use crate::notion::{import_notion_zip_with_progress, preview_notion_import, NotionImportPreview};
use crate::storage::{Notebook, Page};
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
/// Converts all markdown files and databases in the ZIP to a new Nous notebook.
/// This command runs asynchronously to allow progress events to be delivered.
#[tauri::command]
pub async fn import_notion_export(
    app: AppHandle,
    state: State<'_, AppState>,
    zip_path: String,
    notebook_name: Option<String>,
) -> CommandResult<Notebook> {
    let path = PathBuf::from(&zip_path);

    if !path.exists() {
        return Err("File not found".to_string());
    }

    // Get notebooks_dir and release the lock immediately
    let notebooks_dir = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage.notebooks_base_dir()
    };

    // Clone the app handle for the blocking task
    let app_for_import = app.clone();

    // Run the import in a blocking task to avoid blocking the async runtime
    let import_result: Result<(Notebook, Vec<Page>), String> = tokio::task::spawn_blocking(move || {
        // Create progress callback that emits events directly
        // app.emit() is synchronous and thread-safe
        let progress_callback = move |current: usize, total: usize, message: &str| {
            let _ = app_for_import.emit(
                "import-progress",
                ImportProgress {
                    current,
                    total,
                    message: message.to_string(),
                },
            );
        };

        // Import the notebook with progress reporting
        import_notion_zip_with_progress(&path, &notebooks_dir, notebook_name, progress_callback)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Import task failed: {}", e))?;

    let (notebook, pages) = import_result?;

    // Index all pages in search
    let total_pages = pages.len();
    for (i, page) in pages.iter().enumerate() {
        let _ = app.emit(
            "import-progress",
            ImportProgress {
                current: i + 1,
                total: total_pages,
                message: "Indexing pages...".to_string(),
            },
        );

        // Small yield to allow events to be processed
        tokio::task::yield_now().await;

        let mut search_index = state.search_index.lock().map_err(|e| e.to_string())?;
        search_index.index_page(page).map_err(|e| e.to_string())?;
    }

    Ok(notebook)
}
