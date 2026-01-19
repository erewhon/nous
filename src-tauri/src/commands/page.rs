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

#[tauri::command]
pub fn create_page(
    state: State<AppState>,
    notebook_id: String,
    title: String,
    folder_id: Option<String>,
    parent_page_id: Option<String>,
    section_id: Option<String>,
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

#[tauri::command]
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
    page.updated_at = chrono::Utc::now();

    storage.update_page(&page)?;

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

    // Remove from search index
    if let Ok(mut search_index) = state.search_index.lock() {
        let _ = search_index.remove_page(pg_id);
    }

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Delete page: {}", page_title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit page deletion: {}", e);
        }
    }

    Ok(())
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
