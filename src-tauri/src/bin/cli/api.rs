//! HTTP API for the Nous daemon.
//!
//! Provides REST endpoints for external processes to interact with notebooks.

use std::sync::Arc;

use axum::{
    extract::{Path, Query, State, WebSocketUpgrade, ws::{Message, WebSocket}},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use html_escape::decode_html_entities;
use regex::Regex;

use nous_lib::commands::{create_daily_note_core, find_daily_note};
use nous_lib::inbox::{CaptureRequest, CaptureSource};
use nous_lib::share::storage::ShareStorage;
use nous_lib::plugins::api::HostApi;
use nous_lib::storage::{EditorBlock, EditorData, Page, PageType};

use super::daemon::{DaemonEvent, DaemonState};

/// Emit an event to all WebSocket subscribers (fire-and-forget).
fn emit_event(state: &DaemonState, event: &str, data: serde_json::Value) {
    let _ = state.event_tx.send(DaemonEvent {
        event: event.to_string(),
        data,
    });
}

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
    section_id: Option<String>,
    page_type: Option<String>,
    is_daily_note: Option<bool>,
    daily_note_date: Option<String>,
    /// Arbitrary extra fields to merge into the page JSON (sourceFile, storageMode, etc.)
    extra_fields: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct UpdatePageRequest {
    title: Option<String>,
    /// Plain text content (double newlines become separate paragraphs)
    content: Option<String>,
    /// Structured Editor.js blocks (takes priority over `content`)
    blocks: Option<Vec<EditorBlock>>,
    tags: Option<Vec<String>>,
    folder_id: Option<String>,
    section_id: Option<String>,
}

#[derive(Deserialize)]
struct AppendPageRequest {
    /// Plain text to append (double newlines become separate paragraphs)
    content: Option<String>,
    /// Structured Editor.js blocks to append (takes priority over `content`)
    blocks: Option<Vec<EditorBlock>>,
}

#[derive(Deserialize)]
struct DeleteBlockRequest {
    block_id: String,
}

#[derive(Deserialize)]
struct ReplaceBlockRequest {
    block_id: String,
    /// Plain text content (double newlines become separate paragraphs)
    content: Option<String>,
    /// Structured Editor.js blocks (takes priority over `content`)
    blocks: Option<Vec<EditorBlock>>,
}

#[derive(Deserialize)]
struct InsertAfterBlockRequest {
    block_id: String,
    /// Plain text content (double newlines become separate paragraphs)
    content: Option<String>,
    /// Structured Editor.js blocks (takes priority over `content`)
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

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
    notebook_id: Option<String>,
    limit: Option<usize>,
}

#[derive(Deserialize)]
struct ResolvePageQuery {
    title: String,
}

#[derive(Deserialize)]
struct UpdateTagsRequest {
    tags: Vec<String>,
}

#[derive(Deserialize)]
struct MovePageRequest {
    folder_id: Option<String>,
    section_id: Option<String>,
}

#[derive(Deserialize)]
struct CreateFolderRequest {
    name: String,
    parent_id: Option<String>,
    section_id: Option<String>,
}

#[derive(Deserialize)]
struct ImportArtworkRequest {
    url: String,
    /// Whether to run AI research enrichment (default: true)
    ai_enrich: Option<bool>,
    /// Folder ID to place the artwork page in
    folder_id: Option<String>,
    /// Section ID to place the artwork page in
    section_id: Option<String>,
}

#[derive(Deserialize)]
struct AddRowsRequest {
    /// Array of row objects: [{"PropertyName": "value", ...}, ...]
    rows: Vec<serde_json::Map<String, serde_json::Value>>,
}

#[derive(Deserialize)]
struct UpdateRowsRequest {
    /// Array of updates: [{"row": "uuid-or-index", "cells": {"PropName": "value"}}, ...]
    updates: Vec<serde_json::Value>,
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
        .route("/api/search", get(search_pages))
        .route("/api/notebooks", get(list_notebooks))
        .route("/api/notebooks/{notebook_id}/pages", get(list_pages))
        .route("/api/notebooks/{notebook_id}/pages", post(create_page))
        .route(
            "/api/notebooks/{notebook_id}/pages/resolve",
            get(resolve_page),
        )
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
            "/api/notebooks/{notebook_id}/pages/{page_id}/delete-block",
            post(delete_block),
        )
        .route(
            "/api/notebooks/{notebook_id}/pages/{page_id}/replace-block",
            post(replace_block),
        )
        .route(
            "/api/notebooks/{notebook_id}/pages/{page_id}/insert-after-block",
            post(insert_after_block),
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
        // Databases
        .route(
            "/api/notebooks/{notebook_id}/databases",
            get(list_databases),
        )
        .route(
            "/api/notebooks/{notebook_id}/databases/{db_id}",
            get(get_database),
        )
        .route(
            "/api/notebooks/{notebook_id}/databases/{db_id}/rows",
            post(add_database_rows),
        )
        .route(
            "/api/notebooks/{notebook_id}/databases/{db_id}/rows",
            put(update_database_rows),
        )
        // Folder creation
        .route(
            "/api/notebooks/{notebook_id}/folders",
            post(create_folder),
        )
        // Artwork import
        .route(
            "/api/notebooks/{notebook_id}/import/artwork",
            post(import_artwork),
        )
        // Share routes
        .route("/share/{share_id}", get(serve_share))
        .route("/share/{share_id}/", get(serve_share))
        .route("/share/{share_id}/{*path}", get(serve_share_file))
        .route("/api/shares", get(list_shares))
        .route("/api/shares/{share_id}", delete(delete_share))
        // Folders and sections
        .route(
            "/api/notebooks/{notebook_id}/folders",
            get(list_folders),
        )
        .route(
            "/api/notebooks/{notebook_id}/sections",
            get(list_sections),
        )
        // Page delete and tag management
        .route(
            "/api/notebooks/{notebook_id}/pages/{page_id}",
            delete(delete_page),
        )
        .route(
            "/api/notebooks/{notebook_id}/pages/{page_id}/tags",
            put(update_tags),
        )
        .route(
            "/api/notebooks/{notebook_id}/pages/{page_id}/move",
            post(move_page),
        )
        // Inbox delete
        .route("/api/inbox/{item_id}", delete(delete_inbox_item))
        // WebSocket event stream
        .route("/api/events", get(ws_events))
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

async fn resolve_page(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Query(query): Query<ResolvePageQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();
    let title_lower = query.title.to_lowercase();

    // Try as UUID first
    if let Ok(uuid) = Uuid::parse_str(&query.title) {
        return match storage.get_page(nb_id, uuid) {
            Ok(page) => Ok(Json(ApiResponse { data: page })),
            Err(e) => Err(api_err(StatusCode::NOT_FOUND, e.to_string())),
        };
    }

    // Match by title prefix
    let pages = storage
        .list_pages(nb_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Try exact match first
    let exact: Vec<&Page> = pages
        .iter()
        .filter(|p| p.title.to_lowercase() == title_lower)
        .collect();
    if exact.len() == 1 {
        return Ok(Json(ApiResponse {
            data: exact[0].clone(),
        }));
    }

    // Try prefix match
    let prefix: Vec<&Page> = pages
        .iter()
        .filter(|p| p.title.to_lowercase().starts_with(&title_lower))
        .collect();
    match prefix.len() {
        0 => Err(api_err(
            StatusCode::NOT_FOUND,
            format!("No page matching '{}'", query.title),
        )),
        1 => Ok(Json(ApiResponse {
            data: prefix[0].clone(),
        })),
        _ => Err(api_err(
            StatusCode::CONFLICT,
            format!(
                "Ambiguous title '{}'. Matches: {}",
                query.title,
                prefix
                    .iter()
                    .map(|p| format!("'{}'", p.title))
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
        )),
    }
}

async fn search_pages(
    State(state): State<AppState>,
    Query(query): Query<SearchQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let limit = query.limit.unwrap_or(20);
    let query_lower = query.q.to_lowercase();
    let storage = state.storage.lock().unwrap();
    let html_tag_re = Regex::new(r"<[^>]+>").unwrap();

    // Determine which notebooks to search
    let notebook_ids: Vec<Uuid> = if let Some(ref nb_id_str) = query.notebook_id {
        vec![parse_uuid(nb_id_str)?]
    } else {
        storage
            .list_notebooks()
            .unwrap_or_default()
            .into_iter()
            .map(|nb| nb.id)
            .collect()
    };

    let mut title_matches = Vec::new();
    let mut content_matches = Vec::new();

    for nb_id in &notebook_ids {
        let pages = match storage.list_pages(*nb_id) {
            Ok(p) => p,
            Err(_) => continue,
        };

        // Get notebook name for results
        let nb_name = storage
            .list_notebooks()
            .unwrap_or_default()
            .into_iter()
            .find(|n| n.id == *nb_id)
            .map(|n| n.name.clone())
            .unwrap_or_default();

        for page in &pages {
            if page.is_archived || page.deleted_at.is_some() {
                continue;
            }

            let title_hit = page.title.to_lowercase().contains(&query_lower);

            // Search block content
            let mut snippet = String::new();
            for block in &page.content.blocks {
                let text = extract_block_text(block, &html_tag_re);
                if text.is_empty() {
                    continue;
                }
                let text_lower = text.to_lowercase();
                if let Some(pos) = text_lower.find(&query_lower) {
                    // Snap byte offsets to char boundaries
                    let raw_start = pos.saturating_sub(50);
                    let raw_end = (pos + query.q.len() + 50).min(text.len());
                    let start = snap_char_boundary_down(&text, raw_start);
                    let end = snap_char_boundary_up(&text, raw_end);
                    let prefix = if start > 0 { "..." } else { "" };
                    let suffix = if end < text.len() { "..." } else { "" };
                    snippet = format!("{}{}{}", prefix, &text[start..end], suffix);
                    break;
                }
            }

            if title_hit || !snippet.is_empty() {
                let entry = serde_json::json!({
                    "pageId": page.id.to_string(),
                    "notebookId": nb_id.to_string(),
                    "notebookName": nb_name,
                    "title": page.title,
                    "snippet": snippet,
                    "tags": page.tags,
                });
                if title_hit {
                    title_matches.push(entry);
                } else {
                    content_matches.push(entry);
                }
            }
        }
    }

    // Title matches first, then content matches
    title_matches.extend(content_matches);
    title_matches.truncate(limit);

    Ok(Json(ApiResponse {
        data: title_matches,
    }))
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

    // Set section
    if let Some(sid) = req.section_id {
        if let Ok(uuid) = Uuid::parse_str(&sid) {
            page.section_id = Some(uuid);
        }
    }

    // Set page type
    if let Some(pt) = req.page_type {
        if let Ok(parsed) = serde_json::from_value(serde_json::Value::String(pt)) {
            page.page_type = parsed;
        }
    }

    // Set daily note fields
    if req.is_daily_note.unwrap_or(false) {
        page.is_daily_note = true;
    }
    if let Some(date) = req.daily_note_date {
        page.daily_note_date = Some(date);
    }

    // Merge extra fields
    if let Some(extras) = req.extra_fields {
        if let Some(obj) = extras.as_object() {
            if let Some(v) = obj.get("sourceFile").and_then(|v| v.as_str()) {
                page.source_file = Some(v.to_string());
            }
            if let Some(v) = obj.get("storageMode") {
                if let Ok(parsed) = serde_json::from_value(v.clone()) {
                    page.storage_mode = Some(parsed);
                }
            }
            if let Some(v) = obj.get("fileExtension").and_then(|v| v.as_str()) {
                page.file_extension = Some(v.to_string());
            }
        }
    }

    // Auto-set sourceFile for database pages using the assigned page ID
    if page.source_file.is_none() {
        if let Some(ext) = &page.file_extension {
            page.source_file = Some(format!("files/{}.{}", page.id, ext));
        }
    }

    if let Err(e) = storage.update_page(&page) {
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
    }

    // Queue sync
    state.sync_manager.queue_page_update(nb_id, page.id);

    emit_event(&state, "page.created", serde_json::json!({
        "notebookId": notebook_id,
        "pageId": page.id.to_string(),
        "title": page.title,
    }));

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
    if let Some(fid) = req.folder_id {
        if fid.is_empty() {
            page.folder_id = None;
        } else if let Ok(uuid) = Uuid::parse_str(&fid) {
            page.folder_id = Some(uuid);
        }
    }
    if let Some(sid) = req.section_id {
        if sid.is_empty() {
            page.section_id = None;
        } else if let Ok(uuid) = Uuid::parse_str(&sid) {
            page.section_id = Some(uuid);
        }
    }

    page.updated_at = chrono::Utc::now();

    if let Err(e) = storage.update_page(&page) {
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
    }

    state.sync_manager.queue_page_update(nb_id, pg_id);

    emit_event(&state, "page.updated", serde_json::json!({
        "notebookId": notebook_id,
        "pageId": page_id,
        "title": page.title,
    }));

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

async fn delete_block(
    State(state): State<AppState>,
    Path((notebook_id, page_id)): Path<(String, String)>,
    Json(req): Json<DeleteBlockRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&page_id)?;
    let storage = state.storage.lock().unwrap();

    let mut page = match storage.get_page(nb_id, pg_id) {
        Ok(p) => p,
        Err(e) => return Err(api_err(StatusCode::NOT_FOUND, e.to_string())),
    };

    let before_len = page.content.blocks.len();
    page.content.blocks.retain(|b| b.id != req.block_id);

    if page.content.blocks.len() == before_len {
        return Err(api_err(
            StatusCode::NOT_FOUND,
            format!("Block not found: {}", req.block_id),
        ));
    }

    page.updated_at = chrono::Utc::now();

    if let Err(e) = storage.update_page(&page) {
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
    }

    state.sync_manager.queue_page_update(nb_id, pg_id);

    Ok(Json(ApiResponse { data: page }))
}

async fn replace_block(
    State(state): State<AppState>,
    Path((notebook_id, page_id)): Path<(String, String)>,
    Json(req): Json<ReplaceBlockRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&page_id)?;
    let storage = state.storage.lock().unwrap();

    let mut page = match storage.get_page(nb_id, pg_id) {
        Ok(p) => p,
        Err(e) => return Err(api_err(StatusCode::NOT_FOUND, e.to_string())),
    };

    let new_blocks = if let Some(blocks) = req.blocks {
        blocks
    } else if let Some(text) = req.content {
        text_to_blocks(&text)
    } else {
        return Err(api_err(
            StatusCode::BAD_REQUEST,
            "Either 'content' or 'blocks' is required",
        ));
    };

    let pos = page.content.blocks.iter().position(|b| b.id == req.block_id);
    match pos {
        Some(idx) => {
            page.content.blocks.remove(idx);
            for (i, block) in new_blocks.into_iter().enumerate() {
                page.content.blocks.insert(idx + i, block);
            }
        }
        None => {
            return Err(api_err(
                StatusCode::NOT_FOUND,
                format!("Block not found: {}", req.block_id),
            ));
        }
    }

    page.updated_at = chrono::Utc::now();

    if let Err(e) = storage.update_page(&page) {
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
    }

    state.sync_manager.queue_page_update(nb_id, pg_id);

    Ok(Json(ApiResponse { data: page }))
}

async fn insert_after_block(
    State(state): State<AppState>,
    Path((notebook_id, page_id)): Path<(String, String)>,
    Json(req): Json<InsertAfterBlockRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&page_id)?;
    let storage = state.storage.lock().unwrap();

    let mut page = match storage.get_page(nb_id, pg_id) {
        Ok(p) => p,
        Err(e) => return Err(api_err(StatusCode::NOT_FOUND, e.to_string())),
    };

    let new_blocks = if let Some(blocks) = req.blocks {
        blocks
    } else if let Some(text) = req.content {
        text_to_blocks(&text)
    } else {
        return Err(api_err(
            StatusCode::BAD_REQUEST,
            "Either 'content' or 'blocks' is required",
        ));
    };

    let pos = page.content.blocks.iter().position(|b| b.id == req.block_id);
    match pos {
        Some(idx) => {
            // Insert after the found block
            let insert_at = idx + 1;
            for (i, block) in new_blocks.into_iter().enumerate() {
                page.content.blocks.insert(insert_at + i, block);
            }
        }
        None => {
            return Err(api_err(
                StatusCode::NOT_FOUND,
                format!("Block not found: {}", req.block_id),
            ));
        }
    }

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
        Ok(item) => {
            emit_event(&state, "inbox.captured", serde_json::json!({
                "itemId": item.id.to_string(),
                "title": item.title,
            }));
            Ok((StatusCode::CREATED, Json(ApiResponse { data: item })))
        }
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
) -> Result<axum::response::Response, (StatusCode, Json<ApiError>)> {
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

    if share_storage.is_multi_page_share(&share_id) {
        // Multi-page share: serve index.html directly with a <base> tag
        // so relative links (e.g. "page-slug.html") resolve to /share/{id}/page-slug.html
        let content = share_storage
            .get_share_file(&share_id, "index.html")
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
        match content {
            Some(bytes) => {
                let html = String::from_utf8_lossy(&bytes);
                let base_tag = format!("<base href=\"/share/{}/\">", share_id);
                let html = if let Some(pos) = html.find("<head>") {
                    format!("{}{}{}", &html[..pos + 6], base_tag, &html[pos + 6..])
                } else if let Some(pos) = html.find("<html") {
                    // Find end of <html...> tag
                    if let Some(end) = html[pos..].find('>') {
                        let after = pos + end + 1;
                        format!("{}<head>{}</head>{}", &html[..after], base_tag, &html[after..])
                    } else {
                        format!("{}{}", base_tag, html)
                    }
                } else {
                    format!("{}{}", base_tag, html)
                };
                Ok(Html(html).into_response())
            }
            None => Err(api_err(StatusCode::NOT_FOUND, "Share index not found")),
        }
    } else {
        // Single-page share
        let html = share_storage
            .get_share_html(&share_id)
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e))?;
        match html {
            Some(content) => Ok(Html(content).into_response()),
            None => Err(api_err(StatusCode::NOT_FOUND, "Share HTML not found")),
        }
    }
}

