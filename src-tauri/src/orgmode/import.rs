//! Org-mode import implementation
//!
//! Parses org-mode syntax and converts to Katt EditorData blocks.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, NaiveDate, NaiveDateTime, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::storage::{EditorBlock, EditorData, Notebook, NotebookType, Page, StorageError};

type Result<T> = std::result::Result<T, StorageError>;

/// Preview metadata for an org-mode import
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgmodeImportPreview {
    /// Number of .org files found
    pub page_count: usize,
    /// Number of asset files found
    pub asset_count: usize,
    /// Number of folders
    pub folder_count: usize,
    /// Maximum folder nesting depth
    pub nested_depth: usize,
    /// Sample pages for preview (first 10)
    pub pages: Vec<OrgmodePagePreview>,
    /// Suggested notebook name
    pub suggested_name: String,
    /// Warnings during preview
    pub warnings: Vec<String>,
    /// Whether this is a single file or directory
    pub is_single_file: bool,
}

/// Preview info for a single org-mode file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrgmodePagePreview {
    /// Page title (from #+TITLE: or filename)
    pub title: String,
    /// Relative path
    pub path: String,
    /// Tags from headers
    pub tags: Vec<String>,
    /// Whether file has TODOs
    pub has_todos: bool,
    /// Whether file has scheduled items
    pub has_scheduled: bool,
}

/// Internal structure for tracking pages during import
struct OrgPageInfo {
    /// Original path relative to root
    relative_path: PathBuf,
    /// Page title
    title: String,
    /// Raw org content
    content: String,
    /// Collected tags
    tags: Vec<String>,
    /// Folder path for organization
    folder_path: Option<String>,
}

/// Org-mode document metadata from #+KEY: value lines
#[derive(Default)]
struct OrgMetadata {
    title: Option<String>,
    author: Option<String>,
    date: Option<String>,
    tags: Vec<String>,
    properties: HashMap<String, String>,
}

/// Parse org-mode keyword lines (#+KEY: value)
fn parse_org_metadata(content: &str) -> (OrgMetadata, String) {
    let mut metadata = OrgMetadata::default();
    let mut body_lines: Vec<&str> = Vec::new();
    let mut in_property_drawer = false;

    for line in content.lines() {
        let trimmed = line.trim();

        // Handle property drawers
        if trimmed == ":PROPERTIES:" {
            in_property_drawer = true;
            continue;
        }
        if trimmed == ":END:" {
            in_property_drawer = false;
            continue;
        }
        if in_property_drawer {
            // Parse :KEY: value
            if let Some(colon_pos) = trimmed[1..].find(':') {
                let key = trimmed[1..colon_pos + 1].trim().to_lowercase();
                let value = trimmed[colon_pos + 2..].trim().to_string();
                metadata.properties.insert(key, value);
            }
            continue;
        }

        // Parse #+KEY: value
        if trimmed.starts_with("#+") {
            if let Some(colon_pos) = trimmed.find(':') {
                let key = trimmed[2..colon_pos].to_lowercase();
                let value = trimmed[colon_pos + 1..].trim().to_string();

                match key.as_str() {
                    "title" => metadata.title = Some(value),
                    "author" => metadata.author = Some(value),
                    "date" => metadata.date = Some(value),
                    "filetags" => {
                        // Parse :tag1:tag2:tag3: format
                        for tag in value.trim_matches(':').split(':') {
                            if !tag.is_empty() {
                                metadata.tags.push(tag.to_string());
                            }
                        }
                    }
                    _ => {
                        metadata.properties.insert(key, value);
                    }
                }
                continue;
            }
        }

        body_lines.push(line);
    }

    (metadata, body_lines.join("\n"))
}

/// Parse org timestamps like <2024-01-15 Mon> or [2024-01-15 Mon]
fn parse_org_timestamp(s: &str) -> Option<DateTime<Utc>> {
    // Match patterns like <2024-01-15 Mon> or <2024-01-15 Mon 10:30>
    let re = Regex::new(r"[<\[](\d{4}-\d{2}-\d{2})(?:\s+\w+)?(?:\s+(\d{2}:\d{2}))?[>\]]").ok()?;

    if let Some(caps) = re.captures(s) {
        let date_str = caps.get(1)?.as_str();
        let time_str = caps.get(2).map(|m| m.as_str()).unwrap_or("00:00");

        let datetime_str = format!("{}T{}:00", date_str, time_str);
        if let Ok(dt) = NaiveDateTime::parse_from_str(&datetime_str, "%Y-%m-%dT%H:%M:%S") {
            return Some(DateTime::from_naive_utc_and_offset(dt, Utc));
        }

        // Try just date
        if let Ok(d) = NaiveDate::parse_from_str(date_str, "%Y-%m-%d") {
            let dt = d.and_hms_opt(0, 0, 0)?;
            return Some(DateTime::from_naive_utc_and_offset(dt, Utc));
        }
    }
    None
}

