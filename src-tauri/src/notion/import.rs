//! Notion import implementation
//!
//! Converts Notion export ZIP files to Nous notebooks.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};

use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use zip::ZipArchive;

use crate::markdown::import_markdown_to_page;
use crate::storage::{FileStorageMode, Notebook, NotebookType, Page, PageType, StorageError};

type Result<T> = std::result::Result<T, StorageError>;

/// Preview metadata for a Notion import
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotionImportPreview {
    /// Number of markdown pages found
    pub page_count: usize,
    /// Number of asset files found
    pub asset_count: usize,
    /// Number of CSV database files found
    pub database_count: usize,
    /// Number of database rows (will become pages)
    pub database_row_count: usize,
    /// Maximum folder nesting depth
    pub nested_depth: usize,
    /// Sample pages for preview (first 10)
    pub pages: Vec<NotionPagePreview>,
    /// Inferred notebook name from ZIP
    pub suggested_name: String,
    /// Warnings during preview (e.g., encoding issues)
    pub warnings: Vec<String>,
}

/// Preview info for a single Notion page
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotionPagePreview {
    /// Cleaned page title (without Notion UUID)
    pub title: String,
    /// Original path in ZIP for context
    pub path: String,
    /// Whether this page has associated images
    pub has_images: bool,
    /// Whether this is from a database CSV
    pub is_database_row: bool,
}

/// Internal structure for tracking pages during import
struct NotionPageInfo {
    /// Original path in the ZIP
    original_path: PathBuf,
    /// Cleaned page title (from H1 header or filename)
    clean_title: String,
    /// The Notion UUID suffix from the filename (e.g., "abc123def456")
    notion_id: Option<String>,
    /// Markdown content (with H1 header removed if title was extracted from it)
    content: String,
    /// Folder path where this page's children would be located (for building hierarchy)
    children_folder_path: Option<String>,
    /// Associated image paths in the ZIP
    images: Vec<(String, String)>, // (original_ref, zip_path)
    /// Whether this is a database (CSV converted to table)
    is_database: bool,
    /// JSON content for database pages (when is_database is true)
    database_json: Option<String>,
}

/// Regex pattern for Notion UUID suffix in filenames
/// Matches patterns like:
/// - "Page Name abc123def456.md"
/// - "Page Name abc123def456"
/// - "Database abc123def456.csv"
fn notion_id_regex() -> Regex {
    Regex::new(r"\s+([a-f0-9]{32})(?:_all)?(?:\.(?:md|csv))?$").unwrap()
}

/// Extract the Notion UUID from a filename
/// "Page Name abc123def456.md" -> Some("abc123def456")
/// "Database abc123def456.csv" -> Some("abc123def456")
fn extract_notion_id(filename: &str) -> Option<String> {
    let re = notion_id_regex();
    re.captures(filename)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

/// Clean a page title by removing the Notion UUID suffix
/// "Page Name abc123def456.md" -> "Page Name"
/// "Database abc123def456.csv" -> "Database"
fn clean_page_title(filename: &str) -> String {
    let re = notion_id_regex();
    re.replace(filename, "").trim().to_string()
}

/// Extract parent page path as tags (skipping the root export directory)
/// "Export Name/Projects abc123/Work def456/Meeting Notes.md" -> ["projects", "work"]
fn extract_parent_tags(path: &Path) -> Vec<String> {
    let mut tags = Vec::new();

    if let Some(parent) = path.parent() {
        let components: Vec<_> = parent.components().collect();
        // Skip the first component (root export directory)
        for component in components.iter().skip(1) {
            if let std::path::Component::Normal(name) = component {
                let name_str = name.to_string_lossy();
                // Clean Notion UUID from directory names
                let clean_name = clean_page_title(&name_str);
                if !clean_name.is_empty() {
                    // Convert to lowercase kebab-case for tags
                    let tag = clean_name
                        .to_lowercase()
                        .replace(' ', "-")
                        .chars()
                        .filter(|c| c.is_alphanumeric() || *c == '-')
                        .collect::<String>();
                    if !tag.is_empty() {
                        tags.push(tag);
                    }
                }
            }
        }
    }

    tags
}

/// Extract title from markdown H1 header and return (title, content_without_h1)
/// If no H1 found, returns None for title
fn extract_title_from_markdown(content: &str) -> (Option<String>, String) {
    let lines: Vec<&str> = content.lines().collect();

    // Find the first non-empty line that's an H1
    for (i, line) in lines.iter().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.starts_with("# ") {
            let title = trimmed[2..].trim().to_string();
            // Remove the H1 line from content
            let remaining: Vec<&str> = lines.iter()
                .enumerate()
                .filter(|(idx, _)| *idx != i)
                .map(|(_, line)| *line)
                .collect();
            let new_content = remaining.join("\n").trim_start().to_string();
            return (Some(title), new_content);
        } else {
            // First non-empty line is not H1, stop looking
            break;
        }
    }

    (None, content.to_string())
}

/// Get the folder path that would contain this page's children
/// For a page at "Export-UUID/Obsolete Grab Bag abc123.md",
/// its children would be in "Export-UUID/Obsolete Grab Bag"
fn get_children_folder_path(md_path: &Path) -> Option<String> {
    let parent_dir = md_path.parent()?;
    let stem = md_path.file_stem()?.to_string_lossy();
    let clean_name = clean_page_title(&stem);

    if clean_name.is_empty() {
        return None;
    }

    let folder_path = parent_dir.join(&clean_name);
    Some(folder_path.to_string_lossy().to_string())
}

