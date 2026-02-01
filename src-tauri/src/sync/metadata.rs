use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use uuid::Uuid;

/// Local sync metadata for a notebook
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalSyncState {
    /// Notebook ID
    pub notebook_id: Uuid,
    /// Unique client ID for this device
    pub client_id: String,
    /// Last sync timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_sync: Option<DateTime<Utc>>,
    /// Per-page sync state
    pub pages: HashMap<Uuid, LocalPageState>,
    /// Remote manifest version we last synced with
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_version: Option<u32>,
    /// Per-asset sync state (keyed by relative path)
    #[serde(default)]
    pub assets: HashMap<String, LocalAssetState>,
    /// Last changelog sequence number we've processed
    #[serde(default)]
    pub last_changelog_seq: u64,
}

/// Local sync state for a single asset
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalAssetState {
    /// Relative path within assets directory (e.g. "images/foo.png")
    pub relative_path: String,
    /// ETag from last sync (for conflict detection)
    pub remote_etag: Option<String>,
    /// File size at last sync
    pub synced_size: u64,
    /// File modification time at last sync
    pub synced_mtime: Option<DateTime<Utc>>,
    /// When this asset was last synced
    pub last_synced: Option<DateTime<Utc>>,
}

/// Local sync state for a single page
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalPageState {
    /// ETag from last sync (for conflict detection)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_etag: Option<String>,
    /// Local modification time
    pub local_modified: DateTime<Utc>,
    /// Last synced time
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_synced: Option<DateTime<Utc>>,
    /// State vector from last sync
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synced_state_vector: Option<Vec<u8>>,
}

impl LocalSyncState {
    /// Create new sync state for a notebook
    pub fn new(notebook_id: Uuid) -> Self {
        Self {
            notebook_id,
            client_id: generate_client_id(),
            last_sync: None,
            pages: HashMap::new(),
            remote_version: None,
            assets: HashMap::new(),
            last_changelog_seq: 0,
        }
    }

    /// Load from file
    pub fn load(path: &Path) -> Result<Self, std::io::Error> {
        let data = std::fs::read_to_string(path)?;
        serde_json::from_str(&data)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }

    /// Save to file
    pub fn save(&self, path: &Path) -> Result<(), std::io::Error> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_string_pretty(self)?;
        std::fs::write(path, data)
    }

    /// Update page state after local modification
    pub fn mark_page_modified(&mut self, page_id: Uuid) {
        let entry = self.pages.entry(page_id).or_insert_with(|| LocalPageState {
            remote_etag: None,
            local_modified: Utc::now(),
            last_synced: None,
            synced_state_vector: None,
        });
        entry.local_modified = Utc::now();
    }

    /// Update page state after successful sync
    pub fn mark_page_synced(&mut self, page_id: Uuid, etag: Option<String>, state_vector: Vec<u8>) {
        let now = Utc::now();
        let entry = self.pages.entry(page_id).or_insert_with(|| LocalPageState {
            remote_etag: None,
            local_modified: now,
            last_synced: None,
            synced_state_vector: None,
        });
        entry.remote_etag = etag;
        entry.last_synced = Some(now);
        entry.synced_state_vector = Some(state_vector);
    }

    /// Remove page from sync state
    pub fn remove_page(&mut self, page_id: Uuid) {
        self.pages.remove(&page_id);
    }

    /// Check if a page needs syncing (modified after last sync)
    pub fn page_needs_sync(&self, page_id: Uuid) -> bool {
        match self.pages.get(&page_id) {
            Some(state) => match state.last_synced {
                Some(synced) => state.local_modified > synced,
                None => true, // Never synced
            },
            None => true, // Not tracked
        }
    }

    /// Get pages that need syncing
    pub fn pages_needing_sync(&self) -> Vec<Uuid> {
        self.pages
            .iter()
            .filter(|(id, _)| self.page_needs_sync(**id))
            .map(|(id, _)| *id)
            .collect()
    }

    /// Record that an asset was successfully synced
    pub fn mark_asset_synced(
        &mut self,
        relative_path: &str,
        etag: Option<String>,
        size: u64,
        mtime: Option<DateTime<Utc>>,
    ) {
        let now = Utc::now();
        self.assets.insert(
            relative_path.to_string(),
            LocalAssetState {
                relative_path: relative_path.to_string(),
                remote_etag: etag,
                synced_size: size,
                synced_mtime: mtime,
                last_synced: Some(now),
            },
        );
    }

    /// Check if a local asset needs to be pushed (changed since last sync)
    pub fn asset_needs_push(
        &self,
        relative_path: &str,
        current_size: u64,
        current_mtime: Option<DateTime<Utc>>,
    ) -> bool {
        match self.assets.get(relative_path) {
            Some(state) => {
                if state.synced_size != current_size {
                    return true;
                }
                match (state.synced_mtime, current_mtime) {
                    (Some(synced), Some(current)) => {
                        let diff = current.signed_duration_since(synced);
                        diff.num_seconds().abs() > 1
                    }
                    (None, Some(_)) => true,
                    _ => false,
                }
            }
            None => true, // Never synced
        }
    }
}

/// Generate a unique client ID for this device
fn generate_client_id() -> String {
    // Use machine ID + random component for uniqueness
    let random_part: u64 = rand::random();
    format!(
        "{}-{:016x}",
        hostname::get()
            .map(|h| h.to_string_lossy().to_string())
            .unwrap_or_else(|_| "unknown".to_string()),
        random_part
    )
}

// Simple random number generation without external crate
mod rand {
    use std::time::{SystemTime, UNIX_EPOCH};
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    pub fn random<T: From<u64>>() -> T {
        let time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos() as u64;
        let count = COUNTER.fetch_add(1, Ordering::Relaxed);
        T::from(time.wrapping_mul(count.wrapping_add(1)))
    }
}
