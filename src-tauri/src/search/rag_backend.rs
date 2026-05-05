//! Embedding-based search backend over an external embedding endpoint
//! (Ollama-shaped) and an external vector store (Qdrant-shaped).
//!
//! Wire-level concerns only. The user is expected to run their own
//! Ollama + Qdrant (or compatible) — see the daemon-config.toml docs.
//!
//! ## What this code commits to
//!
//! - **Embeddings**: POST `{endpoint}/api/embeddings` with body
//!   `{"model": <model>, "prompt": <text>}`, expecting back
//!   `{"embedding": [f32; D]}`. Ollama and other compatible servers
//!   speak this shape.
//! - **Vector store**: Qdrant HTTP. Uses `PUT /collections/{c}/points`
//!   for upserts and `POST /collections/{c}/points/search` for queries.
//!   Other stores would need a parallel adapter.
//! - **Collection bootstrap**: this code does NOT auto-create the
//!   Qdrant collection. Run `curl -X PUT http://localhost:6333/collections/<name>
//!   -H 'Content-Type: application/json' -d '{"vectors": {"size": <D>, "distance": "Cosine"}}'`
//!   once after picking your embedding model.
//!
//! ## What's deferred
//!
//! - Token-aware chunking. Hand-rolled word-count splitter for now.
//! - Hybrid rerank scoring beyond cosine on the candidate's first chunk
//!   embedding.
//! - Batching multiple chunks in a single embedding call.
//! - Auth (Bearer header is sent if `auth_token` is set; haven't tested
//!   against an authenticated remote).

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::RwLock;
use uuid::Uuid;

use super::backend::{BackendError, BackendResult, PageRef, SearchBackend, SearchHit};
use super::rag_config::RagConfig;

pub struct RagBackend {
    /// Snapshot of config at construction time + ability to swap when
    /// `/api/search/rag/configure` reloads. Reads in hot paths take a
    /// shared read lock; writes (config reload) take a write lock.
    config: Arc<RwLock<RagConfig>>,
    client: reqwest::Client,
}

impl RagBackend {
    pub fn new(config: Arc<RwLock<RagConfig>>) -> Self {
        // Lock briefly to copy the timeout out for the client builder.
        let timeout_ms = {
            let cfg = config.try_read();
            cfg.map(|c| c.request_timeout_ms).unwrap_or(5_000)
        };
        let client = reqwest::Client::builder()
            .timeout(Duration::from_millis(timeout_ms))
            .build()
            .expect("reqwest client build");
        Self { config, client }
    }

    /// Pull the current config snapshot. Returns NotConfigured if the
    /// master switch is off.
    async fn enabled_config(&self) -> BackendResult<RagConfig> {
        let cfg = self.config.read().await.clone();
        if !cfg.enabled {
            return Err(BackendError::NotConfigured);
        }
        Ok(cfg)
    }

