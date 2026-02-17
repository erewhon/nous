//! Tauri commands for website mirror import.
//!
//! Imports a mirrored website directory (HTML files with assets) as a notebook
//! with linked storage mode. Creates lightweight reference pages for search/AI
//! while keeping original files in place for full-fidelity HTML viewing.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::storage::html_utils::{extract_html_title, html_to_searchable_text};
use crate::storage::{
    EditorData, FileStorageMode, Folder, Notebook, NotebookType, Page, PageType,
    SystemPromptMode,
};
use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

/// Preview metadata for a website mirror import
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebsiteMirrorImportPreview {
    /// Number of HTML pages found
    pub page_count: usize,
    /// Number of asset files found (CSS, JS, images, etc.)
    pub asset_count: usize,
    /// Number of subdirectories
    pub folder_count: usize,
    /// Sample page titles (first 10)
    pub sample_pages: Vec<WebsiteMirrorPagePreview>,
    /// Suggested notebook name (directory name)
    pub suggested_name: String,
}

/// Preview info for a single HTML page
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebsiteMirrorPagePreview {
    /// Page title (from <title> tag or filename)
    pub title: String,
    /// Relative path in mirror directory
    pub path: String,
}

/// Summary of a re-scan operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RescanSummary {
    pub added: usize,
    pub updated: usize,
    pub deleted: usize,
    pub skipped_archived: usize,
}

/// Ensure a folder hierarchy exists for a given relative directory path.
/// Creates intermediate folders as needed and returns the folder ID for the leaf directory.
fn ensure_folder_hierarchy(
    notebook_id: Uuid,
    rel_dir: &Path,
    folder_map: &mut HashMap<String, Uuid>,
    folders: &mut Vec<Folder>,
) -> Option<Uuid> {
    if rel_dir.as_os_str().is_empty() {
        return None;
    }

    let dir_str = rel_dir.to_string_lossy().to_string();
    if let Some(&id) = folder_map.get(&dir_str) {
        return Some(id);
    }

    // Ensure parent exists first
    let parent_id = rel_dir
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .and_then(|p| ensure_folder_hierarchy(notebook_id, p, folder_map, folders));

    let folder_name = rel_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| dir_str.clone());

    let folder = Folder::new(notebook_id, folder_name, parent_id);
    let folder_id = folder.id;
    folder_map.insert(dir_str, folder_id);
    folders.push(folder);

    Some(folder_id)
}

/// Preview a website mirror directory before importing
#[tauri::command]
pub fn preview_website_mirror_cmd(mirror_path: String) -> CommandResult<WebsiteMirrorImportPreview> {
    let path = Path::new(&mirror_path);

    if !path.exists() {
        return Err(CommandError {
            message: "Mirror directory not found".to_string(),
        });
    }

    if !path.is_dir() {
        return Err(CommandError {
            message: "Path is not a directory".to_string(),
        });
    }

    let mut page_count = 0;
    let mut asset_count = 0;
    let mut folder_count = 0;
    let mut sample_pages = Vec::new();

    for entry in WalkDir::new(path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        let relative = entry_path.strip_prefix(path).unwrap_or(entry_path);

        // Skip hidden files/dirs
        if relative
            .to_string_lossy()
            .split('/')
            .any(|c| c.starts_with('.'))
        {
            continue;
        }

        if entry_path.is_dir() {
            if entry_path != path {
                folder_count += 1;
            }
            continue;
        }

        let ext = entry_path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase());

        match ext.as_deref() {
            Some("html") | Some("htm") => {
                page_count += 1;

                if sample_pages.len() < 10 {
                    let title = if let Ok(content) = fs::read_to_string(entry_path) {
                        extract_html_title(&content).unwrap_or_else(|| {
                            entry_path
                                .file_stem()
                                .map(|s| s.to_string_lossy().to_string())
                                .unwrap_or_else(|| "Untitled".to_string())
                        })
                    } else {
                        entry_path
                            .file_stem()
                            .map(|s| s.to_string_lossy().to_string())
                            .unwrap_or_else(|| "Untitled".to_string())
                    };

                    sample_pages.push(WebsiteMirrorPagePreview {
                        title,
                        path: relative.to_string_lossy().to_string(),
                    });
                }
            }
            _ => {
                asset_count += 1;
            }
        }
    }

    let suggested_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Imported Website".to_string());

    Ok(WebsiteMirrorImportPreview {
        page_count,
        asset_count,
        folder_count,
        sample_pages,
        suggested_name,
    })
}