/// Get the parent folder path for a file (used to look up the parent page)
/// For a file at "Export-UUID/Obsolete Grab Bag/Waffle abc123.md",
/// returns "Export-UUID/Obsolete Grab Bag"
fn get_parent_folder_path(path: &Path) -> Option<String> {
    let parent = path.parent()?;
    let components: Vec<_> = parent.components().collect();

    // Need at least 2 components to have a parent page (root + parent folder)
    if components.len() < 2 {
        return None;
    }

    Some(parent.to_string_lossy().to_string())
}

/// Get the depth of a page in the hierarchy (0 = root level after export dir)
fn get_page_depth(path: &Path) -> usize {
    let components: Vec<_> = path.parent()
        .map(|p| p.components().collect())
        .unwrap_or_default();
    // Subtract 1 for the root export directory
    components.len().saturating_sub(1)
}

/// Format a cell value for markdown table
/// If the column is "Tags", format individual tags with inline code
fn format_cell_value(value: &str, header: &str) -> String {
    let cleaned = value
        .replace('|', "\\|")  // Escape pipes in content
        .replace('\n', " ");  // Replace newlines

    // Check if this is a Tags column (case insensitive)
    if header.eq_ignore_ascii_case("tags") && !cleaned.is_empty() {
        // Split by comma and format each tag with inline code
        cleaned
            .split(',')
            .map(|tag| tag.trim())
            .filter(|tag| !tag.is_empty())
            .map(|tag| format!("`{}`", tag))
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        cleaned
    }
}

/// Convert CSV content to a markdown table
fn csv_to_markdown_table(csv_content: &str, database_name: &str) -> String {
    let mut output = format!("# {}\n\n", database_name);

    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(csv_content.as_bytes());

    let headers: Vec<String> = match reader.headers() {
        Ok(h) => h.iter().map(|s| s.to_string()).collect(),
        Err(_) => return output,
    };

    if headers.is_empty() {
        return output;
    }

    // Build markdown table header
    output.push_str("| ");
    output.push_str(&headers.join(" | "));
    output.push_str(" |\n");

    // Separator row
    output.push_str("| ");
    output.push_str(&headers.iter().map(|_| "---").collect::<Vec<_>>().join(" | "));
    output.push_str(" |\n");

    // Data rows
    for result in reader.records() {
        if let Ok(record) = result {
            output.push_str("| ");
            let cells: Vec<String> = (0..headers.len())
                .map(|i| {
                    let value = record.get(i).unwrap_or("");
                    let header = headers.get(i).map(|s| s.as_str()).unwrap_or("");
                    format_cell_value(value, header)
                })
                .collect();
            output.push_str(&cells.join(" | "));
            output.push_str(" |\n");
        }
    }

    output
}

/// Convert Notion internal links to wiki-links
/// "[My Page](My%20Page%20abc123.md)" -> "[[My Page]]"
fn convert_links_to_wikilinks(markdown: &str, title_mapping: &HashMap<String, String>) -> String {
    // Match markdown links that point to .md files
    let link_re = Regex::new(r"\[([^\]]+)\]\(([^)]+\.md)\)").unwrap();

    link_re.replace_all(markdown, |caps: &regex::Captures| {
        let link_text = &caps[1];
        let href = &caps[2];

        // URL-decode the href
        let decoded_href = urlencoding::decode(href)
            .map(|s| s.into_owned())
            .unwrap_or_else(|_| href.to_string());

        // Extract just the filename (handle paths)
        let filename = Path::new(&decoded_href)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or(decoded_href.clone());

        // Look up the clean title
        if let Some(clean_title) = title_mapping.get(&filename) {
            format!("[[{}]]", clean_title)
        } else {
            // Try to clean the title from the href itself
            let clean_title = clean_page_title(&filename);
            if !clean_title.is_empty() {
                format!("[[{}]]", clean_title)
            } else {
                // Keep original link text as wiki-link
                format!("[[{}]]", link_text)
            }
        }
    }).to_string()
}

/// Infer the property type from a column of values
fn infer_property_type(header: &str, values: &[String]) -> &'static str {
    let header_lower = header.to_lowercase();

    // Tags columns -> multiSelect
    if header_lower == "tags" || header_lower == "labels" || header_lower == "categories" {
        return "multiSelect";
    }

    // Check values to infer type
    let non_empty: Vec<&str> = values.iter().map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
    if non_empty.is_empty() {
        return "text";
    }

    // Check if all non-empty values are booleans
    let all_bool = non_empty.iter().all(|v| {
        let lower = v.to_lowercase();
        lower == "true" || lower == "false" || lower == "yes" || lower == "no"
    });
    if all_bool {
        return "checkbox";
    }

    // Check if all non-empty values are numeric
    let all_numeric = non_empty.iter().all(|v| v.parse::<f64>().is_ok());
    if all_numeric {
        return "number";
    }

    // Check if all non-empty values look like URLs
    let all_urls = non_empty.iter().all(|v| v.starts_with("http://") || v.starts_with("https://"));
    if all_urls {
        return "url";
    }

    // Check if all non-empty values look like dates (YYYY-MM-DD or similar)
    let date_re = regex::Regex::new(r"^\d{4}-\d{2}-\d{2}").unwrap();
    let all_dates = non_empty.iter().all(|v| date_re.is_match(v));
    if all_dates {
        return "date";
    }

    "text"
}

