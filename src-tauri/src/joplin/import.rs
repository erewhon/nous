//! Joplin JEX/RAW import implementation
//!
//! Converts Joplin export files (JEX archives or RAW directories) to Nous notebooks.
//!
//! Joplin exports contain:
//! - .md files with note content and metadata
//! - Resource files (images, PDFs, etc.)
//! - Folder/notebook definitions
//! - Tag definitions and note-tag associations
//!
//! Each item is identified by a 32-character hex ID.
//! Metadata is stored at the bottom of .md files after a blank line.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::Path;

use chrono::{DateTime, TimeZone, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::markdown::import_markdown_to_page;
use crate::storage::{Folder, Notebook, NotebookType, Page, StorageError};

type Result<T> = std::result::Result<T, StorageError>;

/// Joplin item types (from type_ field)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum JoplinType {
    Note = 1,
    Folder = 2,
    Resource = 4,
    Tag = 5,
    NoteTag = 6,
}

impl JoplinType {
    fn from_i32(value: i32) -> Option<Self> {
        match value {
            1 => Some(JoplinType::Note),
            2 => Some(JoplinType::Folder),
            4 => Some(JoplinType::Resource),
            5 => Some(JoplinType::Tag),
            6 => Some(JoplinType::NoteTag),
            _ => None,
        }
    }
}

/// Preview metadata for a Joplin import
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoplinImportPreview {
    /// Number of notes found
    pub note_count: usize,
    /// Number of folders (notebooks) found
    pub folder_count: usize,
    /// Number of tags found
    pub tag_count: usize,
    /// Number of resources (attachments) found
    pub resource_count: usize,
    /// Sample notes for preview (first 10)
    pub notes: Vec<JoplinNotePreview>,
    /// Suggested notebook name
    pub suggested_name: String,
    /// Warnings during preview
    pub warnings: Vec<String>,
    /// Whether this is a JEX archive or RAW directory
    pub is_jex_archive: bool,
}

/// Preview info for a single Joplin note
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoplinNotePreview {
    /// Note title
    pub title: String,
    /// Folder path (if available)
    pub folder_path: Option<String>,
    /// Tags
    pub tags: Vec<String>,
    /// Has attachments
    pub has_attachments: bool,
    /// Is a todo item
    pub is_todo: bool,
    /// Created date (if available)
    pub created: Option<String>,
}

/// Joplin icon structure (for folder/note icons)
#[derive(Debug, Clone, Deserialize)]
struct JoplinIcon {
    emoji: Option<String>,
    #[allow(dead_code)]
    name: Option<String>,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    icon_type: Option<i32>,
}

/// Internal structure for parsed Joplin metadata
#[derive(Debug, Clone, Default)]
struct JoplinMetadata {
    id: String,
    parent_id: Option<String>,
    title: Option<String>,
    icon: Option<String>, // Emoji icon for folder/note
    created_time: Option<i64>,
    updated_time: Option<i64>,
    is_todo: bool,
    todo_completed: bool,
    todo_due: Option<i64>,
    item_type: Option<JoplinType>,
    mime: Option<String>,
    filename: Option<String>,
    file_extension: Option<String>,
}

/// Internal structure for a parsed Joplin item
#[derive(Debug, Clone)]
struct JoplinItem {
    metadata: JoplinMetadata,
    content: String, // For notes: markdown content; for resources: empty (data stored separately)
}

/// Internal structure for tracking folders
#[derive(Debug, Clone)]
struct JoplinFolder {
    #[allow(dead_code)]
    id: String,
    title: String,
    icon: Option<String>, // Emoji icon
    parent_id: Option<String>,
}

/// Internal structure for tags
#[derive(Debug, Clone)]
struct JoplinTag {
    #[allow(dead_code)]
    id: String,
    title: String,
}

/// Parse Joplin timestamp (milliseconds since epoch)
fn parse_joplin_timestamp(timestamp: i64) -> Option<DateTime<Utc>> {
    Utc.timestamp_millis_opt(timestamp).single()
}