/// Import a website mirror directory as a new notebook
#[tauri::command]
pub fn import_website_mirror_cmd(
    app: AppHandle,
    state: State<AppState>,
    mirror_path: String,
    notebook_name: Option<String>,
) -> CommandResult<Notebook> {
    let path = Path::new(&mirror_path);

    if !path.exists() {
        return Err(CommandError {
            message: "Mirror directory not found".to_string(),
        });
    }

    if !path.is_dir() {
        return Err(CommandError {
            message: "Path is not a directory".to_string(),
        });
    }

    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebooks_dir = storage.notebooks_base_dir();

    // Collect all HTML files
    let mut html_files: Vec<(PathBuf, PathBuf)> = Vec::new(); // (absolute, relative)
    let mut directories: Vec<PathBuf> = Vec::new(); // relative paths of directories containing HTML files

    for entry in WalkDir::new(path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        let relative = entry_path.strip_prefix(path).unwrap_or(entry_path);

        // Skip hidden files/dirs
        if relative
            .to_string_lossy()
            .split('/')
            .any(|c| c.starts_with('.'))
        {
            continue;
        }

        if entry_path.is_dir() {
            if entry_path != path {
                directories.push(relative.to_path_buf());
            }
            continue;
        }

        let ext = entry_path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase());

        if matches!(ext.as_deref(), Some("html") | Some("htm")) {
            html_files.push((entry_path.to_path_buf(), relative.to_path_buf()));
        }
    }

    if html_files.is_empty() {
        return Err(CommandError {
            message: "No HTML files found in the specified directory".to_string(),
        });
    }

    // Create the notebook
    let notebook_id = Uuid::new_v4();
    let notebook_name = notebook_name.unwrap_or_else(|| {
        path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Imported Website".to_string())
    });

    let now = Utc::now();
    let notebook = Notebook {
        id: notebook_id,
        name: notebook_name,
        notebook_type: NotebookType::Standard,
        icon: Some("\u{1f310}".to_string()), // Globe emoji
        color: None,
        sections_enabled: false,
        archived: false,
        system_prompt: None,
        system_prompt_mode: SystemPromptMode::default(),
        ai_provider: None,
        ai_model: None,
        sync_config: None,
        encryption_config: None,
        is_pinned: false,
        position: 0,
        page_sort_by: None,
        daily_notes_config: None,
        cover_image: None,
        mirror_path: Some(mirror_path.clone()),
        created_at: now,
        updated_at: now,
    };

    // Create notebook directory structure
    let notebook_dir = notebooks_dir.join(notebook_id.to_string());
    fs::create_dir_all(&notebook_dir).map_err(|e| CommandError {
        message: format!("Failed to create notebook directory: {}", e),
    })?;
    fs::create_dir_all(notebook_dir.join("pages")).map_err(|e| CommandError {
        message: format!("Failed to create pages directory: {}", e),
    })?;
    fs::create_dir_all(notebook_dir.join("assets")).map_err(|e| CommandError {
        message: format!("Failed to create assets directory: {}", e),
    })?;

    // Write notebook.json
    let notebook_json = serde_json::to_string_pretty(&notebook).map_err(|e| CommandError {
        message: format!("Failed to serialize notebook: {}", e),
    })?;
    fs::write(notebook_dir.join("notebook.json"), notebook_json).map_err(|e| CommandError {
        message: format!("Failed to write notebook.json: {}", e),
    })?;

    // Build folder hierarchy
    // Map: relative directory path -> folder UUID
    let mut folder_map: HashMap<String, Uuid> = HashMap::new();
    let mut folders: Vec<Folder> = Vec::new();

    // Sort directories so parents come before children
    let mut sorted_dirs = directories.clone();
    sorted_dirs.sort_by(|a, b| {
        a.components()
            .count()
            .cmp(&b.components().count())
            .then_with(|| a.cmp(b))
    });

    for dir_path in &sorted_dirs {
        let dir_str = dir_path.to_string_lossy().to_string();

        // Determine parent folder
        let parent_id = dir_path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .and_then(|p| folder_map.get(&p.to_string_lossy().to_string()))
            .copied();

        let folder_name = dir_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| dir_str.clone());

        let folder = Folder::new(notebook_id, folder_name, parent_id);
        folder_map.insert(dir_str, folder.id);
        folders.push(folder);
    }

    // Write folders.json
    let folders_json = serde_json::to_string_pretty(&folders).map_err(|e| CommandError {
        message: format!("Failed to serialize folders: {}", e),
    })?;
    fs::write(notebook_dir.join("folders.json"), folders_json).map_err(|e| CommandError {
        message: format!("Failed to write folders.json: {}", e),
    })?;

    // Register the mirror directory with asset protocol for iframe access
    if let Err(e) = app.asset_protocol_scope().allow_directory(path, true) {
        log::warn!(
            "Failed to register mirror directory with asset protocol: {}",
            e
        );
    }

    // Process HTML files and create pages
    let mut pages: Vec<Page> = Vec::new();

    let mut search_index = state.search_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire search index lock: {}", e),
    })?;

    for (abs_path, rel_path) in &html_files {
        let abs_path_str = abs_path.to_string_lossy().to_string();

        // Read HTML content for title extraction and search indexing
        let html_content = fs::read_to_string(abs_path).unwrap_or_default();

        // Extract title
        let title = extract_html_title(&html_content).unwrap_or_else(|| {
            abs_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Untitled".to_string())
        });

        // Determine folder
        let folder_id = rel_path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .and_then(|p| folder_map.get(&p.to_string_lossy().to_string()))
            .copied();

        let ext = abs_path
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_else(|| "html".to_string());

        // Create page
        let page_id = Uuid::new_v4();
        let page = Page {
            id: page_id,
            notebook_id,
            title,
            content: EditorData::default(),
            tags: Vec::new(),
            folder_id,
            parent_page_id: None,
            section_id: None,
            is_archived: false,
            is_cover: false,
            position: 0,
            system_prompt: None,
            system_prompt_mode: SystemPromptMode::default(),
            ai_model: None,
            page_type: PageType::Html,
            source_file: Some(abs_path_str),
            storage_mode: Some(FileStorageMode::Linked),
            file_extension: Some(ext),
            last_file_sync: Some(now),
            template_id: None,
            deleted_at: None,
            color: None,
            is_favorite: false,
            is_daily_note: false,
            daily_note_date: None,
            created_at: now,
            updated_at: now,
        };

        // Save page metadata
        let page_path = notebook_dir
            .join("pages")
            .join(format!("{}.json", page.id));
        let page_json = serde_json::to_string_pretty(&page).map_err(|e| CommandError {
            message: format!("Failed to serialize page: {}", e),
        })?;
        fs::write(page_path, page_json).map_err(|e| CommandError {
            message: format!("Failed to write page file: {}", e),
        })?;

        // Index page in Tantivy with extracted text
        if !html_content.is_empty() {
            let searchable_text = html_to_searchable_text(&html_content);
            if let Err(e) = search_index.index_page_with_content(&page, &searchable_text) {
                log::warn!("Failed to index HTML page {}: {}", page.id, e);
            }
        } else if let Err(e) = search_index.index_page(&page) {
            log::warn!("Failed to index HTML page {}: {}", page.id, e);
        }

        pages.push(page);
    }

    log::info!(
        "Imported website mirror: {} pages, {} folders from {}",
        pages.len(),
        folders.len(),
        mirror_path,
    );

    Ok(notebook)
}

