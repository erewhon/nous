//! Library Commands
//!
//! Tauri commands for managing libraries.

use serde::Serialize;
use std::path::PathBuf;
use tauri::State;
use uuid::Uuid;

use crate::library::{Library, LibraryStats};
use crate::AppState;

/// Error type for library commands
#[derive(Debug, Serialize)]
pub struct LibraryCommandError {
    message: String,
}

impl LibraryCommandError {
    pub fn new(message: &str) -> Self {
        Self {
            message: message.to_string(),
        }
    }
}

impl From<crate::library::LibraryError> for LibraryCommandError {
    fn from(e: crate::library::LibraryError) -> Self {
        Self {
            message: e.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, LibraryCommandError>;

/// List all libraries
#[tauri::command]
pub fn list_libraries(state: State<AppState>) -> CommandResult<Vec<Library>> {
    let storage = state
        .library_storage
        .lock()
        .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

    Ok(storage.list_libraries()?)
}

/// Get a library by ID
#[tauri::command]
pub fn get_library(state: State<AppState>, library_id: String) -> CommandResult<Library> {
    let id = Uuid::parse_str(&library_id)
        .map_err(|_| LibraryCommandError::new("Invalid library ID"))?;

    let storage = state
        .library_storage
        .lock()
        .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

    Ok(storage.get_library(id)?)
}

/// Get the current library
#[tauri::command]
pub fn get_current_library(state: State<AppState>) -> CommandResult<Library> {
    let storage = state
        .library_storage
        .lock()
        .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

    Ok(storage.get_current_library()?)
}

/// Create a new library
#[tauri::command]
pub fn create_library(
    state: State<AppState>,
    name: String,
    path: String,
) -> CommandResult<Library> {
    let path = PathBuf::from(&path);

    let storage = state
        .library_storage
        .lock()
        .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

    Ok(storage.create_library(name, path)?)
}

/// Update a library's metadata
#[tauri::command]
pub fn update_library(
    state: State<AppState>,
    library_id: String,
    name: Option<String>,
    icon: Option<String>,
    color: Option<String>,
) -> CommandResult<Library> {
    let id = Uuid::parse_str(&library_id)
        .map_err(|_| LibraryCommandError::new("Invalid library ID"))?;

    let storage = state
        .library_storage
        .lock()
        .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

    Ok(storage.update_library(id, name, icon, color)?)
}

/// Delete a library
#[tauri::command]
pub fn delete_library(state: State<AppState>, library_id: String) -> CommandResult<()> {
    let id = Uuid::parse_str(&library_id)
        .map_err(|_| LibraryCommandError::new("Invalid library ID"))?;

    let storage = state
        .library_storage
        .lock()
        .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

    storage.delete_library(id)?;
    Ok(())
}

/// Switch to a different library
#[tauri::command]
pub async fn switch_library(state: State<'_, AppState>, library_id: String) -> CommandResult<Library> {
    let id = Uuid::parse_str(&library_id)
        .map_err(|_| LibraryCommandError::new("Invalid library ID"))?;

    // Get the library and set it as current
    let library = {
        let storage = state
            .library_storage
            .lock()
            .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

        // Set as current
        storage.set_current_library_id(id)?;
        storage.get_library(id)?
    };

    // Reinitialize file storage with new library path
    {
        let mut file_storage = state
            .storage
            .lock()
            .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

        // Create new storage at library path
        *file_storage = crate::storage::FileStorage::new(library.path.clone());
        file_storage
            .init()
            .map_err(|e| LibraryCommandError::new(&format!("Failed to init storage: {}", e)))?;
    }

    // Reinitialize search index with new library path
    {
        let mut search_index = state
            .search_index
            .lock()
            .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

        let search_path = library.search_index_path();
        *search_index = crate::search::SearchIndex::new(search_path)
            .map_err(|e| LibraryCommandError::new(&format!("Failed to init search: {}", e)))?;
    }

    log::info!("Switched to library '{}' at {:?}", library.name, library.path);
    Ok(library)
}

/// Get statistics for a library
#[tauri::command]
pub fn get_library_stats(state: State<AppState>, library_id: String) -> CommandResult<LibraryStats> {
    let id = Uuid::parse_str(&library_id)
        .map_err(|_| LibraryCommandError::new("Invalid library ID"))?;

    let storage = state
        .library_storage
        .lock()
        .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

    Ok(storage.get_library_stats(id)?)
}

/// Validate a path for use as a library
#[tauri::command]
pub fn validate_library_path(state: State<AppState>, path: String) -> CommandResult<bool> {
    let path = PathBuf::from(&path);

    let storage = state
        .library_storage
        .lock()
        .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

    match storage.validate_library_path(&path) {
        Ok(_) => Ok(true),
        Err(e) => Err(LibraryCommandError::new(&e.to_string())),
    }
}

/// Open a folder picker dialog and return the selected path
#[tauri::command]
pub async fn pick_library_folder(app: tauri::AppHandle) -> CommandResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;

    let folder = app
        .dialog()
        .file()
        .set_title("Select Library Location")
        .blocking_pick_folder();

    Ok(folder.map(|p| p.to_string()))
}