async fn serve_share_file(
    State(state): State<AppState>,
    Path((share_id, file_path)): Path<(String, String)>,
) -> Result<axum::response::Response, (StatusCode, Json<ApiError>)> {
    // Validate share_id is alphanumeric
    if !share_id.chars().all(|c| c.is_alphanumeric()) {
        return Err(api_err(StatusCode::BAD_REQUEST, "Invalid share ID"));
    }

    let share_storage = ShareStorage::new(state.library_path.clone());

    // Verify share exists and check expiry
    let record = share_storage
        .get_share(&share_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e))?;

    let record = match record {
        Some(r) => r,
        None => return Err(api_err(StatusCode::NOT_FOUND, "Share not found")),
    };

    if let Some(expires_at) = record.expires_at {
        if expires_at < chrono::Utc::now() {
            return Err(api_err(StatusCode::GONE, "Share has expired"));
        }
    }

    // Serve index.html for empty/root path
    let effective_path = if file_path.is_empty() || file_path == "/" {
        "index.html".to_string()
    } else {
        file_path.trim_start_matches('/').to_string()
    };

    let content = share_storage
        .get_share_file(&share_id, &effective_path)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e))?;

    match content {
        Some(bytes) => {
            let content_type = mime_for_path(&effective_path);
            Ok((
                [(axum::http::header::CONTENT_TYPE, content_type)],
                bytes,
            )
                .into_response())
        }
        None => Err(api_err(StatusCode::NOT_FOUND, "File not found")),
    }
}

