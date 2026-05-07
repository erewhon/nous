//! HTTP API for the Nous daemon.
//!
//! Provides REST endpoints for external processes to interact with notebooks.

use std::collections::HashSet;
use std::sync::Arc;

use axum::{
    extract::{Path, Query, Request, State, WebSocketUpgrade, ws::{Message, WebSocket}},
    http::{HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{Html, IntoResponse},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::{AllowOrigin, CorsLayer};
use uuid::Uuid;

use super::auth::{ApiKeySet, Scope};

use nous_lib::commands::{create_daily_note_core, find_daily_note, list_daily_notes_core};
use nous_lib::inbox::{CaptureRequest, CaptureSource};
use nous_lib::markdown::{export_page_to_markdown, parse_markdown_to_blocks};
use nous_lib::share::storage::ShareStorage;
use nous_lib::plugins::api::HostApi;
use nous_lib::git;
use nous_lib::storage::{EditorBlock, EditorData, FileStorageMode, Page, PageType, SystemPromptMode};

use super::daemon::DaemonState;
use nous_lib::events::AppEvent;

/// Emit an event to all WebSocket subscribers (fire-and-forget).
fn emit_event(state: &DaemonState, event: &str, data: serde_json::Value) {
    let _ = state.event_tx.send(AppEvent::new(event, data));
}

/// Spawn a background task that asks the RAG backend to (re)index a
/// page. The HTTP response returns immediately; embedding calls happen
/// off the request hot path. NotConfigured is silently ignored — the
/// fast-path cost when RAG is off is one async-trait dispatch + a
/// config read lock, no network.
fn spawn_rag_index(state: &Arc<DaemonState>, page: &Page) {
    let rag = Arc::clone(&state.rag);
    let page_id = page.id;
    let page_text = plain_text_for_page(page);
    let page_clone = page.clone();
    tokio::spawn(async move {
        let page_type = format!("{:?}", page_clone.page_type).to_lowercase();
        let page_ref = nous_lib::search::PageRef {
            id: page_clone.id,
            notebook_id: page_clone.notebook_id,
            title: &page_clone.title,
            tags: &page_clone.tags,
            page_type: &page_type,
            plain_text: page_text,
        };
        use nous_lib::search::SearchBackend;
        match rag.index(page_ref).await {
            Ok(()) => {}
            Err(nous_lib::search::BackendError::NotConfigured) => {} // expected when RAG off
            Err(e) => log::warn!("RAG index failed for page {}: {}", page_id, e),
        }
    });
}

fn spawn_rag_delete(state: &Arc<DaemonState>, page_id: Uuid) {
    let rag = Arc::clone(&state.rag);
    tokio::spawn(async move {
        use nous_lib::search::SearchBackend;
        match rag.delete(page_id).await {
            Ok(()) => {}
            Err(nous_lib::search::BackendError::NotConfigured) => {}
            Err(e) => log::warn!("RAG delete failed for page {}: {}", page_id, e),
        }
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
    /// Markdown content (parsed to blocks; lowest priority after blocks and content)
    markdown: Option<String>,
    tags: Option<Vec<String>>,
    folder_id: Option<String>,
    section_id: Option<String>,
    /// Parent page UUID for nested pages
    parent_page_id: Option<String>,
    /// Template ID this page was created from
    template_id: Option<String>,
    page_type: Option<String>,
    is_daily_note: Option<bool>,
    daily_note_date: Option<String>,
    /// Plugin page type identifier (e.g. "kanban") — when set, a plugin renders the page
    plugin_page_type: Option<String>,
    /// Opaque JSON data for plugin page types
    plugin_data: Option<serde_json::Value>,
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
    /// Markdown content (parsed to blocks; lowest priority after blocks and content)
    markdown: Option<String>,
    tags: Option<Vec<String>>,
    /// Triple-state: missing = no change, null/empty = clear, value = set to UUID.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    folder_id: Option<Option<String>>,
    /// Triple-state: missing = no change, null/empty = clear, value = set to UUID.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    section_id: Option<Option<String>>,
    /// Custom AI system prompt. Triple-state: missing = no change, null or empty string = clear.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    system_prompt: Option<Option<String>>,
    /// "override" or "concatenate" — defaults to "override".
    system_prompt_mode: Option<String>,
    /// One of: standard, markdown, pdf, jupyter, epub, calendar, chat, canvas, database, html.
    page_type: Option<String>,
    /// File extension (e.g. "md", "ipynb"). Triple-state: missing = no change,
    /// null or empty string = clear. Setting an extension on a file-based page
    /// auto-creates source_file = files/{page_id}.{ext} and storage_mode = embedded.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    file_extension: Option<Option<String>>,
    is_favorite: Option<bool>,
    is_daily_note: Option<bool>,
    /// Triple-state: YYYY-MM-DD; null clears.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    daily_note_date: Option<Option<String>>,
    /// CSS color string. Triple-state: null clears.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    color: Option<Option<String>>,
    /// Plugin page type identifier. Triple-state: null clears.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    plugin_page_type: Option<Option<String>>,
    /// Opaque JSON for plugin pages. Triple-state: null clears.
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    plugin_data: Option<Option<serde_json::Value>>,
    /// When true, auto-commit if git is enabled for the notebook (default false).
    commit: Option<bool>,
    /// Editor pane ID — declared for the schema but not yet wired (CRDT sub-task).
    #[allow(dead_code)]
    pane_id: Option<String>,
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
    /// When `1`, use Tantivy's FuzzyTermQuery on the title field
    /// (autocomplete-friendly; edit distance 2). Otherwise, use the
    /// standard QueryParser across title/content/tags. Only meaningful
    /// for `mode=keyword` (the default).
    fuzzy: Option<u8>,
    /// Search backend: "keyword" (default, Tantivy), "semantic" (RAG
    /// embeddings — requires RAG configured), "hybrid" (Tantivy
    /// candidates reranked by RAG embeddings).
    mode: Option<String>,
}

#[derive(Deserialize)]
struct ResolvePageQuery {
    title: String,
}

#[derive(Deserialize)]
struct FormatQuery {
    format: Option<String>,
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
struct ImageCacheQuery {
    url: String,
}

#[derive(Deserialize)]
struct AgileDailyRequest {
    /// "today", "tomorrow", or "YYYY-MM-DD"
    date: Option<String>,
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

#[derive(Deserialize)]
struct CreateDatabaseRequest {
    title: String,
    /// Property definitions: [{"name": "...", "type": "text|select|...", "options": [...]}]
    properties: Vec<serde_json::Value>,
    tags: Option<Vec<String>>,
    folder_id: Option<String>,
    section_id: Option<String>,
}

#[derive(Deserialize)]
struct DeleteRowsRequest {
    /// Row IDs (UUIDs) to delete
    row_ids: Vec<String>,
}

#[derive(Deserialize)]
struct UpdateFolderRequest {
    name: Option<String>,
    /// Triple-state: missing = no change, null = move to root, string = new parent
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    parent_id: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    color: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    section_id: Option<Option<String>>,
}

#[derive(Deserialize)]
struct DeleteFolderQuery {
    /// Optional folder ID to move pages into; if omitted, pages are moved to root.
    move_pages_to: Option<String>,
}

#[derive(Deserialize)]
struct CreateSectionRequest {
    name: String,
    color: Option<String>,
}

#[derive(Deserialize)]
struct UpdateSectionRequest {
    name: Option<String>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    description: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    color: Option<Option<String>>,
    #[serde(default, deserialize_with = "deserialize_optional_field")]
    system_prompt: Option<Option<String>>,
    /// "override" or "concatenate"
    system_prompt_mode: Option<String>,
    /// Empty string clears the value.
    page_sort_by: Option<String>,
}

#[derive(Deserialize)]
struct DeleteSectionQuery {
    /// Optional section ID to move items into; if omitted, items move to no-section.
    move_items_to: Option<String>,
}

#[derive(Deserialize)]
struct UnarchivePageRequest {
    /// Optional folder to unarchive into; defaults to the original folder.
    target_folder_id: Option<String>,
}

#[derive(Deserialize)]
struct ReorderPagesRequest {
    /// Optional folder context; null means root pages.
    folder_id: Option<String>,
    page_ids: Vec<String>,
}

#[derive(Deserialize)]
struct ReorderFoldersRequest {
    /// Optional parent folder context; null means top-level folders.
    parent_id: Option<String>,
    folder_ids: Vec<String>,
}

#[derive(Deserialize)]
struct ReorderSectionsRequest {
    section_ids: Vec<String>,
}

#[derive(Deserialize)]
struct RenameTagRequest {
    new_name: String,
}

#[derive(Deserialize)]
struct MergeTagsRequest {
    /// Tags to merge into `into`.
    from: Vec<String>,
    into: String,
}

/// Body for `POST /api/search/rag/configure`. Same shape as the
/// `[search.rag]` table in `daemon-config.toml` — pass exactly the
/// fields you want to set; missing fields keep their current values
/// when the new config is built (we apply over the old one).
#[derive(Deserialize)]
struct RagConfigureRequest {
    enabled: Option<bool>,
    endpoint: Option<String>,
    embedding_model: Option<String>,
    vector_store: Option<String>,
    vector_endpoint: Option<String>,
    collection: Option<String>,
    auth_token: Option<String>,
    chunk_size: Option<usize>,
    chunk_overlap: Option<usize>,
    rerank_candidates: Option<usize>,
    request_timeout_ms: Option<u64>,
}

/// Distinguish "field absent" from "field present and null" in JSON bodies.
/// Lets clients explicitly clear an optional value vs. leave it unchanged.
fn deserialize_optional_field<'de, D, T>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de>,
{
    Option::<T>::deserialize(de).map(Some)
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

// ===== Auth middleware =====

/// Routes that don't require authentication.
fn is_public_route(path: &str) -> bool {
    path == "/api/status"
        || path.starts_with("/share/")
        || path.starts_with("/gallery/")
        || path.starts_with("/finance/")
        || path.starts_with("/api/image-cache/")
}

/// Auth state: None means auth is disabled (localhost, no key file).
#[derive(Clone)]
pub struct AuthState {
    keys: Option<Arc<ApiKeySet>>,
}

impl AuthState {
    pub fn disabled() -> Self {
        Self { keys: None }
    }

    pub fn enabled(keys: ApiKeySet) -> Self {
        Self { keys: Some(Arc::new(keys)) }
    }
}

async fn auth_middleware(
    State(auth): State<AuthState>,
    req: Request,
    next: Next,
) -> axum::response::Response {
    // Auth disabled — pass through
    let keys = match &auth.keys {
        None => return next.run(req).await,
        Some(k) => k,
    };

    // Public routes — no auth required
    if is_public_route(req.uri().path()) {
        return next.run(req).await;
    }

    // Extract bearer token from header or query param (for WebSocket)
    let token = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(|s| s.to_string())
        .or_else(|| {
            // Fall back to ?token= query param (for WebSocket clients).
            // URL-decode since browsers encode ':' as '%3A' via encodeURIComponent.
            req.uri().query().and_then(|q| {
                q.split('&')
                    .find_map(|pair| pair.strip_prefix("token="))
                    .and_then(|raw| urlencoding::decode(raw).ok())
                    .map(|s| s.into_owned())
            })
        });

    let token = match token {
        Some(t) => t,
        None => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(ApiError { error: "Missing API key. Include Authorization: Bearer <key>".into() }),
            ).into_response();
        }
    };

    match keys.validate(&token) {
        None => {
            (
                StatusCode::UNAUTHORIZED,
                Json(ApiError { error: "Invalid API key".into() }),
            ).into_response()
        }
        Some(scope) => {
            if !scope.allows_method(req.method().as_str()) {
                (
                    StatusCode::FORBIDDEN,
                    Json(ApiError { error: "Read-only key cannot perform write operations".into() }),
                ).into_response()
            } else {
                next.run(req).await
            }
        }
    }
}

// ===== Router =====

pub fn build_router(state: AppState, auth: AuthState) -> Router {
    START_TIME.get_or_init(std::time::Instant::now);

    Router::new()
        .route("/api/status", get(get_status))
        .route("/api/search", get(search_pages))
        .route("/api/search/rebuild", post(rebuild_search_index))
        .route("/api/search/rag/configure", post(rag_configure))
        .route("/api/search/rag/reindex", post(rag_reindex))
        .route("/api/backup/settings", get(get_backup_settings))
        .route("/api/backup/settings", post(update_backup_settings))
        .route("/api/plugins", get(list_plugins))
        .route("/api/plugins/{plugin_id}/reload", post(reload_plugin))
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
            "/api/notebooks/{notebook_id}/daily-notes",
            get(list_daily_notes),
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
            get(list_databases).post(create_database),
        )
        .route(
            "/api/notebooks/{notebook_id}/databases/{db_id}",
            get(get_database).put(put_database),
        )
        .route(
            "/api/notebooks/{notebook_id}/databases/{db_id}/rows",
            post(add_database_rows).put(update_database_rows).delete(delete_database_rows),
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
        // Agile Results daily note
        .route(
            "/api/notebooks/{notebook_id}/agile-daily",
            post(agile_daily_note),
        )
        // Share routes
        // Dashboards
        .route(
            "/gallery/{notebook_id}",
            get(serve_gallery),
        )
        .route(
            "/finance/{notebook_id}",
            get(serve_finance),
        )
        .route(
            "/api/image-cache/{hash}",
            get(serve_cached_image),
        )
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
            "/api/notebooks/{notebook_id}/folders/{folder_id}",
            put(update_folder).delete(delete_folder),
        )
        .route(
            "/api/notebooks/{notebook_id}/folders/reorder",
            post(reorder_folders),
        )
        .route(
            "/api/notebooks/{notebook_id}/folders/{folder_id}/archive",
            post(archive_folder),
        )
        .route(
            "/api/notebooks/{notebook_id}/folders/{folder_id}/unarchive",
            post(unarchive_folder),
        )
        .route(
            "/api/notebooks/{notebook_id}/sections",
            get(list_sections).post(create_section),
        )
        .route(
            "/api/notebooks/{notebook_id}/sections/{section_id}",
            put(update_section).delete(delete_section),
        )
        .route(
            "/api/notebooks/{notebook_id}/sections/reorder",
            post(reorder_sections),
        )
        // Page reorder + archive (placed before {page_id} routes — literal wins
        // over capture in Axum, but explicit ordering avoids surprises)
        .route(
            "/api/notebooks/{notebook_id}/pages/reorder",
            post(reorder_pages),
        )
        .route(
            "/api/notebooks/{notebook_id}/pages/{page_id}/archive",
            post(archive_page),
        )
        .route(
            "/api/notebooks/{notebook_id}/pages/{page_id}/unarchive",
            post(unarchive_page),
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
        // Tag management
        .route("/api/tags", get(list_all_tags))
        .route(
            "/api/notebooks/{notebook_id}/tags",
            get(list_notebook_tags),
        )
        .route(
            "/api/notebooks/{notebook_id}/tags/merge",
            post(merge_tags),
        )
        .route(
            "/api/notebooks/{notebook_id}/tags/{tag}",
            delete(delete_tag),
        )
        .route(
            "/api/notebooks/{notebook_id}/tags/{tag}/rename",
            post(rename_tag),
        )
        // Inbox delete
        .route("/api/inbox/{item_id}", delete(delete_inbox_item))
        // WebSocket event stream
        .route("/api/events", get(ws_events))
        .layer(middleware::from_fn_with_state(auth, auth_middleware))
        .layer(
            // Clients authenticate via Bearer token, so allow any origin. The
            // Tauri webview's origin varies by platform (tauri://localhost,
            // http://tauri.localhost, etc.), so we can't pin it.
            CorsLayer::new()
                .allow_origin(AllowOrigin::predicate(|_origin: &HeaderValue, _req| true))
                .allow_methods([
                    Method::GET,
                    Method::POST,
                    Method::PUT,
                    Method::DELETE,
                    Method::OPTIONS,
                ])
                .allow_headers(tower_http::cors::Any)
                .allow_credentials(false),
        )
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
    Query(query): Query<FormatQuery>,
) -> Result<axum::response::Response, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&page_id)?;
    let storage = state.storage.lock().unwrap();
    match storage.get_page(nb_id, pg_id) {
        Ok(page) => {
            if query.format.as_deref() == Some("markdown") {
                let md = export_page_to_markdown(&page);
                Ok(axum::response::Response::builder()
                    .header("content-type", "text/markdown; charset=utf-8")
                    .body(axum::body::Body::from(md))
                    .unwrap())
            } else {
                Ok(Json(ApiResponse { data: page }).into_response())
            }
        }
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

    // Match by title prefix (exclude trashed pages)
    let pages = storage
        .list_pages(nb_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Try exact match first (active pages only)
    let exact: Vec<&Page> = pages
        .iter()
        .filter(|p| p.deleted_at.is_none() && p.title.to_lowercase() == title_lower)
        .collect();
    if exact.len() == 1 {
        return Ok(Json(ApiResponse {
            data: exact[0].clone(),
        }));
    }

    // Try prefix match (active pages only)
    let prefix: Vec<&Page> = pages
        .iter()
        .filter(|p| p.deleted_at.is_none() && p.title.to_lowercase().starts_with(&title_lower))
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
    let fuzzy = query.fuzzy.unwrap_or(0) != 0;

    let nb_filter: Option<Uuid> = match query.notebook_id.as_deref() {
        Some(s) => Some(parse_uuid(s)?),
        None => None,
    };

    // Mode dispatch. The default (no `mode` param) preserves the
    // pre-RAG behavior — straight Tantivy keyword search.
    let mode = match query.mode.as_deref().unwrap_or("keyword") {
        "keyword" => nous_lib::search::SearchMode::Keyword,
        "semantic" => nous_lib::search::SearchMode::Semantic,
        "hybrid" => nous_lib::search::SearchMode::Hybrid,
        other => {
            return Err(api_err(
                StatusCode::BAD_REQUEST,
                format!("Unknown search mode '{}'; expected keyword|semantic|hybrid", other),
            ));
        }
    };

    let hits = match mode {
        nous_lib::search::SearchMode::Keyword => {
            // Tantivy adapter respects the fuzzy flag.
            if fuzzy {
                state.tantivy.fuzzy_query(&query.q, limit, nb_filter).await
            } else {
                use nous_lib::search::SearchBackend;
                state.tantivy.query(&query.q, limit, nb_filter).await
            }
        }
        nous_lib::search::SearchMode::Semantic => {
            use nous_lib::search::SearchBackend;
            state.rag.query(&query.q, limit, nb_filter).await
        }
        nous_lib::search::SearchMode::Hybrid => {
            // Pull rerank_candidates from RAG config; fetch that many
            // Tantivy hits, then ask RAG to rerank. If RAG fails, fall
            // back to the Tantivy candidates so a flaky embedding
            // service doesn't kill the search bar.
            use nous_lib::search::SearchBackend;
            let candidates_limit = state.rag_config.read().await.rerank_candidates;
            let candidates = state
                .tantivy
                .query(&query.q, candidates_limit, nb_filter)
                .await;
            match candidates {
                Ok(cands) if cands.is_empty() => Ok(cands),
                Ok(cands) => {
                    // For now: re-issue a semantic query and return the
                    // intersection (top `limit`). A proper rerank would
                    // embed each candidate's title/content and compare
                    // against the query embedding — left as follow-up.
                    match state.rag.query(&query.q, limit, nb_filter).await {
                        Ok(rag_hits) => {
                            let by_id: std::collections::HashMap<_, _> =
                                rag_hits.iter().map(|h| (h.page_id.clone(), h.score)).collect();
                            let mut merged: Vec<_> = cands
                                .into_iter()
                                .map(|mut h| {
                                    if let Some(s) = by_id.get(&h.page_id) {
                                        // Boost candidates that RAG also liked.
                                        h.score = (h.score + s) / 2.0;
                                    }
                                    h
                                })
                                .collect();
                            merged.sort_by(|a, b| {
                                b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal)
                            });
                            merged.truncate(limit);
                            Ok(merged)
                        }
                        Err(e) => {
                            log::warn!(
                                "Hybrid search: RAG rerank failed, falling back to keyword: {}",
                                e
                            );
                            Ok(cands.into_iter().take(limit).collect())
                        }
                    }
                }
                Err(e) => Err(e),
            }
        }
    };

    let hits = hits.map_err(|e| match e {
        nous_lib::search::BackendError::NotConfigured => api_err(
            StatusCode::BAD_REQUEST,
            "RAG is not configured. POST /api/search/rag/configure first.",
        ),
        nous_lib::search::BackendError::Unreachable(msg) => api_err(
            StatusCode::BAD_GATEWAY,
            format!("RAG service unreachable: {}", msg),
        ),
        nous_lib::search::BackendError::Backend(msg) => {
            api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("Search error: {}", msg))
        }
    })?;

    Ok(Json(ApiResponse { data: hits }))
}

/// Rebuild the Tantivy index from scratch by reindexing every non-deleted,
/// non-archived page across every notebook. Useful after schema changes,
/// corrupt segments, or when the daemon was offline during many writes.
async fn rebuild_search_index(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let pages = {
        let storage = state.storage.lock().map_err(|e| {
            api_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to acquire storage lock: {}", e),
            )
        })?;
        let notebooks = storage
            .list_notebooks()
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let mut all = Vec::new();
        for nb in notebooks {
            let pages = match storage.list_pages(nb.id) {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("Failed to list pages for notebook {}: {}", nb.id, e);
                    continue;
                }
            };
            for page in pages {
                if page.deleted_at.is_some() || page.is_archived {
                    continue;
                }
                all.push(page);
            }
        }
        all
    };

    let total = pages.len();
    let mut indexed = 0usize;
    let mut failed = 0usize;
    {
        let mut idx = state.search_index.lock().map_err(|e| {
            api_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to acquire search lock: {}", e),
            )
        })?;

        // Workaround for Tantivy 0.22.1 fastfield panic on batched commits
        // (writer.rs:137 "index out of bounds"). `rebuild_index(&pages)` does
        // delete_all + commit + bulk add + commit, and the second commit
        // panics on the multi-doc fastfield serialize path.
        //
        // Instead: delete_all by passing an empty slice (just the delete +
        // commit), then call `index_page` per page so each commit handles a
        // single document. Slower (one commit per page) but avoids the
        // multi-doc trigger. Track the underlying fix in the Forge task
        // "Investigate Tantivy 0.22.1 fastfield panic blocking sync".
        idx.rebuild_index(&[]).map_err(|e| {
            api_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to clear index: {}", e),
            )
        })?;

        for page in &pages {
            match idx.index_page(page) {
                Ok(()) => indexed += 1,
                Err(e) => {
                    failed += 1;
                    log::warn!(
                        "Rebuild: failed to index page {} ({}): {}",
                        page.id, page.title, e
                    );
                }
            }
        }
    }

    Ok(Json(ApiResponse {
        data: serde_json::json!({
            "ok": failed == 0,
            "indexed": indexed,
            "failed": failed,
            "total": total,
        }),
    }))
}

