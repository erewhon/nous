//! `SearchBackend` adapter over the existing in-process Tantivy index.
//!
//! Tantivy is sync; the trait is async. Bridge with
//! `tokio::task::spawn_blocking` so query/index work doesn't pin the
//! tokio runtime thread holding the Mutex.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use uuid::Uuid;

use super::backend::{BackendError, BackendResult, PageRef, SearchBackend, SearchHit};
use super::index::SearchIndex;
use crate::storage::Page;

pub struct TantivyBackend {
    index: Arc<Mutex<SearchIndex>>,
}

impl TantivyBackend {
    pub fn new(index: Arc<Mutex<SearchIndex>>) -> Self {
        Self { index }
    }

    fn to_page(page: &PageRef<'_>) -> Page {
        // Tantivy's existing index_page takes a full Page. We mostly need
        // id/notebook_id/title/tags/page_type — recreate a stub from the
        // PageRef. Content is intentionally empty here; callers that want
        // body-text in the keyword index should use index_page directly
        // via the daemon's update_page handler (which still has the full
        // page in scope). The fire-and-forget RAG indexing path doesn't
        // need to reach into Tantivy — that's a separate write.
        Page {
            id: page.id,
            notebook_id: page.notebook_id,
            title: page.title.to_string(),
            content: Default::default(),
            tags: page.tags.to_vec(),
            folder_id: None,
            parent_page_id: None,
            section_id: None,
            is_archived: false,
            is_cover: false,
            position: 0,
            system_prompt: None,
            system_prompt_mode: Default::default(),
            ai_model: None,
            page_type: serde_json::from_value(serde_json::json!(page.page_type))
                .unwrap_or_default(),
            source_file: None,
            storage_mode: None,
            file_extension: None,
            last_file_sync: None,
            deleted_at: None,
            template_id: None,
            color: None,
            is_favorite: false,
            is_daily_note: false,
            daily_note_date: None,
            plugin_page_type: None,
            plugin_data: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
        }
    }
}

#[async_trait]
impl SearchBackend for TantivyBackend {
    async fn query(
        &self,
        q: &str,
        limit: usize,
        notebook_id: Option<Uuid>,
    ) -> BackendResult<Vec<SearchHit>> {
        let index = Arc::clone(&self.index);
        let q = q.to_string();

        // If notebook_id is set, over-fetch by 4× and filter post-query
        // — Tantivy's schema doesn't index notebook_id for filtering.
        let fetch_limit = if notebook_id.is_some() {
            limit.saturating_mul(4).max(limit)
        } else {
            limit
        };

        let results = tokio::task::spawn_blocking(move || {
            let idx = index
                .lock()
                .map_err(|e| BackendError::Backend(format!("search lock: {e}")))?;
            idx.search(&q, fetch_limit)
                .map_err(|e| BackendError::Backend(e.to_string()))
        })
        .await
        .map_err(|e| BackendError::Backend(format!("join error: {e}")))??;

        let want = notebook_id.map(|u| u.to_string());
        let hits = results
            .into_iter()
            .filter(|r| match &want {
                Some(target) => &r.notebook_id == target,
                None => true,
            })
            .take(limit)
            .map(|r| SearchHit {
                page_id: r.page_id,
                notebook_id: r.notebook_id,
                title: r.title,
                snippet: r.snippet,
                score: r.score,
                page_type: r.page_type,
            })
            .collect();

        Ok(hits)
    }

    async fn index(&self, page: PageRef<'_>) -> BackendResult<()> {
        let stub = Self::to_page(&page);
        let index = Arc::clone(&self.index);
        tokio::task::spawn_blocking(move || {
            let mut idx = index
                .lock()
                .map_err(|e| BackendError::Backend(format!("search lock: {e}")))?;
            idx.index_page(&stub)
                .map_err(|e| BackendError::Backend(e.to_string()))
        })
        .await
        .map_err(|e| BackendError::Backend(format!("join error: {e}")))?
    }

    async fn delete(&self, page_id: Uuid) -> BackendResult<()> {
        let index = Arc::clone(&self.index);
        tokio::task::spawn_blocking(move || {
            let mut idx = index
                .lock()
                .map_err(|e| BackendError::Backend(format!("search lock: {e}")))?;
            idx.remove_page(page_id)
                .map_err(|e| BackendError::Backend(e.to_string()))
        })
        .await
        .map_err(|e| BackendError::Backend(format!("join error: {e}")))?
    }
}

/// Fuzzy variant — convenience for the autocomplete use case. Not on
/// the trait because only Tantivy supports it; semantic search is
/// already approximate by construction.
impl TantivyBackend {
    pub async fn fuzzy_query(
        &self,
        q: &str,
        limit: usize,
        notebook_id: Option<Uuid>,
    ) -> BackendResult<Vec<SearchHit>> {
        let index = Arc::clone(&self.index);
        let q = q.to_string();
        let fetch_limit = if notebook_id.is_some() {
            limit.saturating_mul(4).max(limit)
        } else {
            limit
        };

        let results = tokio::task::spawn_blocking(move || {
            let idx = index
                .lock()
                .map_err(|e| BackendError::Backend(format!("search lock: {e}")))?;
            idx.fuzzy_search(&q, fetch_limit)
                .map_err(|e| BackendError::Backend(e.to_string()))
        })
        .await
        .map_err(|e| BackendError::Backend(format!("join error: {e}")))??;

        let want = notebook_id.map(|u| u.to_string());
        Ok(results
            .into_iter()
            .filter(|r| match &want {
                Some(target) => &r.notebook_id == target,
                None => true,
            })
            .take(limit)
            .map(|r| SearchHit {
                page_id: r.page_id,
                notebook_id: r.notebook_id,
                title: r.title,
                snippet: r.snippet,
                score: r.score,
                page_type: r.page_type,
            })
            .collect())
    }
}
