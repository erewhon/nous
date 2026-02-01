use tauri::State;
use uuid::Uuid;

use crate::git;
use crate::storage::{EditorData, Page};
use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

#[tauri::command]
pub fn list_pages(
    state: State<AppState>,
    notebook_id: String,
    include_archived: Option<bool>,
) -> CommandResult<Vec<Page>> {
    let storage = state.storage.lock().unwrap();
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let mut pages = storage.list_pages(id)?;

    // Always exclude deleted pages (use list_trash for those)
    pages.retain(|p| p.deleted_at.is_none());

    // Filter archived pages unless explicitly requested
    if !include_archived.unwrap_or(false) {
        pages.retain(|p| !p.is_archived);
    }

    Ok(pages)
}

#[tauri::command]
pub fn get_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;
    storage.get_page(nb_id, pg_id).map_err(Into::into)
}

#[tauri::command(rename_all = "camelCase")]
pub fn create_page(
    state: State<AppState>,
    notebook_id: String,
    title: String,
    folder_id: Option<String>,
    parent_page_id: Option<String>,
    section_id: Option<String>,
    template_id: Option<String>,
) -> CommandResult<Page> {
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
    let parent_pg_id = parent_page_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid parent page ID: {}", e),
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

    let mut page = storage.create_page(nb_id, title)?;

    // If template_id specified, set it on the page
    if template_id.is_some() {
        page.template_id = template_id;
        storage.update_page(&page)?;
    }

    // If folder_id specified, move page to that folder
    if fld_id.is_some() {
        page = storage.move_page_to_folder(nb_id, page.id, fld_id, None)?;
    }

    // If parent_page_id specified, set the parent page
    if parent_pg_id.is_some() {
        page.parent_page_id = parent_pg_id;
        storage.update_page(&page)?;
    }

    // If section_id specified, set the section
    if sect_id.is_some() {
        page.section_id = sect_id;
        storage.update_page(&page)?;
    }

    // Notify sync manager of the new page
    state.sync_manager.queue_page_update(nb_id, page.id);

    // Index the new page
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.index_page(&page);
    }

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Create page: {}", page.title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit page creation: {}", e);
        }
    }

    Ok(page)
}

