//! Notion import implementation
//!
//! Converts Notion export ZIP files to Katt notebooks.

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
use crate::storage::{Notebook, NotebookType, Page, StorageError};

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
    /// Cleaned page title
    clean_title: String,
    /// The Notion UUID suffix (e.g., "abc123def456")
    notion_id: Option<String>,
    /// Markdown content
    content: String,
    /// Parent folder path for tag generation
    parent_path: Option<String>,
    /// Associated image paths in the ZIP
    images: Vec<(String, String)>, // (original_ref, zip_path)
    /// Whether this came from a database CSV
    is_database_row: bool,
    /// Database name if from CSV
    database_name: Option<String>,
}

/// Regex pattern for Notion UUID suffix in filenames
/// Matches patterns like "Page Name abc123def456.md" or "Page Name abc123def456"
fn notion_id_regex() -> Regex {
    Regex::new(r"\s+([a-f0-9]{32})(?:\.md)?$").unwrap()
}

/// Extract the Notion UUID from a filename
/// "Page Name abc123def456.md" -> Some("abc123def456")
fn extract_notion_id(filename: &str) -> Option<String> {
    let re = notion_id_regex();
    re.captures(filename)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

/// Clean a page title by removing the Notion UUID suffix
/// "Page Name abc123def456.md" -> "Page Name"
fn clean_page_title(filename: &str) -> String {
    let name = filename
        .trim_end_matches(".md")
        .trim_end_matches(".csv");

    let re = notion_id_regex();
    re.replace(name, "").trim().to_string()
}

/// Extract parent folder path as tags
/// "Projects/Work/Meeting Notes.md" -> ["projects", "work"]
fn extract_parent_tags(path: &Path) -> Vec<String> {
    let mut tags = Vec::new();

    if let Some(parent) = path.parent() {
        for component in parent.components() {
            if let std::path::Component::Normal(name) = component {
                let name_str = name.to_string_lossy();
                // Clean Notion UUID from folder names too
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

/// Parse a CSV database file and return page info for each row
fn parse_database_csv(
    content: &str,
    database_name: &str,
    database_path: &Path,
) -> Vec<NotionPageInfo> {
    let mut pages = Vec::new();
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(content.as_bytes());

    let headers: Vec<String> = match reader.headers() {
        Ok(h) => h.iter().map(|s| s.to_string()).collect(),
        Err(_) => return pages,
    };

    // Find the "Name" or first column as the title column
    let title_col = headers.iter().position(|h| {
        let lower = h.to_lowercase();
        lower == "name" || lower == "title" || lower == "page"
    }).unwrap_or(0);

    for (row_idx, result) in reader.records().enumerate() {
        let record = match result {
            Ok(r) => r,
            Err(_) => continue,
        };

        // Get title from the title column
        let title = record.get(title_col)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("{} - Row {}", database_name, row_idx + 1));

        // Build markdown content from all columns
        let mut content = format!("# {}\n\n", title);

        // Add properties as a table or list
        content.push_str("## Properties\n\n");
        for (i, header) in headers.iter().enumerate() {
            if i == title_col {
                continue; // Skip title column
            }
            if let Some(value) = record.get(i) {
                let value = value.trim();
                if !value.is_empty() {
                    content.push_str(&format!("- **{}**: {}\n", header, value));
                }
            }
        }

        // Get parent path for tags
        let parent_path = database_path
            .parent()
            .map(|p| p.to_string_lossy().to_string());

        pages.push(NotionPageInfo {
            original_path: database_path.to_path_buf(),
            clean_title: title,
            notion_id: None,
            content,
            parent_path,
            images: Vec::new(),
            is_database_row: true,
            database_name: Some(database_name.to_string()),
        });
    }

    pages
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
                database_count += 1;
                csv_indices.push((i, name.clone(), path.to_path_buf()));
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
            Some("csv") => csv_files.push((i, name)),
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

        let clean_title = clean_page_title(&filename);
        let notion_id = extract_notion_id(&filename);

        title_mapping.insert(filename.clone(), clean_title.clone());

        // Also map the full path
        title_mapping.insert(name.clone(), clean_title.clone());

        // Read content as bytes first, then convert
        let mut file = archive.by_index(*idx)?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes)?;
        drop(file); // Release borrow

        let content = String::from_utf8(bytes)
            .unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).to_string());

        // Find associated images
        let images = find_associated_images(path, &image_files);

        let parent_path = path.parent()
            .map(|p| p.to_string_lossy().to_string());

        page_infos.push(NotionPageInfo {
            original_path: path.to_path_buf(),
            clean_title,
            notion_id,
            content,
            parent_path,
            images,
            is_database_row: false,
            database_name: None,
        });
    }

    // Process CSV database files
    for (idx, name) in &csv_files {
        let path = Path::new(name);
        let db_name = path.file_stem()
            .map(|n| clean_page_title(&n.to_string_lossy()))
            .unwrap_or_else(|| "Database".to_string());

        let mut file = archive.by_index(*idx)?;
        let mut content = String::new();
        if file.read_to_string(&mut content).is_ok() {
            let db_pages = parse_database_csv(&content, &db_name, path);

            // Add to title mapping
            for page in &db_pages {
                title_mapping.insert(
                    format!("{}.md", page.clean_title),
                    page.clean_title.clone(),
                );
            }

            page_infos.extend(db_pages);
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
        system_prompt: None,
        ai_provider: None,
        ai_model: None,
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

    // Process pages
    let mut pages: Vec<Page> = Vec::new();

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

        // Get tags from parent path
        let mut tags = extract_parent_tags(&info.original_path);

        // Add database name as tag if from database
        if let Some(db_name) = &info.database_name {
            let db_tag = db_name
                .to_lowercase()
                .replace(' ', "-")
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '-')
                .collect::<String>();
            if !db_tag.is_empty() && !tags.contains(&db_tag) {
                tags.push(db_tag);
            }
        }

        // Import markdown content to page
        let mut page = import_markdown_to_page(&content, notebook_id, &info.clean_title);
        page.tags = tags;

        // Save page
        let page_path = notebook_dir.join("pages").join(format!("{}.json", page.id));
        let page_json = serde_json::to_string_pretty(&page)?;
        fs::write(page_path, page_json)?;

        pages.push(page);
    }

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

    #[test]
    fn test_extract_notion_id() {
        assert_eq!(
            extract_notion_id("Page Name abc123def456789012345678901234.md"),
            Some("abc123def456789012345678901234".to_string())
        );
        assert_eq!(
            extract_notion_id("Simple Page.md"),
            None
        );
    }

    #[test]
    fn test_clean_page_title() {
        assert_eq!(
            clean_page_title("Page Name abc123def456789012345678901234.md"),
            "Page Name"
        );
        assert_eq!(
            clean_page_title("Simple Page.md"),
            "Simple Page"
        );
        assert_eq!(
            clean_page_title("Database abc123def456789012345678901234.csv"),
            "Database"
        );
    }

    #[test]
    fn test_extract_parent_tags() {
        let path = Path::new("Projects/Work abc123/Meeting Notes def456.md");
        let tags = extract_parent_tags(path);
        assert!(tags.contains(&"projects".to_string()));
        assert!(tags.contains(&"work".to_string()));
    }

    #[test]
    fn test_convert_links_to_wikilinks() {
        let mut mapping = HashMap::new();
        mapping.insert("Other Page abc123.md".to_string(), "Other Page".to_string());

        let markdown = "See [Other Page](Other%20Page%20abc123.md) for details.";
        let result = convert_links_to_wikilinks(markdown, &mapping);

        assert_eq!(result, "See [[Other Page]] for details.");
    }
}
