//! Pluggable backend interface for `/api/search`.
//!
//! Two concrete backends ship with the daemon:
//! - [`super::TantivyBackend`] wraps the existing [`super::SearchIndex`]
//!   for fast in-process keyword retrieval.
//! - [`super::RagBackend`] talks HTTP to a configurable embedding endpoint
//!   (Ollama-shaped) and a configurable vector store (Qdrant-shaped) for
//!   semantic retrieval.
//!
//! `/api/search?mode=hybrid` composes both: Tantivy supplies candidates
//! and the RAG backend reranks them by embedding cosine similarity.
//!
//! Why a trait at all? The daemon stays useful in three configurations:
//! 1. Keyword-only (default — no external services required).
//! 2. Local RAG (user runs Ollama + Qdrant locally).
//! 3. Hosted RAG (user points at a remote embedding/vector service).
//! The dispatcher in `bin/cli/api.rs` only sees `dyn SearchBackend`.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

/// One result row. Field shapes match the existing `SearchResult` so the
/// frontend Zod schema (`pageId`, `notebookId`, `title`, `snippet`,
/// `score`, `pageType`) keeps validating.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub page_id: String,
    pub notebook_id: String,
    pub title: String,
    pub snippet: String,
    pub score: f32,
    pub page_type: String,
}

/// Search mode requested by the client. Selected via `?mode=...`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SearchMode {
    /// Pure Tantivy keyword search. Always available.
    Keyword,
    /// Pure RAG embedding-based retrieval. Requires `[search.rag] enabled = true`.
    Semantic,
    /// Tantivy candidates reranked by RAG embedding similarity.
    /// Requires RAG enabled. Falls back to keyword if RAG fails (so a
    /// flaky embedding service doesn't tank the search bar entirely).
    Hybrid,
}

impl Default for SearchMode {
    fn default() -> Self {
        Self::Keyword
    }
}

/// Errors a backend can return. Mapped to HTTP codes by the dispatcher:
/// - `NotConfigured` → 400 (the user hasn't enabled RAG)
/// - `Unreachable` → 502 (the RAG service is down)
/// - `Backend` → 500 (everything else)
#[derive(Debug, Error)]
pub enum BackendError {
    #[error("RAG is not configured. POST /api/search/rag/configure to enable it.")]
    NotConfigured,

    #[error("RAG service unreachable: {0}")]
    Unreachable(String),

    #[error("Backend error: {0}")]
    Backend(String),
}

pub type BackendResult<T> = Result<T, BackendError>;

/// Page metadata the RAG backend uses to compose `SearchHit`s after the
/// vector store returns just `(page_id, score)`. Decoupled from
/// `nous_lib::storage::Page` so backends don't need the full struct.
#[derive(Debug, Clone)]
pub struct PageRef<'a> {
    pub id: Uuid,
    pub notebook_id: Uuid,
    pub title: &'a str,
    pub tags: &'a [String],
    pub page_type: &'a str,
    /// Plain-text content for chunking. The daemon supplies this from
    /// the page's blocks (Editor.js) or its file content (Markdown,
    /// Jupyter, etc.) — backends don't need to know which.
    pub plain_text: String,
}

#[async_trait]
pub trait SearchBackend: Send + Sync {
    /// Query the backend. Returns up to `limit` hits; may return fewer.
    /// `notebook_id` filter is optional — `None` means "all notebooks".
    async fn query(
        &self,
        q: &str,
        limit: usize,
        notebook_id: Option<Uuid>,
    ) -> BackendResult<Vec<SearchHit>>;

    /// Index a page. Idempotent — replaces any prior entry for `page.id`.
    /// Returns `Ok(())` if the page was indexed (or if the backend
    /// elected to skip it; e.g. archived pages).
    async fn index(&self, page: PageRef<'_>) -> BackendResult<()>;

    /// Delete a page from the index.
    async fn delete(&self, page_id: Uuid) -> BackendResult<()>;
}