/// `POST /api/search/rag/configure` — update the RAG config in memory
/// and persist to `daemon-config.toml`. Body fields override the
/// current values; omitted fields keep their existing settings.
/// Returns the new (sanitized) config.
async fn rag_configure(
    State(state): State<AppState>,
    Json(req): Json<RagConfigureRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    use nous_lib::search::DaemonConfig;
    let mut current = state.rag_config.write().await;
    if let Some(v) = req.enabled { current.enabled = v; }
    if let Some(v) = req.endpoint { current.endpoint = v; }
    if let Some(v) = req.embedding_model { current.embedding_model = v; }
    if let Some(v) = req.vector_store { current.vector_store = v; }
    if let Some(v) = req.vector_endpoint { current.vector_endpoint = v; }
    if let Some(v) = req.collection { current.collection = v; }
    if let Some(v) = req.auth_token { current.auth_token = v; }
    if let Some(v) = req.chunk_size { current.chunk_size = v; }
    if let Some(v) = req.chunk_overlap { current.chunk_overlap = v; }
    if let Some(v) = req.rerank_candidates { current.rerank_candidates = v; }
    if let Some(v) = req.request_timeout_ms { current.request_timeout_ms = v; }

    // Persist to disk so the new config survives restart.
    let to_persist = DaemonConfig {
        search: nous_lib::search::SearchSection {
            rag: current.clone(),
        },
    };
    if let Err(e) = nous_lib::search::save(&state.daemon_config_path, &to_persist) {
        log::warn!(
            "Failed to persist daemon config to {}: {}",
            state.daemon_config_path.display(),
            e
        );
    }
    let echo = current.sanitized();
    drop(current);

    Ok(Json(ApiResponse { data: echo }))
}

