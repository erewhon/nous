use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use uuid::Uuid;

use crate::storage::{FileStorage, Folder, Page};

use super::html::{block_plain_text, render_page_html, rewrite_asset_url, slugify};
use super::themes::get_theme;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishOptions {
    #[serde(default = "default_true")]
    pub include_assets: bool,
    #[serde(default)]
    pub include_backlinks: bool,
    #[serde(default)]
    pub site_title: Option<String>,
}

fn default_true() -> bool {
    true
}

impl Default for PublishOptions {
    fn default() -> Self {
        Self {
            include_assets: true,
            include_backlinks: false,
            site_title: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub output_dir: String,
    pub page_count: usize,
    pub asset_count: usize,
}

/// Progress callback type used during publishing.
pub type ProgressFn = Box<dyn Fn(usize, usize, &str) + Send>;

/// Publish an entire notebook as a static site.
pub fn publish_notebook(
    storage: &FileStorage,
    notebook_id: Uuid,
    output_dir: &Path,
    theme_name: &str,
    options: &PublishOptions,
    progress: Option<&ProgressFn>,
) -> Result<PublishResult, String> {
    let notebook = storage
        .get_notebook(notebook_id)
        .map_err(|e| format!("Failed to get notebook: {}", e))?;
    let pages = storage
        .list_pages(notebook_id)
        .map_err(|e| format!("Failed to list pages: {}", e))?;
    let folders = storage
        .list_folders(notebook_id)
        .map_err(|e| format!("Failed to list folders: {}", e))?;

    // Filter out deleted pages and non-standard types
    let pages: Vec<Page> = pages
        .into_iter()
        .filter(|p| p.deleted_at.is_none())
        .collect();

    let site_title = options
        .site_title
        .as_deref()
        .unwrap_or(&notebook.name)
        .to_string();

    generate_site(
        storage,
        notebook_id,
        &pages,
        &folders,
        output_dir,
        theme_name,
        &site_title,
        options,
        progress,
    )
}

/// Publish selected pages as a static site.
pub fn publish_selected_pages(
    storage: &FileStorage,
    notebook_id: Uuid,
    page_ids: &[Uuid],
    output_dir: &Path,
    theme_name: &str,
    options: &PublishOptions,
    progress: Option<&ProgressFn>,
) -> Result<PublishResult, String> {
    let notebook = storage
        .get_notebook(notebook_id)
        .map_err(|e| format!("Failed to get notebook: {}", e))?;
    let all_pages = storage
        .list_pages(notebook_id)
        .map_err(|e| format!("Failed to list pages: {}", e))?;
    let folders = storage
        .list_folders(notebook_id)
        .map_err(|e| format!("Failed to list folders: {}", e))?;

    let id_set: std::collections::HashSet<Uuid> = page_ids.iter().copied().collect();
    let pages: Vec<Page> = all_pages
        .into_iter()
        .filter(|p| id_set.contains(&p.id) && p.deleted_at.is_none())
        .collect();

    let site_title = options
        .site_title
        .as_deref()
        .unwrap_or(&notebook.name)
        .to_string();

    generate_site(
        storage,
        notebook_id,
        &pages,
        &folders,
        output_dir,
        theme_name,
        &site_title,
        options,
        progress,
    )
}

/// Generate a preview HTML string for a single page.
pub fn preview_page(
    storage: &FileStorage,
    notebook_id: Uuid,
    page_id: Uuid,
    theme_name: &str,
) -> Result<String, String> {
    let page = storage
        .get_page(notebook_id, page_id)
        .map_err(|e| format!("Failed to get page: {}", e))?;
    let all_pages = storage
        .list_pages(notebook_id)
        .map_err(|e| format!("Failed to list pages: {}", e))?;

    let (page_slugs, block_texts) = build_lookup_maps(&all_pages);
    let theme = get_theme(theme_name);

    let content_html = render_page_html(&page, &page_slugs, &block_texts);
    let date = page.updated_at.format("%B %d, %Y").to_string();

    let html = theme
        .page_template
        .replace("{{page_title}}", &page.title)
        .replace("{{site_title}}", "Preview")
        .replace("{{content}}", &content_html)
        .replace("{{date}}", &date)
        .replace("{{backlinks}}", "")
        .replace("{{nav}}", "");

    // Inline the CSS for preview
    let full_html = html.replace(
        "<link rel=\"stylesheet\" href=\"style.css\">",
        &format!("<style>{}</style>", theme.css),
    );

    Ok(full_html)
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

fn generate_site(
    storage: &FileStorage,
    notebook_id: Uuid,
    pages: &[Page],
    folders: &[Folder],
    output_dir: &Path,
    theme_name: &str,
    site_title: &str,
    options: &PublishOptions,
    progress: Option<&ProgressFn>,
) -> Result<PublishResult, String> {
    let theme = get_theme(theme_name);

    // Create output directories
    fs::create_dir_all(output_dir).map_err(|e| format!("Failed to create output dir: {}", e))?;
    let assets_dir = output_dir.join("assets");
    if options.include_assets {
        fs::create_dir_all(&assets_dir)
            .map_err(|e| format!("Failed to create assets dir: {}", e))?;
    }

    // Build lookup maps
    let (page_slugs, block_texts) = build_lookup_maps(pages);

    // Build slug-to-page map for backlinks and nav
    let mut slug_map: HashMap<String, &Page> = HashMap::new();
    for page in pages {
        let slug = title_to_slug(&page.title);
        slug_map.insert(slug, page);
    }

    // Build backlinks map: target slug -> vec of source (title, slug)
    let backlinks_map = if options.include_backlinks {
        build_backlinks_map(pages, &page_slugs)
    } else {
        HashMap::new()
    };

    // Build folder name map
    let folder_names: HashMap<Uuid, String> = folders
        .iter()
        .map(|f| (f.id, f.name.clone()))
        .collect();

    let total = pages.len() + 2; // +2 for index.html + style.css
    let mut current = 0;

    // Write style.css
    if let Some(ref cb) = progress {
        cb(current, total, "Writing style.css");
    }
    fs::write(output_dir.join("style.css"), theme.css)
        .map_err(|e| format!("Failed to write style.css: {}", e))?;
    current += 1;

    // Generate navigation items
    let nav_html = build_nav_html(pages, folders, &folder_names, theme_name);

    // Write index.html
    if let Some(ref cb) = progress {
        cb(current, total, "Writing index.html");
    }
    let index_html = theme
        .index_template
        .replace("{{site_title}}", site_title)
        .replace("{{nav}}", &nav_html);
    fs::write(output_dir.join("index.html"), index_html)
        .map_err(|e| format!("Failed to write index.html: {}", e))?;
    current += 1;

    // Track copied assets
    let mut asset_count = 0;

    // Generate individual page files
    for page in pages {
        let slug = title_to_slug(&page.title);
        if let Some(ref cb) = progress {
            cb(current, total, &format!("Rendering {}", page.title));
        }

        let content_html = render_page_html(page, &page_slugs, &block_texts);
        let date = page.updated_at.format("%B %d, %Y").to_string();

        // Build backlinks section
        let backlinks_html = if options.include_backlinks {
            build_backlinks_section(&slug, &backlinks_map)
        } else {
            String::new()
        };

        let page_html = theme
            .page_template
            .replace("{{page_title}}", &page.title)
            .replace("{{site_title}}", site_title)
            .replace("{{content}}", &content_html)
            .replace("{{date}}", &date)
            .replace("{{backlinks}}", &backlinks_html)
            .replace("{{nav}}", &nav_html);

        let filename = format!("{}.html", slug);
        fs::write(output_dir.join(&filename), page_html)
            .map_err(|e| format!("Failed to write {}: {}", filename, e))?;

        // Copy assets referenced by this page
        if options.include_assets {
            asset_count += copy_page_assets(storage, notebook_id, page, &assets_dir)?;
        }

        current += 1;
    }

    Ok(PublishResult {
        output_dir: output_dir.to_string_lossy().to_string(),
        page_count: pages.len(),
        asset_count,
    })
}

/// Build lookup maps for page slug resolution and block text resolution.
fn build_lookup_maps(pages: &[Page]) -> (HashMap<String, String>, HashMap<String, String>) {
    let mut page_slugs: HashMap<String, String> = HashMap::new();
    let mut block_texts: HashMap<String, String> = HashMap::new();

    for page in pages {
        let slug = title_to_slug(&page.title);
        page_slugs.insert(page.title.to_lowercase(), slug);

        for block in &page.content.blocks {
            let text = block_plain_text(block);
            if !text.is_empty() {
                block_texts.insert(block.id.clone(), text);
            }
        }
    }

    (page_slugs, block_texts)
}

/// Generate a slug from a page title.
fn title_to_slug(title: &str) -> String {
    let s = slugify(title);
    if s.is_empty() {
        "untitled".to_string()
    } else {
        s
    }
}

/// Build the navigation HTML based on the theme style.
fn build_nav_html(
    pages: &[Page],
    _folders: &[Folder],
    folder_names: &HashMap<Uuid, String>,
    theme_name: &str,
) -> String {
    // Group pages by folder
    let mut root_pages: Vec<&Page> = Vec::new();
    let mut folder_pages: HashMap<Uuid, Vec<&Page>> = HashMap::new();

    for page in pages {
        if let Some(fid) = page.folder_id {
            folder_pages.entry(fid).or_default().push(page);
        } else {
            root_pages.push(page);
        }
    }

    let mut html = String::new();

    // Root pages first
    for page in &root_pages {
        let slug = title_to_slug(&page.title);
        html.push_str(&format_nav_item(&page.title, &slug, theme_name));
    }

    // Then folder groups
    let mut sorted_folders: Vec<(&Uuid, &Vec<&Page>)> = folder_pages.iter().collect();
    sorted_folders.sort_by_key(|(id, _)| {
        folder_names.get(id).cloned().unwrap_or_default()
    });

    for (folder_id, fps) in sorted_folders {
        let folder_name = folder_names
            .get(folder_id)
            .cloned()
            .unwrap_or_else(|| "Untitled Folder".to_string());

        if theme_name == "blog" {
            // Blog theme: just list pages, no folder grouping
            for page in fps {
                let slug = title_to_slug(&page.title);
                html.push_str(&format_nav_item(&page.title, &slug, theme_name));
            }
        } else {
            // Other themes: show folder as a group
            html.push_str(&format!(
                "      <li class=\"nav-group\"><strong>{}</strong>\n        <ul>\n",
                folder_name
            ));
            for page in fps {
                let slug = title_to_slug(&page.title);
                html.push_str(&format!(
                    "          <li><a href=\"{}.html\">{}</a></li>\n",
                    slug, page.title
                ));
            }
            html.push_str("        </ul>\n      </li>\n");
        }
    }

    html
}

fn format_nav_item(title: &str, slug: &str, theme_name: &str) -> String {
    if theme_name == "blog" {
        format!(
            "      <div class=\"post-list-item\"><a href=\"{slug}.html\">{title}</a></div>\n",
            slug = slug,
            title = title
        )
    } else {
        format!(
            "      <li><a href=\"{slug}.html\">{title}</a></li>\n",
            slug = slug,
            title = title
        )
    }
}

/// Build a map from page slug to list of (source_title, source_slug) that link to it.
fn build_backlinks_map(
    pages: &[Page],
    page_slugs: &HashMap<String, String>,
) -> HashMap<String, Vec<(String, String)>> {
    let wiki_re =
        regex::Regex::new(r#"<wiki-link[^>]*data-page-title="([^"]*)"[^>]*>"#).unwrap();

    let mut map: HashMap<String, Vec<(String, String)>> = HashMap::new();

    for page in pages {
        let source_slug = title_to_slug(&page.title);
        for block in &page.content.blocks {
            let text = match block.block_type.as_str() {
                "paragraph" | "header" | "quote" | "callout" => block
                    .data
                    .get("text")
                    .or_else(|| block.data.get("content"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default(),
                _ => continue,
            };
            for cap in wiki_re.captures_iter(text) {
                let target_title = &cap[1];
                let key = target_title.to_lowercase();
                if let Some(target_slug) = page_slugs.get(&key) {
                    map.entry(target_slug.clone())
                        .or_default()
                        .push((page.title.clone(), source_slug.clone()));
                }
            }
        }
    }

    // Deduplicate
    for entries in map.values_mut() {
        entries.sort();
        entries.dedup();
    }

    map
}

fn build_backlinks_section(
    slug: &str,
    backlinks_map: &HashMap<String, Vec<(String, String)>>,
) -> String {
    match backlinks_map.get(slug) {
        Some(links) if !links.is_empty() => {
            let mut html = String::from(
                "<section class=\"backlinks\">\n  <h2>Linked from</h2>\n  <ul>\n",
            );
            for (title, src_slug) in links {
                html.push_str(&format!(
                    "    <li><a href=\"{}.html\">{}</a></li>\n",
                    src_slug, title
                ));
            }
            html.push_str("  </ul>\n</section>");
            html
        }
        _ => String::new(),
    }
}

/// Copy image assets referenced by a page's blocks into the output assets/ dir.
fn copy_page_assets(
    storage: &FileStorage,
    notebook_id: Uuid,
    page: &Page,
    output_assets_dir: &Path,
) -> Result<usize, String> {
    let source_assets_dir = storage.notebook_assets_dir(notebook_id);
    let mut count = 0;

    for block in &page.content.blocks {
        if block.block_type != "image" {
            continue;
        }
        let url = block
            .data
            .get("file")
            .and_then(|f| f.get("url"))
            .and_then(|v| v.as_str())
            .unwrap_or_default();

        if url.is_empty() {
            continue;
        }

        let rewritten = rewrite_asset_url(url);
        // Only copy local assets (ones that start with "assets/")
        if let Some(filename) = rewritten.strip_prefix("assets/") {
            let src = source_assets_dir.join(filename);
            let dst = output_assets_dir.join(filename);
            if src.exists() {
                // Ensure parent dir exists (for nested assets)
                if let Some(parent) = dst.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                fs::copy(&src, &dst)
                    .map_err(|e| format!("Failed to copy asset {}: {}", filename, e))?;
                count += 1;
            }
        }
    }

    Ok(count)
}
