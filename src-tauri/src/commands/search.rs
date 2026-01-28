use std::collections::HashSet;

use tauri::State;
use uuid::Uuid;

use crate::search::SearchResult;
use crate::storage::PageType;
use crate::AppState;

use super::CommandError;

/// Get the set of notebook IDs that are encrypted but not unlocked (i.e., locked)
fn get_locked_notebook_ids(state: &State<AppState>) -> Result<HashSet<Uuid>, CommandError> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let encryption_manager = &state.encryption_manager;

    let notebooks = storage.list_notebooks().map_err(|e| CommandError {
        message: format!("Failed to list notebooks: {}", e),
    })?;

    let mut locked_ids = HashSet::new();
    for notebook in notebooks {
        if notebook.is_encrypted() && !encryption_manager.is_notebook_unlocked(notebook.id) {
            locked_ids.insert(notebook.id);
        }
    }

    Ok(locked_ids)
}

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

    // Get locked notebook IDs to filter out
    let locked_ids = get_locked_notebook_ids(&state)?;

    let results = search_index
        .search(&query, limit.unwrap_or(20))
        .map_err(|e| CommandError {
            message: format!("Search error: {}", e),
        })?;

    // Filter out results from locked notebooks
    let filtered_results: Vec<SearchResult> = results
        .into_iter()
        .filter(|r| {
            if let Ok(notebook_id) = Uuid::parse_str(&r.notebook_id) {
                !locked_ids.contains(&notebook_id)
            } else {
                true // Keep results with invalid UUIDs (shouldn't happen)
            }
        })
        .collect();

    Ok(filtered_results)
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

    // Get locked notebook IDs to filter out
    let locked_ids = get_locked_notebook_ids(&state)?;

    let results = search_index
        .fuzzy_search(&query, limit.unwrap_or(10))
        .map_err(|e| CommandError {
            message: format!("Fuzzy search error: {}", e),
        })?;

    // Filter out results from locked notebooks
    let filtered_results: Vec<SearchResult> = results
        .into_iter()
        .filter(|r| {
            if let Ok(notebook_id) = Uuid::parse_str(&r.notebook_id) {
                !locked_ids.contains(&notebook_id)
            } else {
                true
            }
        })
        .collect();

    Ok(filtered_results)
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

    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python bridge lock: {}", e),
    })?;

    let encryption_manager = &state.encryption_manager;

    // Get all notebooks
    let notebooks = storage.list_notebooks().map_err(|e| CommandError {
        message: format!("Failed to list notebooks: {}", e),
    })?;

    // Collect all pages from unlocked notebooks only
    let mut all_pages = Vec::new();
    for notebook in notebooks {
        // Skip encrypted notebooks that are locked
        if notebook.is_encrypted() && !encryption_manager.is_notebook_unlocked(notebook.id) {
            log::debug!(
                "Skipping indexing for locked encrypted notebook: {}",
                notebook.id
            );
            continue;
        }

        let pages = storage.list_pages(notebook.id).map_err(|e| CommandError {
            message: format!("Failed to list pages: {}", e),
        })?;
        all_pages.extend(pages);
    }

    // Clear the index first
    search_index
        .rebuild_index(&[])
        .map_err(|e| CommandError {
            message: format!("Failed to clear index: {}", e),
        })?;

    // Index each page with proper content extraction
    for page in &all_pages {
        let result = match page.page_type {
            PageType::Jupyter | PageType::Markdown | PageType::Calendar => {
                // Read file content for text-based files
                match storage.read_native_file_content(page) {
                    Ok(content) => search_index.index_page_with_content(page, &content),
                    Err(e) => {
                        log::warn!("Failed to read file content for indexing: {}", e);
                        search_index.index_page(page)
                    }
                }
            }
            PageType::Pdf | PageType::Epub => {
                // Extract PDF/EPUB text using Python bridge (markitdown)
                let file_type = format!("{:?}", page.page_type);
                match storage.get_file_path(page) {
                    Ok(path) => {
                        match python_ai.convert_document(path.to_string_lossy().to_string()) {
                            Ok(result) => {
                                if result.error.is_none() {
                                    search_index.index_page_with_content(page, &result.content)
                                } else {
                                    log::warn!("{} text extraction error: {:?}", file_type, result.error);
                                    search_index.index_page(page)
                                }
                            }
                            Err(e) => {
                                log::warn!("Failed to extract {} text for indexing: {}", file_type, e);
                                search_index.index_page(page)
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Failed to get {} file path for indexing: {}", file_type, e);
                        search_index.index_page(page)
                    }
                }
            }
            _ => search_index.index_page(page),
        };

        if let Err(e) = result {
            log::warn!("Failed to index page {}: {}", page.id, e);
        }
    }

    Ok(())
}