/// `POST /api/search/rag/reindex` — walk every non-deleted, non-archived
/// page and ask the RAG backend to (re)index it. Synchronous from the
/// HTTP perspective; can take minutes on a large library.
async fn rag_reindex(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    // Collect pages first, releasing the storage lock before async embedding work.
    let pages = {
        let storage = state.storage.lock().map_err(|e| {
            api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("storage lock: {}", e))
        })?;
        let notebooks = storage
            .list_notebooks()
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let mut out = Vec::new();
        for nb in notebooks {
            let nb_pages = match storage.list_pages(nb.id) {
                Ok(p) => p,
                Err(_) => continue,
            };
            for page in nb_pages {
                if page.deleted_at.is_some() || page.is_archived {
                    continue;
                }
                out.push(page);
            }
        }
        out
    };

    let total = pages.len();
    let mut indexed = 0usize;
    let mut failed = 0usize;
    for page in &pages {
        let plain_text = plain_text_for_page(page);
        let page_ref = nous_lib::search::PageRef {
            id: page.id,
            notebook_id: page.notebook_id,
            title: &page.title,
            tags: &page.tags,
            page_type: &format!("{:?}", page.page_type).to_lowercase(),
            plain_text,
        };
        use nous_lib::search::SearchBackend;
        match state.rag.index(page_ref).await {
            Ok(()) => indexed += 1,
            Err(nous_lib::search::BackendError::NotConfigured) => {
                return Err(api_err(
                    StatusCode::BAD_REQUEST,
                    "RAG is not configured. POST /api/search/rag/configure first.",
                ));
            }
            Err(e) => {
                failed += 1;
                log::warn!("RAG reindex: page {} failed: {}", page.id, e);
            }
        }
    }

    Ok(Json(ApiResponse {
        data: serde_json::json!({
            "ok": failed == 0,
            "indexed": indexed,
            "failed": failed,
            "total": total,
        }),
    }))
}

/// `GET /api/backup/settings` — return the current scheduled-backup settings.
async fn get_backup_settings(
    State(_state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let data_dir = nous_lib::storage::FileStorage::default_data_dir()
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let settings = nous_lib::storage::backup::load_backup_settings(&data_dir)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(ApiResponse { data: settings }))
}

/// `POST /api/backup/settings` — replace the scheduled-backup settings.
/// Recomputes `next_backup`, persists to disk, and reloads the daemon's
/// in-process `BackupScheduler` so the new schedule takes effect immediately.
async fn update_backup_settings(
    State(state): State<AppState>,
    Json(mut settings): Json<nous_lib::storage::backup::BackupSettings>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let data_dir = nous_lib::storage::FileStorage::default_data_dir()
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    settings.next_backup = nous_lib::storage::backup::calculate_next_backup_time(&settings);
    nous_lib::storage::backup::save_backup_settings(&data_dir, &settings)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    state.backup_scheduler.reload();
    Ok(Json(ApiResponse { data: settings }))
}

/// Extract a plain-text body from a page for embedding. Mirrors the
/// Tantivy `extract_text_from_blocks` shape but lives in api.rs so we
/// don't drag SearchIndex internals into the RAG backend.
fn plain_text_for_page(page: &Page) -> String {
    let mut parts: Vec<String> = Vec::new();
    parts.push(page.title.clone());
    for block in &page.content.blocks {
        match block.block_type.as_str() {
            "paragraph" | "header" | "quote" => {
                if let Some(t) = block.data.get("text").and_then(|v| v.as_str()) {
                    parts.push(strip_html_tags(t));
                }
            }
            "code" => {
                if let Some(c) = block.data.get("code").and_then(|v| v.as_str()) {
                    parts.push(c.to_string());
                }
            }
            "list" | "checklist" => {
                if let Some(items) = block.data.get("items").and_then(|v| v.as_array()) {
                    for item in items {
                        let text = item
                            .as_str()
                            .map(|s| s.to_string())
                            .or_else(|| {
                                item.get("text")
                                    .or_else(|| item.get("content"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string())
                            })
                            .unwrap_or_default();
                        if !text.is_empty() {
                            parts.push(strip_html_tags(&text));
                        }
                    }
                }
            }
            _ => {}
        }
    }
    parts.join("\n")
}

fn strip_html_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.trim().to_string()
}

