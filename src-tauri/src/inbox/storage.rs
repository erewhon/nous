//! Inbox storage implementation

use std::fs;
use std::path::PathBuf;

use uuid::Uuid;

use super::models::*;
use crate::storage::StorageError;

type Result<T> = std::result::Result<T, StorageError>;

/// Storage for inbox items
pub struct InboxStorage {
    inbox_dir: PathBuf,
}

impl InboxStorage {
    /// Create a new inbox storage
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        let inbox_dir = data_dir.join("inbox");
        fs::create_dir_all(&inbox_dir)?;

        Ok(Self { inbox_dir })
    }

    /// Get the path to an inbox item file
    fn item_path(&self, id: Uuid) -> PathBuf {
        self.inbox_dir.join(format!("{}.json", id))
    }

    /// Capture a new inbox item
    pub fn capture(&self, request: CaptureRequest) -> Result<InboxItem> {
        let mut item = InboxItem::new(request.title, request.content);

        if let Some(tags) = request.tags {
            item = item.with_tags(tags);
        }

        if let Some(source) = request.source {
            item = item.with_source(source);
        }

        self.save_item(&item)?;
        Ok(item)
    }

    /// Save an inbox item
    pub fn save_item(&self, item: &InboxItem) -> Result<()> {
        let path = self.item_path(item.id);
        let json = serde_json::to_string_pretty(item)?;
        fs::write(path, json)?;
        Ok(())
    }

    /// Get an inbox item by ID
    pub fn get_item(&self, id: Uuid) -> Result<InboxItem> {
        let path = self.item_path(id);
        if !path.exists() {
            return Err(StorageError::PageNotFound(id));
        }

        let content = fs::read_to_string(path)?;
        let item: InboxItem = serde_json::from_str(&content)?;
        Ok(item)
    }

    /// List all inbox items
    pub fn list_items(&self) -> Result<Vec<InboxItem>> {
        let mut items = Vec::new();

        if !self.inbox_dir.exists() {
            return Ok(items);
        }

        for entry in fs::read_dir(&self.inbox_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(item) = serde_json::from_str::<InboxItem>(&content) {
                        items.push(item);
                    }
                }
            }
        }

        // Sort by capture time, newest first
        items.sort_by(|a, b| b.captured_at.cmp(&a.captured_at));

        Ok(items)
    }

    /// List unprocessed inbox items
    pub fn list_unprocessed(&self) -> Result<Vec<InboxItem>> {
        let items = self.list_items()?;
        Ok(items.into_iter().filter(|i| !i.is_processed).collect())
    }

    /// List items pending classification
    pub fn list_unclassified(&self) -> Result<Vec<InboxItem>> {
        let items = self.list_items()?;
        Ok(items
            .into_iter()
            .filter(|i| !i.is_processed && i.classification.is_none())
            .collect())
    }

    /// Update classification for an item
    pub fn set_classification(
        &self,
        id: Uuid,
        classification: InboxClassification,
    ) -> Result<InboxItem> {
        let mut item = self.get_item(id)?;
        item.classification = Some(classification);
        item.updated_at = chrono::Utc::now();
        self.save_item(&item)?;
        Ok(item)
    }

    /// Mark an item as processed
    pub fn mark_processed(&self, id: Uuid) -> Result<InboxItem> {
        let mut item = self.get_item(id)?;
        item.is_processed = true;
        item.updated_at = chrono::Utc::now();
        self.save_item(&item)?;
        Ok(item)
    }

    /// Delete an inbox item
    pub fn delete_item(&self, id: Uuid) -> Result<()> {
        let path = self.item_path(id);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    /// Delete all processed items
    pub fn clear_processed(&self) -> Result<usize> {
        let items = self.list_items()?;
        let mut count = 0;

        for item in items {
            if item.is_processed {
                self.delete_item(item.id)?;
                count += 1;
            }
        }

        Ok(count)
    }

    /// Get inbox summary
    pub fn get_summary(&self) -> Result<InboxSummary> {
        let items = self.list_items()?;

        let total_items = items.len();
        let processed_count = items.iter().filter(|i| i.is_processed).count();
        let classified_count = items
            .iter()
            .filter(|i| !i.is_processed && i.classification.is_some())
            .count();
        let unclassified_count = total_items - processed_count - classified_count;

        Ok(InboxSummary {
            total_items,
            unclassified_count,
            classified_count,
            processed_count,
        })
    }

    /// Replace all inbox items (used by sync merge)
    pub fn replace_items(&self, items: &[InboxItem]) -> Result<()> {
        // Delete all existing items
        if self.inbox_dir.exists() {
            for entry in fs::read_dir(&self.inbox_dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.extension().map(|e| e == "json").unwrap_or(false) {
                    fs::remove_file(path)?;
                }
            }
        }

        // Write all new items
        for item in items {
            self.save_item(item)?;
        }

        Ok(())
    }
}