/// Parse metadata from Joplin .md file content
/// Metadata is at the bottom of the file after a blank line, in key: value format
fn parse_joplin_metadata(content: &str) -> (String, JoplinMetadata) {
    let mut metadata = JoplinMetadata::default();

    // Find the metadata section (starts after a blank line near the end)
    // Metadata lines have format: key: value
    let lines: Vec<&str> = content.lines().collect();

    // Find where metadata starts by looking from the end
    let mut metadata_start = lines.len();
    for (i, line) in lines.iter().enumerate().rev() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            // Check if previous lines look like metadata
            let remaining = &lines[i + 1..];
            if remaining.iter().all(|l| {
                let t = l.trim();
                t.is_empty() || t.contains(':')
            }) && remaining.iter().any(|l| l.trim().starts_with("type_:"))
            {
                metadata_start = i + 1;
                break;
            }
        }
    }

    // Split into body and metadata
    let body = lines[..metadata_start.saturating_sub(1)]
        .join("\n")
        .trim()
        .to_string();

    for line in &lines[metadata_start..] {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(colon_pos) = trimmed.find(':') {
            let key = trimmed[..colon_pos].trim();
            let value = trimmed[colon_pos + 1..].trim();

            match key {
                "id" => metadata.id = value.to_string(),
                "parent_id" => {
                    if !value.is_empty() {
                        metadata.parent_id = Some(value.to_string());
                    }
                }
                "title" => {
                    if !value.is_empty() {
                        metadata.title = Some(value.to_string());
                    }
                }
                "created_time" => {
                    if let Ok(ts) = value.parse::<i64>() {
                        metadata.created_time = Some(ts);
                    }
                }
                "updated_time" => {
                    if let Ok(ts) = value.parse::<i64>() {
                        metadata.updated_time = Some(ts);
                    }
                }
                "is_todo" => metadata.is_todo = value == "1",
                "todo_completed" => metadata.todo_completed = value != "0" && !value.is_empty(),
                "todo_due" => {
                    if let Ok(ts) = value.parse::<i64>() {
                        if ts > 0 {
                            metadata.todo_due = Some(ts);
                        }
                    }
                }
                "type_" => {
                    if let Ok(type_num) = value.parse::<i32>() {
                        metadata.item_type = JoplinType::from_i32(type_num);
                    }
                }
                "mime" => {
                    if !value.is_empty() {
                        metadata.mime = Some(value.to_string());
                    }
                }
                "filename" => {
                    if !value.is_empty() {
                        metadata.filename = Some(value.to_string());
                    }
                }
                "file_extension" => {
                    if !value.is_empty() {
                        metadata.file_extension = Some(value.to_string());
                    }
                }
                "icon" => {
                    // Icon is stored as JSON: {"emoji":"🕰️","name":"mantelpiece clock","type":1}
                    if !value.is_empty() {
                        if let Ok(icon) = serde_json::from_str::<JoplinIcon>(value) {
                            if let Some(emoji) = icon.emoji {
                                if !emoji.is_empty() {
                                    metadata.icon = Some(emoji);
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    (body, metadata)
}

/// Extract title from the first line of markdown
/// Checks for: markdown heading, or just uses first non-empty line
fn extract_title_from_markdown(content: &str) -> Option<String> {
    let first_line = content.lines().next()?;
    let trimmed = first_line.trim();

    if trimmed.is_empty() {
        // Skip empty first line, try second line
        let second_line = content.lines().nth(1)?;
        let trimmed2 = second_line.trim();
        if trimmed2.is_empty() {
            return None;
        }
        // Check for markdown heading
        if trimmed2.starts_with("# ") {
            return Some(trimmed2[2..].trim().to_string());
        }
        // Use first non-empty line as title (truncate if too long)
        let title = trimmed2.chars().take(100).collect::<String>();
        return Some(title);
    }

    // Check for markdown heading
    if trimmed.starts_with("# ") {
        Some(trimmed[2..].trim().to_string())
    } else {
        // Use first non-empty line as title (truncate if too long)
        let title = trimmed.chars().take(100).collect::<String>();
        Some(title)
    }
}

/// Convert Joplin resource references to asset URLs
/// Joplin format: ![alt](:/resource_id) or [text](:/resource_id)
fn convert_resource_references(
    content: &str,
    resource_mapping: &HashMap<String, String>,
) -> String {
    let resource_re = Regex::new(r"(!?\[[^\]]*\])\(:/([a-f0-9]{32})\)").unwrap();

    resource_re
        .replace_all(content, |caps: &regex::Captures| {
            let link_text = &caps[1];
            let resource_id = &caps[2];

            if let Some(asset_url) = resource_mapping.get(resource_id) {
                format!("{}({})", link_text, asset_url)
            } else {
                // Keep original if resource not found
                caps[0].to_string()
            }
        })
        .to_string()
}

/// Build folder path for a note by traversing parent_id chain
fn build_folder_path(
    folder_id: &str,
    folders: &HashMap<String, JoplinFolder>,
) -> Option<String> {
    let mut path_parts = Vec::new();
    let mut current_id = Some(folder_id.to_string());

    // Prevent infinite loops
    let mut seen = std::collections::HashSet::new();

    while let Some(id) = current_id {
        if seen.contains(&id) {
            break;
        }
        seen.insert(id.clone());

        if let Some(folder) = folders.get(&id) {
            // Include emoji in folder path if available
            let folder_name = match &folder.icon {
                Some(emoji) if !emoji.is_empty() => format!("{} {}", emoji, folder.title),
                _ => folder.title.clone(),
            };
            path_parts.push(folder_name);
            current_id = folder.parent_id.clone();
        } else {
            break;
        }
    }

    if path_parts.is_empty() {
        None
    } else {
        path_parts.reverse();
        Some(path_parts.join("/"))
    }
}

/// Get the depth of a folder in the hierarchy (0 = root level)
fn get_folder_depth(folder_id: &str, folders: &HashMap<String, JoplinFolder>) -> usize {
    let mut depth = 0;
    let mut current_id = Some(folder_id.to_string());
    let mut seen = std::collections::HashSet::new();

    while let Some(id) = current_id {
        if seen.contains(&id) {
            break;
        }
        seen.insert(id.clone());

        if let Some(folder) = folders.get(&id) {
            if folder.parent_id.is_some() {
                depth += 1;
                current_id = folder.parent_id.clone();
            } else {
                break;
            }
        } else {
            break;
        }
    }

    depth
}

/// Read items from a JEX archive (tar file)
fn read_jex_archive(jex_path: &Path) -> Result<(Vec<JoplinItem>, HashMap<String, Vec<u8>>)> {
    let file = File::open(jex_path)?;
    let mut archive = tar::Archive::new(file);

    let mut items = Vec::new();
    let mut resources: HashMap<String, Vec<u8>> = HashMap::new();

    for entry_result in archive.entries()? {
        let mut entry = entry_result?;
        let path = entry.path()?.to_path_buf();

        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let extension = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase());

        if extension.as_deref() == Some("md") {
            // Read markdown content as bytes first, then convert to string
            // This handles potential UTF-8 encoding issues with emojis
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes)?;

            // Try to parse as UTF-8, fall back to lossy conversion
            let content = String::from_utf8(bytes)
                .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());

            let (body, metadata) = parse_joplin_metadata(&content);

            items.push(JoplinItem {
                metadata,
                content: body,
            });
        } else if !filename.is_empty() && !path.to_string_lossy().ends_with('/') {
            // Resource file (binary data)
            let mut data = Vec::new();
            entry.read_to_end(&mut data)?;

            // Use filename without extension as ID
            let id = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or(filename);

            resources.insert(id, data);
        }
    }

    Ok((items, resources))
}

/// Read items from a RAW directory export
fn read_raw_directory(dir_path: &Path) -> Result<(Vec<JoplinItem>, HashMap<String, Vec<u8>>)> {
    let mut items = Vec::new();
    let mut resources: HashMap<String, Vec<u8>> = HashMap::new();

    for entry in fs::read_dir(dir_path)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_file() {
            let filename = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            let extension = path
                .extension()
                .map(|e| e.to_string_lossy().to_lowercase());

            if extension.as_deref() == Some("md") {
                // Read markdown content as bytes first, then convert to string
                // This handles potential UTF-8 encoding issues with emojis
                let bytes = fs::read(&path)?;
                let content = String::from_utf8(bytes)
                    .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());

                let (body, metadata) = parse_joplin_metadata(&content);

                items.push(JoplinItem {
                    metadata,
                    content: body,
                });
            } else if !filename.is_empty() {
                // Resource file
                let data = fs::read(&path)?;

                let id = path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or(filename);

                resources.insert(id, data);
            }
        }
    }

    Ok((items, resources))
}

/// Check if path is a JEX archive or RAW directory
fn is_jex_archive(path: &Path) -> bool {
    if path.is_file() {
        // Check extension
        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase());
        ext.as_deref() == Some("jex") || ext.as_deref() == Some("tar")
    } else {
        false
    }
}

/// Preview a Joplin export without importing
pub fn preview_joplin_import(path: &Path) -> Result<JoplinImportPreview> {
    if !path.exists() {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Joplin export not found",
        )));
    }

    let is_jex = is_jex_archive(path);

    let (items, resources) = if is_jex {
        read_jex_archive(path)?
    } else if path.is_dir() {
        read_raw_directory(path)?
    } else {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Path must be a JEX archive or RAW export directory",
        )));
    };

    let mut note_count = 0;
    let mut folder_count = 0;
    let mut tag_count = 0;
    let mut resource_count = 0;
    let mut preview_notes = Vec::new();
    let mut warnings = Vec::new();

    // Build folder map for path lookup
    let mut folders: HashMap<String, JoplinFolder> = HashMap::new();
    let mut tags: HashMap<String, JoplinTag> = HashMap::new();
    let mut notes: Vec<&JoplinItem> = Vec::new();

    // First pass: categorize items
    for item in &items {
        match item.metadata.item_type {
            Some(JoplinType::Note) => {
                note_count += 1;
                notes.push(item);
            }
            Some(JoplinType::Folder) => {
                folder_count += 1;
                let title = item
                    .metadata
                    .title
                    .clone()
                    .or_else(|| extract_title_from_markdown(&item.content))
                    .unwrap_or_else(|| "Untitled Folder".to_string());

                folders.insert(
                    item.metadata.id.clone(),
                    JoplinFolder {
                        id: item.metadata.id.clone(),
                        title,
                        icon: item.metadata.icon.clone(),
                        parent_id: item.metadata.parent_id.clone(),
                    },
                );
            }
            Some(JoplinType::Tag) => {
                tag_count += 1;
                let title = item
                    .metadata
                    .title
                    .clone()
                    .or_else(|| extract_title_from_markdown(&item.content))
                    .unwrap_or_else(|| "Untitled Tag".to_string());

                tags.insert(
                    item.metadata.id.clone(),
                    JoplinTag {
                        id: item.metadata.id.clone(),
                        title,
                    },
                );
            }
            Some(JoplinType::Resource) => {
                resource_count += 1;
            }
            Some(JoplinType::NoteTag) => {
                // NoteTag items link notes to tags
                // Counting is handled elsewhere, just skip in preview
            }
            None => {
                // Unknown type
                if !item.metadata.id.is_empty() {
                    warnings.push(format!(
                        "Unknown item type for ID: {}",
                        &item.metadata.id[..8.min(item.metadata.id.len())]
                    ));
                }
            }
        }
    }

    // Also count resources from binary files
    resource_count += resources.len();

    // Build preview notes (first 10)
    for note in notes.iter().take(10) {
        let title = note
            .metadata
            .title
            .clone()
            .or_else(|| extract_title_from_markdown(&note.content))
            .unwrap_or_else(|| "Untitled".to_string());

        let folder_path = note
            .metadata
            .parent_id
            .as_ref()
            .and_then(|pid| build_folder_path(pid, &folders));

        // Check for resource references
        let has_attachments = note.content.contains("(:/");

        let created = note
            .metadata
            .created_time
            .and_then(parse_joplin_timestamp)
            .map(|dt| dt.to_rfc3339());

        preview_notes.push(JoplinNotePreview {
            title,
            folder_path,
            tags: Vec::new(), // Would need NoteTag parsing for accurate tags
            has_attachments,
            is_todo: note.metadata.is_todo,
            created,
        });
    }

    // Determine suggested name
    let suggested_name = if folder_count == 1 {
        // Single folder - use its name
        folders
            .values()
            .next()
            .map(|f| f.title.clone())
            .unwrap_or_else(|| "Imported from Joplin".to_string())
    } else {
        // Multiple folders or none - use filename
        path.file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Imported from Joplin".to_string())
    };

    if note_count == 0 {
        warnings.push("No notes found in Joplin export".to_string());
    }

    Ok(JoplinImportPreview {
        note_count,
        folder_count,
        tag_count,
        resource_count,
        notes: preview_notes,
        suggested_name,
        warnings,
        is_jex_archive: is_jex,
    })
}

