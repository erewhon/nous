//! Vector index for semantic search using SQLite with vec0 extension.

use std::collections::HashMap;
use std::path::PathBuf;

use rusqlite::{params, Connection};
use serde_json;
use thiserror::Error;
use uuid::Uuid;

use super::models::{Chunk, EmbeddingConfig, SemanticSearchResult};

#[derive(Error, Debug)]
pub enum VectorIndexError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Index not configured: {0}")]
    NotConfigured(String),

    #[error("Dimension mismatch: expected {expected}, got {actual}")]
    DimensionMismatch { expected: u32, actual: u32 },
}

pub type Result<T> = std::result::Result<T, VectorIndexError>;

/// Vector index for semantic search.
///
/// Uses SQLite with a custom virtual table for vector similarity search.
/// When sqlite-vec is not available, falls back to brute-force search.
pub struct VectorIndex {
    conn: Connection,
    config: Option<EmbeddingConfig>,
    db_path: PathBuf,
}

impl VectorIndex {
    /// Create a new vector index at the given path.
    pub fn new(db_path: PathBuf) -> Result<Self> {
        // Ensure parent directory exists
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(&db_path)?;

        // Create tables
        conn.execute_batch(
            r#"
            -- Store chunks with their text content
            CREATE TABLE IF NOT EXISTS chunks (
                id TEXT PRIMARY KEY,
                page_id TEXT NOT NULL,
                notebook_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                metadata TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Store embeddings as serialized JSON arrays
            -- This is a fallback when sqlite-vec is not available
            CREATE TABLE IF NOT EXISTS embeddings (
                chunk_id TEXT PRIMARY KEY,
                embedding BLOB NOT NULL,
                dimensions INTEGER NOT NULL,
                FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
            );

            -- Store page titles for search results
            CREATE TABLE IF NOT EXISTS page_titles (
                page_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                updated_at TEXT DEFAULT CURRENT_TIMESTAMP
            );

            -- Store embedding configuration
            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            -- Indexes for efficient queries
            CREATE INDEX IF NOT EXISTS idx_chunks_page_id ON chunks(page_id);
            CREATE INDEX IF NOT EXISTS idx_chunks_notebook_id ON chunks(notebook_id);
            CREATE INDEX IF NOT EXISTS idx_embeddings_chunk_id ON embeddings(chunk_id);
            "#,
        )?;

        // Load config if exists
        let config: Option<EmbeddingConfig> = conn
            .query_row(
                "SELECT value FROM config WHERE key = 'embedding_config'",
                [],
                |row| row.get::<_, String>(0),
            )
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok());

        Ok(Self {
            conn,
            config,
            db_path,
        })
    }

    /// Configure the embedding model to use.
    pub fn configure(&mut self, config: EmbeddingConfig) -> Result<()> {
        let config_json = serde_json::to_string(&config)?;

        self.conn.execute(
            "INSERT OR REPLACE INTO config (key, value) VALUES ('embedding_config', ?1)",
            params![config_json],
        )?;

        self.config = Some(config);
        Ok(())
    }

    /// Get the current embedding configuration.
    pub fn get_config(&self) -> Option<&EmbeddingConfig> {
        self.config.as_ref()
    }

    /// Check if the index is configured.
    pub fn is_configured(&self) -> bool {
        self.config.is_some()
    }