// ===== Plugins =====

/// `GET /api/plugins` — list loaded plugins (id, name, capabilities, hooks).
/// Returns an empty array when the plugin host isn't available (feature off
/// or build-time disabled). Mirrors the existing Tauri `list_plugins` shape.
async fn list_plugins(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    #[cfg(feature = "plugins")]
    {
        let Some(ref ph) = state.plugin_host else {
            return Ok(Json(ApiResponse {
                data: serde_json::json!([]),
            }));
        };
        let host = ph.lock().map_err(|e| {
            api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("plugin lock: {e}"))
        })?;
        let infos = host.list_plugins();
        Ok(Json(ApiResponse {
            data: serde_json::to_value(infos).unwrap_or(serde_json::json!([])),
        }))
    }
    #[cfg(not(feature = "plugins"))]
    {
        let _ = state;
        Ok(Json(ApiResponse {
            data: serde_json::json!([]),
        }))
    }
}

/// `POST /api/plugins/{plugin_id}/reload` — re-read a plugin from disk.
/// 404 if the id isn't loaded; 503 if the plugin host isn't available.
async fn reload_plugin(
    State(state): State<AppState>,
    Path(plugin_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    #[cfg(feature = "plugins")]
    {
        let Some(ref ph) = state.plugin_host else {
            return Err(api_err(
                StatusCode::SERVICE_UNAVAILABLE,
                "Plugin host not available (compiled without the 'plugins' feature)",
            ));
        };
        let mut host = ph.lock().map_err(|e| {
            api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("plugin lock: {e}"))
        })?;
        host.reload(&plugin_id).map_err(|e| {
            // PluginError doesn't expose a NotFound discriminant publicly,
            // so stringify-match for the common "not found" case to map to
            // 404. Other failures map to 500.
            let s = e.to_string();
            if s.contains("not found") || s.contains("Not found") {
                api_err(StatusCode::NOT_FOUND, format!("Plugin '{}' not found", plugin_id))
            } else {
                api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("Reload failed: {s}"))
            }
        })?;
        Ok(Json(ApiResponse {
            data: serde_json::json!({"ok": true, "pluginId": plugin_id}),
        }))
    }
    #[cfg(not(feature = "plugins"))]
    {
        let _ = (state, plugin_id);
        Err(api_err(
            StatusCode::SERVICE_UNAVAILABLE,
            "Plugin host not available (compiled without the 'plugins' feature)",
        ))
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

    // Set content if provided (blocks > plain text > markdown)
    if let Some(blocks) = req.blocks {
        page.content = make_block_content(blocks);
    } else if let Some(text) = req.content {
        page.content = make_paragraph_content(&text);
    } else if let Some(md) = req.markdown {
        page.content = make_block_content(parse_markdown_to_blocks(&md));
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

    // Set parent page (for nested pages)
    if let Some(pid) = req.parent_page_id {
        page.parent_page_id = Some(parse_uuid(&pid)?);
    }

    // Set template
    if let Some(tid) = req.template_id {
        page.template_id = Some(tid);
    }

    // Set plugin page type and data
    if let Some(ppt) = req.plugin_page_type {
        page.plugin_page_type = Some(ppt);
    }
    if let Some(pd) = req.plugin_data {
        page.plugin_data = Some(pd);
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

    // Index the new page (best-effort — log on failure, don't fail the request).
    if let Ok(mut idx) = state.search_index.lock() {
        if let Err(e) = idx.index_page(&page) {
            log::warn!("Failed to index newly created page {}: {}", page.id, e);
        }
    }

    // Fire-and-forget RAG indexing if enabled. The HTTP response
    // returns immediately; embedding calls happen in the background.
    spawn_rag_index(&state, &page);

    // Dispatch plugin OnPageCreated hook (background thread; never blocks).
    #[cfg(feature = "plugins")]
    nous_lib::plugins::dispatch_plugin_event_bg(
        &state.plugin_host,
        nous_lib::plugins::HookPoint::OnPageCreated,
        serde_json::json!({
            "notebook_id": nb_id.to_string(),
            "page_id": page.id.to_string(),
            "title": page.title,
        }),
    );

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

    // Build the proposed content from whichever input shape was provided
    // (blocks > plain text > markdown), then route through the CRDT store
    // when this write is associated with an editor pane. apply_save returns
    // the canonical post-merge state if the page is currently live in any
    // pane, so the caller sees other panes' changes too.
    let proposed_content: Option<EditorData> = if let Some(blocks) = req.blocks {
        Some(make_block_content(blocks))
    } else if let Some(text) = req.content {
        Some(make_paragraph_content(&text))
    } else if let Some(md) = req.markdown {
        Some(make_block_content(parse_markdown_to_blocks(&md)))
    } else {
        None
    };

    if let Some(content) = proposed_content {
        let pane = req.pane_id.as_deref().unwrap_or("default");
        match state.crdt_store.apply_save(pg_id, pane, &content) {
            Ok(Some(canonical)) => page.content = canonical,
            Ok(None) => page.content = content,
            Err(e) => {
                log::warn!("CRDT apply_save failed for page {}: {}", pg_id, e);
                page.content = content;
            }
        }
    }

    if let Some(tags) = req.tags {
        page.tags = tags;
    }
    if let Some(fid_opt) = req.folder_id {
        page.folder_id = match fid_opt {
            None => None,
            Some(s) if s.is_empty() => None,
            Some(s) => Some(
                Uuid::parse_str(&s)
                    .map_err(|e| api_err(StatusCode::BAD_REQUEST, format!("Invalid folder ID: {}", e)))?,
            ),
        };
    }
    if let Some(sid_opt) = req.section_id {
        page.section_id = match sid_opt {
            None => None,
            Some(s) if s.is_empty() => None,
            Some(s) => Some(
                Uuid::parse_str(&s)
                    .map_err(|e| api_err(StatusCode::BAD_REQUEST, format!("Invalid section ID: {}", e)))?,
            ),
        };
    }

    // System prompt — empty string also clears (Tauri parity).
    if let Some(prompt_opt) = req.system_prompt {
        page.system_prompt = match prompt_opt {
            None => None,
            Some(s) if s.is_empty() => None,
            Some(s) => Some(s),
        };
    }
    if let Some(mode) = req.system_prompt_mode {
        page.system_prompt_mode = match mode.as_str() {
            "concatenate" => SystemPromptMode::Concatenate,
            _ => SystemPromptMode::Override,
        };
    }

    if let Some(pt) = req.page_type {
        page.page_type = match pt.as_str() {
            "markdown" => PageType::Markdown,
            "pdf" => PageType::Pdf,
            "jupyter" => PageType::Jupyter,
            "epub" => PageType::Epub,
            "calendar" => PageType::Calendar,
            "chat" => PageType::Chat,
            "canvas" => PageType::Canvas,
            "database" => PageType::Database,
            "html" => PageType::Html,
            _ => PageType::Standard,
        };
    }

    // File extension — empty string also clears. Setting an extension on a
    // file-based page auto-creates source_file = files/{page_id}.{ext}.
    if let Some(ext_opt) = req.file_extension {
        let new_ext = match ext_opt {
            None => None,
            Some(s) if s.is_empty() => None,
            Some(s) => Some(s),
        };
        page.file_extension = new_ext.clone();

        if let Some(ext) = new_ext {
            if page.source_file.is_none() {
                let is_file_based = matches!(
                    page.page_type,
                    PageType::Markdown
                        | PageType::Calendar
                        | PageType::Chat
                        | PageType::Jupyter
                        | PageType::Canvas
                        | PageType::Database
                );
                if is_file_based {
                    page.source_file = Some(format!("files/{}.{}", pg_id, ext));
                    page.storage_mode = Some(FileStorageMode::Embedded);
                    let files_dir = storage.get_notebook_path(nb_id).join("files");
                    if !files_dir.exists() {
                        let _ = std::fs::create_dir_all(&files_dir);
                    }
                }
            }
        }
    }

    if let Some(fav) = req.is_favorite {
        page.is_favorite = fav;
    }
    if let Some(daily) = req.is_daily_note {
        page.is_daily_note = daily;
    }
    if let Some(date_opt) = req.daily_note_date {
        page.daily_note_date = date_opt;
    }
    if let Some(color_opt) = req.color {
        page.color = color_opt;
    }
    if let Some(ppt_opt) = req.plugin_page_type {
        page.plugin_page_type = ppt_opt;
    }
    if let Some(pd_opt) = req.plugin_data {
        page.plugin_data = pd_opt;
    }

    page.updated_at = chrono::Utc::now();

    if let Err(e) = storage.update_page(&page) {
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()));
    }

    // Grab notebook path before releasing the storage lock so the optional
    // git auto-commit below doesn't hold the lock during disk I/O.
    let notebook_path = storage.get_notebook_path(nb_id);
    drop(storage);

    state.sync_manager.queue_page_update(nb_id, pg_id);

    // Reindex (best-effort).
    if let Ok(mut idx) = state.search_index.lock() {
        if let Err(e) = idx.index_page(&page) {
            log::warn!("Failed to reindex page {}: {}", pg_id, e);
        }
    }

    // Fire-and-forget RAG reindex if enabled.
    spawn_rag_index(&state, &page);

    // Plugin OnPageUpdated hook (background thread).
    #[cfg(feature = "plugins")]
    nous_lib::plugins::dispatch_plugin_event_bg(
        &state.plugin_host,
        nous_lib::plugins::HookPoint::OnPageUpdated,
        serde_json::json!({
            "notebook_id": nb_id.to_string(),
            "page_id": pg_id.to_string(),
            "title": page.title,
            "tags": page.tags,
        }),
    );

    if req.commit.unwrap_or(false) && git::is_git_repo(&notebook_path) {
        let commit_message = format!("Update page: {}", page.title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit page update: {}", e);
        }
    }

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

#[derive(Deserialize)]
struct ListDailyNotesQuery {
    start_date: Option<String>,
    end_date: Option<String>,
}

async fn list_daily_notes(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Query(query): Query<ListDailyNotesQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();
    let pages = list_daily_notes_core(
        &storage,
        nb_id,
        query.start_date.as_deref(),
        query.end_date.as_deref(),
    )
    .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.message))?;
    Ok(Json(ApiResponse { data: pages }))
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
            #[cfg(feature = "plugins")]
            nous_lib::plugins::dispatch_plugin_event_bg(
                &state.plugin_host,
                nous_lib::plugins::HookPoint::OnInboxCaptured,
                serde_json::json!({
                    "item_id": item.id.to_string(),
                    "title": item.title,
                    "tags": item.tags,
                }),
            );
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

    drop(goals_storage);

    // Plugin OnGoalProgress hook (background thread).
    #[cfg(feature = "plugins")]
    nous_lib::plugins::dispatch_plugin_event_bg(
        &state.plugin_host,
        nous_lib::plugins::HookPoint::OnGoalProgress,
        serde_json::json!({
            "goal_id": id.to_string(),
            "date": req.date,
            "completed": completed,
        }),
    );

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

