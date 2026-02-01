use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::storage::{Notebook, NotebookType, SystemPromptMode};

/// Sync configuration for a notebook
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfig {
    /// Whether sync is enabled for this notebook
    pub enabled: bool,
    /// WebDAV server URL (e.g., "https://cloud.example.com/remote.php/dav/files/user/")
    pub server_url: String,
    /// Remote path within the WebDAV server
    pub remote_path: String,
    /// Authentication type
    pub auth_type: AuthType,
    /// Sync mode (manual, on-save, periodic)
    #[serde(default)]
    pub sync_mode: SyncMode,
    /// Sync interval in seconds (for periodic mode)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_interval: Option<u64>,
    /// Last successful sync timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync: Option<DateTime<Utc>>,
    /// Whether this sync config is managed by library-level sync
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub managed_by_library: Option<bool>,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            server_url: String::new(),
            remote_path: String::new(),
            auth_type: AuthType::Basic,
            sync_mode: SyncMode::Manual,
            sync_interval: None,
            last_sync: None,
            managed_by_library: None,
        }
    }
}

/// Authentication type for WebDAV
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AuthType {
    /// Basic authentication (username/password)
    Basic,
    /// OAuth2 token authentication
    OAuth2,
    /// App-specific password (e.g., Nextcloud app passwords)
    AppToken,
}

impl Default for AuthType {
    fn default() -> Self {
        Self::Basic
    }
}

/// Sync mode configuration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "lowercase")]
pub enum SyncMode {
    /// User-triggered sync only
    #[default]
    Manual,
    /// Sync after each page save
    OnSave,
    /// Sync at regular intervals
    Periodic,
}

/// Sync status for a notebook
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    /// Current sync state
    pub status: SyncState,
    /// Last successful sync timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync: Option<DateTime<Utc>>,
    /// Number of pending changes in the queue
    pub pending_changes: usize,
    /// Error message if status is Error
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Sync progress (0-100) if syncing
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u8>,
    /// Current operation description
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_operation: Option<String>,
}

impl Default for SyncStatus {
    fn default() -> Self {
        Self {
            status: SyncState::Disabled,
            last_sync: None,
            pending_changes: 0,
            error: None,
            progress: None,
            current_operation: None,
        }
    }
}

/// Current sync state
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SyncState {
    /// Sync is not configured
    Disabled,
    /// Ready to sync, no pending changes
    Idle,
    /// Currently syncing
    Syncing,
    /// Last sync succeeded
    Success,
    /// Last sync failed
    Error,
    /// There are unresolved conflicts
    Conflict,
    /// Device is offline
    Offline,
}

/// Result of a sync operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    /// Whether sync completed successfully
    pub success: bool,
    /// Number of pages pulled from remote
    pub pages_pulled: usize,
    /// Number of pages pushed to remote
    pub pages_pushed: usize,
    /// Number of conflicts resolved
    pub conflicts_resolved: usize,
    /// Error message if failed
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Duration of sync in milliseconds
    pub duration_ms: u64,
    /// Number of assets pushed to remote
    #[serde(default)]
    pub assets_pushed: usize,
    /// Number of assets pulled from remote
    #[serde(default)]
    pub assets_pulled: usize,
}

impl SyncResult {
    pub fn success(
        pages_pulled: usize,
        pages_pushed: usize,
        conflicts_resolved: usize,
        duration_ms: u64,
        assets_pushed: usize,
        assets_pulled: usize,
    ) -> Self {
        Self {
            success: true,
            pages_pulled,
            pages_pushed,
            conflicts_resolved,
            error: None,
            duration_ms,
            assets_pushed,
            assets_pulled,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            success: false,
            pages_pulled: 0,
            pages_pushed: 0,
            conflicts_resolved: 0,
            error: Some(message),
            duration_ms: 0,
            assets_pushed: 0,
            assets_pulled: 0,
        }
    }
}

/// Input for configuring sync on a notebook
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncConfigInput {
    pub server_url: String,
    pub remote_path: String,
    pub username: String,
    pub password: String,
    pub auth_type: AuthType,
    pub sync_mode: SyncMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_interval: Option<u64>,
}

/// Library-level sync configuration (stored on Library)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySyncConfig {
    pub enabled: bool,
    pub server_url: String,
    /// Base remote path for all notebooks (e.g., "/nous-sync/my-library")
    pub remote_base_path: String,
    pub auth_type: AuthType,
    pub sync_mode: SyncMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_interval: Option<u64>,
}

