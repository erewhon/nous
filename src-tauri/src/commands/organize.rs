//! Tauri commands for AI-powered smart organize feature

use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::AppState;

type CommandResult<T> = Result<T, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeSuggestion {
    pub page_id: String,
    pub page_title: String,
    pub suggested_notebook_id: Option<String>,
    pub suggested_notebook_name: Option<String>,
    pub confidence: f32,
    pub reasoning: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeMove {
    pub page_id: String,
    pub target_notebook_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrganizeApplyResult {
    pub moved_count: usize,
    pub errors: Vec<String>,
}

/// Extract plain text from page content blocks, truncated to max_chars.
fn extract_text_summary(blocks: &[crate::storage::EditorBlock], max_chars: usize) -> String {
    let mut text = String::new();
    for block in blocks {
        if text.len() >= max_chars {
            break;
        }
        // Extract text from common block types
        if let Some(block_text) = block.data.get("text").and_then(|v| v.as_str()) {
            if !text.is_empty() {
                text.push(' ');
            }
            text.push_str(block_text);
        }
        // Also check for items in list/checklist blocks
        if let Some(items) = block.data.get("items").and_then(|v| v.as_array()) {
            for item in items {
                if let Some(item_text) = item.as_str() {
                    if !text.is_empty() {
                        text.push(' ');
                    }
                    text.push_str(item_text);
                } else if let Some(item_content) = item.get("content").and_then(|v| v.as_str()) {
                    if !text.is_empty() {
                        text.push(' ');
                    }
                    text.push_str(item_content);
                }
            }
        }
    }
    // Strip HTML tags (simple approach)
    let text = text
        .replace("<br>", " ")
        .replace("<br/>", " ")
        .replace("&nbsp;", " ");
    let re_result = regex::Regex::new(r"<[^>]+>");
    let text = match re_result {
        Ok(re) => re.replace_all(&text, "").to_string(),
        Err(_) => text,
    };
    if text.len() > max_chars {
        text[..max_chars].to_string()
    } else {
        text
    }
}

/// Suggest which notebook each page should be moved to using AI.
#[tauri::command]
pub async fn smart_organize_suggest(
    state: State<'_, AppState>,
    source_notebook_id: String,
    page_ids: Vec<String>,
    destination_notebook_ids: Vec<String>,
) -> CommandResult<Vec<OrganizeSuggestion>> {
    let source_nb_id = Uuid::parse_str(&source_notebook_id)
        .map_err(|e| format!("Invalid source notebook ID: {}", e))?;

    // Parse destination notebook IDs
    let dest_nb_ids: Vec<Uuid> = destination_notebook_ids
        .iter()
        .map(|id| Uuid::parse_str(id).map_err(|e| format!("Invalid destination notebook ID: {}", e)))
        .collect::<Result<Vec<_>, _>>()?;

    // Parse page IDs
    let pg_ids: Vec<Uuid> = page_ids
        .iter()
        .map(|id| Uuid::parse_str(id).map_err(|e| format!("Invalid page ID: {}", e)))
        .collect::<Result<Vec<_>, _>>()?;

    // Gather page data and destination context from storage
    let (pages_json, destinations_json) = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;

        // Build page data
        let mut pages_data: Vec<serde_json::Value> = Vec::new();
        for pg_id in &pg_ids {
            match storage.get_page(source_nb_id, *pg_id) {
                Ok(page) => {
                    let content_summary = extract_text_summary(&page.content.blocks, 500);
                    pages_data.push(serde_json::json!({
                        "id": pg_id.to_string(),
                        "title": page.title,
                        "content_summary": content_summary,
                        "tags": page.tags,
                    }));
                }
                Err(e) => {
                    log::warn!("Failed to load page {}: {}", pg_id, e);
                }
            }
        }

        // Build destination notebook context
        let mut destinations_data: Vec<serde_json::Value> = Vec::new();
        for dest_id in &dest_nb_ids {
            match storage.list_notebooks() {
                Ok(notebooks) => {
                    if let Some(notebook) = notebooks.iter().find(|n| n.id == *dest_id) {
                        // Get up to 5 recent page titles for context
                        let sample_titles: Vec<String> = storage
                            .list_pages(*dest_id)
                            .unwrap_or_default()
                            .into_iter()
                            .filter(|p| p.deleted_at.is_none() && !p.is_archived)
                            .take(5)
                            .map(|p| p.title)
                            .collect();

                        destinations_data.push(serde_json::json!({
                            "id": dest_id.to_string(),
                            "name": notebook.name,
                            "sample_page_titles": sample_titles,
                        }));
                    }
                }
                Err(e) => {
                    log::warn!("Failed to list notebooks: {}", e);
                }
            }
        }

        (pages_data, destinations_data)
    };

    if pages_json.is_empty() {
        return Ok(Vec::new());
    }

    // Call Python AI bridge
    let python_ai = state.python_ai.lock().map_err(|e| e.to_string())?;

    let ai_results = python_ai
        .smart_organize(&pages_json, &destinations_json)
        .map_err(|e| format!("AI analysis error: {}", e))?;

    // Build lookup maps for enriching results
    let page_title_map: std::collections::HashMap<String, String> = pages_json
        .iter()
        .filter_map(|p| {
            let id = p.get("id")?.as_str()?.to_string();
            let title = p.get("title")?.as_str()?.to_string();
            Some((id, title))
        })
        .collect();

    let notebook_name_map: std::collections::HashMap<String, String> = destinations_json
        .iter()
        .filter_map(|d| {
            let id = d.get("id")?.as_str()?.to_string();
            let name = d.get("name")?.as_str()?.to_string();
            Some((id, name))
        })
        .collect();

    // Parse AI results into OrganizeSuggestion
    let suggestions: Vec<OrganizeSuggestion> = ai_results
        .into_iter()
        .map(|result| {
            let page_id = result
                .get("page_id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            let suggested_notebook_id = result
                .get("suggested_notebook_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let suggested_notebook_name = suggested_notebook_id
                .as_ref()
                .and_then(|id| notebook_name_map.get(id).cloned());

            let page_title = page_title_map
                .get(&page_id)
                .cloned()
                .unwrap_or_else(|| "Unknown".to_string());

            let confidence = result
                .get("confidence")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0) as f32;

            let reasoning = result
                .get("reasoning")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();

            OrganizeSuggestion {
                page_id,
                page_title,
                suggested_notebook_id,
                suggested_notebook_name,
                confidence,
                reasoning,
            }
        })
        .collect();

    Ok(suggestions)
}

/// Apply organize moves — move pages to their suggested notebooks.
#[tauri::command]
pub async fn smart_organize_apply(
    state: State<'_, AppState>,
    source_notebook_id: String,
    moves: Vec<OrganizeMove>,
) -> CommandResult<OrganizeApplyResult> {
    let source_nb_id = Uuid::parse_str(&source_notebook_id)
        .map_err(|e| format!("Invalid source notebook ID: {}", e))?;

    let mut result = OrganizeApplyResult {
        moved_count: 0,
        errors: Vec::new(),
    };

    let storage = state.storage.lock().map_err(|e| e.to_string())?;

    for mv in &moves {
        let page_id = match Uuid::parse_str(&mv.page_id) {
            Ok(id) => id,
            Err(e) => {
                result
                    .errors
                    .push(format!("Invalid page ID {}: {}", mv.page_id, e));
                continue;
            }
        };

        let target_nb_id = match Uuid::parse_str(&mv.target_notebook_id) {
            Ok(id) => id,
            Err(e) => {
                result.errors.push(format!(
                    "Invalid target notebook ID {}: {}",
                    mv.target_notebook_id, e
                ));
                continue;
            }
        };

        match storage.move_page_to_notebook(source_nb_id, page_id, target_nb_id, None) {
            Ok(moved_page) => {
                // Update search index
                if let Ok(mut search_index) = state.search_index.lock() {
                    let _ = search_index.remove_page(page_id);
                    let _ = search_index.index_page(&moved_page);
                }
                result.moved_count += 1;
            }
            Err(e) => {
                result
                    .errors
                    .push(format!("Failed to move page {}: {}", mv.page_id, e));
            }
        }
    }

    Ok(result)
}
