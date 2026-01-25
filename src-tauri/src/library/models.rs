//! Library data models
//!
//! A Library represents a collection of notebooks stored at a specific path.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

/// A library is a collection of notebooks stored at a specific path
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Library {
    /// Unique identifier
    pub id: Uuid,

    /// Display name
    pub name: String,

    /// Root path for this library's data
    /// Contains: notebooks/, search_index/, sync_queue.json
    pub path: PathBuf,

    /// Whether this is the default library (cannot be deleted)
    #[serde(default)]
    pub is_default: bool,

    /// Optional emoji icon
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,

    /// Optional hex color
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,

    /// Creation timestamp
    pub created_at: DateTime<Utc>,

    /// Last update timestamp
    pub updated_at: DateTime<Utc>,
}

impl Library {
    /// Create a new library with the given name and path
    pub fn new(name: String, path: PathBuf) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            path,
            is_default: false,
            icon: None,
            color: None,
            created_at: now,
            updated_at: now,
        }
    }

    /// Create the default library at the given base path
    pub fn default_library(base_path: PathBuf) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name: "Default Library".to_string(),
            path: base_path,
            is_default: true,
            icon: Some("📚".to_string()),
            color: None,
            created_at: now,
            updated_at: now,
        }
    }

    /// Get the notebooks directory for this library
    pub fn notebooks_path(&self) -> PathBuf {
        self.path.join("notebooks")
    }

    /// Get the search index directory for this library
    pub fn search_index_path(&self) -> PathBuf {
        self.path.join("search_index")
    }

    /// Get the sync queue file path for this library
    pub fn sync_queue_path(&self) -> PathBuf {
        self.path.join("sync_queue.json")
    }
}

/// Statistics about a library
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    /// Library ID
    pub library_id: Uuid,

    /// Number of notebooks
    pub notebook_count: usize,

    /// Number of archived notebooks
    pub archived_notebook_count: usize,

    /// Total number of pages across all notebooks
    pub page_count: usize,

    /// Total number of assets/attachments
    pub asset_count: usize,

    /// Total size in bytes (approximate)
    pub total_size_bytes: u64,

    /// Last modified timestamp
    pub last_modified: Option<DateTime<Utc>>,
}
