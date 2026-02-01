use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use thiserror::Error;
use uuid::Uuid;

use tauri::Emitter;

use crate::library::LibraryStorage;
use crate::storage::Page;
use crate::storage::FileStorage;

use crate::storage::{Folder, Notebook, NotebookType, Section};

use super::config::{
    Changelog, ChangeOperation, LibrarySyncConfig, LibrarySyncConfigInput, NotebookMeta, PageMeta,
    SyncConfig, SyncConfigInput, SyncCredentials, SyncManifest, SyncState, SyncStatus, SyncResult,
};
use super::crdt::PageDocument;
use super::metadata::LocalSyncState;
use super::queue::{SyncOperation, SyncQueue};
use super::webdav::{WebDAVClient, WebDAVError};

/// Type alias for shared storage
pub type SharedStorage = Arc<Mutex<FileStorage>>;

/// Type alias for shared library storage
pub type SharedLibraryStorage = Arc<Mutex<LibraryStorage>>;

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
}

impl SyncManager {
    /// Create a new sync manager
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            queue: Arc::new(Mutex::new(SyncQueue::new())),
            local_states: Arc::new(Mutex::new(HashMap::new())),
            clients: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Get the sync directory for a notebook
    fn sync_dir(&self, notebook_id: Uuid) -> PathBuf {
        self.data_dir
            .join("notebooks")
            .join(notebook_id.to_string())
            .join("sync")
    }

