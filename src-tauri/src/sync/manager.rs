use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use thiserror::Error;
use uuid::Uuid;

use futures_util::StreamExt;
use tauri::Emitter;
use tokio::sync::Semaphore;

use crate::goals::{Goal, GoalProgress, GoalsStorage};
use crate::inbox::{InboxItem, InboxStorage};
use crate::library::LibraryStorage;
use crate::storage::Page;
use crate::storage::FileStorage;

use crate::storage::{Folder, Notebook, NotebookType, Section};

use super::config::{
    AssetManifest, AssetManifestEntry, Changelog, ChangeOperation, LibrarySyncConfig,
    LibrarySyncConfigInput, NotebookMeta, PageMeta, ServerType, SyncConfig, SyncConfigInput,
    SyncCredentials, SyncManifest, SyncState, SyncStatus, SyncResult,
};
use super::crdt::PageDocument;
use super::metadata::LocalSyncState;
use super::queue::{SyncOperation, SyncQueue};
use super::webdav::{WebDAVClient, WebDAVError};

/// Type alias for shared storage
pub type SharedStorage = Arc<Mutex<FileStorage>>;

/// Type alias for shared library storage
pub type SharedLibraryStorage = Arc<Mutex<LibraryStorage>>;

/// Type alias for shared goals storage
pub type SharedGoalsStorage = Arc<Mutex<GoalsStorage>>;

/// Type alias for shared inbox storage
pub type SharedInboxStorage = Arc<Mutex<InboxStorage>>;

#[derive(Error, Debug)]
pub enum SyncError {
    #[error("WebDAV error: {0}")]
    WebDAV(#[from] WebDAVError),
    #[error("CRDT error: {0}")]
    CRDT(#[from] super::crdt::CRDTError),
    #[error("IO error: {0}")]
    IO(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Storage error: {0}")]
    Storage(#[from] crate::storage::StorageError),
    #[error("Sync not configured for notebook")]
    NotConfigured,
    #[error("Credentials not found")]
    CredentialsNotFound,
    #[error("Notebook not found: {0}")]
    NotebookNotFound(Uuid),
    #[error("Page not found: {0}")]
    PageNotFound(Uuid),
    #[error("Keyring error: {0}")]
    Keyring(String),
}

/// Result of syncing a single page
#[derive(Debug)]
enum PageSyncResult {
    Unchanged,
    Pulled,
    Pushed,
    Merged,
}

/// Snapshot of page sync info for concurrent processing
#[derive(Debug, Clone)]
struct PageSyncInfo {
    needs_sync: bool,
    remote_etag: Option<String>,
    _never_synced: bool,
}

/// Outcome of syncing a single page concurrently
struct PageSyncOutcome {
    page_id: Uuid,
    result: Result<PageSyncResult, SyncError>,
    /// (etag, state_vector) to pass to mark_page_synced
    sync_mark: Option<(Option<String>, Vec<u8>)>,
}

/// Outcome of pulling a remote-only page concurrently
struct PagePullOutcome {
    page_id: Uuid,
    success: bool,
    /// (etag, state_vector) to pass to mark_page_synced
    sync_mark: Option<(Option<String>, Vec<u8>)>,
}

/// Outcome of pushing an asset concurrently
struct AssetPushOutcome {
    relative_path: String,
    success: bool,
    /// (etag, size, mtime) to pass to mark_asset_synced
    sync_mark: Option<(Option<String>, u64, Option<DateTime<Utc>>)>,
}

/// Outcome of pulling an asset concurrently
struct AssetPullOutcome {
    relative_path: String,
    success: bool,
    /// (etag, size, mtime) to pass to mark_asset_synced
    sync_mark: Option<(Option<String>, u64, Option<DateTime<Utc>>)>,
}

/// Result of syncing assets for a notebook
#[derive(Debug, Default)]
struct AssetSyncResult {
    assets_pushed: usize,
    assets_pulled: usize,
}

/// Progress event payload for sync operations
#[derive(Clone, Serialize)]
pub struct SyncProgress {
    pub notebook_id: String,
    pub current: usize,
    pub total: usize,
    pub message: String,
    pub phase: String,
}

/// Event payload sent after sync pulls/merges pages from remote.
/// The frontend uses this to refresh stale in-memory page data.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncPagesUpdated {
    pub notebook_id: String,
    /// Page IDs that were pulled or merged from remote
    pub page_ids: Vec<String>,
}

/// Event payload sent after syncing goals from remote.
/// The frontend uses this to refresh goal displays.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncGoalsUpdated {
    pub goals_changed: bool,
    pub progress_changed: bool,
}

/// Event payload emitted when inbox sync completes with changes.
/// The frontend uses this to refresh inbox displays.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncInboxUpdated {
    pub inbox_changed: bool,
}

/// Sentinel file content written after successful push
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncSentinel {
    client_id: String,
    timestamp: DateTime<Utc>,
    counter: u64,
}

/// Default maximum concurrent WebDAV requests
const DEFAULT_WEBDAV_CONCURRENCY: usize = 8;

/// Maximum concurrent notebook syncs within a library
const MAX_NOTEBOOK_CONCURRENCY: usize = 4;

/// Minimum interval between on-save sync triggers for the same notebook
const ONSAVE_DEBOUNCE_SECS: u64 = 2;

/// Manager for sync operations
pub struct SyncManager {
    /// Base data directory
    data_dir: PathBuf,
    /// Sync queue (shared, persisted)
    queue: Arc<Mutex<SyncQueue>>,
    /// Local sync states per notebook
    local_states: Arc<Mutex<HashMap<Uuid, LocalSyncState>>>,
    /// Active WebDAV clients
    clients: Arc<Mutex<HashMap<Uuid, WebDAVClient>>>,
    /// Semaphore bounding total in-flight WebDAV requests
    webdav_semaphore: Arc<Semaphore>,
    /// Prevents concurrent sync of the same notebook
    syncing_notebooks: Arc<Mutex<HashSet<Uuid>>>,
    /// Monotonic counter for sentinel file
    sentinel_counter: std::sync::atomic::AtomicU64,
    /// App handle for emitting events (set after app initialization)
    app_handle: Arc<Mutex<Option<tauri::AppHandle>>>,
    /// Debounce tracking for on-save sync triggers
    onsave_debounce: Arc<Mutex<HashMap<Uuid, std::time::Instant>>>,
}

impl SyncManager {
    /// Create a new sync manager
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            queue: Arc::new(Mutex::new(SyncQueue::new())),
            local_states: Arc::new(Mutex::new(HashMap::new())),
            clients: Arc::new(Mutex::new(HashMap::new())),
            webdav_semaphore: Arc::new(Semaphore::new(DEFAULT_WEBDAV_CONCURRENCY)),
            syncing_notebooks: Arc::new(Mutex::new(HashSet::new())),
            sentinel_counter: std::sync::atomic::AtomicU64::new(0),
            app_handle: Arc::new(Mutex::new(None)),
            onsave_debounce: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Set the app handle for event emission (called after app initialization)
    pub fn set_app_handle(&self, handle: tauri::AppHandle) {
        let mut guard = self.app_handle.lock().unwrap();
        *guard = Some(handle);
    }

    /// Get the sync directory for a notebook
    fn sync_dir(&self, notebook_id: Uuid) -> PathBuf {
        self.data_dir
            .join("notebooks")
            .join(notebook_id.to_string())
            .join("sync")
    }

    /// Get the CRDT file path (standalone, no &self needed)
    fn crdt_path_for(data_dir: &Path, notebook_id: Uuid, page_id: Uuid) -> PathBuf {
        data_dir
            .join("notebooks")
            .join(notebook_id.to_string())
            .join("sync")
            .join("pages")
            .join(format!("{}.crdt", page_id))
    }

    /// Get the queue file path
    fn queue_path(&self) -> PathBuf {
        self.data_dir.join("sync_queue.json")
    }

    /// Get the local state file path for a notebook
    fn local_state_path(&self, notebook_id: Uuid) -> PathBuf {
        self.sync_dir(notebook_id).join("local_state.json")
    }

    /// Get the assets directory for a notebook
    fn assets_dir(&self, notebook_id: Uuid) -> PathBuf {
        self.data_dir
            .join("notebooks")
            .join(notebook_id.to_string())
            .join("assets")
    }

    /// Load the sync queue from disk
    pub fn load_queue(&self) -> Result<(), SyncError> {
        let path = self.queue_path();
        if path.exists() {
            let queue = SyncQueue::load(&path)?;
            *self.queue.lock().unwrap() = queue;
        }
        Ok(())
    }

    /// Save the sync queue to disk
    pub fn save_queue(&self) -> Result<(), SyncError> {
        let queue = self.queue.lock().unwrap();
        queue.save(&self.queue_path())?;
        Ok(())
    }

    /// Get or load local state for a notebook
    fn get_local_state(&self, notebook_id: Uuid) -> LocalSyncState {
        let mut states = self.local_states.lock().unwrap();

        if let Some(state) = states.get(&notebook_id) {
            return state.clone();
        }

        // Try to load from disk
        let path = self.local_state_path(notebook_id);
        let state = if path.exists() {
            LocalSyncState::load(&path).unwrap_or_else(|_| LocalSyncState::new(notebook_id))
        } else {
            LocalSyncState::new(notebook_id)
        };

        states.insert(notebook_id, state.clone());
        state
    }

    /// Save local state for a notebook
    fn save_local_state(&self, notebook_id: Uuid, state: &LocalSyncState) -> Result<(), SyncError> {
        let path = self.local_state_path(notebook_id);
        state.save(&path)?;

        let mut states = self.local_states.lock().unwrap();
        states.insert(notebook_id, state.clone());

        Ok(())
    }

    /// Try to acquire a per-notebook sync guard. Returns false if already syncing.
    fn try_acquire_notebook_guard(&self, notebook_id: Uuid) -> bool {
        let mut syncing = self.syncing_notebooks.lock().unwrap();
        syncing.insert(notebook_id)
    }

    /// Release the per-notebook sync guard.
    fn release_notebook_guard(&self, notebook_id: Uuid) {
        let mut syncing = self.syncing_notebooks.lock().unwrap();
        syncing.remove(&notebook_id);
    }

    // ===== Credential storage (file-based with keyring fallback) =====

    /// Path to file-based credential store
    fn credentials_file_path(&self, service: &str, id: Uuid) -> PathBuf {
        self.data_dir.join(".credentials").join(service).join(id.to_string())
    }

    /// Parse "username:password" format
    fn parse_credentials(data: &str) -> Result<SyncCredentials, SyncError> {
        let parts: Vec<&str> = data.splitn(2, ':').collect();
        if parts.len() != 2 {
            return Err(SyncError::CredentialsNotFound);
        }
        Ok(SyncCredentials {
            username: parts[0].to_string(),
            password: parts[1].to_string(),
        })
    }

    /// Get credentials: try file first, then keyring
    fn get_credentials(&self, notebook_id: Uuid) -> Result<SyncCredentials, SyncError> {
        // Try file-based store first
        let file_path = self.credentials_file_path("nous-sync", notebook_id);
        if let Ok(data) = std::fs::read_to_string(&file_path) {
            return Self::parse_credentials(data.trim());
        }

        // Fall back to keyring
        let entry = keyring::Entry::new("nous-sync", &notebook_id.to_string())
            .map_err(|e| SyncError::Keyring(e.to_string()))?;

        let password = entry
            .get_password()
            .map_err(|_| SyncError::CredentialsNotFound)?;

        Self::parse_credentials(&password)
    }

    /// Store credentials: write to file, also try keyring
    fn store_credentials(
        &self,
        notebook_id: Uuid,
        username: &str,
        password: &str,
    ) -> Result<(), SyncError> {
        let value = format!("{}:{}", username, password);

        // Always write to file-based store
        let file_path = self.credentials_file_path("nous-sync", notebook_id);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&file_path, &value)?;
        // Restrict permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&file_path, std::fs::Permissions::from_mode(0o600));
        }

        // Also try keyring (best-effort)
        if let Ok(entry) = keyring::Entry::new("nous-sync", &notebook_id.to_string()) {
            let _ = entry.set_password(&value);
        }

