use tauri::State;

use crate::search::SearchResult;
use crate::storage::PageType;
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

    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python bridge lock: {}", e),
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
