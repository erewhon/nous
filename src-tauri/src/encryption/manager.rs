//! Encryption manager for handling unlock state

use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{Duration, Instant};
use uuid::Uuid;

use super::errors::{EncryptionError, EncryptionResult};
use super::models::EncryptionKey;

/// Default auto-lock timeout (1 hour)
const DEFAULT_AUTO_LOCK_TIMEOUT: Duration = Duration::from_secs(3600);

/// Entry in the unlock cache
struct UnlockedEntry {
    key: EncryptionKey,
    unlocked_at: Instant,
    last_accessed: Instant,
}

impl UnlockedEntry {
    fn new(key: EncryptionKey) -> Self {
        let now = Instant::now();
        Self {
            key,
            unlocked_at: now,
            last_accessed: now,
        }
    }

    fn touch(&mut self) {
        self.last_accessed = Instant::now();
    }

    fn is_expired(&self, timeout: Duration) -> bool {
        self.last_accessed.elapsed() > timeout
    }
}

/// Manages encryption keys for unlocked notebooks and libraries
pub struct EncryptionManager {
    /// Keys for unlocked notebooks (notebook_id -> key)
    unlocked_notebooks: RwLock<HashMap<Uuid, UnlockedEntry>>,
    /// Keys for unlocked libraries (library_id -> key)
    unlocked_libraries: RwLock<HashMap<Uuid, UnlockedEntry>>,
    /// Auto-lock timeout duration
    auto_lock_timeout: Duration,
}

impl Default for EncryptionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl EncryptionManager {
    /// Create a new encryption manager
    pub fn new() -> Self {
        Self {
            unlocked_notebooks: RwLock::new(HashMap::new()),
            unlocked_libraries: RwLock::new(HashMap::new()),
            auto_lock_timeout: DEFAULT_AUTO_LOCK_TIMEOUT,
        }
    }

    /// Create a new encryption manager with custom timeout
    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            unlocked_notebooks: RwLock::new(HashMap::new()),
            unlocked_libraries: RwLock::new(HashMap::new()),
            auto_lock_timeout: timeout,
        }
    }

    /// Set the auto-lock timeout
    pub fn set_auto_lock_timeout(&mut self, timeout: Duration) {
        self.auto_lock_timeout = timeout;
    }

    /// Get the auto-lock timeout
    pub fn auto_lock_timeout(&self) -> Duration {
        self.auto_lock_timeout
    }

    // ========================
    // Notebook operations
    // ========================

    /// Store a key for an unlocked notebook
    pub fn unlock_notebook(&self, notebook_id: Uuid, key: EncryptionKey) {
        let mut notebooks = self.unlocked_notebooks.write().unwrap();
        notebooks.insert(notebook_id, UnlockedEntry::new(key));
    }

    /// Lock a notebook (remove key from memory)
    pub fn lock_notebook(&self, notebook_id: Uuid) {
        let mut notebooks = self.unlocked_notebooks.write().unwrap();
        notebooks.remove(&notebook_id);
    }

    /// Check if a notebook is unlocked
    pub fn is_notebook_unlocked(&self, notebook_id: Uuid) -> bool {
        let notebooks = self.unlocked_notebooks.read().unwrap();
        if let Some(entry) = notebooks.get(&notebook_id) {
            !entry.is_expired(self.auto_lock_timeout)
        } else {
            false
        }
    }

    /// Get the key for an unlocked notebook
    pub fn get_notebook_key(&self, notebook_id: Uuid) -> EncryptionResult<EncryptionKey> {
        let mut notebooks = self.unlocked_notebooks.write().unwrap();

        if let Some(entry) = notebooks.get_mut(&notebook_id) {
            if entry.is_expired(self.auto_lock_timeout) {
                notebooks.remove(&notebook_id);
                return Err(EncryptionError::NotebookLocked);
            }
            entry.touch();
            Ok(entry.key.clone())
        } else {
            Err(EncryptionError::NotebookLocked)
        }
    }

    /// Get all unlocked notebook IDs
    pub fn unlocked_notebook_ids(&self) -> Vec<Uuid> {
        let notebooks = self.unlocked_notebooks.read().unwrap();
        notebooks
            .iter()
            .filter(|(_, entry)| !entry.is_expired(self.auto_lock_timeout))
            .map(|(id, _)| *id)
            .collect()
    }

    // ========================
    // Library operations
    // ========================

    /// Store a key for an unlocked library
    pub fn unlock_library(&self, library_id: Uuid, key: EncryptionKey) {
        let mut libraries = self.unlocked_libraries.write().unwrap();
        libraries.insert(library_id, UnlockedEntry::new(key));
    }

    /// Lock a library (remove key from memory)
    pub fn lock_library(&self, library_id: Uuid) {
        let mut libraries = self.unlocked_libraries.write().unwrap();
        libraries.remove(&library_id);
    }

    /// Check if a library is unlocked
    pub fn is_library_unlocked(&self, library_id: Uuid) -> bool {
        let libraries = self.unlocked_libraries.read().unwrap();
        if let Some(entry) = libraries.get(&library_id) {
            !entry.is_expired(self.auto_lock_timeout)
        } else {
            false
        }
    }

    /// Get the key for an unlocked library
    pub fn get_library_key(&self, library_id: Uuid) -> EncryptionResult<EncryptionKey> {
        let mut libraries = self.unlocked_libraries.write().unwrap();

        if let Some(entry) = libraries.get_mut(&library_id) {
            if entry.is_expired(self.auto_lock_timeout) {
                libraries.remove(&library_id);
                return Err(EncryptionError::LibraryLocked);
            }
            entry.touch();
            Ok(entry.key.clone())
        } else {
            Err(EncryptionError::LibraryLocked)
        }
    }

    /// Get all unlocked library IDs
    pub fn unlocked_library_ids(&self) -> Vec<Uuid> {
        let libraries = self.unlocked_libraries.read().unwrap();
        libraries
            .iter()
            .filter(|(_, entry)| !entry.is_expired(self.auto_lock_timeout))
            .map(|(id, _)| *id)
            .collect()
    }

    // ========================
    // Maintenance operations
    // ========================

    /// Lock all notebooks and libraries
    pub fn lock_all(&self) {
        {
            let mut notebooks = self.unlocked_notebooks.write().unwrap();
            notebooks.clear();
        }
        {
            let mut libraries = self.unlocked_libraries.write().unwrap();
            libraries.clear();
        }
    }

    /// Remove expired entries (auto-lock check)
    pub fn cleanup_expired(&self) {
        {
            let mut notebooks = self.unlocked_notebooks.write().unwrap();
            notebooks.retain(|_, entry| !entry.is_expired(self.auto_lock_timeout));
        }
        {
            let mut libraries = self.unlocked_libraries.write().unwrap();
            libraries.retain(|_, entry| !entry.is_expired(self.auto_lock_timeout));
        }
    }

    /// Get statistics about unlocked items
    pub fn stats(&self) -> EncryptionStats {
        let notebooks = self.unlocked_notebooks.read().unwrap();
        let libraries = self.unlocked_libraries.read().unwrap();

        EncryptionStats {
            unlocked_notebooks: notebooks.len(),
            unlocked_libraries: libraries.len(),
            auto_lock_timeout_secs: self.auto_lock_timeout.as_secs(),
        }
    }
}