/// Convert CSV content to a database JSON string (DatabaseContent format)
fn csv_to_database_content(csv_content: &str) -> Option<String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(csv_content.as_bytes());

    let headers: Vec<String> = match reader.headers() {
        Ok(h) => h.iter().map(|s| s.to_string()).collect(),
        Err(_) => return None,
    };

    if headers.is_empty() {
        return None;
    }

    // Read all records first to infer types
    let records: Vec<Vec<String>> = reader.records()
        .filter_map(|r| r.ok())
        .map(|r| (0..headers.len()).map(|i| r.get(i).unwrap_or("").to_string()).collect())
        .collect();

    // Infer column types
    let mut properties = Vec::new();
    let select_colors = [
        "#ef4444", "#f97316", "#eab308", "#22c55e", "#06b6d4",
        "#3b82f6", "#8b5cf6", "#ec4899", "#6b7280", "#a855f7",
    ];

    for (col_idx, header) in headers.iter().enumerate() {
        let col_values: Vec<String> = records.iter().map(|r| r[col_idx].clone()).collect();
        let prop_type = infer_property_type(header, &col_values);
        let prop_id = uuid::Uuid::new_v4().to_string();

        // Build options for select/multiSelect columns
        let options = if prop_type == "select" || prop_type == "multiSelect" {
            let mut unique_labels: Vec<String> = Vec::new();
            for val in &col_values {
                if prop_type == "multiSelect" {
                    for tag in val.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
                        if !unique_labels.contains(&tag) {
                            unique_labels.push(tag);
                        }
                    }
                } else if !val.trim().is_empty() && !unique_labels.contains(&val.trim().to_string()) {
                    unique_labels.push(val.trim().to_string());
                }
            }
            let opts: Vec<serde_json::Value> = unique_labels.iter().enumerate().map(|(i, label)| {
                serde_json::json!({
                    "id": uuid::Uuid::new_v4().to_string(),
                    "label": label,
                    "color": select_colors[i % select_colors.len()]
                })
            }).collect();
            Some(opts)
        } else {
            None
        };

        let mut prop = serde_json::json!({
            "id": prop_id,
            "name": header,
            "type": prop_type,
        });
        if let Some(opts) = &options {
            prop["options"] = serde_json::Value::Array(opts.clone());
        }
        properties.push((prop_id, prop_type.to_string(), prop, options));
    }

    // Build rows
    let now = chrono::Utc::now().to_rfc3339();
    let mut rows = Vec::new();
    for record in &records {
        let mut cells = serde_json::Map::new();
        for (col_idx, (prop_id, prop_type, _prop_json, options)) in properties.iter().enumerate() {
            let raw_value = &record[col_idx];
            let cell_value = match prop_type.as_str() {
                "number" => {
                    if raw_value.trim().is_empty() {
                        serde_json::Value::Null
                    } else {
                        match raw_value.trim().parse::<f64>() {
                            Ok(n) => serde_json::json!(n),
                            Err(_) => serde_json::Value::Null,
                        }
                    }
                }
                "checkbox" => {
                    let lower = raw_value.trim().to_lowercase();
                    serde_json::json!(lower == "true" || lower == "yes")
                }
                "multiSelect" => {
                    // Map labels to option IDs
                    let tags: Vec<String> = raw_value.split(',')
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty())
                        .collect();
                    let opt_ids: Vec<serde_json::Value> = if let Some(opts) = options {
                        tags.iter().filter_map(|tag| {
                            opts.iter().find(|o| o.get("label").and_then(|l| l.as_str()) == Some(tag))
                                .and_then(|o| o.get("id").cloned())
                        }).collect()
                    } else {
                        Vec::new()
                    };
                    serde_json::Value::Array(opt_ids)
                }
                "select" => {
                    // Map label to option ID
                    if raw_value.trim().is_empty() {
                        serde_json::Value::Null
                    } else if let Some(opts) = options {
                        opts.iter()
                            .find(|o| o.get("label").and_then(|l| l.as_str()) == Some(raw_value.trim()))
                            .and_then(|o| o.get("id").cloned())
                            .unwrap_or(serde_json::Value::Null)
                    } else {
                        serde_json::Value::Null
                    }
                }
                "date" => {
                    if raw_value.trim().is_empty() {
                        serde_json::Value::Null
                    } else {
                        // Take just the date part (YYYY-MM-DD)
                        let date_str = raw_value.trim();
                        if date_str.len() >= 10 {
                            serde_json::json!(&date_str[..10])
                        } else {
                            serde_json::json!(date_str)
                        }
                    }
                }
                _ => {
                    // text, url
                    if raw_value.trim().is_empty() {
                        serde_json::Value::Null
                    } else {
                        serde_json::json!(raw_value.trim())
                    }
                }
            };
            cells.insert(prop_id.clone(), cell_value);
        }

        rows.push(serde_json::json!({
            "id": uuid::Uuid::new_v4().to_string(),
            "cells": cells,
            "createdAt": now,
            "updatedAt": now,
        }));
    }

    // Build final DatabaseContent (v2 with views)
    let property_defs: Vec<serde_json::Value> = properties.iter().map(|(_, _, p, _)| p.clone()).collect();
    let db_content = serde_json::json!({
        "version": 2,
        "properties": property_defs,
        "rows": rows,
        "views": [{
            "id": uuid::Uuid::new_v4().to_string(),
            "name": "Table",
            "type": "table",
            "sorts": [],
            "filters": [],
            "config": {},
        }],
    });

    serde_json::to_string_pretty(&db_content).ok()
}

