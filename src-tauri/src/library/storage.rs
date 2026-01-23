//! Library storage operations
//!
//! Handles CRUD operations for libraries, stored in libraries.json

use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

use super::models::{Library, LibraryStats};

/// Error type for library operations
#[derive(Debug, thiserror::Error)]
pub enum LibraryError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Library not found: {0}")]
    NotFound(Uuid),

    #[error("Cannot delete default library")]
    CannotDeleteDefault,

    #[error("Invalid library path: {0}")]
    InvalidPath(String),

    #[error("Library path already exists: {0}")]
    PathAlreadyExists(String),
}

/// Storage for library configuration
pub struct LibraryStorage {
    /// Base path for app data (e.g., ~/.local/share/katt)
    base_path: PathBuf,
}

impl LibraryStorage {
    /// Create a new library storage
    pub fn new(base_path: PathBuf) -> Self {
        Self { base_path }
    }

    /// Path to libraries.json
    fn libraries_file(&self) -> PathBuf {
        self.base_path.join("libraries.json")
    }

    /// Path to current_library.json
    fn current_library_file(&self) -> PathBuf {
        self.base_path.join("current_library.json")
    }

    /// Initialize library storage, creating default library if needed
    pub fn init(&self) -> Result<Library, LibraryError> {
        // Ensure base directory exists
        fs::create_dir_all(&self.base_path)?;

        // Check if libraries.json exists
        let libs_file = self.libraries_file();
        if !libs_file.exists() {
            // Create default library
            let default_lib = Library::default_library(self.base_path.clone());

            // Ensure default library directories exist
            fs::create_dir_all(default_lib.notebooks_path())?;
            fs::create_dir_all(default_lib.search_index_path())?;

            // Save libraries
            let libraries = vec![default_lib.clone()];
            let content = serde_json::to_string_pretty(&libraries)?;
            fs::write(&libs_file, content)?;

            // Set as current library
            self.set_current_library_id(default_lib.id)?;

            log::info!("Created default library at {:?}", default_lib.path);
            return Ok(default_lib);
        }

        // Return current library
        let current_id = self.get_current_library_id()?;
        self.get_library(current_id)
    }

    /// List all libraries
    pub fn list_libraries(&self) -> Result<Vec<Library>, LibraryError> {
        let libs_file = self.libraries_file();
        if !libs_file.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(&libs_file)?;
        let libraries: Vec<Library> = serde_json::from_str(&content)?;
        Ok(libraries)
    }

    /// Get a library by ID
    pub fn get_library(&self, id: Uuid) -> Result<Library, LibraryError> {
        let libraries = self.list_libraries()?;
        libraries
            .into_iter()
            .find(|lib| lib.id == id)
            .ok_or(LibraryError::NotFound(id))
    }

    /// Create a new library
    pub fn create_library(&self, name: String, path: PathBuf) -> Result<Library, LibraryError> {
        // Validate path
        if !path.is_absolute() {
            return Err(LibraryError::InvalidPath(
                "Path must be absolute".to_string(),
            ));
        }

        // Check if path already used by another library
        let libraries = self.list_libraries()?;
        for lib in &libraries {
            if lib.path == path {
                return Err(LibraryError::PathAlreadyExists(
                    path.to_string_lossy().to_string(),
                ));
            }
        }

        // Create library directories
        let library = Library::new(name, path);
        fs::create_dir_all(library.notebooks_path())?;
        fs::create_dir_all(library.search_index_path())?;

        // Add to libraries list
        let mut libraries = libraries;
        libraries.push(library.clone());
        self.save_libraries(&libraries)?;

        log::info!("Created library '{}' at {:?}", library.name, library.path);
        Ok(library)
    }

    /// Update a library's metadata
    pub fn update_library(
        &self,
        id: Uuid,
        name: Option<String>,
        icon: Option<String>,
        color: Option<String>,
    ) -> Result<Library, LibraryError> {
        let mut libraries = self.list_libraries()?;

        let lib = libraries
            .iter_mut()
            .find(|lib| lib.id == id)
            .ok_or(LibraryError::NotFound(id))?;

        if let Some(n) = name {
            lib.name = n;
        }
        if let Some(i) = icon {
            lib.icon = Some(i);
        }
        if let Some(c) = color {
            lib.color = Some(c);
        }
        lib.updated_at = chrono::Utc::now();

        let updated = lib.clone();
        self.save_libraries(&libraries)?;

        log::info!("Updated library '{}'", updated.name);
        Ok(updated)
    }

    /// Delete a library (cannot delete default)
    pub fn delete_library(&self, id: Uuid) -> Result<(), LibraryError> {
        let libraries = self.list_libraries()?;

        // Find the library
        let lib = libraries
            .iter()
            .find(|lib| lib.id == id)
            .ok_or(LibraryError::NotFound(id))?;

        // Cannot delete default
        if lib.is_default {
            return Err(LibraryError::CannotDeleteDefault);
        }

        // Remove from list (don't delete files - user may want to re-add)
        let libraries: Vec<Library> = libraries.into_iter().filter(|lib| lib.id != id).collect();
        self.save_libraries(&libraries)?;

        // If this was the current library, switch to default
        let current_id = self.get_current_library_id()?;
        if current_id == id {
            let default_lib = libraries
                .iter()
                .find(|lib| lib.is_default)
                .ok_or(LibraryError::NotFound(id))?;
            self.set_current_library_id(default_lib.id)?;
        }

        log::info!("Deleted library {}", id);
        Ok(())
    }