/// Input for configuring library-level sync (includes credentials)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySyncConfigInput {
    pub server_url: String,
    pub remote_base_path: String,
    pub username: String,
    pub password: String,
    pub auth_type: AuthType,
    pub sync_mode: SyncMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_interval: Option<u64>,
}

/// Credentials for WebDAV authentication
#[derive(Debug, Clone)]
pub struct SyncCredentials {
    pub username: String,
    pub password: String,
}

/// Manifest tracking remote sync state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncManifest {
    /// Notebook ID
    pub notebook_id: Uuid,
    /// Manifest version
    pub version: u32,
    /// Last update timestamp
    pub updated_at: DateTime<Utc>,
    /// Client ID that made last update
    pub last_client_id: String,
    /// Per-page sync state
    pub pages: std::collections::HashMap<Uuid, PageSyncState>,
    /// Folders checksum
    pub folders_hash: String,
    /// Sections checksum
    pub sections_hash: String,
    /// Per-page state vectors for incremental CRDT encoding
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub page_state_vectors: std::collections::HashMap<Uuid, Vec<u8>>,
}

/// Sync state for a single page
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSyncState {
    /// ETag from WebDAV for change detection
    pub etag: String,
    /// Last modified timestamp
    pub last_modified: DateTime<Utc>,
    /// Size in bytes
    pub size: u64,
}

impl SyncManifest {
    pub fn new(notebook_id: Uuid, client_id: String) -> Self {
        Self {
            notebook_id,
            version: 1,
            updated_at: Utc::now(),
            last_client_id: client_id,
            pages: std::collections::HashMap::new(),
            folders_hash: String::new(),
            sections_hash: String::new(),
            page_state_vectors: std::collections::HashMap::new(),
        }
    }
}

/// Change operation type for changelog entries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ChangeOperation {
    Updated,
    Deleted,
}

/// A single entry in the changelog
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangelogEntry {
    pub seq: u64,
    pub client_id: String,
    pub timestamp: DateTime<Utc>,
    pub operation: ChangeOperation,
    pub page_id: Uuid,
}

/// Changelog tracking recent sync operations for fast change detection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Changelog {
    pub notebook_id: Uuid,
    pub entries: Vec<ChangelogEntry>,
    pub next_seq: u64,
}

impl Changelog {
    /// Create a new empty changelog
    pub fn new(notebook_id: Uuid) -> Self {
        Self {
            notebook_id,
            entries: Vec::new(),
            next_seq: 1,
        }
    }

    /// Append a new entry and return its assigned sequence number
    pub fn append(&mut self, client_id: String, operation: ChangeOperation, page_id: Uuid) -> u64 {
        let seq = self.next_seq;
        self.entries.push(ChangelogEntry {
            seq,
            client_id,
            timestamp: Utc::now(),
            operation,
            page_id,
        });
        self.next_seq += 1;
        seq
    }

    /// Get entries since a given sequence number, excluding a specific client
    pub fn entries_since(&self, since_seq: u64, exclude_client: &str) -> Vec<&ChangelogEntry> {
        self.entries
            .iter()
            .filter(|e| e.seq > since_seq && e.client_id != exclude_client)
            .collect()
    }

    /// Compact the changelog, keeping only the last `keep_last` entries
    pub fn compact(&mut self, keep_last: usize) {
        if self.entries.len() > keep_last {
            let drain_count = self.entries.len() - keep_last;
            self.entries.drain(..drain_count);
        }
    }
}

/// User-facing notebook metadata stored on the remote for discovery.
///
/// Separate from the sync manifest (which tracks sync state). This captures
/// presentation metadata so a fresh client can create local notebooks with
/// correct names, types, colors, etc.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotebookMeta {
    pub name: String,
    #[serde(rename = "type")]
    pub notebook_type: NotebookType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub sections_enabled: bool,
    #[serde(default)]
    pub archived: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub system_prompt_mode: SystemPromptMode,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_model: Option<String>,
    pub updated_at: DateTime<Utc>,
}

impl From<&Notebook> for NotebookMeta {
    fn from(notebook: &Notebook) -> Self {
        Self {
            name: notebook.name.clone(),
            notebook_type: notebook.notebook_type.clone(),
            icon: notebook.icon.clone(),
            color: notebook.color.clone(),
            sections_enabled: notebook.sections_enabled,
            archived: notebook.archived,
            system_prompt: notebook.system_prompt.clone(),
            system_prompt_mode: notebook.system_prompt_mode.clone(),
            ai_provider: notebook.ai_provider.clone(),
            ai_model: notebook.ai_model.clone(),
            updated_at: notebook.updated_at,
        }
    }
}