/// Parse a CSV database file and return a single page info with a table
fn parse_database_csv(
    csv_content: &str,
    database_name: &str,
    database_path: &Path,
) -> Option<NotionPageInfo> {
    // Convert CSV to markdown table (fallback content)
    let content = csv_to_markdown_table(csv_content, database_name);

    // Also generate structured database JSON
    let database_json = csv_to_database_content(csv_content);

    // Extract notion ID from the database filename
    let filename = database_path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    let notion_id = extract_notion_id(&filename);

    // Database pages can also have children (though rare)
    let children_folder_path = get_children_folder_path(database_path);

    Some(NotionPageInfo {
        original_path: database_path.to_path_buf(),
        clean_title: database_name.to_string(),
        notion_id,
        content,
        children_folder_path,
        images: Vec::new(),
        is_database: true,
        database_json,
    })
}

/// Preview a Notion export ZIP without importing
pub fn preview_notion_import(zip_path: &Path) -> Result<NotionImportPreview> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;

    let mut page_count = 0;
    let mut asset_count = 0;
    let mut database_count = 0;
    let mut max_depth = 0;
    let mut pages = Vec::new();
    let warnings = Vec::new();
    let mut suggested_name = String::new();

    // Track which files have associated image folders
    let mut folders: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut csv_indices: Vec<(usize, String, PathBuf)> = Vec::new();

    // First pass: catalog all files (just names, no content reading)
    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_string();
        drop(file); // Release the borrow immediately

        // Track folders
        if name.ends_with('/') {
            let folder_name = name.trim_end_matches('/');
            folders.insert(folder_name.to_string());
            continue;
        }

        let path = Path::new(&name);
        let depth = path.components().count();
        if depth > max_depth {
            max_depth = depth;
        }

        // Infer notebook name from root folder or ZIP name
        if suggested_name.is_empty() {
            if let Some(first) = path.components().next() {
                if let std::path::Component::Normal(n) = first {
                    suggested_name = clean_page_title(&n.to_string_lossy());
                }
            }
        }

        let extension = path.extension()
            .map(|e| e.to_string_lossy().to_lowercase());

        match extension.as_deref() {
            Some("md") => {
                page_count += 1;

                if pages.len() < 10 {
                    let title = path.file_name()
                        .map(|n| clean_page_title(&n.to_string_lossy()))
                        .unwrap_or_else(|| "Untitled".to_string());

                    pages.push(NotionPagePreview {
                        title,
                        path: name.clone(),
                        has_images: false, // Will update later
                        is_database_row: false,
                    });
                }
            }
            Some("csv") => {
                // Skip _all CSV files - use the regular CSV files
                // Some Notion exports don't have _all versions
                if !name.contains("_all.csv") {
                    database_count += 1;
                    csv_indices.push((i, name.clone(), path.to_path_buf()));
                }
            }
            Some("png") | Some("jpg") | Some("jpeg") | Some("gif") | Some("webp") | Some("svg") => {
                asset_count += 1;
            }
            _ => {}
        }
    }

    // Second pass: read CSV files to count rows
    let mut database_row_count = 0;
    for (idx, name, path) in csv_indices {
        let mut file = archive.by_index(idx)?;
        let mut content = String::new();
        if file.read_to_string(&mut content).is_ok() {
            let row_count = content.lines().count().saturating_sub(1); // Subtract header
            database_row_count += row_count;

            // Add preview entries for database rows
            let db_name = path.file_stem()
                .map(|n| clean_page_title(&n.to_string_lossy()))
                .unwrap_or_else(|| "Database".to_string());

            if pages.len() < 10 && row_count > 0 {
                pages.push(NotionPagePreview {
                    title: format!("{} (Database - {} rows)", db_name, row_count),
                    path: name.clone(),
                    has_images: false,
                    is_database_row: true,
                });
            }
        }
    }

    // Update has_images for pages that have associated folders
    for page in &mut pages {
        let md_path = Path::new(&page.path);
        if let Some(stem) = md_path.file_stem() {
            let folder_name = md_path.parent()
                .map(|p| p.join(stem.to_string_lossy().to_string()))
                .map(|p| p.to_string_lossy().to_string());

            if let Some(folder) = folder_name {
                page.has_images = folders.contains(&folder);
            }
        }
    }

    // Fallback name from ZIP filename
    if suggested_name.is_empty() {
        suggested_name = zip_path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Imported Notebook".to_string());
    }

    Ok(NotionImportPreview {
        page_count,
        asset_count,
        database_count,
        database_row_count,
        nested_depth: max_depth,
        pages,
        suggested_name,
        warnings,
    })
}

