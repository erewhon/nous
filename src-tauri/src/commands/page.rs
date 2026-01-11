use tauri::State;
use uuid::Uuid;

use crate::storage::{EditorData, Page};
use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

#[tauri::command]
pub fn list_pages(state: State<AppState>, notebook_id: String) -> CommandResult<Vec<Page>> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    storage.list_pages(id).map_err(Into::into)
}

#[tauri::command]
pub fn get_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;
    storage.get_page(nb_id, pg_id).map_err(Into::into)
}

#[tauri::command]
pub fn create_page(
    state: State<AppState>,
    notebook_id: String,
    title: String,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let page = storage.create_page(id, title)?;

    // Index the new page
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.index_page(&page);
    }

    Ok(page)
}

#[tauri::command]
pub fn update_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    title: Option<String>,
    content: Option<EditorData>,
    tags: Option<Vec<String>>,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let mut page = storage.get_page(nb_id, pg_id)?;

    if let Some(title) = title {
        page.title = title;
    }
    if let Some(content) = content {
        page.content = content;
    }
    if let Some(tags) = tags {
        page.tags = tags;
    }
    page.updated_at = chrono::Utc::now();

    storage.update_page(&page)?;

    // Update the search index
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.index_page(&page);
    }

    Ok(page)
}

#[tauri::command]
pub fn delete_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    storage.delete_page(nb_id, pg_id)?;

    // Remove from search index
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.remove_page(pg_id);
    }

    Ok(())
}
