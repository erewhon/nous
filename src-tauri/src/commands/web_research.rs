//! Web research Tauri commands.

use tauri::State;

use crate::python_bridge::{AIConfig, ResearchSummary, ScrapedContent, SearchResponse};
use crate::AppState;

use super::notebook::CommandError;

/// Search the web using Tavily API
#[tauri::command]
pub fn web_search(
    state: State<AppState>,
    query: String,
    api_key: String,
    max_results: Option<i64>,
    search_depth: Option<String>,
    include_answer: Option<bool>,
) -> Result<SearchResponse, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai
        .web_search(
            query,
            api_key,
            max_results.unwrap_or(10),
            search_depth.unwrap_or_else(|| "basic".to_string()),
            include_answer.unwrap_or(true),
        )
        .map_err(|e| CommandError {
            message: format!("Web search error: {}", e),
        })
}

/// Scrape content from a URL
#[tauri::command]
pub fn scrape_url(state: State<AppState>, url: String) -> Result<ScrapedContent, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    python_ai.scrape_url(url).map_err(|e| CommandError {
        message: format!("URL scraping error: {}", e),
    })
}

/// Summarize research results using AI
#[tauri::command]
pub fn summarize_research(
    state: State<AppState>,
    contents: Vec<ScrapedContent>,
    query: String,
    provider_type: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<ResearchSummary, CommandError> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python AI lock: {}", e),
    })?;

    let config = AIConfig {
        provider_type: provider_type.unwrap_or_else(|| "openai".to_string()),
        api_key,
        model,
        temperature: Some(0.5),
        max_tokens: Some(2000),
    };

    python_ai
        .summarize_research(contents, query, config)
        .map_err(|e| CommandError {
            message: format!("Research summarization error: {}", e),
        })
}
