//! Tauri commands for folder operations

use tauri::State;
use uuid::Uuid;

use crate::storage::Folder;
use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

/// List all folders in a notebook
#[tauri::command]
pub fn list_folders(state: State<AppState>, notebook_id: String) -> CommandResult<Vec<Folder>> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    storage.list_folders(id).map_err(Into::into)
}

/// Get a specific folder
#[tauri::command]
pub fn get_folder(
    state: State<AppState>,
    notebook_id: String,
    folder_id: String,
) -> CommandResult<Folder> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let fld_id = Uuid::parse_str(&folder_id).map_err(|e| CommandError {
        message: format!("Invalid folder ID: {}", e),
    })?;
    storage.get_folder(nb_id, fld_id).map_err(Into::into)
}

/// Create a new folder in a notebook
#[tauri::command]
pub fn create_folder(
    state: State<AppState>,
    notebook_id: String,
    name: String,
    parent_id: Option<String>,
) -> CommandResult<Folder> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let parent = parent_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid parent folder ID: {}", e),
            })
        })
        .transpose()?;

    storage.create_folder(nb_id, name, parent).map_err(Into::into)
}

/// Update a folder's properties
#[tauri::command]
pub fn update_folder(
    state: State<AppState>,
    notebook_id: String,
    folder_id: String,
    name: Option<String>,
    parent_id: Option<Option<String>>, // None = don't change, Some(None) = move to root, Some(Some(id)) = move to folder
) -> CommandResult<Folder> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let fld_id = Uuid::parse_str(&folder_id).map_err(|e| CommandError {
        message: format!("Invalid folder ID: {}", e),
    })?;

    let mut folder = storage.get_folder(nb_id, fld_id)?;

    if let Some(new_name) = name {
        folder.name = new_name;
    }

    if let Some(new_parent) = parent_id {
        folder.parent_id = new_parent
            .map(|id| {
                Uuid::parse_str(&id).map_err(|e| CommandError {
                    message: format!("Invalid parent folder ID: {}", e),
                })
            })
            .transpose()?;
    }

    folder.updated_at = chrono::Utc::now();
    storage.update_folder(&folder)?;

    Ok(folder)
}

/// Delete a folder
#[tauri::command]
pub fn delete_folder(
    state: State<AppState>,
    notebook_id: String,
    folder_id: String,
    move_pages_to: Option<String>,
) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let fld_id = Uuid::parse_str(&folder_id).map_err(|e| CommandError {
        message: format!("Invalid folder ID: {}", e),
    })?;
    let target = move_pages_to
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid target folder ID: {}", e),
            })
        })
        .transpose()?;

    storage
        .delete_folder(nb_id, fld_id, target)
        .map_err(Into::into)
}

/// Move a page to a folder (or root if folder_id is None)
#[tauri::command]
pub fn move_page_to_folder(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    folder_id: Option<String>,
    position: Option<i32>,
) -> CommandResult<crate::storage::Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;
    let fld_id = folder_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid folder ID: {}", e),
            })
        })
        .transpose()?;

    storage
        .move_page_to_folder(nb_id, pg_id, fld_id, position)
        .map_err(Into::into)
}

/// Archive a page
#[tauri::command]
pub fn archive_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<crate::storage::Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    storage.archive_page(nb_id, pg_id).map_err(Into::into)
}

/// Unarchive a page
#[tauri::command]
pub fn unarchive_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    target_folder_id: Option<String>,
) -> CommandResult<crate::storage::Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;
    let fld_id = target_folder_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid folder ID: {}", e),
            })
        })
        .transpose()?;

    storage
        .unarchive_page(nb_id, pg_id, fld_id)
        .map_err(Into::into)
}

/// Reorder folders within a parent
#[tauri::command]
pub fn reorder_folders(
    state: State<AppState>,
    notebook_id: String,
    parent_id: Option<String>,
    folder_ids: Vec<String>,
) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let parent = parent_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid parent folder ID: {}", e),
            })
        })
        .transpose()?;
    let ids: Result<Vec<Uuid>, _> = folder_ids
        .iter()
        .map(|id| {
            Uuid::parse_str(id).map_err(|e| CommandError {
                message: format!("Invalid folder ID: {}", e),
            })
        })
        .collect();

    storage
        .reorder_folders(nb_id, parent, &ids?)
        .map_err(Into::into)
}

/// Reorder pages within a folder
#[tauri::command]
pub fn reorder_pages(
    state: State<AppState>,
    notebook_id: String,
    folder_id: Option<String>,
    page_ids: Vec<String>,
) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let fld_id = folder_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid folder ID: {}", e),
            })
        })
        .transpose()?;
    let ids: Result<Vec<Uuid>, _> = page_ids
        .iter()
        .map(|id| {
            Uuid::parse_str(id).map_err(|e| CommandError {
                message: format!("Invalid page ID: {}", e),
            })
        })
        .collect();

    storage
        .reorder_pages(nb_id, fld_id, &ids?)
        .map_err(Into::into)
}

/// Ensure the archive folder exists for a notebook
#[tauri::command]
pub fn ensure_archive_folder(
    state: State<AppState>,
    notebook_id: String,
) -> CommandResult<Folder> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    storage.ensure_archive_folder(nb_id).map_err(Into::into)
}
