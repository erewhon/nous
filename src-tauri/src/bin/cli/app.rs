use anyhow::{Context, Result, bail};
use uuid::Uuid;

use nous_lib::inbox::{CaptureRequest, CaptureSource, InboxItem, InboxStorage};
use nous_lib::library::{Library, LibraryStorage};
use nous_lib::search::ReadOnlySearchIndex;
use nous_lib::storage::{EditorBlock, EditorData, FileStorage, Folder, Notebook, Page, Section};

/// Shared application state for CLI commands
pub struct App {
    pub library_storage: LibraryStorage,
    pub current_library: Library,
    pub storage: FileStorage,
    pub search_index: Option<ReadOnlySearchIndex>,
}

impl App {
    /// Initialize from default data directory
    pub fn new(library_name: Option<&str>) -> Result<Self> {
        let data_dir = FileStorage::default_data_dir()
            .context("Failed to get data directory")?;

        let library_storage = LibraryStorage::new(data_dir);
        let current_library = if let Some(name) = library_name {
            let libs = library_storage.list_libraries()
                .context("Failed to list libraries")?;
            libs.into_iter()
                .find(|lib| lib.name.to_lowercase() == name.to_lowercase())
                .context(format!("Library '{}' not found", name))?
        } else {
            library_storage.init()
                .context("Failed to initialize library storage")?
        };

        let library_path = current_library.path.clone();
        let storage = FileStorage::new(library_path);

        // Try to open search index in read-only mode (may fail if index doesn't exist yet)
        let search_dir = current_library.search_index_path();
        let search_index = if search_dir.exists() {
            ReadOnlySearchIndex::open(search_dir).ok()
        } else {
            None
        };

        Ok(Self {
            library_storage,
            current_library,
            storage,
            search_index,
        })
    }

    /// Find a notebook by name (case-insensitive prefix match)
    pub fn find_notebook(&self, name: &str) -> Result<Notebook> {
        let notebooks = self.storage.list_notebooks()
            .context("Failed to list notebooks")?;

        let name_lower = name.to_lowercase();

        // Exact match first
        if let Some(nb) = notebooks.iter().find(|n| n.name.to_lowercase() == name_lower) {
            return Ok(nb.clone());
        }

        // Prefix match
        let matches: Vec<&Notebook> = notebooks.iter()
            .filter(|n| n.name.to_lowercase().starts_with(&name_lower))
            .collect();

        match matches.len() {
            0 => bail!("No notebook matching '{}'. Available notebooks:\n{}", name,
                notebooks.iter().map(|n| format!("  - {}", n.name)).collect::<Vec<_>>().join("\n")),
            1 => Ok(matches[0].clone()),
            _ => bail!("Ambiguous notebook name '{}'. Matches:\n{}", name,
                matches.iter().map(|n| format!("  - {}", n.name)).collect::<Vec<_>>().join("\n")),
        }
    }

    /// Find a page by title within a notebook (case-insensitive prefix match)
    pub fn find_page(&self, notebook_id: Uuid, title: &str) -> Result<Page> {
        let pages = self.storage.list_pages(notebook_id)
            .context("Failed to list pages")?;

        let title_lower = title.to_lowercase();

        // Exact match first
        if let Some(page) = pages.iter().find(|p| p.title.to_lowercase() == title_lower) {
            return Ok(page.clone());
        }

        // Prefix match
        let matches: Vec<&Page> = pages.iter()
            .filter(|p| p.title.to_lowercase().starts_with(&title_lower))
            .collect();

        match matches.len() {
            0 => bail!("No page matching '{}' in notebook", title),
            1 => Ok(matches[0].clone()),
            _ => bail!("Ambiguous page title '{}'. Matches:\n{}", title,
                matches.iter().map(|p| format!("  - {}", p.title)).collect::<Vec<_>>().join("\n")),
        }
    }

    /// List all notebooks in current library
    pub fn list_notebooks(&self) -> Result<Vec<Notebook>> {
        self.storage.list_notebooks().context("Failed to list notebooks")
    }

    /// List pages in a notebook
    pub fn list_pages(&self, notebook_id: Uuid) -> Result<Vec<Page>> {
        self.storage.list_pages(notebook_id).context("Failed to list pages")
    }

