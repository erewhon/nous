//! Data models for RAG operations.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Metadata for a chunk, capturing its source context.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkMetadata {
    /// Block type(s) that contributed to this chunk (e.g., "paragraph", "header")
    pub block_types: Vec<String>,
    /// Start position in the original content
    pub start_offset: usize,
    /// End position in the original content
    pub end_offset: usize,
}

/// A chunk of content with its embedding-ready text.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    /// Unique identifier for this chunk
    pub id: Uuid,
    /// The page this chunk belongs to
    pub page_id: Uuid,
    /// The notebook this chunk belongs to
    pub notebook_id: Uuid,
    /// Index of this chunk within the page (for ordering)
    pub chunk_index: u32,
    /// The text content of the chunk
    pub content: String,
    /// Optional metadata about the chunk's source
    pub metadata: Option<ChunkMetadata>,
}

impl Chunk {
    /// Create a new chunk with a generated ID.
    pub fn new(
        page_id: Uuid,
        notebook_id: Uuid,
        chunk_index: u32,
        content: String,
        metadata: Option<ChunkMetadata>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            page_id,
            notebook_id,
            chunk_index,
            content,
            metadata,
        }
    }
}

/// Configuration for embedding generation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingConfig {
    /// Provider: "openai", "ollama", or "lmstudio"
    pub provider: String,
    /// Model identifier (e.g., "text-embedding-3-small")
    pub model: String,
    /// Dimensions of the embedding vectors
    pub dimensions: u32,
    /// Optional API key (for OpenAI)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    /// Optional base URL (for Ollama/LM Studio)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
}

impl Default for EmbeddingConfig {
    fn default() -> Self {
        Self {
            provider: "openai".to_string(),
            model: "text-embedding-3-small".to_string(),
            dimensions: 1536,
            api_key: None,
            base_url: None,
        }
    }
}

/// Result from a semantic search query.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SemanticSearchResult {
    /// The chunk ID that matched
    pub chunk_id: String,
    /// The page ID containing this chunk
    pub page_id: String,
    /// The notebook ID containing this page
    pub notebook_id: String,
    /// The page title
    pub title: String,
    /// The matched chunk content
    pub content: String,
    /// Similarity score (higher is more similar)
    pub score: f32,
}

/// Combined result for hybrid search (semantic + keyword).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HybridSearchResult {
    /// The page ID
    pub page_id: String,
    /// The notebook ID
    pub notebook_id: String,
    /// The page title
    pub title: String,
    /// Content snippet
    pub snippet: String,
    /// Combined relevance score
    pub score: f32,
    /// Semantic similarity score (if available)
    pub semantic_score: Option<f32>,
    /// Keyword search score (if available)
    pub keyword_score: Option<f32>,
    /// Page type
    pub page_type: String,
}
