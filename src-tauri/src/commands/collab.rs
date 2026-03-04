use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::collab::credentials;
use crate::collab::storage::{generate_session_id, make_room_id, CollabExpiry, CollabSession};
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

    let token_duration = expiry.to_duration().unwrap_or(chrono::Duration::hours(24));

    // Deterministic room ID from notebook + page
    let room_id = make_room_id(&nb_id, &pg_id);

    // Check for existing active session on this page
    {
        let store = collab_storage.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = store.get_active_session_for_page(pg_id)? {
            // Return existing session with a fresh token
            let token = token::generate_token(
                &room_id,
                &request.page_id,
                &secret,
                token_duration,
                "rw",
            );
            return Ok(StartCollabResponse {
                room_id: room_id.clone(),
                partykit_host: DEFAULT_PARTYKIT_HOST.to_string(),
                token,
                session: existing,
            });
        }
    }

    // Generate new session
    let session_id = generate_session_id();
    let now = chrono::Utc::now();
    let expires_at = expiry.to_duration().map(|d| now + d);

    // Generate RW and RO tokens
    let rw_token = token::generate_token(
        &room_id,
        &request.page_id,
        &secret,
        token_duration,
        "rw",
    );
    let ro_token = token::generate_token(
        &room_id,
        &request.page_id,
        &secret,
        token_duration,
        "r",
    );

    let share_url = format!(
        "https://collab.nous.page/{}?token={}",
        room_id, rw_token
    );
    let read_only_share_url = format!(
        "https://collab.nous.page/{}?token={}",
        room_id, ro_token
    );

    let session = CollabSession {
        id: session_id,
        scope_type: "page".to_string(),
        scope_id: Some(pg_id),
        notebook_id: nb_id,
        title: Some(page_title.clone()),
        expiry: expiry.clone(),
        created_at: now,
        expires_at,
        share_url,
        read_only_share_url: Some(read_only_share_url),
        is_active: true,
        page_id: Some(pg_id),
        page_title: Some(page_title),
    };

    // Persist session
    let session = {
        let store = collab_storage.lock().map_err(|e| e.to_string())?;
        store.create_session(session)?
    };

    Ok(StartCollabResponse {
        room_id: room_id.clone(),
        partykit_host: DEFAULT_PARTYKIT_HOST.to_string(),
        token: rw_token,
        session,
    })
}