fn mime_for_path(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
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

/// Snap a byte offset down to a char boundary.
fn snap_char_boundary_down(s: &str, idx: usize) -> usize {
    let mut i = idx.min(s.len());
    while i > 0 && !s.is_char_boundary(i) {
        i -= 1;
    }
    i
}

/// Snap a byte offset up to a char boundary.
fn snap_char_boundary_up(s: &str, idx: usize) -> usize {
    let mut i = idx.min(s.len());
    while i < s.len() && !s.is_char_boundary(i) {
        i += 1;
    }
    i
}

/// Extract plain text from a block for search.
fn extract_block_text(block: &EditorBlock, html_tag_re: &Regex) -> String {
    let data = &block.data;
    let block_type = block.block_type.as_str();

    let raw = match block_type {
        "paragraph" | "header" | "quote" => data
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "code" => data
            .get("code")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "list" => {
            let items = data.get("items").and_then(|v| v.as_array());
            match items {
                Some(arr) => arr
                    .iter()
                    .filter_map(|item| {
                        if let Some(s) = item.as_str() {
                            Some(s.to_string())
                        } else {
                            item.get("content")
                                .or(item.get("text"))
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(" "),
                None => String::new(),
            }
        }
        "checklist" => {
            let items = data.get("items").and_then(|v| v.as_array());
            match items {
                Some(arr) => arr
                    .iter()
                    .filter_map(|item| item.get("text").and_then(|v| v.as_str()))
                    .collect::<Vec<_>>()
                    .join(" "),
                None => String::new(),
            }
        }
        "callout" => {
            let title = data
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let content = data
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            format!("{} {}", title, content)
        }
        "table" => {
            let rows = data.get("content").and_then(|v| v.as_array());
            match rows {
                Some(arr) => arr
                    .iter()
                    .filter_map(|row| row.as_array())
                    .flat_map(|row| {
                        row.iter()
                            .filter_map(|cell| cell.as_str().map(|s| s.to_string()))
                    })
                    .collect::<Vec<_>>()
                    .join(" "),
                None => String::new(),
            }
        }
        _ => String::new(),
    };

    if raw.is_empty() {
        return raw;
    }

    // Strip HTML tags and decode entities
    let stripped = html_tag_re.replace_all(&raw, "");
    decode_html_entities(&stripped).to_string()
}

// ===== Folders & Sections =====

async fn list_folders(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();
    let folders = storage
        .list_folders(nb_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(ApiResponse { data: folders }))
}

async fn list_sections(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();
    let sections = storage
        .list_sections(nb_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(ApiResponse { data: sections }))
}

// ===== Page Delete, Tags, Move =====

async fn delete_page(
    State(state): State<AppState>,
    Path((notebook_id, page_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let page_id = parse_uuid(&page_id)?;
    let storage = state.storage.lock().unwrap();

    // Soft delete (move to trash)
    let mut page = storage
        .get_page(nb_id, page_id)
        .map_err(|e| api_err(StatusCode::NOT_FOUND, e.to_string()))?;
    page.deleted_at = Some(chrono::Utc::now());
    storage
        .update_page(&page)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    emit_event(&state, "page.deleted", serde_json::json!({
        "notebookId": notebook_id,
        "pageId": page_id.to_string(),
        "title": page.title,
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({"ok": true}),
    }))
}

async fn update_tags(
    State(state): State<AppState>,
    Path((notebook_id, page_id)): Path<(String, String)>,
    Json(req): Json<UpdateTagsRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let page_id = parse_uuid(&page_id)?;
    let storage = state.storage.lock().unwrap();

    let mut page = storage
        .get_page(nb_id, page_id)
        .map_err(|e| api_err(StatusCode::NOT_FOUND, e.to_string()))?;
    page.tags = req.tags;
    storage
        .update_page(&page)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ApiResponse {
        data: serde_json::json!({"tags": page.tags}),
    }))
}

async fn move_page(
    State(state): State<AppState>,
    Path((notebook_id, page_id)): Path<(String, String)>,
    Json(req): Json<MovePageRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let page_id = parse_uuid(&page_id)?;
    let storage = state.storage.lock().unwrap();

    let mut page = storage
        .get_page(nb_id, page_id)
        .map_err(|e| api_err(StatusCode::NOT_FOUND, e.to_string()))?;

    if let Some(ref fid) = req.folder_id {
        page.folder_id = if fid.is_empty() {
            None
        } else {
            Some(Uuid::parse_str(fid).map_err(|e| api_err(StatusCode::BAD_REQUEST, e.to_string()))?)
        };
    }
    if let Some(ref sid) = req.section_id {
        page.section_id = if sid.is_empty() {
            None
        } else {
            Some(Uuid::parse_str(sid).map_err(|e| api_err(StatusCode::BAD_REQUEST, e.to_string()))?)
        };
    }

    storage
        .update_page(&page)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(ApiResponse {
        data: serde_json::json!({"ok": true}),
    }))
}

// ===== Inbox Delete =====

async fn delete_inbox_item(
    State(state): State<AppState>,
    Path(item_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let id = parse_uuid(&item_id)?;
    let inbox = state.inbox_storage.lock().unwrap();
    inbox
        .delete_item(id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    emit_event(&state, "inbox.deleted", serde_json::json!({"itemId": item_id}));
    Ok(Json(ApiResponse {
        data: serde_json::json!({"ok": true}),
    }))
}

// ===== WebSocket Event Stream =====

async fn ws_events(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_ws_events(socket, state))
}

async fn handle_ws_events(mut socket: WebSocket, state: AppState) {
    let mut rx = state.event_tx.subscribe();

    log::info!("WebSocket client connected to /api/events");

    loop {
        tokio::select! {
            // Forward broadcast events to the WebSocket client
            result = rx.recv() => {
                match result {
                    Ok(event) => {
                        let json = serde_json::to_string(&event).unwrap_or_default();
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break; // Client disconnected
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        log::warn!("WebSocket client lagged, missed {} events", n);
                    }
                    Err(_) => break, // Channel closed
                }
            }
            // Handle incoming messages (ping/pong, close)
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    _ => {} // Ignore text/binary from client
                }
            }
        }
    }

    log::info!("WebSocket client disconnected from /api/events");
}

// ===== Databases =====

async fn list_databases(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();
    let pages = storage
        .list_pages(nb_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let databases: Vec<serde_json::Value> = pages
        .into_iter()
        .filter(|p| p.page_type == PageType::Database && p.deleted_at.is_none())
        .map(|p| {
            let (prop_count, row_count) = storage
                .read_native_file_content(&p)
                .ok()
                .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
                .map(|v| {
                    let props = v.get("properties").and_then(|a| a.as_array()).map_or(0, |a| a.len());
                    let rows = v.get("rows").and_then(|a| a.as_array()).map_or(0, |a| a.len());
                    (props, rows)
                })
                .unwrap_or((0, 0));

            serde_json::json!({
                "id": p.id.to_string(),
                "title": p.title,
                "tags": p.tags,
                "folderId": p.folder_id,
                "sectionId": p.section_id,
                "propertyCount": prop_count,
                "rowCount": row_count,
            })
        })
        .collect();

    Ok(Json(ApiResponse { data: databases }))
}

async fn get_database(
    State(state): State<AppState>,
    Path((notebook_id, db_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&db_id)?;
    let storage = state.storage.lock().unwrap();

    let page = storage
        .get_page(nb_id, pg_id)
        .map_err(|e| api_err(StatusCode::NOT_FOUND, e.to_string()))?;

    if page.page_type != PageType::Database {
        return Err(api_err(StatusCode::BAD_REQUEST, "Not a database page"));
    }

    let content = storage
        .read_native_file_content(&page)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let db_data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid database JSON: {e}")))?;

    Ok(Json(ApiResponse {
        data: serde_json::json!({
            "id": page.id.to_string(),
            "title": page.title,
            "tags": page.tags,
            "database": db_data,
        }),
    }))
}

// ===== Create Folder =====

async fn create_folder(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(req): Json<CreateFolderRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();

    let parent_id = req.parent_id
        .as_deref()
        .and_then(|s| Uuid::parse_str(s).ok());

    let mut folder = storage
        .create_folder(nb_id, req.name.clone(), parent_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Set section if provided (requires a separate update)
    if let Some(ref sid) = req.section_id {
        if let Ok(uuid) = Uuid::parse_str(sid) {
            folder.section_id = Some(uuid);
            let _ = storage.update_folder(&folder);
        }
    }

    Ok((StatusCode::CREATED, Json(ApiResponse { data: folder })))
}

// ===== Database Rows =====

async fn add_database_rows(
    State(state): State<AppState>,
    Path((notebook_id, db_id)): Path<(String, String)>,
    Json(req): Json<AddRowsRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&db_id)?;
    let storage = state.storage.lock().unwrap();

    let page = storage
        .get_page(nb_id, pg_id)
        .map_err(|e| api_err(StatusCode::NOT_FOUND, e.to_string()))?;
    if page.page_type != PageType::Database {
        return Err(api_err(StatusCode::BAD_REQUEST, "Not a database page"));
    }

    let content = storage
        .read_native_file_content(&page)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut db: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid database JSON: {e}")))?;

    let name_to_id = HostApi::build_property_name_map(&db);
    let select_map = HostApi::build_select_label_map(&db);
    let now = chrono::Utc::now().to_rfc3339();

    let rows_arr = db
        .get_mut("rows")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| api_err(StatusCode::INTERNAL_SERVER_ERROR, "database has no rows array"))?;

    let added = req.rows.len();
    for input_row in req.rows {
        let mut cells = serde_json::Map::new();
        for (key, value) in input_row {
            let prop_id = name_to_id.get(&key).cloned().unwrap_or(key);
            let value = HostApi::resolve_select_value(value, &prop_id, &select_map);
            cells.insert(prop_id, value);
        }
        rows_arr.push(serde_json::json!({
            "id": Uuid::new_v4().to_string(),
            "cells": cells,
            "createdAt": now,
            "updatedAt": now,
        }));
    }

    let total = rows_arr.len();

    let db_json = serde_json::to_string_pretty(&db)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("serialize: {e}")))?;
    storage
        .write_native_file_content(&page, &db_json)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    emit_event(&state, "database.rows_added", serde_json::json!({
        "notebookId": notebook_id,
        "databaseId": db_id,
        "rowsAdded": added,
        "totalRows": total,
    }));

    Ok((StatusCode::CREATED, Json(ApiResponse {
        data: serde_json::json!({
            "databaseId": db_id,
            "rowsAdded": added,
            "totalRows": total,
        }),
    })))
}

async fn update_database_rows(
    State(state): State<AppState>,
    Path((notebook_id, db_id)): Path<(String, String)>,
    Json(req): Json<UpdateRowsRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&db_id)?;
    let storage = state.storage.lock().unwrap();

    let page = storage
        .get_page(nb_id, pg_id)
        .map_err(|e| api_err(StatusCode::NOT_FOUND, e.to_string()))?;
    if page.page_type != PageType::Database {
        return Err(api_err(StatusCode::BAD_REQUEST, "Not a database page"));
    }

    let content = storage
        .read_native_file_content(&page)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let mut db: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid database JSON: {e}")))?;

    let name_to_id = HostApi::build_property_name_map(&db);
    let select_map = HostApi::build_select_label_map(&db);
    let now = chrono::Utc::now().to_rfc3339();

    let rows_arr = db
        .get_mut("rows")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| api_err(StatusCode::INTERNAL_SERVER_ERROR, "database has no rows array"))?;

    let mut updated_count = 0usize;
    for update in &req.updates {
        let row_ref = match update.get("row") {
            Some(v) => v,
            None => continue,
        };
        let cell_updates = match update.get("cells").and_then(|v| v.as_object()) {
            Some(c) => c,
            None => continue,
        };

        let row = if let Some(idx) = row_ref.as_u64() {
            rows_arr.get_mut(idx as usize)
        } else if let Some(uuid_str) = row_ref.as_str() {
            rows_arr.iter_mut().find(|r| {
                r.get("id").and_then(|v| v.as_str()) == Some(uuid_str)
            })
        } else {
            None
        };

        let Some(row) = row else { continue };

        let cells = match row.get_mut("cells").and_then(|v| v.as_object_mut()) {
            Some(c) => c,
            None => continue,
        };

        for (key, value) in cell_updates {
            let prop_id = name_to_id.get(key).cloned().unwrap_or_else(|| key.clone());
            let value = HostApi::resolve_select_value(value.clone(), &prop_id, &select_map);
            cells.insert(prop_id, value);
        }

        if let Some(obj) = row.as_object_mut() {
            obj.insert("updatedAt".to_string(), serde_json::json!(now));
        }
        updated_count += 1;
    }

    let db_json = serde_json::to_string_pretty(&db)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("serialize: {e}")))?;
    storage
        .write_native_file_content(&page, &db_json)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    emit_event(&state, "database.rows_updated", serde_json::json!({
        "notebookId": notebook_id,
        "databaseId": db_id,
        "rowsUpdated": updated_count,
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({
            "databaseId": db_id,
            "rowsUpdated": updated_count,
        }),
    }))
}