/// Parse markdown-ish text into Editor.js blocks.
/// Supports headers (##), unordered lists (- ), ordered lists (1. ),
/// checklists (- [ ] / - [x] ), and paragraphs.
fn text_to_blocks(text: &str) -> Vec<EditorBlock> {
    let mut blocks: Vec<EditorBlock> = Vec::new();
    let mut current_list: Vec<String> = Vec::new();
    let mut list_style = "unordered"; // "unordered" or "ordered"
    let mut current_checklist: Vec<(String, bool)> = Vec::new();
    let mut paragraph_lines: Vec<String> = Vec::new();

    let flush_paragraph = |lines: &mut Vec<String>, blocks: &mut Vec<EditorBlock>| {
        if !lines.is_empty() {
            let text = lines.join("\n");
            if !text.trim().is_empty() {
                blocks.push(EditorBlock {
                    id: Uuid::new_v4().to_string()[..10].to_string(),
                    block_type: "paragraph".to_string(),
                    data: serde_json::json!({ "text": text.trim() }),
                });
            }
            lines.clear();
        }
    };

    let flush_list = |items: &mut Vec<String>, style: &str, blocks: &mut Vec<EditorBlock>| {
        if !items.is_empty() {
            let list_items: Vec<serde_json::Value> = items
                .iter()
                .map(|item| serde_json::json!({ "content": item, "items": [] }))
                .collect();
            blocks.push(EditorBlock {
                id: Uuid::new_v4().to_string()[..10].to_string(),
                block_type: "list".to_string(),
                data: serde_json::json!({ "style": style, "items": list_items }),
            });
            items.clear();
        }
    };

    let flush_checklist = |items: &mut Vec<(String, bool)>, blocks: &mut Vec<EditorBlock>| {
        if !items.is_empty() {
            let cl_items: Vec<serde_json::Value> = items
                .iter()
                .map(|(text, checked)| serde_json::json!({ "text": text, "checked": checked }))
                .collect();
            blocks.push(EditorBlock {
                id: Uuid::new_v4().to_string()[..10].to_string(),
                block_type: "checklist".to_string(),
                data: serde_json::json!({ "items": cl_items }),
            });
            items.clear();
        }
    };

    for line in text.lines() {
        let trimmed = line.trim();

        // Empty line — flush current paragraph
        if trimmed.is_empty() {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            continue;
        }

        // Header: # ## ### etc.
        if trimmed.starts_with('#') {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            flush_list(&mut current_list, list_style, &mut blocks);
            flush_checklist(&mut current_checklist, &mut blocks);

            let level = trimmed.chars().take_while(|c| *c == '#').count().min(6);
            let header_text = trimmed[level..].trim().to_string();
            if !header_text.is_empty() {
                blocks.push(EditorBlock {
                    id: Uuid::new_v4().to_string()[..10].to_string(),
                    block_type: "header".to_string(),
                    data: serde_json::json!({ "text": header_text, "level": level }),
                });
            }
            continue;
        }

        // Checklist: - [ ] or - [x]
        if (trimmed.starts_with("- [ ] ") || trimmed.starts_with("- [x] ") || trimmed.starts_with("- [X] ")) {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            flush_list(&mut current_list, list_style, &mut blocks);

            let checked = trimmed.starts_with("- [x]") || trimmed.starts_with("- [X]");
            let item_text = trimmed[6..].trim().to_string();
            current_checklist.push((item_text, checked));
            continue;
        }

        // Unordered list: - or *
        if (trimmed.starts_with("- ") || trimmed.starts_with("* ")) && !trimmed.starts_with("- [") {
            flush_paragraph(&mut paragraph_lines, &mut blocks);
            flush_checklist(&mut current_checklist, &mut blocks);

            if list_style != "unordered" && !current_list.is_empty() {
                flush_list(&mut current_list, list_style, &mut blocks);
            }
            list_style = "unordered";
            current_list.push(trimmed[2..].trim().to_string());
            continue;
        }

        // Ordered list: 1. 2. etc.
        if trimmed.len() > 2 {
            let dot_pos = trimmed.find(". ");
            if let Some(pos) = dot_pos {
                if pos <= 3 && trimmed[..pos].chars().all(|c| c.is_ascii_digit()) {
                    flush_paragraph(&mut paragraph_lines, &mut blocks);
                    flush_checklist(&mut current_checklist, &mut blocks);

                    if list_style != "ordered" && !current_list.is_empty() {
                        flush_list(&mut current_list, list_style, &mut blocks);
                    }
                    list_style = "ordered";
                    current_list.push(trimmed[pos + 2..].trim().to_string());
                    continue;
                }
            }
        }

        // Regular text — accumulate as paragraph
        flush_list(&mut current_list, list_style, &mut blocks);
        flush_checklist(&mut current_checklist, &mut blocks);
        paragraph_lines.push(trimmed.to_string());
    }

    // Flush remaining
    flush_paragraph(&mut paragraph_lines, &mut blocks);
    flush_list(&mut current_list, list_style, &mut blocks);
    flush_checklist(&mut current_checklist, &mut blocks);

    if blocks.is_empty() {
        blocks.push(EditorBlock {
            id: Uuid::new_v4().to_string()[..10].to_string(),
            block_type: "paragraph".to_string(),
            data: serde_json::json!({ "text": "" }),
        });
    }

    blocks
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

    drop(storage);

    // Drop from search index — best-effort.
    if let Ok(mut idx) = state.search_index.lock() {
        if let Err(e) = idx.remove_page(page_id) {
            log::warn!("Failed to remove page {} from search index: {}", page_id, e);
        }
    }

    // Fire-and-forget RAG delete if enabled.
    spawn_rag_delete(&state, page_id);

    // Plugin OnPageDeleted hook (background thread).
    #[cfg(feature = "plugins")]
    nous_lib::plugins::dispatch_plugin_event_bg(
        &state.plugin_host,
        nous_lib::plugins::HookPoint::OnPageDeleted,
        serde_json::json!({
            "notebook_id": nb_id.to_string(),
            "page_id": page_id.to_string(),
            "title": page.title,
        }),
    );

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

    drop(storage);
    emit_event(&state, "page.tags.updated", serde_json::json!({
        "notebookId": notebook_id,
        "pageId": page.id.to_string(),
        "tags": page.tags,
    }));

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

    drop(storage);
    emit_event(&state, "page.moved", serde_json::json!({
        "notebookId": notebook_id,
        "pageId": page.id.to_string(),
        "folderId": page.folder_id.map(|u| u.to_string()),
        "sectionId": page.section_id.map(|u| u.to_string()),
    }));

    Ok(Json(ApiResponse { data: page }))
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

/// Inbound commands from the WS client. Page content is loaded server-side
/// from storage on `pane_open` — clients don't need to ship it on the wire.
/// `tag` rename_all gives us `pane_open`/`pane_close` discriminators; the
/// per-variant `rename_all` makes the field names `notebookId`/`pageId`/
/// `paneId` to match the JS client's natural casing on the WS.
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PaneCommand {
    #[serde(rename_all = "camelCase")]
    PaneOpen {
        notebook_id: Uuid,
        page_id: Uuid,
        pane_id: String,
    },
    #[serde(rename_all = "camelCase")]
    PaneClose {
        page_id: Uuid,
        pane_id: String,
    },
}

async fn handle_ws_events(mut socket: WebSocket, state: AppState) {
    let mut rx = state.event_tx.subscribe();

    // Track panes opened by THIS connection so we can auto-close them when
    // the socket drops. Without this invariant a desktop crash would leave
    // panes registered as live forever, blocking close_pane's flush logic.
    let mut my_panes: HashSet<(Uuid, String)> = HashSet::new();

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
            // Handle incoming messages (ping/pong, close, pane lifecycle)
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Ping(data))) => {
                        if socket.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Text(text))) => {
                        let cmd: PaneCommand = match serde_json::from_str(&text) {
                            Ok(c) => c,
                            Err(e) => {
                                log::debug!("WS: ignoring unrecognized text frame: {}", e);
                                continue;
                            }
                        };
                        if !handle_pane_command(cmd, &state, &mut my_panes, &mut socket).await {
                            break;
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    // Auto-close any panes this connection opened so the CRDT store's
    // close_pane invariants (final flush + GC of LivePage) still run.
    for (page_id, pane_id) in &my_panes {
        state.crdt_store.close_pane(*page_id, pane_id);
    }

    log::info!("WebSocket client disconnected from /api/events");
}

/// Apply one PaneCommand. Returns false if the connection should be closed.
async fn handle_pane_command(
    cmd: PaneCommand,
    state: &AppState,
    my_panes: &mut HashSet<(Uuid, String)>,
    socket: &mut WebSocket,
) -> bool {
    match cmd {
        PaneCommand::PaneOpen { notebook_id, page_id, pane_id } => {
            // Load page content with the storage guard scoped to this block
            // so the !Send MutexGuard is dropped before any .await below.
            let load_result: Result<EditorData, String> = {
                let storage = match state.storage.lock() {
                    Ok(g) => g,
                    Err(e) => {
                        log::warn!("WS pane_open: storage lock poisoned: {}", e);
                        return true;
                    }
                };
                storage
                    .get_page(notebook_id, page_id)
                    .map(|p| p.content)
                    .map_err(|e| e.to_string())
            };

            let content = match load_result {
                Ok(c) => c,
                Err(e) => {
                    log::warn!(
                        "WS pane_open: failed to load page {} for pane {}: {}",
                        page_id, pane_id, e
                    );
                    return send_pane_ack(socket, "pane_open_error", page_id, &pane_id).await;
                }
            };

            if let Err(e) = state.crdt_store.open_page(notebook_id, page_id, &pane_id, &content) {
                log::warn!(
                    "WS pane_open: crdt_store.open_page failed for {}/{}: {}",
                    page_id, pane_id, e
                );
                return send_pane_ack(socket, "pane_open_error", page_id, &pane_id).await;
            }

            my_panes.insert((page_id, pane_id.clone()));
            send_pane_ack(socket, "pane_opened", page_id, &pane_id).await
        }
        PaneCommand::PaneClose { page_id, pane_id } => {
            state.crdt_store.close_pane(page_id, &pane_id);
            my_panes.remove(&(page_id, pane_id.clone()));
            send_pane_ack(socket, "pane_closed", page_id, &pane_id).await
        }
    }
}

/// Send a small JSON ack to the client. Returns false if the socket is dead.
async fn send_pane_ack(
    socket: &mut WebSocket,
    event_type: &str,
    page_id: Uuid,
    pane_id: &str,
) -> bool {
    let payload = serde_json::json!({
        "type": event_type,
        "pageId": page_id.to_string(),
        "paneId": pane_id,
    });
    let text = serde_json::to_string(&payload).unwrap_or_default();
    socket.send(Message::Text(text.into())).await.is_ok()
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

/// `PUT /api/notebooks/{nb}/databases/{db}` — replace the entire .database
/// content for a database page atomically. Symmetric with `get_database`.
/// Body is the raw `{properties, rows, views, ...}` JSON. Used by Python
/// MCP tools that do read-modify-write on the whole structure (add a
/// property, migrate cells, etc.); the row-only endpoints don't cover
/// schema-level changes.
async fn put_database(
    State(state): State<AppState>,
    Path((notebook_id, db_id)): Path<(String, String)>,
    Json(body): Json<serde_json::Value>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&db_id)?;
    let storage = state.storage.lock().unwrap();

    let mut page = storage
        .get_page(nb_id, pg_id)
        .map_err(|e| api_err(StatusCode::NOT_FOUND, e.to_string()))?;

    if page.page_type != PageType::Database {
        return Err(api_err(StatusCode::BAD_REQUEST, "Not a database page"));
    }

    // Serialize prettily so the on-disk file stays diffable for git users.
    let serialized = serde_json::to_string_pretty(&body)
        .map_err(|e| api_err(StatusCode::BAD_REQUEST, format!("Invalid JSON body: {e}")))?;

    storage
        .write_native_file_content(&page, &serialized)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    page.updated_at = chrono::Utc::now();
    storage
        .update_page_metadata(&page)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);

    state.sync_manager.queue_page_update(nb_id, pg_id);

    emit_event(&state, "database.updated", serde_json::json!({
        "notebookId": notebook_id,
        "pageId": db_id,
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({"ok": true, "id": pg_id.to_string()}),
    }))
}

