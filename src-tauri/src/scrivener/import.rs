//! Scrivener .scriv import implementation
//!
//! Converts Scrivener project folders to Katt notebooks.

use std::collections::HashMap;
use std::fs;
use std::path::Path;

use chrono::Utc;
use quick_xml::events::Event;
use quick_xml::Reader;
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::storage::{EditorBlock, EditorData, Notebook, NotebookType, Page, StorageError};

type Result<T> = std::result::Result<T, StorageError>;

/// Preview metadata for a Scrivener import
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrivenerImportPreview {
    /// Number of documents found
    pub document_count: usize,
    /// Number of folders in binder
    pub folder_count: usize,
    /// Sample documents for preview (first 10)
    pub documents: Vec<ScrivenerDocPreview>,
    /// Project title
    pub project_title: String,
    /// Warnings during preview
    pub warnings: Vec<String>,
}

/// Preview info for a single Scrivener document
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScrivenerDocPreview {
    /// Document title
    pub title: String,
    /// Parent folder path
    pub folder_path: Option<String>,
    /// Has content
    pub has_content: bool,
}

/// Internal structure for a Scrivener binder item
#[derive(Debug, Clone)]
struct BinderItem {
    id: String,
    title: String,
    item_type: String, // "Text", "Folder", etc.
    children: Vec<BinderItem>,
}

