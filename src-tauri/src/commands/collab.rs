use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::collab::credentials;
use crate::collab::storage::{generate_room_id, CollabExpiry, CollabSession};
use crate::collab::token;
use crate::AppState;

const DEFAULT_PARTYKIT_HOST: &str = "party.nous.page";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCollabRequest {
    pub notebook_id: String,
    pub page_id: String,
    #[serde(default = "default_expiry")]
    pub expiry: String,
}

fn default_expiry() -> String {
    "8h".to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartCollabResponse {
    pub session: CollabSession,
    pub token: String,
    pub room_id: String,
    pub partykit_host: String,
}

#[tauri::command]
pub async fn start_collab_session(
    state: State<'_, AppState>,
    request: StartCollabRequest,
) -> Result<StartCollabResponse, String> {
    let nb_id =
        Uuid::parse_str(&request.notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let pg_id =
        Uuid::parse_str(&request.page_id).map_err(|e| format!("Invalid page ID: {}", e))?;
    let expiry = CollabExpiry::from_str(&request.expiry)?;

    let storage = state.storage.clone();
    let collab_storage = state.collab_storage.clone();
    let library_storage = state.library_storage.clone();

    // Get data dir and page title
    let (data_dir, page_title) = {
        let lib_storage = library_storage.lock().map_err(|e| e.to_string())?;
        let library = lib_storage
            .get_current_library()
            .map_err(|e| format!("Failed to get library: {}", e))?;
        let dir = library.path.clone();

        let store = storage.lock().map_err(|e| e.to_string())?;
        let page = store
            .get_page(nb_id, pg_id)
            .map_err(|e| format!("Failed to get page: {}", e))?;

        (dir, page.title.clone())
    };

    // Get or create global HMAC secret
    let secret = credentials::get_or_create_collab_secret(&data_dir)?;

    // Check for existing active session on this page
    {
        let store = collab_storage.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = store.get_active_session_for_page(pg_id)? {
            // Return existing session with a fresh token
            let token = token::generate_token(
                &existing.id,
                &request.page_id,
                &secret,
                expiry.to_duration().unwrap_or(chrono::Duration::hours(24)),
            );
            return Ok(StartCollabResponse {
                room_id: existing.id.clone(),
                partykit_host: DEFAULT_PARTYKIT_HOST.to_string(),
                token,
                session: existing,
            });
        }
    }

    // Generate new session
    let room_id = generate_room_id();
    let now = chrono::Utc::now();
    let expires_at = expiry.to_duration().map(|d| now + d);

    let share_url = format!(
        "https://collab.nous.page/{}?token=placeholder",
        room_id
    );

    let session = CollabSession {
        id: room_id.clone(),
        page_id: pg_id,
        notebook_id: nb_id,
        page_title,
        expiry: expiry.clone(),
        created_at: now,
        expires_at,
        share_url: share_url.clone(),
        is_active: true,
    };

    // Generate token
    let token = token::generate_token(
        &room_id,
        &request.page_id,
        &secret,
        expiry.to_duration().unwrap_or(chrono::Duration::hours(24)),
    );

    // Update share URL with real token
    let final_share_url = format!(
        "https://collab.nous.page/{}?token={}",
        room_id, token
    );

    let mut session = session;
    session.share_url = final_share_url;

    // Persist session
    let session = {
        let store = collab_storage.lock().map_err(|e| e.to_string())?;
        store.create_session(session)?
    };

    Ok(StartCollabResponse {
        room_id,
        partykit_host: DEFAULT_PARTYKIT_HOST.to_string(),
        token,
        session,
    })
}

#[tauri::command]
pub async fn stop_collab_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let collab_storage = state.collab_storage.clone();
    let store = collab_storage.lock().map_err(|e| e.to_string())?;
    store.stop_session(&session_id)
}

#[tauri::command]
pub async fn list_collab_sessions(
    state: State<'_, AppState>,
) -> Result<Vec<CollabSession>, String> {
    let collab_storage = state.collab_storage.clone();
    let store = collab_storage.lock().map_err(|e| e.to_string())?;
    store.list_active_sessions()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabConfigResponse {
    pub partykit_host: String,
}

#[tauri::command]
pub async fn get_collab_config(
    _state: State<'_, AppState>,
) -> Result<CollabConfigResponse, String> {
    Ok(CollabConfigResponse {
        partykit_host: DEFAULT_PARTYKIT_HOST.to_string(),
    })
}