/// Re-scan a website mirror directory for new, modified, and deleted files
#[tauri::command]
pub fn rescan_website_mirror_cmd(
    app: AppHandle,
    state: State<AppState>,
    notebook_id: String,
) -> CommandResult<RescanSummary> {
    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    // Load notebook and get mirror_path
    let notebook = storage.get_notebook(notebook_uuid).map_err(|e| CommandError {
        message: format!("Failed to load notebook: {}", e),
    })?;

    let mirror_path = notebook.mirror_path.as_deref().ok_or_else(|| CommandError {
        message: "Notebook has no mirror_path set".to_string(),
    })?;

    let mirror_dir = Path::new(mirror_path);
    if !mirror_dir.exists() || !mirror_dir.is_dir() {
        return Err(CommandError {
            message: format!("Mirror directory not found: {}", mirror_path),
        });
    }

    // Register the mirror directory with asset protocol for iframe access
    if let Err(e) = app.asset_protocol_scope().allow_directory(mirror_dir, true) {
        log::warn!(
            "Failed to register mirror directory with asset protocol: {}",
            e
        );
    }

    // Load existing pages
    let existing_pages = storage.list_pages(notebook_uuid).map_err(|e| CommandError {
        message: format!("Failed to list pages: {}", e),
    })?;

    // Build lookup maps from existing HTML pages by source_file path
    let mut source_to_page: HashMap<String, Page> = HashMap::new();
    let mut archived_sources: HashSet<String> = HashSet::new();
    let mut deleted_sources: HashSet<String> = HashSet::new();

    for page in &existing_pages {
        if page.page_type != PageType::Html {
            continue;
        }
        if let Some(ref src) = page.source_file {
            if page.is_archived {
                archived_sources.insert(src.clone());
            } else if page.deleted_at.is_some() {
                deleted_sources.insert(src.clone());
            } else {
                source_to_page.insert(src.clone(), page.clone());
            }
        }
    }

    // Load existing folders for hierarchy building
    let mut existing_folders = storage.list_folders(notebook_uuid).map_err(|e| CommandError {
        message: format!("Failed to list folders: {}", e),
    })?;

    // Build folder_map from existing folders by reconstructing their relative paths
    // We need to map relative directory paths to folder UUIDs
    let mut folder_map: HashMap<String, Uuid> = HashMap::new();
    // Build id -> folder lookup
    let folder_by_id: HashMap<Uuid, &Folder> = existing_folders.iter().map(|f| (f.id, f)).collect();

    // Reconstruct relative path for each folder by walking up parent chain
    fn folder_rel_path(folder_id: Uuid, folder_by_id: &HashMap<Uuid, &Folder>) -> String {
        let mut parts = Vec::new();
        let mut current = folder_id;
        while let Some(folder) = folder_by_id.get(&current) {
            parts.push(folder.name.clone());
            match folder.parent_id {
                Some(pid) => current = pid,
                None => break,
            }
        }
        parts.reverse();
        parts.join("/")
    }

    for folder in &existing_folders {
        let rel = folder_rel_path(folder.id, &folder_by_id);
        folder_map.insert(rel, folder.id);
    }

    // Walk mirror directory to find current HTML files
    let mut current_files: HashMap<String, PathBuf> = HashMap::new(); // abs_path_str -> abs_path

    for entry in WalkDir::new(mirror_dir)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        let relative = entry_path.strip_prefix(mirror_dir).unwrap_or(entry_path);

        // Skip hidden files/dirs
        if relative
            .to_string_lossy()
            .split('/')
            .any(|c| c.starts_with('.'))
        {
            continue;
        }

        if entry_path.is_dir() {
            continue;
        }

        let ext = entry_path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase());

        if matches!(ext.as_deref(), Some("html") | Some("htm")) {
            let abs_str = entry_path.to_string_lossy().to_string();
            current_files.insert(abs_str, entry_path.to_path_buf());
        }
    }

    let mut search_index = state.search_index.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire search index lock: {}", e),
    })?;

    let now = Utc::now();
    let mut added = 0usize;
    let mut updated = 0usize;
    let mut deleted = 0usize;
    let mut skipped_archived = 0usize;
    let mut folders_changed = false;

    // Process current files: detect new and modified
    for (abs_path_str, abs_path) in &current_files {
        // Skip archived or deleted source files
        if archived_sources.contains(abs_path_str) || deleted_sources.contains(abs_path_str) {
            skipped_archived += 1;
            continue;
        }

        if let Some(existing_page) = source_to_page.remove(abs_path_str) {
            // File exists and page exists — check if modified
            let file_modified = fs::metadata(abs_path)
                .ok()
                .and_then(|m| m.modified().ok())
                .map(|t| chrono::DateTime::<Utc>::from(t));

            let needs_update = match (file_modified, existing_page.last_file_sync) {
                (Some(file_time), Some(sync_time)) => file_time > sync_time,
                (Some(_), None) => true,
                _ => false,
            };

            if needs_update {
                // Re-read HTML and re-index. Never update title.
                let html_content = fs::read_to_string(abs_path).unwrap_or_default();

                let mut page = existing_page;
                page.last_file_sync = Some(now);
                page.updated_at = now;

                // Update page on disk
                if let Err(e) = storage.update_page(&page) {
                    log::warn!("Failed to update page {}: {}", page.id, e);
                    continue;
                }

                // Re-index in search
                if let Err(e) = search_index.remove_page(page.id) {
                    log::warn!("Failed to remove page from search index {}: {}", page.id, e);
                }
                if !html_content.is_empty() {
                    let searchable_text = html_to_searchable_text(&html_content);
                    if let Err(e) = search_index.index_page_with_content(&page, &searchable_text) {
                        log::warn!("Failed to re-index page {}: {}", page.id, e);
                    }
                } else if let Err(e) = search_index.index_page(&page) {
                    log::warn!("Failed to re-index page {}: {}", page.id, e);
                }

                updated += 1;
            }
        } else {
            // New file — create page
            let html_content = fs::read_to_string(abs_path).unwrap_or_default();

            let title = extract_html_title(&html_content).unwrap_or_else(|| {
                abs_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Untitled".to_string())
            });

            // Determine folder from relative path
            let relative = abs_path.strip_prefix(mirror_dir).unwrap_or(abs_path);
            let folder_id = relative
                .parent()
                .filter(|p| !p.as_os_str().is_empty())
                .and_then(|p| {
                    let result = ensure_folder_hierarchy(
                        notebook_uuid,
                        p,
                        &mut folder_map,
                        &mut existing_folders,
                    );
                    if result.is_some() {
                        folders_changed = true;
                    }
                    result
                });

            let ext = abs_path
                .extension()
                .map(|e| e.to_string_lossy().to_string())
                .unwrap_or_else(|| "html".to_string());

            let page = Page {
                id: Uuid::new_v4(),
                notebook_id: notebook_uuid,
                title,
                content: EditorData::default(),
                tags: Vec::new(),
                folder_id,
                parent_page_id: None,
                section_id: None,
                is_archived: false,
                is_cover: false,
                position: 0,
                system_prompt: None,
                system_prompt_mode: SystemPromptMode::default(),
                ai_model: None,
                page_type: PageType::Html,
                source_file: Some(abs_path_str.clone()),
                storage_mode: Some(FileStorageMode::Linked),
                file_extension: Some(ext),
                last_file_sync: Some(now),
                template_id: None,
                deleted_at: None,
                color: None,
                is_favorite: false,
                is_daily_note: false,
                daily_note_date: None,
                created_at: now,
                updated_at: now,
            };

            // Save page
            if let Err(e) = storage.create_page_from(page.clone()) {
                log::warn!("Failed to create page for {}: {}", abs_path_str, e);
                continue;
            }

            // Index in search
            if !html_content.is_empty() {
                let searchable_text = html_to_searchable_text(&html_content);
                if let Err(e) = search_index.index_page_with_content(&page, &searchable_text) {
                    log::warn!("Failed to index new page {}: {}", page.id, e);
                }
            } else if let Err(e) = search_index.index_page(&page) {
                log::warn!("Failed to index new page {}: {}", page.id, e);
            }

            added += 1;
        }
    }

    // Remaining entries in source_to_page are pages whose source files no longer exist
    for (_, page) in &source_to_page {
        // Soft-delete
        if let Err(e) = storage.delete_page(notebook_uuid, page.id) {
            log::warn!("Failed to soft-delete page {}: {}", page.id, e);
            continue;
        }
        if let Err(e) = search_index.remove_page(page.id) {
            log::warn!("Failed to remove deleted page from search index {}: {}", page.id, e);
        }
        deleted += 1;
    }

    // Save folders if any new ones were created
    if folders_changed {
        if let Err(e) = storage.save_folders_public(notebook_uuid, &existing_folders) {
            log::warn!("Failed to save updated folders: {}", e);
        }
    }

    log::info!(
        "Re-scanned website mirror for notebook {}: added={}, updated={}, deleted={}, skipped_archived={}",
        notebook_id, added, updated, deleted, skipped_archived,
    );

    Ok(RescanSummary {
        added,
        updated,
        deleted,
        skipped_archived,
    })
}