// ===== Folders: Create, Update, Delete =====

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

    drop(storage);
    emit_event(&state, "folder.created", serde_json::json!({
        "notebookId": notebook_id,
        "folderId": folder.id.to_string(),
        "name": folder.name,
        "parentId": folder.parent_id.map(|u| u.to_string()),
        "sectionId": folder.section_id.map(|u| u.to_string()),
    }));

    Ok((StatusCode::CREATED, Json(ApiResponse { data: folder })))
}

async fn update_folder(
    State(state): State<AppState>,
    Path((notebook_id, folder_id)): Path<(String, String)>,
    Json(req): Json<UpdateFolderRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let fld_id = parse_uuid(&folder_id)?;
    let storage = state.storage.lock().unwrap();

    let mut folder = storage
        .get_folder(nb_id, fld_id)
        .map_err(|e| api_err(StatusCode::NOT_FOUND, e.to_string()))?;

    if let Some(name) = req.name {
        folder.name = name;
    }

    if let Some(parent_opt) = req.parent_id {
        folder.parent_id = match parent_opt {
            None => None,
            Some(s) => Some(parse_uuid(&s)?),
        };
    }

    if let Some(color_opt) = req.color {
        folder.color = color_opt;
    }

    if let Some(section_opt) = req.section_id {
        let new_section_uuid = match section_opt {
            None => None,
            Some(s) => Some(parse_uuid(&s)?),
        };

        // If section is changing, also update all pages in this folder
        if folder.section_id != new_section_uuid {
            let pages = storage
                .list_pages(nb_id)
                .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            for mut page in pages {
                if page.folder_id == Some(fld_id) {
                    page.section_id = new_section_uuid;
                    page.updated_at = chrono::Utc::now();
                    storage
                        .update_page(&page)
                        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
                }
            }
        }

        folder.section_id = new_section_uuid;
    }

    folder.updated_at = chrono::Utc::now();
    storage
        .update_folder(&folder)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "folder.updated", serde_json::json!({
        "notebookId": notebook_id,
        "folderId": folder.id.to_string(),
        "name": folder.name,
        "parentId": folder.parent_id.map(|u| u.to_string()),
        "sectionId": folder.section_id.map(|u| u.to_string()),
    }));

    Ok(Json(ApiResponse { data: folder }))
}

async fn delete_folder(
    State(state): State<AppState>,
    Path((notebook_id, folder_id)): Path<(String, String)>,
    Query(query): Query<DeleteFolderQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let fld_id = parse_uuid(&folder_id)?;
    let target = match query.move_pages_to.as_deref() {
        None | Some("") => None,
        Some(s) => Some(parse_uuid(s)?),
    };
    let storage = state.storage.lock().unwrap();

    storage
        .delete_folder(nb_id, fld_id, target)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "folder.deleted", serde_json::json!({
        "notebookId": notebook_id,
        "folderId": folder_id,
        "movePagesTo": target.map(|u| u.to_string()),
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({"ok": true}),
    }))
}

// ===== Sections: Create, Update, Delete =====

async fn create_section(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(req): Json<CreateSectionRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();

    let section = storage
        .create_section(nb_id, req.name.clone(), req.color)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "section.created", serde_json::json!({
        "notebookId": notebook_id,
        "sectionId": section.id.to_string(),
        "name": section.name,
    }));

    Ok((StatusCode::CREATED, Json(ApiResponse { data: section })))
}

async fn update_section(
    State(state): State<AppState>,
    Path((notebook_id, section_id)): Path<(String, String)>,
    Json(req): Json<UpdateSectionRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let sec_id = parse_uuid(&section_id)?;
    let storage = state.storage.lock().unwrap();

    let mut section = storage
        .get_section(nb_id, sec_id)
        .map_err(|e| api_err(StatusCode::NOT_FOUND, e.to_string()))?;

    if let Some(name) = req.name {
        section.name = name;
    }
    if let Some(desc_opt) = req.description {
        section.description = desc_opt;
    }
    if let Some(color_opt) = req.color {
        section.color = color_opt;
    }
    if let Some(prompt_opt) = req.system_prompt {
        section.system_prompt = prompt_opt;
    }
    if let Some(mode) = req.system_prompt_mode {
        section.system_prompt_mode = match mode.as_str() {
            "concatenate" => nous_lib::storage::SystemPromptMode::Concatenate,
            _ => nous_lib::storage::SystemPromptMode::Override,
        };
    }
    if let Some(sort) = req.page_sort_by {
        section.page_sort_by = if sort.is_empty() { None } else { Some(sort) };
    }

    section.updated_at = chrono::Utc::now();
    storage
        .update_section(&section)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "section.updated", serde_json::json!({
        "notebookId": notebook_id,
        "sectionId": section.id.to_string(),
        "name": section.name,
    }));

    Ok(Json(ApiResponse { data: section }))
}

async fn delete_section(
    State(state): State<AppState>,
    Path((notebook_id, section_id)): Path<(String, String)>,
    Query(query): Query<DeleteSectionQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let sec_id = parse_uuid(&section_id)?;
    let target = match query.move_items_to.as_deref() {
        None | Some("") => None,
        Some(s) => Some(parse_uuid(s)?),
    };
    let storage = state.storage.lock().unwrap();

    storage
        .delete_section(nb_id, sec_id, target)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "section.deleted", serde_json::json!({
        "notebookId": notebook_id,
        "sectionId": section_id,
        "moveItemsTo": target.map(|u| u.to_string()),
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({"ok": true}),
    }))
}

// ===== Archive / Unarchive =====

