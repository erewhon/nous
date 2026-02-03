//! Obsidian vault import implementation
//!
//! Converts Obsidian vault folders to Nous notebooks.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use regex::Regex;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::markdown::import_markdown_to_page;
use crate::storage::{Notebook, NotebookType, Page, StorageError};

type Result<T> = std::result::Result<T, StorageError>;

/// Preview metadata for an Obsidian vault import
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianImportPreview {
    /// Number of markdown pages found
    pub page_count: usize,
    /// Number of asset files found
    pub asset_count: usize,
    /// Number of folders
    pub folder_count: usize,
    /// Maximum folder nesting depth
    pub nested_depth: usize,
    /// Sample pages for preview (first 10)
    pub pages: Vec<ObsidianPagePreview>,
    /// Vault name (folder name)
    pub suggested_name: String,
    /// Warnings during preview
    pub warnings: Vec<String>,
    /// Whether .obsidian config folder exists
    pub has_obsidian_config: bool,
}

/// Preview info for a single Obsidian page
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObsidianPagePreview {
    /// Page title (filename without extension)
    pub title: String,
    /// Relative path in vault
    pub path: String,
    /// Tags from frontmatter
    pub tags: Vec<String>,
    /// Whether this page has wiki-links
    pub has_wiki_links: bool,
}

/// Internal structure for tracking pages during import
struct ObsidianPageInfo {
    /// Original path relative to vault root
    relative_path: PathBuf,
    /// Page title (filename without extension)
    title: String,
    /// Markdown content
    content: String,
    /// Tags from frontmatter and inline
    tags: Vec<String>,
    /// Folder path for organization
    folder_path: Option<String>,
}

/// Parse YAML frontmatter from markdown content
fn parse_frontmatter(content: &str) -> (Option<HashMap<String, serde_yaml::Value>>, &str) {
    if !content.starts_with("---") {
        return (None, content);
    }

    // Find the closing ---
    if let Some(end_idx) = content[3..].find("\n---") {
        let yaml_content = &content[3..3 + end_idx];
        let rest = &content[3 + end_idx + 4..].trim_start();

        if let Ok(frontmatter) = serde_yaml::from_str(yaml_content) {
            return (Some(frontmatter), rest);
        }
    }

    (None, content)
}

