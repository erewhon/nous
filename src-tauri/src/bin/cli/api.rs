//! HTTP API for the Nous daemon.
//!
//! Provides REST endpoints for external processes to interact with notebooks.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use nous_lib::commands::{create_daily_note_core, find_daily_note};
use nous_lib::inbox::{CaptureRequest, CaptureSource};
use nous_lib::share::storage::ShareStorage;
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
    /// Plain text content (double newlines become separate paragraphs)
    content: Option<String>,
    /// Structured Editor.js blocks (takes priority over `content`)
    blocks: Option<Vec<EditorBlock>>,
    tags: Option<Vec<String>>,
    folder_id: Option<String>,
}

#[derive(Deserialize)]
struct UpdatePageRequest {
    title: Option<String>,
    /// Plain text content (double newlines become separate paragraphs)
    content: Option<String>,
    /// Structured Editor.js blocks (takes priority over `content`)
    blocks: Option<Vec<EditorBlock>>,
    tags: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct AppendPageRequest {
    /// Plain text to append (double newlines become separate paragraphs)
    content: Option<String>,
    /// Structured Editor.js blocks to append (takes priority over `content`)
    blocks: Option<Vec<EditorBlock>>,
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

#[derive(Deserialize)]
struct RecordProgressRequest {
    date: String,
    completed: Option<bool>,
    value: Option<u32>,
}

#[derive(Deserialize)]
struct DateRangeQuery {
    start: Option<String>,
    end: Option<String>,
    days: Option<u32>,
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
        .route("/api/goals", get(list_goals))
        .route("/api/goals/summary", get(get_goals_summary))
        .route("/api/goals/{goal_id}", get(get_goal))
        .route("/api/goals/{goal_id}/progress", get(get_goal_progress))
        .route(
            "/api/goals/{goal_id}/progress",
            post(record_goal_progress),
        )
        .route("/api/energy/checkins", get(get_energy_checkins))
        .route("/api/energy/patterns", get(get_energy_patterns))
        .route("/api/sync/trigger", post(trigger_sync))
        // Share routes
        .route("/share/{share_id}", get(serve_share))
        .route("/api/shares", get(list_shares))
        .route("/api/shares/{share_id}", delete(delete_share))
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

    // Set content if provided (blocks take priority over plain text)
    if let Some(blocks) = req.blocks {
        page.content = make_block_content(blocks);
    } else if let Some(text) = req.content {
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
    if let Some(blocks) = req.blocks {
        page.content = make_block_content(blocks);
    } else if let Some(text) = req.content {
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

    // Append blocks (structured blocks take priority over plain text)
    let new_blocks = if let Some(blocks) = req.blocks {
        blocks
    } else if let Some(text) = req.content {
        text_to_blocks(&text)
    } else {
        return Err(api_err(StatusCode::BAD_REQUEST, "Either 'content' or 'blocks' is required"));
    };
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

// ===== Goals handlers =====

async fn list_goals(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let goals_storage = state.goals_storage.lock().unwrap();
    let goals = goals_storage
        .list_active_goals()
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Return goals with inline stats
    let mut results = Vec::new();
    for goal in goals {
        let stats = goals_storage
            .calculate_stats(goal.id)
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        results.push(serde_json::json!({
            "goal": goal,
            "stats": stats,
        }));
    }

    Ok(Json(ApiResponse { data: results }))
}

async fn get_goals_summary(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let goals_storage = state.goals_storage.lock().unwrap();
    let summary = goals_storage
        .get_summary()
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(ApiResponse { data: summary }))
}

async fn get_goal(
    State(state): State<AppState>,
    Path(goal_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let id = parse_uuid(&goal_id)?;
    let goals_storage = state.goals_storage.lock().unwrap();

    let goal = goals_storage
        .get_goal(id)
        .map_err(|e| api_err(StatusCode::NOT_FOUND, e.to_string()))?;
    let stats = goals_storage
        .calculate_stats(id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ApiResponse {
        data: serde_json::json!({
            "goal": goal,
            "stats": stats,
        }),
    }))
}

async fn get_goal_progress(
    State(state): State<AppState>,
    Path(goal_id): Path<String>,
    Query(query): Query<DateRangeQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let id = parse_uuid(&goal_id)?;
    let goals_storage = state.goals_storage.lock().unwrap();

    let entries = if let (Some(start), Some(end)) = (&query.start, &query.end) {
        let start_date = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
            .map_err(|e| api_err(StatusCode::BAD_REQUEST, format!("Invalid start date: {}", e)))?;
        let end_date = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d")
            .map_err(|e| api_err(StatusCode::BAD_REQUEST, format!("Invalid end date: {}", e)))?;
        goals_storage
            .get_progress_range(id, start_date, end_date)
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else if let Some(days) = query.days {
        let end_date = chrono::Local::now().date_naive();
        let start_date = end_date - chrono::Duration::days(days as i64);
        goals_storage
            .get_progress_range(id, start_date, end_date)
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        goals_storage
            .get_progress(id)
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    };

    Ok(Json(ApiResponse { data: entries }))
}

async fn record_goal_progress(
    State(state): State<AppState>,
    Path(goal_id): Path<String>,
    Json(req): Json<RecordProgressRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let id = parse_uuid(&goal_id)?;
    let goals_storage = state.goals_storage.lock().unwrap();

    let date = chrono::NaiveDate::parse_from_str(&req.date, "%Y-%m-%d")
        .map_err(|e| api_err(StatusCode::BAD_REQUEST, format!("Invalid date: {}", e)))?;

    let completed = req.completed.unwrap_or(true);

    let progress = if let Some(value) = req.value {
        nous_lib::goals::GoalProgress::new_auto(id, date, completed, value)
    } else {
        nous_lib::goals::GoalProgress::new_manual(id, date, completed)
    };

    let result = goals_storage
        .record_progress(progress)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(ApiResponse { data: result })))
}

// ===== Energy handlers =====

async fn get_energy_checkins(
    State(state): State<AppState>,
    Query(query): Query<DateRangeQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let energy_storage = state.energy_storage.lock().unwrap();

    let checkins = if let (Some(start), Some(end)) = (&query.start, &query.end) {
        let start_date = chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
            .map_err(|e| api_err(StatusCode::BAD_REQUEST, format!("Invalid start date: {}", e)))?;
        let end_date = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d")
            .map_err(|e| api_err(StatusCode::BAD_REQUEST, format!("Invalid end date: {}", e)))?;
        energy_storage
            .get_checkins_range(start_date, end_date)
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    } else {
        energy_storage
            .list_checkins()
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    };

    Ok(Json(ApiResponse { data: checkins }))
}

async fn get_energy_patterns(
    State(state): State<AppState>,
    Query(query): Query<DateRangeQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let energy_storage = state.energy_storage.lock().unwrap();

    let end_date = if let Some(end) = &query.end {
        chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d")
            .map_err(|e| api_err(StatusCode::BAD_REQUEST, format!("Invalid end date: {}", e)))?
    } else {
        chrono::Local::now().date_naive()
    };

    let start_date = if let Some(start) = &query.start {
        chrono::NaiveDate::parse_from_str(start, "%Y-%m-%d")
            .map_err(|e| api_err(StatusCode::BAD_REQUEST, format!("Invalid start date: {}", e)))?
    } else {
        end_date - chrono::Duration::days(90)
    };

    let patterns = energy_storage
        .calculate_patterns(start_date, end_date)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ApiResponse { data: patterns }))
}

// ===== Share handlers =====

async fn serve_share(
    State(state): State<AppState>,
    Path(share_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    // Validate share_id is alphanumeric
    if !share_id.chars().all(|c| c.is_alphanumeric()) {
        return Err(api_err(StatusCode::BAD_REQUEST, "Invalid share ID"));
    }

    let share_storage = ShareStorage::new(state.library_path.clone());

    let record = share_storage
        .get_share(&share_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let record = match record {
        Some(r) => r,
        None => return Err(api_err(StatusCode::NOT_FOUND, "Share not found")),
    };

    // Check expiry
    if let Some(expires_at) = record.expires_at {
        if expires_at < chrono::Utc::now() {
            return Err(api_err(StatusCode::GONE, "Share has expired"));
        }
    }

    let html = share_storage
        .get_share_html(&share_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e))?;

    match html {
        Some(content) => Ok(Html(content)),
        None => Err(api_err(StatusCode::NOT_FOUND, "Share HTML not found")),
    }
}

async fn list_shares(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let share_storage = ShareStorage::new(state.library_path.clone());
    let shares = share_storage
        .list_shares()
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(ApiResponse { data: shares }))
}

async fn delete_share(
    State(state): State<AppState>,
    Path(share_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let share_storage = ShareStorage::new(state.library_path.clone());
    share_storage
        .delete_share(&share_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    Ok(Json(ApiResponse {
        data: serde_json::json!({ "deleted": true }),
    }))
}

// ===== Helpers =====

fn make_block_content(blocks: Vec<EditorBlock>) -> EditorData {
    EditorData {
        time: Some(chrono::Utc::now().timestamp_millis()),
        version: Some("2.28.0".to_string()),
        blocks,
    }
}

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