        Ok(())
    }

    /// Delete credentials from both stores
    fn delete_credentials(&self, notebook_id: Uuid) -> Result<(), SyncError> {
        // Delete file
        let file_path = self.credentials_file_path("nous-sync", notebook_id);
        let _ = std::fs::remove_file(&file_path);

        // Delete from keyring
        if let Ok(entry) = keyring::Entry::new("nous-sync", &notebook_id.to_string()) {
            let _ = entry.delete_credential();
        }
        Ok(())
    }

    /// Get or create WebDAV client for a notebook
    fn get_client(
        &self,
        notebook_id: Uuid,
        config: &SyncConfig,
    ) -> Result<WebDAVClient, SyncError> {
        let credentials = self.get_credentials(notebook_id)?;
        let client = WebDAVClient::new(config.server_url.clone(), credentials)?;
        Ok(client)
    }

    /// Test WebDAV connection
    pub async fn test_connection(
        &self,
        server_url: &str,
        username: &str,
        password: &str,
    ) -> Result<bool, SyncError> {
        let credentials = SyncCredentials {
            username: username.to_string(),
            password: password.to_string(),
        };

        let client = WebDAVClient::new(server_url.to_string(), credentials)?;
        match client.test_connection().await {
            Ok(result) => {
                log::info!("WebDAV connection test to {} succeeded (result={})", server_url, result);
                Ok(result)
            }
            Err(e) => {
                log::error!("WebDAV connection test to {} failed: {:?}", server_url, e);
                Err(e.into())
            }
        }
    }

    /// Configure sync for a notebook
    pub async fn configure(
        &self,
        notebook_id: Uuid,
        storage: &SharedStorage,
        input: SyncConfigInput,
    ) -> Result<(), SyncError> {
        // Verify connection first (no storage lock held here)
        let success = self
            .test_connection(&input.server_url, &input.username, &input.password)
            .await?;

        if !success {
            return Err(SyncError::WebDAV(WebDAVError::AuthFailed));
        }

        // Store credentials securely
        self.store_credentials(notebook_id, &input.username, &input.password)?;

        // Create sync config
        let config = SyncConfig {
            enabled: true,
            server_url: input.server_url,
            remote_path: input.remote_path,
            auth_type: input.auth_type,
            sync_mode: input.sync_mode,
            sync_interval: input.sync_interval,
            last_sync: None,
            managed_by_library: None,
            server_type: ServerType::default(),
        };

        // Update notebook (lock only during synchronous operation)
        {
            let storage_guard = storage.lock().unwrap();
            let mut notebook = storage_guard.get_notebook(notebook_id)?;
            notebook.sync_config = Some(config.clone());
            storage_guard.update_notebook(&notebook)?;
        } // Lock released here before async operations

        // Create remote directory structure
        let credentials = self.get_credentials(notebook_id)?;
        let client = WebDAVClient::new(config.server_url.clone(), credentials)?;
        client
            .mkdir_p(&format!("{}/pages", config.remote_path))
            .await?;
        client
            .mkdir_p(&format!("{}/assets", config.remote_path))
            .await?;

        // Initialize local state
        let state = LocalSyncState::new(notebook_id);
        self.save_local_state(notebook_id, &state)?;

        Ok(())
    }

    /// Get sync status for a notebook
    pub fn get_status(&self, notebook_id: Uuid, config: Option<&SyncConfig>) -> SyncStatus {
        let _config = match config {
            Some(c) if c.enabled => c,
            _ => {
                return SyncStatus {
                    status: SyncState::Disabled,
                    ..Default::default()
                }
            }
        };

        let local_state = self.get_local_state(notebook_id);
        let pending = self.queue.lock().unwrap().pending_count(notebook_id);

        SyncStatus {
            status: if pending > 0 {
                SyncState::Idle
            } else {
                SyncState::Success
            },
            last_sync: local_state.last_sync,
            pending_changes: pending,
            error: None,
            progress: None,
            current_operation: None,
        }
    }

    /// Queue a page for sync
    pub fn queue_page_update(&self, notebook_id: Uuid, page_id: Uuid) {
        let mut queue = self.queue.lock().unwrap();
        queue.enqueue(notebook_id, SyncOperation::UpdatePage { page_id });

        // Mark page as modified in local state
        let mut state = self.get_local_state(notebook_id);
        state.mark_page_modified(page_id);
        let _ = self.save_local_state(notebook_id, &state);
    }

    /// Trigger an on-save sync if the notebook is configured for OnSave mode.
    /// Debounces to avoid rapid consecutive syncs.
    pub fn trigger_onsave_sync_if_needed(
        self: &Arc<Self>,
        notebook_id: Uuid,
        storage: &SharedStorage,
    ) {
        // Check notebook's sync_config for OnSave mode
        let should_sync = {
            let storage_guard = storage.lock().unwrap();
            storage_guard
                .get_notebook(notebook_id)
                .ok()
                .and_then(|nb| nb.sync_config)
                .map(|cfg| cfg.enabled && cfg.sync_mode == super::config::SyncMode::OnSave)
                .unwrap_or(false)
        };

        if !should_sync {
            return;
        }

        // Debounce: skip if last trigger was less than ONSAVE_DEBOUNCE_SECS ago
        {
            let mut debounce = self.onsave_debounce.lock().unwrap();
            let now = std::time::Instant::now();
            if let Some(last) = debounce.get(&notebook_id) {
                if now.duration_since(*last).as_secs() < ONSAVE_DEBOUNCE_SECS {
                    return;
                }
            }
            debounce.insert(notebook_id, now);
        }

        let manager = Arc::clone(self);
        let storage = Arc::clone(storage);
        let app_handle = self.app_handle.lock().unwrap().clone();

        tauri::async_runtime::spawn(async move {
            log::info!("OnSave sync triggered for notebook {}", notebook_id);
            match manager
                .sync_notebook(notebook_id, &storage, app_handle.as_ref())
                .await
            {
                Ok(result) => {
                    log::info!(
                        "OnSave sync completed for notebook {}: {} pushed, {} pulled",
                        notebook_id,
                        result.pages_pushed,
                        result.pages_pulled
                    );
                }
                Err(e) => {
                    log::warn!("OnSave sync failed for notebook {}: {}", notebook_id, e);
                }
            }
        });
    }

    /// Queue a page deletion for sync
    pub fn queue_page_delete(&self, notebook_id: Uuid, page_id: Uuid) {
        let mut queue = self.queue.lock().unwrap();
        queue.enqueue(notebook_id, SyncOperation::DeletePage { page_id });
    }

    /// Queue folder update for sync
    pub fn queue_folders_update(&self, notebook_id: Uuid) {
        let mut queue = self.queue.lock().unwrap();
        queue.enqueue(notebook_id, SyncOperation::UpdateFolders);
    }

    /// Queue sections update for sync
    pub fn queue_sections_update(&self, notebook_id: Uuid) {
        let mut queue = self.queue.lock().unwrap();
        queue.enqueue(notebook_id, SyncOperation::UpdateSections);
    }

    // ===== Sentinel file for change notification =====

    /// Write sentinel file after a successful sync that pushed changes
    async fn push_sentinel(
        &self,
        client: &WebDAVClient,
        library_base_path: &str,
        client_id: &str,
    ) {
        let counter = self.sentinel_counter.fetch_add(1, Ordering::Relaxed);
        let sentinel = SyncSentinel {
            client_id: client_id.to_string(),
            timestamp: Utc::now(),
            counter,
        };
        let sentinel_path = format!("{}/.sync-sentinel", library_base_path);
        match serde_json::to_vec(&sentinel) {
            Ok(data) => {
                if let Err(e) = client.put(&sentinel_path, &data, None).await {
                    log::debug!("Failed to push sentinel: {}", e);
                }
            }
            Err(e) => log::debug!("Failed to serialize sentinel: {}", e),
        }
    }

    /// Check if sentinel file has changed since last check.
    /// Returns true if changed (or first check), false if unchanged.
    async fn check_sentinel(
        &self,
        client: &WebDAVClient,
        library_base_path: &str,
        stored_etag: Option<&str>,
    ) -> Result<(bool, Option<String>), SyncError> {
        let sentinel_path = format!("{}/.sync-sentinel", library_base_path);
        match client.head(&sentinel_path).await {
            Ok(head) if head.exists => {
                let current_etag = head.etag;
                let changed = match (stored_etag, &current_etag) {
                    (Some(stored), Some(current)) => stored != current,
                    (None, Some(_)) => true,  // First check
                    _ => true,                 // No ETag from server, assume changed
                };
                Ok((changed, current_etag))
            }
            Ok(_) => Ok((true, None)),           // Sentinel doesn't exist yet
            Err(WebDAVError::NotFound(_)) => Ok((true, None)),
            Err(e) => Err(e.into()),
        }
    }

    /// Check sentinel for a library (public, used by scheduler)
    pub async fn check_sentinel_for_library(
        &self,
        library_id: Uuid,
        library_config: &LibrarySyncConfig,
    ) -> Result<bool, SyncError> {
        let creds = self.get_library_credentials(library_id)?;
        let client = WebDAVClient::new(library_config.server_url.clone(), creds)?;

        // Get stored sentinel ETag from any managed notebook's local_state
        let stored_etag = {
            let states = self.local_states.lock().unwrap();
            states.values()
                .find_map(|s| s.sentinel_etag.clone())
        };

        let (changed, new_etag) = self.check_sentinel(
            &client,
            &library_config.remote_base_path,
            stored_etag.as_deref(),
        ).await?;

        // Update stored ETag if we got a new one
        if let Some(ref etag) = new_etag {
            let mut states = self.local_states.lock().unwrap();
            for state in states.values_mut() {
                state.sentinel_etag = Some(etag.clone());
            }
        }

        Ok(changed)
    }

    // ===== Server type detection =====

    /// Detect server type (Generic vs Nextcloud with optional notify_push)
    pub async fn detect_server_type(
        _client: &WebDAVClient,
        base_url: &str,
    ) -> ServerType {
        // Try Nextcloud status.php
        let status_url = format!("{}/status.php", base_url.trim_end_matches('/'));

        // Build a temporary reqwest client for the status endpoint
        let http_client = match reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .build()
        {
            Ok(c) => c,
            Err(_) => return ServerType::Generic,
        };

        let status_resp = match http_client.get(&status_url).send().await {
            Ok(r) if r.status().is_success() => r,
            _ => return ServerType::Generic,
        };

        let status_json: serde_json::Value = match status_resp.json().await {
            Ok(j) => j,
            Err(_) => return ServerType::Generic,
        };

        // Check if this is Nextcloud
        let product_name = status_json
            .get("productname")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        if !product_name.to_lowercase().contains("nextcloud") {
            return ServerType::Generic;
        }

        let version = status_json
            .get("versionstring")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        log::info!("Detected Nextcloud server version {}", version);

        // Check for notify_push capability
        let caps_url = format!(
            "{}/ocs/v1.php/cloud/capabilities",
            base_url.trim_end_matches('/')
        );
        let has_notify_push = match http_client
            .get(&caps_url)
            .header("OCS-APIRequest", "true")
            .header("Accept", "application/json")
            .send()
            .await
        {
            Ok(r) if r.status().is_success() => {
                match r.json::<serde_json::Value>().await {
                    Ok(caps) => {
                        let has_push = caps
                            .pointer("/ocs/data/capabilities/notify_push")
                            .is_some();
                        if has_push {
                            log::info!("Nextcloud server has notify_push capability");
                        }
                        has_push
                    }
                    Err(_) => false,
                }
            }
            _ => false,
        };

        ServerType::Nextcloud {
            version,
            has_notify_push,
        }
    }

    // ===== Content-addressable storage helpers =====

    /// Compute SHA256 hash of a file (streaming, never loads full file into memory)
    pub fn compute_file_hash(path: &Path) -> Result<String, std::io::Error> {
        use sha2::{Sha256, Digest};
        let mut hasher = Sha256::new();
        let mut file = std::fs::File::open(path)?;
        std::io::copy(&mut file, &mut hasher)?;
        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Get CAS path for a content hash: cas/{prefix_2}/{hash}.{ext}
    fn cas_remote_path(library_base_path: &str, hash: &str, ext: &str) -> String {
        let prefix = &hash[..2.min(hash.len())];
        if ext.is_empty() {
            format!("{}/cas/{}/{}", library_base_path, prefix, hash)
        } else {
            format!("{}/cas/{}/{}.{}", library_base_path, prefix, hash, ext)
        }
    }

    // ===== Full notebook sync =====

    /// Perform full sync for a notebook
    pub async fn sync_notebook(
        &self,
        notebook_id: Uuid,
        storage: &SharedStorage,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<SyncResult, SyncError> {
        // Prevent concurrent sync of the same notebook
        if !self.try_acquire_notebook_guard(notebook_id) {
            log::info!("Sync: notebook {} already syncing, skipping", notebook_id);
            return Ok(SyncResult::success(0, 0, 0, 0, 0, 0));
        }

        let result = self
            .sync_notebook_inner(notebook_id, storage, app_handle)
            .await;

        self.release_notebook_guard(notebook_id);
        result
    }

    /// Inner sync implementation (guard already held)
    async fn sync_notebook_inner(
        &self,
        notebook_id: Uuid,
        storage: &SharedStorage,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<SyncResult, SyncError> {
        let start = std::time::Instant::now();
        log::info!("Sync: starting notebook {}", notebook_id);

        // Resolve app handle: use explicit parameter, or fall back to stored handle.
        // This ensures scheduler-triggered syncs (which pass None) still emit events.
        let stored_handle = self.app_handle.lock().unwrap().clone();
        let app_handle = app_handle.or(stored_handle.as_ref());

        // 1. Get notebook config + local pages (short lock)
        let (config, local_pages) = {
            let storage_guard = storage.lock().unwrap();
            let notebook = storage_guard.get_notebook(notebook_id)?;
            let config = notebook
                .sync_config
                .as_ref()
                .filter(|c| c.enabled)
                .ok_or(SyncError::NotConfigured)?
                .clone();
            let pages = storage_guard.list_all_pages(notebook_id)?;
            (config, pages)
        }; // Lock released

        log::info!(
            "Sync: notebook {} has {} pages, remote_path={}",
            notebook_id,
            local_pages.len(),
            config.remote_path,
        );

        // 2. Get client + local_state
        let client = self.get_client(notebook_id, &config)?;
        let mut local_state = self.get_local_state(notebook_id);
        log::info!(
            "Sync: local_state has {} tracked pages, last_sync={:?}, last_changelog_seq={}",
            local_state.pages.len(),
            local_state.last_sync,
            local_state.last_changelog_seq,
        );

        // 2b. Ensure remote directory structure exists (idempotent, handles fresh/empty remote)
        let _ = client.mkdir_p(&format!("{}/pages", config.remote_path)).await;
        let _ = client.mkdir_p(&format!("{}/assets", config.remote_path)).await;

        let mut pages_pulled = 0;
        let mut pages_pushed = 0;
        let mut conflicts_resolved = 0;
        let mut page_errors = 0usize;
        let mut synced_page_ids: Vec<(Uuid, PageSyncResult)> = Vec::new();

        // 3. Fetch remote manifest + changelog + pages-meta IN PARALLEL
        let client_m = client.clone();
        let client_c = client.clone();
        let client_pm = client.clone();
        let remote_path_m = config.remote_path.clone();
        let remote_path_c = config.remote_path.clone();
        let remote_path_pm = config.remote_path.clone();

        let (manifest_result, changelog, remote_pages_meta) = tokio::join!(
            Self::fetch_manifest_static(&client_m, &remote_path_m),
            Self::fetch_changelog_static(&client_c, &remote_path_c, notebook_id),
            Self::fetch_pages_meta_static(&client_pm, &remote_path_pm),
        );

        let mut changelog = changelog;

        match &manifest_result {
            Ok(m) => log::info!("Sync: remote manifest has {} pages", m.pages.len()),
            Err(e) => log::debug!("Sync: no remote manifest (first sync?): {}", e),
        }
        let manifest_existed = manifest_result.is_ok();
        let mut manifest = manifest_result.unwrap_or_else(|_| {
            SyncManifest::new(notebook_id, local_state.client_id.clone())
        });

        log::info!(
            "Sync: changelog has {} entries, next_seq={}",
            changelog.entries.len(),
            changelog.next_seq,
        );

        let remote_pages_meta = remote_pages_meta.unwrap_or_else(|e| {
            log::debug!("Sync: no remote pages-meta.json: {}", e);
            HashMap::new()
        });
        log::info!("Sync: remote pages-meta has {} entries", remote_pages_meta.len());

        // 4. Determine remote_changed_pages
        let remote_changed_pages: HashSet<Uuid> = if local_state.last_changelog_seq > 0
            && !changelog.entries.is_empty()
            && changelog.entries.first().map(|e| e.seq).unwrap_or(0) <= local_state.last_changelog_seq + 1
        {
            let new_entries = changelog.entries_since(local_state.last_changelog_seq, &local_state.client_id);
            let page_ids: HashSet<Uuid> = new_entries.iter().map(|e| e.page_id).collect();
            log::info!(
                "Sync: changelog-based detection: {} remote changes since seq {}",
                page_ids.len(),
                local_state.last_changelog_seq,
            );
            page_ids
        } else {
            let page_ids: HashSet<Uuid> = manifest.pages.keys().copied().collect();
            log::info!(
                "Sync: manifest-based detection (fallback): {} potential remote changes",
                page_ids.len(),
            );
            page_ids
        };

        // 5. Sync each local page CONCURRENTLY
        let total_pages = local_pages.len();
        let progress_counter = Arc::new(AtomicUsize::new(0));

        // Build tasks with sync info snapshots
        let page_tasks: Vec<(Page, PageSyncInfo)> = local_pages
            .iter()
            .filter(|page| {
                let local_needs_sync = local_state.page_needs_sync(page.id);
                let never_synced = !local_state.pages.contains_key(&page.id);
                let updated_since_sync = local_state.pages.get(&page.id)
                    .and_then(|s| s.last_synced)
                    .map(|synced| page.updated_at > synced)
                    .unwrap_or(true);
                let remote_may_have_changed = remote_changed_pages.contains(&page.id);
                // If page is tracked locally but missing from the remote manifest,
                // it needs pushing (remote was cleared/reset or first push failed).
                let missing_from_remote = !manifest.pages.contains_key(&page.id);
                // Fallback: compare manifest ETag with our stored ETag.
                // Catches remote changes even when changelog entries are missed
                // (e.g., concurrent syncs overwriting each other's changelog).
                let manifest_etag_changed = manifest.pages.get(&page.id)
                    .map(|ms| {
                        let local_etag = local_state.pages.get(&page.id)
                            .and_then(|s| s.remote_etag.as_deref());
                        !ms.etag.is_empty() && local_etag != Some(ms.etag.as_str())
                    })
                    .unwrap_or(false);

                if !local_needs_sync && !never_synced && !updated_since_sync
                    && !remote_may_have_changed && !missing_from_remote
                    && !manifest_etag_changed
                {
                    log::debug!("Sync: skipping page '{}' ({}) — no changes", page.title, page.id);
                    return false;
                }
                if manifest_etag_changed && !remote_may_have_changed {
                    log::info!(
                        "Sync: page '{}' ({}) detected via manifest ETag (changelog missed it)",
                        page.title, page.id,
                    );
                }
                true
            })
            .map(|page| {
                let info = PageSyncInfo {
                    // Force needs_sync when the page is missing from the remote manifest,
                    // even if local state thinks it's up to date.
                    needs_sync: local_state.page_needs_sync(page.id)
                        || !manifest.pages.contains_key(&page.id),
                    remote_etag: local_state.pages.get(&page.id).and_then(|s| s.remote_etag.clone()),
                    _never_synced: !local_state.pages.contains_key(&page.id),
                };
                (page.clone(), info)
            })
            .collect();

        log::info!("Sync: {} pages to sync out of {} total", page_tasks.len(), total_pages);

        // Process pages concurrently with semaphore
        let outcomes: Vec<PageSyncOutcome> = futures_util::stream::iter(page_tasks)
            .map(|(page, info)| {
                let data_dir = self.data_dir.clone();
                let client = client.clone();
                let config = config.clone();
                let storage = Arc::clone(storage);
                let sem = Arc::clone(&self.webdav_semaphore);
                let counter = Arc::clone(&progress_counter);
                let app = app_handle.cloned();
                let nb_id_str = notebook_id.to_string();
                let page_title = page.title.clone();
                async move {
                    let _permit = sem.acquire().await.unwrap();
                    let idx = counter.fetch_add(1, Ordering::Relaxed);
                    if let Some(ref app) = app {
                        let _ = app.emit("sync-progress", SyncProgress {
                            notebook_id: nb_id_str,
                            current: idx + 1,
                            total: total_pages,
                            message: format!("Syncing page: {}", page_title),
                            phase: "pages".to_string(),
                        });
                    }
                    Self::sync_page_concurrent(
                        &data_dir, &client, &config, &info,
                        &storage, notebook_id, &page,
                    ).await
                }
            })
            .buffer_unordered(DEFAULT_WEBDAV_CONCURRENCY)
            .collect()
            .await;

        // Apply outcomes sequentially
        for outcome in outcomes {
            match &outcome.result {
                Ok(r) => log::info!("Sync: page {} result: {:?}", outcome.page_id, r),
                Err(e) => log::error!("Sync: page {} error: {}", outcome.page_id, e),
            }
            if let Some((etag, sv)) = outcome.sync_mark {
                local_state.mark_page_synced(outcome.page_id, etag, sv);
            }
            match outcome.result {
                Ok(ref r) => {
                    match r {
                        PageSyncResult::Pulled => pages_pulled += 1,
                        PageSyncResult::Pushed => pages_pushed += 1,
                        PageSyncResult::Merged => {
                            pages_pulled += 1;
                            pages_pushed += 1;
                            conflicts_resolved += 1;
                        }
                        PageSyncResult::Unchanged => {}
                    }
                    synced_page_ids.push((outcome.page_id, outcome.result.unwrap()));
                }
                Err(_) => {
                    // Don't abort the entire sync for one page failure.
                    // The error was already logged above.
                    page_errors += 1;
                }
            }
        }

        // 6. Pull remote-only pages CONCURRENTLY
        let local_page_ids: HashSet<Uuid> = local_pages.iter().map(|p| p.id).collect();
        let mut already_pulled: HashSet<Uuid> = HashSet::new();

        // From changelog/manifest
        let remote_only_ids: Vec<Uuid> = remote_changed_pages
            .iter()
            .filter(|id| !local_page_ids.contains(id))
            .copied()
            .collect();

        if !remote_only_ids.is_empty() {
            let pull_outcomes: Vec<PagePullOutcome> = futures_util::stream::iter(remote_only_ids)
                .map(|page_id| {
                    let data_dir = self.data_dir.clone();
                    let client = client.clone();
                    let config = config.clone();
                    let storage = Arc::clone(storage);
                    let sem = Arc::clone(&self.webdav_semaphore);
                    async move {
                        let _permit = sem.acquire().await.unwrap();
                        log::info!("Sync: pulling remote-only page {} (from manifest/changelog)", page_id);
                        Self::pull_page_concurrent(
                            &data_dir, &client, &config, &storage, notebook_id, page_id,
                        ).await
                    }
                })
                .buffer_unordered(DEFAULT_WEBDAV_CONCURRENCY)
                .collect()
                .await;

            for outcome in pull_outcomes {
                if outcome.success {
                    if let Some((etag, sv)) = outcome.sync_mark {
                        local_state.mark_page_synced(outcome.page_id, etag, sv);
                    }
                    pages_pulled += 1;
                    synced_page_ids.push((outcome.page_id, PageSyncResult::Pulled));
                    already_pulled.insert(outcome.page_id);
                }
            }
        }

        // 6b. Enumerate remote pages directory for any missed .crdt files
        {
            let pages_path = format!("{}/pages", config.remote_path);
            match client.propfind(&pages_path, 1).await {
                Ok(entries) => {
                    let remote_crdt_ids: Vec<Uuid> = entries
                        .iter()
                        .filter(|e| !e.is_collection)
                        .filter_map(|e| {
                            let path = e.path.trim_end_matches('/');
                            let filename = path.rsplit('/').next()?;
                            let stem = filename.strip_suffix(".crdt")?;
                            Uuid::parse_str(stem).ok()
                        })
                        .collect();
                    log::info!(
                        "Sync: remote enumeration found {} .crdt files on remote",
                        remote_crdt_ids.len(),
                    );

                    let enum_ids: Vec<Uuid> = remote_crdt_ids
                        .into_iter()
                        .filter(|id| !local_page_ids.contains(id) && !already_pulled.contains(id))
                        .collect();

                    if !enum_ids.is_empty() {
                        let enum_outcomes: Vec<PagePullOutcome> = futures_util::stream::iter(enum_ids)
                            .map(|page_id| {
                                let data_dir = self.data_dir.clone();
                                let client = client.clone();
                                let config = config.clone();
                                let storage = Arc::clone(storage);
                                let sem = Arc::clone(&self.webdav_semaphore);
                                async move {
                                    let _permit = sem.acquire().await.unwrap();
                                    log::info!("Sync: pulling remote-only page {} (from enumeration)", page_id);
                                    Self::pull_page_concurrent(
                                        &data_dir, &client, &config, &storage, notebook_id, page_id,
                                    ).await
                                }
                            })
                            .buffer_unordered(DEFAULT_WEBDAV_CONCURRENCY)
                            .collect()
                            .await;

                        for outcome in enum_outcomes {
                            if outcome.success {
                                if let Some((etag, sv)) = outcome.sync_mark {
                                    local_state.mark_page_synced(outcome.page_id, etag, sv);
                                }
                                pages_pulled += 1;
                                synced_page_ids.push((outcome.page_id, PageSyncResult::Pulled));
                            }
                        }
                    }
                }
                Err(e) => {
                    log::info!("Sync: remote pages enumeration failed: {}", e);
                }
            }
        }

        // 6c. Apply remote page metadata (with per-page locking, not holding lock for entire loop)
        if !remote_pages_meta.is_empty() {
            self.apply_pages_meta(storage, notebook_id, &remote_pages_meta);
        }

        // 6d. Pull and apply notebook metadata (pinned, position, sort order)
        let mut notebook_meta_changed = false;
        match self.fetch_notebook_meta(&client, &config.remote_path).await {
            Ok(remote_meta) => {
                let mut storage_guard = storage.lock().unwrap();
                if let Ok(mut notebook) = storage_guard.get_notebook(notebook_id) {
                    if remote_meta.updated_at > notebook.updated_at {
                        notebook.is_pinned = remote_meta.is_pinned;
                        notebook.position = remote_meta.position;
                        notebook.page_sort_by = remote_meta.page_sort_by;
                        notebook.name = remote_meta.name;
                        notebook.icon = remote_meta.icon;
                        notebook.color = remote_meta.color;
                        notebook.sections_enabled = remote_meta.sections_enabled;
                        notebook.archived = remote_meta.archived;
                        notebook.system_prompt = remote_meta.system_prompt;
                        notebook.system_prompt_mode = remote_meta.system_prompt_mode;
                        notebook.ai_provider = remote_meta.ai_provider;
                        notebook.ai_model = remote_meta.ai_model;
                        notebook.updated_at = remote_meta.updated_at;
                        if let Err(e) = storage_guard.update_notebook(&notebook) {
                            log::warn!("Sync: failed to apply notebook metadata: {}", e);
                        } else {
                            notebook_meta_changed = true;
                        }
                    }
                }
            }
            Err(e) => {
                log::info!("Sync: no remote notebook-meta.json: {}", e);
            }
        }

        // 6e. Pull folders and sections structure from remote
        if let Err(e) = self.pull_structure(&client, &config.remote_path, storage, notebook_id).await {
            log::warn!("Sync: failed to pull structure: {}", e);
        }

        // 7. Update manifest with synced pages
        for (page_id, result) in &synced_page_ids {
            match result {
                PageSyncResult::Pushed | PageSyncResult::Merged | PageSyncResult::Pulled => {
                    if let Some(page_state) = local_state.pages.get(page_id) {
                        manifest.pages.insert(
                            *page_id,
                            super::config::PageSyncState {
                                etag: page_state.remote_etag.clone().unwrap_or_default(),
                                last_modified: page_state.last_synced.unwrap_or_else(Utc::now),
                                size: 0,
                            },
                        );
                        if let Some(sv) = &page_state.synced_state_vector {
                            manifest.page_state_vectors.insert(*page_id, sv.clone());
                        }
                    }
                }
                PageSyncResult::Unchanged => {}
            }
        }

        // Push manifest if: we synced pages OR it didn't exist yet on remote
        if !synced_page_ids.is_empty() || !manifest_existed {
            manifest.version += 1;
            manifest.last_client_id = local_state.client_id.clone();
            manifest.updated_at = Utc::now();

            if let Err(e) = self.push_manifest(&client, &config.remote_path, &manifest).await {
                log::error!("Sync: failed to push manifest: {}", e);
            }
        }

        // Push notebook metadata for remote discovery
        {
            let notebook = {
                let storage_guard = storage.lock().unwrap();
                storage_guard.get_notebook(notebook_id)?
            };
            if let Err(e) = self.push_notebook_meta(&client, &config.remote_path, &notebook).await {
                log::warn!("Sync: failed to push notebook-meta.json: {}", e);
            }
        }

        // Push structural metadata (sections, folders, pages-meta) always —
        // structure can change independently of page content (e.g. new section)
        if let Err(e) = self.push_structure(&client, &config.remote_path, storage, notebook_id).await {
            log::warn!("Sync: failed to push structural metadata: {}", e);
        }

        // 8. Update changelog with synced pages
        for (page_id, result) in &synced_page_ids {
            match result {
                PageSyncResult::Pushed | PageSyncResult::Merged => {
                    changelog.append(
                        local_state.client_id.clone(),
                        ChangeOperation::Updated,
                        *page_id,
                    );
                }
                _ => {}
            }
        }

        if changelog.entries.len() > 500 {
            changelog.compact(200);
        }

        let any_pushed = pages_pushed > 0;

        if !synced_page_ids.is_empty() || !manifest_existed {
            if let Err(e) = self.push_changelog(&client, &config.remote_path, &changelog).await {
                log::error!("Sync: failed to push changelog: {}", e);
            }
        }

        // 9. Sync assets (with CAS when possible, fallback to legacy)
        if let Some(app) = app_handle {
            let _ = app.emit("sync-progress", SyncProgress {
                notebook_id: notebook_id.to_string(),
                current: 0,
                total: 0,
                message: "Syncing assets...".to_string(),
                phase: "assets".to_string(),
            });
        }

        // Determine library base path for CAS
        let library_base_path = config.remote_path
            .rsplit_once('/')
            .map(|(base, _)| base.to_string());

        let asset_result = if let Some(ref lib_base) = library_base_path {
            // Try CAS sync first, fall back to legacy
            match self
                .sync_assets_cas(&client, &config, &mut local_state, notebook_id, lib_base)
                .await
            {
                Ok(result) => result,
                Err(e) => {
                    log::info!("CAS asset sync not available ({}), falling back to legacy", e);
                    self.sync_assets(&client, &config, &mut local_state, notebook_id)
                        .await
                        .unwrap_or_else(|e| {
                            log::error!("Asset sync failed for notebook {}: {}", notebook_id, e);
                            AssetSyncResult::default()
                        })
                }
            }
        } else {
            self.sync_assets(&client, &config, &mut local_state, notebook_id)
                .await
                .unwrap_or_else(|e| {
                    log::error!("Asset sync failed for notebook {}: {}", notebook_id, e);
                    AssetSyncResult::default()
                })
        };

        // Push sentinel if we pushed anything
        if any_pushed || asset_result.assets_pushed > 0 {
            if let Some(ref lib_base) = library_base_path {
                self.push_sentinel(&client, lib_base, &local_state.client_id).await;
            }
        }

        // 10. Process queue items
        let queue_items: Vec<_> = {
            let queue = self.queue.lock().unwrap();
            queue.get_notebook_items(notebook_id).iter().map(|i| i.id).collect()
        };

        for item_id in queue_items {
            let mut queue = self.queue.lock().unwrap();
            queue.complete(item_id);
        }

        // 11. Update local state
        local_state.last_changelog_seq = if changelog.next_seq > 0 {
            changelog.next_seq - 1
        } else {
            0
        };
        local_state.remote_version = Some(manifest.version);
        local_state.last_sync = Some(Utc::now());
        self.save_local_state(notebook_id, &local_state)?;
        self.save_queue()?;

        // Update notebook config with last sync time (short lock)
        {
            let storage_guard = storage.lock().unwrap();
            let mut notebook = storage_guard.get_notebook(notebook_id)?;
            if let Some(config) = &mut notebook.sync_config {
                config.last_sync = Some(Utc::now());
            }
            storage_guard.update_notebook(&notebook)?;
        } // Lock released

        // Notify frontend of pages that were updated from remote so it can
        // refresh stale in-memory data and prevent editor auto-save from
        // overwriting the sync'd content.
        if let Some(app) = app_handle {
            let updated_page_ids: Vec<String> = synced_page_ids
                .iter()
                .filter(|(_, result)| matches!(result, PageSyncResult::Pulled | PageSyncResult::Merged))
                .map(|(id, _)| id.to_string())
                .collect();
            if !updated_page_ids.is_empty() {
                log::info!(
                    "Sync: notifying frontend of {} updated page(s)",
                    updated_page_ids.len(),
                );
                let _ = app.emit("sync-pages-updated", SyncPagesUpdated {
                    notebook_id: notebook_id.to_string(),
                    page_ids: updated_page_ids,
                });
            }

            // Notify frontend to reload notebook metadata (pinned, position,
            // sort order, sections, folders) when any structure changed
            if notebook_meta_changed {
                log::info!("Sync: notifying frontend of notebook metadata changes");
                let _ = app.emit("sync-notebook-updated", serde_json::json!({
                    "notebookId": notebook_id.to_string(),
                }));
            }

            let _ = app.emit("sync-progress", SyncProgress {
                notebook_id: notebook_id.to_string(),
                current: total_pages,
                total: total_pages,
                message: "Complete".to_string(),
                phase: "complete".to_string(),
            });
        }

        if page_errors > 0 {
            log::warn!("Sync: completed with {} page error(s)", page_errors);
        }

        let mut result = SyncResult::success(
            pages_pulled,
            pages_pushed,
            conflicts_resolved,
            start.elapsed().as_millis() as u64,
            asset_result.assets_pushed,
            asset_result.assets_pulled,
        );
        if page_errors > 0 {
            result.error = Some(format!("{} page(s) failed to sync", page_errors));
        }
        Ok(result)
    }

    // ===== Manifest, changelog, pages-meta fetch (static for tokio::join!) =====

    async fn fetch_manifest_static(
        client: &WebDAVClient,
        remote_path: &str,
    ) -> Result<SyncManifest, SyncError> {
        let manifest_path = format!("{}/.sync-manifest.json", remote_path);
        let data = client.get(&manifest_path).await?;
        let manifest: SyncManifest = serde_json::from_slice(&data)?;
        Ok(manifest)
    }

    async fn fetch_changelog_static(
        client: &WebDAVClient,
        remote_path: &str,
        notebook_id: Uuid,
    ) -> Changelog {
        let changelog_path = format!("{}/.changelog.json", remote_path);
        match client.get(&changelog_path).await {
            Ok(data) => serde_json::from_slice(&data).unwrap_or_else(|_| Changelog::new(notebook_id)),
            Err(_) => Changelog::new(notebook_id),
        }
    }

    async fn fetch_pages_meta_static(
        client: &WebDAVClient,
        remote_path: &str,
    ) -> Result<HashMap<Uuid, PageMeta>, SyncError> {
        let meta_path = format!("{}/pages-meta.json", remote_path);
        let data = client.get(&meta_path).await?;
        let meta: HashMap<Uuid, PageMeta> = serde_json::from_slice(&data)?;
        Ok(meta)
    }

    /// Push manifest to remote (last-writer-wins, no ETag locking)
    async fn push_manifest(
        &self,
        client: &WebDAVClient,
        remote_path: &str,
        manifest: &SyncManifest,
    ) -> Result<(), SyncError> {
        let manifest_path = format!("{}/.sync-manifest.json", remote_path);
        let data = serde_json::to_vec_pretty(manifest)?;
        client.put(&manifest_path, &data, None).await?;
        Ok(())
    }

    /// Push changelog to remote (last-writer-wins)
    async fn push_changelog(
        &self,
        client: &WebDAVClient,
        remote_path: &str,
        changelog: &Changelog,
    ) -> Result<(), SyncError> {
        let changelog_path = format!("{}/.changelog.json", remote_path);
        let data = serde_json::to_vec_pretty(changelog)?;
        client.put(&changelog_path, &data, None).await?;
        Ok(())
    }

    /// Push notebook metadata to remote for discovery by other clients
    async fn push_notebook_meta(
        &self,
        client: &WebDAVClient,
        remote_path: &str,
        notebook: &Notebook,
    ) -> Result<(), SyncError> {
        let meta = NotebookMeta::from(notebook);
        let meta_path = format!("{}/notebook-meta.json", remote_path);
        let data = serde_json::to_vec_pretty(&meta)?;
        client.put(&meta_path, &data, None).await?;
        Ok(())
    }

    /// Fetch notebook metadata from remote (for discovery)
    async fn fetch_notebook_meta(
        &self,
        client: &WebDAVClient,
        remote_path: &str,
    ) -> Result<NotebookMeta, SyncError> {
        let meta_path = format!("{}/notebook-meta.json", remote_path);
        let data = client.get(&meta_path).await?;
        let meta: NotebookMeta = serde_json::from_slice(&data)?;
        Ok(meta)
    }

    /// Push structural metadata to remote: pages-meta.json, folders.json, sections.json
    /// Uses tokio::join! for parallel PUTs.
    async fn push_structure(
        &self,
        client: &WebDAVClient,
        remote_path: &str,
        storage: &SharedStorage,
        notebook_id: Uuid,
    ) -> Result<(), SyncError> {
        let (pages, folders, sections) = {
            let storage_guard = storage.lock().unwrap();
            let pages = storage_guard.list_all_pages(notebook_id)?;
            let folders = storage_guard.list_folders(notebook_id)?;
            let sections = storage_guard.list_sections(notebook_id)?;
            (pages, folders, sections)
        };

        // Build pages-meta.json
        let pages_meta: HashMap<Uuid, PageMeta> = pages
            .iter()
            .map(|p| (p.id, PageMeta::from(p)))
            .collect();

        let meta_data = serde_json::to_vec_pretty(&pages_meta)?;
        let folders_data = serde_json::to_vec_pretty(&folders)?;
        let sections_data = serde_json::to_vec_pretty(&sections)?;

        let meta_path = format!("{}/pages-meta.json", remote_path);
        let folders_path = format!("{}/folders.json", remote_path);
        let sections_path = format!("{}/sections.json", remote_path);

        // Three independent PUTs in parallel
        let (r1, r2, r3) = tokio::join!(
            client.put(&meta_path, &meta_data, None),
            client.put(&folders_path, &folders_data, None),
            client.put(&sections_path, &sections_data, None),
        );

        if let Err(e) = r1 {
            log::warn!("Sync: failed to push pages-meta.json: {}", e);
        } else {
            log::info!("Sync: pushed pages-meta.json with {} entries", pages_meta.len());
        }
        if let Err(e) = r2 {
            log::warn!("Sync: failed to push folders.json: {}", e);
        } else {
            log::info!("Sync: pushed folders.json with {} folders", folders.len());
        }
        if let Err(e) = r3 {
            log::warn!("Sync: failed to push sections.json: {}", e);
        } else {
            log::info!("Sync: pushed sections.json with {} sections", sections.len());
        }

        Ok(())
    }

    /// Fetch and apply remote folders.json and sections.json to local storage.
    async fn pull_structure(
        &self,
        client: &WebDAVClient,
        remote_path: &str,
        storage: &SharedStorage,
        notebook_id: Uuid,
    ) -> Result<(), SyncError> {
        // Pull folders
        let folders_remote_path = format!("{}/folders.json", remote_path);
        match client.get(&folders_remote_path).await {
            Ok(data) => {
                match serde_json::from_slice::<Vec<Folder>>(&data) {
                    Ok(folders) => {
                        log::info!("Sync: pulled {} folders from remote, applying", folders.len());
                        let storage_guard = storage.lock().unwrap();
                        storage_guard.save_folders_for_sync(notebook_id, &folders)?;
                    }
                    Err(e) => log::warn!("Sync: failed to parse remote folders.json: {}", e),
                }
            }
            Err(e) => log::debug!("Sync: no remote folders.json: {}", e),
        }

        // Pull sections
        let sections_remote_path = format!("{}/sections.json", remote_path);
        match client.get(&sections_remote_path).await {
            Ok(data) => {
                match serde_json::from_slice::<Vec<Section>>(&data) {
                    Ok(sections) => {
                        log::info!("Sync: pulled {} sections from remote, applying", sections.len());
                        let storage_guard = storage.lock().unwrap();
                        storage_guard.save_sections_for_sync(notebook_id, &sections)?;
                        // Repair any orphaned sections (pages referencing non-existent sections)
                        match storage_guard.repair_orphaned_sections(notebook_id) {
                            Ok(0) => {},
                            Ok(n) => log::info!("Sync: repaired {} orphaned section(s)", n),
                            Err(e) => log::warn!("Sync: failed to repair orphaned sections: {}", e),
                        }
                    }
                    Err(e) => log::warn!("Sync: failed to parse remote sections.json: {}", e),
                }
            }
            Err(e) => log::debug!("Sync: no remote sections.json: {}", e),
        }

        Ok(())
    }

    /// Apply page metadata from remote pages-meta.json to local pages.
    /// Uses per-page locking instead of holding storage lock for the entire loop.
    fn apply_pages_meta(
        &self,
        storage: &SharedStorage,
        notebook_id: Uuid,
        pages_meta: &HashMap<Uuid, PageMeta>,
    ) {
        if pages_meta.is_empty() {
            return;
        }

        // Read page list under brief lock
        let local_pages = {
            let storage_guard = storage.lock().unwrap();
            match storage_guard.list_all_pages(notebook_id) {
                Ok(pages) => pages,
                Err(e) => {
                    log::warn!("Sync: failed to list pages for metadata apply: {}", e);
                    return;
                }
            }
        };

        let mut applied = 0;
        for page in local_pages {
            if let Some(meta) = pages_meta.get(&page.id) {
                let is_placeholder = page.title.starts_with("Synced Page ");
                let remote_is_newer = meta.updated_at > page.updated_at;
                if !is_placeholder && !remote_is_newer {
                    continue;
                }

                // Acquire/release lock per-page update
                let storage_guard = storage.lock().unwrap();
                match storage_guard.get_page(notebook_id, page.id) {
                    Ok(mut page) => {
                        page.title = meta.title.clone();
                        page.tags = meta.tags.clone();
                        page.folder_id = meta.folder_id;
                        page.parent_page_id = meta.parent_page_id;
                        page.section_id = meta.section_id;
                        page.position = meta.position;
                        page.is_archived = meta.is_archived;
                        page.is_cover = meta.is_cover;
                        page.is_favorite = meta.is_favorite;
                        page.page_type = meta.page_type.clone();
                        page.source_file = meta.source_file.clone();
                        page.storage_mode = meta.storage_mode.clone();
                        page.file_extension = meta.file_extension.clone();
                        page.deleted_at = meta.deleted_at;
                        page.system_prompt = meta.system_prompt.clone();
                        page.system_prompt_mode = meta.system_prompt_mode.clone();
                        page.ai_model = meta.ai_model.clone();
                        page.created_at = meta.created_at;
                        page.updated_at = meta.updated_at;
                        if let Err(e) = storage_guard.update_page(&page) {
                            log::warn!("Sync: failed to apply metadata to page {}: {}", page.id, e);
                        } else {
                            applied += 1;
                        }
                    }
                    Err(e) => {
                        log::warn!("Sync: failed to read page {} for metadata apply: {}", page.id, e);
                    }
                }
            }
        }
        log::info!(
            "Sync: applied remote metadata to {} pages (remote has {} entries)",
            applied,
            pages_meta.len(),
        );
    }

    // ===== Concurrent page sync (no &mut LocalSyncState needed) =====

    /// Sync a single page concurrently. Returns outcome with sync_mark to apply later.
    async fn sync_page_concurrent(
        data_dir: &Path,
        client: &WebDAVClient,
        config: &SyncConfig,
        sync_info: &PageSyncInfo,
        storage: &SharedStorage,
        notebook_id: Uuid,
        page: &Page,
    ) -> PageSyncOutcome {
        let page_id = page.id;
        match Self::sync_page_concurrent_inner(
            data_dir, client, config, sync_info, storage, notebook_id, page,
        ).await {
            Ok((result, sync_mark)) => PageSyncOutcome {
                page_id,
                result: Ok(result),
                sync_mark,
            },
            Err(e) => PageSyncOutcome {
                page_id,
                result: Err(e),
                sync_mark: None,
            },
        }
    }

    async fn sync_page_concurrent_inner(
        data_dir: &Path,
        client: &WebDAVClient,
        config: &SyncConfig,
        sync_info: &PageSyncInfo,
        storage: &SharedStorage,
        notebook_id: Uuid,
        page: &Page,
    ) -> Result<(PageSyncResult, Option<(Option<String>, Vec<u8>)>), SyncError> {
        let crdt_path = Self::crdt_path_for(data_dir, notebook_id, page.id);
        let remote_path = format!("{}/pages/{}.crdt", config.remote_path, page.id);

        // 1. Load or create local CRDT
        //
        // Key decision: when the page was modified locally (needs_sync), we must
        // rebuild the CRDT from page.content because edits happen in the JSON file,
        // not in the CRDT. Loading the old CRDT would push stale content.
        //
        // When there are NO local changes, we load the existing CRDT so we can
        // cleanly apply remote updates (the CRDT state matches what's on disk).
        let crdt_existed = crdt_path.exists();
        let local_doc = if crdt_existed && !sync_info.needs_sync {
            // No local changes — load existing CRDT for potential merge with remote
            let data = std::fs::read(&crdt_path)?;
            PageDocument::from_state(&data)?
        } else {
            // Local changes exist, or no CRDT yet — create from current page content
            PageDocument::from_editor_data(&page.content)?
        };

        // 2. Use HEAD to check remote existence + ETag
        let (remote_exists, remote_etag) = match client.head(&remote_path).await {
            Ok(head) if head.exists => {
                if head.etag.is_some() {
                    (true, head.etag)
                } else {
                    match client.get_with_etag(&remote_path).await {
                        Ok((_, etag)) => (true, etag),
                        Err(WebDAVError::NotFound(_)) => (false, None),
                        Err(e) => return Err(e.into()),
                    }
                }
            }
            Ok(_) => (false, None),
            Err(WebDAVError::NotFound(_)) => (false, None),
            Err(_) => {
                match client.get_with_etag(&remote_path).await {
                    Ok((_, etag)) => (true, etag),
                    Err(WebDAVError::NotFound(_)) => (false, None),
                    Err(e) => return Err(e.into()),
                }
            }
        };

        // 3. If remote exists and ETag differs — remote changed
        if remote_exists {
            let remote_changed = match &sync_info.remote_etag {
                Some(stored) => Some(stored.as_str()) != remote_etag.as_deref(),
                None => true,
            };

            if remote_changed {
                let (remote_data, fetched_etag) = client.get_with_etag(&remote_path).await?;
                let remote_etag = fetched_etag.or(remote_etag);

                local_doc.apply_update(&remote_data)?;

                if sync_info.needs_sync {
                    // Merge case
                    let merged_content = local_doc.to_editor_data()?;
                    {
                        let storage_guard = storage.lock().unwrap();
                        let mut updated_page = page.clone();
                        updated_page.content = merged_content;
                        // Use update_page_metadata to handle both standard (.json)
                        // and file-based (.metadata.json) pages correctly.
                        storage_guard.update_page_metadata(&updated_page)?;
                    }

                    let merged_state = local_doc.encode_state();
                    std::fs::create_dir_all(crdt_path.parent().unwrap())?;
                    std::fs::write(&crdt_path, &merged_state)?;

                    let result = client.put(&remote_path, &merged_state, None).await?;
                    let sv = local_doc.state_vector();
                    return Ok((PageSyncResult::Merged, Some((result.etag, sv))));
                } else {
                    // Pull only
                    let merged_content = local_doc.to_editor_data()?;
                    {
                        let storage_guard = storage.lock().unwrap();
                        let mut updated_page = page.clone();
                        updated_page.content = merged_content;
                        // Use update_page_metadata to handle both standard (.json)
                        // and file-based (.metadata.json) pages correctly.
                        storage_guard.update_page_metadata(&updated_page)?;
                    }

                    let state = local_doc.encode_state();
                    std::fs::create_dir_all(crdt_path.parent().unwrap())?;
                    std::fs::write(&crdt_path, &state)?;

                    let sv = local_doc.state_vector();
                    return Ok((PageSyncResult::Pulled, Some((remote_etag, sv))));
                }
            }
        }

        // 4. If local needs pushing
        if sync_info.needs_sync {
            let full_state = local_doc.encode_state();
            std::fs::create_dir_all(crdt_path.parent().unwrap())?;
            std::fs::write(&crdt_path, &full_state)?;

            // Only use If-Match ETag if the remote file actually exists;
            // a stale ETag from a previous sync against a now-empty remote
            // would cause a spurious 412 Precondition Failed.
            let put_etag = if remote_exists {
                sync_info.remote_etag.as_deref()
            } else {
                None
            };

            let result = client
                .put(&remote_path, &full_state, put_etag)
                .await?;

            if result.conflict {
                // 412 Precondition Failed — remote changed since our last sync.
                // Try to fetch remote for merge; if the file was deleted (NotFound),
                // just re-push without ETag.
                match client.get_with_etag(&remote_path).await {
                    Ok((remote_data, _)) => {
                        local_doc.apply_update(&remote_data)?;

                        let merged_state = local_doc.encode_state();
                        std::fs::write(&crdt_path, &merged_state)?;

                        let result = client.put(&remote_path, &merged_state, None).await?;

                        let merged_content = local_doc.to_editor_data()?;
                        {
                            let storage_guard = storage.lock().unwrap();
                            let mut updated_page = page.clone();
                            updated_page.content = merged_content;
                            storage_guard.update_page_metadata(&updated_page)?;
                        }

                        let sv = local_doc.state_vector();
                        return Ok((PageSyncResult::Merged, Some((result.etag, sv))));
                    }
                    Err(WebDAVError::NotFound(_)) => {
                        // Remote file was deleted — push without ETag
                        log::info!(
                            "Sync: page {} conflict but remote gone, re-pushing",
                            page.id,
                        );
                        let result = client.put(&remote_path, &full_state, None).await?;
                        let sv = local_doc.state_vector();
                        return Ok((PageSyncResult::Pushed, Some((result.etag, sv))));
                    }
                    Err(e) => return Err(e.into()),
                }
            }

            let sv = local_doc.state_vector();
            return Ok((PageSyncResult::Pushed, Some((result.etag, sv))));
        }

        Ok((PageSyncResult::Unchanged, None))
    }

    /// Pull a page from remote concurrently. Returns outcome with sync_mark.
    async fn pull_page_concurrent(
        data_dir: &Path,
        client: &WebDAVClient,
        config: &SyncConfig,
        storage: &SharedStorage,
        notebook_id: Uuid,
        page_id: Uuid,
    ) -> PagePullOutcome {
        match Self::pull_page_concurrent_inner(
            data_dir, client, config, storage, notebook_id, page_id,
        ).await {
            Ok((etag, sv)) => PagePullOutcome {
                page_id,
                success: true,
                sync_mark: Some((etag, sv)),
            },
            Err(e) => {
                log::error!("Sync: failed to pull page {}: {}", page_id, e);
                PagePullOutcome {
                    page_id,
                    success: false,
                    sync_mark: None,
                }
            }
        }
    }

    async fn pull_page_concurrent_inner(
        data_dir: &Path,
        client: &WebDAVClient,
        config: &SyncConfig,
        storage: &SharedStorage,
        notebook_id: Uuid,
        page_id: Uuid,
    ) -> Result<(Option<String>, Vec<u8>), SyncError> {
        let remote_path = format!("{}/pages/{}.crdt", config.remote_path, page_id);
        let (data, etag) = client.get_with_etag(&remote_path).await?;

        let doc = PageDocument::from_state(&data)?;
        let content = doc.to_editor_data()?;

        let page = Page {
            id: page_id,
            notebook_id,
            title: format!("Synced Page {}", page_id),
            content,
            tags: vec![],
            folder_id: None,
            parent_page_id: None,
            section_id: None,
            is_archived: false,
            is_cover: false,
            position: 0,
            system_prompt: None,
            system_prompt_mode: crate::storage::SystemPromptMode::default(),
            ai_model: None,
            page_type: crate::storage::PageType::default(),
            source_file: None,
            storage_mode: None,
            file_extension: None,
            last_file_sync: None,
            template_id: None,
            deleted_at: None,
            is_favorite: false,
            is_daily_note: false,
            daily_note_date: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        // Save page (short lock)
        {
            let storage_guard = storage.lock().unwrap();
            storage_guard.create_page_with_id(notebook_id, &page)?;
        }

        // Save CRDT
        let crdt_path = Self::crdt_path_for(data_dir, notebook_id, page_id);
        std::fs::create_dir_all(crdt_path.parent().unwrap())?;
        std::fs::write(&crdt_path, &data)?;

        let sv = doc.state_vector();
        Ok((etag, sv))
    }

    // ===== Asset discovery =====

    /// Discover all local asset files under the notebook's assets directory
    fn discover_local_assets(
        assets_dir: &Path,
    ) -> HashMap<String, (PathBuf, u64, Option<DateTime<Utc>>)> {
        let mut assets = HashMap::new();
        if !assets_dir.exists() {
            return assets;
        }

        for entry in walkdir::WalkDir::new(assets_dir)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            if !entry.file_type().is_file() {
                continue;
            }

            let abs_path = entry.path().to_path_buf();
            let relative = match abs_path.strip_prefix(assets_dir) {
                Ok(r) => r.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };

            let metadata = match std::fs::metadata(&abs_path) {
                Ok(m) => m,
                Err(_) => continue,
            };

            let size = metadata.len();
            let mtime = metadata
                .modified()
                .ok()
                .map(|t| DateTime::<Utc>::from(t));

            assets.insert(relative, (abs_path, size, mtime));
        }

        assets
    }

    // ===== Legacy asset sync (parallel) =====

    /// Sync assets between local and remote for a notebook (parallelized)
    async fn sync_assets(
        &self,
        client: &WebDAVClient,
        config: &super::config::SyncConfig,
        local_state: &mut LocalSyncState,
        notebook_id: Uuid,
    ) -> Result<AssetSyncResult, SyncError> {
        let assets_dir = self.assets_dir(notebook_id);
        let remote_assets_base = format!("{}/assets", config.remote_path);

        // 1. Discover local assets
        let local_assets = Self::discover_local_assets(&assets_dir);
        log::info!(
            "Asset sync: discovered {} local assets for notebook {}",
            local_assets.len(),
            notebook_id,
        );

        // 2. Discover remote assets
        let remote_assets = match client.list_files_recursive(&remote_assets_base).await {
            Ok(files) => files,
            Err(WebDAVError::NotFound(_)) => {
                log::info!("Asset sync: remote assets directory not found, will create");
                Vec::new()
            }
            Err(e) => return Err(e.into()),
        };
        log::info!("Asset sync: found {} remote assets", remote_assets.len());

        // 3. Ensure remote subdirectories exist
        for subdir in &["images", "embedded", "pdf_annotations", "annotations"] {
            let _ = client.mkdir_p(&format!("{}/{}", remote_assets_base, subdir)).await;
        }

        let mut result = AssetSyncResult::default();

        // Build remote map
        let normalized_prefix = remote_assets_base.trim_matches('/');
        let remote_assets_prefix = format!("{}/", normalized_prefix);
        let remote_map: HashMap<String, &super::webdav::ResourceInfo> = remote_assets
            .iter()
            .filter_map(|r| {
                let path = r.path.trim_end_matches('/');
                if let Some(rel) = path.strip_prefix(normalized_prefix) {
                    let rel = rel.trim_start_matches('/').to_string();
                    if !rel.is_empty() {
                        return Some((rel, r));
                    }
                }
                log::debug!("Asset sync: could not extract relative path from '{}' (prefix='{}')", path, remote_assets_prefix);
                None
            })
            .collect();

        // 4. Push: collect assets that need pushing
        let push_tasks: Vec<(String, PathBuf, u64, Option<DateTime<Utc>>, Option<String>)> =
            local_assets
                .iter()
                .filter(|(relative_path, (_, size, mtime))| {
                    // Push if locally changed OR missing from remote (remote reset/empty)
                    local_state.asset_needs_push(relative_path, *size, *mtime)
                        || !remote_map.contains_key(relative_path.as_str())
                })
                .map(|(relative_path, (abs_path, size, mtime))| {
                    let existing_etag = local_state
                        .assets
                        .get(relative_path)
                        .and_then(|s| s.remote_etag.clone());
                    (
                        relative_path.clone(),
                        abs_path.clone(),
                        *size,
                        *mtime,
                        existing_etag,
                    )
                })
                .collect();

        // Push assets concurrently
        let push_outcomes: Vec<AssetPushOutcome> = futures_util::stream::iter(push_tasks)
            .map(|(relative_path, abs_path, size, mtime, existing_etag)| {
                let client = client.clone();
                let remote_base = remote_assets_base.clone();
                let sem = Arc::clone(&self.webdav_semaphore);
                async move {
                    let _permit = sem.acquire().await.unwrap();
                    let remote_path = format!("{}/{}", remote_base, relative_path);
                    log::info!("Asset sync: pushing {}", relative_path);

                    let put_result = client
                        .put_file(&remote_path, &abs_path, existing_etag.as_deref())
                        .await;

                    match put_result {
                        Ok(resp) if resp.conflict => {
                            log::info!("Asset sync: conflict on {}, re-uploading", relative_path);
                            match client.put_file(&remote_path, &abs_path, None).await {
                                Ok(resp2) => AssetPushOutcome {
                                    relative_path,
                                    success: true,
                                    sync_mark: Some((resp2.etag, size, mtime)),
                                },
                                Err(e) => {
                                    log::error!("Asset sync: failed to push {} after conflict: {}", relative_path, e);
                                    AssetPushOutcome { relative_path, success: false, sync_mark: None }
                                }
                            }
                        }
                        Ok(resp) => AssetPushOutcome {
                            relative_path,
                            success: true,
                            sync_mark: Some((resp.etag, size, mtime)),
                        },
                        Err(e) => {
                            log::error!("Asset sync: failed to push {}: {}", relative_path, e);
                            AssetPushOutcome { relative_path, success: false, sync_mark: None }
                        }
                    }
                }
            })
            .buffer_unordered(DEFAULT_WEBDAV_CONCURRENCY)
            .collect()
            .await;

        // Apply push outcomes
        for outcome in push_outcomes {
            if outcome.success {
                if let Some((etag, size, mtime)) = outcome.sync_mark {
                    local_state.mark_asset_synced(&outcome.relative_path, etag, size, mtime);
                }
                result.assets_pushed += 1;
            }
        }

        // 5. Pull: collect assets that need pulling
        let pull_tasks: Vec<(String, PathBuf, Option<String>)> = remote_map
            .iter()
            .filter_map(|(relative_path, remote_info)| {
                let local_path = assets_dir.join(relative_path);
                let is_locally_present = local_path.exists();

                let should_pull = if !is_locally_present {
                    true
                } else {
                    match local_state.assets.get(relative_path) {
                        Some(asset_state) => {
                            let remote_etag_changed = remote_info.etag.as_deref()
                                != asset_state.remote_etag.as_deref();
                            let local_modified = local_assets.get(relative_path)
                                .map(|(_, size, mtime)| {
                                    local_state.asset_needs_push(relative_path, *size, *mtime)
                                })
                                .unwrap_or(false);
                            remote_etag_changed && !local_modified
                        }
                        None => {
                            let local_size = local_assets.get(relative_path).map(|(_, s, _)| *s);
                            let remote_size = remote_info.content_length;
                            match (local_size, remote_size) {
                                (Some(ls), Some(rs)) if ls == rs => false,
                                _ => true,
                            }
                        }
                    }
                };

                if !should_pull {
                    // Register untracked same-size files in state
                    if !local_state.assets.contains_key(relative_path) {
                        if let Some((_, size, _mtime)) = local_assets.get(relative_path) {
                            if let Some(remote_size) = remote_info.content_length {
                                if *size == remote_size {
                                    // Will handle in apply phase
                                }
                            }
                        }
                    }
                    return None;
                }

                Some((
                    relative_path.clone(),
                    local_path,
                    remote_info.etag.clone(),
                ))
            })
            .collect();

        // Pull assets concurrently
        let pull_outcomes: Vec<AssetPullOutcome> = futures_util::stream::iter(pull_tasks)
            .map(|(relative_path, local_path, _remote_etag)| {
                let client = client.clone();
                let remote_base = remote_assets_base.clone();
                let sem = Arc::clone(&self.webdav_semaphore);
                async move {
                    let _permit = sem.acquire().await.unwrap();
                    let remote_path_full = format!("{}/{}", remote_base, relative_path);
                    log::info!("Asset sync: pulling {}", relative_path);

                    match client.get_to_file(&remote_path_full, &local_path).await {
                        Ok(etag) => {
                            let metadata = std::fs::metadata(&local_path).ok();
                            let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                            let mtime = metadata
                                .and_then(|m| m.modified().ok())
                                .map(|t| DateTime::<Utc>::from(t));
                            AssetPullOutcome {
                                relative_path,
                                success: true,
                                sync_mark: Some((etag, size, mtime)),
                            }
                        }
                        Err(e) => {
                            log::error!("Asset sync: failed to pull {}: {}", relative_path, e);
                            AssetPullOutcome { relative_path, success: false, sync_mark: None }
                        }
                    }
                }
            })
            .buffer_unordered(DEFAULT_WEBDAV_CONCURRENCY)
            .collect()
            .await;

        // Apply pull outcomes
        for outcome in pull_outcomes {
            if outcome.success {
                if let Some((etag, size, mtime)) = outcome.sync_mark {
                    local_state.mark_asset_synced(&outcome.relative_path, etag, size, mtime);
                }
                result.assets_pulled += 1;
            }
        }

        log::info!(
            "Asset sync complete: {} pushed, {} pulled",
            result.assets_pushed,
            result.assets_pulled,
        );

        Ok(result)
    }

    // ===== Content-addressable asset sync =====

    /// Sync assets using content-addressable storage (CAS).
    /// Falls back gracefully if remote has no asset-manifest.json.
    async fn sync_assets_cas(
        &self,
        client: &WebDAVClient,
        config: &super::config::SyncConfig,
        local_state: &mut LocalSyncState,
        notebook_id: Uuid,
        library_base_path: &str,
    ) -> Result<AssetSyncResult, SyncError> {
        let assets_dir = self.assets_dir(notebook_id);
        let manifest_path = format!("{}/asset-manifest.json", config.remote_path);

        // 1. Discover local assets with hashes
        let local_assets = Self::discover_local_assets(&assets_dir);
        log::info!(
            "CAS asset sync: discovered {} local assets for notebook {}",
            local_assets.len(),
            notebook_id,
        );

        // 2. Fetch remote asset manifest (if exists)
        let remote_manifest: AssetManifest = match client.get(&manifest_path).await {
            Ok(data) => serde_json::from_slice(&data).unwrap_or_default(),
            Err(WebDAVError::NotFound(_)) => HashMap::new(),
            Err(e) => {
                // Can't reach manifest — fall back to legacy
                return Err(e.into());
            }
        };

        let mut result = AssetSyncResult::default();
        let mut local_manifest: AssetManifest = remote_manifest.clone();
        let mut manifest_changed = false;

        // Ensure CAS directory exists
        let _ = client.mkdir_p(&format!("{}/cas", library_base_path)).await;

        // 3. Push: compute hash for each local asset and upload to CAS if missing
        let push_tasks: Vec<(String, PathBuf, u64, Option<DateTime<Utc>>, String, String)> =
            local_assets
                .iter()
                .filter_map(|(relative_path, (abs_path, size, mtime))| {
                    // Check if asset needs push (locally changed)
                    // OR if it's missing from the remote manifest (remote was reset/empty)
                    let missing_from_remote = !remote_manifest.contains_key(relative_path);
                    if !local_state.asset_needs_push(relative_path, *size, *mtime)
                        && !missing_from_remote
                    {
                        return None;
                    }

                    // Compute or use cached hash
                    let cached_hash = local_state
                        .assets
                        .get(relative_path)
                        .and_then(|s| s.content_hash.clone());

                    let hash = if let Some(ref h) = cached_hash {
                        // Re-hash if size changed
                        let cached_size = local_state
                            .assets
                            .get(relative_path)
                            .map(|s| s.synced_size)
                            .unwrap_or(0);
                        if cached_size == *size {
                            h.clone()
                        } else {
                            match Self::compute_file_hash(abs_path) {
                                Ok(h) => h,
                                Err(e) => {
                                    log::error!("CAS: failed to hash {}: {}", relative_path, e);
                                    return None;
                                }
                            }
                        }
                    } else {
                        match Self::compute_file_hash(abs_path) {
                            Ok(h) => h,
                            Err(e) => {
                                log::error!("CAS: failed to hash {}: {}", relative_path, e);
                                return None;
                            }
                        }
                    };

                    let ext = abs_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_string();

                    Some((relative_path.clone(), abs_path.clone(), *size, *mtime, hash, ext))
                })
                .collect();

        // Push to CAS concurrently
        for (relative_path, abs_path, size, mtime, hash, ext) in &push_tasks {
            let cas_path = Self::cas_remote_path(library_base_path, hash, ext);

            // Check if already in CAS (HEAD)
            let _permit = self.webdav_semaphore.acquire().await.unwrap();
            let exists = match client.head(&cas_path).await {
                Ok(h) => h.exists,
                Err(_) => false,
            };

            if !exists {
                // Ensure prefix directory exists
                let prefix = &hash[..2.min(hash.len())];
                let _ = client.mkdir_p(&format!("{}/cas/{}", library_base_path, prefix)).await;

                log::info!("CAS: uploading {} -> {}", relative_path, cas_path);
                match client.put_file(&cas_path, abs_path, None).await {
                    Ok(_) => {
                        result.assets_pushed += 1;
                    }
                    Err(e) => {
                        log::error!("CAS: failed to upload {}: {}", relative_path, e);
                        continue;
                    }
                }
            } else {
                log::debug!("CAS: {} already in store (dedup)", relative_path);
            }

            // Update manifest
            local_manifest.insert(
                relative_path.clone(),
                AssetManifestEntry {
                    hash: hash.clone(),
                    size: *size,
                    ext: ext.clone(),
                },
            );
            manifest_changed = true;

            // Update local state with hash
            local_state.mark_asset_synced(relative_path, None, *size, *mtime);
            if let Some(asset_state) = local_state.assets.get_mut(relative_path) {
                asset_state.content_hash = Some(hash.clone());
            }
        }

        // 4. Pull: check remote manifest entries missing locally
        for (relative_path, entry) in &remote_manifest {
            let local_path = assets_dir.join(relative_path);

            if local_path.exists() {
                // Check if local file hash matches
                let local_hash = local_state
                    .assets
                    .get(relative_path)
                    .and_then(|s| s.content_hash.clone());

                if local_hash.as_deref() == Some(&entry.hash) {
                    continue; // Already have the right content
                }

                // Size check as quick filter
                if let Ok(meta) = std::fs::metadata(&local_path) {
                    if meta.len() == entry.size {
                        // Probably the same, compute hash to verify
                        if let Ok(hash) = Self::compute_file_hash(&local_path) {
                            if hash == entry.hash {
                                // Update cached hash
                                if let Some(asset_state) = local_state.assets.get_mut(relative_path) {
                                    asset_state.content_hash = Some(hash);
                                }
                                continue;
                            }
                        }
                    }
                }
            }

            // Need to download from CAS
            let cas_path = Self::cas_remote_path(library_base_path, &entry.hash, &entry.ext);
            log::info!("CAS: pulling {} from {}", relative_path, cas_path);

            let _permit = self.webdav_semaphore.acquire().await.unwrap();
            match client.get_to_file(&cas_path, &local_path).await {
                Ok(etag) => {
                    let metadata = std::fs::metadata(&local_path).ok();
                    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                    let mtime = metadata
                        .and_then(|m| m.modified().ok())
                        .map(|t| DateTime::<Utc>::from(t));
                    local_state.mark_asset_synced(relative_path, etag, size, mtime);
                    if let Some(asset_state) = local_state.assets.get_mut(relative_path) {
                        asset_state.content_hash = Some(entry.hash.clone());
                    }
                    result.assets_pulled += 1;
                }
                Err(e) => {
                    log::error!("CAS: failed to pull {}: {}", relative_path, e);
                }
            }
        }

        // 5. Push updated manifest if changed
        if manifest_changed {
            let data = serde_json::to_vec_pretty(&local_manifest)?;
            if let Err(e) = client.put(&manifest_path, &data, None).await {
                log::warn!("CAS: failed to push asset-manifest.json: {}", e);
            } else {
                log::info!(
                    "CAS: pushed asset-manifest.json with {} entries",
                    local_manifest.len(),
                );
            }
        }

        log::info!(
            "CAS asset sync complete: {} pushed, {} pulled",
            result.assets_pushed,
            result.assets_pulled,
        );

        Ok(result)
    }

    /// Disable sync for a notebook
    pub fn disable_sync(
        &self,
        notebook_id: Uuid,
        storage: &SharedStorage,
    ) -> Result<(), SyncError> {
        // Remove credentials
        self.delete_credentials(notebook_id)?;

        // Clear queue
        {
            let mut queue = self.queue.lock().unwrap();
            queue.clear_notebook(notebook_id);
        }
        self.save_queue()?;

        // Update notebook config
        {
            let storage_guard = storage.lock().unwrap();
            let mut notebook = storage_guard.get_notebook(notebook_id)?;
            notebook.sync_config = None;
            storage_guard.update_notebook(&notebook)?;
        }

        // Remove from local states
        {
            let mut states = self.local_states.lock().unwrap();
            states.remove(&notebook_id);
        }

        // Remove client
        {
            let mut clients = self.clients.lock().unwrap();
            clients.remove(&notebook_id);
        }

        Ok(())
    }

    /// Get queue items for a notebook
    pub fn get_queue_items(&self, notebook_id: Uuid) -> Vec<super::queue::QueueItem> {
        let queue = self.queue.lock().unwrap();
        queue
            .get_notebook_items(notebook_id)
            .into_iter()
            .cloned()
            .collect()
    }

    // ===== Library-level sync methods =====

    /// Get library credentials: try file first, then keyring
    fn get_library_credentials(&self, library_id: Uuid) -> Result<SyncCredentials, SyncError> {
        // Try file-based store first
        let file_path = self.credentials_file_path("nous-library-sync", library_id);
        if let Ok(data) = std::fs::read_to_string(&file_path) {
            return Self::parse_credentials(data.trim());
        }

        // Fall back to keyring
        let entry = keyring::Entry::new("nous-library-sync", &library_id.to_string())
            .map_err(|e| SyncError::Keyring(e.to_string()))?;

        let password = entry
            .get_password()
            .map_err(|_| SyncError::CredentialsNotFound)?;

        Self::parse_credentials(&password)
    }

    /// Store library credentials: write to file, also try keyring
    fn store_library_credentials(
        &self,
        library_id: Uuid,
        username: &str,
        password: &str,
    ) -> Result<(), SyncError> {
        let value = format!("{}:{}", username, password);

        // Always write to file-based store
        let file_path = self.credentials_file_path("nous-library-sync", library_id);
        if let Some(parent) = file_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&file_path, &value)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&file_path, std::fs::Permissions::from_mode(0o600));
        }

        // Also try keyring (best-effort)
        if let Ok(entry) = keyring::Entry::new("nous-library-sync", &library_id.to_string()) {
            let _ = entry.set_password(&value);
        }

        Ok(())
    }

    /// Delete library credentials from both stores
    fn delete_library_credentials(&self, library_id: Uuid) -> Result<(), SyncError> {
        let file_path = self.credentials_file_path("nous-library-sync", library_id);
        let _ = std::fs::remove_file(&file_path);

        if let Ok(entry) = keyring::Entry::new("nous-library-sync", &library_id.to_string()) {
            let _ = entry.delete_credential();
        }
        Ok(())
    }

    /// Configure library-level sync for all notebooks
    pub async fn configure_library_sync(
        &self,
        library_id: Uuid,
        library_storage: &SharedLibraryStorage,
        storage: &SharedStorage,
        input: LibrarySyncConfigInput,
    ) -> Result<(), SyncError> {
        // Test connection first
        let success = self
            .test_connection(&input.server_url, &input.username, &input.password)
            .await?;

        if !success {
            return Err(SyncError::WebDAV(super::webdav::WebDAVError::AuthFailed));
        }

        // Store library credentials in keyring
        self.store_library_credentials(library_id, &input.username, &input.password)?;

        // Detect server type
        let creds = SyncCredentials {
            username: input.username.clone(),
            password: input.password.clone(),
        };
        let detect_client = WebDAVClient::new(input.server_url.clone(), creds)?;
        let server_type = Self::detect_server_type(&detect_client, &input.server_url).await;
        log::info!("configure_library_sync: detected server type: {:?}", server_type);

        // Build library sync config
        let config = LibrarySyncConfig {
            enabled: true,
            server_url: input.server_url.clone(),
            remote_base_path: input.remote_base_path.clone(),
            auth_type: input.auth_type.clone(),
            sync_mode: input.sync_mode.clone(),
            sync_interval: input.sync_interval,
            server_type,
        };

        // Save config on library
        {
            let lib_storage = library_storage.lock().unwrap();
            lib_storage
                .update_library_sync_config(library_id, Some(config.clone()))
                .map_err(|e| SyncError::IO(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        }

        // Create library-level CAS directory
        let creds = self.get_library_credentials(library_id)?;
        let cas_client = WebDAVClient::new(config.server_url.clone(), creds)?;
        let _ = cas_client.mkdir_p(&format!("{}/cas", config.remote_base_path)).await;

        // Apply to all existing notebooks
        let notebooks = {
            let storage_guard = storage.lock().unwrap();
            storage_guard.list_notebooks().unwrap_or_default()
        };

        log::info!(
            "configure_library_sync: applying to {} notebooks",
            notebooks.len(),
        );

        let mut applied = 0;
        let mut failed = 0;
        for notebook in &notebooks {
            match self
                .apply_library_sync_to_notebook(
                    library_id,
                    notebook.id,
                    &config,
                    storage,
                )
                .await
            {
                Ok(()) => applied += 1,
                Err(e) => {
                    failed += 1;
                    log::warn!(
                        "Failed to apply library sync to notebook '{}' ({}): {}",
                        notebook.name,
                        notebook.id,
                        e
                    );
                }
            }
        }

        log::info!(
            "configure_library_sync: applied={}, failed={}",
            applied,
            failed,
        );

        Ok(())
    }

    /// Apply library sync config to a single notebook (no connection test)
    pub async fn apply_library_sync_to_notebook(
        &self,
        library_id: Uuid,
        notebook_id: Uuid,
        library_config: &LibrarySyncConfig,
        storage: &SharedStorage,
    ) -> Result<(), SyncError> {
        // Get library credentials and copy to notebook keyring
        let creds = self.get_library_credentials(library_id)?;
        self.store_credentials(notebook_id, &creds.username, &creds.password)?;

        // Build per-notebook sync config
        let remote_path = format!("{}/{}", library_config.remote_base_path, notebook_id);
        let config = SyncConfig {
            enabled: true,
            server_url: library_config.server_url.clone(),
            remote_path: remote_path.clone(),
            auth_type: library_config.auth_type.clone(),
            sync_mode: library_config.sync_mode.clone(),
            sync_interval: library_config.sync_interval,
            last_sync: None,
            managed_by_library: Some(true),
            server_type: library_config.server_type.clone(),
        };

        // Update notebook
        {
            let storage_guard = storage.lock().unwrap();
            let mut notebook = storage_guard.get_notebook(notebook_id)?;
            notebook.sync_config = Some(config.clone());
            storage_guard.update_notebook(&notebook)?;
        }

        // Create remote directory structure
        let client = WebDAVClient::new(config.server_url.clone(), creds)?;
        client
            .mkdir_p(&format!("{}/pages", remote_path))
            .await?;
        client
            .mkdir_p(&format!("{}/assets", remote_path))
            .await?;

        // Initialize local state
        let state = LocalSyncState::new(notebook_id);
        self.save_local_state(notebook_id, &state)?;

        log::info!(
            "Applied library sync to notebook {} (remote: {})",
            notebook_id,
            remote_path
        );

        Ok(())
    }

    /// Disable library-level sync for all notebooks
    pub fn disable_library_sync(
        &self,
        library_id: Uuid,
        library_storage: &SharedLibraryStorage,
        storage: &SharedStorage,
    ) -> Result<(), SyncError> {
        // Get all notebooks and disable sync for library-managed ones
        let notebooks = {
            let storage_guard = storage.lock().unwrap();
            storage_guard.list_notebooks().unwrap_or_default()
        };

        for notebook in &notebooks {
            let is_managed = notebook
                .sync_config
                .as_ref()
                .and_then(|c| c.managed_by_library)
                .unwrap_or(false);

            if is_managed {
                if let Err(e) = self.disable_sync(notebook.id, storage) {
                    log::warn!(
                        "Failed to disable sync for notebook {}: {}",
                        notebook.id,
                        e
                    );
                }
            }
        }

        // Delete library credentials from keyring
        self.delete_library_credentials(library_id)?;

        // Clear sync config on library
        {
            let lib_storage = library_storage.lock().unwrap();
            lib_storage
                .update_library_sync_config(library_id, None)
                .map_err(|e| SyncError::IO(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        }

        log::info!("Disabled library sync for library {}", library_id);
        Ok(())
    }

    /// Discover notebooks that exist on the remote but not locally.
    async fn discover_remote_notebooks(
        &self,
        library_id: Uuid,
        library_config: &LibrarySyncConfig,
        storage: &SharedStorage,
    ) -> Result<Vec<Uuid>, SyncError> {
        log::info!(
            "discover_remote_notebooks: server_url='{}', remote_base_path='{}'",
            library_config.server_url,
            library_config.remote_base_path,
        );

        let creds = self.get_library_credentials(library_id)?;
        let client = WebDAVClient::new(library_config.server_url.clone(), creds)?;

        // PROPFIND base path with depth=1 to list child directories
        let entries = match client.propfind(&library_config.remote_base_path, 1).await {
            Ok(entries) => entries,
            Err(e) => {
                log::info!(
                    "discover_remote_notebooks: PROPFIND on '{}' failed: {}. Proceeding with local-only sync.",
                    library_config.remote_base_path,
                    e,
                );
                return Ok(Vec::new());
            }
        };

        log::info!(
            "discover_remote_notebooks: PROPFIND returned {} entries",
            entries.len(),
        );

        let collections: Vec<&super::webdav::ResourceInfo> =
            entries.iter().filter(|e| e.is_collection).collect();
        log::info!(
            "discover_remote_notebooks: {} collections out of {} entries",
            collections.len(),
            entries.len(),
        );

        // Collect UUIDs from collection entries
        let remote_notebook_ids: Vec<Uuid> = entries
            .iter()
            .filter(|e| e.is_collection)
            .filter_map(|e| {
                let path = e.path.trim_end_matches('/');
                let name = path.rsplit('/').next()?;
                let parsed = Uuid::parse_str(name).ok();
                if parsed.is_none() {
                    log::debug!(
                        "discover_remote_notebooks: skipping non-UUID collection entry: path='{}', extracted='{}'",
                        e.path,
                        name,
                    );
                }
                parsed
            })
            .collect();

        log::info!(
            "discover_remote_notebooks: found {} UUID-named remote notebooks",
            remote_notebook_ids.len(),
        );

        if remote_notebook_ids.is_empty() && !entries.is_empty() {
            for entry in &entries {
                log::info!(
                    "discover_remote_notebooks: entry path='{}', is_collection={}",
                    entry.path,
                    entry.is_collection,
                );
            }
        }

        // Get local notebook IDs
        let local_notebook_ids: HashSet<Uuid> = {
            let storage_guard = storage.lock().unwrap();
            storage_guard
                .list_notebooks()
                .unwrap_or_default()
                .iter()
                .map(|n| n.id)
                .collect()
        };

        let mut created = Vec::new();

        for notebook_id in remote_notebook_ids {
            if local_notebook_ids.contains(&notebook_id) {
                continue;
            }

            log::info!(
                "discover_remote_notebooks: found remote-only notebook {}",
                notebook_id,
            );

            let remote_path = format!("{}/{}", library_config.remote_base_path, notebook_id);
            let creds = self.get_library_credentials(library_id)?;
            let nb_client = WebDAVClient::new(library_config.server_url.clone(), creds)?;

            let (name, notebook_type, meta) = match self.fetch_notebook_meta(&nb_client, &remote_path).await {
                Ok(meta) => (meta.name.clone(), meta.notebook_type.clone(), Some(meta)),
                Err(e) => {
                    log::info!(
                        "discover_remote_notebooks: no notebook-meta.json for {}: {}. Using defaults.",
                        notebook_id,
                        e,
                    );
                    let short_id = &notebook_id.to_string()[..8];
                    (
                        format!("Synced Notebook {}", short_id),
                        NotebookType::default(),
                        None,
                    )
                }
            };

            let now = Utc::now();
            let mut notebook = Notebook::new(name, notebook_type);
            notebook.id = notebook_id;
            notebook.created_at = now;
            notebook.updated_at = now;

            if let Some(meta) = meta {
                notebook.icon = meta.icon;
                notebook.color = meta.color;
                notebook.sections_enabled = meta.sections_enabled;
                notebook.archived = meta.archived;
                notebook.system_prompt = meta.system_prompt;
                notebook.system_prompt_mode = meta.system_prompt_mode;
                notebook.ai_provider = meta.ai_provider;
                notebook.ai_model = meta.ai_model;
            }

            {
                let storage_guard = storage.lock().unwrap();
                if let Err(e) = storage_guard.create_notebook_with_id(&notebook) {
                    log::error!(
                        "discover_remote_notebooks: failed to create notebook {}: {}",
                        notebook_id,
                        e,
                    );
                    continue;
                }
            }

            if let Err(e) = self
                .apply_library_sync_to_notebook(library_id, notebook_id, library_config, storage)
                .await
            {
                log::error!(
                    "discover_remote_notebooks: failed to apply sync config to {}: {}",
                    notebook_id,
                    e,
                );
                continue;
            }

            log::info!(
                "discover_remote_notebooks: created local notebook '{}' ({})",
                notebook.name,
                notebook_id,
            );
            created.push(notebook_id);
        }

        Ok(created)
    }

    // ===== Goal sync methods =====

    /// Sync goal definitions with remote.
    /// Returns true if local goals were changed.
    async fn sync_goals(
        &self,
        client: &WebDAVClient,
        library_base_path: &str,
        goals_storage: &SharedGoalsStorage,
    ) -> Result<bool, SyncError> {
        let remote_path = format!("{}/goals/goals.json", library_base_path);

        // Read local goals
        let local_goals = {
            let gs = goals_storage.lock().unwrap();
            gs.list_goals().unwrap_or_default()
        };

        // Fetch remote goals
        let remote_goals: Vec<Goal> = match client.get(&remote_path).await {
            Ok(data) => serde_json::from_slice(&data).unwrap_or_default(),
            Err(WebDAVError::NotFound(_)) => Vec::new(),
            Err(e) => return Err(e.into()),
        };

        // Build maps by ID
        let mut local_map: HashMap<Uuid, Goal> = local_goals.iter().map(|g| (g.id, g.clone())).collect();
        let remote_map: HashMap<Uuid, Goal> = remote_goals.iter().map(|g| (g.id, g.clone())).collect();

        let mut merged_changed = false;

        // Merge remote-only goals into local
        for (id, remote_goal) in &remote_map {
            match local_map.get(id) {
                None => {
                    // Remote only — pull it
                    local_map.insert(*id, remote_goal.clone());
                    merged_changed = true;
                }
                Some(local_goal) => {
                    // Both exist — newer updated_at wins
                    if remote_goal.updated_at > local_goal.updated_at {
                        local_map.insert(*id, remote_goal.clone());
                        merged_changed = true;
                    }
                }
            }
        }

        // Build merged list (preserving insertion order by sorting by created_at)
        let mut merged: Vec<Goal> = local_map.into_values().collect();
        merged.sort_by_key(|g| g.created_at);

        // Check if remote needs updating (local-only goals or local wins)
        let remote_needs_update = merged.len() != remote_goals.len()
            || merged.iter().any(|g| !remote_map.contains_key(&g.id))
            || merged.iter().any(|g| {
                remote_map.get(&g.id).map_or(false, |r| g.updated_at > r.updated_at)
            });

        // Write back locally if changed
        if merged_changed {
            let gs = goals_storage.lock().unwrap();
            gs.replace_goals(&merged).map_err(SyncError::Storage)?;
        }

        // Push merged to remote if remote differs
        if remote_needs_update || merged_changed {
            let data = serde_json::to_vec_pretty(&merged)?;
            // Ensure remote directory exists
            let _ = client.mkdir_p(&format!("{}/goals", library_base_path)).await;
            client.put(&remote_path, &data, None).await?;
        }

        Ok(merged_changed)
    }

    /// Sync progress data for a set of goals.
    /// Returns true if any local progress was changed.
    async fn sync_goal_progress(
        &self,
        client: &WebDAVClient,
        library_base_path: &str,
        goals_storage: &SharedGoalsStorage,
        goal_ids: &[Uuid],
    ) -> Result<bool, SyncError> {
        let mut any_local_changed = false;

        // Ensure remote progress directory exists
        let _ = client
            .mkdir_p(&format!("{}/goals/progress", library_base_path))
            .await;

        for goal_id in goal_ids {
            let remote_path = format!(
                "{}/goals/progress/{}.json",
                library_base_path, goal_id
            );

            // Read local progress
            let local_entries = {
                let gs = goals_storage.lock().unwrap();
                gs.get_progress(*goal_id).unwrap_or_default()
            };

            // Fetch remote progress
            let remote_entries: Vec<GoalProgress> = match client.get(&remote_path).await {
                Ok(data) => serde_json::from_slice(&data).unwrap_or_default(),
                Err(WebDAVError::NotFound(_)) => Vec::new(),
                Err(e) => {
                    log::warn!("Failed to fetch remote progress for goal {}: {}", goal_id, e);
                    continue;
                }
            };

            if local_entries.is_empty() && remote_entries.is_empty() {
                continue;
            }

            // Build maps by date
            let mut merged_map: HashMap<chrono::NaiveDate, GoalProgress> =
                local_entries.iter().map(|p| (p.date, p.clone())).collect();
            let remote_map: HashMap<chrono::NaiveDate, GoalProgress> =
                remote_entries.iter().map(|p| (p.date, p.clone())).collect();

            let mut local_changed = false;

            for (date, remote_entry) in &remote_map {
                match merged_map.get(date) {
                    None => {
                        // Remote only — include it
                        merged_map.insert(*date, remote_entry.clone());
                        local_changed = true;
                    }
                    Some(local_entry) => {
                        // Both exist — prefer completed=true, take max value
                        let merged_completed = local_entry.completed || remote_entry.completed;
                        let merged_value = match (local_entry.value, remote_entry.value) {
                            (Some(a), Some(b)) => Some(a.max(b)),
                            (Some(a), None) => Some(a),
                            (None, Some(b)) => Some(b),
                            (None, None) => None,
                        };
                        let merged_auto = local_entry.auto_detected || remote_entry.auto_detected;

                        if merged_completed != local_entry.completed
                            || merged_value != local_entry.value
                            || merged_auto != local_entry.auto_detected
                        {
                            merged_map.insert(
                                *date,
                                GoalProgress {
                                    goal_id: *goal_id,
                                    date: *date,
                                    completed: merged_completed,
                                    auto_detected: merged_auto,
                                    value: merged_value,
                                },
                            );
                            local_changed = true;
                        }
                    }
                }
            }

            // Build sorted merged list
            let mut merged: Vec<GoalProgress> = merged_map.into_values().collect();
            merged.sort_by_key(|p| p.date);

            // Check if remote needs updating
            let remote_needs_update = merged.len() != remote_entries.len()
                || merged.iter().any(|p| !remote_map.contains_key(&p.date));

            // Write back locally if changed
            if local_changed {
                let gs = goals_storage.lock().unwrap();
                gs.replace_progress(*goal_id, &merged)
                    .map_err(SyncError::Storage)?;
                any_local_changed = true;
            }

            // Push merged to remote if needed
            if remote_needs_update || local_changed {
                let data = serde_json::to_vec_pretty(&merged)?;
                if let Err(e) = client.put(&remote_path, &data, None).await {
                    log::warn!("Failed to push progress for goal {}: {}", goal_id, e);
                }
            }
        }

        Ok(any_local_changed)
    }

    // ===== Inbox sync methods =====

    /// Sync inbox items with remote.
    /// Returns true if local inbox was changed.
    async fn sync_inbox(
        &self,
        client: &WebDAVClient,
        library_base_path: &str,
        inbox_storage: &SharedInboxStorage,
    ) -> Result<bool, SyncError> {
        let remote_path = format!("{}/inbox/inbox.json", library_base_path);

        // Read local inbox items
        let local_items = {
            let is = inbox_storage.lock().unwrap();
            is.list_items().unwrap_or_default()
        };

        // Fetch remote inbox items
        let remote_items: Vec<InboxItem> = match client.get(&remote_path).await {
            Ok(data) => serde_json::from_slice(&data).unwrap_or_default(),
            Err(WebDAVError::NotFound(_)) => Vec::new(),
            Err(e) => return Err(e.into()),
        };

        // Build maps by ID
        let mut local_map: HashMap<Uuid, InboxItem> =
            local_items.iter().map(|i| (i.id, i.clone())).collect();
        let remote_map: HashMap<Uuid, InboxItem> =
            remote_items.iter().map(|i| (i.id, i.clone())).collect();

        let mut merged_changed = false;

        // Merge remote-only items into local
        for (id, remote_item) in &remote_map {
            match local_map.get(id) {
                None => {
                    // Remote only — pull it
                    local_map.insert(*id, remote_item.clone());
                    merged_changed = true;
                }
                Some(local_item) => {
                    // Both exist — newer updated_at wins
                    if remote_item.updated_at > local_item.updated_at {
                        local_map.insert(*id, remote_item.clone());
                        merged_changed = true;
                    }
                }
            }
        }

        // Build merged list (sort by captured_at, newest first)
        let mut merged: Vec<InboxItem> = local_map.into_values().collect();
        merged.sort_by(|a, b| b.captured_at.cmp(&a.captured_at));

        // Check if remote needs updating (local-only items or local wins)
        let remote_needs_update = merged.len() != remote_items.len()
            || merged.iter().any(|i| !remote_map.contains_key(&i.id))
            || merged
                .iter()
                .any(|i| remote_map.get(&i.id).map_or(false, |r| i.updated_at > r.updated_at));

        // Write back locally if changed
        if merged_changed {
            let is = inbox_storage.lock().unwrap();
            is.replace_items(&merged).map_err(SyncError::Storage)?;
        }

        // Push merged to remote if remote differs
        if remote_needs_update || merged_changed {
            let data = serde_json::to_vec_pretty(&merged)?;
            // Ensure remote directory exists
            let _ = client.mkdir_p(&format!("{}/inbox", library_base_path)).await;
            client.put(&remote_path, &data, None).await?;
        }

        Ok(merged_changed)
    }

    /// Sync all notebooks in a library (notebooks synced concurrently)
    pub async fn sync_library(
        &self,
        library_id: Uuid,
        library_storage: &SharedLibraryStorage,
        storage: &SharedStorage,
        goals_storage: &SharedGoalsStorage,
        inbox_storage: &SharedInboxStorage,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<SyncResult, SyncError> {
        let start = std::time::Instant::now();

        // Get library sync config
        let library_config = {
            let lib_storage = library_storage.lock().unwrap();
            lib_storage
                .get_library(library_id)
                .ok()
                .and_then(|lib| lib.sync_config)
        };

        // Discover remote-only notebooks before iterating local ones
        if let Some(ref lib_config) = library_config {
            match self
                .discover_remote_notebooks(library_id, lib_config, storage)
                .await
            {
                Ok(created) if !created.is_empty() => {
                    log::info!(
                        "Library sync: discovered {} remote notebooks",
                        created.len(),
                    );
                }
                Ok(_) => {
                    log::info!("Library sync: remote discovery found no new notebooks");
                }
                Err(e) => {
                    log::info!("Library sync: remote notebook discovery failed: {}", e);
                }
            }
        }

        // Re-read notebook list (includes any newly discovered notebooks)
        let notebooks = {
            let storage_guard = storage.lock().unwrap();
            storage_guard.list_notebooks().unwrap_or_default()
        };

        log::info!(
            "Library sync: found {} total notebooks, library_config={}",
            notebooks.len(),
            if library_config.is_some() { "present" } else { "none" },
        );

        // Apply library config to unmanaged notebooks (sequential, as it creates remote dirs)
        let mut notebook_ids_to_sync: Vec<Uuid> = Vec::new();

        for notebook in &notebooks {
            let is_managed = notebook
                .sync_config
                .as_ref()
                .and_then(|c| c.managed_by_library)
                .unwrap_or(false);
            let is_enabled = notebook
                .sync_config
                .as_ref()
                .map(|c| c.enabled)
                .unwrap_or(false);

            if !is_managed {
                if let Some(ref lib_config) = library_config {
                    log::info!(
                        "Library sync: auto-applying config to notebook '{}' ({})",
                        notebook.name,
                        notebook.id,
                    );
                    match self
                        .apply_library_sync_to_notebook(
                            library_id,
                            notebook.id,
                            lib_config,
                            storage,
                        )
                        .await
                    {
                        Ok(()) => {
                            log::info!(
                                "Library sync: auto-applied to '{}' successfully",
                                notebook.name,
                            );
                            notebook_ids_to_sync.push(notebook.id);
                        }
                        Err(e) => {
                            log::warn!(
                                "Library sync: failed to auto-apply to '{}': {}",
                                notebook.name,
                                e,
                            );
                        }
                    }
                } else {
                    log::info!(
                        "Library sync: notebook '{}' ({}): not managed, no library config — skipping",
                        notebook.name,
                        notebook.id,
                    );
                }
            } else if is_enabled {
                notebook_ids_to_sync.push(notebook.id);
            } else {
                log::info!(
                    "Library sync: notebook '{}' ({}): managed but disabled — skipping",
                    notebook.name,
                    notebook.id,
                );
            }
        }

        log::info!(
            "Library sync: {} notebooks to sync concurrently",
            notebook_ids_to_sync.len(),
        );

        // Sync notebooks concurrently with buffer_unordered
        let total_pulled = Arc::new(AtomicUsize::new(0));
        let total_pushed = Arc::new(AtomicUsize::new(0));
        let total_conflicts = Arc::new(AtomicUsize::new(0));
        let total_assets_pushed = Arc::new(AtomicUsize::new(0));
        let total_assets_pulled = Arc::new(AtomicUsize::new(0));
        let errors: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

        let results: Vec<()> = futures_util::stream::iter(notebook_ids_to_sync)
            .map(|notebook_id| {
                let storage = Arc::clone(storage);
                let app = app_handle.cloned();
                let tp = Arc::clone(&total_pulled);
                let tps = Arc::clone(&total_pushed);
                let tc = Arc::clone(&total_conflicts);
                let tap = Arc::clone(&total_assets_pushed);
                let tapl = Arc::clone(&total_assets_pulled);
                let errs = Arc::clone(&errors);
                async move {
                    let nb_name = {
                        let sg = storage.lock().unwrap();
                        sg.get_notebook(notebook_id)
                            .map(|n| n.name.clone())
                            .unwrap_or_else(|_| notebook_id.to_string())
                    };

                    log::info!("Library sync: syncing notebook '{}' ({})", nb_name, notebook_id);

                    match self.sync_notebook(notebook_id, &storage, app.as_ref()).await {
                        Ok(result) => {
                            log::info!(
                                "Library sync: notebook '{}' done: pulled={}, pushed={}, conflicts={}, assets_pushed={}, assets_pulled={}",
                                nb_name,
                                result.pages_pulled,
                                result.pages_pushed,
                                result.conflicts_resolved,
                                result.assets_pushed,
                                result.assets_pulled,
                            );
                            tp.fetch_add(result.pages_pulled, Ordering::Relaxed);
                            tps.fetch_add(result.pages_pushed, Ordering::Relaxed);
                            tc.fetch_add(result.conflicts_resolved, Ordering::Relaxed);
                            tap.fetch_add(result.assets_pushed, Ordering::Relaxed);
                            tapl.fetch_add(result.assets_pulled, Ordering::Relaxed);
                        }
                        Err(e) => {
                            log::warn!("Failed to sync notebook {}: {}", notebook_id, e);
                            let mut err_list = errs.lock().unwrap();
                            err_list.push(format!("{}: {}", nb_name, e));
                        }
                    }
                }
            })
            .buffer_unordered(MAX_NOTEBOOK_CONCURRENCY)
            .collect()
            .await;

        let _ = results; // consumed

        let total_pulled = total_pulled.load(Ordering::Relaxed);
        let total_pushed = total_pushed.load(Ordering::Relaxed);
        let total_conflicts = total_conflicts.load(Ordering::Relaxed);
        let total_assets_pushed = total_assets_pushed.load(Ordering::Relaxed);
        let total_assets_pulled = total_assets_pulled.load(Ordering::Relaxed);
        let errors = errors.lock().unwrap().clone();

        // Sync goals after notebooks
        if let Some(ref lib_config) = library_config {
            match self.get_library_credentials(library_id) {
                Ok(creds) => {
                    match WebDAVClient::new(lib_config.server_url.clone(), creds) {
                        Ok(goals_client) => {
                            let base_path = &lib_config.remote_base_path;

                            let goals_changed = match self
                                .sync_goals(&goals_client, base_path, goals_storage)
                                .await
                            {
                                Ok(changed) => {
                                    log::info!("Library sync: goals sync complete, changed={}", changed);
                                    changed
                                }
                                Err(e) => {
                                    log::warn!("Library sync: goals sync failed: {}", e);
                                    false
                                }
                            };

                            // Collect all goal IDs for progress sync
                            let goal_ids: Vec<Uuid> = {
                                let gs = goals_storage.lock().unwrap();
                                gs.list_goals()
                                    .unwrap_or_default()
                                    .iter()
                                    .map(|g| g.id)
                                    .collect()
                            };

                            let progress_changed = match self
                                .sync_goal_progress(&goals_client, base_path, goals_storage, &goal_ids)
                                .await
                            {
                                Ok(changed) => {
                                    log::info!("Library sync: progress sync complete, changed={}", changed);
                                    changed
                                }
                                Err(e) => {
                                    log::warn!("Library sync: progress sync failed: {}", e);
                                    false
                                }
                            };

                            // Emit event if goals or progress changed
                            if goals_changed || progress_changed {
                                let event_payload = SyncGoalsUpdated {
                                    goals_changed,
                                    progress_changed,
                                };

                                // Try app_handle parameter first, then stored handle
                                let emitted = if let Some(app) = app_handle {
                                    app.emit("sync-goals-updated", event_payload.clone()).is_ok()
                                } else {
                                    false
                                };

                                if !emitted {
                                    let handle_guard = self.app_handle.lock().unwrap();
                                    if let Some(ref handle) = *handle_guard {
                                        let _ = handle.emit("sync-goals-updated", event_payload);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!("Library sync: failed to create WebDAV client for goals: {}", e);
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Library sync: failed to get credentials for goals: {}", e);
                }
            }
        }

        // Sync inbox after goals
        if let Some(ref lib_config) = library_config {
            match self.get_library_credentials(library_id) {
                Ok(creds) => {
                    match WebDAVClient::new(lib_config.server_url.clone(), creds) {
                        Ok(inbox_client) => {
                            let base_path = &lib_config.remote_base_path;

                            let inbox_changed = match self
                                .sync_inbox(&inbox_client, base_path, inbox_storage)
                                .await
                            {
                                Ok(changed) => {
                                    log::info!("Library sync: inbox sync complete, changed={}", changed);
                                    changed
                                }
                                Err(e) => {
                                    log::warn!("Library sync: inbox sync failed: {}", e);
                                    false
                                }
                            };

                            // Emit event if inbox changed
                            if inbox_changed {
                                let event_payload = SyncInboxUpdated { inbox_changed };

                                // Try app_handle parameter first, then stored handle
                                let emitted = if let Some(app) = app_handle {
                                    app.emit("sync-inbox-updated", event_payload.clone()).is_ok()
                                } else {
                                    false
                                };

                                if !emitted {
                                    let handle_guard = self.app_handle.lock().unwrap();
                                    if let Some(ref handle) = *handle_guard {
                                        let _ = handle.emit("sync-inbox-updated", event_payload);
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            log::warn!("Library sync: failed to create WebDAV client for inbox: {}", e);
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Library sync: failed to get credentials for inbox: {}", e);
                }
            }
        }

        log::info!(
            "Library sync complete: pulled={}, pushed={}, conflicts={}, errors={}",
            total_pulled,
            total_pushed,
            total_conflicts,
            errors.len(),
        );

        let duration_ms = start.elapsed().as_millis() as u64;

        if errors.is_empty() {
            Ok(SyncResult::success(
                total_pulled,
                total_pushed,
                total_conflicts,
                duration_ms,
                total_assets_pushed,
                total_assets_pulled,
            ))
        } else {
            Ok(SyncResult {
                success: false,
                pages_pulled: total_pulled,
                pages_pushed: total_pushed,
                conflicts_resolved: total_conflicts,
                error: Some(errors.join("; ")),
                duration_ms,
                assets_pushed: total_assets_pushed,
                assets_pulled: total_assets_pulled,
            })
        }
    }
}
