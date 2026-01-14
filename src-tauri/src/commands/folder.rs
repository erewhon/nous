//! Tauri commands for folder operations

use tauri::State;
use uuid::Uuid;

use crate::git;
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
    section_id: Option<String>,
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
    let sect_id = section_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid section ID: {}", e),
            })
        })
        .transpose()?;

    let mut folder = storage.create_folder(nb_id, name.clone(), parent)?;

    // If section_id provided, update the folder with section
    if sect_id.is_some() {
        folder.section_id = sect_id;
        storage.update_folder(&folder)?;
    }

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Create folder: {}", name);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit folder creation: {}", e);
        }
    }

    Ok(folder)
}

/// Update a folder's properties
#[tauri::command]
pub fn update_folder(
    state: State<AppState>,
    notebook_id: String,
    folder_id: String,
    name: Option<String>,
    parent_id: Option<Option<String>>, // None = don't change, Some(None) = move to root, Some(Some(id)) = move to folder
    color: Option<Option<String>>,     // None = don't change, Some(None) = clear color, Some(Some(c)) = set color
    section_id: Option<Option<String>>, // None = don't change, Some(None) = no section, Some(Some(id)) = set section
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

    if let Some(new_color) = color {
        folder.color = new_color;
    }

    if let Some(new_section) = section_id {
        let new_section_uuid = new_section
            .map(|id| {
                Uuid::parse_str(&id).map_err(|e| CommandError {
                    message: format!("Invalid section ID: {}", e),
                })
            })
            .transpose()?;

        // If section is changing, also update all pages in this folder
        if folder.section_id != new_section_uuid {
            let pages = storage.list_pages(nb_id)?;
            for mut page in pages {
                if page.folder_id == Some(fld_id) {
                    page.section_id = new_section_uuid;
                    page.updated_at = chrono::Utc::now();
                    storage.update_page(&page)?;
                }
            }
        }

        folder.section_id = new_section_uuid;
    }

    folder.updated_at = chrono::Utc::now();
    storage.update_folder(&folder)?;

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Update folder: {}", folder.name);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit folder update: {}", e);
        }
    }

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

    storage.delete_folder(nb_id, fld_id, target)?;

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = "Delete folder".to_string();
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit folder deletion: {}", e);
        }
    }

    Ok(())
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

    let page = storage.move_page_to_folder(nb_id, pg_id, fld_id, position)?;

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Move page: {}", page.title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit page move: {}", e);
        }
    }

    Ok(page)
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

    let page = storage.archive_page(nb_id, pg_id)?;

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Archive page: {}", page.title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit page archive: {}", e);
        }
    }

    Ok(page)
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

    let page = storage.unarchive_page(nb_id, pg_id, fld_id)?;

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Unarchive page: {}", page.title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit page unarchive: {}", e);
        }
    }

    Ok(page)
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
