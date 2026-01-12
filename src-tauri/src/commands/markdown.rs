use std::fs;
use std::path::Path;
use tauri::State;
use uuid::Uuid;

use crate::markdown::{export_page_to_markdown, import_markdown_to_page};
use crate::storage::Page;
use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

/// Export a page to markdown format (returns markdown string)
#[tauri::command]
pub fn export_page_markdown(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<String> {
    let storage = state.storage.lock().unwrap();

    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let page = storage.get_page(nb_id, pg_id)?;
    let markdown = export_page_to_markdown(&page);

    Ok(markdown)
}

/// Import markdown content and create a new page
#[tauri::command]
pub fn import_markdown(
    state: State<AppState>,
    notebook_id: String,
    markdown: String,
    filename: String,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();

    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    // Use filename (without extension) as fallback title
    let fallback_title = Path::new(&filename)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported")
        .to_string();

    let page = import_markdown_to_page(&markdown, nb_id, &fallback_title);

    // Save the page
    storage.create_page_from(page.clone())?;

    // Index the new page
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.index_page(&page);
    }

    Ok(page)
}

/// Export a page to a markdown file
#[tauri::command]
pub fn export_page_to_file(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    path: String,
) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();

    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let page = storage.get_page(nb_id, pg_id)?;
    let markdown = export_page_to_markdown(&page);

    fs::write(&path, markdown).map_err(|e| CommandError {
        message: format!("Failed to write file: {}", e),
    })?;

    Ok(())
}

/// Import a markdown file and create a new page
#[tauri::command]
pub fn import_markdown_file(
    state: State<AppState>,
    notebook_id: String,
    path: String,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();

    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    // Read the file
    let markdown = fs::read_to_string(&path).map_err(|e| CommandError {
        message: format!("Failed to read file: {}", e),
    })?;

    // Use filename (without extension) as fallback title
    let fallback_title = Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported")
        .to_string();

    let page = import_markdown_to_page(&markdown, nb_id, &fallback_title);

    // Save the page
    storage.create_page_from(page.clone())?;

    // Index the new page
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.index_page(&page);
    }

    Ok(page)
}
