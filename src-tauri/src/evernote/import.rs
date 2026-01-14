//! Evernote .enex import implementation
//!
//! Converts Evernote export files (.enex) to Katt notebooks.

use std::collections::HashMap;
use std::fs;
use std::io::BufReader;
use std::path::{Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::{DateTime, Datelike, NaiveDateTime, Utc};
use quick_xml::events::Event;
use quick_xml::Reader;
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::storage::{EditorBlock, EditorData, Notebook, NotebookType, Page, StorageError};

type Result<T> = std::result::Result<T, StorageError>;

/// Preview metadata for an Evernote import
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvernoteImportPreview {
    /// Number of notes found
    pub note_count: usize,
    /// Number of resources/attachments
    pub resource_count: usize,
    /// Sample notes for preview (first 10)
    pub notes: Vec<EvernoteNotePreview>,
    /// Suggested notebook name
    pub suggested_name: String,
    /// Warnings during preview
    pub warnings: Vec<String>,
}

/// Preview info for a single Evernote note
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvernoteNotePreview {
    /// Note title
    pub title: String,
    /// Tags
    pub tags: Vec<String>,
    /// Has attachments
    pub has_attachments: bool,
    /// Created date (if available)
    pub created: Option<String>,
}

/// Internal structure for a parsed Evernote note
struct EvernoteNote {
    title: String,
    content: String, // HTML content
    tags: Vec<String>,
    created: Option<DateTime<Utc>>,
    updated: Option<DateTime<Utc>>,
    resources: Vec<EvernoteResource>,
}

/// Internal structure for note resources/attachments
struct EvernoteResource {
    data: Vec<u8>,
    mime: String,
    filename: Option<String>,
    hash: Option<String>,
}

/// Parse Evernote date format (YYYYMMDDTHHmmssZ)
fn parse_evernote_date(date_str: &str) -> Option<DateTime<Utc>> {
    // Format: 20231231T235959Z
    let clean = date_str.trim();
    if clean.len() < 15 {
        return None;
    }

    let without_z = clean.trim_end_matches('Z');
    NaiveDateTime::parse_from_str(without_z, "%Y%m%dT%H%M%S")
        .ok()
        .map(|dt| dt.and_utc())
}

/// Convert HTML content to plain text with basic formatting preserved
fn html_to_text(html: &str) -> String {
    let mut text = html.to_string();

    // Remove en-note wrapper and XML declaration
    let en_note_re = Regex::new(r"(?s)<\?xml[^>]*\?>").unwrap();
    text = en_note_re.replace_all(&text, "").to_string();
    let doctype_re = Regex::new(r"(?s)<!DOCTYPE[^>]*>").unwrap();
    text = doctype_re.replace_all(&text, "").to_string();
    let ennote_re = Regex::new(r"(?s)</?en-note[^>]*>").unwrap();
    text = ennote_re.replace_all(&text, "").to_string();

    // Convert block elements to newlines
    let div_re = Regex::new(r"(?i)</?(div|p|br|h[1-6])[^>]*>").unwrap();
    text = div_re.replace_all(&text, "\n").to_string();

    // Handle lists
    let li_re = Regex::new(r"(?i)<li[^>]*>").unwrap();
    text = li_re.replace_all(&text, "\n- ").to_string();
    let ul_ol_re = Regex::new(r"(?i)</?(ul|ol|li)[^>]*>").unwrap();
    text = ul_ol_re.replace_all(&text, "").to_string();

    // Handle checkboxes (en-todo)
    let todo_checked_re = Regex::new(r#"<en-todo\s+checked="true"\s*/>"#).unwrap();
    text = todo_checked_re.replace_all(&text, "[x] ").to_string();
    let todo_unchecked_re = Regex::new(r#"<en-todo[^>]*/>"#).unwrap();
    text = todo_unchecked_re.replace_all(&text, "[ ] ").to_string();

    // Handle en-media (image references)
    let media_re = Regex::new(r#"<en-media[^>]*hash="([^"]+)"[^>]*/>"#).unwrap();
    text = media_re.replace_all(&text, "[image:$1]").to_string();

    // Remove remaining tags
    let tag_re = Regex::new(r"<[^>]+>").unwrap();
    text = tag_re.replace_all(&text, "").to_string();

    // Decode HTML entities
    text = html_escape::decode_html_entities(&text).to_string();

    // Clean up whitespace
    let multi_newline_re = Regex::new(r"\n{3,}").unwrap();
    text = multi_newline_re.replace_all(&text, "\n\n").to_string();

    text.trim().to_string()
}

/// Generate a block ID similar to Editor.js
fn generate_block_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{:x}", timestamp % 0xFFFFFFFFFF)
}

/// Convert plain text to EditorJS blocks
fn text_to_editor_blocks(text: &str, image_map: &HashMap<String, String>) -> Vec<EditorBlock> {
    let mut blocks = Vec::new();
    let mut checklist_items: Vec<serde_json::Value> = Vec::new();
    let mut list_items: Vec<String> = Vec::new();

    let flush_checklist = |blocks: &mut Vec<EditorBlock>, items: &mut Vec<serde_json::Value>| {
        if !items.is_empty() {
            blocks.push(EditorBlock {
                id: generate_block_id(),
                block_type: "checklist".to_string(),
                data: serde_json::json!({ "items": items.clone() }),
            });
            items.clear();
        }
    };

    let flush_list = |blocks: &mut Vec<EditorBlock>, items: &mut Vec<String>| {
        if !items.is_empty() {
            blocks.push(EditorBlock {
                id: generate_block_id(),
                block_type: "list".to_string(),
                data: serde_json::json!({
                    "style": "unordered",
                    "items": items.clone()
                }),
            });
            items.clear();
        }
    };

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            flush_checklist(&mut blocks, &mut checklist_items);
            flush_list(&mut blocks, &mut list_items);
            continue;
        }

        // Check for image reference
        if line.starts_with("[image:") && line.ends_with(']') {
            flush_checklist(&mut blocks, &mut checklist_items);
            flush_list(&mut blocks, &mut list_items);
            let hash = &line[7..line.len() - 1];
            if let Some(url) = image_map.get(hash) {
                blocks.push(EditorBlock {
                    id: generate_block_id(),
                    block_type: "image".to_string(),
                    data: serde_json::json!({
                        "file": { "url": url },
                        "caption": "",
                        "withBorder": false,
                        "stretched": false,
                        "withBackground": false
                    }),
                });
                continue;
            }
        }

        // Check for checklist items
        if line.starts_with("[ ] ") {
            flush_list(&mut blocks, &mut list_items);
            checklist_items.push(serde_json::json!({
                "text": &line[4..],
                "checked": false
            }));
            continue;
        }
        if line.starts_with("[x] ") {
            flush_list(&mut blocks, &mut list_items);
            checklist_items.push(serde_json::json!({
                "text": &line[4..],
                "checked": true
            }));
            continue;
        }

        // Check for list items
        if line.starts_with("- ") {
            flush_checklist(&mut blocks, &mut checklist_items);
            list_items.push(line[2..].to_string());
            continue;
        }

        // Flush any pending items before adding paragraph
        flush_checklist(&mut blocks, &mut checklist_items);
        flush_list(&mut blocks, &mut list_items);

        // Default to paragraph
        blocks.push(EditorBlock {
            id: generate_block_id(),
            block_type: "paragraph".to_string(),
            data: serde_json::json!({ "text": line }),
        });
    }

    // Flush remaining items
    flush_checklist(&mut blocks, &mut checklist_items);
    flush_list(&mut blocks, &mut list_items);

    if blocks.is_empty() {
        blocks.push(EditorBlock {
            id: generate_block_id(),
            block_type: "paragraph".to_string(),
            data: serde_json::json!({ "text": "" }),
        });
    }

    blocks
}

/// Parse ENEX file and extract notes
fn parse_enex(content: &str) -> Result<Vec<EvernoteNote>> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);

    let mut notes = Vec::new();
    let mut buf = Vec::new();

    let mut current_note: Option<EvernoteNote> = None;
    let mut current_resource: Option<EvernoteResource> = None;
    let mut current_element = String::new();
    let mut in_resource = false;
    let mut in_resource_attrs = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                current_element = name.clone();

                match name.as_str() {
                    "note" => {
                        current_note = Some(EvernoteNote {
                            title: String::new(),
                            content: String::new(),
                            tags: Vec::new(),
                            created: None,
                            updated: None,
                            resources: Vec::new(),
                        });
                    }
                    "resource" => {
                        in_resource = true;
                        current_resource = Some(EvernoteResource {
                            data: Vec::new(),
                            mime: String::new(),
                            filename: None,
                            hash: None,
                        });
                    }
                    "resource-attributes" => {
                        in_resource_attrs = true;
                    }
                    _ => {}
                }
            }
            Ok(Event::End(ref e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();

                match name.as_str() {
                    "note" => {
                        if let Some(note) = current_note.take() {
                            notes.push(note);
                        }
                    }
                    "resource" => {
                        if let (Some(note), Some(resource)) =
                            (current_note.as_mut(), current_resource.take())
                        {
                            note.resources.push(resource);
                        }
                        in_resource = false;
                    }
                    "resource-attributes" => {
                        in_resource_attrs = false;
                    }
                    _ => {}
                }
                current_element.clear();
            }
            Ok(Event::Text(e)) => {
                let text = e.unescape().unwrap_or_default().to_string();

                if let Some(note) = current_note.as_mut() {
                    if in_resource {
                        if let Some(resource) = current_resource.as_mut() {
                            match current_element.as_str() {
                                "data" => {
                                    // Base64 decode
                                    if let Ok(decoded) = BASE64.decode(text.trim()) {
                                        resource.data = decoded;
                                    }
                                }
                                "mime" => resource.mime = text,
                                "file-name" if in_resource_attrs => {
                                    resource.filename = Some(text);
                                }
                                _ => {}
                            }
                        }
                    } else {
                        match current_element.as_str() {
                            "title" => note.title = text,
                            "tag" => note.tags.push(text),
                            "created" => note.created = parse_evernote_date(&text),
                            "updated" => note.updated = parse_evernote_date(&text),
                            _ => {}
                        }
                    }
                }
            }
            Ok(Event::CData(e)) => {
                // Content is typically in CDATA
                if current_element == "content" {
                    if let Some(note) = current_note.as_mut() {
                        note.content = String::from_utf8_lossy(&e).to_string();
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

    Ok(notes)
}

/// Preview an Evernote .enex file without importing
pub fn preview_evernote_enex(enex_path: &Path) -> Result<EvernoteImportPreview> {
    if !enex_path.exists() {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "ENEX file not found",
        )));
    }

    let content = fs::read_to_string(enex_path)?;
    let notes = parse_enex(&content)?;

    let mut resource_count = 0;
    let mut preview_notes = Vec::new();
    let mut warnings = Vec::new();

    for (i, note) in notes.iter().enumerate() {
        resource_count += note.resources.len();

        if i < 10 {
            preview_notes.push(EvernoteNotePreview {
                title: note.title.clone(),
                tags: note.tags.clone(),
                has_attachments: !note.resources.is_empty(),
                created: note.created.map(|d| d.to_rfc3339()),
            });
        }
    }

    if notes.is_empty() {
        warnings.push("No notes found in ENEX file".to_string());
    }

    let suggested_name = enex_path
        .file_stem()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Imported from Evernote".to_string());

    Ok(EvernoteImportPreview {
        note_count: notes.len(),
        resource_count,
        notes: preview_notes,
        suggested_name,
        warnings,
    })
}

