use std::fs;
use std::path::PathBuf;

use crate::publish::html::render_page_html;
use crate::publish::site::{build_lookup_maps, generate_site, PublishOptions};
use crate::publish::themes::get_theme;
use crate::storage::{FileStorage, Folder, Page};
use uuid::Uuid;

/// Render a self-contained HTML file for sharing a single page.
///
/// Images referenced via `assets/...` are inlined as base64 data URIs so the
/// HTML file works standalone with no external dependencies.
pub fn render_share_html(
    storage: &FileStorage,
    notebook_id: Uuid,
    page: &Page,
    all_pages: &[Page],
    theme_name: &str,
) -> Result<String, String> {
    let (page_slugs, block_texts) = build_lookup_maps(all_pages);
    let theme = get_theme(theme_name);

    let content_html = render_page_html(page, &page_slugs, &block_texts);
    let date = page.updated_at.format("%B %d, %Y").to_string();

    let html = theme
        .page_template
        .replace("{{page_title}}", &page.title)
        .replace("{{site_title}}", "Shared Page")
        .replace("{{content}}", &content_html)
        .replace("{{date}}", &date)
        .replace("{{backlinks}}", "")
        .replace("{{nav}}", "");

    // Inline CSS (replace <link> with <style>)
    let html = html.replace(
        "<link rel=\"stylesheet\" href=\"style.css\">",
        &format!("<style>{}</style>", theme.css),
    );

    // Add generator meta tag
    let html = html.replace(
        "<meta charset=\"utf-8\">",
        "<meta charset=\"utf-8\">\n  <meta name=\"generator\" content=\"Nous\">",
    );

    // Override broken-link styling: render as muted text instead of strikethrough
    let broken_link_css = r#"
<style>
.broken-link {
  color: var(--color-text-muted, #888);
  text-decoration: none !important;
  font-style: italic;
}
</style>
</head>"#;
    let html = html.replace("</head>", broken_link_css);

    // Inline images: find src="assets/..." and replace with data URIs
    let html = inline_images(&html, storage, notebook_id);

    Ok(html)
}

/// Find `src="assets/..."` references in the HTML and replace them with
/// base64 data URIs by reading the actual files from the notebook's assets dir.
fn inline_images(html: &str, storage: &FileStorage, notebook_id: Uuid) -> String {
    let assets_dir = storage.notebook_assets_dir(notebook_id);
    let mut result = html.to_string();

    // Match src="assets/..." in img tags
    let re = regex::Regex::new(r#"src="(assets/[^"]+)""#).unwrap();

    // Collect replacements to avoid mutating while iterating
    let mut replacements: Vec<(String, String)> = Vec::new();

    for caps in re.captures_iter(html) {
        let full_match = caps[0].to_string();
        let asset_path = &caps[1];

        // Strip the "assets/" prefix to get the filename
        let filename = asset_path
            .strip_prefix("assets/")
            .unwrap_or(asset_path);

        let file_path = assets_dir.join(filename);
        if !file_path.exists() {
            continue;
        }

        if let Ok(data) = fs::read(&file_path) {
            let mime = mime_for_extension(filename);
            let b64 = base64_encode(&data);
            let data_uri = format!("data:{};base64,{}", mime, b64);
            replacements.push((full_match, format!("src=\"{}\"", data_uri)));
        }
    }

    for (old, new) in replacements {
        result = result.replace(&old, &new);
    }

    // Also handle image URLs that went through rewrite_asset_url but might
    // still reference non-assets/ paths (e.g., absolute or protocol URLs
    // that resolve to local files). We only rewrite assets/ paths above,
    // which covers the publish pipeline output.

    result
}

/// Map file extension to MIME type.
fn mime_for_extension(filename: &str) -> &'static str {
    let ext = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
}

/// Simple base64 encoding (no external dependency needed beyond what's in std).
fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

/// Generate a multi-page share site in a temporary directory.
///
/// Uses the publish pipeline's `generate_site()` to create a full static site
/// with navigation, then returns the path to the temp directory.
pub fn generate_share_site(
    storage: &FileStorage,
    notebook_id: Uuid,
    pages: &[Page],
    folders: &[Folder],
    site_title: &str,
    theme_name: &str,
) -> Result<PathBuf, String> {
    let temp_dir = std::env::temp_dir().join(format!("nous-share-site-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let options = PublishOptions {
        include_assets: true,
        include_backlinks: false,
        site_title: Some(site_title.to_string()),
    };

    generate_site(
        storage,
        notebook_id,
        pages,
        folders,
        &temp_dir,
        theme_name,
        site_title,
        &options,
        None,
    )?;

    // Post-process: add generator meta tag and broken-link CSS to all HTML files
    post_process_site(&temp_dir)?;

    Ok(temp_dir)
}

/// Post-process generated site: add meta tag and broken-link styling.
fn post_process_site(site_dir: &std::path::Path) -> Result<(), String> {
    let broken_link_css = r#"
<style>
.broken-link {
  color: var(--color-text-muted, #888);
  text-decoration: none !important;
  font-style: italic;
}
</style>
</head>"#;

    for entry in walkdir::WalkDir::new(site_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.path().extension().and_then(|ext| ext.to_str()) == Some("html")
        })
    {
        let path = entry.path();
        let mut html = fs::read_to_string(path)
            .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

        // Add generator meta tag
        html = html.replace(
            "<meta charset=\"utf-8\">",
            "<meta charset=\"utf-8\">\n  <meta name=\"generator\" content=\"Nous\">",
        );

        // Add broken-link styling
        html = html.replace("</head>", broken_link_css);

        fs::write(path, &html)
            .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    }

    Ok(())
}