    /// Get the current library ID
    pub fn get_current_library_id(&self) -> Result<Uuid, LibraryError> {
        let file = self.current_library_file();
        if !file.exists() {
            // Return default library ID
            let libraries = self.list_libraries()?;
            let default_lib = libraries
                .into_iter()
                .find(|lib| lib.is_default)
                .ok_or(LibraryError::NotFound(Uuid::nil()))?;
            return Ok(default_lib.id);
        }

        let content = fs::read_to_string(&file)?;
        let id: Uuid = serde_json::from_str(&content)?;
        Ok(id)
    }

    /// Set the current library ID
    pub fn set_current_library_id(&self, id: Uuid) -> Result<(), LibraryError> {
        // Verify library exists
        self.get_library(id)?;

        let file = self.current_library_file();
        let content = serde_json::to_string_pretty(&id)?;
        fs::write(&file, content)?;

        log::info!("Set current library to {}", id);
        Ok(())
    }

    /// Get the current library
    pub fn get_current_library(&self) -> Result<Library, LibraryError> {
        let id = self.get_current_library_id()?;
        self.get_library(id)
    }

    /// Get statistics for a library
    pub fn get_library_stats(&self, id: Uuid) -> Result<LibraryStats, LibraryError> {
        let library = self.get_library(id)?;
        let notebooks_path = library.notebooks_path();

        let mut notebook_count = 0;
        let mut total_size: u64 = 0;
        let mut last_modified: Option<chrono::DateTime<chrono::Utc>> = None;

        if notebooks_path.exists() {
            for entry in fs::read_dir(&notebooks_path)? {
                let entry = entry?;
                let path = entry.path();

                if path.is_dir() {
                    // Check if it's a valid notebook (has notebook.json)
                    if path.join("notebook.json").exists() {
                        notebook_count += 1;

                        // Calculate size recursively
                        total_size += dir_size(&path).unwrap_or(0);

                        // Track last modified
                        if let Ok(metadata) = path.metadata() {
                            if let Ok(modified) = metadata.modified() {
                                let modified_dt: chrono::DateTime<chrono::Utc> = modified.into();
                                if last_modified.is_none() || Some(modified_dt) > last_modified {
                                    last_modified = Some(modified_dt);
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(LibraryStats {
            library_id: id,
            notebook_count,
            total_size_bytes: total_size,
            last_modified,
        })
    }

    /// Validate a path for use as a library
    pub fn validate_library_path(&self, path: &PathBuf) -> Result<(), LibraryError> {
        // Must be absolute
        if !path.is_absolute() {
            return Err(LibraryError::InvalidPath(
                "Path must be absolute".to_string(),
            ));
        }

        // Check if already used
        let libraries = self.list_libraries()?;
        for lib in &libraries {
            if lib.path == *path {
                return Err(LibraryError::PathAlreadyExists(
                    path.to_string_lossy().to_string(),
                ));
            }
        }

        // Try to create/access the directory
        if path.exists() {
            if !path.is_dir() {
                return Err(LibraryError::InvalidPath(
                    "Path exists but is not a directory".to_string(),
                ));
            }
            // Check if writable by trying to create a test file
            let test_file = path.join(".katt_write_test");
            match fs::write(&test_file, "test") {
                Ok(_) => {
                    let _ = fs::remove_file(&test_file);
                }
                Err(_) => {
                    return Err(LibraryError::InvalidPath(
                        "Directory is not writable".to_string(),
                    ));
                }
            }
        } else {
            // Try to create the directory
            fs::create_dir_all(path).map_err(|_| {
                LibraryError::InvalidPath("Cannot create directory at path".to_string())
            })?;
        }

        Ok(())
    }

    /// Save libraries to file
    fn save_libraries(&self, libraries: &[Library]) -> Result<(), LibraryError> {
        let content = serde_json::to_string_pretty(libraries)?;
        fs::write(self.libraries_file(), content)?;
        Ok(())
    }

    /// Move a notebook from one library to another
    /// Returns the new notebook path in the target library
    pub fn move_notebook_to_library(
        &self,
        notebook_id: Uuid,
        source_library_id: Uuid,
        target_library_id: Uuid,
    ) -> Result<PathBuf, LibraryError> {
        // Get both libraries
        let source_lib = self.get_library(source_library_id)?;
        let target_lib = self.get_library(target_library_id)?;

        // Paths
        let source_notebook_path = source_lib.notebooks_path().join(notebook_id.to_string());
        let target_notebook_path = target_lib.notebooks_path().join(notebook_id.to_string());

        // Verify source notebook exists
        if !source_notebook_path.exists() {
            return Err(LibraryError::InvalidPath(format!(
                "Notebook {} not found in source library",
                notebook_id
            )));
        }

        // Verify target notebook doesn't already exist
        if target_notebook_path.exists() {
            return Err(LibraryError::PathAlreadyExists(format!(
                "Notebook {} already exists in target library",
                notebook_id
            )));
        }

        // Ensure target notebooks directory exists
        fs::create_dir_all(target_lib.notebooks_path())?;

        // Copy notebook directory recursively
        copy_dir_recursive(&source_notebook_path, &target_notebook_path)?;

        // Remove source notebook directory
        fs::remove_dir_all(&source_notebook_path)?;

        log::info!(
            "Moved notebook {} from library {} to library {}",
            notebook_id,
            source_lib.name,
            target_lib.name
        );

        Ok(target_notebook_path)
    }
}

/// Copy directory recursively
fn copy_dir_recursive(src: &PathBuf, dst: &PathBuf) -> Result<(), std::io::Error> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if ty.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// Calculate directory size recursively
fn dir_size(path: &PathBuf) -> Result<u64, std::io::Error> {
    let mut size = 0;
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if metadata.is_dir() {
            size += dir_size(&entry.path())?;
        } else {
            size += metadata.len();
        }
    }
    Ok(size)
}