/// Import an Evernote .enex file as a new notebook
pub fn import_evernote_enex(
    enex_path: &Path,
    notebooks_dir: &Path,
    notebook_name: Option<String>,
) -> Result<(Notebook, Vec<Page>)> {
    if !enex_path.exists() {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "ENEX file not found",
        )));
    }

    let content = fs::read_to_string(enex_path)?;
    let notes = parse_enex(&content)?;

    // Create notebook
    let notebook_id = Uuid::new_v4();
    let notebook_name = notebook_name.unwrap_or_else(|| {
        enex_path
            .file_stem()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Imported from Evernote".to_string())
    });

    let now = Utc::now();
    let notebook = Notebook {
        id: notebook_id,
        name: notebook_name,
        notebook_type: NotebookType::Standard,
        icon: Some("🐘".to_string()), // Elephant for Evernote
        color: None,
        system_prompt: None,
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

    let assets_dir = notebook_dir.join("assets");
    let mut pages = Vec::new();

    for note in notes {
        // Process resources and build hash->url mapping
        let mut image_map: HashMap<String, String> = HashMap::new();

        for resource in &note.resources {
            if resource.data.is_empty() {
                continue;
            }

            // Generate filename
            let ext = match resource.mime.as_str() {
                "image/png" => "png",
                "image/jpeg" => "jpg",
                "image/gif" => "gif",
                "image/webp" => "webp",
                "application/pdf" => "pdf",
                _ => continue, // Skip non-image resources for now
            };

            let filename = resource
                .filename
                .clone()
                .unwrap_or_else(|| format!("{}.{}", Uuid::new_v4(), ext));

            // Ensure unique filename
            let mut target_filename = filename.clone();
            let mut counter = 1;
            while assets_dir.join(&target_filename).exists() {
                let stem = Path::new(&filename)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                target_filename = format!("{}_{}.{}", stem, counter, ext);
                counter += 1;
            }

            // Write asset
            let target_path = assets_dir.join(&target_filename);
            fs::write(&target_path, &resource.data)?;

            // Map hash to asset URL
            let asset_url = format!("asset://{}/{}", notebook_id, target_filename);

            // Create hash if not provided (MD5 of data)
            if let Some(hash) = &resource.hash {
                image_map.insert(hash.clone(), asset_url.clone());
            }
            // Also map by filename
            image_map.insert(filename.clone(), asset_url);
        }

        // Convert HTML content to text
        let text = html_to_text(&note.content);

        // Convert to EditorJS blocks
        let blocks = text_to_editor_blocks(&text, &image_map);

        // Create page
        let page_id = Uuid::new_v4();
        let page = Page {
            id: page_id,
            notebook_id,
            title: if note.title.is_empty() {
                "Untitled".to_string()
            } else {
                note.title
            },
            content: EditorData {
                time: Some(Utc::now().timestamp_millis()),
                blocks,
                version: Some("2.28.0".to_string()),
            },
            tags: note.tags,
            folder_id: None,
            is_archived: false,
            position: 0,
            system_prompt: None,
            created_at: note.created.unwrap_or(now),
            updated_at: note.updated.unwrap_or(now),
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
    fn test_parse_evernote_date() {
        let date = parse_evernote_date("20231231T235959Z");
        assert!(date.is_some());

        let dt = date.unwrap();
        assert_eq!(dt.year(), 2023);
        assert_eq!(dt.month(), 12);
        assert_eq!(dt.day(), 31);
    }

    #[test]
    fn test_html_to_text() {
        let html = "<div>Hello</div><p>World</p>";
        let text = html_to_text(html);
        assert!(text.contains("Hello"));
        assert!(text.contains("World"));
    }

    #[test]
    fn test_html_to_text_with_checklist() {
        let html = r#"<en-todo checked="true"/>Done<br/><en-todo checked="false"/>Not done"#;
        let text = html_to_text(html);
        assert!(text.contains("[x] Done"));
        assert!(text.contains("[ ] Not done"));
    }
}
