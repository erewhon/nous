//! External Editor Commands
//!
//! Tauri commands for opening pages in external editors.

use chrono::Utc;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::external_editor::{get_known_editors, EditSession, EditorConfig};
use crate::markdown::import_markdown_to_page;
use crate::storage::Page;
use crate::AppState;

/// Error type for external editor commands
#[derive(Debug, Serialize)]
pub struct ExternalEditorCommandError {
    message: String,
}

impl ExternalEditorCommandError {
    pub fn new(message: &str) -> Self {
        Self {
            message: message.to_string(),
        }
    }
}

impl From<crate::external_editor::ExternalEditorError> for ExternalEditorCommandError {
    fn from(e: crate::external_editor::ExternalEditorError) -> Self {
        Self {
            message: e.to_string(),
        }
    }
}

impl From<crate::storage::StorageError> for ExternalEditorCommandError {
    fn from(e: crate::storage::StorageError) -> Self {
        Self {
            message: e.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, ExternalEditorCommandError>;

/// Get list of known external editors
#[tauri::command]
pub fn get_external_editors() -> Vec<EditorConfig> {
    get_known_editors()
}

/// Open a page in an external editor
#[tauri::command]
pub fn open_page_in_editor(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    editor_config: Option<EditorConfig>,
) -> CommandResult<String> {
    let notebook_uuid = Uuid::parse_str(&notebook_id)
        .map_err(|_| ExternalEditorCommandError::new("Invalid notebook ID"))?;
    let page_uuid = Uuid::parse_str(&page_id)
        .map_err(|_| ExternalEditorCommandError::new("Invalid page ID"))?;

    // Get the page
    let storage = state.storage.lock()
        .map_err(|e| ExternalEditorCommandError::new(&format!("Failed to lock storage: {}", e)))?;

    let page = storage.get_page(notebook_uuid, page_uuid)?;

    // Get or create external editor manager
    let editor_manager = state.external_editor.lock()
        .map_err(|e| ExternalEditorCommandError::new(&format!("Failed to lock editor manager: {}", e)))?;

    // Export page to temp file
    let temp_path = editor_manager.export_page_for_editing(&page)?;

    // Open in editor
    let config = editor_config.unwrap_or_default();
    editor_manager.open_in_editor(&temp_path, &config)?;

    Ok(temp_path.to_string_lossy().to_string())
}

/// Check if external file has changed and get new content
#[tauri::command]
pub fn check_external_changes(
    state: State<AppState>,
    page_id: String,
) -> CommandResult<Option<String>> {
    let page_uuid = Uuid::parse_str(&page_id)
        .map_err(|_| ExternalEditorCommandError::new("Invalid page ID"))?;

    let editor_manager = state.external_editor.lock()
        .map_err(|e| ExternalEditorCommandError::new(&format!("Failed to lock editor manager: {}", e)))?;

    let content = editor_manager.check_for_changes(page_uuid)?;
    Ok(content)
}

/// Get current content of temp file
#[tauri::command]
pub fn get_external_file_content(
    state: State<AppState>,
    page_id: String,
) -> CommandResult<String> {
    let page_uuid = Uuid::parse_str(&page_id)
        .map_err(|_| ExternalEditorCommandError::new("Invalid page ID"))?;

    let editor_manager = state.external_editor.lock()
        .map_err(|e| ExternalEditorCommandError::new(&format!("Failed to lock editor manager: {}", e)))?;

    let content = editor_manager.read_temp_file(page_uuid)?;
    Ok(content)
}

/// Import changes from external editor back to page
#[tauri::command]
pub fn sync_from_external_editor(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<()> {
    let notebook_uuid = Uuid::parse_str(&notebook_id)
        .map_err(|_| ExternalEditorCommandError::new("Invalid notebook ID"))?;
    let page_uuid = Uuid::parse_str(&page_id)
        .map_err(|_| ExternalEditorCommandError::new("Invalid page ID"))?;

    // Get external editor manager
    let editor_manager = state.external_editor.lock()
        .map_err(|e| ExternalEditorCommandError::new(&format!("Failed to lock editor manager: {}", e)))?;

    // Read the temp file content
    let markdown_content = editor_manager.read_temp_file(page_uuid)?;

    // Get storage
    let mut storage = state.storage.lock()
        .map_err(|e| ExternalEditorCommandError::new(&format!("Failed to lock storage: {}", e)))?;

    // Get existing page to preserve metadata
    let existing_page = storage.get_page(notebook_uuid, page_uuid)?;

    // Import markdown to get updated content
    let imported_page = import_markdown_to_page(
        &markdown_content,
        notebook_uuid,
        &existing_page.title,
    );

    // Create updated page with existing metadata but new content
    let updated_page = Page {
        id: existing_page.id,
        notebook_id: existing_page.notebook_id,
        title: imported_page.title,
        content: imported_page.content,
        tags: imported_page.tags,
        folder_id: existing_page.folder_id,
        parent_page_id: existing_page.parent_page_id,
        section_id: existing_page.section_id,
        is_archived: existing_page.is_archived,
        is_cover: existing_page.is_cover,
        position: existing_page.position,
        system_prompt: existing_page.system_prompt,
        system_prompt_mode: existing_page.system_prompt_mode,
        ai_model: existing_page.ai_model,
        page_type: existing_page.page_type,
        source_file: existing_page.source_file,
        storage_mode: existing_page.storage_mode,
        file_extension: existing_page.file_extension,
        last_file_sync: existing_page.last_file_sync,
        deleted_at: existing_page.deleted_at,
        created_at: existing_page.created_at,
        updated_at: chrono::Utc::now(),
    };

    // Update the page
    storage.update_page(&updated_page)?;

    // Mark as synced
    editor_manager.mark_as_synced(page_uuid)?;

    // Update search index
    if let Ok(mut index) = state.search_index.lock() {
        if let Ok(page) = storage.get_page(notebook_uuid, page_uuid) {
            let _ = index.index_page(&page);
        }
    }

    log::info!("Synced external changes for page {}", page_id);
    Ok(())
}

/// End an external editing session
#[tauri::command]
pub fn end_external_edit_session(
    state: State<AppState>,
    page_id: String,
) -> CommandResult<()> {
    let page_uuid = Uuid::parse_str(&page_id)
        .map_err(|_| ExternalEditorCommandError::new("Invalid page ID"))?;

    let editor_manager = state.external_editor.lock()
        .map_err(|e| ExternalEditorCommandError::new(&format!("Failed to lock editor manager: {}", e)))?;

    editor_manager.end_session(page_uuid)?;
    Ok(())
}

/// Get active edit session for a page
#[tauri::command]
pub fn get_external_edit_session(
    state: State<AppState>,
    page_id: String,
) -> CommandResult<Option<EditSession>> {
    let page_uuid = Uuid::parse_str(&page_id)
        .map_err(|_| ExternalEditorCommandError::new("Invalid page ID"))?;

    let editor_manager = state.external_editor.lock()
        .map_err(|e| ExternalEditorCommandError::new(&format!("Failed to lock editor manager: {}", e)))?;

    Ok(editor_manager.get_session(page_uuid))
}

/// Get all active edit sessions
#[tauri::command]
pub fn get_all_external_edit_sessions(
    state: State<AppState>,
) -> CommandResult<Vec<EditSession>> {
    let editor_manager = state.external_editor.lock()
        .map_err(|e| ExternalEditorCommandError::new(&format!("Failed to lock editor manager: {}", e)))?;

    Ok(editor_manager.get_all_sessions())
}

/// Clean up old sessions
#[tauri::command]
pub fn cleanup_external_edit_sessions(
    state: State<AppState>,
) -> CommandResult<()> {
    let editor_manager = state.external_editor.lock()
        .map_err(|e| ExternalEditorCommandError::new(&format!("Failed to lock editor manager: {}", e)))?;

    editor_manager.cleanup_old_sessions()?;
    Ok(())
}
