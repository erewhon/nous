use chrono::Utc;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use uuid::Uuid;

use crate::storage::Page;
use crate::storage::FileStorage;

use super::config::{
    SyncConfig, SyncConfigInput, SyncCredentials, SyncManifest,
    SyncState, SyncStatus, SyncResult,
};
use super::crdt::PageDocument;
use super::metadata::LocalSyncState;
use super::queue::{SyncOperation, SyncQueue};
use super::webdav::{WebDAVClient, WebDAVError};

/// Type alias for shared storage
pub type SharedStorage = Arc<Mutex<FileStorage>>;

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
enum PageSyncResult {
    Unchanged,
    Pulled,
    Pushed,
    Merged,
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

    /// Get credentials from keyring
    fn get_credentials(&self, notebook_id: Uuid) -> Result<SyncCredentials, SyncError> {
        let entry = keyring::Entry::new("katt-sync", &notebook_id.to_string())
            .map_err(|e| SyncError::Keyring(e.to_string()))?;

        let password = entry
            .get_password()
            .map_err(|_| SyncError::CredentialsNotFound)?;

        // Password is stored as "username:password"
        let parts: Vec<&str> = password.splitn(2, ':').collect();
        if parts.len() != 2 {
            return Err(SyncError::CredentialsNotFound);
        }

        Ok(SyncCredentials {
            username: parts[0].to_string(),
            password: parts[1].to_string(),
        })
    }

    /// Store credentials in keyring
    fn store_credentials(
        &self,
        notebook_id: Uuid,
        username: &str,
        password: &str,
    ) -> Result<(), SyncError> {
        let entry = keyring::Entry::new("katt-sync", &notebook_id.to_string())
            .map_err(|e| SyncError::Keyring(e.to_string()))?;

        entry
            .set_password(&format!("{}:{}", username, password))
            .map_err(|e| SyncError::Keyring(e.to_string()))?;

        Ok(())
    }

    /// Delete credentials from keyring
    fn delete_credentials(&self, notebook_id: Uuid) -> Result<(), SyncError> {
        let entry = keyring::Entry::new("katt-sync", &notebook_id.to_string())
            .map_err(|e| SyncError::Keyring(e.to_string()))?;

        // Ignore error if not found
        let _ = entry.delete_credential();
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
        Ok(client.test_connection().await?)
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
    ) -> Result<SyncResult, SyncError> {
        let start = std::time::Instant::now();

        // Get notebook config (short lock)
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

        // Get client
        let client = self.get_client(notebook_id, &config)?;
        let mut local_state = self.get_local_state(notebook_id);

        let mut pages_pulled = 0;
        let mut pages_pushed = 0;
        let mut conflicts_resolved = 0;

        // Fetch remote manifest
        let remote_manifest = self
            .fetch_manifest(&client, &config.remote_path)
            .await
            .ok();

        // Sync each page
        for page in &local_pages {
            let result = self
                .sync_page(&client, &config, &mut local_state, storage, notebook_id, page)
                .await?;

            match result {
                PageSyncResult::Pulled => pages_pulled += 1,
                PageSyncResult::Pushed => pages_pushed += 1,
                PageSyncResult::Merged => {
                    pages_pulled += 1;
                    pages_pushed += 1;
                    conflicts_resolved += 1;
                }
                PageSyncResult::Unchanged => {}
            }
        }

        // Handle remote pages not in local
        if let Some(manifest) = &remote_manifest {
            for (page_id, _) in &manifest.pages {
                if !local_pages.iter().any(|p| p.id == *page_id) {
                    // Pull remote page
                    if self
                        .pull_page(&client, &config, &mut local_state, storage, notebook_id, *page_id)
                        .await
                        .is_ok()
                    {
                        pages_pulled += 1;
                    }
                }
            }
        }

        // Process queue items
        let queue_items: Vec<_> = {
            let queue = self.queue.lock().unwrap();
            queue.get_notebook_items(notebook_id).iter().map(|i| i.id).collect()
        };

        for item_id in queue_items {
            let mut queue = self.queue.lock().unwrap();
            queue.complete(item_id);
        }

        // Update local state
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

        Ok(SyncResult::success(
            pages_pulled,
            pages_pushed,
            conflicts_resolved,
            start.elapsed().as_millis() as u64,
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

    /// Sync a single page
    async fn sync_page(
        &self,
        client: &WebDAVClient,
        config: &SyncConfig,
        local_state: &mut LocalSyncState,
        storage: &SharedStorage,
        notebook_id: Uuid,
        page: &Page,
    ) -> Result<PageSyncResult, SyncError> {
        let crdt_path = self.crdt_path(notebook_id, page.id);
        let remote_path = format!("{}/pages/{}.crdt", config.remote_path, page.id);

        // Load or create local CRDT
        let local_doc = if crdt_path.exists() {
            let data = std::fs::read(&crdt_path)?;
            PageDocument::from_state(&data)?
        } else {
            PageDocument::from_editor_data(&page.content)?
        };

        // Check if remote exists
        let remote_result = client.get_with_etag(&remote_path).await;

        match remote_result {
            Ok((remote_data, remote_etag)) => {
                // Remote exists - check if we need to merge
                let page_state = local_state.pages.get(&page.id);
                let needs_merge = match page_state {
                    Some(state) => state.remote_etag.as_deref() != remote_etag.as_deref(),
                    None => true,
                };

                if needs_merge {
                    // Merge remote into local
                    local_doc.apply_update(&remote_data)?;

                    // Convert back to EditorData and save (short lock)
                    let merged_content = local_doc.to_editor_data()?;
                    {
                        let storage_guard = storage.lock().unwrap();
                        let mut updated_page = page.clone();
                        updated_page.content = merged_content;
                        storage_guard.update_page(&updated_page)?;
                    } // Lock released before async

                    // Save merged CRDT
                    let merged_state = local_doc.encode_state();
                    std::fs::create_dir_all(crdt_path.parent().unwrap())?;
                    std::fs::write(&crdt_path, &merged_state)?;

                    // Push merged state
                    let result = client.put(&remote_path, &merged_state, None).await?;

                    // Update local state
                    local_state.mark_page_synced(page.id, result.etag, local_doc.state_vector());

                    return Ok(PageSyncResult::Merged);
                }
            }
            Err(WebDAVError::NotFound(_)) => {
                // Remote doesn't exist - push local
            }
            Err(e) => return Err(e.into()),
        }

        // Check if local needs pushing
        if local_state.page_needs_sync(page.id) {
            // Save local CRDT state
            let state = local_doc.encode_state();
            std::fs::create_dir_all(crdt_path.parent().unwrap())?;
            std::fs::write(&crdt_path, &state)?;

            // Push to remote
            let local_etag = local_state
                .pages
                .get(&page.id)
                .and_then(|s| s.remote_etag.clone());

            let result = client.put(&remote_path, &state, local_etag.as_deref()).await?;

            if result.conflict {
                // Remote changed - need to pull and merge
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
            section_id: None,
            is_archived: false,
            is_cover: false,
            position: 0,
            system_prompt: None,
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
}