// ── Scoped session (section / notebook) ────────────────────────────────

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartScopedCollabRequest {
    pub notebook_id: String,
    pub scope_type: String,
    pub scope_id: String,
    #[serde(default = "default_expiry")]
    pub expiry: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartScopedCollabResponse {
    pub session: CollabSession,
    pub token: String,
    pub partykit_host: String,
}

#[tauri::command]
pub async fn start_collab_session_scoped(
    state: State<'_, AppState>,
    request: StartScopedCollabRequest,
) -> Result<StartScopedCollabResponse, String> {
    let nb_id =
        Uuid::parse_str(&request.notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let scope_id =
        Uuid::parse_str(&request.scope_id).map_err(|e| format!("Invalid scope ID: {}", e))?;
    let expiry = CollabExpiry::from_str(&request.expiry)?;

    if request.scope_type != "section" && request.scope_type != "notebook" {
        return Err(format!("Invalid scope_type: {}. Must be 'section' or 'notebook'", request.scope_type));
    }

    let storage = state.storage.clone();
    let collab_storage = state.collab_storage.clone();
    let library_storage = state.library_storage.clone();

    // Resolve scope title and get data dir
    let (data_dir, scope_title) = {
        let lib_storage = library_storage.lock().map_err(|e| e.to_string())?;
        let library = lib_storage
            .get_current_library()
            .map_err(|e| format!("Failed to get library: {}", e))?;
        let dir = library.path.clone();

        let store = storage.lock().map_err(|e| e.to_string())?;
        let title = match request.scope_type.as_str() {
            "section" => {
                let section = store
                    .get_section(nb_id, scope_id)
                    .map_err(|e| format!("Failed to get section: {}", e))?;
                section.name
            }
            "notebook" => {
                let notebook = store
                    .get_notebook(nb_id)
                    .map_err(|e| format!("Failed to get notebook: {}", e))?;
                notebook.name
            }
            _ => unreachable!(),
        };

        (dir, title)
    };

    // Get or create global HMAC secret
    let secret = credentials::get_or_create_collab_secret(&data_dir)?;

    let token_duration = expiry.to_duration().unwrap_or(chrono::Duration::hours(24));

    // Check for existing active scoped session
    {
        let store = collab_storage.lock().map_err(|e| e.to_string())?;
        if let Some(existing) = store.get_active_session_for_scope(&request.scope_type, scope_id)? {
            let token = token::generate_scoped_token(
                &request.scope_type,
                &request.scope_id,
                &request.notebook_id,
                &secret,
                token_duration,
                "rw",
            );
            return Ok(StartScopedCollabResponse {
                partykit_host: DEFAULT_PARTYKIT_HOST.to_string(),
                token,
                session: existing,
            });
        }
    }

    // Generate new scoped session
    let session_id = generate_session_id();
    let now = chrono::Utc::now();
    let expires_at = expiry.to_duration().map(|d| now + d);

    // Generate RW and RO scoped tokens
    let rw_token = token::generate_scoped_token(
        &request.scope_type,
        &request.scope_id,
        &request.notebook_id,
        &secret,
        token_duration,
        "rw",
    );
    let ro_token = token::generate_scoped_token(
        &request.scope_type,
        &request.scope_id,
        &request.notebook_id,
        &secret,
        token_duration,
        "r",
    );

    let share_url = format!(
        "https://collab.nous.page/s/{}?token={}",
        session_id, rw_token
    );
    let read_only_share_url = format!(
        "https://collab.nous.page/s/{}?token={}",
        session_id, ro_token
    );

    let session = CollabSession {
        id: session_id,
        scope_type: request.scope_type.clone(),
        scope_id: Some(scope_id),
        notebook_id: nb_id,
        title: Some(scope_title),
        expiry: expiry.clone(),
        created_at: now,
        expires_at,
        share_url,
        read_only_share_url: Some(read_only_share_url),
        is_active: true,
        page_id: None,
        page_title: None,
    };

    // Persist session
    let session = {
        let store = collab_storage.lock().map_err(|e| e.to_string())?;
        store.create_session(session)?
    };

    Ok(StartScopedCollabResponse {
        partykit_host: DEFAULT_PARTYKIT_HOST.to_string(),
        token: rw_token,
        session,
    })
}

// ── List pages for scope ───────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSummary {
    pub id: String,
    pub title: String,
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub section_id: Option<String>,
}

#[tauri::command]
pub async fn list_pages_for_scope(
    state: State<'_, AppState>,
    notebook_id: String,
    scope_type: String,
    scope_id: String,
) -> Result<Vec<PageSummary>, String> {
    let nb_id =
        Uuid::parse_str(&notebook_id).map_err(|e| format!("Invalid notebook ID: {}", e))?;
    let s_id =
        Uuid::parse_str(&scope_id).map_err(|e| format!("Invalid scope ID: {}", e))?;

    let storage = state.storage.clone();
    let store = storage.lock().map_err(|e| e.to_string())?;

    let all_pages = store
        .list_pages(nb_id)
        .map_err(|e| format!("Failed to list pages: {}", e))?;

    // Build folder name lookup
    let folders = store
        .list_folders(nb_id)
        .unwrap_or_default();
    let folder_names: std::collections::HashMap<uuid::Uuid, String> = folders
        .iter()
        .map(|f| (f.id, f.name.clone()))
        .collect();

    let to_summary = |p: crate::storage::Page| -> PageSummary {
        let folder_name = p.folder_id.and_then(|fid| folder_names.get(&fid).cloned());
        PageSummary {
            id: p.id.to_string(),
            title: p.title,
            folder_id: p.folder_id.map(|f| f.to_string()),
            folder_name,
            section_id: p.section_id.map(|s| s.to_string()),
        }
    };

    let filtered: Vec<PageSummary> = match scope_type.as_str() {
        "section" => all_pages
            .into_iter()
            .filter(|p| p.section_id == Some(s_id) && !p.is_archived)
            .map(to_summary)
            .collect(),
        "notebook" => all_pages
            .into_iter()
            .filter(|p| !p.is_archived)
            .map(to_summary)
            .collect(),
        _ => return Err(format!("Invalid scope_type: {}", scope_type)),
    };

    Ok(filtered)
}

// ── Existing commands ──────────────────────────────────────────────────

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