async fn archive_page(
    State(state): State<AppState>,
    Path((notebook_id, page_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&page_id)?;
    let storage = state.storage.lock().unwrap();

    let page = storage
        .archive_page(nb_id, pg_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "page.archived", serde_json::json!({
        "notebookId": notebook_id,
        "pageId": page.id.to_string(),
        "title": page.title,
    }));

    Ok(Json(ApiResponse { data: page }))
}

async fn unarchive_page(
    State(state): State<AppState>,
    Path((notebook_id, page_id)): Path<(String, String)>,
    Json(req): Json<UnarchivePageRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let pg_id = parse_uuid(&page_id)?;
    let target_folder_id = match req.target_folder_id.as_deref() {
        None | Some("") => None,
        Some(s) => Some(parse_uuid(s)?),
    };
    let storage = state.storage.lock().unwrap();

    let page = storage
        .unarchive_page(nb_id, pg_id, target_folder_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "page.unarchived", serde_json::json!({
        "notebookId": notebook_id,
        "pageId": page.id.to_string(),
        "title": page.title,
        "folderId": page.folder_id.map(|u| u.to_string()),
    }));

    Ok(Json(ApiResponse { data: page }))
}

async fn archive_folder(
    State(state): State<AppState>,
    Path((notebook_id, folder_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let fld_id = parse_uuid(&folder_id)?;
    let storage = state.storage.lock().unwrap();

    let folder = storage
        .archive_folder(nb_id, fld_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "folder.archived", serde_json::json!({
        "notebookId": notebook_id,
        "folderId": folder.id.to_string(),
        "name": folder.name,
    }));

    Ok(Json(ApiResponse { data: folder }))
}

async fn unarchive_folder(
    State(state): State<AppState>,
    Path((notebook_id, folder_id)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let fld_id = parse_uuid(&folder_id)?;
    let storage = state.storage.lock().unwrap();

    let folder = storage
        .unarchive_folder(nb_id, fld_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "folder.unarchived", serde_json::json!({
        "notebookId": notebook_id,
        "folderId": folder.id.to_string(),
        "name": folder.name,
    }));

    Ok(Json(ApiResponse { data: folder }))
}

// ===== Reorder =====

async fn reorder_pages(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(req): Json<ReorderPagesRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let folder_id = match req.folder_id.as_deref() {
        None | Some("") => None,
        Some(s) => Some(parse_uuid(s)?),
    };
    let mut page_uuids: Vec<Uuid> = Vec::with_capacity(req.page_ids.len());
    for s in &req.page_ids {
        page_uuids.push(parse_uuid(s)?);
    }

    let storage = state.storage.lock().unwrap();
    storage
        .reorder_pages(nb_id, folder_id, &page_uuids)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "page.reordered", serde_json::json!({
        "notebookId": notebook_id,
        "folderId": folder_id.map(|u| u.to_string()),
        "pageIds": req.page_ids,
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({"ok": true}),
    }))
}

async fn reorder_folders(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(req): Json<ReorderFoldersRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let parent_id = match req.parent_id.as_deref() {
        None | Some("") => None,
        Some(s) => Some(parse_uuid(s)?),
    };
    let mut folder_uuids: Vec<Uuid> = Vec::with_capacity(req.folder_ids.len());
    for s in &req.folder_ids {
        folder_uuids.push(parse_uuid(s)?);
    }

    let storage = state.storage.lock().unwrap();
    storage
        .reorder_folders(nb_id, parent_id, &folder_uuids)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "folder.reordered", serde_json::json!({
        "notebookId": notebook_id,
        "parentId": parent_id.map(|u| u.to_string()),
        "folderIds": req.folder_ids,
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({"ok": true}),
    }))
}

async fn reorder_sections(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(req): Json<ReorderSectionsRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let mut section_uuids: Vec<Uuid> = Vec::with_capacity(req.section_ids.len());
    for s in &req.section_ids {
        section_uuids.push(parse_uuid(s)?);
    }

    let storage = state.storage.lock().unwrap();
    storage
        .reorder_sections(nb_id, &section_uuids)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "section.reordered", serde_json::json!({
        "notebookId": notebook_id,
        "sectionIds": req.section_ids,
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({"ok": true}),
    }))
}

// ===== Tags =====

async fn list_all_tags(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let storage = state.storage.lock().unwrap();
    let tags = storage
        .get_all_tags()
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let result: Vec<serde_json::Value> = tags
        .into_iter()
        .map(|(name, count)| serde_json::json!({"name": name, "count": count}))
        .collect();
    Ok(Json(ApiResponse { data: result }))
}

async fn list_notebook_tags(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();
    let tags = storage
        .get_notebook_tags(nb_id)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let result: Vec<serde_json::Value> = tags
        .into_iter()
        .map(|(name, count)| serde_json::json!({"name": name, "count": count}))
        .collect();
    Ok(Json(ApiResponse { data: result }))
}

async fn rename_tag(
    State(state): State<AppState>,
    Path((notebook_id, tag)): Path<(String, String)>,
    Json(req): Json<RenameTagRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();
    let updated = storage
        .rename_tag(nb_id, &tag, &req.new_name)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "tag.renamed", serde_json::json!({
        "notebookId": notebook_id,
        "from": tag,
        "to": req.new_name,
        "pagesUpdated": updated,
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({"pagesUpdated": updated}),
    }))
}

async fn merge_tags(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(req): Json<MergeTagsRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();
    let updated = storage
        .merge_tags(nb_id, &req.from, &req.into)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "tag.merged", serde_json::json!({
        "notebookId": notebook_id,
        "from": req.from,
        "into": req.into,
        "pagesUpdated": updated,
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({"pagesUpdated": updated}),
    }))
}

async fn delete_tag(
    State(state): State<AppState>,
    Path((notebook_id, tag)): Path<(String, String)>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();
    let updated = storage
        .delete_tag(nb_id, &tag)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    drop(storage);
    emit_event(&state, "tag.deleted", serde_json::json!({
        "notebookId": notebook_id,
        "tag": tag,
        "pagesUpdated": updated,
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({"pagesUpdated": updated}),
    }))
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

// ===== Create Database =====

async fn create_database(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(req): Json<CreateDatabaseRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let nb_id = parse_uuid(&notebook_id)?;
    let storage = state.storage.lock().unwrap();

    // Create the page
    let mut page = storage
        .create_page(nb_id, req.title)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    page.page_type = PageType::Database;
    page.storage_mode = Some(nous_lib::storage::FileStorageMode::Embedded);
    page.file_extension = Some("database".to_string());
    page.source_file = Some(format!("files/{}.database", page.id));

    if let Some(tags) = req.tags {
        page.tags = tags;
    }
    if let Some(fid) = req.folder_id {
        if let Ok(uuid) = Uuid::parse_str(&fid) {
            page.folder_id = Some(uuid);
        }
    }
    if let Some(sid) = req.section_id {
        if let Ok(uuid) = Uuid::parse_str(&sid) {
            page.section_id = Some(uuid);
        }
    }

    storage
        .update_page(&page)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Build properties with generated UUIDs
    let colors = [
        "#ef4444", "#f97316", "#f59e0b", "#22c55e", "#14b8a6",
        "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#64748b",
    ];
    let mut built_properties = Vec::new();
    let mut color_idx = 0usize;

    for spec in &req.properties {
        let name = spec.get("name").and_then(|v| v.as_str()).unwrap_or("Column");
        let prop_type = spec.get("type").and_then(|v| v.as_str()).unwrap_or("text");

        let mut prop = serde_json::json!({
            "id": Uuid::new_v4().to_string(),
            "name": name,
            "type": prop_type,
        });

        // Build options for select/multiSelect
        if prop_type == "select" || prop_type == "multiSelect" {
            if let Some(opts) = spec.get("options").and_then(|v| v.as_array()) {
                let built_opts: Vec<serde_json::Value> = opts
                    .iter()
                    .map(|opt| {
                        let label = opt.as_str().unwrap_or("Option");
                        let color = colors[color_idx % colors.len()];
                        color_idx += 1;
                        serde_json::json!({
                            "id": Uuid::new_v4().to_string(),
                            "label": label,
                            "color": color,
                        })
                    })
                    .collect();
                prop["options"] = serde_json::json!(built_opts);
            }
        }

        built_properties.push(prop);
    }

    // Create the .database file
    let db_content = serde_json::json!({
        "version": 2,
        "properties": built_properties,
        "rows": [],
        "views": [{
            "id": Uuid::new_v4().to_string(),
            "name": "Table",
            "type": "table",
            "sorts": [],
            "filters": [],
            "config": {},
        }],
    });

    let db_json = serde_json::to_string_pretty(&db_content)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("serialize: {e}")))?;
    storage
        .write_native_file_content(&page, &db_json)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    state.sync_manager.queue_page_update(nb_id, page.id);

    emit_event(&state, "database.created", serde_json::json!({
        "notebookId": notebook_id,
        "databaseId": page.id.to_string(),
        "title": page.title,
        "propertyCount": built_properties.len(),
    }));

    Ok((StatusCode::CREATED, Json(ApiResponse {
        data: serde_json::json!({
            "id": page.id.to_string(),
            "title": page.title,
            "notebookId": notebook_id,
            "propertyCount": built_properties.len(),
        }),
    })))
}

// ===== Delete Database Rows =====

