//! Tauri commands for inbox operations

use tauri::State;
use uuid::Uuid;

use crate::inbox::{
    ApplyActionsRequest, ApplyActionsResult, CaptureRequest, InboxClassification, InboxItem,
    InboxSummary, ClassificationAction,
};
use crate::storage::EditorData;
use crate::AppState;

type CommandResult<T> = Result<T, String>;

/// Capture a new item to the inbox
#[tauri::command]
pub fn inbox_capture(state: State<AppState>, request: CaptureRequest) -> CommandResult<InboxItem> {
    let inbox = state.inbox_storage.lock().map_err(|e| e.to_string())?;
    inbox.capture(request).map_err(|e| e.to_string())
}

/// List all inbox items
#[tauri::command]
pub fn inbox_list(state: State<AppState>) -> CommandResult<Vec<InboxItem>> {
    let inbox = state.inbox_storage.lock().map_err(|e| e.to_string())?;
    inbox.list_items().map_err(|e| e.to_string())
}

/// List unprocessed inbox items
#[tauri::command]
pub fn inbox_list_unprocessed(state: State<AppState>) -> CommandResult<Vec<InboxItem>> {
    let inbox = state.inbox_storage.lock().map_err(|e| e.to_string())?;
    inbox.list_unprocessed().map_err(|e| e.to_string())
}

/// Get inbox summary
#[tauri::command]
pub fn inbox_summary(state: State<AppState>) -> CommandResult<InboxSummary> {
    let inbox = state.inbox_storage.lock().map_err(|e| e.to_string())?;
    inbox.get_summary().map_err(|e| e.to_string())
}

/// Classify inbox items using AI
#[tauri::command]
pub async fn inbox_classify(
    state: State<'_, AppState>,
    item_ids: Option<Vec<Uuid>>,
) -> CommandResult<Vec<InboxItem>> {
    // Get items to classify
    let items_to_classify: Vec<InboxItem> = {
        let inbox = state.inbox_storage.lock().map_err(|e| e.to_string())?;

        if let Some(ids) = item_ids {
            ids.iter()
                .filter_map(|id| inbox.get_item(*id).ok())
                .filter(|item| !item.is_processed)
                .collect()
        } else {
            inbox.list_unclassified().map_err(|e| e.to_string())?
        }
    };

    if items_to_classify.is_empty() {
        return Ok(Vec::new());
    }

    // Get notebooks for context
    let notebooks: Vec<(Uuid, String)> = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        storage
            .list_notebooks()
            .map_err(|e| e.to_string())?
            .into_iter()
            .map(|n| (n.id, n.name))
            .collect()
    };

    // Get recent pages for context (up to 50)
    let recent_pages: Vec<(Uuid, Uuid, String)> = {
        let storage = state.storage.lock().map_err(|e| e.to_string())?;
        let mut pages = Vec::new();
        for (notebook_id, notebook_name) in &notebooks {
            if let Ok(notebook_pages) = storage.list_pages(*notebook_id) {
                for page in notebook_pages.into_iter().take(10) {
                    pages.push((*notebook_id, page.id, page.title));
                }
            }
        }
        pages
    };

    // Call Python AI for classification
    let python_ai = state.python_ai.lock().map_err(|e| e.to_string())?;

    let mut classified_items = Vec::new();

    for item in items_to_classify {
        // Build context for AI
        let notebooks_json: Vec<serde_json::Value> = notebooks
            .iter()
            .map(|(id, name)| {
                serde_json::json!({
                    "id": id.to_string(),
                    "name": name
                })
            })
            .collect();

        let pages_json: Vec<serde_json::Value> = recent_pages
            .iter()
            .map(|(notebook_id, page_id, title)| {
                let notebook_name = notebooks
                    .iter()
                    .find(|(id, _)| id == notebook_id)
                    .map(|(_, n)| n.as_str())
                    .unwrap_or("Unknown");
                serde_json::json!({
                    "notebookId": notebook_id.to_string(),
                    "notebookName": notebook_name,
                    "pageId": page_id.to_string(),
                    "title": title
                })
            })
            .collect();

        let classification_result = python_ai.classify_inbox_item(
            &item.title,
            &item.content,
            &item.tags,
            &notebooks_json,
            &pages_json,
        );

        match classification_result {
            Ok(classification) => {
                let inbox = state.inbox_storage.lock().map_err(|e| e.to_string())?;
                if let Ok(updated) = inbox.set_classification(item.id, classification) {
                    classified_items.push(updated);
                }
            }
            Err(e) => {
                log::warn!("Failed to classify inbox item {}: {}", item.id, e);
            }
        }
    }

    Ok(classified_items)
}