/// Import a Notion export ZIP as a new notebook
pub fn import_notion_zip(
    zip_path: &Path,
    notebooks_dir: &Path,
    notebook_name: Option<String>,
) -> Result<(Notebook, Vec<Page>)> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;

    // First pass: build title mapping and collect page info
    let mut title_mapping: HashMap<String, String> = HashMap::new();
    let mut page_infos: Vec<NotionPageInfo> = Vec::new();
    let mut asset_files: HashMap<String, Vec<u8>> = HashMap::new();
    let mut suggested_name = String::new();

    // Collect all file info first
    let mut md_files: Vec<(usize, String)> = Vec::new();
    let mut csv_files: Vec<(usize, String)> = Vec::new();
    let mut image_files: Vec<(usize, String)> = Vec::new();

    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_string();
        drop(file); // Release borrow immediately

        if name.ends_with('/') {
            continue;
        }

        let path = Path::new(&name);
        let extension = path.extension()
            .map(|e| e.to_string_lossy().to_lowercase());

        // Infer name from first folder
        if suggested_name.is_empty() {
            if let Some(first) = path.components().next() {
                if let std::path::Component::Normal(n) = first {
                    suggested_name = clean_page_title(&n.to_string_lossy());
                }
            }
        }

        match extension.as_deref() {
            Some("md") => md_files.push((i, name)),
            Some("csv") => {
                // Skip _all CSV files - use the regular CSV files
                // Some Notion exports don't have _all versions
                if !name.contains("_all.csv") {
                    csv_files.push((i, name));
                }
            }
            Some("png") | Some("jpg") | Some("jpeg") | Some("gif") | Some("webp") | Some("svg") => {
                image_files.push((i, name));
            }
            _ => {}
        }
    }

    // Process markdown files and build title mapping
    for (idx, name) in &md_files {
        let path = Path::new(name);
        let filename = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let notion_id = extract_notion_id(&filename);
        let filename_title = clean_page_title(&filename);

        // Read content as bytes first, then convert
        let mut file = archive.by_index(*idx)?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        drop(file); // Release borrow

        let raw_content = String::from_utf8(bytes)
            .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).to_string());

        // Extract title from H1 header, fall back to filename
        let (h1_title, content) = extract_title_from_markdown(&raw_content);
        let clean_title = h1_title.unwrap_or(filename_title.clone());

        // Build title mapping for link conversion
        title_mapping.insert(filename.clone(), clean_title.clone());
        title_mapping.insert(name.clone(), clean_title.clone());

        // Find associated images
        let images = find_associated_images(path, &image_files);

        // Get the folder path where this page's children would be located
        let children_folder_path = get_children_folder_path(path);

        page_infos.push(NotionPageInfo {
            original_path: path.to_path_buf(),
            clean_title,
            notion_id,
            content,
            children_folder_path,
            images,
            is_database: false,
            database_json: None,
        });
    }

    // Process CSV database files (convert to pages with tables)
    for (idx, name) in &csv_files {
        let path = Path::new(name);
        let db_name = path.file_stem()
            .map(|n| clean_page_title(&n.to_string_lossy()))
            .unwrap_or_else(|| "Database".to_string());

        let mut file = archive.by_index(*idx)?;
        let mut csv_content = String::new();
        if file.read_to_string(&mut csv_content).is_ok() {
            if let Some(db_page) = parse_database_csv(&csv_content, &db_name, path) {
                // Add to title mapping
                title_mapping.insert(
                    format!("{}.csv", db_page.clean_title),
                    db_page.clean_title.clone(),
                );
                page_infos.push(db_page);
            }
        }
    }

    // Read all image files into memory
    for (idx, name) in &image_files {
        let mut file = archive.by_index(*idx)?;
        let mut bytes = Vec::new();
        if file.read_to_end(&mut bytes).is_ok() {
            asset_files.insert(name.clone(), bytes);
        }
    }

    // Create the notebook
    let notebook_id = Uuid::new_v4();
    let notebook_name = notebook_name.unwrap_or_else(|| {
        if suggested_name.is_empty() {
            zip_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Imported Notebook".to_string())
        } else {
            suggested_name.clone()
        }
    });

    let now = Utc::now();
    let notebook = Notebook {
        id: notebook_id,
        name: notebook_name,
        notebook_type: NotebookType::Standard,
        icon: Some("📥".to_string()),
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
        cover_image: None,
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

    // Copy assets to notebook assets folder
    let assets_dir = notebook_dir.join("assets");
    let mut asset_path_mapping: HashMap<String, String> = HashMap::new();

    for (original_path, bytes) in &asset_files {
        let filename = Path::new(original_path)
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
        fs::write(&target_path, bytes)?;

        // Map original path to new asset URL
        asset_path_mapping.insert(
            original_path.clone(),
            format!("asset://{}/{}", notebook_id, target_filename),
        );
    }

    // Sort pages by depth (parent pages first) to ensure parents are created before children
    page_infos.sort_by(|a, b| {
        let depth_a = get_page_depth(&a.original_path);
        let depth_b = get_page_depth(&b.original_path);
        depth_a.cmp(&depth_b)
    });

    // Build a map of folder_path -> notion_id for looking up parent pages
    // This maps the folder that would contain children to the notion_id of the parent page
    let mut folder_to_notion_id: HashMap<String, String> = HashMap::new();
    for info in &page_infos {
        if let (Some(ref folder_path), Some(ref notion_id)) = (&info.children_folder_path, &info.notion_id) {
            folder_to_notion_id.insert(folder_path.clone(), notion_id.clone());
        }
    }

    // Process pages and build notion_id -> page.id mapping
    let mut pages: Vec<Page> = Vec::new();
    let mut notion_to_nous_id: HashMap<String, Uuid> = HashMap::new();

    for info in page_infos {
        // Convert internal links to wiki-links
        let mut content = convert_links_to_wikilinks(&info.content, &title_mapping);

        // Update image references
        for (original_ref, zip_path) in &info.images {
            if let Some(new_url) = asset_path_mapping.get(zip_path) {
                // Replace various forms of the reference
                content = content.replace(original_ref, new_url);

                // Also try URL-encoded version
                let encoded = urlencoding::encode(original_ref);
                content = content.replace(&encoded.to_string(), new_url);
            }
        }

        // Get tags from parent path (skip root export directory)
        let mut tags = extract_parent_tags(&info.original_path);

        // Add "database" tag if this is a database
        if info.is_database && !tags.contains(&"database".to_string()) {
            tags.push("database".to_string());
        }

        // Create page — either as database page or standard markdown page
        let mut page = if let Some(ref db_json) = info.database_json {
            // Create as a database page type
            let mut p = Page::new(notebook_id, info.clean_title.clone());
            p.page_type = PageType::Database;
            p.file_extension = Some("database".to_string());
            p.storage_mode = Some(FileStorageMode::Embedded);
            p.source_file = Some(format!("files/{}.database", p.id));

            // Write the database content file
            let files_dir = notebook_dir.join("files");
            fs::create_dir_all(&files_dir)?;
            fs::write(files_dir.join(format!("{}.database", p.id)), db_json)?;

            p
        } else {
            // Standard markdown import
            import_markdown_to_page(&content, notebook_id, &info.clean_title)
        };
        page.tags = tags;

        // Set parent_page_id based on the folder -> notion_id -> nous_id mapping
        if let Some(parent_folder) = get_parent_folder_path(&info.original_path) {
            if let Some(parent_notion_id) = folder_to_notion_id.get(&parent_folder) {
                if let Some(&parent_page_id) = notion_to_nous_id.get(parent_notion_id) {
                    page.parent_page_id = Some(parent_page_id);
                }
            }
        }

        // Track this page's notion_id for child pages
        if let Some(ref notion_id) = info.notion_id {
            notion_to_nous_id.insert(notion_id.clone(), page.id);
        }

        // Save page
        let page_path = notebook_dir.join("pages").join(format!("{}.json", page.id));
        let page_json = serde_json::to_string_pretty(&page)?;
        fs::write(page_path, page_json)?;

        pages.push(page);
    }

    Ok((notebook, pages))
}

