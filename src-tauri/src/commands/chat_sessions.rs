use tauri::State;
use uuid::Uuid;

use crate::chat_sessions::{ChatSession, ChatSessionSummary};
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