    /// Index a page with pre-computed chunks and embeddings.
    pub fn index_page(
        &mut self,
        page_id: Uuid,
        title: &str,
        chunks: &[Chunk],
        embeddings: &[Vec<f32>],
    ) -> Result<()> {
        if chunks.len() != embeddings.len() {
            return Err(VectorIndexError::NotConfigured(format!(
                "Chunk count ({}) doesn't match embedding count ({})",
                chunks.len(),
                embeddings.len()
            )));
        }

        // Verify embedding dimensions match config
        if let Some(config) = &self.config {
            for (i, emb) in embeddings.iter().enumerate() {
                if emb.len() as u32 != config.dimensions {
                    return Err(VectorIndexError::DimensionMismatch {
                        expected: config.dimensions,
                        actual: emb.len() as u32,
                    });
                }
            }
        }

        // Start transaction
        let tx = self.conn.transaction()?;

        // Remove existing chunks and embeddings for this page
        tx.execute(
            "DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE page_id = ?1)",
            params![page_id.to_string()],
        )?;
        tx.execute(
            "DELETE FROM chunks WHERE page_id = ?1",
            params![page_id.to_string()],
        )?;

        // Update page title
        tx.execute(
            "INSERT OR REPLACE INTO page_titles (page_id, title, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)",
            params![page_id.to_string(), title],
        )?;

        // Insert chunks and embeddings
        for (chunk, embedding) in chunks.iter().zip(embeddings.iter()) {
            let metadata_json = chunk
                .metadata
                .as_ref()
                .map(|m| serde_json::to_string(m))
                .transpose()?;

            tx.execute(
                "INSERT INTO chunks (id, page_id, notebook_id, chunk_index, content, metadata) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    chunk.id.to_string(),
                    chunk.page_id.to_string(),
                    chunk.notebook_id.to_string(),
                    chunk.chunk_index,
                    chunk.content,
                    metadata_json,
                ],
            )?;

            // Store embedding as binary blob (f32 little-endian)
            let embedding_bytes: Vec<u8> = embedding
                .iter()
                .flat_map(|f| f.to_le_bytes())
                .collect();

            tx.execute(
                "INSERT INTO embeddings (chunk_id, embedding, dimensions) VALUES (?1, ?2, ?3)",
                params![
                    chunk.id.to_string(),
                    embedding_bytes,
                    embedding.len() as i32,
                ],
            )?;
        }

        tx.commit()?;
        Ok(())
    }

    /// Remove a page from the index.
    pub fn remove_page(&mut self, page_id: Uuid) -> Result<()> {
        let tx = self.conn.transaction()?;

        tx.execute(
            "DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE page_id = ?1)",
            params![page_id.to_string()],
        )?;
        tx.execute(
            "DELETE FROM chunks WHERE page_id = ?1",
            params![page_id.to_string()],
        )?;
        tx.execute(
            "DELETE FROM page_titles WHERE page_id = ?1",
            params![page_id.to_string()],
        )?;

        tx.commit()?;
        Ok(())
    }

    /// Search for similar chunks using a query embedding.
    pub fn search(
        &self,
        query_embedding: &[f32],
        limit: usize,
        notebook_id: Option<Uuid>,
    ) -> Result<Vec<SemanticSearchResult>> {
        // Brute-force cosine similarity search
        // In production, this should use sqlite-vec or a more efficient index

        let mut results: Vec<SemanticSearchResult> = Vec::new();

        // Build query based on notebook filter
        let sql = if notebook_id.is_some() {
            r#"
            SELECT c.id, c.page_id, c.notebook_id, c.content, e.embedding, p.title
            FROM chunks c
            JOIN embeddings e ON c.id = e.chunk_id
            LEFT JOIN page_titles p ON c.page_id = p.page_id
            WHERE c.notebook_id = ?1
            "#
        } else {
            r#"
            SELECT c.id, c.page_id, c.notebook_id, c.content, e.embedding, p.title
            FROM chunks c
            JOIN embeddings e ON c.id = e.chunk_id
            LEFT JOIN page_titles p ON c.page_id = p.page_id
            "#
        };

        let mut stmt = self.conn.prepare(sql)?;

        // Collect all rows first to avoid lifetime issues
        let row_mapper = |row: &rusqlite::Row| -> rusqlite::Result<(String, String, String, String, Vec<u8>, Option<String>)> {
            Ok((
                row.get::<_, String>(0)?, // chunk_id
                row.get::<_, String>(1)?, // page_id
                row.get::<_, String>(2)?, // notebook_id
                row.get::<_, String>(3)?, // content
                row.get::<_, Vec<u8>>(4)?, // embedding
                row.get::<_, Option<String>>(5)?, // title
            ))
        };

        let collected_rows: Vec<_> = if let Some(nb_id) = notebook_id {
            stmt.query_map(params![nb_id.to_string()], row_mapper)?
                .collect::<rusqlite::Result<Vec<_>>>()?
        } else {
            stmt.query_map([], row_mapper)?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };

        let mut scored_results: Vec<(f32, SemanticSearchResult)> = Vec::new();

        for (chunk_id, page_id, notebook_id, content, embedding_bytes, title) in collected_rows {

            // Deserialize embedding
            let embedding = deserialize_embedding(&embedding_bytes);

            // Calculate cosine similarity
            let score = cosine_similarity(query_embedding, &embedding);

            scored_results.push((
                score,
                SemanticSearchResult {
                    chunk_id,
                    page_id,
                    notebook_id,
                    title: title.unwrap_or_default(),
                    content,
                    score,
                },
            ));
        }

        // Sort by score descending
        scored_results.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

        // Take top results
        results.extend(scored_results.into_iter().take(limit).map(|(_, r)| r));

        Ok(results)
    }

    /// Rebuild the index (clear and prepare for re-indexing).
    pub fn rebuild(&mut self) -> Result<()> {
        let tx = self.conn.transaction()?;

        tx.execute("DELETE FROM embeddings", [])?;
        tx.execute("DELETE FROM chunks", [])?;
        tx.execute("DELETE FROM page_titles", [])?;

        tx.commit()?;
        Ok(())
    }

    /// Get statistics about the index.
    pub fn stats(&self) -> Result<IndexStats> {
        let chunk_count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM chunks", [], |row| row.get(0))?;

        let page_count: i64 = self.conn.query_row(
            "SELECT COUNT(DISTINCT page_id) FROM chunks",
            [],
            |row| row.get(0),
        )?;

        let notebook_count: i64 = self.conn.query_row(
            "SELECT COUNT(DISTINCT notebook_id) FROM chunks",
            [],
            |row| row.get(0),
        )?;

        Ok(IndexStats {
            chunk_count: chunk_count as u64,
            page_count: page_count as u64,
            notebook_count: notebook_count as u64,
            dimensions: self.config.as_ref().map(|c| c.dimensions).unwrap_or(0),
        })
    }

    /// Get the database path.
    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }
}

