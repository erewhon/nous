use regex::Regex;
use std::collections::HashMap;

use crate::storage::{EditorBlock, Page};

/// Convert a page to an HTML content fragment (no wrapping html/body tags).
/// `page_slugs` maps page titles (lowercase) to their slug filenames for wiki-link resolution.
/// `block_texts` maps block IDs to their plain-text content for block-ref resolution.
pub fn render_page_html(
    page: &Page,
    page_slugs: &HashMap<String, String>,
    block_texts: &HashMap<String, String>,
) -> String {
    let mut html = String::new();
    for block in &page.content.blocks {
        let block_html = render_block(block, page_slugs, block_texts);
        if !block_html.is_empty() {
            html.push_str(&block_html);
            html.push('\n');
        }
    }
    html
}

/// Render a single EditorBlock to HTML.
pub fn render_block(
    block: &EditorBlock,
    page_slugs: &HashMap<String, String>,
    block_texts: &HashMap<String, String>,
) -> String {
    match block.block_type.as_str() {
        "header" => render_header(block),
        "paragraph" => render_paragraph(block, page_slugs, block_texts),
        "list" => render_list(block, page_slugs, block_texts),
        "checklist" => render_checklist(block, page_slugs, block_texts),
        "code" => render_code(block),
        "quote" => render_quote(block, page_slugs, block_texts),
        "delimiter" => "<hr>".to_string(),
        "table" => render_table(block, page_slugs, block_texts),
        "callout" => render_callout(block, page_slugs, block_texts),
        "image" => render_image(block),
        _ => String::new(),
    }
}

fn render_header(block: &EditorBlock) -> String {
    let text = block
        .data
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let level = block
        .data
        .get("level")
        .and_then(|v| v.as_u64())
        .unwrap_or(2)
        .min(6) as usize;

    let id = slugify(text);
    format!("<h{l} id=\"{id}\">{text}</h{l}>", l = level, id = id, text = text)
}

fn render_paragraph(
    block: &EditorBlock,
    page_slugs: &HashMap<String, String>,
    block_texts: &HashMap<String, String>,
) -> String {
    let text = block
        .data
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    if text.is_empty() {
        return String::new();
    }

    let resolved = resolve_custom_elements(text, page_slugs, block_texts);
    format!("<p>{}</p>", resolved)
}

fn render_list(
    block: &EditorBlock,
    page_slugs: &HashMap<String, String>,
    block_texts: &HashMap<String, String>,
) -> String {
    let items = block
        .data
        .get("items")
        .and_then(|v| v.as_array())
        .map(|arr| arr.to_vec())
        .unwrap_or_default();

    let style = block
        .data
        .get("style")
        .and_then(|v| v.as_str())
        .unwrap_or("unordered");

    let tag = if style == "ordered" { "ol" } else { "ul" };

    let items_html: Vec<String> = items
        .iter()
        .map(|item| {
            let text = extract_list_item_text(item);
            let resolved = resolve_custom_elements(&text, page_slugs, block_texts);
            format!("  <li>{}</li>", resolved)
        })
        .collect();

    format!("<{}>\n{}\n</{}>", tag, items_html.join("\n"), tag)
}

fn render_checklist(
    block: &EditorBlock,
    page_slugs: &HashMap<String, String>,
    block_texts: &HashMap<String, String>,
) -> String {
    let items = block
        .data
        .get("items")
        .and_then(|v| v.as_array())
        .map(|arr| arr.to_vec())
        .unwrap_or_default();

    let items_html: Vec<String> = items
        .iter()
        .map(|item| {
            let text = item
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let checked = item
                .get("checked")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let resolved = resolve_custom_elements(text, page_slugs, block_texts);
            let check_attr = if checked { " checked disabled" } else { " disabled" };
            format!(
                "  <li><input type=\"checkbox\"{}/> {}</li>",
                check_attr, resolved
            )
        })
        .collect();

    format!("<ul class=\"checklist\">\n{}\n</ul>", items_html.join("\n"))
}

fn render_code(block: &EditorBlock) -> String {
    let code = block
        .data
        .get("code")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let language = block
        .data
        .get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let escaped = html_escape(code);
    if language.is_empty() {
        format!("<pre><code>{}</code></pre>", escaped)
    } else {
        format!(
            "<pre><code class=\"language-{}\">{}</code></pre>",
            html_escape(language),
            escaped
        )
    }
}

fn render_quote(
    block: &EditorBlock,
    page_slugs: &HashMap<String, String>,
    block_texts: &HashMap<String, String>,
) -> String {
    let text = block
        .data
        .get("text")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let resolved = resolve_custom_elements(text, page_slugs, block_texts);
    format!("<blockquote>{}</blockquote>", resolved)
}

fn render_table(
    block: &EditorBlock,
    page_slugs: &HashMap<String, String>,
    block_texts: &HashMap<String, String>,
) -> String {
    let content = block
        .data
        .get("content")
        .and_then(|v| v.as_array())
        .map(|arr| arr.to_vec())
        .unwrap_or_default();

    let with_headings = block
        .data
        .get("withHeadings")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if content.is_empty() {
        return String::new();
    }

    let mut html = String::from("<table>\n");

    for (row_idx, row) in content.iter().enumerate() {
        let cells: Vec<String> = row
            .as_array()
            .map(|arr| {
                arr.iter()
                    .map(|cell| {
                        let text = cell.as_str().unwrap_or_default();
                        resolve_custom_elements(text, page_slugs, block_texts)
                    })
                    .collect()
            })
            .unwrap_or_default();

        let tag = if row_idx == 0 && with_headings {
            "th"
        } else {
            "td"
        };

        let row_html: Vec<String> = cells
            .iter()
            .map(|c| format!("    <{}>{}</{}>", tag, c, tag))
            .collect();

        if row_idx == 0 && with_headings {
            html.push_str("  <thead>\n  <tr>\n");
            html.push_str(&row_html.join("\n"));
            html.push_str("\n  </tr>\n  </thead>\n  <tbody>\n");
        } else {
            html.push_str("  <tr>\n");
            html.push_str(&row_html.join("\n"));
            html.push_str("\n  </tr>\n");
        }
    }

    if with_headings {
        html.push_str("  </tbody>\n");
    }
    html.push_str("</table>");
    html
}

