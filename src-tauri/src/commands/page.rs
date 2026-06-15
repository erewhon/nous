use std::collections::HashMap;

use chrono::{DateTime, Utc};
use tauri::State;
use uuid::Uuid;

use crate::git;
use crate::storage::{EditorData, Page, PageType};
use crate::AppState;

use super::notebook::CommandError;

/// Lightweight entry for cross-notebook favorites (no page content).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoritePageEntry {
    pub id: String,
    pub notebook_id: String,
    pub notebook_name: String,
    pub title: String,
    pub page_type: PageType,
    pub updated_at: DateTime<Utc>,
}

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

    // Repair any page/folder section_id mismatches (lightweight, only writes if needed)
    let _ = storage.repair_section_consistency(id);

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
    plugin_page_type: Option<String>,
    plugin_data: Option<serde_json::Value>,
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

    // If plugin_page_type specified, set it on the page with optional initial data
    if plugin_page_type.is_some() || plugin_data.is_some() {
        page.plugin_page_type = plugin_page_type;
        page.plugin_data = plugin_data;
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

    // Search indexing now happens in the daemon when the daemon's create_page
    // handler runs. Tauri's create_page no longer touches the index.

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Create page: {}", page.title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit page creation: {}", e);
        }
    }

    // Dispatch plugin event
    #[cfg(feature = "plugins")]
    crate::plugins::dispatch_plugin_event_bg(
        &state.plugin_host,
        crate::plugins::HookPoint::OnPageCreated,
        serde_json::json!({
            "notebook_id": nb_id.to_string(),
            "page_id": page.id.to_string(),
            "title": page.title,
        }),
    );

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

    // Search index removal now lives in the daemon's delete_page handler.

    // Auto-commit if git is enabled for this notebook
    let notebook_path = storage.get_notebook_path(nb_id);
    if git::is_git_repo(&notebook_path) {
        let commit_message = format!("Move to trash: {}", page_title);
        if let Err(e) = git::commit_all(&notebook_path, &commit_message) {
            log::warn!("Failed to auto-commit page deletion: {}", e);
        }
    }

    // Dispatch plugin event
    #[cfg(feature = "plugins")]
    crate::plugins::dispatch_plugin_event_bg(
        &state.plugin_host,
        crate::plugins::HookPoint::OnPageDeleted,
        serde_json::json!({
            "notebook_id": nb_id.to_string(),
            "page_id": pg_id.to_string(),
            "title": page_title,
        }),
    );

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

    // Search index removal happens via the daemon — clients should hit
    // POST /api/search/rebuild after bulk permanent deletes for now.

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

    // Search reindex on restore is no longer done by Tauri; the page will be
    // picked up on its next daemon-side write or via a manual rebuild.

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
pub fn list_trash(state: State<AppState>, notebook_id: String) -> CommandResult<Vec<Page>> {
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
    storage
        .purge_old_trash(nb_id, retention_days)
        .map_err(Into::into)
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
    let moved_page =
        storage.move_page_to_notebook(source_nb_id, pg_id, target_nb_id, target_folder)?;

    // Daemon now owns the search index. Cross-notebook moves currently rely
    // on the next daemon-side write to refresh the index entry's notebook_id;
    // call POST /api/search/rebuild after bulk moves if needed.

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

/// Get the operation log for a page (recent entries, newest last).
#[tauri::command(rename_all = "camelCase")]
pub fn get_page_oplog(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    limit: Option<usize>,
) -> CommandResult<Vec<crate::storage::oplog::OplogEntry>> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let pages_dir = storage.get_notebook_path(nb_id).join("pages");
    let oplog_file = crate::storage::oplog::oplog_path(&pages_dir, pg_id);

    let entries = match limit {
        Some(n) => crate::storage::oplog::read_last_n_entries(&oplog_file, n),
        None => crate::storage::oplog::read_entries(&oplog_file),
    };

    Ok(entries)
}

/// List available snapshots for a page.
#[tauri::command(rename_all = "camelCase")]
pub fn list_page_snapshots(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<Vec<String>> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let pages_dir = storage.get_notebook_path(nb_id).join("pages");
    let snap_dir = crate::storage::snapshots::snapshots_dir(&pages_dir, pg_id);
    let names = crate::storage::snapshots::list_snapshots(&snap_dir);

    Ok(names)
}

/// Restore a page from a specific snapshot.
#[tauri::command(rename_all = "camelCase")]
pub fn restore_page_snapshot(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    snapshot_name: String,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let pages_dir = storage.get_notebook_path(nb_id).join("pages");
    let snap_dir = crate::storage::snapshots::snapshots_dir(&pages_dir, pg_id);

    let snapshot_page = crate::storage::snapshots::read_snapshot(&snap_dir, &snapshot_name)
        .ok_or_else(|| CommandError {
            message: format!("Snapshot '{}' not found", snapshot_name),
        })?;

    // Write the snapshot content as the current page (preserving the current page's metadata
    // but restoring the content from the snapshot)
    let mut current_page = storage.get_page(nb_id, pg_id)?;
    // DL-18: snapshot the CURRENT state before overwriting it so a bad restore
    // can itself be undone.
    if let Err(e) = crate::storage::snapshots::take_snapshot(&pages_dir, &current_page) {
        log::warn!(
            "restore_page_snapshot: failed to snapshot current state before restore: {}",
            e
        );
    }
    current_page.content = snapshot_page.content;
    current_page.updated_at = chrono::Utc::now();
    storage.update_page(&current_page)?;

    Ok(current_page)
}