/// Import a Notion export ZIP as a new notebook with progress reporting
pub fn import_notion_zip_with_progress<F>(
    zip_path: &Path,
    notebooks_dir: &Path,
    notebook_name: Option<String>,
    progress: F,
) -> Result<(Notebook, Vec<Page>)>
where
    F: Fn(usize, usize, &str),
{
    progress(0, 100, "Opening ZIP file...");

    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;

    progress(5, 100, "Scanning files...");

    // First pass: build title mapping and collect page info
    let mut title_mapping: HashMap<String, String> = HashMap::new();
    let mut page_infos: Vec<NotionPageInfo> = Vec::new();
    let mut asset_files: HashMap<String, Vec<u8>> = HashMap::new();
    let mut suggested_name = String::new();

    // Collect all file info first
    let mut md_files: Vec<(usize, String)> = Vec::new();
    let mut csv_files: Vec<(usize, String)> = Vec::new();
    let mut image_files: Vec<(usize, String)> = Vec::new();

    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name().to_string();
        drop(file);

        if name.ends_with('/') {
            continue;
        }

        let path = Path::new(&name);
        let extension = path.extension()
            .map(|e| e.to_string_lossy().to_lowercase());

        if suggested_name.is_empty() {
            if let Some(first) = path.components().next() {
                if let std::path::Component::Normal(n) = first {
                    suggested_name = clean_page_title(&n.to_string_lossy());
                }
            }
        }

        match extension.as_deref() {
            Some("md") => md_files.push((i, name)),
            Some("csv") => {
                // Skip _all CSV files - use the regular CSV files
                // Some Notion exports don't have _all versions
                if !name.contains("_all.csv") {
                    csv_files.push((i, name));
                }
            }
            Some("png") | Some("jpg") | Some("jpeg") | Some("gif") | Some("webp") | Some("svg") => {
                image_files.push((i, name));
            }
            _ => {}
        }
    }

    progress(10, 100, "Processing markdown files...");

    // Process markdown files and build title mapping
    let total_md = md_files.len();
    for (file_idx, (idx, name)) in md_files.iter().enumerate() {
        if file_idx % 10 == 0 {
            progress(
                10 + (file_idx * 10) / total_md.max(1),
                100,
                &format!("Reading pages ({}/{})", file_idx + 1, total_md),
            );
        }

        let path = Path::new(name);
        let filename = path.file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let notion_id = extract_notion_id(&filename);
        let filename_title = clean_page_title(&filename);

        let mut file = archive.by_index(*idx)?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        drop(file);

        let raw_content = String::from_utf8(bytes)
            .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).to_string());

        // Extract title from H1 header, fall back to filename
        let (h1_title, content) = extract_title_from_markdown(&raw_content);
        let clean_title = h1_title.unwrap_or(filename_title.clone());

        // Build title mapping for link conversion
        title_mapping.insert(filename.clone(), clean_title.clone());
        title_mapping.insert(name.clone(), clean_title.clone());

        let images = find_associated_images(path, &image_files);

        // Get the folder path where this page's children would be located
        let children_folder_path = get_children_folder_path(path);

        page_infos.push(NotionPageInfo {
            original_path: path.to_path_buf(),
            clean_title,
            notion_id,
            content,
            children_folder_path,
            images,
            is_database: false,
            database_json: None,
        });
    }

    progress(20, 100, "Processing databases...");

    // Process CSV database files (convert to pages with tables)
    let total_csv = csv_files.len();
    for (file_idx, (idx, name)) in csv_files.iter().enumerate() {
        if total_csv > 0 {
            progress(
                20 + (file_idx * 5) / total_csv.max(1),
                100,
                &format!("Reading databases ({}/{})", file_idx + 1, total_csv),
            );
        }

        let path = Path::new(name);
        let db_name = path.file_stem()
            .map(|n| clean_page_title(&n.to_string_lossy()))
            .unwrap_or_else(|| "Database".to_string());

        let mut file = archive.by_index(*idx)?;
        let mut csv_content = String::new();
        if file.read_to_string(&mut csv_content).is_ok() {
            if let Some(db_page) = parse_database_csv(&csv_content, &db_name, path) {
                title_mapping.insert(
                    format!("{}.csv", db_page.clean_title),
                    db_page.clean_title.clone(),
                );
                page_infos.push(db_page);
            }
        }
    }

    progress(25, 100, "Reading assets...");

    // Read all image files into memory
    let total_images = image_files.len();
    for (file_idx, (idx, name)) in image_files.iter().enumerate() {
        if file_idx % 20 == 0 {
            progress(
                25 + (file_idx * 15) / total_images.max(1),
                100,
                &format!("Reading assets ({}/{})", file_idx + 1, total_images),
            );
        }

        let mut file = archive.by_index(*idx)?;
        let mut bytes = Vec::new();
        if file.read_to_end(&mut bytes).is_ok() {
            asset_files.insert(name.clone(), bytes);
        }
    }

    progress(40, 100, "Creating notebook...");

    // Create the notebook
    let notebook_id = Uuid::new_v4();
    let notebook_name = notebook_name.unwrap_or_else(|| {
        if suggested_name.is_empty() {
            zip_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Imported Notebook".to_string())
        } else {
            suggested_name.clone()
        }
    });

    let now = Utc::now();
    let notebook = Notebook {
        id: notebook_id,
        name: notebook_name,
        notebook_type: NotebookType::Standard,
        icon: Some("📥".to_string()),
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
        cover_image: None,
        created_at: now,
        updated_at: now,
    };

    let notebook_dir = notebooks_dir.join(notebook_id.to_string());
    fs::create_dir_all(&notebook_dir)?;
    fs::create_dir_all(notebook_dir.join("pages"))?;
    fs::create_dir_all(notebook_dir.join("assets"))?;

    let notebook_json = serde_json::to_string_pretty(&notebook)?;
    fs::write(notebook_dir.join("notebook.json"), notebook_json)?;

    progress(45, 100, "Copying assets...");

    // Copy assets to notebook assets folder
    let assets_dir = notebook_dir.join("assets");
    let mut asset_path_mapping: HashMap<String, String> = HashMap::new();
    let total_assets = asset_files.len();

    for (asset_idx, (original_path, bytes)) in asset_files.iter().enumerate() {
        if asset_idx % 20 == 0 {
            progress(
                45 + (asset_idx * 15) / total_assets.max(1),
                100,
                &format!("Copying assets ({}/{})", asset_idx + 1, total_assets),
            );
        }

        let filename = Path::new(original_path)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| format!("{}.png", Uuid::new_v4()));

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
        fs::write(&target_path, bytes)?;

        asset_path_mapping.insert(
            original_path.clone(),
            format!("asset://{}/{}", notebook_id, target_filename),
        );
    }

    progress(60, 100, "Sorting pages...");

    // Sort pages by depth (parent pages first) to ensure parents are created before children
    page_infos.sort_by(|a, b| {
        let depth_a = get_page_depth(&a.original_path);
        let depth_b = get_page_depth(&b.original_path);
        depth_a.cmp(&depth_b)
    });

    // Build a map of folder_path -> notion_id for looking up parent pages
    let mut folder_to_notion_id: HashMap<String, String> = HashMap::new();
    for info in &page_infos {
        if let (Some(ref folder_path), Some(ref notion_id)) = (&info.children_folder_path, &info.notion_id) {
            folder_to_notion_id.insert(folder_path.clone(), notion_id.clone());
        }
    }

    progress(62, 100, "Importing pages...");

    // Process pages and build notion_id -> page.id mapping
    let mut pages: Vec<Page> = Vec::new();
    let mut notion_to_nous_id: HashMap<String, Uuid> = HashMap::new();
    let total_pages = page_infos.len();

    for (page_idx, info) in page_infos.into_iter().enumerate() {
        if page_idx % 5 == 0 {
            progress(
                62 + (page_idx * 38) / total_pages.max(1),
                100,
                &format!("Importing pages ({}/{})", page_idx + 1, total_pages),
            );
        }

        // Convert internal links to wiki-links
        let mut content = convert_links_to_wikilinks(&info.content, &title_mapping);

        // Update image references
        for (original_ref, zip_path) in &info.images {
            if let Some(new_url) = asset_path_mapping.get(zip_path) {
                content = content.replace(original_ref, new_url);
                let encoded = urlencoding::encode(original_ref);
                content = content.replace(&encoded.to_string(), new_url);
            }
        }

        // Get tags from parent path (skip root export directory)
        let mut tags = extract_parent_tags(&info.original_path);

        // Add "database" tag if this is a database
        if info.is_database && !tags.contains(&"database".to_string()) {
            tags.push("database".to_string());
        }

        // Create page — either as database page or standard markdown page
        let mut page = if let Some(ref db_json) = info.database_json {
            // Create as a database page type
            let mut p = Page::new(notebook_id, info.clean_title.clone());
            p.page_type = PageType::Database;
            p.file_extension = Some("database".to_string());
            p.storage_mode = Some(FileStorageMode::Embedded);
            p.source_file = Some(format!("files/{}.database", p.id));

            // Write the database content file
            let files_dir = notebook_dir.join("files");
            fs::create_dir_all(&files_dir)?;
            fs::write(files_dir.join(format!("{}.database", p.id)), db_json)?;

            p
        } else {
            // Standard markdown import
            import_markdown_to_page(&content, notebook_id, &info.clean_title)
        };
        page.tags = tags;

        // Set parent_page_id based on the folder -> notion_id -> nous_id mapping
        if let Some(parent_folder) = get_parent_folder_path(&info.original_path) {
            if let Some(parent_notion_id) = folder_to_notion_id.get(&parent_folder) {
                if let Some(&parent_page_id) = notion_to_nous_id.get(parent_notion_id) {
                    page.parent_page_id = Some(parent_page_id);
                }
            }
        }

        // Track this page's notion_id for child pages
        if let Some(ref notion_id) = info.notion_id {
            notion_to_nous_id.insert(notion_id.clone(), page.id);
        }

        // Save page
        let page_path = notebook_dir.join("pages").join(format!("{}.json", page.id));
        let page_json = serde_json::to_string_pretty(&page)?;
        fs::write(page_path, page_json)?;

        pages.push(page);
    }

    progress(100, 100, "Import complete");

    Ok((notebook, pages))
}