/// Extract tags from org header line (* Header :tag1:tag2:)
fn extract_header_tags(line: &str) -> Vec<String> {
    let mut tags = Vec::new();
    // Tags are at the end of the line in :tag1:tag2: format
    if let Some(tag_start) = line.rfind(" :") {
        let tag_part = &line[tag_start + 1..];
        if tag_part.ends_with(':') {
            for tag in tag_part.trim_matches(':').split(':') {
                if !tag.is_empty() {
                    tags.push(tag.to_string());
                }
            }
        }
    }
    tags
}

/// Check if line has TODO/DONE keyword
fn extract_todo_state(line: &str) -> Option<&str> {
    let keywords = ["TODO", "DONE", "NEXT", "WAITING", "CANCELLED", "CANCELED"];
    let content = line.trim_start_matches(|c| c == '*' || c == ' ');

    for kw in &keywords {
        if content.starts_with(kw) && content.chars().nth(kw.len()).map_or(true, |c| c.is_whitespace()) {
            return Some(kw);
        }
    }
    None
}

/// Check if content has TODO items
fn has_todos(content: &str) -> bool {
    content.lines().any(|line| {
        let trimmed = line.trim();
        trimmed.starts_with('*') && extract_todo_state(trimmed).is_some()
    })
}

/// Check if content has scheduled items
fn has_scheduled(content: &str) -> bool {
    content.contains("SCHEDULED:") || content.contains("DEADLINE:")
}

/// Collect all tags from org content
fn collect_all_tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('*') {
            for tag in extract_header_tags(trimmed) {
                if !tags.contains(&tag) {
                    tags.push(tag);
                }
            }
        }
    }

    tags
}

/// Convert org emphasis to HTML
/// Org-mode emphasis markers must be surrounded by whitespace or punctuation
fn convert_org_emphasis(text: &str) -> String {
    let mut result = String::new();
    let chars: Vec<char> = text.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        let c = chars[i];

        // Check for emphasis markers: * / = ~ _ +
        if matches!(c, '*' | '/' | '=' | '~' | '_' | '+') {
            // Check if this could be an opening marker
            // Opening marker: at start OR preceded by whitespace/punctuation
            let is_opener = i == 0 || {
                let prev = chars[i - 1];
                prev.is_whitespace() || matches!(prev, '(' | '[' | '{' | '"' | '\'' | '<')
            };

            if is_opener {
                // Look for closing marker
                if let Some(end) = find_closing_marker(&chars, i, c) {
                    // Check if closing marker is valid (followed by whitespace/punctuation/end)
                    let is_closer = end + 1 >= len || {
                        let next = chars[end + 1];
                        next.is_whitespace() || matches!(next, ')' | ']' | '}' | '"' | '\'' | '>' | '.' | ',' | ';' | ':' | '!' | '?')
                    };

                    if is_closer {
                        let content: String = chars[i + 1..end].iter().collect();
                        if !content.is_empty() && !content.starts_with(' ') && !content.ends_with(' ') {
                            let tag = match c {
                                '*' => "b",
                                '/' => "i",
                                '=' | '~' => "code",
                                '_' => "u",
                                '+' => "s",
                                _ => unreachable!(),
                            };
                            result.push_str(&format!("<{0}>{1}</{0}>", tag, content));
                            i = end + 1;
                            continue;
                        }
                    }
                }
            }
        }

        result.push(c);
        i += 1;
    }

    result
}

/// Find closing emphasis marker
fn find_closing_marker(chars: &[char], start: usize, marker: char) -> Option<usize> {
    for i in (start + 2)..chars.len() {
        if chars[i] == marker && chars[i - 1] != ' ' {
            return Some(i);
        }
    }
    None
}

/// Convert org links to HTML
fn convert_org_links(text: &str) -> String {
    let mut result = text.to_string();

    // [[link][description]] -> <a href="link">description</a>
    let link_with_desc = Regex::new(r"\[\[([^\]]+)\]\[([^\]]+)\]\]").unwrap();
    result = link_with_desc.replace_all(&result, "<a href=\"$1\">$2</a>").to_string();

    // [[link]] -> <a href="link">link</a>
    let link_simple = Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    result = link_simple.replace_all(&result, |caps: &regex::Captures| {
        let link = &caps[1];
        // Check if it's an internal link (no protocol)
        if !link.contains("://") && !link.starts_with("file:") {
            format!("[[{}]]", link) // Keep as wiki-link
        } else {
            format!("<a href=\"{}\">{}</a>", link, link)
        }
    }).to_string();

    result
}

/// Generate a unique block ID
fn generate_block_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{:x}", timestamp)
}