/// Import a Joplin export as a new notebook
pub fn import_joplin(
    path: &Path,
    notebooks_dir: &Path,
    notebook_name: Option<String>,
) -> Result<(Notebook, Vec<Page>)> {
    if !path.exists() {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Joplin export not found",
        )));
    }

    let is_jex = is_jex_archive(path);

    let (items, resource_data) = if is_jex {
        read_jex_archive(path)?
    } else if path.is_dir() {
        read_raw_directory(path)?
    } else {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Path must be a JEX archive or RAW export directory",
        )));
    };

    // Categorize items
    let mut folders: HashMap<String, JoplinFolder> = HashMap::new();
    let mut tags: HashMap<String, JoplinTag> = HashMap::new();
    let mut note_tag_map: HashMap<String, Vec<String>> = HashMap::new(); // note_id -> tag_ids
    let mut resource_metadata: HashMap<String, JoplinMetadata> = HashMap::new();
    let mut notes: Vec<JoplinItem> = Vec::new();

    for item in items {
        match item.metadata.item_type {
            Some(JoplinType::Note) => {
                notes.push(item);
            }
            Some(JoplinType::Folder) => {
                let title = item
                    .metadata
                    .title
                    .clone()
                    .or_else(|| extract_title_from_markdown(&item.content))
                    .unwrap_or_else(|| "Untitled Folder".to_string());

                folders.insert(
                    item.metadata.id.clone(),
                    JoplinFolder {
                        id: item.metadata.id.clone(),
                        title,
                        icon: item.metadata.icon.clone(),
                        parent_id: item.metadata.parent_id.clone(),
                    },
                );
            }
            Some(JoplinType::Tag) => {
                let title = item
                    .metadata
                    .title
                    .clone()
                    .or_else(|| extract_title_from_markdown(&item.content))
                    .unwrap_or_else(|| "Untitled Tag".to_string());

                tags.insert(
                    item.metadata.id.clone(),
                    JoplinTag {
                        id: item.metadata.id.clone(),
                        title,
                    },
                );
            }
            Some(JoplinType::Resource) => {
                resource_metadata.insert(item.metadata.id.clone(), item.metadata);
            }
            Some(JoplinType::NoteTag) => {
                // NoteTag items link notes to tags
                // The note_id is in parent_id, tag_id is in the content
                // Parse the content to extract the tag_id
                if let Some(note_id) = item.metadata.parent_id.clone() {
                    // In Joplin exports, NoteTag items have the tag_id in a separate field
                    // or in the content. Try to extract from content.
                    let (_, note_tag_meta) = parse_joplin_metadata(&item.content);
                    if let Some(tag_id) = note_tag_meta.parent_id {
                        // parent_id in NoteTag content is actually the tag_id
                        note_tag_map
                            .entry(note_id)
                            .or_default()
                            .push(tag_id);
                    }
                }
            }
            None => {
                // Skip unknown types
            }
        }
    }

    // Create the notebook
    let notebook_id = Uuid::new_v4();
    let notebook_name = notebook_name.unwrap_or_else(|| {
        if folders.len() == 1 {
            folders
                .values()
                .next()
                .map(|f| f.title.clone())
                .unwrap_or_else(|| "Imported from Joplin".to_string())
        } else {
            path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Imported from Joplin".to_string())
        }
    });

    let now = Utc::now();
    let notebook = Notebook {
        id: notebook_id,
        name: notebook_name,
        notebook_type: NotebookType::Standard,
        icon: Some("📔".to_string()), // Notebook emoji for Joplin
        color: None,
        sections_enabled: false,
        archived: false,
        system_prompt: None,
        system_prompt_mode: crate::storage::SystemPromptMode::default(),
        ai_provider: None,
        ai_model: None,
        sync_config: None,
        encryption_config: None,
        is_pinned: false,
        position: 0,
        page_sort_by: None,
        daily_notes_config: None,
        created_at: now,
        updated_at: now,
    };

    // Create notebook directory structure
    let notebook_dir = notebooks_dir.join(notebook_id.to_string());
    fs::create_dir_all(&notebook_dir)?;
    fs::create_dir_all(notebook_dir.join("pages"))?;
    fs::create_dir_all(notebook_dir.join("assets"))?;

    // Write notebook.json
    let notebook_json = serde_json::to_string_pretty(&notebook)?;
    fs::write(notebook_dir.join("notebook.json"), notebook_json)?;

    // Create Nous folders from Joplin folders
    // We need to handle folder hierarchy - create parent folders first
    let mut joplin_to_nous_folder: HashMap<String, Uuid> = HashMap::new();
    let mut nous_folders: Vec<Folder> = Vec::new();

    // Sort folders by depth (no parent first, then single parent, etc.)
    // This ensures parents are created before children
    let mut sorted_joplin_folders: Vec<&JoplinFolder> = folders.values().collect();
    sorted_joplin_folders.sort_by(|a, b| {
        let depth_a = get_folder_depth(&a.id, &folders);
        let depth_b = get_folder_depth(&b.id, &folders);
        depth_a.cmp(&depth_b)
    });

    for joplin_folder in sorted_joplin_folders {
        let parent_uuid = joplin_folder
            .parent_id
            .as_ref()
            .and_then(|pid| joplin_to_nous_folder.get(pid).copied());

        // Build folder name with emoji prefix if available
        let folder_name = match &joplin_folder.icon {
            Some(emoji) if !emoji.is_empty() => format!("{} {}", emoji, joplin_folder.title),
            _ => joplin_folder.title.clone(),
        };

        let mut nous_folder = Folder::new(notebook_id, folder_name, parent_uuid);
        nous_folder.position = nous_folders.len() as i32;

        joplin_to_nous_folder.insert(joplin_folder.id.clone(), nous_folder.id);
        nous_folders.push(nous_folder);
    }

    // Save folders to folders.json
    if !nous_folders.is_empty() {
        let folders_json = serde_json::to_string_pretty(&nous_folders)?;
        fs::write(notebook_dir.join("folders.json"), folders_json)?;
    }

    // Copy resources/assets
    let assets_dir = notebook_dir.join("assets");
    let mut resource_mapping: HashMap<String, String> = HashMap::new();

    for (resource_id, data) in &resource_data {
        if data.is_empty() {
            continue;
        }

        // Determine filename and extension
        let (filename, extension) = if let Some(meta) = resource_metadata.get(resource_id) {
            let ext = meta
                .file_extension
                .clone()
                .or_else(|| {
                    meta.mime.as_ref().and_then(|m| match m.as_str() {
                        "image/png" => Some("png".to_string()),
                        "image/jpeg" => Some("jpg".to_string()),
                        "image/gif" => Some("gif".to_string()),
                        "image/webp" => Some("webp".to_string()),
                        "application/pdf" => Some("pdf".to_string()),
                        _ => None,
                    })
                })
                .unwrap_or_else(|| "bin".to_string());

            let name = meta
                .filename
                .clone()
                .unwrap_or_else(|| format!("{}.{}", resource_id, ext));

            (name, ext)
        } else {
            // Guess extension from data (magic bytes)
            let ext = guess_extension_from_data(data);
            (format!("{}.{}", resource_id, ext), ext)
        };

        // Ensure unique filename
        let mut target_filename = filename.clone();
        let mut counter = 1;
        while assets_dir.join(&target_filename).exists() {
            let stem = Path::new(&filename)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            target_filename = format!("{}_{}.{}", stem, counter, extension);
            counter += 1;
        }

        // Write asset file
        let target_path = assets_dir.join(&target_filename);
        fs::write(&target_path, data)?;

        // Map resource ID to asset URL
        let asset_url = format!("asset://{}/{}", notebook_id, target_filename);
        resource_mapping.insert(resource_id.clone(), asset_url);
    }

    // Process notes
    let mut pages: Vec<Page> = Vec::new();

    for note in notes {
        // Get title
        let title = note
            .metadata
            .title
            .clone()
            .or_else(|| extract_title_from_markdown(&note.content))
            .unwrap_or_else(|| "Untitled".to_string());

        // Convert resource references
        let content = convert_resource_references(&note.content, &resource_mapping);

        // Get tags
        let mut page_tags: Vec<String> = Vec::new();

        // Add folder path as tag
        if let Some(parent_id) = &note.metadata.parent_id {
            if let Some(folder_path) = build_folder_path(parent_id, &folders) {
                // Convert folder path to tags
                for part in folder_path.split('/') {
                    let tag = part
                        .to_lowercase()
                        .replace(' ', "-")
                        .chars()
                        .filter(|c| c.is_alphanumeric() || *c == '-')
                        .collect::<String>();
                    if !tag.is_empty() && !page_tags.contains(&tag) {
                        page_tags.push(tag);
                    }
                }
            }
        }

        // Add actual tags from note-tag associations
        if let Some(tag_ids) = note_tag_map.get(&note.metadata.id) {
            for tag_id in tag_ids {
                if let Some(tag) = tags.get(tag_id) {
                    let tag_name = tag
                        .title
                        .to_lowercase()
                        .replace(' ', "-")
                        .chars()
                        .filter(|c| c.is_alphanumeric() || *c == '-')
                        .collect::<String>();
                    if !tag_name.is_empty() && !page_tags.contains(&tag_name) {
                        page_tags.push(tag_name);
                    }
                }
            }
        }

        // Add todo tag if applicable
        if note.metadata.is_todo {
            if note.metadata.todo_completed {
                if !page_tags.contains(&"completed".to_string()) {
                    page_tags.push("completed".to_string());
                }
            } else {
                if !page_tags.contains(&"todo".to_string()) {
                    page_tags.push("todo".to_string());
                }
            }
        }

        // Import markdown content to page
        let mut page = import_markdown_to_page(&content, notebook_id, &title);

        // Set folder_id if the note was in a Joplin folder
        if let Some(joplin_parent_id) = &note.metadata.parent_id {
            if let Some(&nous_folder_id) = joplin_to_nous_folder.get(joplin_parent_id) {
                page.folder_id = Some(nous_folder_id);
            }
        }

        // Override tags
        page.tags = page_tags;

        // Set timestamps from metadata
        if let Some(ts) = note.metadata.created_time.and_then(parse_joplin_timestamp) {
            page.created_at = ts;
        }
        if let Some(ts) = note.metadata.updated_time.and_then(parse_joplin_timestamp) {
            page.updated_at = ts;
        }

        // Save page
        let page_path = notebook_dir
            .join("pages")
            .join(format!("{}.json", page.id));
        let page_json = serde_json::to_string_pretty(&page)?;
        fs::write(page_path, page_json)?;

        pages.push(page);
    }

    Ok((notebook, pages))
}