/// Find images associated with a markdown file
/// Notion stores images in a folder with the same name as the .md file
fn find_associated_images(md_path: &Path, image_files: &[(usize, String)]) -> Vec<(String, String)> {
    let mut images = Vec::new();

    // Get the folder that would contain images for this markdown file
    // e.g., "Page Name abc123.md" -> "Page Name abc123/"
    let stem = md_path.file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();

    let parent = md_path.parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let image_folder = if parent.is_empty() {
        stem.clone()
    } else {
        format!("{}/{}", parent, stem)
    };

    for (_, img_path) in image_files {
        // Check if this image is in the associated folder
        if img_path.starts_with(&image_folder) || img_path.starts_with(&format!("{}/", image_folder)) {
            // Get the relative reference as it would appear in markdown
            let filename = Path::new(img_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // The reference in markdown could be just the filename or a relative path
            images.push((filename.clone(), img_path.clone()));

            // Also add the folder/filename form
            let relative = format!("{}/{}", stem, filename);
            images.push((relative, img_path.clone()));
        }
    }

    images
}

#[cfg(test)]
mod tests {
    use super::*;

    // Use real 32-character Notion UUIDs in tests
    const TEST_UUID_1: &str = "abc123def456789012345678901234ab";
    const TEST_UUID_2: &str = "def456789012345678901234abcdef01";

    #[test]
    fn test_extract_notion_id() {
        // Standard .md file
        assert_eq!(
            extract_notion_id(&format!("Page Name {}.md", TEST_UUID_1)),
            Some(TEST_UUID_1.to_string())
        );
        // CSV database file
        assert_eq!(
            extract_notion_id(&format!("Database {}.csv", TEST_UUID_1)),
            Some(TEST_UUID_1.to_string())
        );
        // CSV with _all suffix (still matches for backwards compat)
        assert_eq!(
            extract_notion_id(&format!("Database {}_all.csv", TEST_UUID_1)),
            Some(TEST_UUID_1.to_string())
        );
        // File without UUID
        assert_eq!(
            extract_notion_id("Simple Page.md"),
            None
        );
    }

    #[test]
    fn test_clean_page_title() {
        // Standard .md file
        assert_eq!(
            clean_page_title(&format!("Page Name {}.md", TEST_UUID_1)),
            "Page Name"
        );
        // CSV database
        assert_eq!(
            clean_page_title(&format!("Database {}.csv", TEST_UUID_1)),
            "Database"
        );
        // CSV with _all suffix (still cleans properly)
        assert_eq!(
            clean_page_title(&format!("Database {}_all.csv", TEST_UUID_1)),
            "Database"
        );
        // Simple file without UUID
        assert_eq!(
            clean_page_title("Simple Page.md"),
            "Simple Page.md"  // No UUID to strip, keeps extension
        );
        // Folder name without extension
        assert_eq!(
            clean_page_title(&format!("Folder Name {}", TEST_UUID_1)),
            "Folder Name"
        );
    }

    #[test]
    fn test_extract_parent_tags() {
        // Path with proper 32-char UUIDs
        let path_str = format!(
            "Export-root/Projects {}/Work {}/Meeting Notes {}.md",
            TEST_UUID_1, TEST_UUID_2, TEST_UUID_1
        );
        let path = Path::new(&path_str);
        let tags = extract_parent_tags(path);
        // First component (Export-root) is skipped
        assert!(tags.contains(&"projects".to_string()));
        assert!(tags.contains(&"work".to_string()));
    }

    #[test]
    fn test_convert_links_to_wikilinks() {
        let mut mapping = HashMap::new();
        mapping.insert(
            format!("Other Page {}.md", TEST_UUID_1),
            "Other Page".to_string(),
        );

        let markdown = &format!(
            "See [Other Page](Other%20Page%20{}.md) for details.",
            TEST_UUID_1
        );
        let result = convert_links_to_wikilinks(markdown, &mapping);

        assert_eq!(result, "See [[Other Page]] for details.");
    }

    #[test]
    fn test_format_cell_value_tags() {
        // Tags column should format values as inline code
        assert_eq!(
            format_cell_value("tag1, tag2, tag3", "Tags"),
            "`tag1` `tag2` `tag3`"
        );
        // Case insensitive header matching
        assert_eq!(
            format_cell_value("foo, bar", "TAGS"),
            "`foo` `bar`"
        );
        // Single tag
        assert_eq!(
            format_cell_value("solo", "tags"),
            "`solo`"
        );
        // Empty value
        assert_eq!(
            format_cell_value("", "Tags"),
            ""
        );
        // Non-tags column should not be modified
        assert_eq!(
            format_cell_value("tag1, tag2", "Name"),
            "tag1, tag2"
        );
        // Handles pipes in content
        assert_eq!(
            format_cell_value("has|pipe", "Name"),
            "has\\|pipe"
        );
    }
}
