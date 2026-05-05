//! On-disk + in-memory configuration for the daemon's RAG backend.
//!
//! Lives at `{data_dir}/daemon-config.toml` next to `daemon-api-key`.
//! Missing file → `RagConfig::disabled()` and the daemon runs as a
//! pure keyword-search service. The config is reload-able via the
//! `POST /api/search/rag/configure` endpoint.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Top-level config file shape. Currently only `[search.rag]` is in
/// use; nesting under `search` leaves room for future search-related
/// settings (analyzer overrides, fuzzy distance, etc.).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DaemonConfig {
    #[serde(default)]
    pub search: SearchSection,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchSection {
    #[serde(default)]
    pub rag: RagConfig,
}

impl SearchSection {
    pub fn new(rag: RagConfig) -> Self {
        Self { rag }
    }
}

/// `[search.rag]` table. All fields optional in the file — defaults
/// produce a disabled config.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RagConfig {
    /// Master switch. False → semantic/hybrid search returns 400
    /// "RAG is not configured".
    #[serde(default)]
    pub enabled: bool,

    /// Embedding endpoint. Ollama-shaped: POST {endpoint}/api/embeddings
    /// with `{"model": <embedding_model>, "prompt": <text>}` returning
    /// `{"embedding": [f32; D]}`.
    #[serde(default = "default_embedding_endpoint")]
    pub endpoint: String,

    /// Embedding model name passed to the embedding endpoint.
    #[serde(default = "default_embedding_model")]
    pub embedding_model: String,

    /// Vector store kind. Currently only "qdrant" is wired; "chroma"
    /// or others would need a separate adapter.
    #[serde(default = "default_vector_store")]
    pub vector_store: String,

    /// Vector store HTTP endpoint (e.g. http://localhost:6333 for Qdrant).
    #[serde(default = "default_vector_endpoint")]
    pub vector_endpoint: String,

    /// Collection (Qdrant) / class (Chroma) name.
    #[serde(default = "default_collection")]
    pub collection: String,

    /// Optional Bearer token sent on both endpoints. Empty = no auth.
    #[serde(default)]
    pub auth_token: String,

    /// Approximate token budget per chunk. Hand-rolled word-count
    /// chunker — accurate enough for most embedding models.
    #[serde(default = "default_chunk_size")]
    pub chunk_size: usize,

    /// Token overlap between adjacent chunks (preserves boundary context).
    #[serde(default = "default_chunk_overlap")]
    pub chunk_overlap: usize,

    /// In hybrid mode, how many Tantivy candidates to fetch before
    /// reranking with embeddings. Higher = better recall, slower.
    #[serde(default = "default_rerank_candidates")]
    pub rerank_candidates: usize,

    /// HTTP timeout for embedding + vector store calls.
    #[serde(default = "default_request_timeout")]
    pub request_timeout_ms: u64,
}

impl Default for RagConfig {
    fn default() -> Self {
        Self::disabled()
    }
}

impl RagConfig {
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            endpoint: default_embedding_endpoint(),
            embedding_model: default_embedding_model(),
            vector_store: default_vector_store(),
            vector_endpoint: default_vector_endpoint(),
            collection: default_collection(),
            auth_token: String::new(),
            chunk_size: default_chunk_size(),
            chunk_overlap: default_chunk_overlap(),
            rerank_candidates: default_rerank_candidates(),
            request_timeout_ms: default_request_timeout(),
        }
    }

    /// Strip secrets before echoing back to API callers. The auth
    /// token is the only sensitive field today; redact it.
    pub fn sanitized(&self) -> Self {
        let mut out = self.clone();
        if !out.auth_token.is_empty() {
            out.auth_token = "***".to_string();
        }
        out
    }
}

fn default_embedding_endpoint() -> String {
    "http://localhost:11434".to_string()
}
fn default_embedding_model() -> String {
    "nomic-embed-text".to_string()
}
fn default_vector_store() -> String {
    "qdrant".to_string()
}
fn default_vector_endpoint() -> String {
    "http://localhost:6333".to_string()
}
fn default_collection() -> String {
    "nous-pages".to_string()
}
fn default_chunk_size() -> usize {
    512
}
fn default_chunk_overlap() -> usize {
    64
}
fn default_rerank_candidates() -> usize {
    50
}
fn default_request_timeout() -> u64 {
    5_000
}

/// Return the on-disk path for the daemon config, given a data dir.
pub fn config_path(data_dir: &Path) -> PathBuf {
    data_dir.join("daemon-config.toml")
}

/// Load config from disk. Missing file or parse error → log a warning
/// and fall back to disabled. Never fails — a bad config should not
/// prevent the daemon from starting.
pub fn load_or_default(path: &Path) -> DaemonConfig {
    if !path.exists() {
        return DaemonConfig::default();
    }
    match std::fs::read_to_string(path) {
        Ok(content) => match toml::from_str::<DaemonConfig>(&content) {
            Ok(cfg) => cfg,
            Err(e) => {
                log::warn!(
                    "Failed to parse {}: {} — running with RAG disabled",
                    path.display(),
                    e
                );
                DaemonConfig::default()
            }
        },
        Err(e) => {
            log::warn!(
                "Failed to read {}: {} — running with RAG disabled",
                path.display(),
                e
            );
            DaemonConfig::default()
        }
    }
}

/// Persist config to disk with secure permissions.
pub fn save(path: &Path, cfg: &DaemonConfig) -> std::io::Result<()> {
    let toml_str = toml::to_string_pretty(cfg)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidInput, e))?;
    std::fs::write(path, toml_str)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_yields_disabled() {
        let cfg = load_or_default(Path::new("/nonexistent/path"));
        assert!(!cfg.search.rag.enabled);
    }

    #[test]
    fn parses_minimal_enabled_config() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("daemon-config.toml");
        std::fs::write(
            &path,
            r#"
                [search.rag]
                enabled = true
                endpoint = "http://localhost:9999"
                vector_endpoint = "http://localhost:6334"
            "#,
        )
        .unwrap();
        let cfg = load_or_default(&path);
        assert!(cfg.search.rag.enabled);
        assert_eq!(cfg.search.rag.endpoint, "http://localhost:9999");
        assert_eq!(cfg.search.rag.vector_endpoint, "http://localhost:6334");
        // Defaults filled in for omitted fields.
        assert_eq!(cfg.search.rag.embedding_model, "nomic-embed-text");
        assert_eq!(cfg.search.rag.collection, "nous-pages");
    }

    #[test]
    fn save_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("daemon-config.toml");
        let mut cfg = DaemonConfig::default();
        cfg.search.rag.enabled = true;
        cfg.search.rag.collection = "my-pages".to_string();
        save(&path, &cfg).unwrap();
        let loaded = load_or_default(&path);
        assert!(loaded.search.rag.enabled);
        assert_eq!(loaded.search.rag.collection, "my-pages");
    }

    #[test]
    fn sanitized_redacts_token() {
        let mut cfg = RagConfig::disabled();
        cfg.auth_token = "secret-bearer-xyz".to_string();
        assert_eq!(cfg.sanitized().auth_token, "***");
        // Original unchanged.
        assert_eq!(cfg.auth_token, "secret-bearer-xyz");
    }

    #[test]
    fn malformed_file_falls_back_to_default() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("daemon-config.toml");
        std::fs::write(&path, "not valid toml = = =").unwrap();
        let cfg = load_or_default(&path);
        assert!(!cfg.search.rag.enabled);
    }
}
