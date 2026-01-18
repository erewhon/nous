//! Commands for file-based pages (markdown, PDF, Jupyter, EPUB, calendar)

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::storage::{FileStorageMode, Page, PageType};
use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

/// Result of importing a file as a page
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFileResult {
    pub page: Page,
    pub file_type: String,
}

/// File content response for text-based files
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContentResponse {
    pub content: String,
    pub page_type: String,
    pub file_extension: Option<String>,
}

/// Import a file as a new page in the notebook
#[tauri::command]
pub fn import_file_as_page(
    state: State<AppState>,
    notebook_id: String,
    file_path: String,
    storage_mode: String,
    folder_id: Option<String>,
    section_id: Option<String>,
) -> CommandResult<ImportFileResult> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let folder_uuid = folder_id
        .as_ref()
        .map(|id| Uuid::parse_str(id))
        .transpose()
        .map_err(|e| CommandError {
            message: format!("Invalid folder ID: {}", e),
        })?;

    let section_uuid = section_id
        .as_ref()
        .map(|id| Uuid::parse_str(id))
        .transpose()
        .map_err(|e| CommandError {
            message: format!("Invalid section ID: {}", e),
        })?;

    let mode = match storage_mode.as_str() {
        "embedded" => FileStorageMode::Embedded,
        "linked" => FileStorageMode::Linked,
        _ => {
            return Err(CommandError {
                message: format!("Invalid storage mode: {}", storage_mode),
            })
        }
    };

    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(CommandError {
            message: format!("File not found: {}", file_path),
        });
    }

    let page = storage
        .import_file_as_page(notebook_uuid, &path, mode, folder_uuid, section_uuid)
        .map_err(|e| CommandError {
            message: format!("Failed to import file: {}", e),
        })?;

    let file_type = format!("{:?}", page.page_type).to_lowercase();

    // Index the page in search
    if let Ok(mut search_index) = state.search_index.lock() {
        if let Err(e) = search_index.index_page(&page) {
            log::warn!("Failed to index imported page: {}", e);
        }
    }

    Ok(ImportFileResult { page, file_type })
}

/// Get the content of a text-based file page (markdown, calendar)
#[tauri::command]
pub fn get_file_content(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<FileContentResponse> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let page = storage
        .get_page_any_type(notebook_uuid, page_uuid)
        .map_err(|e| CommandError {
            message: format!("Page not found: {}", e),
        })?;

    // Only allow reading text-based files
    match page.page_type {
        PageType::Markdown | PageType::Calendar => {}
        _ => {
            return Err(CommandError {
                message: format!(
                    "Cannot read content for page type: {:?}. Use get_file_path instead.",
                    page.page_type
                ),
            });
        }
    }

    let content = storage.read_native_file_content(&page).map_err(|e| CommandError {
        message: format!("Failed to read file content: {}", e),
    })?;

    Ok(FileContentResponse {
        content,
        page_type: format!("{:?}", page.page_type).to_lowercase(),
        file_extension: page.file_extension,
    })
}

/// Update the content of a text-based file page (markdown, calendar)
#[tauri::command]
pub fn update_file_content(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    content: String,
) -> CommandResult<Page> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let mut page = storage
        .get_page_any_type(notebook_uuid, page_uuid)
        .map_err(|e| CommandError {
            message: format!("Page not found: {}", e),
        })?;

    // Only allow writing text-based files
    match page.page_type {
        PageType::Markdown | PageType::Calendar => {}
        _ => {
            return Err(CommandError {
                message: format!("Cannot write content for page type: {:?}", page.page_type),
            });
        }
    }

    storage
        .write_native_file_content(&page, &content)
        .map_err(|e| CommandError {
            message: format!("Failed to write file content: {}", e),
        })?;

    // Update metadata timestamps
    page.updated_at = chrono::Utc::now();
    page.last_file_sync = Some(chrono::Utc::now());
    storage.update_page_metadata(&page).map_err(|e| CommandError {
        message: format!("Failed to update page metadata: {}", e),
    })?;

    // Update search index
    if let Ok(mut search_index) = state.search_index.lock() {
        if let Err(e) = search_index.index_page(&page) {
            log::warn!("Failed to re-index page: {}", e);
        }
    }

    Ok(page)
}

/// Get the file path for a file-based page (for binary files like PDF, EPUB)
#[tauri::command]
pub fn get_file_path(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<String> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let page = storage
        .get_page_any_type(notebook_uuid, page_uuid)
        .map_err(|e| CommandError {
            message: format!("Page not found: {}", e),
        })?;

    let path = storage.get_file_path(&page).map_err(|e| CommandError {
        message: format!("Failed to get file path: {}", e),
    })?;

    Ok(path.to_string_lossy().to_string())
}

/// Check if a linked file has been modified externally
#[tauri::command]
pub fn check_linked_file_modified(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<bool> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let page = storage
        .get_page_any_type(notebook_uuid, page_uuid)
        .map_err(|e| CommandError {
            message: format!("Page not found: {}", e),
        })?;

    storage
        .check_linked_file_modified(&page)
        .map_err(|e| CommandError {
            message: format!("Failed to check file modification: {}", e),
        })
}

/// Get list of supported file extensions for import
#[tauri::command]
pub fn get_supported_page_extensions() -> Vec<String> {
    vec![
        "md".to_string(),
        "markdown".to_string(),
        "pdf".to_string(),
        "ipynb".to_string(),
        "epub".to_string(),
        "ics".to_string(),
        "ical".to_string(),
    ]
}

/// Delete a file-based page and its associated files
#[tauri::command]
pub fn delete_file_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<()> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    // Remove from search index first
    if let Ok(mut search_index) = state.search_index.lock() {
        if let Err(e) = search_index.remove_page(page_uuid) {
            log::warn!("Failed to remove page from search index: {}", e);
        }
    }

    storage
        .delete_file_page(notebook_uuid, page_uuid)
        .map_err(|e| CommandError {
            message: format!("Failed to delete file page: {}", e),
        })
}