/// Import a Joplin export as a new notebook with progress reporting
pub fn import_joplin_with_progress<F>(
    path: &Path,
    notebooks_dir: &Path,
    notebook_name: Option<String>,
    progress: F,
) -> Result<(Notebook, Vec<Page>)>
where
    F: Fn(usize, usize, &str),
{
    if !path.exists() {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Joplin export not found",
        )));
    }

    progress(0, 100, "Reading export file...");

    let is_jex = is_jex_archive(path);

    let (items, resource_data) = if is_jex {
        read_jex_archive(path)?
    } else if path.is_dir() {
        read_raw_directory(path)?
    } else {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Path must be a JEX archive or RAW export directory",
        )));
    };

    progress(10, 100, "Processing items...");

    // Categorize items
    let mut folders: HashMap<String, JoplinFolder> = HashMap::new();
    let mut tags: HashMap<String, JoplinTag> = HashMap::new();
    let mut note_tag_map: HashMap<String, Vec<String>> = HashMap::new();
    let mut resource_metadata: HashMap<String, JoplinMetadata> = HashMap::new();
    let mut notes: Vec<JoplinItem> = Vec::new();

    for item in items {
        match item.metadata.item_type {
            Some(JoplinType::Note) => {
                notes.push(item);
            }
            Some(JoplinType::Folder) => {
                let title = item
                    .metadata
                    .title
                    .clone()
                    .or_else(|| extract_title_from_markdown(&item.content))
                    .unwrap_or_else(|| "Untitled Folder".to_string());

                folders.insert(
                    item.metadata.id.clone(),
                    JoplinFolder {
                        id: item.metadata.id.clone(),
                        title,
                        icon: item.metadata.icon.clone(),
                        parent_id: item.metadata.parent_id.clone(),
                    },
                );
            }
            Some(JoplinType::Tag) => {
                let title = item
                    .metadata
                    .title
                    .clone()
                    .or_else(|| extract_title_from_markdown(&item.content))
                    .unwrap_or_else(|| "Untitled Tag".to_string());

                tags.insert(
                    item.metadata.id.clone(),
                    JoplinTag {
                        id: item.metadata.id.clone(),
                        title,
                    },
                );
            }
            Some(JoplinType::Resource) => {
                resource_metadata.insert(item.metadata.id.clone(), item.metadata);
            }
            Some(JoplinType::NoteTag) => {
                if let Some(note_id) = item.metadata.parent_id.clone() {
                    let (_, note_tag_meta) = parse_joplin_metadata(&item.content);
                    if let Some(tag_id) = note_tag_meta.parent_id {
                        note_tag_map.entry(note_id).or_default().push(tag_id);
                    }
                }
            }
            None => {}
        }
    }

    progress(20, 100, "Creating notebook...");

    // Create the notebook
    let notebook_id = Uuid::new_v4();
    let notebook_name = notebook_name.unwrap_or_else(|| {
        if folders.len() == 1 {
            folders
                .values()
                .next()
                .map(|f| f.title.clone())
                .unwrap_or_else(|| "Imported from Joplin".to_string())
        } else {
            path.file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Imported from Joplin".to_string())
        }
    });

    let now = Utc::now();
    let notebook = Notebook {
        id: notebook_id,
        name: notebook_name,
        notebook_type: NotebookType::Standard,
        icon: Some("📔".to_string()),
        color: None,
        sections_enabled: false,
        archived: false,
        system_prompt: None,
        system_prompt_mode: crate::storage::SystemPromptMode::default(),
        ai_provider: None,
        ai_model: None,
        sync_config: None,
        encryption_config: None,
        is_pinned: false,
        position: 0,
        page_sort_by: None,
        daily_notes_config: None,
        created_at: now,
        updated_at: now,
    };

    let notebook_dir = notebooks_dir.join(notebook_id.to_string());
    fs::create_dir_all(&notebook_dir)?;
    fs::create_dir_all(notebook_dir.join("pages"))?;
    fs::create_dir_all(notebook_dir.join("assets"))?;

    let notebook_json = serde_json::to_string_pretty(&notebook)?;
    fs::write(notebook_dir.join("notebook.json"), notebook_json)?;

    progress(25, 100, "Creating folders...");

    // Create Nous folders from Joplin folders
    let mut joplin_to_nous_folder: HashMap<String, Uuid> = HashMap::new();
    let mut nous_folders: Vec<Folder> = Vec::new();

    let mut sorted_joplin_folders: Vec<&JoplinFolder> = folders.values().collect();
    sorted_joplin_folders.sort_by(|a, b| {
        let depth_a = get_folder_depth(&a.id, &folders);
        let depth_b = get_folder_depth(&b.id, &folders);
        depth_a.cmp(&depth_b)
    });

    for joplin_folder in sorted_joplin_folders {
        let parent_uuid = joplin_folder
            .parent_id
            .as_ref()
            .and_then(|pid| joplin_to_nous_folder.get(pid).copied());

        let folder_name = match &joplin_folder.icon {
            Some(emoji) if !emoji.is_empty() => format!("{} {}", emoji, joplin_folder.title),
            _ => joplin_folder.title.clone(),
        };

        let mut nous_folder = Folder::new(notebook_id, folder_name, parent_uuid);
        nous_folder.position = nous_folders.len() as i32;

        joplin_to_nous_folder.insert(joplin_folder.id.clone(), nous_folder.id);
        nous_folders.push(nous_folder);
    }

    if !nous_folders.is_empty() {
        let folders_json = serde_json::to_string_pretty(&nous_folders)?;
        fs::write(notebook_dir.join("folders.json"), folders_json)?;
    }

    // Copy resources/assets
    let assets_dir = notebook_dir.join("assets");
    let mut resource_mapping: HashMap<String, String> = HashMap::new();
    let total_resources = resource_data.len();

    for (i, (resource_id, data)) in resource_data.iter().enumerate() {
        if i % 10 == 0 || i == total_resources - 1 {
            progress(
                30 + (i * 20) / total_resources.max(1),
                100,
                &format!("Copying assets ({}/{})", i + 1, total_resources),
            );
        }

        if data.is_empty() {
            continue;
        }

        let (filename, extension) = if let Some(meta) = resource_metadata.get(resource_id) {
            let ext = meta
                .file_extension
                .clone()
                .or_else(|| {
                    meta.mime.as_ref().and_then(|m| match m.as_str() {
                        "image/png" => Some("png".to_string()),
                        "image/jpeg" => Some("jpg".to_string()),
                        "image/gif" => Some("gif".to_string()),
                        "image/webp" => Some("webp".to_string()),
                        "application/pdf" => Some("pdf".to_string()),
                        _ => None,
                    })
                })
                .unwrap_or_else(|| "bin".to_string());

            let name = meta
                .filename
                .clone()
                .unwrap_or_else(|| format!("{}.{}", resource_id, ext));

            (name, ext)
        } else {
            let ext = guess_extension_from_data(data);
            (format!("{}.{}", resource_id, ext), ext)
        };

        let mut target_filename = filename.clone();
        let mut counter = 1;
        while assets_dir.join(&target_filename).exists() {
            let stem = Path::new(&filename)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            target_filename = format!("{}_{}.{}", stem, counter, extension);
            counter += 1;
        }

        let target_path = assets_dir.join(&target_filename);
        fs::write(&target_path, data)?;

        let asset_url = format!("asset://{}/{}", notebook_id, target_filename);
        resource_mapping.insert(resource_id.clone(), asset_url);
    }

    // Process notes
    let mut pages: Vec<Page> = Vec::new();
    let total_notes = notes.len();

    for (i, note) in notes.into_iter().enumerate() {
        if i % 5 == 0 || i == total_notes - 1 {
            progress(
                50 + (i * 50) / total_notes.max(1),
                100,
                &format!("Importing notes ({}/{})", i + 1, total_notes),
            );
        }

        let title = note
            .metadata
            .title
            .clone()
            .or_else(|| extract_title_from_markdown(&note.content))
            .unwrap_or_else(|| "Untitled".to_string());

        let content = convert_resource_references(&note.content, &resource_mapping);

        let mut page_tags: Vec<String> = Vec::new();

        if let Some(parent_id) = &note.metadata.parent_id {
            if let Some(folder_path) = build_folder_path(parent_id, &folders) {
                for part in folder_path.split('/') {
                    let tag = part
                        .to_lowercase()
                        .replace(' ', "-")
                        .chars()
                        .filter(|c| c.is_alphanumeric() || *c == '-')
                        .collect::<String>();
                    if !tag.is_empty() && !page_tags.contains(&tag) {
                        page_tags.push(tag);
                    }
                }
            }
        }

        if let Some(tag_ids) = note_tag_map.get(&note.metadata.id) {
            for tag_id in tag_ids {
                if let Some(tag) = tags.get(tag_id) {
                    let tag_name = tag
                        .title
                        .to_lowercase()
                        .replace(' ', "-")
                        .chars()
                        .filter(|c| c.is_alphanumeric() || *c == '-')
                        .collect::<String>();
                    if !tag_name.is_empty() && !page_tags.contains(&tag_name) {
                        page_tags.push(tag_name);
                    }
                }
            }
        }

        if note.metadata.is_todo {
            if note.metadata.todo_completed {
                if !page_tags.contains(&"completed".to_string()) {
                    page_tags.push("completed".to_string());
                }
            } else {
                if !page_tags.contains(&"todo".to_string()) {
                    page_tags.push("todo".to_string());
                }
            }
        }

        let mut page = import_markdown_to_page(&content, notebook_id, &title);

        if let Some(joplin_parent_id) = &note.metadata.parent_id {
            if let Some(&nous_folder_id) = joplin_to_nous_folder.get(joplin_parent_id) {
                page.folder_id = Some(nous_folder_id);
            }
        }

        page.tags = page_tags;

        if let Some(ts) = note.metadata.created_time.and_then(parse_joplin_timestamp) {
            page.created_at = ts;
        }
        if let Some(ts) = note.metadata.updated_time.and_then(parse_joplin_timestamp) {
            page.updated_at = ts;
        }

        let page_path = notebook_dir
            .join("pages")
            .join(format!("{}.json", page.id));
        let page_json = serde_json::to_string_pretty(&page)?;
        fs::write(page_path, page_json)?;

        pages.push(page);
    }

    progress(100, 100, "Import complete");

    Ok((notebook, pages))
}

