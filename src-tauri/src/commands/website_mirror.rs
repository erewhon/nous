//! Tauri commands for website mirror import.
//!
//! Imports a mirrored website directory (HTML files with assets) as a notebook
//! with linked storage mode. Creates lightweight reference pages for search/AI
//! while keeping original files in place for full-fidelity HTML viewing.

use std::collections::HashMap;
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