/// Parse org-mode content into EditorData blocks
fn parse_org_to_blocks(content: &str) -> Vec<EditorBlock> {
    let mut blocks: Vec<EditorBlock> = Vec::new();
    let mut current_text = String::new();
    let mut in_code_block = false;
    let mut code_content = String::new();
    let mut code_language = String::new();
    let mut in_quote = false;
    let mut quote_text = String::new();
    let mut list_items: Vec<String> = Vec::new();
    let mut checklist_items: Vec<(String, bool)> = Vec::new();
    let mut is_ordered_list = false;

    let lines: Vec<&str> = content.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();

        // Skip empty lines if not in special block
        if trimmed.is_empty() {
            if !current_text.is_empty() {
                flush_paragraph(&mut blocks, &mut current_text);
            }
            if !list_items.is_empty() {
                flush_list(&mut blocks, &mut list_items, is_ordered_list);
            }
            if !checklist_items.is_empty() {
                flush_checklist(&mut blocks, &mut checklist_items);
            }
            i += 1;
            continue;
        }

        // Code blocks: #+BEGIN_SRC ... #+END_SRC
        if trimmed.to_uppercase().starts_with("#+BEGIN_SRC") {
            flush_paragraph(&mut blocks, &mut current_text);
            in_code_block = true;
            // Extract language
            let parts: Vec<&str> = trimmed.split_whitespace().collect();
            code_language = parts.get(1).unwrap_or(&"").to_string();
            i += 1;
            continue;
        }
        if trimmed.to_uppercase() == "#+END_SRC" {
            in_code_block = false;
            blocks.push(EditorBlock {
                id: generate_block_id(),
                block_type: "code".to_string(),
                data: serde_json::json!({
                    "code": code_content.trim_end(),
                    "language": code_language
                }),
            });
            code_content.clear();
            code_language.clear();
            i += 1;
            continue;
        }
        if in_code_block {
            code_content.push_str(line);
            code_content.push('\n');
            i += 1;
            continue;
        }

        // Quote blocks: #+BEGIN_QUOTE ... #+END_QUOTE
        if trimmed.to_uppercase() == "#+BEGIN_QUOTE" {
            flush_paragraph(&mut blocks, &mut current_text);
            in_quote = true;
            i += 1;
            continue;
        }
        if trimmed.to_uppercase() == "#+END_QUOTE" {
            in_quote = false;
            if !quote_text.is_empty() {
                blocks.push(EditorBlock {
                    id: generate_block_id(),
                    block_type: "quote".to_string(),
                    data: serde_json::json!({
                        "text": quote_text.trim()
                    }),
                });
                quote_text.clear();
            }
            i += 1;
            continue;
        }
        if in_quote {
            quote_text.push_str(trimmed);
            quote_text.push('\n');
            i += 1;
            continue;
        }

        // Headers: * Header, ** Subheader, etc.
        if trimmed.starts_with('*') {
            flush_paragraph(&mut blocks, &mut current_text);
            flush_list(&mut blocks, &mut list_items, is_ordered_list);
            flush_checklist(&mut blocks, &mut checklist_items);

            // Count asterisks for heading level
            let level = trimmed.chars().take_while(|c| *c == '*').count();
            let mut header_text = trimmed[level..].trim().to_string();

            // Remove TODO state
            if let Some(state) = extract_todo_state(&header_text) {
                header_text = header_text[state.len()..].trim().to_string();
            }

            // Remove tags at end
            if let Some(tag_start) = header_text.rfind(" :") {
                let potential_tags = &header_text[tag_start + 1..];
                if potential_tags.ends_with(':') && potential_tags.chars().filter(|c| *c == ':').count() >= 2 {
                    header_text = header_text[..tag_start].to_string();
                }
            }

            // Convert emphasis and links
            header_text = convert_org_emphasis(&header_text);
            header_text = convert_org_links(&header_text);

            // Cap level at 6
            let level = level.min(6) as u8;

            blocks.push(EditorBlock {
                id: generate_block_id(),
                block_type: "header".to_string(),
                data: serde_json::json!({
                    "text": header_text.trim(),
                    "level": level
                }),
            });
            i += 1;
            continue;
        }

        // Horizontal rule: -----
        if trimmed.chars().all(|c| c == '-') && trimmed.len() >= 5 {
            flush_paragraph(&mut blocks, &mut current_text);
            blocks.push(EditorBlock {
                id: generate_block_id(),
                block_type: "delimiter".to_string(),
                data: serde_json::json!({}),
            });
            i += 1;
            continue;
        }

        // Lists: - item, + item, or 1. item, 1) item
        let list_match = Regex::new(r"^(\s*)(-|\+|\d+[.\)])\s+(.*)$").unwrap();
        if let Some(caps) = list_match.captures(line) {
            flush_paragraph(&mut blocks, &mut current_text);

            let bullet = caps.get(2).unwrap().as_str();
            let item_text = caps.get(3).unwrap().as_str();

            // Check if this is an ordered list
            let is_ordered = bullet.chars().next().map_or(false, |c| c.is_ascii_digit());

            // Check for checkbox [ ] or [X]
            let checkbox_re = Regex::new(r"^\[([X \-])\]\s*(.*)$").unwrap();
            if let Some(cb_caps) = checkbox_re.captures(item_text) {
                // Flush regular list if switching
                if !list_items.is_empty() {
                    flush_list(&mut blocks, &mut list_items, is_ordered_list);
                }

                let checked = cb_caps.get(1).unwrap().as_str() == "X";
                let text = cb_caps.get(2).unwrap().as_str();
                let formatted_text = convert_org_emphasis(text);
                let formatted_text = convert_org_links(&formatted_text);
                checklist_items.push((formatted_text, checked));
            } else {
                // Flush checklist if switching
                if !checklist_items.is_empty() {
                    flush_checklist(&mut blocks, &mut checklist_items);
                }

                // Handle list type change
                if !list_items.is_empty() && is_ordered != is_ordered_list {
                    flush_list(&mut blocks, &mut list_items, is_ordered_list);
                }
                is_ordered_list = is_ordered;

                let formatted_text = convert_org_emphasis(item_text);
                let formatted_text = convert_org_links(&formatted_text);
                list_items.push(formatted_text);
            }
            i += 1;
            continue;
        }

        // Skip SCHEDULED, DEADLINE, CLOSED lines (metadata)
        if trimmed.starts_with("SCHEDULED:") || trimmed.starts_with("DEADLINE:") || trimmed.starts_with("CLOSED:") {
            i += 1;
            continue;
        }

        // Skip remaining #+KEY: lines
        if trimmed.starts_with("#+") {
            i += 1;
            continue;
        }

        // Regular paragraph text
        let formatted = convert_org_emphasis(trimmed);
        let formatted = convert_org_links(&formatted);
        if !current_text.is_empty() {
            current_text.push(' ');
        }
        current_text.push_str(&formatted);

        i += 1;
    }

    // Flush remaining content
    flush_paragraph(&mut blocks, &mut current_text);
    flush_list(&mut blocks, &mut list_items, is_ordered_list);
    flush_checklist(&mut blocks, &mut checklist_items);

    if in_quote && !quote_text.is_empty() {
        blocks.push(EditorBlock {
            id: generate_block_id(),
            block_type: "quote".to_string(),
            data: serde_json::json!({
                "text": quote_text.trim()
            }),
        });
    }

    blocks
}

