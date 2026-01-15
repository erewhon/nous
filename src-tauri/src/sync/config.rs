use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
}

impl SyncResult {
    pub fn success(pages_pulled: usize, pages_pushed: usize, conflicts_resolved: usize, duration_ms: u64) -> Self {
        Self {
            success: true,
            pages_pulled,
            pages_pushed,
            conflicts_resolved,
            error: None,
            duration_ms,
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
        }
    }
}
