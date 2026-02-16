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

    // Reinitialize goals storage with new library path
    {
        let mut goals_storage = state
            .goals_storage
            .lock()
            .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

        *goals_storage = crate::goals::GoalsStorage::new(library.path.clone())
            .map_err(|e| LibraryCommandError::new(&format!("Failed to init goals storage: {}", e)))?;
    }

    // Reinitialize inbox storage with new library path
    {
        let mut inbox_storage = state
            .inbox_storage
            .lock()
            .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

        *inbox_storage = crate::inbox::InboxStorage::new(library.path.clone())
            .map_err(|e| LibraryCommandError::new(&format!("Failed to init inbox storage: {}", e)))?;
    }

    // Reinitialize action storage with new library path
    {
        let mut action_storage = state
            .action_storage
            .lock()
            .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

        *action_storage = crate::actions::ActionStorage::new(library.path.clone())
            .map_err(|e| LibraryCommandError::new(&format!("Failed to init action storage: {}", e)))?;
    }

    // Reinitialize vector index with new library path (bug fix: was not reinitialized)
    {
        let mut vector_index = state
            .vector_index
            .lock()
            .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

        *vector_index = crate::rag::VectorIndex::new(library.vector_db_path())
            .map_err(|e| LibraryCommandError::new(&format!("Failed to init vector index: {}", e)))?;
    }

    // Reinitialize flashcard storage with new library path (bug fix: was not reinitialized)
    {
        let mut flashcard_storage = state
            .flashcard_storage
            .lock()
            .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

        *flashcard_storage = crate::flashcards::FlashcardStorage::new(library.path.join("notebooks"));
    }

    // Reinitialize CRDT store with new library path (bug fix: was not reinitialized)
    state.crdt_store.set_data_dir(library.path.clone());

    // Add the new library path to the video server's allowed directories
    {
        let server_guard = state.video_server.lock().await;
        if let Some(ref server) = *server_guard {
            server.add_allowed_dir(library.path.clone());
        }
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

/// Move a notebook from one library to another
#[tauri::command]
pub fn move_notebook_to_library(
    state: State<AppState>,
    notebook_id: String,
    source_library_id: String,
    target_library_id: String,
) -> CommandResult<String> {
    let nb_id = Uuid::parse_str(&notebook_id)
        .map_err(|_| LibraryCommandError::new("Invalid notebook ID"))?;
    let source_lib_id = Uuid::parse_str(&source_library_id)
        .map_err(|_| LibraryCommandError::new("Invalid source library ID"))?;
    let target_lib_id = Uuid::parse_str(&target_library_id)
        .map_err(|_| LibraryCommandError::new("Invalid target library ID"))?;

    // Move the notebook
    let new_path = {
        let storage = state
            .library_storage
            .lock()
            .map_err(|e| LibraryCommandError::new(&format!("Lock error: {}", e)))?;

        storage.move_notebook_to_library(nb_id, source_lib_id, target_lib_id)?
    };

    // Note: Search index handling:
    // - The notebook pages are no longer in the source library, so if we're viewing
    //   the source library, searches won't find them (file not found during search)
    // - When the target library is switched to, its search index will be used
    // - A full re-index may be needed for the target library to include the moved notebook

    log::info!(
        "Moved notebook {} from library {} to library {}",
        notebook_id,
        source_library_id,
        target_library_id
    );

    Ok(new_path.to_string_lossy().to_string())
}
