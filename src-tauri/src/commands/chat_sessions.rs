use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::chat_sessions::{ChatSession, ChatSessionSummary};
use crate::storage::{FileStorageMode, Page, PageType};
use crate::AppState;

type CommandResult<T> = Result<T, String>;

/// Create a new empty chat session
#[tauri::command]
pub fn chat_session_create(
    state: State<AppState>,
    title: Option<String>,
) -> CommandResult<ChatSession> {
    let storage = state.chat_session_storage.lock().map_err(|e| e.to_string())?;
    let session = ChatSession::new(title.unwrap_or_else(|| "New conversation".to_string()));
    storage.save_session(&session).map_err(|e| e.to_string())?;
    Ok(session)
}

/// Save a full chat session (overwrite)
#[tauri::command]
pub fn chat_session_save(
    state: State<AppState>,
    session: ChatSession,
) -> CommandResult<()> {
    let storage = state.chat_session_storage.lock().map_err(|e| e.to_string())?;
    storage.save_session(&session).map_err(|e| e.to_string())
}

/// Load a full session by ID
#[tauri::command]
pub fn chat_session_get(
    state: State<AppState>,
    id: Uuid,
) -> CommandResult<ChatSession> {
    let storage = state.chat_session_storage.lock().map_err(|e| e.to_string())?;
    storage.get_session(id).map_err(|e| e.to_string())
}

/// List all sessions as summaries, sorted by updatedAt desc
#[tauri::command]
pub fn chat_session_list(
    state: State<AppState>,
) -> CommandResult<Vec<ChatSessionSummary>> {
    let storage = state.chat_session_storage.lock().map_err(|e| e.to_string())?;
    storage.list_sessions().map_err(|e| e.to_string())
}

/// Delete a session by ID
#[tauri::command]
pub fn chat_session_delete(
    state: State<AppState>,
    id: Uuid,
) -> CommandResult<()> {
    let storage = state.chat_session_storage.lock().map_err(|e| e.to_string())?;
    storage.delete_session(id).map_err(|e| e.to_string())
}

/// Update just the title of a session
#[tauri::command]
pub fn chat_session_update_title(
    state: State<AppState>,
    id: Uuid,
    title: String,
) -> CommandResult<()> {
    let storage = state.chat_session_storage.lock().map_err(|e| e.to_string())?;
    storage.update_title(id, title).map_err(|e| e.to_string())
}

/// Result of migrating a single chat session
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigratedSession {
    pub old_id: String,
    pub new_page_id: String,
    pub title: String,
}

/// Migrate all chat sessions from ai_sessions/ to pages in a given folder
#[tauri::command]
pub fn migrate_chat_sessions_to_pages(
    state: State<AppState>,
    notebook_id: String,
    folder_id: String,
) -> CommandResult<Vec<MigratedSession>> {
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let f_id = Uuid::parse_str(&folder_id).map_err(|e| format!("Invalid folder ID: {}", e))?;

    // Load all sessions from the old storage
    let chat_storage = state.chat_session_storage.lock().map_err(|e| e.to_string())?;
    let session_summaries = chat_storage.list_sessions().map_err(|e| e.to_string())?;

    let storage = state.storage.lock().map_err(|e| e.to_string())?;

    let mut migrated: Vec<MigratedSession> = Vec::new();

    for summary in &session_summaries {
        // Load full session
        let session = match chat_storage.get_session(summary.id) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Failed to load session {} for migration: {}", summary.id, e);
                continue;
            }
        };

        // Create a new page
        let mut page = storage.create_page(nb_id, session.title.clone()).map_err(|e| e.to_string())?;

        // Set page type, folder, and file extension
        page.page_type = PageType::Chat;
        page.folder_id = Some(f_id);
        page.file_extension = Some("chat".to_string());
        page.source_file = Some(format!("files/{}.chat", page.id));
        page.storage_mode = Some(FileStorageMode::Embedded);
        page.created_at = session.created_at;
        page.updated_at = session.updated_at;

        // Create the files directory if needed
        let files_dir = storage.get_notebook_path(nb_id).join("files");
        if !files_dir.exists() {
            let _ = std::fs::create_dir_all(&files_dir);
        }

        // Write the session JSON as file content
        let session_json = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
        storage.write_native_file_content(&page, &session_json).map_err(|e| e.to_string())?;

        // Update page metadata
        storage.update_page_metadata(&page).map_err(|e| e.to_string())?;

        // Index for search
        if let Ok(mut search_index) = state.search_index.lock() {
            if let Err(e) = search_index.index_page_with_content(&page, &session_json) {
                log::warn!("Failed to index migrated chat page: {}", e);
            }
        }

        migrated.push(MigratedSession {
            old_id: session.id.to_string(),
            new_page_id: page.id.to_string(),
            title: session.title.clone(),
        });
    }

    // Delete old session files after successful migration
    for result in &migrated {
        if let Ok(old_id) = Uuid::parse_str(&result.old_id) {
            if let Err(e) = chat_storage.delete_session(old_id) {
                log::warn!("Failed to delete old session {}: {}", result.old_id, e);
            }
        }
    }

    Ok(migrated)
}