/// Parse the .scrivx project file
fn parse_scrivx(content: &str) -> Result<(String, Vec<BinderItem>)> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut project_title = String::new();
    let mut binder_items: Vec<BinderItem> = Vec::new();
    let mut item_stack: Vec<BinderItem> = Vec::new();
    let mut current_element = String::new();
    let mut in_binder = false;
    let mut current_id = String::new();
    let mut current_type = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                current_element = name.clone();

                match name.as_str() {
                    "Binder" => {
                        in_binder = true;
                    }
                    "BinderItem" => {
                        // Get attributes
                        let mut id = String::new();
                        let mut item_type = String::new();
                        for attr in e.attributes().filter_map(|a| a.ok()) {
                            let key = String::from_utf8_lossy(attr.key.as_ref()).to_string();
                            let value = String::from_utf8_lossy(&attr.value).to_string();
                            match key.as_str() {
                                "ID" => id = value,
                                "Type" => item_type = value,
                                _ => {}
                            }
                        }
                        current_id = id;
                        current_type = item_type;
                    }
                    "Children" => {
                        // Push current item to stack if we have one
                        if !current_id.is_empty() {
                            item_stack.push(BinderItem {
                                id: current_id.clone(),
                                title: String::new(),
                                item_type: current_type.clone(),
                                children: Vec::new(),
                            });
                            current_id.clear();
                            current_type.clear();
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();

                match name.as_str() {
                    "Binder" => {
                        in_binder = false;
                    }
                    "BinderItem" => {
                        if !current_id.is_empty() {
                            let item = BinderItem {
                                id: current_id.clone(),
                                title: String::new(),
                                item_type: current_type.clone(),
                                children: Vec::new(),
                            };
                            if let Some(parent) = item_stack.last_mut() {
                                parent.children.push(item);
                            } else if in_binder {
                                binder_items.push(item);
                            }
                            current_id.clear();
                            current_type.clear();
                        }
                    }
                    "Children" => {
                        // Pop from stack and add to parent
                        if let Some(item) = item_stack.pop() {
                            if let Some(parent) = item_stack.last_mut() {
                                parent.children.push(item);
                            } else if in_binder {
                                binder_items.push(item);
                            }
                        }
                    }
                    _ => {}
                }
                current_element.clear();
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().unwrap_or_default().to_string();

                if current_element == "Title" {
                    if !current_id.is_empty() {
                        // Update current item's title
                        if let Some(item) = item_stack.last_mut() {
                            if item.title.is_empty() {
                                // Look for the item we're describing
                            }
                        }
                    } else if project_title.is_empty() && !in_binder {
                        project_title = text.clone();
                    }
                    // Store title for the current context
                    if let Some(item) = item_stack.last_mut() {
                        if item.title.is_empty() {
                            item.title = text;
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => {
                return Err(StorageError::Io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("XML parse error: {}", e),
                )));
            }
            _ => {}
        }
        buf.clear();
    }

    if project_title.is_empty() {
        project_title = "Scrivener Project".to_string();
    }

    Ok((project_title, binder_items))
}

/// Extract plain text from RTF content
fn extract_text_from_rtf(rtf: &str) -> String {
    let mut text = String::new();
    let mut in_group = 0;
    let mut skip_group = false;
    let mut chars = rtf.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '{' => {
                in_group += 1;
                // Check if this is a group we should skip
                let mut peek_str = String::new();
                let mut peek_chars = chars.clone();
                while let Some(&pc) = peek_chars.peek() {
                    if pc.is_whitespace() || pc == '\\' || pc == '{' || pc == '}' {
                        break;
                    }
                    peek_str.push(pc);
                    peek_chars.next();
                }
                // Skip font tables, color tables, etc.
                if peek_str.starts_with("\\fonttbl")
                    || peek_str.starts_with("\\colortbl")
                    || peek_str.starts_with("\\stylesheet")
                    || peek_str.starts_with("\\info")
                    || peek_str.starts_with("\\*")
                {
                    skip_group = true;
                }
            }
            '}' => {
                in_group -= 1;
                if in_group == 0 {
                    skip_group = false;
                }
            }
            '\\' => {
                if skip_group {
                    continue;
                }
                // Read control word
                let mut word = String::new();
                while let Some(&nc) = chars.peek() {
                    if nc.is_ascii_alphabetic() {
                        word.push(nc);
                        chars.next();
                    } else {
                        break;
                    }
                }
                // Handle numeric parameter
                let mut _param = String::new();
                while let Some(&nc) = chars.peek() {
                    if nc.is_ascii_digit() || nc == '-' {
                        _param.push(nc);
                        chars.next();
                    } else {
                        break;
                    }
                }
                // Consume trailing space
                if let Some(&' ') = chars.peek() {
                    chars.next();
                }

                // Handle specific control words
                match word.as_str() {
                    "par" | "line" => text.push('\n'),
                    "tab" => text.push('\t'),
                    "" => {
                        // Escaped character
                        if let Some(nc) = chars.next() {
                            match nc {
                                '\\' | '{' | '}' => text.push(nc),
                                '\'' => {
                                    // Hex character
                                    let mut hex = String::new();
                                    if let Some(h1) = chars.next() {
                                        hex.push(h1);
                                    }
                                    if let Some(h2) = chars.next() {
                                        hex.push(h2);
                                    }
                                    if let Ok(byte) = u8::from_str_radix(&hex, 16) {
                                        text.push(byte as char);
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    _ => {}
                }
            }
            '\r' | '\n' => {} // Ignore actual line breaks in RTF
            _ => {
                if !skip_group && in_group > 0 {
                    text.push(c);
                }
            }
        }
    }

    // Clean up the text
    let multi_newline_re = Regex::new(r"\n{3,}").unwrap();
    let text = multi_newline_re.replace_all(&text, "\n\n").to_string();

    text.trim().to_string()
}

/// Generate a block ID
fn generate_block_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", timestamp % 0xFFFFFFFFFF)
}

/// Convert plain text to EditorJS blocks
fn text_to_editor_blocks(text: &str) -> Vec<EditorBlock> {
    let mut blocks = Vec::new();

    for paragraph in text.split("\n\n") {
        let paragraph = paragraph.trim();
        if paragraph.is_empty() {
            continue;
        }

        // Check if it looks like a heading (short and no punctuation at end)
        if paragraph.len() < 60 && !paragraph.ends_with('.') && !paragraph.contains('\n') {
            // Could be a heading, but keep as paragraph for safety
        }

        blocks.push(EditorBlock {
            id: generate_block_id(),
            block_type: "paragraph".to_string(),
            data: serde_json::json!({ "text": paragraph.replace('\n', "<br>") }),
        });
    }

    if blocks.is_empty() {
        blocks.push(EditorBlock {
            id: generate_block_id(),
            block_type: "paragraph".to_string(),
            data: serde_json::json!({ "text": "" }),
        });
    }

    blocks
}

/// Find the .scrivx file in a .scriv folder
fn find_scrivx_file(scriv_path: &Path) -> Option<std::path::PathBuf> {
    // Try common locations
    let project_scrivx = scriv_path.join("project.scrivx");
    if project_scrivx.exists() {
        return Some(project_scrivx);
    }

    // Look in Files/
    let files_dir = scriv_path.join("Files");
    if files_dir.is_dir() {
        for entry in fs::read_dir(&files_dir).ok()? {
            if let Ok(entry) = entry {
                let path = entry.path();
                if path.extension().map(|e| e == "scrivx").unwrap_or(false) {
                    return Some(path);
                }
            }
        }
    }

    // Look in root
    for entry in fs::read_dir(scriv_path).ok()? {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.extension().map(|e| e == "scrivx").unwrap_or(false) {
                return Some(path);
            }
        }
    }

    None
}

/// Find the Docs directory containing RTF files
fn find_docs_dir(scriv_path: &Path) -> Option<std::path::PathBuf> {
    let files_docs = scriv_path.join("Files").join("Docs");
    if files_docs.is_dir() {
        return Some(files_docs);
    }

    let docs = scriv_path.join("Docs");
    if docs.is_dir() {
        return Some(docs);
    }

    None
}

/// Flatten binder items with folder paths
fn flatten_binder_items(
    items: &[BinderItem],
    parent_path: Option<&str>,
    result: &mut Vec<(BinderItem, Option<String>)>,
) {
    for item in items {
        let current_path = if let Some(pp) = parent_path {
            Some(format!("{}/{}", pp, item.title))
        } else if !item.title.is_empty() && item.item_type == "Folder" {
            Some(item.title.clone())
        } else {
            None
        };

        if item.item_type == "Text" {
            result.push((item.clone(), parent_path.map(|s| s.to_string())));
        }

        flatten_binder_items(
            &item.children,
            current_path.as_deref().or(parent_path),
            result,
        );
    }
}

/// Count documents and folders
fn count_items(items: &[BinderItem]) -> (usize, usize) {
    let mut docs = 0;
    let mut folders = 0;

    for item in items {
        match item.item_type.as_str() {
            "Text" => docs += 1,
            "Folder" => folders += 1,
            _ => {}
        }
        let (child_docs, child_folders) = count_items(&item.children);
        docs += child_docs;
        folders += child_folders;
    }

    (docs, folders)
}

/// Preview a Scrivener .scriv project without importing
pub fn preview_scrivener_project(scriv_path: &Path) -> Result<ScrivenerImportPreview> {
    if !scriv_path.is_dir() {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Scrivener project path is not a directory",
        )));
    }

    let mut warnings = Vec::new();

    // Find .scrivx file
    let scrivx_path = find_scrivx_file(scriv_path).ok_or_else(|| {
        StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "No .scrivx file found in project",
        ))
    })?;

    let scrivx_content = fs::read_to_string(&scrivx_path)?;
    let (project_title, binder_items) = parse_scrivx(&scrivx_content)?;

    let (document_count, folder_count) = count_items(&binder_items);

    // Flatten items for preview
    let mut flat_items = Vec::new();
    flatten_binder_items(&binder_items, None, &mut flat_items);

    let documents: Vec<ScrivenerDocPreview> = flat_items
        .iter()
        .take(10)
        .map(|(item, folder_path)| ScrivenerDocPreview {
            title: if item.title.is_empty() {
                "Untitled".to_string()
            } else {
                item.title.clone()
            },
            folder_path: folder_path.clone(),
            has_content: true, // We don't check content in preview
        })
        .collect();

    if document_count == 0 {
        warnings.push("No text documents found in project".to_string());
    }

    // Check for Docs directory
    if find_docs_dir(scriv_path).is_none() {
        warnings.push("Docs directory not found - content may not be imported".to_string());
    }

    Ok(ScrivenerImportPreview {
        document_count,
        folder_count,
        documents,
        project_title,
        warnings,
    })
}