    /// List folders in a notebook
    pub fn list_folders(&self, notebook_id: Uuid) -> Result<Vec<Folder>> {
        self.storage.list_folders(notebook_id).context("Failed to list folders")
    }

    /// List all libraries
    pub fn list_libraries(&self) -> Result<Vec<Library>> {
        self.library_storage.list_libraries().context("Failed to list libraries")
    }

    /// Get all tags (across all notebooks in current library)
    pub fn get_all_tags(&self) -> Result<Vec<(String, usize)>> {
        self.storage.get_all_tags().context("Failed to get tags")
    }

    /// Get tags for a specific notebook
    pub fn get_notebook_tags(&self, notebook_id: Uuid) -> Result<Vec<(String, usize)>> {
        self.storage.get_notebook_tags(notebook_id).context("Failed to get notebook tags")
    }

    /// List sections in a notebook
    pub fn list_sections(&self, notebook_id: Uuid) -> Result<Vec<Section>> {
        self.storage.list_sections(notebook_id).context("Failed to list sections")
    }

    /// Get a notebook by ID
    pub fn get_notebook(&self, notebook_id: Uuid) -> Result<Notebook> {
        self.storage.get_notebook(notebook_id).context("Failed to get notebook")
    }

    /// Find a folder by name within a notebook (case-insensitive prefix match)
    pub fn find_folder(&self, notebook_id: Uuid, name: &str) -> Result<Folder> {
        let folders = self.list_folders(notebook_id)?;
        let name_lower = name.to_lowercase();

        if let Some(f) = folders.iter().find(|f| f.name.to_lowercase() == name_lower) {
            return Ok(f.clone());
        }

        let matches: Vec<&Folder> = folders.iter()
            .filter(|f| f.name.to_lowercase().starts_with(&name_lower))
            .collect();

        match matches.len() {
            0 => bail!("No folder matching '{}' in notebook", name),
            1 => Ok(matches[0].clone()),
            _ => bail!("Ambiguous folder name '{}'. Matches:\n{}", name,
                matches.iter().map(|f| format!("  - {}", f.name)).collect::<Vec<_>>().join("\n")),
        }
    }

    /// Create a new page in a notebook
    pub fn create_page(&self, notebook_id: Uuid, title: String) -> Result<Page> {
        self.storage.create_page(notebook_id, title)
            .context("Failed to create page")
    }

    /// Update an existing page
    pub fn update_page(&self, page: &Page) -> Result<()> {
        self.storage.update_page(page)
            .context("Failed to update page")
    }

    /// Capture an inbox item
    pub fn capture_inbox(&self, title: String, content: String, tags: Option<Vec<String>>) -> Result<InboxItem> {
        let data_dir = FileStorage::default_data_dir()
            .context("Failed to get data directory")?;
        let inbox_storage = InboxStorage::new(data_dir)
            .context("Failed to initialize inbox storage")?;

        let request = CaptureRequest {
            title,
            content,
            tags,
            source: Some(CaptureSource::Api { source: "cli".to_string() }),
            auto_classify: None,
        };

        inbox_storage.capture(request).context("Failed to capture inbox item")
    }

    /// List inbox items
    pub fn list_inbox(&self, unprocessed_only: bool) -> Result<Vec<InboxItem>> {
        let data_dir = FileStorage::default_data_dir()
            .context("Failed to get data directory")?;
        let inbox_storage = InboxStorage::new(data_dir)
            .context("Failed to initialize inbox storage")?;

        if unprocessed_only {
            inbox_storage.list_unprocessed().context("Failed to list inbox items")
        } else {
            inbox_storage.list_items().context("Failed to list inbox items")
        }
    }

    /// Build EditorData with a single paragraph block
    pub fn make_paragraph_content(text: &str) -> EditorData {
        EditorData {
            time: Some(chrono::Utc::now().timestamp_millis()),
            version: Some("2.28.0".to_string()),
            blocks: vec![EditorBlock {
                id: Uuid::new_v4().to_string()[..10].to_string(),
                block_type: "paragraph".to_string(),
                data: serde_json::json!({ "text": text }),
            }],
        }
    }
}
