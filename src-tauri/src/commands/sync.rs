use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

use crate::sync::{QueueItem, SyncConfigInput, SyncResult, SyncStatus};
use crate::AppState;

type CommandResult<T> = Result<T, String>;

fn parse_uuid(s: &str) -> CommandResult<Uuid> {
    Uuid::parse_str(s).map_err(|e| format!("Invalid UUID: {}", e))
}

/// Test WebDAV connection
#[tauri::command]
pub async fn sync_test_connection(
    state: State<'_, AppState>,
    server_url: String,
    username: String,
    password: String,
) -> CommandResult<bool> {
    let sync_manager = state.sync_manager.lock().await;
    sync_manager
        .test_connection(&server_url, &username, &password)
        .await
        .map_err(|e| e.to_string())
}

/// Configure sync for a notebook
#[tauri::command]
pub async fn sync_configure(
    state: State<'_, AppState>,
    notebook_id: String,
    config: SyncConfigInput,
) -> CommandResult<()> {
    let uuid = parse_uuid(&notebook_id)?;
    let sync_manager = state.sync_manager.lock().await;

    // Pass Arc directly, SyncManager handles internal locking
    sync_manager
        .configure(uuid, &state.storage, config)
        .await
        .map_err(|e| e.to_string())
}

/// Get sync status for a notebook
#[tauri::command]
pub async fn sync_status(
    state: State<'_, AppState>,
    notebook_id: String,
) -> CommandResult<SyncStatus> {
    let uuid = parse_uuid(&notebook_id)?;
    let sync_manager = state.sync_manager.lock().await;

    // Short lock just to get the sync_config
    let sync_config = {
        let storage = state.storage.lock().unwrap();
        let notebook = storage
            .get_notebook(uuid)
            .map_err(|e| e.to_string())?;
        notebook.sync_config.clone()
    };

    Ok(sync_manager.get_status(uuid, sync_config.as_ref()))
}

/// Trigger manual sync
#[tauri::command]
pub async fn sync_now(
    state: State<'_, AppState>,
    notebook_id: String,
) -> CommandResult<SyncResult> {
    let uuid = parse_uuid(&notebook_id)?;
    let sync_manager = state.sync_manager.lock().await;

    // Pass Arc directly, SyncManager handles internal locking
    sync_manager
        .sync_notebook(uuid, &state.storage)
        .await
        .map_err(|e| e.to_string())
}

/// Get pending sync queue items for a notebook
#[tauri::command]
pub async fn sync_queue_status(
    state: State<'_, AppState>,
    notebook_id: String,
) -> CommandResult<Vec<QueueItem>> {
    let uuid = parse_uuid(&notebook_id)?;
    let sync_manager = state.sync_manager.lock().await;
    Ok(sync_manager.get_queue_items(uuid))
}

/// Disable sync for a notebook
#[tauri::command]
pub async fn sync_disable(
    state: State<'_, AppState>,
    notebook_id: String,
) -> CommandResult<()> {
    let uuid = parse_uuid(&notebook_id)?;
    let sync_manager = state.sync_manager.lock().await;

    // Pass Arc directly, SyncManager handles internal locking
    sync_manager
        .disable_sync(uuid, &state.storage)
        .map_err(|e| e.to_string())
}
