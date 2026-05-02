use tauri::State;

use crate::search::SearchResult;
use crate::AppState;

use super::CommandError;

/// Search pages — STUB. The daemon now owns the Tantivy writer and exposes
/// `/api/search`. The frontend has been migrated to call the daemon HTTP API.
/// This Tauri command remains registered for invoke compatibility until
/// Phase 3 cleanup deletes it.
#[tauri::command]
pub fn search_pages(
    _state: State<AppState>,
    _query: String,
    _limit: Option<usize>,
) -> Result<Vec<SearchResult>, CommandError> {
    Ok(Vec::new())
}

/// Fuzzy search pages — STUB. See `search_pages` above.
#[tauri::command]
pub fn fuzzy_search_pages(
    _state: State<AppState>,
    _query: String,
    _limit: Option<usize>,
) -> Result<Vec<SearchResult>, CommandError> {
    Ok(Vec::new())
}

/// Rebuild the search index — STUB. The daemon owns the index; call
/// `POST /api/search/rebuild` instead.
#[tauri::command]
pub fn rebuild_search_index(_state: State<AppState>) -> Result<(), CommandError> {
    Ok(())
}