/// Guess file extension from data (magic bytes)
fn guess_extension_from_data(data: &[u8]) -> String {
    if data.len() < 4 {
        return "bin".to_string();
    }

    // Check magic bytes
    match &data[0..4] {
        [0x89, b'P', b'N', b'G'] => "png".to_string(),
        [0xFF, 0xD8, 0xFF, _] => "jpg".to_string(),
        [b'G', b'I', b'F', b'8'] => "gif".to_string(),
        [b'R', b'I', b'F', b'F'] if data.len() >= 12 && &data[8..12] == b"WEBP" => {
            "webp".to_string()
        }
        [b'%', b'P', b'D', b'F'] => "pdf".to_string(),
        [b'P', b'K', 0x03, 0x04] => "zip".to_string(),
        _ => "bin".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_joplin_metadata() {
        let content = r#"# My Note Title

This is the note content.

Some more content here.

id: abc123def456789012345678901234ab
parent_id: def456789012345678901234abcdef01
created_time: 1700000000000
updated_time: 1700100000000
is_todo: 0
type_: 1"#;

        let (body, metadata) = parse_joplin_metadata(content);

        assert_eq!(body, "# My Note Title\n\nThis is the note content.\n\nSome more content here.");
        assert_eq!(metadata.id, "abc123def456789012345678901234ab");
        assert_eq!(
            metadata.parent_id,
            Some("def456789012345678901234abcdef01".to_string())
        );
        assert_eq!(metadata.created_time, Some(1700000000000));
        assert_eq!(metadata.updated_time, Some(1700100000000));
        assert!(!metadata.is_todo);
        assert_eq!(metadata.item_type, Some(JoplinType::Note));
    }

    #[test]
    fn test_extract_title_from_markdown() {
        // Standard markdown heading
        assert_eq!(
            extract_title_from_markdown("# My Title\n\nContent"),
            Some("My Title".to_string())
        );
        // Plain text first line (no heading) - use as title
        assert_eq!(
            extract_title_from_markdown("My Plain Title\n\nContent"),
            Some("My Plain Title".to_string())
        );
        // Empty first line, heading on second line
        assert_eq!(
            extract_title_from_markdown("\n# My Title\n\nContent"),
            Some("My Title".to_string())
        );
        // Empty content
        assert_eq!(
            extract_title_from_markdown(""),
            None
        );
    }

    #[test]
    fn test_convert_resource_references() {
        let mut mapping = HashMap::new();
        mapping.insert(
            "abc123def456789012345678901234ab".to_string(),
            "asset://notebook-id/image.png".to_string(),
        );

        let content = "Check this ![image](:/abc123def456789012345678901234ab) out!";
        let result = convert_resource_references(content, &mapping);

        assert_eq!(
            result,
            "Check this ![image](asset://notebook-id/image.png) out!"
        );
    }

    #[test]
    fn test_guess_extension_from_data() {
        assert_eq!(
            guess_extension_from_data(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
            "png"
        );
        assert_eq!(
            guess_extension_from_data(&[0xFF, 0xD8, 0xFF, 0xE0]),
            "jpg"
        );
        assert_eq!(
            guess_extension_from_data(&[b'G', b'I', b'F', b'8', b'9', b'a']),
            "gif"
        );
        assert_eq!(
            guess_extension_from_data(&[b'%', b'P', b'D', b'F', b'-', b'1']),
            "pdf"
        );
        assert_eq!(guess_extension_from_data(&[0x00, 0x01, 0x02]), "bin");
    }
}

