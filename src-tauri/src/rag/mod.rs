//! RAG (Retrieval-Augmented Generation) module for semantic search and AI context.

mod chunker;
mod index;
mod models;

pub use chunker::{chunk_page, chunk_page_with_text};
pub use index::VectorIndex;
pub use models::{EmbeddingConfig, SemanticSearchResult};
