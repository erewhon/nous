use std::fs;
use std::path::PathBuf;

use thiserror::Error;
use uuid::Uuid;

use super::models::{Notebook, NotebookType, Page};

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Notebook not found: {0}")]
    NotebookNotFound(Uuid),

    #[error("Page not found: {0}")]
    PageNotFound(Uuid),

    #[error("Data directory not found")]
    DataDirNotFound,
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

    fn notebook_dir(&self, notebook_id: Uuid) -> PathBuf {
        self.base_path.join("notebooks").join(notebook_id.to_string())
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
}
