use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::Path;
use uuid::Uuid;

/// Queue of pending sync operations
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SyncQueue {
    pub items: Vec<QueueItem>,
}

/// A single queued sync operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueItem {
    /// Unique ID for this queue item
    pub id: Uuid,
    /// Notebook this operation belongs to
    pub notebook_id: Uuid,
    /// The sync operation to perform
    pub operation: SyncOperation,
    /// When this item was queued
    pub created_at: DateTime<Utc>,
    /// Number of retry attempts
    pub retries: u32,
    /// Last error message if any
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

/// Types of sync operations that can be queued
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SyncOperation {
    /// Update a page (create or modify)
    UpdatePage { page_id: Uuid },
    /// Delete a page
    DeletePage { page_id: Uuid },
    /// Update folder structure
    UpdateFolders,
    /// Update section structure
    UpdateSections,
    /// Update notebook metadata
    UpdateNotebook,
    /// Upload an asset file
    UploadAsset { asset_path: String },
    /// Delete an asset file
    DeleteAsset { asset_path: String },
}

impl SyncQueue {
    pub fn new() -> Self {
        Self { items: Vec::new() }
    }

    /// Add an operation to the queue, deduplicating if needed
    pub fn enqueue(&mut self, notebook_id: Uuid, operation: SyncOperation) {
        // For page updates, remove any existing update for the same page
        if let SyncOperation::UpdatePage { page_id } = &operation {
            self.items.retain(|item| {
                if item.notebook_id != notebook_id {
                    return true;
                }
                if let SyncOperation::UpdatePage { page_id: existing } = &item.operation {
                    existing != page_id
                } else {
                    true
                }
            });
        }

        // For folder/section/notebook updates, remove any existing
        match &operation {
            SyncOperation::UpdateFolders => {
                self.items.retain(|item| {
                    item.notebook_id != notebook_id || !matches!(item.operation, SyncOperation::UpdateFolders)
                });
            }
            SyncOperation::UpdateSections => {
                self.items.retain(|item| {
                    item.notebook_id != notebook_id || !matches!(item.operation, SyncOperation::UpdateSections)
                });
            }
            SyncOperation::UpdateNotebook => {
                self.items.retain(|item| {
                    item.notebook_id != notebook_id || !matches!(item.operation, SyncOperation::UpdateNotebook)
                });
            }
            _ => {}
        }

        self.items.push(QueueItem {
            id: Uuid::new_v4(),
            notebook_id,
            operation,
            created_at: Utc::now(),
            retries: 0,
            last_error: None,
        });
    }

    /// Get all items for a specific notebook
    pub fn get_notebook_items(&self, notebook_id: Uuid) -> Vec<&QueueItem> {
        self.items
            .iter()
            .filter(|item| item.notebook_id == notebook_id)
            .collect()
    }

    /// Count pending items for a notebook
    pub fn pending_count(&self, notebook_id: Uuid) -> usize {
        self.items
            .iter()
            .filter(|item| item.notebook_id == notebook_id)
            .count()
    }

    /// Mark an item as completed (remove it)
    pub fn complete(&mut self, item_id: Uuid) {
        self.items.retain(|item| item.id != item_id);
    }

    /// Mark an item as failed with error
    pub fn fail(&mut self, item_id: Uuid, error: String) {
        if let Some(item) = self.items.iter_mut().find(|i| i.id == item_id) {
            item.retries += 1;
            item.last_error = Some(error);
        }
    }

    /// Remove all items for a notebook
    pub fn clear_notebook(&mut self, notebook_id: Uuid) {
        self.items.retain(|item| item.notebook_id != notebook_id);
    }

    /// Load queue from file
    pub fn load(path: &Path) -> Result<Self, std::io::Error> {
        if !path.exists() {
            return Ok(Self::new());
        }
        let data = std::fs::read_to_string(path)?;
        serde_json::from_str(&data).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }

    /// Save queue to file
    pub fn save(&self, path: &Path) -> Result<(), std::io::Error> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let data = serde_json::to_string_pretty(self)?;
        std::fs::write(path, data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queue_deduplication() {
        let mut queue = SyncQueue::new();
        let notebook_id = Uuid::new_v4();
        let page_id = Uuid::new_v4();

        // Add same page twice
        queue.enqueue(notebook_id, SyncOperation::UpdatePage { page_id });
        queue.enqueue(notebook_id, SyncOperation::UpdatePage { page_id });

        // Should only have one item
        assert_eq!(queue.pending_count(notebook_id), 1);
    }

    #[test]
    fn test_queue_different_pages() {
        let mut queue = SyncQueue::new();
        let notebook_id = Uuid::new_v4();
        let page1 = Uuid::new_v4();
        let page2 = Uuid::new_v4();

        queue.enqueue(notebook_id, SyncOperation::UpdatePage { page_id: page1 });
        queue.enqueue(notebook_id, SyncOperation::UpdatePage { page_id: page2 });

        // Should have two items
        assert_eq!(queue.pending_count(notebook_id), 2);
    }
}
