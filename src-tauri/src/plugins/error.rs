//! Plugin system error types

use thiserror::Error;

/// Errors that can occur in the plugin system
#[derive(Debug, Error)]
pub enum PluginError {
    #[error("Plugin not found: {0}")]
    NotFound(String),

    #[error("Plugin load failed: {0}")]
    LoadFailed(String),

    #[error("Plugin init failed: {0}")]
    InitFailed(String),

    #[error("Plugin call failed: {0}")]
    CallFailed(String),

    #[error("Manifest parse error: {0}")]
    ManifestParse(String),

    #[error("Capability denied: plugin '{plugin_id}' lacks {capability}")]
    CapabilityDenied {
        plugin_id: String,
        capability: String,
    },

    #[error("Runtime error: {0}")]
    Runtime(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}