    /// Get the CRDT file path for a page
    fn crdt_path(&self, notebook_id: Uuid, page_id: Uuid) -> PathBuf {
        self.sync_dir(notebook_id)
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
        let config = match config {
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

    /// Perform full sync for a notebook
    pub async fn sync_notebook(
        &self,
        notebook_id: Uuid,
        storage: &SharedStorage,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<SyncResult, SyncError> {
        let start = std::time::Instant::now();
        log::info!("Sync: starting notebook {}", notebook_id);

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
            let pages = storage_guard.list_pages(notebook_id)?;
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

        let mut pages_pulled = 0;
        let mut pages_pushed = 0;
        let mut conflicts_resolved = 0;
        let mut synced_page_ids: Vec<(Uuid, PageSyncResult)> = Vec::new();

        // 3. Fetch remote manifest + changelog
        let remote_manifest = self
            .fetch_manifest(&client, &config.remote_path)
            .await;
        match &remote_manifest {
            Ok(m) => log::info!("Sync: remote manifest has {} pages", m.pages.len()),
            Err(e) => log::debug!("Sync: no remote manifest (first sync?): {}", e),
        }
        let manifest_existed = remote_manifest.is_ok();
        let mut manifest = remote_manifest.unwrap_or_else(|_| {
            SyncManifest::new(notebook_id, local_state.client_id.clone())
        });

        let mut changelog = self
            .fetch_changelog(&client, &config.remote_path, notebook_id)
            .await;
        log::info!(
            "Sync: changelog has {} entries, next_seq={}",
            changelog.entries.len(),
            changelog.next_seq,
        );

        // 3b. Fetch remote pages-meta.json for page metadata
        let remote_pages_meta = self
            .fetch_pages_meta(&client, &config.remote_path)
            .await
            .unwrap_or_else(|e| {
                log::debug!("Sync: no remote pages-meta.json: {}", e);
                HashMap::new()
            });
        log::info!("Sync: remote pages-meta has {} entries", remote_pages_meta.len());

        // 4. Determine remote_changed_pages
        let remote_changed_pages: std::collections::HashSet<Uuid> = if local_state.last_changelog_seq > 0
            && !changelog.entries.is_empty()
            && changelog.entries.first().map(|e| e.seq).unwrap_or(0) <= local_state.last_changelog_seq + 1
        {
            // Changelog covers our range — use it for fast change detection
            let new_entries = changelog.entries_since(local_state.last_changelog_seq, &local_state.client_id);
            let page_ids: std::collections::HashSet<Uuid> = new_entries.iter().map(|e| e.page_id).collect();
            log::info!(
                "Sync: changelog-based detection: {} remote changes since seq {}",
                page_ids.len(),
                local_state.last_changelog_seq,
            );
            page_ids
        } else {
            // First sync or changelog compacted past us — fall back to manifest
            let page_ids: std::collections::HashSet<Uuid> = manifest.pages.keys().copied().collect();
            log::info!(
                "Sync: manifest-based detection (fallback): {} potential remote changes",
                page_ids.len(),
            );
            page_ids
        };

        // 5. Sync each local page (with skip optimization)
        let total_pages = local_pages.len();
        for (page_idx, page) in local_pages.iter().enumerate() {
            if let Some(app) = app_handle {
                let _ = app.emit("sync-progress", SyncProgress {
                    notebook_id: notebook_id.to_string(),
                    current: page_idx + 1,
                    total: total_pages,
                    message: format!("Syncing page: {}", page.title),
                    phase: "pages".to_string(),
                });
            }
            let local_needs_sync = local_state.page_needs_sync(page.id);
            // Check page.updated_at against last_synced. If the page has never been
            // synced (no entry in local_state.pages), it definitely needs syncing —
            // this covers the first sync after configuring library sync.
            let never_synced = !local_state.pages.contains_key(&page.id);
            let updated_since_sync = local_state.pages.get(&page.id)
                .and_then(|s| s.last_synced)
                .map(|synced| page.updated_at > synced)
                .unwrap_or(true);
            let remote_may_have_changed = remote_changed_pages.contains(&page.id);

            if !local_needs_sync && !never_synced && !updated_since_sync && !remote_may_have_changed {
                log::debug!("Sync: skipping page '{}' ({}) — no changes", page.title, page.id);
                continue;
            }

            log::info!(
                "Sync: syncing page '{}' ({}) local_needs_sync={} never_synced={} updated_since_sync={} remote_changed={}",
                page.title,
                page.id,
                local_needs_sync,
                never_synced,
                updated_since_sync,
                remote_may_have_changed,
            );
            let result = self
                .sync_page(&client, &config, &mut local_state, storage, notebook_id, page, &manifest)
                .await;
            match &result {
                Ok(r) => log::info!("Sync: page '{}' result: {:?}", page.title, r),
                Err(e) => log::error!("Sync: page '{}' error: {}", page.title, e),
            }
            let result = result?;

            match &result {
                PageSyncResult::Pulled => pages_pulled += 1,
                PageSyncResult::Pushed => pages_pushed += 1,
                PageSyncResult::Merged => {
                    pages_pulled += 1;
                    pages_pushed += 1;
                    conflicts_resolved += 1;
                }
                PageSyncResult::Unchanged => {}
            }
            synced_page_ids.push((page.id, result));
        }

        // 6. Pull remote-only pages
        let local_page_ids: std::collections::HashSet<Uuid> = local_pages.iter().map(|p| p.id).collect();
        // Also track pages already pulled in this sync
        let mut already_pulled: std::collections::HashSet<Uuid> = std::collections::HashSet::new();

        for page_id in &remote_changed_pages {
            if !local_page_ids.contains(page_id) {
                log::info!("Sync: pulling remote-only page {} (from manifest/changelog)", page_id);
                if self
                    .pull_page(&client, &config, &mut local_state, storage, notebook_id, *page_id)
                    .await
                    .is_ok()
                {
                    pages_pulled += 1;
                    synced_page_ids.push((*page_id, PageSyncResult::Pulled));
                    already_pulled.insert(*page_id);
                }
            }
        }

        // 6b. Enumerate the remote pages directory to discover ALL .crdt files
        // that aren't in the manifest or locally present. The manifest may be
        // incomplete if the source client had the skip-optimization bug, or
        // pages were pushed after the manifest was last read.
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
                    for page_id in remote_crdt_ids {
                        if !local_page_ids.contains(&page_id) && !already_pulled.contains(&page_id) {
                            log::info!("Sync: pulling remote-only page {} (from enumeration)", page_id);
                            if self
                                .pull_page(&client, &config, &mut local_state, storage, notebook_id, page_id)
                                .await
                                .is_ok()
                            {
                                pages_pulled += 1;
                                synced_page_ids.push((page_id, PageSyncResult::Pulled));
                            }
                        }
                    }
                }
                Err(e) => {
                    log::info!("Sync: remote pages enumeration failed: {}", e);
                }
            }
        }

        // 6c. Apply remote page metadata to all local pages with stale data
        if !remote_pages_meta.is_empty() {
            self.apply_pages_meta(storage, notebook_id, &remote_pages_meta);
        }

        // 6d. Pull folders and sections structure from remote
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

        // Push structural metadata only if we pushed pages (we have authoritative data).
        // A client that only pulled should not overwrite remote structure with stale/broken data.
        if pages_pushed > 0 {
            if let Err(e) = self.push_structure(&client, &config.remote_path, storage, notebook_id).await {
                log::warn!("Sync: failed to push structural metadata: {}", e);
            }
        } else {
            log::info!("Sync: skipping structure push (no pages pushed)");
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

        if !synced_page_ids.is_empty() || !manifest_existed {
            if let Err(e) = self.push_changelog(&client, &config.remote_path, &changelog).await {
                log::error!("Sync: failed to push changelog: {}", e);
            }
        }

        // 9. Sync assets
        if let Some(app) = app_handle {
            let _ = app.emit("sync-progress", SyncProgress {
                notebook_id: notebook_id.to_string(),
                current: 0,
                total: 0,
                message: "Syncing assets...".to_string(),
                phase: "assets".to_string(),
            });
        }
        let asset_result = self
            .sync_assets(&client, &config, &mut local_state, notebook_id)
            .await
            .unwrap_or_else(|e| {
                log::error!("Asset sync failed for notebook {}: {}", notebook_id, e);
                AssetSyncResult::default()
            });

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

        if let Some(app) = app_handle {
            let _ = app.emit("sync-progress", SyncProgress {
                notebook_id: notebook_id.to_string(),
                current: total_pages,
                total: total_pages,
                message: "Complete".to_string(),
                phase: "complete".to_string(),
            });
        }

        Ok(SyncResult::success(
            pages_pulled,
            pages_pushed,
            conflicts_resolved,
            start.elapsed().as_millis() as u64,
            asset_result.assets_pushed,
            asset_result.assets_pulled,
        ))
    }

    /// Fetch manifest from remote
    async fn fetch_manifest(
        &self,
        client: &WebDAVClient,
        remote_path: &str,
    ) -> Result<SyncManifest, SyncError> {
        let manifest_path = format!("{}/.sync-manifest.json", remote_path);
        let data = client.get(&manifest_path).await?;
        let manifest: SyncManifest = serde_json::from_slice(&data)?;
        Ok(manifest)
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

    /// Fetch changelog from remote. Returns empty changelog on any error.
    async fn fetch_changelog(
        &self,
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
    async fn push_structure(
        &self,
        client: &WebDAVClient,
        remote_path: &str,
        storage: &SharedStorage,
        notebook_id: Uuid,
    ) -> Result<(), SyncError> {
        let (pages, folders, sections) = {
            let storage_guard = storage.lock().unwrap();
            let pages = storage_guard.list_pages(notebook_id)?;
            let folders = storage_guard.list_folders(notebook_id)?;
            let sections = storage_guard.list_sections(notebook_id)?;
            (pages, folders, sections)
        };

        // Build pages-meta.json: page_id -> PageMeta for every page
        let pages_meta: HashMap<Uuid, PageMeta> = pages
            .iter()
            .map(|p| (p.id, PageMeta::from(p)))
            .collect();

        let meta_path = format!("{}/pages-meta.json", remote_path);
        let data = serde_json::to_vec_pretty(&pages_meta)?;
        client.put(&meta_path, &data, None).await?;
        log::info!("Sync: pushed pages-meta.json with {} entries", pages_meta.len());

        // Push folders.json
        let folders_path = format!("{}/folders.json", remote_path);
        let data = serde_json::to_vec_pretty(&folders)?;
        client.put(&folders_path, &data, None).await?;
        log::info!("Sync: pushed folders.json with {} folders", folders.len());

        // Push sections.json
        let sections_path = format!("{}/sections.json", remote_path);
        let data = serde_json::to_vec_pretty(&sections)?;
        client.put(&sections_path, &data, None).await?;
        log::info!("Sync: pushed sections.json with {} sections", sections.len());

        Ok(())
    }

    /// Fetch pages-meta.json from remote (page_id -> PageMeta map)
    async fn fetch_pages_meta(
        &self,
        client: &WebDAVClient,
        remote_path: &str,
    ) -> Result<HashMap<Uuid, PageMeta>, SyncError> {
        let meta_path = format!("{}/pages-meta.json", remote_path);
        let data = client.get(&meta_path).await?;
        let meta: HashMap<Uuid, PageMeta> = serde_json::from_slice(&data)?;
        Ok(meta)
    }

    /// Fetch and apply remote folders.json and sections.json to local storage.
    ///
    /// Remote is treated as source of truth: if remote has folders/sections,
    /// they always overwrite local. This prevents a receiving client (which
    /// has empty or stale structure) from keeping broken state.
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
                    }
                    Err(e) => log::warn!("Sync: failed to parse remote sections.json: {}", e),
                }
            }
            Err(e) => log::debug!("Sync: no remote sections.json: {}", e),
        }

        Ok(())
    }

    /// Apply page metadata from remote pages-meta.json to local pages.
    ///
    /// Applies to ALL local pages that have stale metadata (placeholder title
    /// or remote has newer updated_at), not just newly pulled pages. This fixes
    /// pages from previous syncs that ran before structural metadata syncing
    /// was implemented.
    fn apply_pages_meta(
        &self,
        storage: &SharedStorage,
        notebook_id: Uuid,
        pages_meta: &HashMap<Uuid, PageMeta>,
    ) {
        if pages_meta.is_empty() {
            return;
        }
        let storage_guard = storage.lock().unwrap();
        let local_pages = match storage_guard.list_pages(notebook_id) {
            Ok(pages) => pages,
            Err(e) => {
                log::warn!("Sync: failed to list pages for metadata apply: {}", e);
                return;
            }
        };

        let mut applied = 0;
        for page in local_pages {
            if let Some(meta) = pages_meta.get(&page.id) {
                // Apply if: page has placeholder title, or remote metadata is newer
                let is_placeholder = page.title.starts_with("Synced Page ");
                let remote_is_newer = meta.updated_at > page.updated_at;
                if !is_placeholder && !remote_is_newer {
                    continue;
                }

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

    /// Sync a single page
    async fn sync_page(
        &self,
        client: &WebDAVClient,
        config: &SyncConfig,
        local_state: &mut LocalSyncState,
        storage: &SharedStorage,
        notebook_id: Uuid,
        page: &Page,
        // Manifest is passed for future incremental CRDT encoding (encode_diff).
        // Currently we always push full state for bootstrap compatibility.
        _manifest: &SyncManifest,
    ) -> Result<PageSyncResult, SyncError> {
        let crdt_path = self.crdt_path(notebook_id, page.id);
        let remote_path = format!("{}/pages/{}.crdt", config.remote_path, page.id);

        // 1. Load or create local CRDT
        let crdt_existed = crdt_path.exists();
        let local_doc = if crdt_existed {
            let data = std::fs::read(&crdt_path)?;
            PageDocument::from_state(&data)?
        } else {
            PageDocument::from_editor_data(&page.content)?
        };
        log::debug!(
            "Sync page: crdt_existed={}, remote_path={}",
            crdt_existed,
            remote_path,
        );

        // 2. Use HEAD to check remote existence + ETag (cheaper than GET)
        let (remote_exists, remote_etag) = match client.head(&remote_path).await {
            Ok(head) if head.exists => {
                if head.etag.is_some() {
                    (true, head.etag)
                } else {
                    // HEAD returned no ETag — fall back to GET for compatibility
                    log::debug!("Sync page: HEAD returned no ETag, falling back to GET for ETag");
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
                // HEAD failed entirely — fall back to GET
                log::debug!("Sync page: HEAD failed, falling back to GET");
                match client.get_with_etag(&remote_path).await {
                    Ok((_, etag)) => (true, etag),
                    Err(WebDAVError::NotFound(_)) => (false, None),
                    Err(e) => return Err(e.into()),
                }
            }
        };

        // 3. If remote exists and ETag differs from our last known — remote changed
        if remote_exists {
            let page_state = local_state.pages.get(&page.id);
            let remote_changed = match page_state {
                Some(state) => state.remote_etag.as_deref() != remote_etag.as_deref(),
                None => true,
            };

            if remote_changed {
                // Remote changed — fetch full content
                let (remote_data, fetched_etag) = client.get_with_etag(&remote_path).await?;
                let remote_etag = fetched_etag.or(remote_etag);

                // Apply remote update to local CRDT
                local_doc.apply_update(&remote_data)?;

                if local_state.page_needs_sync(page.id) {
                    // Merge case: both local and remote changed
                    let merged_content = local_doc.to_editor_data()?;
                    {
                        let storage_guard = storage.lock().unwrap();
                        let mut updated_page = page.clone();
                        updated_page.content = merged_content;
                        storage_guard.update_page(&updated_page)?;
                    } // Lock released before async

                    // Save merged CRDT locally
                    let merged_state = local_doc.encode_state();
                    std::fs::create_dir_all(crdt_path.parent().unwrap())?;
                    std::fs::write(&crdt_path, &merged_state)?;

                    // Push merged state back (full state for bootstrap)
                    let result = client.put(&remote_path, &merged_state, None).await?;

                    local_state.mark_page_synced(page.id, result.etag, local_doc.state_vector());
                    return Ok(PageSyncResult::Merged);
                } else {
                    // Pull only — save merged state locally
                    let merged_content = local_doc.to_editor_data()?;
                    {
                        let storage_guard = storage.lock().unwrap();
                        let mut updated_page = page.clone();
                        updated_page.content = merged_content;
                        storage_guard.update_page(&updated_page)?;
                    }

                    let state = local_doc.encode_state();
                    std::fs::create_dir_all(crdt_path.parent().unwrap())?;
                    std::fs::write(&crdt_path, &state)?;

                    local_state.mark_page_synced(page.id, remote_etag, local_doc.state_vector());
                    return Ok(PageSyncResult::Pulled);
                }
            }
        }

        // 4. If local needs pushing
        if local_state.page_needs_sync(page.id) {
            // Always write full state to remote .crdt file (needed for bootstrap)
            let full_state = local_doc.encode_state();
            std::fs::create_dir_all(crdt_path.parent().unwrap())?;
            std::fs::write(&crdt_path, &full_state)?;

            // Push to remote with If-Match for conflict detection
            let local_etag = local_state
                .pages
                .get(&page.id)
                .and_then(|s| s.remote_etag.clone());

            let result = client.put(&remote_path, &full_state, local_etag.as_deref()).await?;

            if result.conflict {
                // Remote changed during push — pull, merge, push without ETag
                let (remote_data, _) = client.get_with_etag(&remote_path).await?;
                local_doc.apply_update(&remote_data)?;

                let merged_state = local_doc.encode_state();
                std::fs::write(&crdt_path, &merged_state)?;

                let result = client.put(&remote_path, &merged_state, None).await?;
                local_state.mark_page_synced(page.id, result.etag, local_doc.state_vector());

                // Update page content (short lock)
                let merged_content = local_doc.to_editor_data()?;
                {
                    let storage_guard = storage.lock().unwrap();
                    let mut updated_page = page.clone();
                    updated_page.content = merged_content;
                    storage_guard.update_page(&updated_page)?;
                } // Lock released

                return Ok(PageSyncResult::Merged);
            }

            local_state.mark_page_synced(page.id, result.etag, local_doc.state_vector());
            return Ok(PageSyncResult::Pushed);
        }

        Ok(PageSyncResult::Unchanged)
    }

    /// Pull a page from remote
    async fn pull_page(
        &self,
        client: &WebDAVClient,
        config: &SyncConfig,
        local_state: &mut LocalSyncState,
        storage: &SharedStorage,
        notebook_id: Uuid,
        page_id: Uuid,
    ) -> Result<Page, SyncError> {
        let remote_path = format!("{}/pages/{}.crdt", config.remote_path, page_id);
        let (data, etag) = client.get_with_etag(&remote_path).await?;

        let doc = PageDocument::from_state(&data)?;
        let content = doc.to_editor_data()?;

        // Create local page
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
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

        // Save page (short lock)
        {
            let storage_guard = storage.lock().unwrap();
            storage_guard.create_page_with_id(notebook_id, &page)?;
        } // Lock released

        // Save CRDT
        let crdt_path = self.crdt_path(notebook_id, page_id);
        std::fs::create_dir_all(crdt_path.parent().unwrap())?;
        std::fs::write(&crdt_path, &data)?;

        local_state.mark_page_synced(page_id, etag, doc.state_vector());

        Ok(page)
    }

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

    /// Sync assets between local and remote for a notebook
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

        // Build a set of remote relative paths for quick lookup.
        // ResourceInfo.path never has a leading '/' (stripped by the parser),
        // but remote_assets_base may have one (from config.remote_path), so
        // normalize both sides.
        let normalized_prefix = remote_assets_base.trim_matches('/');
        let remote_assets_prefix = format!("{}/", normalized_prefix);
        let remote_map: HashMap<String, &super::webdav::ResourceInfo> = remote_assets
            .iter()
            .filter_map(|r| {
                let path = r.path.trim_end_matches('/');
                // Extract relative path from the full remote path
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
        log::info!(
            "Asset sync: remote_map has {} entries from {} remote assets",
            remote_map.len(),
            remote_assets.len(),
        );

        // 4. Push: local assets that need syncing to remote
        // Use local sync state as primary indicator — asset_needs_push returns true for
        // untracked assets (first sync) and for assets modified since last sync.
        // remote_map is only used as a fallback for assets that were synced but may have
        // been deleted from the remote.
        for (relative_path, (abs_path, size, mtime)) in &local_assets {
            let needs_push = local_state.asset_needs_push(relative_path, *size, *mtime);

            if !needs_push {
                continue;
            }

            let remote_path = format!("{}/{}", remote_assets_base, relative_path);
            let existing_etag = local_state
                .assets
                .get(relative_path)
                .and_then(|s| s.remote_etag.clone());

            log::info!("Asset sync: pushing {}", relative_path);

            let put_result = client
                .put_file(&remote_path, abs_path, existing_etag.as_deref())
                .await;

            match put_result {
                Ok(resp) if resp.conflict => {
                    // Conflict: re-upload without If-Match (last-write-wins)
                    log::info!("Asset sync: conflict on {}, re-uploading (last-write-wins)", relative_path);
                    match client.put_file(&remote_path, abs_path, None).await {
                        Ok(resp2) => {
                            local_state.mark_asset_synced(relative_path, resp2.etag, *size, *mtime);
                            result.assets_pushed += 1;
                        }
                        Err(e) => {
                            log::error!("Asset sync: failed to push {} after conflict: {}", relative_path, e);
                        }
                    }
                }
                Ok(resp) => {
                    local_state.mark_asset_synced(relative_path, resp.etag, *size, *mtime);
                    result.assets_pushed += 1;
                }
                Err(e) => {
                    log::error!("Asset sync: failed to push {}: {}", relative_path, e);
                }
            }
        }

        // 5. Pull: remote assets not present locally, or with changed ETags
        for (relative_path, remote_info) in &remote_map {
            let local_path = assets_dir.join(relative_path);
            let is_locally_present = local_path.exists();

            let should_pull = if !is_locally_present {
                true
            } else {
                // Check if remote changed and local hasn't been modified since last sync
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
                        // File exists locally but not tracked (e.g. after code upgrade
                        // or partial sync). Compare sizes to avoid re-downloading.
                        let local_size = local_assets.get(relative_path).map(|(_, s, _)| *s);
                        let remote_size = remote_info.content_length;
                        match (local_size, remote_size) {
                            (Some(ls), Some(rs)) if ls == rs => {
                                // Same size — register in state, skip download
                                let mtime = local_assets.get(relative_path)
                                    .and_then(|(_, _, m)| *m);
                                local_state.mark_asset_synced(
                                    relative_path,
                                    remote_info.etag.clone(),
                                    ls,
                                    mtime,
                                );
                                log::debug!("Asset sync: skipping {} (exists locally, size matches)", relative_path);
                                false
                            }
                            _ => true,
                        }
                    }
                }
            };

            if !should_pull {
                continue;
            }

            let remote_path_full = format!("{}/{}", remote_assets_base, relative_path);
            log::info!("Asset sync: pulling {}", relative_path);

            match client.get_to_file(&remote_path_full, &local_path).await {
                Ok(etag) => {
                    let metadata = std::fs::metadata(&local_path).ok();
                    let size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
                    let mtime = metadata
                        .and_then(|m| m.modified().ok())
                        .map(|t| DateTime::<Utc>::from(t));
                    local_state.mark_asset_synced(relative_path, etag, size, mtime);
                    result.assets_pulled += 1;
                }
                Err(e) => {
                    log::error!("Asset sync: failed to pull {}: {}", relative_path, e);
                }
            }
        }

        log::info!(
            "Asset sync complete: {} pushed, {} pulled",
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

        // Build library sync config
        let config = LibrarySyncConfig {
            enabled: true,
            server_url: input.server_url.clone(),
            remote_base_path: input.remote_base_path.clone(),
            auth_type: input.auth_type.clone(),
            sync_mode: input.sync_mode.clone(),
            sync_interval: input.sync_interval,
        };

        // Save config on library
        {
            let lib_storage = library_storage.lock().unwrap();
            lib_storage
                .update_library_sync_config(library_id, Some(config.clone()))
                .map_err(|e| SyncError::IO(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))?;
        }

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
    ///
    /// PROPFINDs `remote_base_path` with depth=1, filters to UUID-named
    /// collection entries, and creates local notebooks for any that don't
    /// exist locally.
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

        // Log each entry for diagnostics
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
                // Extract the last path component (directory name)
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

        // If PROPFIND returned entries but no UUIDs, log the paths for diagnosis
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
        let local_notebook_ids: std::collections::HashSet<Uuid> = {
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

            // Try to fetch notebook-meta.json for name/type/etc
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

            // Build a Notebook struct with the remote UUID
            let now = Utc::now();
            let mut notebook = Notebook::new(name, notebook_type);
            notebook.id = notebook_id;
            notebook.created_at = now;
            notebook.updated_at = now;

            // Apply metadata fields if available
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

            // Create local notebook with the remote's UUID
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

            // Apply library sync config to the new notebook
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

    /// Sync all notebooks in a library
    pub async fn sync_library(
        &self,
        library_id: Uuid,
        library_storage: &SharedLibraryStorage,
        storage: &SharedStorage,
        app_handle: Option<&tauri::AppHandle>,
    ) -> Result<SyncResult, SyncError> {
        let start = std::time::Instant::now();

        // Get library sync config (needed for auto-apply and discovery)
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

        let mut total_pulled = 0;
        let mut total_pushed = 0;
        let mut total_conflicts = 0;
        let mut total_assets_pushed = 0;
        let mut total_assets_pulled = 0;
        let mut errors = Vec::new();
        let mut synced_count = 0;

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

            // Auto-apply library config to notebooks missing sync config
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
                            // Now this notebook is managed and enabled, sync it
                        }
                        Err(e) => {
                            log::warn!(
                                "Library sync: failed to auto-apply to '{}': {}",
                                notebook.name,
                                e,
                            );
                            errors.push(format!("{}: failed to configure: {}", notebook.name, e));
                            continue;
                        }
                    }
                } else {
                    log::info!(
                        "Library sync: notebook '{}' ({}): managed={}, enabled={} — skipping",
                        notebook.name,
                        notebook.id,
                        is_managed,
                        is_enabled,
                    );
                    continue;
                }
            } else if !is_enabled {
                log::info!(
                    "Library sync: notebook '{}' ({}): managed but disabled — skipping",
                    notebook.name,
                    notebook.id,
                );
                continue;
            }

            synced_count += 1;
            log::info!(
                "Library sync: syncing notebook '{}' ({})",
                notebook.name,
                notebook.id,
            );
            match self.sync_notebook(notebook.id, storage, app_handle).await {
                Ok(result) => {
                    log::info!(
                        "Library sync: notebook '{}' done: pulled={}, pushed={}, conflicts={}, assets_pushed={}, assets_pulled={}",
                        notebook.name,
                        result.pages_pulled,
                        result.pages_pushed,
                        result.conflicts_resolved,
                        result.assets_pushed,
                        result.assets_pulled,
                    );
                    total_pulled += result.pages_pulled;
                    total_pushed += result.pages_pushed;
                    total_conflicts += result.conflicts_resolved;
                    total_assets_pushed += result.assets_pushed;
                    total_assets_pulled += result.assets_pulled;
                }
                Err(e) => {
                    log::warn!("Failed to sync notebook {}: {}", notebook.id, e);
                    errors.push(format!("{}: {}", notebook.name, e));
                }
            }
        }

        log::info!(
            "Library sync complete: {}/{} notebooks synced, pulled={}, pushed={}, conflicts={}, errors={}",
            synced_count,
            notebooks.len(),
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