/// Import a Scrivener .scriv project as a new notebook
pub fn import_scrivener_project(
    scriv_path: &Path,
    notebooks_dir: &Path,
    notebook_name: Option<String>,
) -> Result<(Notebook, Vec<Page>)> {
    if !scriv_path.is_dir() {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Scrivener project path is not a directory",
        )));
    }

    // Find .scrivx file
    let scrivx_path = find_scrivx_file(scriv_path).ok_or_else(|| {
        StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "No .scrivx file found in project",
        ))
    })?;

    let scrivx_content = fs::read_to_string(&scrivx_path)?;
    let (project_title, binder_items) = parse_scrivx(&scrivx_content)?;

    // Find Docs directory
    let docs_dir = find_docs_dir(scriv_path);

    // Create notebook
    let notebook_id = Uuid::new_v4();
    let notebook_name = notebook_name.unwrap_or(project_title);

    let now = Utc::now();
    let notebook = Notebook {
        id: notebook_id,
        name: notebook_name,
        notebook_type: NotebookType::Standard,
        icon: Some("📝".to_string()), // Writing icon for Scrivener
        color: None,
        sections_enabled: false,
        archived: false,
        system_prompt: None,
        system_prompt_mode: crate::storage::SystemPromptMode::default(),
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

    // Flatten binder items
    let mut flat_items = Vec::new();
    flatten_binder_items(&binder_items, None, &mut flat_items);

    let mut pages = Vec::new();

    for (item, folder_path) in flat_items {
        // Try to read content from RTF file
        let mut content_text = String::new();

        if let Some(ref docs) = docs_dir {
            // Try various RTF file patterns
            let rtf_path = docs.join(format!("{}.rtf", item.id));
            let txt_path = docs.join(format!("{}.txt", item.id));

            if rtf_path.exists() {
                if let Ok(rtf_content) = fs::read_to_string(&rtf_path) {
                    content_text = extract_text_from_rtf(&rtf_content);
                }
            } else if txt_path.exists() {
                if let Ok(txt_content) = fs::read_to_string(&txt_path) {
                    content_text = txt_content;
                }
            }
        }

        // Convert to EditorJS blocks
        let blocks = text_to_editor_blocks(&content_text);

        // Create page
        let page_id = Uuid::new_v4();
        let title = if item.title.is_empty() {
            "Untitled".to_string()
        } else {
            item.title
        };

        // Add folder path as tag
        let mut tags = Vec::new();
        if let Some(fp) = &folder_path {
            tags.push(format!("folder/{}", fp.replace('/', "-")));
        }

        let page = Page {
            id: page_id,
            notebook_id,
            title,
            content: EditorData {
                time: Some(now.timestamp_millis()),
                blocks,
                version: Some("2.28.0".to_string()),
            },
            tags,
            folder_id: None,
            section_id: None,
            is_archived: false,
            is_cover: false,
            position: pages.len() as i32,
            system_prompt: None,
            system_prompt_mode: crate::storage::SystemPromptMode::default(),
            ai_model: None,
            created_at: now,
            updated_at: now,
        };

        // Save page
        let page_path = notebook_dir.join("pages").join(format!("{}.json", page_id));
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
    fn test_extract_text_from_rtf() {
        let rtf = r"{\rtf1\ansi
{\fonttbl{\f0 Times;}}
\f0 Hello World\par
Second paragraph.\par
}";
        let text = extract_text_from_rtf(rtf);
        assert!(text.contains("Hello World"));
        assert!(text.contains("Second paragraph"));
    }

    #[test]
    fn test_text_to_editor_blocks() {
        let text = "First paragraph.\n\nSecond paragraph.";
        let blocks = text_to_editor_blocks(text);
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0].block_type, "paragraph");
    }
}
