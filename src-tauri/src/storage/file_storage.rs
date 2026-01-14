use std::fs;
use std::path::PathBuf;

use thiserror::Error;
use uuid::Uuid;

use super::models::{Folder, FolderType, Notebook, NotebookType, Page, Section};

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("ZIP error: {0}")]
    Zip(#[from] zip::result::ZipError),

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

        // Sort by updated_at descending
        notebooks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

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

    pub fn update_page(&self, page: &Page) -> Result<()> {
        let page_path = self.page_path(page.notebook_id, page.id);

        if !page_path.exists() {
            return Err(StorageError::PageNotFound(page.id));
        }

        let content = serde_json::to_string_pretty(page)?;
        fs::write(&page_path, content)?;

        Ok(())
    }

    pub fn delete_page(&self, notebook_id: Uuid, page_id: Uuid) -> Result<()> {
        let page_path = self.page_path(notebook_id, page_id);

        if !page_path.exists() {
            return Err(StorageError::PageNotFound(page_id));
        }

        fs::remove_file(&page_path)?;
        Ok(())
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
}