async fn delete_database_rows(
    State(state): State<AppState>,
    Path((notebook_id, db_id)): Path<(String, String)>,
    Json(req): Json<DeleteRowsRequest>,
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

    let rows_arr = db
        .get_mut("rows")
        .and_then(|v| v.as_array_mut())
        .ok_or_else(|| api_err(StatusCode::INTERNAL_SERVER_ERROR, "database has no rows array"))?;

    let before = rows_arr.len();
    let ids_to_delete: std::collections::HashSet<&str> =
        req.row_ids.iter().map(|s| s.as_str()).collect();
    rows_arr.retain(|row| {
        row.get("id")
            .and_then(|v| v.as_str())
            .map_or(true, |id| !ids_to_delete.contains(id))
    });
    let deleted = before - rows_arr.len();
    let total = rows_arr.len();

    // Drop the mutable borrow on `db` before serializing
    let db_json = serde_json::to_string_pretty(&db)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("serialize: {e}")))?;
    storage
        .write_native_file_content(&page, &db_json)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    emit_event(&state, "database.rows_deleted", serde_json::json!({
        "notebookId": notebook_id,
        "databaseId": db_id,
        "rowsDeleted": deleted,
        "totalRows": total,
    }));

    Ok(Json(ApiResponse {
        data: serde_json::json!({
            "databaseId": db_id,
            "rowsDeleted": deleted,
            "totalRows": total,
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
    let script_path = find_script("import_artwork.py")
        .ok_or_else(|| api_err(StatusCode::INTERNAL_SERVER_ERROR, "import_artwork.py not found"))?;

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

    // Find nous-py project dir for uv run (has openai, httpx, etc.)
    let nous_py_dir = std::env::var("PYTHONPATH")
        .ok()
        .and_then(|p| p.split(':').next().map(|s| std::path::PathBuf::from(s)))
        .unwrap_or_else(|| std::path::PathBuf::from("nous-py"));

    // Build PYTHONPATH: nous-py + nous-py/scripts + nous-sdk/src
    let sdk_src = nous_py_dir.parent()
        .map(|p| p.join("nous-sdk/src"))
        .unwrap_or_else(|| std::path::PathBuf::from("nous-sdk/src"));
    let scripts_dir = nous_py_dir.join("scripts");
    let pythonpath = format!(
        "{}:{}:{}",
        nous_py_dir.display(),
        scripts_dir.display(),
        sdk_src.display(),
    );

    // Use the nous-py venv's Python directly (has all deps installed)
    let venv_python = nous_py_dir.join(".venv/bin/python");
    let python = if venv_python.exists() {
        venv_python
    } else {
        // Fallback to PYO3_PYTHON or system python
        std::env::var("PYO3_PYTHON")
            .map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("python3"))
    };

    let output = tokio::process::Command::new(&python)
        .args(&args)
        .env("PYTHONPATH", &pythonpath)
        .env("LD_LIBRARY_PATH", std::env::var("LD_LIBRARY_PATH").unwrap_or_default())
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

fn find_script(name: &str) -> Option<std::path::PathBuf> {
    // Check PYTHONPATH for nous-py location (set by systemd service / build-daemon.sh)
    if let Ok(pypath) = std::env::var("PYTHONPATH") {
        for path in pypath.split(':') {
            let p = std::path::PathBuf::from(path);
            // PYTHONPATH points to nous-py, scripts are in nous-py/scripts/
            let candidate = p.join(format!("scripts/{name}"));
            if candidate.exists() {
                return Some(candidate);
            }
            // Or PYTHONPATH might point to the parent
            let candidate2 = p.join(format!("../scripts/{name}"));
            if candidate2.exists() {
                return Some(candidate2);
            }
        }
    }

    // Check relative to current dir (dev mode)
    let candidates = [
        std::path::PathBuf::from(format!("nous-py/scripts/{name}")),
        std::path::PathBuf::from(format!("../nous-py/scripts/{name}")),
    ];
    for c in &candidates {
        if c.exists() {
            return Some(c.clone());
        }
    }

    // Check relative to the executable
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let from_exe = exe_dir.join(format!("../../nous-py/scripts/{name}"));
            if from_exe.exists() {
                return Some(from_exe);
            }
        }
    }

    None
}

// ===== Gallery =====

async fn serve_gallery(
    Path(notebook_id): Path<String>,
) -> impl IntoResponse {
    let html = include_str!("gallery.html")
        .replace("{{NOTEBOOK_ID}}", &notebook_id);
    Html(html)
}

async fn serve_finance(
    Path(notebook_id): Path<String>,
) -> impl IntoResponse {
    let html = include_str!("finance.html")
        .replace("{{NOTEBOOK_ID}}", &notebook_id);
    Html(html)
}

// ===== Image Cache =====

async fn serve_cached_image(
    State(state): State<AppState>,
    Path(hash): Path<String>,
    Query(query): Query<ImageCacheQuery>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    use axum::http::header;
    use sha2::{Sha256, Digest};

    // Verify hash matches URL (prevents abuse)
    let expected_hash = format!("{:x}", Sha256::digest(query.url.as_bytes()));
    if hash != expected_hash[..16] {
        return Err(api_err(StatusCode::BAD_REQUEST, "Hash mismatch"));
    }

    // Cache directory
    let cache_dir = state.library_path.join(".cache/images");
    let _ = std::fs::create_dir_all(&cache_dir);

    // Determine file extension from URL
    let ext = query.url.rsplit('.').next()
        .and_then(|e| {
            let e = e.split('?').next().unwrap_or(e).to_lowercase();
            match e.as_str() {
                "jpg" | "jpeg" | "png" | "webp" | "gif" => Some(e),
                _ => None,
            }
        })
        .unwrap_or_else(|| "jpg".to_string());

    let cache_path = cache_dir.join(format!("{}.{}", &expected_hash[..16], ext));

    // Serve from cache if exists
    if cache_path.exists() {
        let data = tokio::fs::read(&cache_path).await
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        let content_type = match ext.as_str() {
            "png" => "image/png",
            "webp" => "image/webp",
            "gif" => "image/gif",
            _ => "image/jpeg",
        };
        return Ok((
            StatusCode::OK,
            [(header::CONTENT_TYPE, content_type), (header::CACHE_CONTROL, "public, max-age=31536000")],
            data,
        ));
    }

    // Fetch from source
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (compatible; NousBot/1.0)")
        .build()
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resp = client.get(&query.url).send().await
        .map_err(|e| api_err(StatusCode::BAD_GATEWAY, format!("Failed to fetch image: {e}")))?;

    if !resp.status().is_success() {
        return Err(api_err(StatusCode::BAD_GATEWAY,
            format!("Source returned {}", resp.status())));
    }

    let content_type_str = resp.headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("image/jpeg");
    let ct: &'static str = match content_type_str {
        s if s.contains("png") => "image/png",
        s if s.contains("webp") => "image/webp",
        s if s.contains("gif") => "image/gif",
        _ => "image/jpeg",
    };

    let data = resp.bytes().await
        .map_err(|e| api_err(StatusCode::BAD_GATEWAY, format!("Failed to read image: {e}")))?;

    // Save to cache (fire-and-forget)
    let cache_path_clone = cache_path.clone();
    let data_clone = data.clone();
    tokio::spawn(async move {
        let _ = tokio::fs::write(&cache_path_clone, &data_clone).await;
    });

    Ok((
        StatusCode::OK,
        [(header::CONTENT_TYPE, ct), (header::CACHE_CONTROL, "public, max-age=31536000")],
        data.to_vec(),
    ))
}

// ===== Agile Results Daily Note =====

async fn agile_daily_note(
    State(state): State<AppState>,
    Path(notebook_id): Path<String>,
    Json(req): Json<AgileDailyRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ApiError>)> {
    let script_path = find_script("agile_daily.py")
        .ok_or_else(|| api_err(StatusCode::INTERNAL_SERVER_ERROR, "agile_daily.py not found"))?;

    // Resolve notebook name
    let nb_name = {
        let storage = state.storage.lock().unwrap();
        let notebooks = storage.list_notebooks()
            .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        notebooks.into_iter()
            .find(|n| n.id.to_string() == notebook_id)
            .map(|n| n.name)
            .ok_or_else(|| api_err(StatusCode::NOT_FOUND, "Notebook not found"))?
    };

    let date_arg = req.date.unwrap_or_else(|| "today".to_string());
    let command = if date_arg == "tomorrow" { "tomorrow" } else { "daily" };

    let mut args = vec![
        script_path.to_string_lossy().to_string(),
        command.to_string(),
        "--notebook".to_string(),
        nb_name,
        "--json".to_string(),
    ];
    if date_arg != "today" && date_arg != "tomorrow" {
        args.push("--date".to_string());
        args.push(date_arg);
    }

    let nous_py_dir = std::env::var("PYTHONPATH")
        .ok()
        .and_then(|p| p.split(':').next().map(|s| std::path::PathBuf::from(s)))
        .unwrap_or_else(|| std::path::PathBuf::from("nous-py"));

    let sdk_src = nous_py_dir.parent()
        .map(|p| p.join("nous-sdk/src"))
        .unwrap_or_else(|| std::path::PathBuf::from("nous-sdk/src"));
    let scripts_dir = nous_py_dir.join("scripts");
    let pythonpath = format!("{}:{}:{}", nous_py_dir.display(), scripts_dir.display(), sdk_src.display());

    let venv_python = nous_py_dir.join(".venv/bin/python");
    let python = if venv_python.exists() { venv_python } else {
        std::env::var("PYO3_PYTHON").map(std::path::PathBuf::from)
            .unwrap_or_else(|_| std::path::PathBuf::from("python3"))
    };

    let output = tokio::process::Command::new(&python)
        .args(&args)
        .env("PYTHONPATH", &pythonpath)
        .env("LD_LIBRARY_PATH", std::env::var("LD_LIBRARY_PATH").unwrap_or_default())
        .output()
        .await
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("Failed to run: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(api_err(StatusCode::INTERNAL_SERVER_ERROR, stderr.to_string()));
    }

    let result: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| api_err(StatusCode::INTERNAL_SERVER_ERROR, format!("Invalid output: {e}")))?;

    Ok((StatusCode::CREATED, Json(ApiResponse { data: result })))
}
