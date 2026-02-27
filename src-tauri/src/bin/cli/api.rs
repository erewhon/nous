//! HTTP API for the Nous daemon.
//!
//! Provides REST endpoints for external processes to interact with notebooks.

use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use nous_lib::commands::{create_daily_note_core, find_daily_note};
use nous_lib::inbox::{CaptureRequest, CaptureSource};
use nous_lib::storage::{EditorBlock, EditorData};

use super::daemon::DaemonState;

// ===== Request/Response types =====

#[derive(Serialize)]
struct ApiResponse<T: Serialize> {
    data: T,
}

#[derive(Serialize)]
struct ApiError {
    error: String,
}

#[derive(Deserialize)]
struct CreatePageRequest {
    title: String,
    content: Option<String>,
    tags: Option<Vec<String>>,
    folder_id: Option<String>,
}

#[derive(Deserialize)]
struct UpdatePageRequest {
    title: Option<String>,
    content: Option<String>,
    tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct AppendPageRequest {
    content: String,
}

#[derive(Deserialize)]
struct CreateDailyNoteRequest {
    template_id: Option<String>,
}

#[derive(Deserialize)]
struct InboxCaptureRequest {
    title: String,
    content: Option<String>,
    tags: Option<Vec<String>>,
}

#[derive(Serialize)]
struct StatusResponse {
    status: String,
    pid: u32,
    uptime_secs: u64,
}

// Track daemon start time
static START_TIME: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();

type AppState = Arc<DaemonState>;

fn api_err(status: StatusCode, msg: impl Into<String>) -> (StatusCode, Json<ApiError>) {
    (status, Json(ApiError { error: msg.into() }))
}

fn parse_uuid(s: &str) -> Result<Uuid, (StatusCode, Json<ApiError>)> {
    Uuid::parse_str(s).map_err(|e| api_err(StatusCode::BAD_REQUEST, format!("Invalid UUID: {}", e)))
}

// ===== Router =====

pub fn build_router(state: AppState) -> Router {
    START_TIME.get_or_init(std::time::Instant::now);

    Router::new()
        .route("/api/status", get(get_status))
        .route("/api/notebooks", get(list_notebooks))
        .route("/api/notebooks/{notebook_id}/pages", get(list_pages))
        .route("/api/notebooks/{notebook_id}/pages", post(create_page))
        .route(
            "/api/notebooks/{notebook_id}/pages/{page_id}",
            get(get_page),
        )
        .route(
            "/api/notebooks/{notebook_id}/pages/{page_id}",
            put(update_page),
        )
        .route(
            "/api/notebooks/{notebook_id}/pages/{page_id}/append",
            post(append_to_page),
        )
        .route(
            "/api/notebooks/{notebook_id}/daily-notes/{date}",
            get(get_daily_note),
        )
        .route(
            "/api/notebooks/{notebook_id}/daily-notes/{date}",
            post(create_or_get_daily_note),
        )
        .route("/api/inbox", get(list_inbox))
        .route("/api/inbox", post(capture_inbox))
        .route("/api/sync/trigger", post(trigger_sync))
        .with_state(state)
}

// ===== Handlers =====

async fn get_status() -> impl IntoResponse {
    let uptime = START_TIME
        .get()
        .map(|t| t.elapsed().as_secs())
        .unwrap_or(0);

    Json(ApiResponse {
        data: StatusResponse {
            status: "running".to_string(),
            pid: std::process::id(),
            uptime_secs: uptime,
        },
    })
}

async fn list_notebooks(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let storage = state.storage.lock().unwrap();
    match storage.list_notebooks() {
        Ok(notebooks) => Ok(Json(ApiResponse { data: notebooks })),
        Err(e) => Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

async fn list_pages(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();
    match storage.list_pages(nb_id) {
        Ok(pages) => Ok(Json(ApiResponse { data: pages })),
        Err(e) => Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

async fn get_page(
    State(state): State<AppState>,
    Path((notebook_id, page_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&page_id)?;
    let storage = state.storage.lock().unwrap();
    match storage.get_page(nb_id, pg_id) {
        Ok(page) => Ok(Json(ApiResponse { data: page })),
        Err(e) => Err(api_err(StatusCode::NOT_FOUND, e.to_string())),
    }
}

async fn create_page(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(req): Json<CreatePageRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();

    let mut page = match storage.create_page(nb_id, req.title) {
        Ok(p) => p,
        Err(e) => return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    };

    // Set content if provided
    if let Some(text) = req.content {
        page.content = make_paragraph_content(&text);
    }

    // Set tags
    if let Some(tags) = req.tags {
        page.tags = tags;
    }

    // Set folder
    if let Some(fid) = req.folder_id {
        if let Ok(uuid) = Uuid::parse_str(&fid) {
            page.folder_id = Some(uuid);
        }
    }

    if let Err(e) = storage.update_page(&page) {
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
    }

    // Queue sync
    state.sync_manager.queue_page_update(nb_id, page.id);

    Ok((StatusCode::CREATED, Json(ApiResponse { data: page })))
}

async fn update_page(
    State(state): State<AppState>,
    Path((notebook_id, page_id)): Path<(String, String)>,
    Json(req): Json<UpdatePageRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&page_id)?;
    let storage = state.storage.lock().unwrap();

    let mut page = match storage.get_page(nb_id, pg_id) {
        Ok(p) => p,
        Err(e) => return Err(api_err(StatusCode::NOT_FOUND, e.to_string())),
    };

    if let Some(title) = req.title {
        page.title = title;
    }
    if let Some(text) = req.content {
        page.content = make_paragraph_content(&text);
    }
    if let Some(tags) = req.tags {
        page.tags = tags;
    }

    page.updated_at = chrono::Utc::now();

    if let Err(e) = storage.update_page(&page) {
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
    }

    state.sync_manager.queue_page_update(nb_id, pg_id);

    Ok(Json(ApiResponse { data: page }))
}

async fn append_to_page(
    State(state): State<AppState>,
    Path((notebook_id, page_id)): Path<(String, String)>,
    Json(req): Json<AppendPageRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&page_id)?;
    let storage = state.storage.lock().unwrap();

    let mut page = match storage.get_page(nb_id, pg_id) {
        Ok(p) => p,
        Err(e) => return Err(api_err(StatusCode::NOT_FOUND, e.to_string())),
    };

    // Append paragraphs
    let new_blocks = text_to_blocks(&req.content);
    page.content.blocks.extend(new_blocks);
    page.updated_at = chrono::Utc::now();

    if let Err(e) = storage.update_page(&page) {
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
    }

    state.sync_manager.queue_page_update(nb_id, pg_id);

    Ok(Json(ApiResponse { data: page }))
}

async fn get_daily_note(
    State(state): State<AppState>,
    Path((notebook_id, date)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();

    match find_daily_note(&storage, nb_id, &date) {
        Ok(Some(page)) => Ok(Json(ApiResponse { data: page })),
        Ok(None) => Err(api_err(
            StatusCode::NOT_FOUND,
            format!("No daily note for {}", date),
        )),
        Err(e) => Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.message)),
    }
}

async fn create_or_get_daily_note(
    State(state): State<AppState>,
    Path((notebook_id, date)): Path<(String, String)>,
    body: Option<Json<CreateDailyNoteRequest>>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let template_id = body.and_then(|b| b.template_id.clone());
    let storage = state.storage.lock().unwrap();

    match create_daily_note_core(&storage, nb_id, &date, template_id) {
        Ok(page) => {
            state.sync_manager.queue_page_update(nb_id, page.id);
            Ok(Json(ApiResponse { data: page }))
        }
        Err(e) => Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.message)),
    }
}

async fn list_inbox(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let inbox = state.inbox_storage.lock().unwrap();
    match inbox.list_items() {
        Ok(items) => Ok(Json(ApiResponse { data: items })),
        Err(e) => Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

async fn capture_inbox(
    State(state): State<AppState>,
    Json(req): Json<InboxCaptureRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let inbox = state.inbox_storage.lock().unwrap();
    let capture = CaptureRequest {
        title: req.title,
        content: req.content.unwrap_or_default(),
        tags: req.tags,
        source: Some(CaptureSource::Api {
            source: "daemon-api".to_string(),
        }),
        auto_classify: None,
    };

    match inbox.capture(capture) {
        Ok(item) => Ok((StatusCode::CREATED, Json(ApiResponse { data: item }))),
        Err(e) => Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string())),
    }
}

async fn trigger_sync(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    // Trigger sync for all notebooks with sync configured
    let notebooks = {
        let storage = state.storage.lock().unwrap();
        storage.list_notebooks().unwrap_or_default()
    };

    let mut synced = 0;
    for notebook in &notebooks {
        if notebook
            .sync_config
            .as_ref()
            .map(|c| c.enabled)
            .unwrap_or(false)
        {
            match state
                .sync_manager
                .sync_notebook(notebook.id, &state.storage)
                .await
            {
                Ok(_) => synced += 1,
                Err(e) => log::warn!("Sync failed for notebook {}: {}", notebook.name, e),
            }
        }
    }

    Ok(Json(ApiResponse {
        data: serde_json::json!({
            "synced_notebooks": synced,
        }),
    }))
}

// ===== Helpers =====

fn make_paragraph_content(text: &str) -> EditorData {
    EditorData {
        time: Some(chrono::Utc::now().timestamp_millis()),
        version: Some("2.28.0".to_string()),
        blocks: text_to_blocks(text),
    }
}

fn text_to_blocks(text: &str) -> Vec<EditorBlock> {
    text.split("\n\n")
        .filter(|s| !s.trim().is_empty())
        .map(|paragraph| EditorBlock {
            id: Uuid::new_v4().to_string()[..10].to_string(),
            block_type: "paragraph".to_string(),
            data: serde_json::json!({ "text": paragraph.trim() }),
        })
        .collect()
}