/// Apply actions to inbox items (move to notebooks/pages)
#[tauri::command]
pub fn inbox_apply_actions(
    state: State<AppState>,
    request: ApplyActionsRequest,
) -> CommandResult<ApplyActionsResult> {
    let mut result = ApplyActionsResult {
        processed_count: 0,
        created_pages: Vec::new(),
        updated_pages: Vec::new(),
        created_notebooks: Vec::new(),
        errors: Vec::new(),
    };

    let inbox = state.inbox_storage.lock().map_err(|e| e.to_string())?;
    let storage = state.storage.lock().map_err(|e| e.to_string())?;

    for item_id in &request.item_ids {
        let item = match inbox.get_item(*item_id) {
            Ok(item) => item,
            Err(e) => {
                result.errors.push(format!("Item {} not found: {}", item_id, e));
                continue;
            }
        };

        // Check for override
        let action = if let Some(ref overrides) = request.overrides {
            overrides
                .iter()
                .find(|o| o.item_id == *item_id)
                .map(|o| o.action.clone())
                .or(item.classification.as_ref().map(|c| c.action.clone()))
        } else {
            item.classification.as_ref().map(|c| c.action.clone())
        };

        let Some(action) = action else {
            result.errors.push(format!("Item {} has no classification", item_id));
            continue;
        };

        match action {
            ClassificationAction::CreatePage {
                notebook_id,
                suggested_title,
                suggested_tags,
                ..
            } => {
                // Create a new page
                let title = if suggested_title.is_empty() {
                    item.title.clone()
                } else {
                    suggested_title
                };

                let mut tags = item.tags.clone();
                tags.extend(suggested_tags);

                match storage.create_page(notebook_id, title) {
                    Ok(mut page) => {
                        // Set content and tags
                        page.tags = tags;
                        page.content = EditorData {
                            time: Some(chrono::Utc::now().timestamp_millis()),
                            version: Some("2.28.0".to_string()),
                            blocks: crate::markdown::parse_markdown_to_blocks(&item.content),
                        };

                        if let Err(e) = storage.update_page(&page) {
                            result.errors.push(format!("Failed to update page: {}", e));
                        } else {
                            result.created_pages.push(page.id);
                            let _ = inbox.mark_processed(*item_id);
                            result.processed_count += 1;
                        }
                    }
                    Err(e) => {
                        result.errors.push(format!("Failed to create page: {}", e));
                    }
                }
            }
            ClassificationAction::AppendToPage {
                notebook_id,
                page_id,
                ..
            } => {
                // Append to existing page
                match storage.get_page(notebook_id, page_id) {
                    Ok(mut page) => {
                        // Parse markdown and append blocks
                        let new_blocks = crate::markdown::parse_markdown_to_blocks(&item.content);
                        page.content.blocks.extend(new_blocks);

                        if let Err(e) = storage.update_page(&page) {
                            result.errors.push(format!("Failed to update page: {}", e));
                        } else {
                            result.updated_pages.push(page.id);
                            let _ = inbox.mark_processed(*item_id);
                            result.processed_count += 1;
                        }
                    }
                    Err(e) => {
                        result.errors.push(format!("Failed to get page: {}", e));
                    }
                }
            }
            ClassificationAction::CreateNotebook {
                suggested_name,
                suggested_icon,
            } => {
                // Create new notebook and page
                match storage.create_notebook(suggested_name.clone(), crate::storage::NotebookType::Standard) {
                    Ok(mut notebook) => {
                        if let Some(icon) = suggested_icon {
                            notebook.icon = Some(icon);
                            let _ = storage.update_notebook(&notebook);
                        }

                        result.created_notebooks.push(notebook.id);

                        // Create page in new notebook
                        if let Ok(mut page) = storage.create_page(notebook.id, item.title.clone()) {
                            page.tags = item.tags.clone();
                            page.content = EditorData {
                                time: Some(chrono::Utc::now().timestamp_millis()),
                                version: Some("2.28.0".to_string()),
                                blocks: crate::markdown::parse_markdown_to_blocks(&item.content),
                            };
                            let _ = storage.update_page(&page);
                            result.created_pages.push(page.id);
                        }

                        let _ = inbox.mark_processed(*item_id);
                        result.processed_count += 1;
                    }
                    Err(e) => {
                        result.errors.push(format!("Failed to create notebook: {}", e));
                    }
                }
            }
            ClassificationAction::KeepInInbox { .. } => {
                // Do nothing, keep in inbox
            }
        }
    }

    Ok(result)
}

/// Delete an inbox item
#[tauri::command]
pub fn inbox_delete(state: State<AppState>, item_id: Uuid) -> CommandResult<()> {
    let inbox = state.inbox_storage.lock().map_err(|e| e.to_string())?;
    inbox.delete_item(item_id).map_err(|e| e.to_string())
}

/// Clear all processed items
#[tauri::command]
pub fn inbox_clear_processed(state: State<AppState>) -> CommandResult<usize> {
    let inbox = state.inbox_storage.lock().map_err(|e| e.to_string())?;
    inbox.clear_processed().map_err(|e| e.to_string())
}
