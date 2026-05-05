mod backend;
mod index;
mod rag_backend;
mod rag_config;
mod tantivy_backend;

pub use backend::{BackendError, BackendResult, PageRef, SearchBackend, SearchHit, SearchMode};
pub use index::{ReadOnlySearchIndex, SearchIndex, SearchResult};
pub use rag_backend::RagBackend;
pub use rag_config::{
    config_path, load_or_default, save, DaemonConfig, RagConfig, SearchSection,
};
pub use tantivy_backend::TantivyBackend;