// open_page_in_pane_crdt / close_pane_for_page Tauri commands removed:
// CRDT lives in the daemon. Frontend pane lifecycle goes through the
// daemon's /api/events WS (pane_open / pane_close text frames).

/// Get edit counts for all blocks on a page (derived from oplog).
#[tauri::command(rename_all = "camelCase")]
pub fn get_block_version_counts(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<HashMap<String, usize>> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let pages_dir = storage.get_notebook_path(nb_id).join("pages");
    let oplog_file = crate::storage::oplog::oplog_path(&pages_dir, pg_id);
    let entries = crate::storage::oplog::read_entries(&oplog_file);

    let mut counts: HashMap<String, usize> = HashMap::new();
    for entry in &entries {
        for change in &entry.block_changes {
            // Only count Modify ops as "edits" (Insert is initial creation)
            if change.op == crate::storage::oplog::BlockOp::Modify {
                *counts.entry(change.block_id.clone()).or_insert(0) += 1;
            }
        }
    }

    Ok(counts)
}

/// Get the history of a specific block from the oplog and snapshots.
#[tauri::command(rename_all = "camelCase")]
pub fn get_block_history(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    block_id: String,
    limit: Option<usize>,
) -> CommandResult<Vec<crate::storage::oplog::BlockHistoryEntry>> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let pages_dir = storage.get_notebook_path(nb_id).join("pages");
    let oplog_file = crate::storage::oplog::oplog_path(&pages_dir, pg_id);
    let entries = crate::storage::oplog::read_entries(&oplog_file);
    let snap_dir = crate::storage::snapshots::snapshots_dir(&pages_dir, pg_id);

    let max = limit.unwrap_or(50);
    let mut history: Vec<crate::storage::oplog::BlockHistoryEntry> = Vec::new();

    for entry in &entries {
        for change in &entry.block_changes {
            if change.block_id == block_id {
                // Try to find block data from the nearest snapshot
                let nearest_snap =
                    crate::storage::snapshots::find_nearest_snapshot(&snap_dir, &entry.ts);
                let (block_data, snapshot_name) = match &nearest_snap {
                    Some(snap_name) => {
                        let data = crate::storage::snapshots::get_block_at_snapshot(
                            &snap_dir, snap_name, &block_id,
                        );
                        (data, Some(snap_name.clone()))
                    }
                    None => (None, None),
                };

                history.push(crate::storage::oplog::BlockHistoryEntry {
                    ts: entry.ts,
                    op: change.op.clone(),
                    block_type: change.block_type.clone(),
                    block_data,
                    snapshot_name,
                    git_commit_id: entry.git_commit_id.clone(),
                });
            }
        }
    }

    // Reverse to get newest first, then cap
    history.reverse();
    history.truncate(max);

    Ok(history)
}

/// Revert a single block to its state at a given snapshot.
#[tauri::command(rename_all = "camelCase")]
pub fn revert_block(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    block_id: String,
    snapshot_name: String,
) -> CommandResult<Page> {
    let storage = state.storage.lock().unwrap();
    let nb_id = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_id = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let pages_dir = storage.get_notebook_path(nb_id).join("pages");
    let snap_dir = crate::storage::snapshots::snapshots_dir(&pages_dir, pg_id);

    // Load the snapshot and find the block
    let snapshot_page = crate::storage::snapshots::read_snapshot(&snap_dir, &snapshot_name)
        .ok_or_else(|| CommandError {
            message: format!("Snapshot '{}' not found", snapshot_name),
        })?;

    let snapshot_block = snapshot_page
        .content
        .blocks
        .iter()
        .find(|b| b.id == block_id)
        .ok_or_else(|| CommandError {
            message: format!(
                "Block '{}' not found in snapshot '{}'",
                block_id, snapshot_name
            ),
        })?;

    // Load current page and replace the block
    let mut current_page = storage.get_page(nb_id, pg_id)?;
    // DL-18: snapshot the CURRENT state before overwriting it so a bad revert
    // can itself be undone.
    if let Err(e) = crate::storage::snapshots::take_snapshot(&pages_dir, &current_page) {
        log::warn!(
            "revert_block: failed to snapshot current state before revert: {}",
            e
        );
    }
    let mut found = false;
    for block in &mut current_page.content.blocks {
        if block.id == block_id {
            block.data = snapshot_block.data.clone();
            block.block_type = snapshot_block.block_type.clone();
            found = true;
            break;
        }
    }

    if !found {
        return Err(CommandError {
            message: format!("Block '{}' not found in current page", block_id),
        });
    }

    current_page.updated_at = chrono::Utc::now();
    storage.update_page(&current_page)?;

    Ok(current_page)
}

/// Get all favorite pages across all notebooks (lightweight — no page content).
#[tauri::command]
pub fn get_all_favorite_pages(state: State<AppState>) -> CommandResult<Vec<FavoritePageEntry>> {
    let storage = state.storage.lock().unwrap();
    let notebooks = storage.list_notebooks()?;

    let mut entries = Vec::new();
    for notebook in &notebooks {
        if notebook.archived {
            continue;
        }
        let pages = match storage.list_pages(notebook.id) {
            Ok(p) => p,
            Err(_) => continue,
        };
        for page in &pages {
            if page.is_favorite && page.deleted_at.is_none() {
                entries.push(FavoritePageEntry {
                    id: page.id.to_string(),
                    notebook_id: notebook.id.to_string(),
                    notebook_name: notebook.name.clone(),
                    title: page.title.clone(),
                    page_type: page.page_type.clone(),
                    updated_at: page.updated_at,
                });
            }
        }
    }

    // Sort by updated_at descending (most recently updated first)
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(entries)
}