/// Flush current text as paragraph
fn flush_paragraph(blocks: &mut Vec<EditorBlock>, text: &mut String) {
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        blocks.push(EditorBlock {
            id: generate_block_id(),
            block_type: "paragraph".to_string(),
            data: serde_json::json!({
                "text": trimmed
            }),
        });
    }
    text.clear();
}

/// Flush list items
fn flush_list(blocks: &mut Vec<EditorBlock>, items: &mut Vec<String>, ordered: bool) {
    if !items.is_empty() {
        blocks.push(EditorBlock {
            id: generate_block_id(),
            block_type: "list".to_string(),
            data: serde_json::json!({
                "style": if ordered { "ordered" } else { "unordered" },
                "items": items.clone()
            }),
        });
        items.clear();
    }
}

/// Flush checklist items
fn flush_checklist(blocks: &mut Vec<EditorBlock>, items: &mut Vec<(String, bool)>) {
    if !items.is_empty() {
        blocks.push(EditorBlock {
            id: generate_block_id(),
            block_type: "checklist".to_string(),
            data: serde_json::json!({
                "items": items.iter()
                    .map(|(text, checked)| serde_json::json!({
                        "text": text,
                        "checked": checked
                    }))
                    .collect::<Vec<_>>()
            }),
        });
        items.clear();
    }
}

