use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::storage::Page;

use super::html::{block_plain_text, render_page_html, slugify};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintOptions {
    pub include_toc: bool,
    pub include_metadata: bool,
}

/// Build lookup maps for wiki-link and block-ref resolution.
fn build_lookup_maps(all_pages: &[Page]) -> (HashMap<String, String>, HashMap<String, String>) {
    let mut page_slugs: HashMap<String, String> = HashMap::new();
    let mut block_texts: HashMap<String, String> = HashMap::new();

    for page in all_pages {
        let slug = slugify(&page.title);
        let slug = if slug.is_empty() {
            "untitled".to_string()
        } else {
            slug
        };
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

/// Generate a table of contents from header blocks.
fn generate_toc(page: &Page) -> String {
    let mut toc_items: Vec<(usize, String, String)> = Vec::new();

    for block in &page.content.blocks {
        if block.block_type == "header" {
            let text = block
                .data
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or_default();
            let level = block
                .data
                .get("level")
                .and_then(|v| v.as_u64())
                .unwrap_or(2) as usize;
            let id = slugify(text);

            if !text.is_empty() {
                toc_items.push((level, text.to_string(), id));
            }
        }
    }

    if toc_items.is_empty() {
        return String::new();
    }

    let min_level = toc_items.iter().map(|(l, _, _)| *l).min().unwrap_or(1);

    let mut html = String::from(
        "<nav class=\"toc\">\n  <h2>Table of Contents</h2>\n  <ul>\n",
    );

    for (level, text, id) in &toc_items {
        let indent = "    ".repeat(level - min_level + 1);
        html.push_str(&format!(
            "{}  <li><a href=\"#{}\">{}</a></li>\n",
            indent, id, text
        ));
    }

    html.push_str("  </ul>\n</nav>\n");
    html
}

/// Render a page as print-friendly HTML.
pub fn render_print_html(
    page: &Page,
    all_pages: &[Page],
    options: &PrintOptions,
) -> String {
    let (page_slugs, block_texts) = build_lookup_maps(all_pages);
    let content_html = render_page_html(page, &page_slugs, &block_texts);

    let toc_html = if options.include_toc {
        generate_toc(page)
    } else {
        String::new()
    };

    let metadata_html = if options.include_metadata {
        let date = page.updated_at.format("%B %d, %Y").to_string();
        let created = page.created_at.format("%B %d, %Y").to_string();
        let mut meta = format!(
            "<div class=\"metadata\">\n  <p>Created: {} &middot; Updated: {}</p>\n",
            created, date
        );
        if !page.tags.is_empty() {
            meta.push_str("  <p>Tags: ");
            let tag_spans: Vec<String> = page
                .tags
                .iter()
                .map(|t| format!("<span class=\"tag\">{}</span>", t))
                .collect();
            meta.push_str(&tag_spans.join(" "));
            meta.push_str("</p>\n");
        }
        meta.push_str("</div>\n");
        meta
    } else {
        String::new()
    };

    format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <style>
    @page {{
      margin: 2cm;
      size: A4;
    }}
    * {{
      box-sizing: border-box;
    }}
    body {{
      font-family: Georgia, 'Times New Roman', serif;
      line-height: 1.6;
      color: #1a1a1a;
      max-width: 800px;
      margin: 0 auto;
      padding: 2em;
    }}
    h1 {{
      font-size: 2em;
      margin-bottom: 0.3em;
      border-bottom: 2px solid #333;
      padding-bottom: 0.3em;
    }}
    h1, h2, h3, h4, h5, h6 {{
      page-break-after: avoid;
      color: #111;
    }}
    h2 {{ font-size: 1.5em; margin-top: 1.5em; }}
    h3 {{ font-size: 1.25em; margin-top: 1.3em; }}
    p {{
      margin: 0.8em 0;
      orphans: 3;
      widows: 3;
    }}
    pre, blockquote, table, figure {{
      page-break-inside: avoid;
    }}
    pre {{
      background: #f5f5f5;
      padding: 1em;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.85em;
      border: 1px solid #ddd;
    }}
    code {{
      font-family: 'Fira Code', 'Consolas', monospace;
      font-size: 0.9em;
    }}
    blockquote {{
      border-left: 4px solid #ccc;
      margin: 1em 0;
      padding: 0.5em 1em;
      color: #555;
      font-style: italic;
    }}
    table {{
      width: 100%;
      border-collapse: collapse;
      margin: 1em 0;
      font-size: 0.9em;
    }}
    th, td {{
      border: 1px solid #ccc;
      padding: 0.5em 0.8em;
      text-align: left;
    }}
    th {{
      background: #f0f0f0;
      font-weight: 600;
    }}
    figure {{
      margin: 1em 0;
      text-align: center;
    }}
    figure img {{
      max-width: 100%;
      height: auto;
    }}
    figcaption {{
      font-size: 0.85em;
      color: #666;
      margin-top: 0.5em;
    }}
    hr {{
      border: none;
      border-top: 1px solid #ccc;
      margin: 2em 0;
    }}
    .toc {{
      border: 1px solid #ddd;
      border-left: 4px solid #4a90d9;
      padding: 1em 1.5em;
      margin: 1.5em 0;
      background: #fafafa;
      page-break-inside: avoid;
    }}
    .toc h2 {{
      font-size: 1.1em;
      margin: 0 0 0.5em 0;
      color: #333;
    }}
    .toc ul {{
      list-style: none;
      padding-left: 1em;
      margin: 0;
    }}
    .toc li {{
      margin: 0.3em 0;
    }}
    .toc a {{
      color: #4a90d9;
      text-decoration: none;
    }}
    .metadata {{
      color: #888;
      font-size: 0.85em;
      margin-bottom: 1.5em;
      padding-bottom: 1em;
      border-bottom: 1px solid #eee;
    }}
    .tag {{
      display: inline-block;
      background: #e8e8e8;
      padding: 0.1em 0.5em;
      border-radius: 3px;
      margin: 0 0.2em;
      font-size: 0.9em;
    }}
    .callout {{
      padding: 1em;
      border-radius: 6px;
      margin: 1em 0;
    }}
    .callout-info {{ background: #eff6ff; border-left: 4px solid #3b82f6; }}
    .callout-warning {{ background: #fffbeb; border-left: 4px solid #f59e0b; }}
    .callout-success {{ background: #f0fdf4; border-left: 4px solid #22c55e; }}
    .callout-error {{ background: #fef2f2; border-left: 4px solid #ef4444; }}
    .callout-title {{
      font-weight: 600;
      margin-bottom: 0.5em;
    }}
    .checklist {{
      list-style: none;
      padding-left: 0;
    }}
    .checklist li {{
      margin: 0.3em 0;
    }}
    @media print {{
      body {{
        padding: 0;
      }}
      .toc a {{
        color: #333;
      }}
    }}
  </style>
</head>
<body>
  <h1>{title}</h1>
{metadata}
{toc}
  <div class="content">
{content}
  </div>
</body>
</html>"#,
        title = page.title,
        metadata = metadata_html,
        toc = toc_html,
        content = content_html,
    )
}