// ===== Artwork Import =====

async fn import_artwork(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(req): Json<ImportArtworkRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    // Validate the URL
    if !req.url.starts_with("http://") && !req.url.starts_with("https://") {
        return Err(api_err(StatusCode::BAD_REQUEST, "Only http/https URLs are supported"));
    }

    // Find the import_artwork.py script
    let script_path = find_import_script();
    if script_path.is_none() {
        return Err(api_err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "import_artwork.py script not found",
        ));
    }
    let script_path = script_path.unwrap();

    // Resolve notebook name for the script
    let nb_name = {
        let storage = state.storage.lock().unwrap();
        let notebooks = storage.list_notebooks()
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        notebooks.into_iter()
            .find(|n| n.id.to_string() == notebook_id)
            .map(|n| n.name)
            .ok_or_else(|| api_err(StatusCode::NOT_FOUND, "Notebook not found"))?
    };

    // Build command args
    let mut args = vec![
        script_path.to_string_lossy().to_string(),
        req.url.clone(),
        "--notebook".to_string(),
        nb_name,
        "--json".to_string(),
    ];
    if req.ai_enrich == Some(false) {
        args.push("--no-ai".to_string());
    }
    if let Some(ref fid) = req.folder_id {
        args.push("--folder-id".to_string());
        args.push(fid.clone());
    }
    if let Some(ref sid) = req.section_id {
        args.push("--section-id".to_string());
        args.push(sid.clone());
    }

    // Find nous-sdk project dir for uv run
    let sdk_dir = std::env::var("PYTHONPATH")
        .ok()
        .and_then(|p| p.split(':').next().map(|s| {
            std::path::PathBuf::from(s).parent().map(|pp| pp.join("nous-sdk")).unwrap_or_default()
        }))
        .unwrap_or_else(|| std::path::PathBuf::from("nous-sdk"));

    // Run the import script via uv (handles dependencies)
    let output = tokio::process::Command::new("uv")
        .arg("run")
        .arg("--project")
        .arg(&sdk_dir)
        .arg("python")
        .args(&args)
        .env("PYTHONPATH", std::env::var("PYTHONPATH").unwrap_or_default())
        .output()
        .await
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to run import: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        log::error!("Artwork import failed: {stderr}");

        // Try to parse JSON error from stdout
        if let Ok(result) = serde_json::from_str::<serde_json::Value>(&stdout) {
            if let Some(err) = result.get("error").and_then(|v| v.as_str()) {
                return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, err.to_string()));
            }
        }
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, stderr.to_string()));
    }

    let result: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid script output: {e}")))?;

    emit_event(&state, "artwork.imported", serde_json::json!({
        "notebookId": notebook_id,
        "url": req.url,
        "title": result.get("title"),
        "pageId": result.get("pageId"),
    }));

    Ok((StatusCode::CREATED, Json(ApiResponse { data: result })))
}

fn find_import_script() -> Option<std::path::PathBuf> {
    // Check PYTHONPATH for nous-py location (set by systemd service / build-daemon.sh)
    if let Ok(pypath) = std::env::var("PYTHONPATH") {
        for path in pypath.split(':') {
            let p = std::path::PathBuf::from(path);
            // PYTHONPATH points to nous-py, scripts are in nous-py/scripts/
            let candidate = p.join("scripts/import_artwork.py");
            if candidate.exists() {
                return Some(candidate);
            }
            // Or PYTHONPATH might point to the parent
            let candidate2 = p.join("../scripts/import_artwork.py");
            if candidate2.exists() {
                return Some(candidate2);
            }
        }
    }

    // Check relative to current dir (dev mode)
    let candidates = [
        std::path::PathBuf::from("nous-py/scripts/import_artwork.py"),
        std::path::PathBuf::from("../nous-py/scripts/import_artwork.py"),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }

    // Check relative to the executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let from_exe = exe_dir.join("../../nous-py/scripts/import_artwork.py");
            if from_exe.exists() {
                return Some(from_exe);
            }
        }
    }

    None
}