    /// Embed a single text via the configured endpoint. Returns the
    /// raw vector. Errors map to `Unreachable` so the dispatcher can
    /// return 502.
    async fn embed(&self, cfg: &RagConfig, text: &str) -> BackendResult<Vec<f32>> {
        let url = format!("{}/api/embeddings", cfg.endpoint.trim_end_matches('/'));
        let mut req = self
            .client
            .post(&url)
            .json(&json!({"model": cfg.embedding_model, "prompt": text}));
        if !cfg.auth_token.is_empty() {
            req = req.bearer_auth(&cfg.auth_token);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| BackendError::Unreachable(format!("embedding POST: {e}")))?;
        if !resp.status().is_success() {
            return Err(BackendError::Unreachable(format!(
                "embedding endpoint returned {}: {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            )));
        }
        #[derive(Deserialize)]
        struct EmbedResponse {
            embedding: Vec<f32>,
        }
        let parsed: EmbedResponse = resp
            .json()
            .await
            .map_err(|e| BackendError::Backend(format!("embedding decode: {e}")))?;
        Ok(parsed.embedding)
    }

    /// Vector-store-specific upsert. Today: Qdrant.
    async fn upsert_chunks(
        &self,
        cfg: &RagConfig,
        page_id: Uuid,
        notebook_id: Uuid,
        title: &str,
        chunks: Vec<(usize, Vec<f32>, String)>,
    ) -> BackendResult<()> {
        if cfg.vector_store != "qdrant" {
            return Err(BackendError::Backend(format!(
                "vector_store '{}' not supported (only 'qdrant' today)",
                cfg.vector_store
            )));
        }
        let url = format!(
            "{}/collections/{}/points",
            cfg.vector_endpoint.trim_end_matches('/'),
            cfg.collection
        );
        // Qdrant point id must be UUID or unsigned int. Encode as a
        // UUID derived from (page_id, chunk_idx) so re-indexing the
        // same page replaces its chunks deterministically.
        #[derive(Serialize)]
        struct Point {
            id: String,
            vector: Vec<f32>,
            payload: serde_json::Value,
        }
        let points: Vec<Point> = chunks
            .into_iter()
            .map(|(idx, vec, text)| Point {
                id: chunk_point_id(page_id, idx).to_string(),
                vector: vec,
                payload: json!({
                    "page_id": page_id.to_string(),
                    "notebook_id": notebook_id.to_string(),
                    "title": title,
                    "chunk_idx": idx,
                    "text": text,
                }),
            })
            .collect();
        let mut req = self.client.put(&url).json(&json!({"points": points}));
        if !cfg.auth_token.is_empty() {
            req = req.bearer_auth(&cfg.auth_token);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| BackendError::Unreachable(format!("qdrant upsert: {e}")))?;
        if !resp.status().is_success() {
            return Err(BackendError::Unreachable(format!(
                "qdrant returned {}: {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            )));
        }
        Ok(())
    }
}

#[async_trait]
impl SearchBackend for RagBackend {
    async fn query(
        &self,
        q: &str,
        limit: usize,
        notebook_id: Option<Uuid>,
    ) -> BackendResult<Vec<SearchHit>> {
        let cfg = self.enabled_config().await?;
        let qvec = self.embed(&cfg, q).await?;

        let url = format!(
            "{}/collections/{}/points/search",
            cfg.vector_endpoint.trim_end_matches('/'),
            cfg.collection
        );
        let mut body = json!({
            "vector": qvec,
            "limit": limit,
            "with_payload": true,
        });
        if let Some(nb) = notebook_id {
            body["filter"] = json!({
                "must": [{"key": "notebook_id", "match": {"value": nb.to_string()}}]
            });
        }
        let mut req = self.client.post(&url).json(&body);
        if !cfg.auth_token.is_empty() {
            req = req.bearer_auth(&cfg.auth_token);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| BackendError::Unreachable(format!("qdrant search: {e}")))?;
        if !resp.status().is_success() {
            return Err(BackendError::Unreachable(format!(
                "qdrant search returned {}: {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            )));
        }

        // Qdrant search response: { "result": [ { "id": ..., "score": f, "payload": {...} } ], ... }
        #[derive(Deserialize)]
        struct QdrantResp {
            result: Vec<QdrantHit>,
        }
        #[derive(Deserialize)]
        struct QdrantHit {
            score: f32,
            payload: serde_json::Value,
        }
        let parsed: QdrantResp = resp
            .json()
            .await
            .map_err(|e| BackendError::Backend(format!("qdrant decode: {e}")))?;

        let hits = parsed
            .result
            .into_iter()
            .map(|h| {
                let p = &h.payload;
                let snippet = p
                    .get("text")
                    .and_then(|v| v.as_str())
                    .map(|s| {
                        // Trim long chunks for the UI snippet.
                        if s.len() > 200 { format!("{}…", &s[..200]) } else { s.to_string() }
                    })
                    .unwrap_or_default();
                SearchHit {
                    page_id: p.get("page_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    notebook_id: p.get("notebook_id").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    title: p.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                    snippet,
                    score: h.score,
                    page_type: "standard".to_string(),
                }
            })
            .collect();
        Ok(hits)
    }

    async fn index(&self, page: PageRef<'_>) -> BackendResult<()> {
        let cfg = self.enabled_config().await?;
        let chunks = chunk_text(&page.plain_text, cfg.chunk_size, cfg.chunk_overlap);
        if chunks.is_empty() {
            return Ok(());
        }
        // Embed each chunk serially. Batching would need a different
        // endpoint shape (Ollama's POST /api/embed plural variant).
        let mut to_upsert = Vec::with_capacity(chunks.len());
        for (idx, text) in chunks.into_iter().enumerate() {
            let vec = self.embed(&cfg, &text).await?;
            to_upsert.push((idx, vec, text));
        }
        self.upsert_chunks(&cfg, page.id, page.notebook_id, page.title, to_upsert)
            .await
    }

    async fn delete(&self, page_id: Uuid) -> BackendResult<()> {
        let cfg = self.enabled_config().await?;
        if cfg.vector_store != "qdrant" {
            return Err(BackendError::Backend(format!(
                "vector_store '{}' not supported (only 'qdrant' today)",
                cfg.vector_store
            )));
        }
        let url = format!(
            "{}/collections/{}/points/delete",
            cfg.vector_endpoint.trim_end_matches('/'),
            cfg.collection
        );
        // Delete by filter on page_id payload — handles all chunks for
        // this page in one request.
        let body = json!({
            "filter": {
                "must": [{"key": "page_id", "match": {"value": page_id.to_string()}}]
            }
        });
        let mut req = self.client.post(&url).json(&body);
        if !cfg.auth_token.is_empty() {
            req = req.bearer_auth(&cfg.auth_token);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| BackendError::Unreachable(format!("qdrant delete: {e}")))?;
        if !resp.status().is_success() {
            return Err(BackendError::Unreachable(format!(
                "qdrant delete returned {}: {}",
                resp.status(),
                resp.text().await.unwrap_or_default()
            )));
        }
        Ok(())
    }
}

/// Deterministic UUID for a (page_id, chunk_idx) pair so re-indexing
/// the same page over-writes prior chunks instead of accumulating.
/// UUIDv5 with a fixed namespace gives stable IDs across runs.
fn chunk_point_id(page_id: Uuid, chunk_idx: usize) -> Uuid {
    let name = format!("{}:{}", page_id, chunk_idx);
    Uuid::new_v5(&Uuid::NAMESPACE_OID, name.as_bytes())
}

/// Hand-rolled word-count chunker with overlap. Approximates token
/// counts (good enough for embedding models that use BPE — they tend
/// to have ~1.3 tokens per word for English text).
fn chunk_text(text: &str, chunk_size_tokens: usize, overlap_tokens: usize) -> Vec<String> {
    // Treat the configured token size as a rough word budget — the
    // factor below converts tokens → words approximately.
    let words_per_chunk = (chunk_size_tokens as f32 / 1.3).max(50.0) as usize;
    let overlap_words = (overlap_tokens as f32 / 1.3).max(0.0) as usize;

    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return Vec::new();
    }
    if words.len() <= words_per_chunk {
        return vec![words.join(" ")];
    }

    let mut chunks = Vec::new();
    let stride = words_per_chunk.saturating_sub(overlap_words).max(1);
    let mut start = 0;
    while start < words.len() {
        let end = (start + words_per_chunk).min(words.len());
        chunks.push(words[start..end].join(" "));
        if end == words.len() {
            break;
        }
        start += stride;
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chunk_short_text_returns_one_chunk() {
        let chunks = chunk_text("hello world", 512, 64);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], "hello world");
    }

    #[test]
    fn chunk_empty_returns_nothing() {
        assert!(chunk_text("", 512, 64).is_empty());
        assert!(chunk_text("   ", 512, 64).is_empty());
    }

    #[test]
    fn chunk_long_text_splits_with_overlap() {
        let words: Vec<String> = (0..1000).map(|i| format!("w{i}")).collect();
        let text = words.join(" ");
        let chunks = chunk_text(&text, 100, 10);
        assert!(chunks.len() > 1);
        // Adjacent chunks should share at least a few words (the overlap).
        let first_words: Vec<&str> = chunks[0].split_whitespace().collect();
        let second_words: Vec<&str> = chunks[1].split_whitespace().collect();
        let overlap: Vec<&&str> = first_words
            .iter()
            .filter(|w| second_words.contains(w))
            .collect();
        assert!(!overlap.is_empty(), "expected overlap between chunks");
    }

    #[test]
    fn chunk_point_id_is_deterministic() {
        let pg = Uuid::new_v4();
        assert_eq!(chunk_point_id(pg, 0), chunk_point_id(pg, 0));
        assert_ne!(chunk_point_id(pg, 0), chunk_point_id(pg, 1));
    }

    #[tokio::test]
    async fn disabled_config_returns_not_configured() {
        let cfg = Arc::new(RwLock::new(RagConfig::disabled()));
        let rag = RagBackend::new(cfg);
        let result = rag.query("anything", 10, None).await;
        assert!(matches!(result, Err(BackendError::NotConfigured)));
    }

    #[tokio::test]
    async fn enabled_with_unreachable_endpoint_returns_unreachable() {
        let mut cfg = RagConfig::disabled();
        cfg.enabled = true;
        // Port 1 is reserved + unbound on every Linux box.
        cfg.endpoint = "http://127.0.0.1:1".to_string();
        cfg.vector_endpoint = "http://127.0.0.1:1".to_string();
        cfg.request_timeout_ms = 200;
        let rag = RagBackend::new(Arc::new(RwLock::new(cfg)));
        let result = rag.query("x", 10, None).await;
        assert!(
            matches!(result, Err(BackendError::Unreachable(_))),
            "got: {:?}", result
        );
    }
}