/// Statistics about the vector index.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexStats {
    pub chunk_count: u64,
    pub page_count: u64,
    pub notebook_count: u64,
    pub dimensions: u32,
}

/// Deserialize embedding from binary blob.
fn deserialize_embedding(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// Calculate cosine similarity between two vectors.
fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot_product = 0.0;
    let mut norm_a = 0.0;
    let mut norm_b = 0.0;

    for (x, y) in a.iter().zip(b.iter()) {
        dot_product += x * y;
        norm_a += x * x;
        norm_b += y * y;
    }

    let denominator = (norm_a * norm_b).sqrt();
    if denominator == 0.0 {
        return 0.0;
    }

    dot_product / denominator
}

/// Reciprocal Rank Fusion for combining search results.
pub fn reciprocal_rank_fusion(
    results_lists: &[&[SemanticSearchResult]],
    k: f32,
) -> HashMap<String, f32> {
    let mut scores: HashMap<String, f32> = HashMap::new();

    for results in results_lists {
        for (rank, result) in results.iter().enumerate() {
            let rrf_score = 1.0 / (k + rank as f32 + 1.0);
            *scores.entry(result.page_id.clone()).or_default() += rrf_score;
        }
    }

    scores
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![1.0, 0.0, 0.0];
        assert!((cosine_similarity(&a, &b) - 1.0).abs() < 0.001);

        let c = vec![0.0, 1.0, 0.0];
        assert!((cosine_similarity(&a, &c)).abs() < 0.001);

        let d = vec![-1.0, 0.0, 0.0];
        assert!((cosine_similarity(&a, &d) + 1.0).abs() < 0.001);
    }

    #[test]
    fn test_deserialize_embedding() {
        let values = vec![1.0f32, 2.0, 3.0];
        let bytes: Vec<u8> = values.iter().flat_map(|f| f.to_le_bytes()).collect();
        let result = deserialize_embedding(&bytes);
        assert_eq!(result, values);
    }
}