#[tauri::command(rename_all = "camelCase")]
pub fn update_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    title: Option<String>,
    content: Option<EditorData>,
    tags: Option<Vec<String>>,
    system_prompt: Option<String>,
    system_prompt_mode: Option<String>,
    section_id: Option<Option<String>>,
    page_type: Option<String>,
    file_extension: Option<String>,
    is_favorite: Option<bool>,
    #[allow(unused_variables)]
    commit: Option<bool>, // Whether to create a git commit (default: false)
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let mut page = storage.get_page(nb_id, pg_id)?;

    if let Some(title) = title {
        page.title = title;
    }
    if let Some(content) = content {
        page.content = content;
    }
    if let Some(tags) = tags {
        page.tags = tags;
    }
    // Allow setting system_prompt to None (empty string clears it)
    if let Some(prompt) = system_prompt {
        page.system_prompt = if prompt.is_empty() { None } else { Some(prompt) };
    }
    // Set system_prompt_mode
    if let Some(mode) = system_prompt_mode {
        page.system_prompt_mode = match mode.as_str() {
            "concatenate" => crate::storage::SystemPromptMode::Concatenate,
            _ => crate::storage::SystemPromptMode::Override,
        };
    }
    // Allow setting section_id (Some(Some(id)) to set, Some(None) to clear)
    if let Some(sect_id) = section_id {
        page.section_id = sect_id.map(|id| {
            Uuid::parse_str(&id).expect("Invalid section ID")
        });
    }
    // Set page_type if provided
    if let Some(pt) = page_type.clone() {
        page.page_type = match pt.as_str() {
            "markdown" => crate::storage::PageType::Markdown,
            "pdf" => crate::storage::PageType::Pdf,
            "jupyter" => crate::storage::PageType::Jupyter,
            "epub" => crate::storage::PageType::Epub,
            "calendar" => crate::storage::PageType::Calendar,
            "chat" => crate::storage::PageType::Chat,
            _ => crate::storage::PageType::Standard,
        };
    }
    // Set file_extension if provided
    if let Some(ext) = file_extension.clone() {
        page.file_extension = if ext.is_empty() { None } else { Some(ext.clone()) };

        // If this is a file-based page type and source_file is not set, create it
        if page.source_file.is_none() && !ext.is_empty() {
            let is_file_based = matches!(
                page.page_type,
                crate::storage::PageType::Markdown
                    | crate::storage::PageType::Calendar
                    | crate::storage::PageType::Chat
                    | crate::storage::PageType::Jupyter
            );
            if is_file_based {
                // Set source_file to files/{page_id}.{ext}
                page.source_file = Some(format!("files/{}.{}", pg_id, ext));
                page.storage_mode = Some(crate::storage::FileStorageMode::Embedded);

                // Create the files directory if it doesn't exist
                let files_dir = storage.get_notebook_path(nb_id).join("files");
                if !files_dir.exists() {
                    let _ = std::fs::create_dir_all(&files_dir);
                }
            }
        }
    }
    // Set is_favorite if provided
    if let Some(favorite) = is_favorite {
        page.is_favorite = favorite;
    }
    page.updated_at = chrono::Utc::now();

    storage.update_page(&page)?;

    // Notify sync manager of the change
    state.sync_manager.queue_page_update(nb_id, pg_id);

    // Update the search index
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.index_page(&page);
    }

    // Only commit if explicitly requested (not on every auto-save)
    let should_commit = commit.unwrap_or(false);
    if should_commit {
        let notebook_path = storage.get_notebook_path(nb_id);
        if git::is_git_repo(&notebook_path) {
            let commit_message = format!("Update page: {}", page.title);
            if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
                log::warn!("Failed to auto-commit page update: {}", e);
            }
        }
    }

    Ok(page)
}

/// Move a page to trash (soft delete)
#[tauri::command]
pub fn delete_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    // Get page title for commit message before deleting
    let page_title = storage
        .get_page(nb_id, pg_id)
        .map(|p| p.title)
        .unwrap_or_else(|_| "Unknown".to_string());

    storage.delete_page(nb_id, pg_id)?;

    // Notify sync manager of the deletion
    state.sync_manager.queue_page_delete(nb_id, pg_id);

    // Remove from search index (page is in trash)
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.remove_page(pg_id);
    }

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Move to trash: {}", page_title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit page deletion: {}", e);
        }
    }

    Ok(())
}

/// Permanently delete a page (no recovery possible)
#[tauri::command]
pub fn permanent_delete_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<()> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    // Get page title for commit message before deleting
    let page_title = storage
        .get_page(nb_id, pg_id)
        .map(|p| p.title)
        .unwrap_or_else(|_| "Unknown".to_string());

    storage.permanent_delete_page(nb_id, pg_id)?;

    // Remove from search index
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.remove_page(pg_id);
    }

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Permanently delete: {}", page_title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit page deletion: {}", e);
        }
    }

    Ok(())
}

/// Restore a page from trash
#[tauri::command]
pub fn restore_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let page = storage.restore_page(nb_id, pg_id)?;

    // Re-add to search index
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.index_page(&page);
    }

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Restore from trash: {}", page.title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit page restoration: {}", e);
        }
    }

    Ok(page)
}

/// List all pages in trash for a notebook
#[tauri::command]
pub fn list_trash(
    state: State<AppState>,
    notebook_id: String,
) -> CommandResult<Vec<Page>> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    storage.list_trash(nb_id).map_err(Into::into)
}

/// Purge pages that have been in trash for more than the specified days (default: 30)
#[tauri::command]
pub fn purge_old_trash(
    state: State<AppState>,
    notebook_id: String,
    days: Option<i64>,
) -> CommandResult<usize> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let retention_days = days.unwrap_or(30);
    storage.purge_old_trash(nb_id, retention_days).map_err(Into::into)
}

