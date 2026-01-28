use std::fs;
use std::path::PathBuf;

use chrono::Utc;
use thiserror::Error;
use uuid::Uuid;

use super::models::{
    EditorBlock, EditorData, FileStorageMode, Folder, FolderType, Notebook, NotebookType, Page,
    PageType, Section,
};
use crate::encryption::{
    decrypt_json, encrypt_json, is_encrypted_file, EncryptedContainer, EncryptionError,
    EncryptionKey,
};

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("ZIP error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("Encryption error: {0}")]
    Encryption(#[from] EncryptionError),

    #[error("Notebook not found: {0}")]
    NotebookNotFound(Uuid),

    #[error("Page not found: {0}")]
    PageNotFound(Uuid),

    #[error("Folder not found: {0}")]
    FolderNotFound(Uuid),

    #[error("Section not found: {0}")]
    SectionNotFound(Uuid),

    #[error("Data directory not found")]
    DataDirNotFound,

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Invalid operation: {0}")]
    InvalidOperation(String),

    #[error("Unsupported file type: {0}")]
    UnsupportedFileType(String),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Invalid page type for operation: expected {expected}, got {actual}")]
    InvalidPageType { expected: String, actual: String },

    #[error("Content is encrypted but no key provided")]
    EncryptedContentNoKey,
}

pub type Result<T> = std::result::Result<T, StorageError>;

pub struct FileStorage {
    base_path: PathBuf,
}

impl FileStorage {
    pub fn new(base_path: PathBuf) -> Self {
        Self { base_path }
    }

    /// Get the default data directory
    pub fn default_data_dir() -> Result<PathBuf> {
        dirs::data_local_dir()
            .map(|p| p.join("katt"))
            .ok_or(StorageError::DataDirNotFound)
    }

    /// Initialize storage directories
    pub fn init(&self) -> Result<()> {
        let notebooks_path = self.base_path.join("notebooks");
        fs::create_dir_all(&notebooks_path)?;
        Ok(())
    }

    // ===== Notebook Operations =====

    /// Get the notebooks directory path
    pub fn notebooks_dir(&self) -> &PathBuf {
        // Return the notebooks directory path
        // This is used by notion import to create notebooks directly
        &self.base_path
    }

    /// Get the notebooks base directory
    pub fn notebooks_base_dir(&self) -> PathBuf {
        self.base_path.join("notebooks")
    }

    fn notebook_dir(&self, notebook_id: Uuid) -> PathBuf {
        self.base_path.join("notebooks").join(notebook_id.to_string())
    }

    /// Get the path to a notebook directory (public for git operations)
    pub fn get_notebook_path(&self, notebook_id: Uuid) -> PathBuf {
        self.notebook_dir(notebook_id)
    }

    fn notebook_metadata_path(&self, notebook_id: Uuid) -> PathBuf {
        self.notebook_dir(notebook_id).join("notebook.json")
    }

    fn pages_dir(&self, notebook_id: Uuid) -> PathBuf {
        self.notebook_dir(notebook_id).join("pages")
    }

    pub fn notebook_assets_dir(&self, notebook_id: Uuid) -> PathBuf {
        self.notebook_dir(notebook_id).join("assets")
    }

    fn folders_path(&self, notebook_id: Uuid) -> PathBuf {
        self.notebook_dir(notebook_id).join("folders.json")
    }

    fn sections_path(&self, notebook_id: Uuid) -> PathBuf {
        self.notebook_dir(notebook_id).join("sections.json")
    }

    pub fn list_notebooks(&self) -> Result<Vec<Notebook>> {
        let notebooks_path = self.base_path.join("notebooks");

        if !notebooks_path.exists() {
            return Ok(Vec::new());
        }

        let mut notebooks = Vec::new();

        for entry in fs::read_dir(&notebooks_path)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_dir() {
                let metadata_path = path.join("notebook.json");
                if metadata_path.exists() {
                    let content = fs::read_to_string(&metadata_path)?;
                    let notebook: Notebook = serde_json::from_str(&content)?;
                    notebooks.push(notebook);
                }
            }
        }

        // Sort by position first, then by updated_at descending for equal positions
        notebooks.sort_by(|a, b| {
            match a.position.cmp(&b.position) {
                std::cmp::Ordering::Equal => b.updated_at.cmp(&a.updated_at),
                other => other,
            }
        });

        Ok(notebooks)
    }

    pub fn get_notebook(&self, notebook_id: Uuid) -> Result<Notebook> {
        let metadata_path = self.notebook_metadata_path(notebook_id);

        if !metadata_path.exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let content = fs::read_to_string(&metadata_path)?;
        let notebook: Notebook = serde_json::from_str(&content)?;
        Ok(notebook)
    }

    pub fn create_notebook(&self, name: String, notebook_type: NotebookType) -> Result<Notebook> {
        let notebook = Notebook::new(name, notebook_type);

        let notebook_dir = self.notebook_dir(notebook.id);
        let pages_dir = self.pages_dir(notebook.id);

        fs::create_dir_all(&notebook_dir)?;
        fs::create_dir_all(&pages_dir)?;

        let metadata_path = self.notebook_metadata_path(notebook.id);
        let content = serde_json::to_string_pretty(&notebook)?;
        fs::write(&metadata_path, content)?;

        Ok(notebook)
    }

    pub fn update_notebook(&self, notebook: &Notebook) -> Result<()> {
        let metadata_path = self.notebook_metadata_path(notebook.id);

        if !metadata_path.exists() {
            return Err(StorageError::NotebookNotFound(notebook.id));
        }

        let content = serde_json::to_string_pretty(notebook)?;
        fs::write(&metadata_path, content)?;

        Ok(())
    }

    pub fn delete_notebook(&self, notebook_id: Uuid) -> Result<()> {
        let notebook_dir = self.notebook_dir(notebook_id);

        if !notebook_dir.exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        fs::remove_dir_all(&notebook_dir)?;
        Ok(())
    }

    pub fn reorder_notebooks(&self, notebook_ids: &[Uuid]) -> Result<()> {
        // Update positions based on the order in notebook_ids
        for (position, notebook_id) in notebook_ids.iter().enumerate() {
            let mut notebook = self.get_notebook(*notebook_id)?;
            notebook.position = position as i32;
            notebook.updated_at = chrono::Utc::now();
            self.update_notebook(&notebook)?;
        }

        Ok(())
    }

    // ===== Page Operations =====

    fn page_path(&self, notebook_id: Uuid, page_id: Uuid) -> PathBuf {
        self.pages_dir(notebook_id)
            .join(format!("{}.json", page_id))
    }

    pub fn list_pages(&self, notebook_id: Uuid) -> Result<Vec<Page>> {
        let pages_dir = self.pages_dir(notebook_id);

        if !pages_dir.exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let mut pages = Vec::new();

        for entry in fs::read_dir(&pages_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_file() && path.extension().map_or(false, |e| e == "json") {
                let content = fs::read_to_string(&path)?;
                let page: Page = serde_json::from_str(&content)?;
                pages.push(page);
            }
        }

        // Sort by updated_at descending
        pages.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(pages)
    }

    pub fn get_page(&self, notebook_id: Uuid, page_id: Uuid) -> Result<Page> {
        let page_path = self.page_path(notebook_id, page_id);

        if !page_path.exists() {
            return Err(StorageError::PageNotFound(page_id));
        }

        let content = fs::read_to_string(&page_path)?;
        let page: Page = serde_json::from_str(&content)?;
        Ok(page)
    }

    pub fn create_page(&self, notebook_id: Uuid, title: String) -> Result<Page> {
        // Verify notebook exists
        if !self.notebook_dir(notebook_id).exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let page = Page::new(notebook_id, title);

        let page_path = self.page_path(notebook_id, page.id);
        let content = serde_json::to_string_pretty(&page)?;
        fs::write(&page_path, content)?;

        Ok(page)
    }

    /// Create a page from an existing Page struct (used for import)
    pub fn create_page_from(&self, page: Page) -> Result<Page> {
        // Verify notebook exists
        if !self.notebook_dir(page.notebook_id).exists() {
            return Err(StorageError::NotebookNotFound(page.notebook_id));
        }

        let page_path = self.page_path(page.notebook_id, page.id);
        let content = serde_json::to_string_pretty(&page)?;
        fs::write(&page_path, content)?;

        Ok(page)
    }

    /// Create a page with a specific ID (used for sync)
    pub fn create_page_with_id(&self, notebook_id: Uuid, page: &Page) -> Result<Page> {
        // Verify notebook exists
        if !self.notebook_dir(notebook_id).exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let page_path = self.page_path(notebook_id, page.id);
        let content = serde_json::to_string_pretty(page)?;
        fs::write(&page_path, content)?;

        Ok(page.clone())
    }

    pub fn update_page(&self, page: &Page) -> Result<()> {
        let page_path = self.page_path(page.notebook_id, page.id);

        if !page_path.exists() {
            return Err(StorageError::PageNotFound(page.id));
        }

        let content = serde_json::to_string_pretty(page)?;
        fs::write(&page_path, content)?;

        Ok(())
    }

    /// Soft delete a page by moving it to trash (sets deleted_at timestamp)
    pub fn delete_page(&self, notebook_id: Uuid, page_id: Uuid) -> Result<()> {
        let mut page = self.get_page(notebook_id, page_id)?;

        // Set deleted_at timestamp
        page.deleted_at = Some(Utc::now());
        page.updated_at = Utc::now();

        self.update_page(&page)?;
        Ok(())
    }

    /// Permanently delete a page from disk (no recovery possible)
    pub fn permanent_delete_page(&self, notebook_id: Uuid, page_id: Uuid) -> Result<()> {
        let page_path = self.page_path(notebook_id, page_id);

        if !page_path.exists() {
            return Err(StorageError::PageNotFound(page_id));
        }

        fs::remove_file(&page_path)?;
        Ok(())
    }

    /// Restore a page from trash
    pub fn restore_page(&self, notebook_id: Uuid, page_id: Uuid) -> Result<Page> {
        let mut page = self.get_page(notebook_id, page_id)?;

        if page.deleted_at.is_none() {
            return Err(StorageError::InvalidOperation("Page is not in trash".into()));
        }

        // Clear deleted_at to restore
        page.deleted_at = None;
        page.updated_at = Utc::now();

        self.update_page(&page)?;
        Ok(page)
    }

    /// List all pages in trash for a notebook
    pub fn list_trash(&self, notebook_id: Uuid) -> Result<Vec<Page>> {
        let pages = self.list_pages(notebook_id)?;
        Ok(pages.into_iter().filter(|p| p.deleted_at.is_some()).collect())
    }

    /// Purge pages that have been in trash for more than the specified days
    pub fn purge_old_trash(&self, notebook_id: Uuid, days: i64) -> Result<usize> {
        let cutoff = Utc::now() - chrono::Duration::days(days);
        let trash_pages = self.list_trash(notebook_id)?;

        let mut deleted_count = 0;
        for page in trash_pages {
            if let Some(deleted_at) = page.deleted_at {
                if deleted_at < cutoff {
                    self.permanent_delete_page(notebook_id, page.id)?;
                    deleted_count += 1;
                }
            }
        }

        Ok(deleted_count)
    }

    /// Move a page from one notebook to another
    /// Handles copying assets (images, embedded files) to the target notebook
    pub fn move_page_to_notebook(
        &self,
        source_notebook_id: Uuid,
        page_id: Uuid,
        target_notebook_id: Uuid,
        target_folder_id: Option<Uuid>,
    ) -> Result<Page> {
        // Verify source page exists
        let mut page = self.get_page(source_notebook_id, page_id)?;

        // Verify target notebook exists
        if !self.notebook_dir(target_notebook_id).exists() {
            return Err(StorageError::NotebookNotFound(target_notebook_id));
        }

        // Get asset paths from page content
        let asset_refs = self.extract_asset_references(&page.content);

        // Copy assets to target notebook
        let source_assets_dir = self.notebook_assets_dir(source_notebook_id);
        let target_assets_dir = self.notebook_assets_dir(target_notebook_id);

        // Ensure target assets directories exist
        let target_images_dir = target_assets_dir.join("images");
        fs::create_dir_all(&target_images_dir)?;

        let target_embedded_dir = target_assets_dir.join("embedded");
        fs::create_dir_all(&target_embedded_dir)?;

        for asset_ref in &asset_refs {
            let source_path = source_assets_dir.join(asset_ref);
            let target_path = target_assets_dir.join(asset_ref);

            if source_path.exists() {
                // Ensure parent directory exists
                if let Some(parent) = target_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(&source_path, &target_path)?;
            }
        }

        // Handle non-standard pages (markdown, pdf, etc.) that have source files
        if let Some(ref source_file) = page.source_file {
            if page.storage_mode == Some(FileStorageMode::Embedded) {
                // Copy embedded source file
                let source_path = source_assets_dir.join("embedded").join(source_file);
                let target_path = target_embedded_dir.join(source_file);
                if source_path.exists() {
                    fs::copy(&source_path, &target_path)?;
                }
            }
        }

        // Update page metadata
        page.notebook_id = target_notebook_id;
        page.folder_id = target_folder_id;
        page.parent_page_id = None; // Clear parent page since it won't exist in new notebook
        page.section_id = None; // Clear section since it won't exist in new notebook
        page.updated_at = chrono::Utc::now();

        // Save page in target notebook
        let target_page_path = self.page_path(target_notebook_id, page.id);
        let content = serde_json::to_string_pretty(&page)?;
        fs::write(&target_page_path, content)?;

        // Delete original page file
        let source_page_path = self.page_path(source_notebook_id, page_id);
        fs::remove_file(&source_page_path)?;

        // Optionally clean up original assets (only if no other pages reference them)
        // For now, we leave them - they'll be cleaned up by any future garbage collection

        Ok(page)
    }

    /// Extract asset file references from page content
    fn extract_asset_references(&self, content: &EditorData) -> Vec<String> {
        let mut refs = Vec::new();

        for block in &content.blocks {
            // Image blocks
            if block.block_type == "image" {
                if let Some(file_obj) = block.data.get("file") {
                    if let Some(url) = file_obj.get("url").and_then(|u| u.as_str()) {
                        // Extract relative path from URL (e.g., "asset://localhost/assets/images/xxx.png")
                        if let Some(path) = self.extract_asset_path(url) {
                            refs.push(path);
                        }
                    }
                }
            }

            // PDF tool
            if block.block_type == "pdf" {
                if let Some(file_path) = block.data.get("filePath").and_then(|p| p.as_str()) {
                    if let Some(path) = self.extract_asset_path(file_path) {
                        refs.push(path);
                    }
                }
            }

            // Video tool
            if block.block_type == "video" {
                if let Some(file_path) = block.data.get("filePath").and_then(|p| p.as_str()) {
                    if let Some(path) = self.extract_asset_path(file_path) {
                        refs.push(path);
                    }
                }
            }

            // Drawing tool
            if block.block_type == "drawing" {
                if let Some(file_path) = block.data.get("filePath").and_then(|p| p.as_str()) {
                    if let Some(path) = self.extract_asset_path(file_path) {
                        refs.push(path);
                    }
                }
            }

            // Recursively handle columns (nested blocks)
            if block.block_type == "columns" {
                if let Some(column_data) = block.data.get("columnData").and_then(|d| d.as_array()) {
                    for column in column_data {
                        if let Some(blocks) = column.get("blocks").and_then(|b| b.as_array()) {
                            for nested_block in blocks {
                                if let Ok(nested) = serde_json::from_value::<EditorBlock>(nested_block.clone()) {
                                    let nested_content = EditorData {
                                        time: None,
                                        version: None,
                                        blocks: vec![nested],
                                    };
                                    refs.extend(self.extract_asset_references(&nested_content));
                                }
                            }
                        }
                    }
                }
            }
        }

        refs
    }

    /// Extract relative asset path from URL or file path
    fn extract_asset_path(&self, url: &str) -> Option<String> {
        // Handle asset:// protocol URLs
        if url.starts_with("asset://") {
            // asset://localhost/notebooks/{notebook-id}/assets/images/xxx.png
            // or asset://localhost/assets/images/xxx.png (older format)
            if let Some(pos) = url.find("/assets/") {
                return Some(url[pos + 1..].to_string()); // "assets/images/xxx.png"
            }
        }

        // Handle relative paths
        if url.starts_with("assets/") {
            return Some(url.to_string());
        }

        None
    }

    // ===== Tag Operations =====

    /// Get all unique tags across all notebooks with their counts
    pub fn get_all_tags(&self) -> Result<Vec<(String, usize)>> {
        let mut tag_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();

        let notebooks = self.list_notebooks()?;

        for notebook in notebooks {
            let pages = self.list_pages(notebook.id)?;
            for page in pages {
                for tag in page.tags {
                    let normalized = tag.to_lowercase().trim().to_string();
                    if !normalized.is_empty() {
                        *tag_counts.entry(normalized).or_insert(0) += 1;
                    }
                }
            }
        }

        let mut tags: Vec<(String, usize)> = tag_counts.into_iter().collect();
        tags.sort_by(|a, b| b.1.cmp(&a.1)); // Sort by count descending
        Ok(tags)
    }

    /// Get tags for a specific notebook
    pub fn get_notebook_tags(&self, notebook_id: Uuid) -> Result<Vec<(String, usize)>> {
        let mut tag_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();

        let pages = self.list_pages(notebook_id)?;
        for page in pages {
            for tag in page.tags {
                let normalized = tag.to_lowercase().trim().to_string();
                if !normalized.is_empty() {
                    *tag_counts.entry(normalized).or_insert(0) += 1;
                }
            }
        }

        let mut tags: Vec<(String, usize)> = tag_counts.into_iter().collect();
        tags.sort_by(|a, b| b.1.cmp(&a.1));
        Ok(tags)
    }

    /// Rename a tag across all pages in a notebook
    pub fn rename_tag(&self, notebook_id: Uuid, old_tag: &str, new_tag: &str) -> Result<usize> {
        let old_normalized = old_tag.to_lowercase().trim().to_string();
        let new_tag_clean = new_tag.trim().to_string();
        let mut count = 0;

        let pages = self.list_pages(notebook_id)?;
        for mut page in pages {
            let mut modified = false;

            page.tags = page
                .tags
                .into_iter()
                .map(|t| {
                    if t.to_lowercase().trim() == old_normalized {
                        modified = true;
                        new_tag_clean.clone()
                    } else {
                        t
                    }
                })
                .collect();

            if modified {
                page.updated_at = chrono::Utc::now();
                self.update_page(&page)?;
                count += 1;
            }
        }

        Ok(count)
    }

    /// Merge multiple tags into one across all pages in a notebook
    pub fn merge_tags(
        &self,
        notebook_id: Uuid,
        tags_to_merge: &[String],
        target_tag: &str,
    ) -> Result<usize> {
        let normalized_sources: Vec<String> = tags_to_merge
            .iter()
            .map(|t| t.to_lowercase().trim().to_string())
            .collect();
        let target_clean = target_tag.trim().to_string();
        let mut count = 0;

        let pages = self.list_pages(notebook_id)?;
        for mut page in pages {
            let mut modified = false;
            let mut has_target = false;
            let mut new_tags: Vec<String> = Vec::new();

            for tag in &page.tags {
                let normalized = tag.to_lowercase().trim().to_string();
                if normalized_sources.contains(&normalized) {
                    if !has_target {
                        new_tags.push(target_clean.clone());
                        has_target = true;
                    }
                    modified = true;
                } else if normalized == target_clean.to_lowercase() {
                    has_target = true;
                    new_tags.push(tag.clone());
                } else {
                    new_tags.push(tag.clone());
                }
            }

            if modified {
                page.tags = new_tags;
                page.updated_at = chrono::Utc::now();
                self.update_page(&page)?;
                count += 1;
            }
        }

        Ok(count)
    }

    /// Delete a tag from all pages in a notebook
    pub fn delete_tag(&self, notebook_id: Uuid, tag: &str) -> Result<usize> {
        let normalized = tag.to_lowercase().trim().to_string();
        let mut count = 0;

        let pages = self.list_pages(notebook_id)?;
        for mut page in pages {
            let original_len = page.tags.len();
            page.tags
                .retain(|t| t.to_lowercase().trim() != normalized);

            if page.tags.len() != original_len {
                page.updated_at = chrono::Utc::now();
                self.update_page(&page)?;
                count += 1;
            }
        }

        Ok(count)
    }

    // ===== Folder Operations =====

    /// List all folders in a notebook
    pub fn list_folders(&self, notebook_id: Uuid) -> Result<Vec<Folder>> {
        let folders_path = self.folders_path(notebook_id);

        // If folders.json doesn't exist, return empty vec (migration case)
        if !folders_path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&folders_path)?;
        let folders: Vec<Folder> = serde_json::from_str(&content)?;

        Ok(folders)
    }

    /// Get a specific folder by ID
    pub fn get_folder(&self, notebook_id: Uuid, folder_id: Uuid) -> Result<Folder> {
        let folders = self.list_folders(notebook_id)?;

        folders
            .into_iter()
            .find(|f| f.id == folder_id)
            .ok_or(StorageError::FolderNotFound(folder_id))
    }

    /// Save all folders for a notebook
    fn save_folders(&self, notebook_id: Uuid, folders: &[Folder]) -> Result<()> {
        let folders_path = self.folders_path(notebook_id);
        let content = serde_json::to_string_pretty(folders)?;
        fs::write(&folders_path, content)?;
        Ok(())
    }

    /// Create a new folder in a notebook
    pub fn create_folder(
        &self,
        notebook_id: Uuid,
        name: String,
        parent_id: Option<Uuid>,
    ) -> Result<Folder> {
        // Verify notebook exists
        if !self.notebook_dir(notebook_id).exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let mut folders = self.list_folders(notebook_id)?;

        // Calculate position (last in parent)
        let max_position = folders
            .iter()
            .filter(|f| f.parent_id == parent_id && f.folder_type == FolderType::Standard)
            .map(|f| f.position)
            .max()
            .unwrap_or(-1);

        let mut folder = Folder::new(notebook_id, name, parent_id);
        folder.position = max_position + 1;

        folders.push(folder.clone());
        self.save_folders(notebook_id, &folders)?;

        Ok(folder)
    }

    /// Update an existing folder
    pub fn update_folder(&self, folder: &Folder) -> Result<()> {
        let mut folders = self.list_folders(folder.notebook_id)?;

        let idx = folders
            .iter()
            .position(|f| f.id == folder.id)
            .ok_or(StorageError::FolderNotFound(folder.id))?;

        folders[idx] = folder.clone();
        self.save_folders(folder.notebook_id, &folders)?;

        Ok(())
    }

    /// Delete a folder and optionally move its pages
    pub fn delete_folder(
        &self,
        notebook_id: Uuid,
        folder_id: Uuid,
        move_pages_to: Option<Uuid>,
    ) -> Result<()> {
        let mut folders = self.list_folders(notebook_id)?;

        // Find and remove the folder
        let idx = folders
            .iter()
            .position(|f| f.id == folder_id)
            .ok_or(StorageError::FolderNotFound(folder_id))?;

        let folder = &folders[idx];

        // Don't allow deleting the archive folder
        if folder.folder_type == FolderType::Archive {
            return Err(StorageError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Cannot delete the Archive folder",
            )));
        }

        folders.remove(idx);

        // Move any child folders to the parent or root
        let parent_id = folders
            .iter()
            .find(|f| f.id == folder_id)
            .and_then(|f| f.parent_id);

        for f in folders.iter_mut() {
            if f.parent_id == Some(folder_id) {
                f.parent_id = parent_id;
                f.updated_at = chrono::Utc::now();
            }
        }

        self.save_folders(notebook_id, &folders)?;

        // Move pages to target folder or root
        let pages = self.list_pages(notebook_id)?;
        for mut page in pages {
            if page.folder_id == Some(folder_id) {
                page.folder_id = move_pages_to;
                page.updated_at = chrono::Utc::now();
                self.update_page(&page)?;
            }
        }

        Ok(())
    }

    /// Get or create the Archive folder for a notebook
    pub fn ensure_archive_folder(&self, notebook_id: Uuid) -> Result<Folder> {
        let folders = self.list_folders(notebook_id)?;

        // Check if archive folder already exists
        if let Some(archive) = folders.into_iter().find(|f| f.folder_type == FolderType::Archive) {
            return Ok(archive);
        }

        // Create archive folder
        let archive = Folder::new_archive(notebook_id);
        let mut folders = self.list_folders(notebook_id)?;
        folders.push(archive.clone());
        self.save_folders(notebook_id, &folders)?;

        Ok(archive)
    }

    // ===== Section Operations =====

    /// List all sections in a notebook
    pub fn list_sections(&self, notebook_id: Uuid) -> Result<Vec<Section>> {
        let sections_path = self.sections_path(notebook_id);

        // If sections.json doesn't exist, return empty vec
        if !sections_path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&sections_path)?;
        let sections: Vec<Section> = serde_json::from_str(&content)?;

        Ok(sections)
    }

    /// Get a specific section by ID
    pub fn get_section(&self, notebook_id: Uuid, section_id: Uuid) -> Result<Section> {
        let sections = self.list_sections(notebook_id)?;

        sections
            .into_iter()
            .find(|s| s.id == section_id)
            .ok_or(StorageError::SectionNotFound(section_id))
    }

    /// Save all sections for a notebook
    fn save_sections(&self, notebook_id: Uuid, sections: &[Section]) -> Result<()> {
        let sections_path = self.sections_path(notebook_id);
        let content = serde_json::to_string_pretty(sections)?;
        fs::write(&sections_path, content)?;
        Ok(())
    }

    /// Create a new section in a notebook
    pub fn create_section(
        &self,
        notebook_id: Uuid,
        name: String,
        color: Option<String>,
    ) -> Result<Section> {
        // Verify notebook exists
        if !self.notebook_dir(notebook_id).exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let mut sections = self.list_sections(notebook_id)?;

        // Calculate position (last)
        let max_position = sections
            .iter()
            .map(|s| s.position)
            .max()
            .unwrap_or(-1);

        let mut section = Section::new(notebook_id, name);
        section.color = color;
        section.position = max_position + 1;

        sections.push(section.clone());
        self.save_sections(notebook_id, &sections)?;

        Ok(section)
    }

    /// Update an existing section
    pub fn update_section(&self, section: &Section) -> Result<()> {
        let mut sections = self.list_sections(section.notebook_id)?;

        let idx = sections
            .iter()
            .position(|s| s.id == section.id)
            .ok_or(StorageError::SectionNotFound(section.id))?;

        sections[idx] = section.clone();
        self.save_sections(section.notebook_id, &sections)?;

        Ok(())
    }

    /// Delete a section and optionally move its items to another section
    pub fn delete_section(
        &self,
        notebook_id: Uuid,
        section_id: Uuid,
        move_items_to: Option<Uuid>,
    ) -> Result<()> {
        let mut sections = self.list_sections(notebook_id)?;

        // Find and remove the section
        let idx = sections
            .iter()
            .position(|s| s.id == section_id)
            .ok_or(StorageError::SectionNotFound(section_id))?;

        sections.remove(idx);
        self.save_sections(notebook_id, &sections)?;

        // Move folders to target section
        let mut folders = self.list_folders(notebook_id)?;
        for folder in folders.iter_mut() {
            if folder.section_id == Some(section_id) {
                folder.section_id = move_items_to;
                folder.updated_at = chrono::Utc::now();
            }
        }
        self.save_folders(notebook_id, &folders)?;

        // Move pages to target section
        let pages = self.list_pages(notebook_id)?;
        for mut page in pages {
            if page.section_id == Some(section_id) {
                page.section_id = move_items_to;
                page.updated_at = chrono::Utc::now();
                self.update_page(&page)?;
            }
        }

        Ok(())
    }

    /// Reorder sections
    pub fn reorder_sections(&self, notebook_id: Uuid, section_ids: &[Uuid]) -> Result<()> {
        let mut sections = self.list_sections(notebook_id)?;

        // Update positions based on the order in section_ids
        for (position, section_id) in section_ids.iter().enumerate() {
            if let Some(section) = sections.iter_mut().find(|s| s.id == *section_id) {
                section.position = position as i32;
                section.updated_at = chrono::Utc::now();
            }
        }

        // Sort by position before saving
        sections.sort_by_key(|s| s.position);
        self.save_sections(notebook_id, &sections)?;

        Ok(())
    }

    // ===== Cover Page Operations =====

    /// Get the cover page for a notebook, if it exists
    pub fn get_cover_page(&self, notebook_id: Uuid) -> Result<Option<Page>> {
        let pages = self.list_pages(notebook_id)?;
        Ok(pages.into_iter().find(|p| p.is_cover))
    }

    /// Create a cover page for a notebook
    pub fn create_cover_page(&self, notebook_id: Uuid) -> Result<Page> {
        // Check if cover already exists
        if let Some(cover) = self.get_cover_page(notebook_id)? {
            return Ok(cover);
        }

        let page = Page::new_cover(notebook_id);
        self.create_page_from(page)
    }

    /// Set or unset a page as the cover page
    pub fn set_cover_page(&self, notebook_id: Uuid, page_id: Option<Uuid>) -> Result<Option<Page>> {
        let pages = self.list_pages(notebook_id)?;

        // First, unset any existing cover page
        for mut page in pages.clone() {
            if page.is_cover && Some(page.id) != page_id {
                page.is_cover = false;
                page.updated_at = chrono::Utc::now();
                self.update_page(&page)?;
            }
        }

        // If page_id is provided, set it as cover
        if let Some(pid) = page_id {
            let mut page = self.get_page(notebook_id, pid)?;
            page.is_cover = true;
            page.updated_at = chrono::Utc::now();
            self.update_page(&page)?;
            return Ok(Some(page));
        }

        Ok(None)
    }

    /// Move a page to a folder
    pub fn move_page_to_folder(
        &self,
        notebook_id: Uuid,
        page_id: Uuid,
        folder_id: Option<Uuid>,
        position: Option<i32>,
    ) -> Result<Page> {
        let mut page = self.get_page(notebook_id, page_id)?;

        // If moving to a specific folder, verify it exists
        if let Some(fid) = folder_id {
            let _ = self.get_folder(notebook_id, fid)?;
        }

        page.folder_id = folder_id;

        // Calculate position if not specified
        if let Some(pos) = position {
            page.position = pos;
        } else {
            // Put at end of folder
            let pages = self.list_pages(notebook_id)?;
            let max_position = pages
                .iter()
                .filter(|p| p.folder_id == folder_id)
                .map(|p| p.position)
                .max()
                .unwrap_or(-1);
            page.position = max_position + 1;
        }

        page.updated_at = chrono::Utc::now();
        self.update_page(&page)?;

        Ok(page)
    }

    /// Archive a page (move to archive folder)
    pub fn archive_page(&self, notebook_id: Uuid, page_id: Uuid) -> Result<Page> {
        let archive = self.ensure_archive_folder(notebook_id)?;
        let mut page = self.get_page(notebook_id, page_id)?;

        page.is_archived = true;
        page.folder_id = Some(archive.id);
        page.updated_at = chrono::Utc::now();

        self.update_page(&page)?;
        Ok(page)
    }

    /// Unarchive a page (move out of archive folder)
    pub fn unarchive_page(
        &self,
        notebook_id: Uuid,
        page_id: Uuid,
        target_folder_id: Option<Uuid>,
    ) -> Result<Page> {
        let mut page = self.get_page(notebook_id, page_id)?;

        page.is_archived = false;
        page.folder_id = target_folder_id;

        // Calculate position in target folder
        let pages = self.list_pages(notebook_id)?;
        let max_position = pages
            .iter()
            .filter(|p| p.folder_id == target_folder_id && !p.is_archived)
            .map(|p| p.position)
            .max()
            .unwrap_or(-1);
        page.position = max_position + 1;

        page.updated_at = chrono::Utc::now();
        self.update_page(&page)?;

        Ok(page)
    }

    /// Reorder pages within a folder
    pub fn reorder_pages(
        &self,
        notebook_id: Uuid,
        folder_id: Option<Uuid>,
        page_ids: &[Uuid],
    ) -> Result<()> {
        for (position, page_id) in page_ids.iter().enumerate() {
            let mut page = self.get_page(notebook_id, *page_id)?;
            if page.folder_id == folder_id {
                page.position = position as i32;
                page.updated_at = chrono::Utc::now();
                self.update_page(&page)?;
            }
        }
        Ok(())
    }

    /// Reorder folders within a parent
    pub fn reorder_folders(
        &self,
        notebook_id: Uuid,
        parent_id: Option<Uuid>,
        folder_ids: &[Uuid],
    ) -> Result<()> {
        let mut folders = self.list_folders(notebook_id)?;
        let now = chrono::Utc::now();

        for (position, folder_id) in folder_ids.iter().enumerate() {
            if let Some(folder) = folders.iter_mut().find(|f| f.id == *folder_id) {
                if folder.parent_id == parent_id && folder.folder_type == FolderType::Standard {
                    folder.position = position as i32;
                    folder.updated_at = now;
                }
            }
        }

        self.save_folders(notebook_id, &folders)?;
        Ok(())
    }

    /// Initialize folders.json for a notebook (migration)
    pub fn init_folders(&self, notebook_id: Uuid) -> Result<()> {
        let folders_path = self.folders_path(notebook_id);

        if !folders_path.exists() {
            // Create empty folders array
            self.save_folders(notebook_id, &[])?;
        }

        Ok(())
    }

    // ===== File-Based Page Operations =====

    /// Get path for a native text file (markdown, ics)
    fn native_file_path(&self, notebook_id: Uuid, page_id: Uuid, ext: &str) -> PathBuf {
        self.pages_dir(notebook_id).join(format!("{}.{}", page_id, ext))
    }

    /// Get path for metadata JSON file (for non-standard pages)
    fn metadata_path(&self, notebook_id: Uuid, page_id: Uuid) -> PathBuf {
        self.pages_dir(notebook_id)
            .join(format!("{}.metadata.json", page_id))
    }

    /// Get path for embedded binary files (pdf, epub, ipynb)
    fn embedded_file_path(&self, notebook_id: Uuid, page_id: Uuid, ext: &str) -> PathBuf {
        self.notebook_dir(notebook_id)
            .join("assets")
            .join("embedded")
            .join(format!("{}.{}", page_id, ext))
    }

    /// Get the embedded assets directory
    pub fn embedded_assets_dir(&self, notebook_id: Uuid) -> PathBuf {
        self.notebook_dir(notebook_id).join("assets").join("embedded")
    }

    /// Determine page type from file extension
    pub fn page_type_from_extension(ext: &str) -> Option<PageType> {
        match ext.to_lowercase().as_str() {
            "md" | "markdown" => Some(PageType::Markdown),
            "pdf" => Some(PageType::Pdf),
            "ipynb" => Some(PageType::Jupyter),
            "epub" => Some(PageType::Epub),
            "ics" | "ical" => Some(PageType::Calendar),
            "chat" => Some(PageType::Chat),
            _ => None,
        }
    }

    /// Import a file as a new page
    pub fn import_file_as_page(
        &self,
        notebook_id: Uuid,
        file_path: &std::path::Path,
        storage_mode: FileStorageMode,
        folder_id: Option<Uuid>,
        section_id: Option<Uuid>,
    ) -> Result<Page> {
        // Verify notebook exists
        if !self.notebook_dir(notebook_id).exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        // Get file extension and determine page type
        let ext = file_path
            .extension()
            .and_then(|e| e.to_str())
            .ok_or_else(|| StorageError::UnsupportedFileType("No file extension".to_string()))?;

        let page_type = Self::page_type_from_extension(ext)
            .ok_or_else(|| StorageError::UnsupportedFileType(ext.to_string()))?;

        // Get title from filename
        let title = file_path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled")
            .to_string();

        // Create page
        let page_id = Uuid::new_v4();
        let now = chrono::Utc::now();

        // Determine source file path based on storage mode
        let source_file = match storage_mode {
            FileStorageMode::Embedded => {
                // Copy file to embedded assets
                let dest_path = self.embedded_file_path(notebook_id, page_id, ext);
                fs::create_dir_all(dest_path.parent().unwrap())?;
                fs::copy(file_path, &dest_path)?;
                format!("assets/embedded/{}.{}", page_id, ext)
            }
            FileStorageMode::Linked => {
                // Store absolute path
                file_path
                    .canonicalize()?
                    .to_string_lossy()
                    .to_string()
            }
        };

        let page = Page {
            id: page_id,
            notebook_id,
            title,
            content: super::models::EditorData::default(), // Empty for file-based pages
            tags: Vec::new(),
            folder_id,
            parent_page_id: None,
            section_id,
            is_archived: false,
            is_cover: false,
            position: 0,
            system_prompt: None,
            system_prompt_mode: super::models::SystemPromptMode::default(),
            ai_model: None,
            page_type,
            source_file: Some(source_file),
            storage_mode: Some(storage_mode),
            file_extension: Some(ext.to_lowercase()),
            last_file_sync: Some(now),
            deleted_at: None,
            is_favorite: false,
            created_at: now,
            updated_at: now,
        };

        // Save page metadata
        let metadata_path = self.metadata_path(notebook_id, page_id);
        let content = serde_json::to_string_pretty(&page)?;
        fs::write(&metadata_path, content)?;

        Ok(page)
    }

    /// Read content of a native text file (markdown, ics)
    pub fn read_native_file_content(&self, page: &Page) -> Result<String> {
        let source_file = page.source_file.as_ref().ok_or_else(|| {
            StorageError::InvalidPageType {
                expected: "file-based page".to_string(),
                actual: "standard".to_string(),
            }
        })?;

        let file_path = match page.storage_mode {
            Some(FileStorageMode::Embedded) => {
                self.notebook_dir(page.notebook_id).join(source_file)
            }
            Some(FileStorageMode::Linked) | None => PathBuf::from(source_file),
        };

        if !file_path.exists() {
            return Err(StorageError::FileNotFound(file_path.to_string_lossy().to_string()));
        }

        let content = fs::read_to_string(&file_path)?;
        Ok(content)
    }

    /// Write content to a native text file (markdown, ics)
    pub fn write_native_file_content(&self, page: &Page, content: &str) -> Result<()> {
        let source_file = page.source_file.as_ref().ok_or_else(|| {
            StorageError::InvalidPageType {
                expected: "file-based page".to_string(),
                actual: "standard".to_string(),
            }
        })?;

        let file_path = match page.storage_mode {
            Some(FileStorageMode::Embedded) => {
                self.notebook_dir(page.notebook_id).join(source_file)
            }
            Some(FileStorageMode::Linked) | None => PathBuf::from(source_file),
        };

        fs::write(&file_path, content)?;
        Ok(())
    }

    /// Get the absolute path to a file-based page's content
    pub fn get_file_path(&self, page: &Page) -> Result<PathBuf> {
        let source_file = page.source_file.as_ref().ok_or_else(|| {
            StorageError::InvalidPageType {
                expected: "file-based page".to_string(),
                actual: "standard".to_string(),
            }
        })?;

        let file_path = match page.storage_mode {
            Some(FileStorageMode::Embedded) => {
                self.notebook_dir(page.notebook_id).join(source_file)
            }
            Some(FileStorageMode::Linked) | None => PathBuf::from(source_file),
        };

        Ok(file_path)
    }

    /// Read binary file content (pdf, epub, ipynb)
    pub fn read_binary_file(&self, page: &Page) -> Result<Vec<u8>> {
        let file_path = self.get_file_path(page)?;

        if !file_path.exists() {
            return Err(StorageError::FileNotFound(file_path.to_string_lossy().to_string()));
        }

        let content = fs::read(&file_path)?;
        Ok(content)
    }

    /// Check if a linked file has been modified externally
    pub fn check_linked_file_modified(&self, page: &Page) -> Result<bool> {
        if page.storage_mode != Some(FileStorageMode::Linked) {
            return Ok(false);
        }

        let file_path = self.get_file_path(page)?;
        if !file_path.exists() {
            return Err(StorageError::FileNotFound(file_path.to_string_lossy().to_string()));
        }

        let metadata = fs::metadata(&file_path)?;
        let modified_time = metadata
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| StorageError::InvalidOperation(e.to_string()))?;

        if let Some(last_sync) = page.last_file_sync {
            let last_sync_timestamp = last_sync.timestamp() as u64;
            Ok(modified_time.as_secs() > last_sync_timestamp)
        } else {
            Ok(true) // No last sync, assume modified
        }
    }

    /// Update page metadata (for file-based pages stored in metadata.json)
    pub fn update_page_metadata(&self, page: &Page) -> Result<()> {
        if page.page_type == PageType::Standard {
            // Standard pages use the regular page file
            return self.update_page(page);
        }

        let metadata_path = self.metadata_path(page.notebook_id, page.id);
        let content = serde_json::to_string_pretty(page)?;
        fs::write(&metadata_path, content)?;
        Ok(())
    }

    /// Get a page by ID, checking both standard and metadata files
    pub fn get_page_any_type(&self, notebook_id: Uuid, page_id: Uuid) -> Result<Page> {
        // First try standard page path
        let page_path = self.page_path(notebook_id, page_id);
        if page_path.exists() {
            let content = fs::read_to_string(&page_path)?;
            let page: Page = serde_json::from_str(&content)?;
            return Ok(page);
        }

        // Then try metadata path
        let metadata_path = self.metadata_path(notebook_id, page_id);
        if metadata_path.exists() {
            let content = fs::read_to_string(&metadata_path)?;
            let page: Page = serde_json::from_str(&content)?;
            return Ok(page);
        }

        Err(StorageError::PageNotFound(page_id))
    }

    /// List all pages including file-based pages
    pub fn list_all_pages(&self, notebook_id: Uuid) -> Result<Vec<Page>> {
        let pages_dir = self.pages_dir(notebook_id);

        if !pages_dir.exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let mut pages = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();

        for entry in fs::read_dir(&pages_dir)? {
            let entry = entry?;
            let path = entry.path();

            if !path.is_file() {
                continue;
            }

            let ext = path.extension().and_then(|e| e.to_str());

            // Check for standard JSON pages
            if ext == Some("json") && !path.to_string_lossy().contains(".metadata.json") {
                let content = fs::read_to_string(&path)?;
                let page: Page = serde_json::from_str(&content)?;
                if !seen_ids.contains(&page.id) {
                    seen_ids.insert(page.id);
                    pages.push(page);
                }
            }
            // Check for metadata files (file-based pages)
            else if path.to_string_lossy().ends_with(".metadata.json") {
                let content = fs::read_to_string(&path)?;
                let page: Page = serde_json::from_str(&content)?;
                if !seen_ids.contains(&page.id) {
                    seen_ids.insert(page.id);
                    pages.push(page);
                }
            }
        }

        // Sort by updated_at descending
        pages.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(pages)
    }

    /// Delete a file-based page and its associated files
    pub fn delete_file_page(&self, notebook_id: Uuid, page_id: Uuid) -> Result<()> {
        let page = self.get_page_any_type(notebook_id, page_id)?;

        // Delete the content file if embedded
        if page.storage_mode == Some(FileStorageMode::Embedded) {
            if let Some(source_file) = &page.source_file {
                let file_path = self.notebook_dir(notebook_id).join(source_file);
                if file_path.exists() {
                    fs::remove_file(&file_path)?;
                }
            }
        }

        // Delete metadata file
        let metadata_path = self.metadata_path(notebook_id, page_id);
        if metadata_path.exists() {
            fs::remove_file(&metadata_path)?;
        }

        // Also try to delete standard page file (in case it exists)
        let page_path = self.page_path(notebook_id, page_id);
        if page_path.exists() {
            fs::remove_file(&page_path)?;
        }

        Ok(())
    }

    // ===== Encrypted Page Operations =====

    /// Get a page, automatically decrypting if necessary
    ///
    /// If the page file is encrypted and a key is provided, it will be decrypted.
    /// If the page file is encrypted and no key is provided, returns an error.
    /// If the page file is not encrypted, returns the page normally.
    pub fn get_page_encrypted(
        &self,
        notebook_id: Uuid,
        page_id: Uuid,
        key: Option<&EncryptionKey>,
    ) -> Result<Page> {
        let page_path = self.page_path(notebook_id, page_id);

        if !page_path.exists() {
            return Err(StorageError::PageNotFound(page_id));
        }

        let content = fs::read_to_string(&page_path)?;

        // Check if the content is encrypted
        if is_encrypted_file(&content) {
            let key = key.ok_or(StorageError::EncryptedContentNoKey)?;
            let container: EncryptedContainer = serde_json::from_str(&content)?;
            let page: Page = decrypt_json(&container, key)?;
            Ok(page)
        } else {
            // Normal unencrypted page
            let page: Page = serde_json::from_str(&content)?;
            Ok(page)
        }
    }

    /// Update a page, optionally encrypting the content
    ///
    /// If a key is provided, the page will be encrypted before writing.
    /// If no key is provided, the page is written as normal JSON.
    pub fn update_page_encrypted(
        &self,
        page: &Page,
        key: Option<&EncryptionKey>,
    ) -> Result<()> {
        let page_path = self.page_path(page.notebook_id, page.id);

        if !page_path.exists() {
            return Err(StorageError::PageNotFound(page.id));
        }

        let content = if let Some(key) = key {
            let container = encrypt_json(page, key)?;
            serde_json::to_string_pretty(&container)?
        } else {
            serde_json::to_string_pretty(page)?
        };

        fs::write(&page_path, content)?;
        Ok(())
    }

    /// Create a page, optionally encrypting the content
    pub fn create_page_encrypted(
        &self,
        notebook_id: Uuid,
        title: String,
        key: Option<&EncryptionKey>,
    ) -> Result<Page> {
        // Verify notebook exists
        if !self.notebook_dir(notebook_id).exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let page = Page::new(notebook_id, title);
        let page_path = self.page_path(notebook_id, page.id);

        let content = if let Some(key) = key {
            let container = encrypt_json(&page, key)?;
            serde_json::to_string_pretty(&container)?
        } else {
            serde_json::to_string_pretty(&page)?
        };

        fs::write(&page_path, content)?;
        Ok(page)
    }

    /// List pages, automatically decrypting if necessary
    ///
    /// If a key is provided, encrypted pages will be decrypted.
    /// If no key is provided, encrypted pages will be returned with a placeholder title.
    pub fn list_pages_encrypted(
        &self,
        notebook_id: Uuid,
        key: Option<&EncryptionKey>,
    ) -> Result<Vec<Page>> {
        let pages_dir = self.pages_dir(notebook_id);

        if !pages_dir.exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let mut pages = Vec::new();

        for entry in fs::read_dir(&pages_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_file() && path.extension().map_or(false, |e| e == "json") {
                let content = fs::read_to_string(&path)?;

                // Check if encrypted
                if is_encrypted_file(&content) {
                    if let Some(key) = key {
                        // Decrypt and add
                        if let Ok(container) = serde_json::from_str::<EncryptedContainer>(&content) {
                            if let Ok(page) = decrypt_json::<Page>(&container, key) {
                                pages.push(page);
                            }
                        }
                    }
                    // If no key provided, skip encrypted pages (they're locked)
                } else {
                    // Normal unencrypted page
                    let page: Page = serde_json::from_str(&content)?;
                    pages.push(page);
                }
            }
        }

        // Sort by updated_at descending
        pages.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(pages)
    }

    /// Check if a page file is encrypted
    pub fn is_page_encrypted(&self, notebook_id: Uuid, page_id: Uuid) -> Result<bool> {
        let page_path = self.page_path(notebook_id, page_id);

        if !page_path.exists() {
            return Err(StorageError::PageNotFound(page_id));
        }

        let content = fs::read_to_string(&page_path)?;
        Ok(is_encrypted_file(&content))
    }

    /// Encrypt all pages in a notebook
    ///
    /// Re-encrypts all pages with the given key. Used when enabling encryption.
    pub fn encrypt_all_pages(&self, notebook_id: Uuid, key: &EncryptionKey) -> Result<usize> {
        let pages_dir = self.pages_dir(notebook_id);

        if !pages_dir.exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let mut encrypted_count = 0;

        for entry in fs::read_dir(&pages_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_file() && path.extension().map_or(false, |e| e == "json") {
                let content = fs::read_to_string(&path)?;

                // Skip if already encrypted
                if is_encrypted_file(&content) {
                    continue;
                }

                // Parse and re-encrypt
                let page: Page = serde_json::from_str(&content)?;
                let container = encrypt_json(&page, key)?;
                let encrypted = serde_json::to_string_pretty(&container)?;
                fs::write(&path, encrypted)?;
                encrypted_count += 1;
            }
        }

        Ok(encrypted_count)
    }

    /// Decrypt all pages in a notebook
    ///
    /// Decrypts all pages and saves as plain JSON. Used when disabling encryption.
    pub fn decrypt_all_pages(&self, notebook_id: Uuid, key: &EncryptionKey) -> Result<usize> {
        let pages_dir = self.pages_dir(notebook_id);

        if !pages_dir.exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let mut decrypted_count = 0;

        for entry in fs::read_dir(&pages_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_file() && path.extension().map_or(false, |e| e == "json") {
                let content = fs::read_to_string(&path)?;

                // Skip if not encrypted
                if !is_encrypted_file(&content) {
                    continue;
                }

                // Parse and decrypt
                let container: EncryptedContainer = serde_json::from_str(&content)?;
                let page: Page = decrypt_json(&container, key)?;
                let decrypted = serde_json::to_string_pretty(&page)?;
                fs::write(&path, decrypted)?;
                decrypted_count += 1;
            }
        }

        Ok(decrypted_count)
    }

    /// Re-encrypt all pages with a new key (for password change)
    pub fn reencrypt_all_pages(
        &self,
        notebook_id: Uuid,
        old_key: &EncryptionKey,
        new_key: &EncryptionKey,
    ) -> Result<usize> {
        let pages_dir = self.pages_dir(notebook_id);

        if !pages_dir.exists() {
            return Err(StorageError::NotebookNotFound(notebook_id));
        }

        let mut reencrypted_count = 0;

        for entry in fs::read_dir(&pages_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_file() && path.extension().map_or(false, |e| e == "json") {
                let content = fs::read_to_string(&path)?;

                // Only re-encrypt if currently encrypted
                if is_encrypted_file(&content) {
                    // Decrypt with old key
                    let container: EncryptedContainer = serde_json::from_str(&content)?;
                    let page: Page = decrypt_json(&container, old_key)?;

                    // Re-encrypt with new key
                    let new_container = encrypt_json(&page, new_key)?;
                    let encrypted = serde_json::to_string_pretty(&new_container)?;
                    fs::write(&path, encrypted)?;
                    reencrypted_count += 1;
                }
            }
        }

        Ok(reencrypted_count)
    }

    /// Encrypt an asset file (binary data)
    pub fn encrypt_asset(
        &self,
        notebook_id: Uuid,
        asset_name: &str,
        data: &[u8],
        key: &EncryptionKey,
    ) -> Result<PathBuf> {
        use crate::encryption::encrypt_to_container;

        let assets_dir = self.notebook_assets_dir(notebook_id);
        fs::create_dir_all(&assets_dir)?;

        // Determine content type from extension
        let content_type = match asset_name.rsplit('.').next() {
            Some("png") => "image/png",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("gif") => "image/gif",
            Some("webp") => "image/webp",
            Some("pdf") => "application/pdf",
            Some("mp4") => "video/mp4",
            Some("webm") => "video/webm",
            _ => "application/octet-stream",
        };

        // Encrypt the data
        let container = encrypt_to_container(data, key, content_type)?;
        let encrypted = serde_json::to_string(&container)?;

        // Save with .enc extension
        let encrypted_name = format!("{}.enc", asset_name);
        let asset_path = assets_dir.join(&encrypted_name);
        fs::write(&asset_path, encrypted)?;

        Ok(asset_path)
    }

    /// Decrypt an asset file (binary data)
    pub fn decrypt_asset(
        &self,
        notebook_id: Uuid,
        asset_name: &str,
        key: &EncryptionKey,
    ) -> Result<Vec<u8>> {
        use crate::encryption::decrypt_from_container;

        let assets_dir = self.notebook_assets_dir(notebook_id);

        // Try encrypted name first
        let encrypted_name = format!("{}.enc", asset_name);
        let encrypted_path = assets_dir.join(&encrypted_name);

        if encrypted_path.exists() {
            let content = fs::read_to_string(&encrypted_path)?;
            let container: EncryptedContainer = serde_json::from_str(&content)?;
            let data = decrypt_from_container(&container, key)?;
            return Ok(data);
        }

        // Try original name (might be unencrypted)
        let asset_path = assets_dir.join(asset_name);
        if asset_path.exists() {
            let data = fs::read(&asset_path)?;
            return Ok(data);
        }

        Err(StorageError::FileNotFound(asset_name.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    /// Test that asset paths are correctly generated.
    ///
    /// This is important for Tauri's asset protocol scope configuration.
    /// On Linux, the default data directory is ~/.local/share/katt which contains
    /// a hidden directory (.local). The asset protocol scope must be configured with
    /// `requireLiteralLeadingDot: false` to allow access to these paths.
    #[test]
    fn test_asset_path_generation() {
        let temp_dir = TempDir::new().unwrap();
        let storage = FileStorage::new(temp_dir.path().to_path_buf());
        storage.init().unwrap();

        let notebook_id = Uuid::new_v4();
        let assets_dir = storage.notebook_assets_dir(notebook_id);

        // Verify path structure: base_path/notebooks/<uuid>/assets
        assert!(assets_dir.ends_with("assets"));
        assert!(assets_dir.to_string_lossy().contains(&notebook_id.to_string()));
    }

    /// Test that the default data directory on Linux contains hidden directories.
    ///
    /// This documents why the asset protocol scope needs `requireLiteralLeadingDot: false`
    /// on Linux systems.
    #[test]
    #[cfg(target_os = "linux")]
    fn test_default_data_dir_contains_hidden_directory() {
        if let Ok(data_dir) = FileStorage::default_data_dir() {
            let path_str = data_dir.to_string_lossy();
            // On Linux, the default data dir is ~/.local/share/katt
            // This contains .local which is a "hidden" directory (starts with .)
            // Tauri's asset protocol with default settings won't match paths
            // containing hidden directories unless requireLiteralLeadingDot: false
            assert!(
                path_str.contains("/.local/") || path_str.contains("\\."),
                "Expected default data dir to contain hidden directory, got: {}",
                path_str
            );
        }
    }

    /// Test that asset paths are absolute paths starting with /
    #[test]
    fn test_asset_paths_are_absolute() {
        let temp_dir = TempDir::new().unwrap();
        let storage = FileStorage::new(temp_dir.path().to_path_buf());
        storage.init().unwrap();

        let notebook_id = Uuid::new_v4();
        let assets_dir = storage.notebook_assets_dir(notebook_id);

        // The path should be absolute
        assert!(
            assets_dir.is_absolute(),
            "Asset path should be absolute, got: {:?}",
            assets_dir
        );
    }
}
