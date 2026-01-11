use tauri::State;

use crate::search::SearchResult;
use crate::AppState;

use super::CommandError;

/// Search pages across all notebooks
#[tauri::command]
pub fn search_pages(
    state: State<AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, CommandError> {
    let search_index = state.search_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire search lock: {}", e),
    })?;

    let results = search_index
        .search(&query, limit.unwrap_or(20))
        .map_err(|e| CommandError {
            message: format!("Search error: {}", e),
        })?;

    Ok(results)
}

/// Fuzzy search pages (for autocomplete)
#[tauri::command]
pub fn fuzzy_search_pages(
    state: State<AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, CommandError> {
    let search_index = state.search_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire search lock: {}", e),
    })?;

    let results = search_index
        .fuzzy_search(&query, limit.unwrap_or(10))
        .map_err(|e| CommandError {
            message: format!("Fuzzy search error: {}", e),
        })?;

    Ok(results)
}

/// Rebuild the search index from all pages
#[tauri::command]
pub fn rebuild_search_index(state: State<AppState>) -> Result<(), CommandError> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let mut search_index = state.search_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire search lock: {}", e),
    })?;

    // Get all notebooks
    let notebooks = storage.list_notebooks().map_err(|e| CommandError {
        message: format!("Failed to list notebooks: {}", e),
    })?;

    // Collect all pages
    let mut all_pages = Vec::new();
    for notebook in notebooks {
        let pages = storage.list_pages(notebook.id).map_err(|e| CommandError {
            message: format!("Failed to list pages: {}", e),
        })?;
        all_pages.extend(pages);
    }

    // Rebuild index
    search_index
        .rebuild_index(&all_pages)
        .map_err(|e| CommandError {
            message: format!("Failed to rebuild index: {}", e),
        })?;

    Ok(())
}