/// Extract tags from frontmatter
fn extract_frontmatter_tags(frontmatter: &HashMap<String, serde_yaml::Value>) -> Vec<String> {
    let mut tags = Vec::new();

    if let Some(value) = frontmatter.get("tags") {
        match value {
            serde_yaml::Value::Sequence(seq) => {
                for item in seq {
                    if let serde_yaml::Value::String(s) = item {
                        tags.push(s.clone());
                    }
                }
            }
            serde_yaml::Value::String(s) => {
                // Tags might be comma-separated
                for tag in s.split(',') {
                    let tag = tag.trim();
                    if !tag.is_empty() {
                        tags.push(tag.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    tags
}

/// Extract inline tags from content (#tag)
fn extract_inline_tags(content: &str) -> Vec<String> {
    let tag_re = Regex::new(r"(?:^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)").unwrap();

    tag_re.captures_iter(content)
        .filter_map(|cap| cap.get(1))
        .map(|m| m.as_str().to_string())
        .collect()
}

/// Check if content has wiki-links
fn has_wiki_links(content: &str) -> bool {
    content.contains("[[")
}

/// Get folder path from relative path
fn get_folder_path(relative_path: &Path) -> Option<String> {
    relative_path.parent()
        .filter(|p| !p.as_os_str().is_empty())
        .map(|p| p.to_string_lossy().to_string())
}

/// Preview an Obsidian vault without importing
pub fn preview_obsidian_vault(vault_path: &Path) -> Result<ObsidianImportPreview> {
    if !vault_path.is_dir() {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Vault path is not a directory",
        )));
    }

    let mut page_count = 0;
    let mut asset_count = 0;
    let mut folder_count = 0;
    let mut max_depth = 0;
    let mut pages = Vec::new();
    let mut warnings = Vec::new();
    let has_obsidian_config = vault_path.join(".obsidian").exists();

    let suggested_name = vault_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Imported Vault".to_string());

    for entry in WalkDir::new(vault_path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        let relative = path.strip_prefix(vault_path).unwrap_or(path);

        // Skip .obsidian config folder
        if relative.starts_with(".obsidian") {
            continue;
        }

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
            Some("md") | Some("markdown") => {
                page_count += 1;

                if pages.len() < 10 {
                    // Read file to get preview info
                    if let Ok(content) = fs::read_to_string(path) {
                        let (frontmatter, body) = parse_frontmatter(&content);
                        let tags = frontmatter
                            .as_ref()
                            .map(|fm| extract_frontmatter_tags(fm))
                            .unwrap_or_default();

                        let title = path
                            .file_stem()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_else(|| "Untitled".to_string());

                        pages.push(ObsidianPagePreview {
                            title,
                            path: relative.to_string_lossy().to_string(),
                            tags,
                            has_wiki_links: has_wiki_links(body),
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
        warnings.push("No markdown files found in vault".to_string());
    }

    Ok(ObsidianImportPreview {
        page_count,
        asset_count,
        folder_count,
        nested_depth: max_depth,
        pages,
        suggested_name,
        warnings,
        has_obsidian_config,
    })
}

/// Import an Obsidian vault as a new notebook
pub fn import_obsidian_vault(
    vault_path: &Path,
    notebooks_dir: &Path,
    notebook_name: Option<String>,
) -> Result<(Notebook, Vec<Page>)> {
    if !vault_path.is_dir() {
        return Err(StorageError::Io(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "Vault path is not a directory",
        )));
    }

    let mut page_infos: Vec<ObsidianPageInfo> = Vec::new();
    let mut asset_files: Vec<(PathBuf, PathBuf)> = Vec::new(); // (source, relative)

    // Collect all files
    for entry in WalkDir::new(vault_path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        let relative = path.strip_prefix(vault_path).unwrap_or(path).to_path_buf();

        // Skip .obsidian config folder and hidden files
        if relative.starts_with(".obsidian") || relative.to_string_lossy().contains("/.") {
            continue;
        }

        if path.is_dir() {
            continue;
        }

        let extension = path.extension()
            .map(|e| e.to_string_lossy().to_lowercase());

        match extension.as_deref() {
            Some("md") | Some("markdown") => {
                if let Ok(content) = fs::read_to_string(path) {
                    let (frontmatter, body) = parse_frontmatter(&content);

                    let mut tags = frontmatter
                        .as_ref()
                        .map(|fm| extract_frontmatter_tags(fm))
                        .unwrap_or_default();

                    // Add inline tags
                    let inline_tags = extract_inline_tags(body);
                    for tag in inline_tags {
                        if !tags.contains(&tag) {
                            tags.push(tag);
                        }
                    }

                    let title = path
                        .file_stem()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "Untitled".to_string());

                    let folder_path = get_folder_path(&relative);

                    page_infos.push(ObsidianPageInfo {
                        relative_path: relative,
                        title,
                        content: body.to_string(),
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

    // Create the notebook
    let notebook_id = Uuid::new_v4();
    let notebook_name = notebook_name.unwrap_or_else(|| {
        vault_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "Imported Vault".to_string())
    });

    let now = Utc::now();
    let notebook = Notebook {
        id: notebook_id,
        name: notebook_name,
        notebook_type: NotebookType::Standard,
        icon: Some("💎".to_string()), // Diamond for Obsidian
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

    for (source_path, relative_path) in &asset_files {
        let filename = relative_path
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
        fs::copy(source_path, &target_path)?;

        // Map various forms of the reference
        let new_url = format!("asset://{}/{}", notebook_id, target_filename);
        asset_mapping.insert(relative_path.to_string_lossy().to_string(), new_url.clone());
        asset_mapping.insert(filename.clone(), new_url.clone());

        // Also map just the filename for simpler references
        if let Some(name) = relative_path.file_name() {
            asset_mapping.insert(name.to_string_lossy().to_string(), new_url);
        }
    }

    // Process pages
    let mut pages: Vec<Page> = Vec::new();

    for info in page_infos {
        // Update image references in content
        let mut content = info.content.clone();
        for (original, new_url) in &asset_mapping {
            // Replace markdown image syntax
            content = content.replace(&format!("]({})", original), &format!("]({})", new_url));
            content = content.replace(&format!("]({}", original), &format!("]({}", new_url));

            // Replace wiki-link embeds ![[image.png]]
            content = content.replace(&format!("![[{}]]", original), &format!("![]({})", new_url));
        }

        // Import markdown content to page
        let mut page = import_markdown_to_page(&content, notebook_id, &info.title);
        page.tags = info.tags;

        // Add folder path as a tag for now (folder structure preserved as tags)
        // TODO: Create actual folders and assign folder_id
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
    fn test_parse_frontmatter() {
        let content = "---\ntags: [test, demo]\n---\n\n# Hello\n\nContent here.";
        let (fm, body) = parse_frontmatter(content);

        assert!(fm.is_some());
        assert!(body.contains("# Hello"));
    }

    #[test]
    fn test_extract_inline_tags() {
        let content = "This is a #test and another #demo-tag here.";
        let tags = extract_inline_tags(content);

        assert!(tags.contains(&"test".to_string()));
        assert!(tags.contains(&"demo-tag".to_string()));
    }

    #[test]
    fn test_has_wiki_links() {
        assert!(has_wiki_links("Check out [[Other Page]] for more."));
        assert!(!has_wiki_links("No links here."));
    }
}
