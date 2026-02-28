use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::share::html_gen::render_share_html;
use crate::share::storage::{build_share_record, ShareExpiry, ShareRecord};
use crate::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePageRequest {
    pub notebook_id: String,
    pub page_id: String,
    pub theme: String,
    pub expiry: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SharePageResponse {
    pub share: ShareRecord,
    pub local_url: String,
}

#[tauri::command]
pub async fn share_page(
    state: State<'_, AppState>,
    request: SharePageRequest,
) -> Result<SharePageResponse, String> {
    let nb_id =
        Uuid::parse_str(&request.notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let pg_id =
        Uuid::parse_str(&request.page_id).map_err(|e| format!("Invalid page ID: {}", e))?;
    let expiry = ShareExpiry::from_str(&request.expiry)?;

    let storage = state.storage.clone();
    let share_storage = state.share_storage.clone();
    let theme = request.theme.clone();

    tokio::task::spawn_blocking(move || {
        let storage = storage.lock().map_err(|e| e.to_string())?;

        let page = storage
            .get_page(nb_id, pg_id)
            .map_err(|e| format!("Failed to get page: {}", e))?;
        let all_pages = storage
            .list_pages(nb_id)
            .map_err(|e| format!("Failed to list pages: {}", e))?;

        // Render self-contained HTML
        let html = render_share_html(&storage, nb_id, &page, &all_pages, &theme)?;

        // Build record and persist
        let record = build_share_record(pg_id, nb_id, &page.title, &theme, expiry);
        let local_url = format!("http://localhost:7667/share/{}", record.id);

        let mut share_store = share_storage.lock().map_err(|e| e.to_string())?;
        let share = share_store.create_share(record, &html)?;

        Ok(SharePageResponse { share, local_url })
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn list_shares(state: State<'_, AppState>) -> Result<Vec<ShareRecord>, String> {
    let share_storage = state.share_storage.clone();

    tokio::task::spawn_blocking(move || {
        let store = share_storage.lock().map_err(|e| e.to_string())?;
        store.list_shares()
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}

#[tauri::command]
pub async fn delete_share(state: State<'_, AppState>, share_id: String) -> Result<(), String> {
    let share_storage = state.share_storage.clone();

    tokio::task::spawn_blocking(move || {
        let store = share_storage.lock().map_err(|e| e.to_string())?;
        store.delete_share(&share_id)
    })
    .await
    .map_err(|e| format!("Task failed: {}", e))?
}