fn render_callout(
    block: &EditorBlock,
    page_slugs: &HashMap<String, String>,
    block_texts: &HashMap<String, String>,
) -> String {
    let callout_type = block
        .data
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("info");

    let title = block
        .data
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let content = block
        .data
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let resolved = resolve_custom_elements(content, page_slugs, block_texts);
    let mut html = format!("<div class=\"callout callout-{}\">", html_escape(callout_type));
    if !title.is_empty() {
        html.push_str(&format!("\n  <div class=\"callout-title\">{}</div>", html_escape(title)));
    }
    html.push_str(&format!("\n  <div class=\"callout-content\">{}</div>", resolved));
    html.push_str("\n</div>");
    html
}

fn render_image(block: &EditorBlock) -> String {
    let file_data = block.data.get("file");
    let url = file_data
        .and_then(|f| f.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let caption = block
        .data
        .get("caption")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if url.is_empty() {
        return String::new();
    }

    // Rewrite asset URLs to local assets/ path
    let src = rewrite_asset_url(url);

    let mut html = String::from("<figure>");
    html.push_str(&format!("<img src=\"{}\" alt=\"{}\">", html_escape(&src), html_escape(caption)));
    if !caption.is_empty() {
        html.push_str(&format!("<figcaption>{}</figcaption>", html_escape(caption)));
    }
    html.push_str("</figure>");
    html
}

/// Resolve `<wiki-link>` and `<block-ref>` custom elements in inline HTML.
fn resolve_custom_elements(
    text: &str,
    page_slugs: &HashMap<String, String>,
    block_texts: &HashMap<String, String>,
) -> String {
    let mut result = text.to_string();

    // Resolve wiki-links: <wiki-link data-page-title="Title">Title</wiki-link>
    let wiki_re =
        Regex::new(r#"<wiki-link[^>]*data-page-title="([^"]*)"[^>]*>([^<]*)</wiki-link>"#)
            .unwrap();
    result = wiki_re
        .replace_all(&result, |caps: &regex::Captures| {
            let page_title = &caps[1];
            let display_text = &caps[2];
            let key = page_title.to_lowercase();
            if let Some(slug) = page_slugs.get(&key) {
                format!("<a href=\"{}.html\">{}</a>", slug, display_text)
            } else {
                format!("<span class=\"broken-link\">{}</span>", display_text)
            }
        })
        .to_string();

    // Resolve block-refs: <block-ref data-block-id="id">...</block-ref>
    let ref_re =
        Regex::new(r#"<block-ref[^>]*data-block-id="([^"]*)"[^>]*>[^<]*</block-ref>"#).unwrap();
    result = ref_re
        .replace_all(&result, |caps: &regex::Captures| {
            let block_id = &caps[1];
            if let Some(text) = block_texts.get(block_id) {
                format!("<span class=\"block-ref\">{}</span>", text)
            } else {
                "<span class=\"block-ref broken\">[missing reference]</span>".to_string()
            }
        })
        .to_string();

    result
}

/// Extract the original filename from an asset URL and return an assets/-relative path.
pub fn rewrite_asset_url(url: &str) -> String {
    // Handle asset:// protocol and /assets/ paths
    if let Some(pos) = url.rfind("/assets/") {
        let filename = &url[pos + 8..]; // skip "/assets/"
        return format!("assets/{}", filename);
    }
    // Handle https://asset.localhost/ protocol
    if url.contains("asset.localhost/") {
        if let Some(pos) = url.rfind('/') {
            let filename = &url[pos + 1..];
            return format!("assets/{}", filename);
        }
    }
    // Already relative or external URL — leave as-is
    url.to_string()
}

/// Extract text from a list item (handles both string and object formats).
fn extract_list_item_text(item: &serde_json::Value) -> String {
    if let Some(s) = item.as_str() {
        s.to_string()
    } else if let Some(obj) = item.as_object() {
        obj.get("content")
            .or_else(|| obj.get("text"))
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string()
    } else {
        String::new()
    }
}

/// Create a URL-safe slug from a text string.
pub fn slugify(text: &str) -> String {
    let stripped = Regex::new(r"<[^>]+>").unwrap().replace_all(text, "");
    let decoded = stripped
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ");

    decoded
        .to_lowercase()
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// Escape HTML special characters.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Extract plain text from a block (for block-ref resolution).
pub fn block_plain_text(block: &EditorBlock) -> String {
    let raw = match block.block_type.as_str() {
        "paragraph" | "header" | "quote" => block
            .data
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        "code" => block
            .data
            .get("code")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        "callout" => block
            .data
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        _ => String::new(),
    };
    strip_html_tags(&raw)
}

/// Strip HTML tags from a string.
fn strip_html_tags(text: &str) -> String {
    Regex::new(r"<[^>]+>")
        .unwrap()
        .replace_all(text, "")
        .to_string()
}