/// Import a single org file as a Page
fn import_org_file(content: &str, notebook_id: Uuid, fallback_title: &str) -> Page {
    let (metadata, body) = parse_org_metadata(content);
    let blocks = parse_org_to_blocks(&body);

    let now = Utc::now();
    let title = metadata.title.unwrap_or_else(|| {
        // Try first header
        blocks.iter()
            .find(|b| b.block_type == "header")
            .and_then(|b| b.data.get("text"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .unwrap_or_else(|| fallback_title.to_string())
    });

    // Collect tags from metadata and content
    let mut tags = metadata.tags;
    for tag in collect_all_tags(&body) {
        if !tags.contains(&tag) {
            tags.push(tag);
        }
    }

    // Parse date from metadata
    let created_at = metadata.date
        .as_ref()
        .and_then(|d| parse_org_timestamp(d))
        .unwrap_or(now);

    Page {
        id: Uuid::new_v4(),
        notebook_id,
        title,
        content: EditorData {
            time: Some(now.timestamp_millis()),
            version: Some("2.28.0".to_string()),
            blocks,
        },
        tags,
        folder_id: None,
        section_id: None,
        is_archived: false,
        is_cover: false,
        position: 0,
        system_prompt: None,
        created_at,
        updated_at: now,
    }
}

/// Get folder path from relative path
fn get_folder_path(relative_path: &Path) -> Option<String> {
    relative_path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_string_lossy().to_string())
}

/// Preview org-mode files without importing
pub fn preview_orgmode(source_path: &Path) -> Result<OrgmodeImportPreview> {
    let is_single_file = source_path.is_file();

    if is_single_file {
        // Single file import
        if !source_path.extension().map_or(false, |e| e == "org") {
            return Err(StorageError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Not an org-mode file",
            )));
        }

        let content = fs::read_to_string(source_path)?;
        let (metadata, body) = parse_org_metadata(&content);

        // Collect tags from both metadata and content
        let mut tags = metadata.tags.clone();
        for tag in collect_all_tags(&body) {
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }

        let title = metadata.title.unwrap_or_else(|| {
            source_path
                .file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Untitled".to_string())
        });

        let page = OrgmodePagePreview {
            title: title.clone(),
            path: source_path.file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default(),
            tags,
            has_todos: has_todos(&content),
            has_scheduled: has_scheduled(&content),
        };

        return Ok(OrgmodeImportPreview {
            page_count: 1,
            asset_count: 0,
            folder_count: 0,
            nested_depth: 0,
            pages: vec![page],
            suggested_name: title,
            warnings: Vec::new(),
            is_single_file: true,
        });
    }

    // Directory import
    if !source_path.is_dir() {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Path is not a file or directory",
        )));
    }

    let mut page_count = 0;
    let mut asset_count = 0;
    let mut folder_count = 0;
    let mut max_depth = 0;
    let mut pages = Vec::new();
    let mut warnings = Vec::new();

    let suggested_name = source_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Imported Org Files".to_string());

    for entry in WalkDir::new(source_path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        let relative = path.strip_prefix(source_path).unwrap_or(path);

        // Skip hidden files/folders
        if relative.to_string_lossy().contains("/.") {
            continue;
        }

        let depth = relative.components().count();
        if depth > max_depth {
            max_depth = depth;
        }

        if path.is_dir() {
            folder_count += 1;
            continue;
        }

        let extension = path.extension()
            .map(|e| e.to_string_lossy().to_lowercase());

        match extension.as_deref() {
            Some("org") => {
                page_count += 1;

                if pages.len() < 10 {
                    if let Ok(content) = fs::read_to_string(path) {
                        let (metadata, body) = parse_org_metadata(&content);

                        // Collect tags from both metadata and content
                        let mut tags = metadata.tags.clone();
                        for tag in collect_all_tags(&body) {
                            if !tags.contains(&tag) {
                                tags.push(tag);
                            }
                        }

                        let title = metadata.title.unwrap_or_else(|| {
                            path.file_stem()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_else(|| "Untitled".to_string())
                        });

                        pages.push(OrgmodePagePreview {
                            title,
                            path: relative.to_string_lossy().to_string(),
                            tags,
                            has_todos: has_todos(&content),
                            has_scheduled: has_scheduled(&content),
                        });
                    }
                }
            }
            Some("png") | Some("jpg") | Some("jpeg") | Some("gif") | Some("webp") | Some("svg") | Some("pdf") => {
                asset_count += 1;
            }
            _ => {}
        }
    }

    if page_count == 0 {
        warnings.push("No org-mode files found".to_string());
    }

    Ok(OrgmodeImportPreview {
        page_count,
        asset_count,
        folder_count,
        nested_depth: max_depth,
        pages,
        suggested_name,
        warnings,
        is_single_file: false,
    })
}