/// Move a page from one notebook to another
#[tauri::command]
pub fn move_page_to_notebook(
    state: State<AppState>,
    source_notebook_id: String,
    page_id: String,
    target_notebook_id: String,
    target_folder_id: Option<String>,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let source_nb_id = Uuid::parse_str(&source_notebook_id).map_err(|e| CommandError {
        message: format!("Invalid source notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;
    let target_nb_id = Uuid::parse_str(&target_notebook_id).map_err(|e| CommandError {
        message: format!("Invalid target notebook ID: {}", e),
    })?;
    let target_folder = target_folder_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid target folder ID: {}", e),
            })
        })
        .transpose()?;

    // Get page title for commit messages
    let page_title = storage
        .get_page(source_nb_id, pg_id)
        .map(|p| p.title.clone())
        .unwrap_or_else(|_| "Unknown".to_string());

    // Move the page
    let moved_page = storage.move_page_to_notebook(source_nb_id, pg_id, target_nb_id, target_folder)?;

    // Update search index - remove from old, add to new
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.remove_page(pg_id);
        let _ = search_index.index_page(&moved_page);
    }

    // Auto-commit in both notebooks if git is enabled
    let source_path = storage.get_notebook_path(source_nb_id);
    if git::is_git_repo(&source_path) {
        let commit_message = format!("Move page '{}' to another notebook", page_title);
        if let Err(e) = git::commit_all(&source_path, &commit_message) {
            log::warn!("Failed to auto-commit page move from source: {}", e);
        }
    }

    let target_path = storage.get_notebook_path(target_nb_id);
    if git::is_git_repo(&target_path) {
        let commit_message = format!("Receive page '{}' from another notebook", page_title);
        if let Err(e) = git::commit_all(&target_path, &commit_message) {
            log::warn!("Failed to auto-commit page move to target: {}", e);
        }
    }

    Ok(moved_page)
}

/// Move a page to be a child of another page (nested pages)
#[tauri::command]
pub fn move_page_to_parent(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    parent_page_id: Option<String>,
    position: Option<i32>,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;
    let parent_pg_id = parent_page_id
        .map(|id| {
            Uuid::parse_str(&id).map_err(|e| CommandError {
                message: format!("Invalid parent page ID: {}", e),
            })
        })
        .transpose()?;

    let mut page = storage.get_page(nb_id, pg_id)?;

    // Prevent circular reference - can't make a page its own parent
    if let Some(parent_id) = parent_pg_id {
        if parent_id == pg_id {
            return Err(CommandError {
                message: "Cannot make a page its own parent".to_string(),
            });
        }

        // Check for circular reference by walking up the parent chain
        let mut current_parent = Some(parent_id);
        while let Some(check_id) = current_parent {
            if check_id == pg_id {
                return Err(CommandError {
                    message: "Cannot create circular parent reference".to_string(),
                });
            }
            let parent_page = storage.get_page(nb_id, check_id)?;
            current_parent = parent_page.parent_page_id;
        }
    }

    // Update parent page reference
    page.parent_page_id = parent_pg_id;

    // If moving to a parent page, clear folder_id (nested pages don't belong to folders directly)
    if parent_pg_id.is_some() {
        page.folder_id = None;
    }

    // Update position if specified
    if let Some(pos) = position {
        page.position = pos;
    }

    page.updated_at = chrono::Utc::now();
    storage.update_page(&page)?;

    Ok(page)
}

/// Page content structure for embedding
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageContent {
    pub id: String,
    pub title: String,
    pub blocks: Vec<crate::storage::EditorBlock>,
    pub page_type: Option<String>,
}

/// Get page content for embedding
#[tauri::command]
pub fn get_page_content(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<PageContent> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let page = storage.get_page(nb_id, pg_id)?;

    Ok(PageContent {
        id: page.id.to_string(),
        title: page.title,
        blocks: page.content.blocks,
        page_type: Some(format!("{:?}", page.page_type).to_lowercase()),
    })
}