/// Statistics about the encryption manager state
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct EncryptionStats {
    pub unlocked_notebooks: usize,
    pub unlocked_libraries: usize,
    pub auto_lock_timeout_secs: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    fn test_key() -> EncryptionKey {
        EncryptionKey::new([0u8; 32])
    }

    #[test]
    fn test_notebook_unlock_lock() {
        let manager = EncryptionManager::new();
        let notebook_id = Uuid::new_v4();

        // Initially locked
        assert!(!manager.is_notebook_unlocked(notebook_id));

        // Unlock
        manager.unlock_notebook(notebook_id, test_key());
        assert!(manager.is_notebook_unlocked(notebook_id));

        // Get key
        assert!(manager.get_notebook_key(notebook_id).is_ok());

        // Lock
        manager.lock_notebook(notebook_id);
        assert!(!manager.is_notebook_unlocked(notebook_id));
        assert!(manager.get_notebook_key(notebook_id).is_err());
    }

    #[test]
    fn test_library_unlock_lock() {
        let manager = EncryptionManager::new();
        let library_id = Uuid::new_v4();

        // Initially locked
        assert!(!manager.is_library_unlocked(library_id));

        // Unlock
        manager.unlock_library(library_id, test_key());
        assert!(manager.is_library_unlocked(library_id));

        // Get key
        assert!(manager.get_library_key(library_id).is_ok());

        // Lock
        manager.lock_library(library_id);
        assert!(!manager.is_library_unlocked(library_id));
        assert!(manager.get_library_key(library_id).is_err());
    }

    #[test]
    fn test_auto_lock_timeout() {
        // Use a very short timeout for testing
        let manager = EncryptionManager::with_timeout(Duration::from_millis(50));
        let notebook_id = Uuid::new_v4();

        manager.unlock_notebook(notebook_id, test_key());
        assert!(manager.is_notebook_unlocked(notebook_id));

        // Wait for timeout
        thread::sleep(Duration::from_millis(100));

        // Should be expired
        assert!(!manager.is_notebook_unlocked(notebook_id));
    }

    #[test]
    fn test_lock_all() {
        let manager = EncryptionManager::new();
        let notebook_id = Uuid::new_v4();
        let library_id = Uuid::new_v4();

        manager.unlock_notebook(notebook_id, test_key());
        manager.unlock_library(library_id, test_key());

        assert!(manager.is_notebook_unlocked(notebook_id));
        assert!(manager.is_library_unlocked(library_id));

        manager.lock_all();

        assert!(!manager.is_notebook_unlocked(notebook_id));
        assert!(!manager.is_library_unlocked(library_id));
    }

    #[test]
    fn test_stats() {
        let manager = EncryptionManager::new();
        let notebook_id = Uuid::new_v4();

        let stats = manager.stats();
        assert_eq!(stats.unlocked_notebooks, 0);
        assert_eq!(stats.unlocked_libraries, 0);

        manager.unlock_notebook(notebook_id, test_key());

        let stats = manager.stats();
        assert_eq!(stats.unlocked_notebooks, 1);
        assert_eq!(stats.unlocked_libraries, 0);
    }
}