/// Import org-mode files as a new notebook
pub fn import_orgmode(
    source_path: &Path,
    notebooks_dir: &Path,
    notebook_name: Option<String>,
) -> Result<(Notebook, Vec<Page>)> {
    let is_single_file = source_path.is_file();

    // Collect all org files
    let mut page_infos: Vec<OrgPageInfo> = Vec::new();
    let mut asset_files: Vec<(PathBuf, PathBuf)> = Vec::new();

    if is_single_file {
        if !source_path.extension().map_or(false, |e| e == "org") {
            return Err(StorageError::Io(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Not an org-mode file",
            )));
        }

        let content = fs::read_to_string(source_path)?;
        let (metadata, _) = parse_org_metadata(&content);

        let title = metadata.title.unwrap_or_else(|| {
            source_path
                .file_stem()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Untitled".to_string())
        });

        // Collect tags from both metadata and content
        let mut tags = metadata.tags;
        for tag in collect_all_tags(&content) {
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }

        page_infos.push(OrgPageInfo {
            relative_path: source_path.file_name().map(PathBuf::from).unwrap_or_default(),
            title,
            content,
            tags,
            folder_path: None,
        });
    } else {
        if !source_path.is_dir() {
            return Err(StorageError::Io(std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "Path is not a file or directory",
            )));
        }

        for entry in WalkDir::new(source_path)
            .follow_links(true)
            .into_iter()
            .filter_map(|e| e.ok())
        {
            let path = entry.path();
            let relative = path.strip_prefix(source_path).unwrap_or(path).to_path_buf();

            // Skip hidden files
            if relative.to_string_lossy().contains("/.") {
                continue;
            }

            if path.is_dir() {
                continue;
            }

            let extension = path.extension()
                .map(|e| e.to_string_lossy().to_lowercase());

            match extension.as_deref() {
                Some("org") => {
                    if let Ok(content) = fs::read_to_string(path) {
                        let (metadata, _) = parse_org_metadata(&content);

                        let title = metadata.title.unwrap_or_else(|| {
                            path.file_stem()
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_else(|| "Untitled".to_string())
                        });

                        let mut tags = metadata.tags;
                        for tag in collect_all_tags(&content) {
                            if !tags.contains(&tag) {
                                tags.push(tag);
                            }
                        }

                        let folder_path = get_folder_path(&relative);

                        page_infos.push(OrgPageInfo {
                            relative_path: relative,
                            title,
                            content,
                            tags,
                            folder_path,
                        });
                    }
                }
                Some("png") | Some("jpg") | Some("jpeg") | Some("gif") | Some("webp") | Some("svg") => {
                    asset_files.push((path.to_path_buf(), relative));
                }
                _ => {}
            }
        }
    }

    // Create notebook
    let notebook_id = Uuid::new_v4();
    let notebook_name = notebook_name.unwrap_or_else(|| {
        if is_single_file {
            page_infos.first()
                .map(|p| p.title.clone())
                .unwrap_or_else(|| "Imported Org".to_string())
        } else {
            source_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Imported Org Files".to_string())
        }
    });

    let now = Utc::now();
    let notebook = Notebook {
        id: notebook_id,
        name: notebook_name,
        notebook_type: NotebookType::Standard,
        icon: Some("🦄".to_string()), // Unicorn for org-mode
        color: None,
        sections_enabled: false,
        system_prompt: None,
        ai_provider: None,
        ai_model: None,
        sync_config: None,
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

    // Copy assets and build path mapping
    let assets_dir = notebook_dir.join("assets");
    let mut asset_mapping: HashMap<String, String> = HashMap::new();

    for (source, relative) in &asset_files {
        let filename = relative
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| format!("{}.png", Uuid::new_v4()));

        // Ensure unique filename
        let mut target_filename = filename.clone();
        let mut counter = 1;
        while assets_dir.join(&target_filename).exists() {
            let stem = Path::new(&filename)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            let ext = Path::new(&filename)
                .extension()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "png".to_string());
            target_filename = format!("{}_{}.{}", stem, counter, ext);
            counter += 1;
        }

        let target_path = assets_dir.join(&target_filename);
        fs::copy(source, &target_path)?;

        let new_url = format!("asset://{}/{}", notebook_id, target_filename);
        asset_mapping.insert(relative.to_string_lossy().to_string(), new_url.clone());
        asset_mapping.insert(filename.clone(), new_url.clone());

        if let Some(name) = relative.file_name() {
            asset_mapping.insert(name.to_string_lossy().to_string(), new_url);
        }
    }

    // Process pages
    let mut pages: Vec<Page> = Vec::new();

    for info in page_infos {
        // Update file links in content
        let mut content = info.content.clone();
        for (original, new_url) in &asset_mapping {
            // Replace org file links [[file:image.png]]
            content = content.replace(&format!("[[file:{}]]", original), &format!("[[{}]]", new_url));
            content = content.replace(&format!("[[{}]]", original), &format!("[[{}]]", new_url));
        }

        let mut page = import_org_file(&content, notebook_id, &info.title);
        page.tags = info.tags;

        // Add folder path as tag
        if let Some(folder) = &info.folder_path {
            let folder_tag = format!("folder/{}", folder.replace('/', "-"));
            if !page.tags.contains(&folder_tag) {
                page.tags.push(folder_tag);
            }
        }

        // Save page
        let page_path = notebook_dir.join("pages").join(format!("{}.json", page.id));
        let page_json = serde_json::to_string_pretty(&page)?;
        fs::write(page_path, page_json)?;

        pages.push(page);
    }

    Ok((notebook, pages))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_org_metadata() {
        let content = r#"#+TITLE: Test Document
#+AUTHOR: Test Author
#+DATE: 2024-01-15
#+FILETAGS: :work:project:

* First Header

Some content here.
"#;
        let (metadata, body) = parse_org_metadata(content);

        assert_eq!(metadata.title, Some("Test Document".to_string()));
        assert_eq!(metadata.author, Some("Test Author".to_string()));
        assert!(metadata.tags.contains(&"work".to_string()));
        assert!(metadata.tags.contains(&"project".to_string()));
        assert!(body.contains("* First Header"));
    }

    #[test]
    fn test_extract_header_tags() {
        let line = "* TODO Task title :work:urgent:";
        let tags = extract_header_tags(line);

        assert!(tags.contains(&"work".to_string()));
        assert!(tags.contains(&"urgent".to_string()));
    }

    #[test]
    fn test_extract_todo_state() {
        assert_eq!(extract_todo_state("* TODO Buy groceries"), Some("TODO"));
        assert_eq!(extract_todo_state("** DONE Clean room"), Some("DONE"));
        assert_eq!(extract_todo_state("* Regular header"), None);
    }

    #[test]
    fn test_convert_org_emphasis() {
        let text = "This is *bold* and /italic/ and =code= text.";
        let result = convert_org_emphasis(text);

        assert!(result.contains("<b>bold</b>"));
        assert!(result.contains("<i>italic</i>"));
        assert!(result.contains("<code>code</code>"));
    }

    #[test]
    fn test_convert_org_links() {
        let text = "Check [[https://example.com][Example]] or [[internal-link]].";
        let result = convert_org_links(text);

        assert!(result.contains("<a href=\"https://example.com\">Example</a>"));
        assert!(result.contains("[[internal-link]]")); // Internal links preserved
    }

    #[test]
    fn test_parse_org_to_blocks() {
        let content = r#"* First Header

This is a paragraph.

- Item 1
- Item 2

#+BEGIN_SRC rust
fn main() {
    println!("Hello");
}
#+END_SRC
"#;
        let blocks = parse_org_to_blocks(content);

        let block_types: Vec<&str> = blocks.iter()
            .map(|b| b.block_type.as_str())
            .collect();

        assert!(block_types.contains(&"header"));
        assert!(block_types.contains(&"paragraph"));
        assert!(block_types.contains(&"list"));
        assert!(block_types.contains(&"code"));
    }

    #[test]
    fn test_parse_checklist() {
        let content = r#"- [ ] Unchecked item
- [X] Checked item
"#;
        let blocks = parse_org_to_blocks(content);

        let checklist = blocks.iter()
            .find(|b| b.block_type == "checklist");

        assert!(checklist.is_some());
        let items = checklist.unwrap().data.get("items").unwrap().as_array().unwrap();
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn test_parse_org_timestamp() {
        let ts = parse_org_timestamp("<2024-01-15 Mon>");
        assert!(ts.is_some());

        let ts_with_time = parse_org_timestamp("<2024-01-15 Mon 10:30>");
        assert!(ts_with_time.is_some());

        let inactive = parse_org_timestamp("[2024-01-15 Mon]");
        assert!(inactive.is_some());
    }

    #[test]
    fn test_heading_levels() {
        let content = r#"* Level 1
** Level 2
*** Level 3
**** Level 4
"#;
        let blocks = parse_org_to_blocks(content);

        let headers: Vec<_> = blocks.iter()
            .filter(|b| b.block_type == "header")
            .collect();

        assert_eq!(headers.len(), 4);

        for (i, header) in headers.iter().enumerate() {
            let level = header.data.get("level").unwrap().as_u64().unwrap();
            assert_eq!(level, (i + 1) as u64);
        }
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use tempfile::TempDir;

    #[test]
    fn test_preview_sample_org_file() {
        let temp_dir = TempDir::new().unwrap();
        let org_path = temp_dir.path().join("sample.org");
        
        let content = r#"#+TITLE: Sample Org-Mode Document
#+AUTHOR: Test User
#+DATE: <2024-01-15 Mon>
#+FILETAGS: :test:demo:orgmode:

* Introduction

This is a sample with *bold* and /italic/ text.

* TODO Task List :work:

** TODO Buy groceries :personal:
- [ ] Milk
- [X] Eggs

** DONE Write documentation

#+BEGIN_SRC python
def hello():
    print("Hello!")
#+END_SRC
"#;
        
        fs::write(&org_path, content).unwrap();
        
        let preview = preview_orgmode(&org_path).unwrap();
        
        assert_eq!(preview.page_count, 1);
        assert_eq!(preview.is_single_file, true);
        assert_eq!(preview.pages.len(), 1);
        assert_eq!(preview.pages[0].title, "Sample Org-Mode Document");
        assert!(preview.pages[0].has_todos);
        assert!(preview.pages[0].tags.contains(&"test".to_string()));
        assert!(preview.pages[0].tags.contains(&"work".to_string()));
    }

    #[test]
    fn test_import_sample_org_file() {
        let temp_dir = TempDir::new().unwrap();
        let org_path = temp_dir.path().join("sample.org");
        let notebooks_dir = temp_dir.path().join("notebooks");
        fs::create_dir_all(&notebooks_dir).unwrap();
        
        let content = r#"#+TITLE: Test Import
#+FILETAGS: :imported:

* Header One

Paragraph with *bold* and /italic/.

- List item 1
- List item 2

#+BEGIN_SRC rust
fn main() {}
#+END_SRC
"#;
        
        fs::write(&org_path, content).unwrap();
        
        let (notebook, pages) = import_orgmode(&org_path, &notebooks_dir, None).unwrap();
        
        assert_eq!(notebook.name, "Test Import");
        assert_eq!(pages.len(), 1);
        
        let page = &pages[0];
        assert_eq!(page.title, "Test Import");
        assert!(page.tags.contains(&"imported".to_string()));
        
        // Check blocks
        let blocks = &page.content.blocks;
        let block_types: Vec<&str> = blocks.iter().map(|b| b.block_type.as_str()).collect();
        
        assert!(block_types.contains(&"header"), "Should have header block");
        assert!(block_types.contains(&"paragraph"), "Should have paragraph block");
        assert!(block_types.contains(&"list"), "Should have list block");
        assert!(block_types.contains(&"code"), "Should have code block");
        
        // Check that emphasis was converted
        let para = blocks.iter().find(|b| b.block_type == "paragraph").unwrap();
        let text = para.data.get("text").unwrap().as_str().unwrap();
        assert!(text.contains("<b>bold</b>"), "Bold should be converted");
        assert!(text.contains("<i>italic</i>"), "Italic should be converted");
    }

    #[test]
    fn test_full_sample_org_file() {
        let temp_dir = TempDir::new().unwrap();
        let org_path = temp_dir.path().join("full_sample.org");
        
        let content = r#"#+TITLE: Sample Org-Mode Document
#+AUTHOR: Test User
#+DATE: <2024-01-15 Mon>
#+FILETAGS: :test:demo:orgmode:

* Introduction

This is a sample org-mode document to test the import functionality.

It has *bold text*, /italic text/, =inline code=, and ~verbatim~.

Here's a link: [[https://orgmode.org][Org-mode website]]

* TODO Task List :work:

** TODO Buy groceries :personal:
SCHEDULED: <2024-01-20 Sat>

- [ ] Milk
- [ ] Bread
- [X] Eggs

** DONE Write documentation :writing:
CLOSED: [2024-01-14 Sun 15:30]

Completed the initial documentation draft.

* Code Examples

#+BEGIN_SRC python
def hello_world():
    print("Hello from org-mode!")
#+END_SRC

#+BEGIN_QUOTE
The only way to do great work is to love what you do.
-- Steve Jobs
#+END_QUOTE

-----

/End of document/
"#;
        
        fs::write(&org_path, content).unwrap();
        
        // Test preview
        let preview = preview_orgmode(&org_path).unwrap();
        assert_eq!(preview.page_count, 1);
        assert!(preview.pages[0].has_todos);
        assert!(preview.pages[0].tags.contains(&"test".to_string()));
        assert!(preview.pages[0].tags.contains(&"demo".to_string()));
        assert!(preview.pages[0].tags.contains(&"orgmode".to_string()));
        assert!(preview.pages[0].tags.contains(&"work".to_string()));
        assert!(preview.pages[0].tags.contains(&"personal".to_string()));
        
        // Test import
        let notebooks_dir = temp_dir.path().join("notebooks");
        fs::create_dir_all(&notebooks_dir).unwrap();
        
        let (notebook, pages) = import_orgmode(&org_path, &notebooks_dir, None).unwrap();
        
        assert_eq!(notebook.name, "Sample Org-Mode Document");
        assert_eq!(pages.len(), 1);
        
        let page = &pages[0];
        let blocks = &page.content.blocks;
        let block_types: Vec<&str> = blocks.iter().map(|b| b.block_type.as_str()).collect();
        
        // Should have all the expected block types
        assert!(block_types.contains(&"header"), "Should have headers");
        assert!(block_types.contains(&"paragraph"), "Should have paragraphs");
        assert!(block_types.contains(&"checklist"), "Should have checklist");
        assert!(block_types.contains(&"code"), "Should have code blocks");
        assert!(block_types.contains(&"quote"), "Should have quote blocks");
        assert!(block_types.contains(&"delimiter"), "Should have delimiter (horizontal rule)");
        
        // Check emphasis conversion in paragraph
        let intro_para = blocks.iter()
            .find(|b| b.block_type == "paragraph" && 
                      b.data.get("text").map_or(false, |t| t.as_str().unwrap_or("").contains("bold")))
            .expect("Should find introduction paragraph");
        
        let text = intro_para.data.get("text").unwrap().as_str().unwrap();
        assert!(text.contains("<b>bold text</b>"), "Bold should be converted to HTML");
        assert!(text.contains("<i>italic text</i>"), "Italic should be converted to HTML");
        assert!(text.contains("<code>inline code</code>"), "Code should be converted to HTML");
        
        // Check link conversion
        let link_para = blocks.iter()
            .find(|b| b.block_type == "paragraph" && 
                      b.data.get("text").map_or(false, |t| t.as_str().unwrap_or("").contains("orgmode.org")))
            .expect("Should find link paragraph");
        
        let link_text = link_para.data.get("text").unwrap().as_str().unwrap();
        assert!(link_text.contains("<a href=\"https://orgmode.org\">Org-mode website</a>"), 
                "Links should be converted to HTML");
        
        // Check code block
        let code_block = blocks.iter()
            .find(|b| b.block_type == "code")
            .expect("Should have code block");
        assert_eq!(code_block.data.get("language").unwrap().as_str().unwrap(), "python");
        assert!(code_block.data.get("code").unwrap().as_str().unwrap().contains("hello_world"));
        
        println!("Full sample test passed!");
        println!("Block types found: {:?}", block_types);
        println!("Tags found: {:?}", page.tags);
    }
}
