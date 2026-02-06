use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::storage::{EditorBlock, Page};

use super::html::{block_plain_text, render_block, slugify};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationOptions {
    pub theme: String,
    pub transition: String,
}

/// Split blocks into slides. H1/H2 headers start new slides.
/// Content before the first header becomes the title slide.
fn split_into_slides<'a>(blocks: &'a [EditorBlock], page_title: &str) -> Vec<(Option<String>, Vec<&'a EditorBlock>)> {
    let mut slides: Vec<(Option<String>, Vec<&EditorBlock>)> = Vec::new();
    let mut current_blocks: Vec<&EditorBlock> = Vec::new();
    let mut current_title: Option<String> = None;
    let mut found_header = false;

    for block in blocks {
        let is_split_header = block.block_type == "header" && {
            let level = block
                .data
                .get("level")
                .and_then(|v| v.as_u64())
                .unwrap_or(2);
            level <= 2
        };

        if is_split_header {
            // Save the previous slide if it has content
            if !current_blocks.is_empty() || found_header {
                slides.push((current_title.take(), current_blocks));
                current_blocks = Vec::new();
            } else if !found_header && current_blocks.is_empty() {
                // No content before first header — no title slide needed
            }

            found_header = true;
            // Use this header's text as the slide title (rendered as part of slide)
            let header_text = block
                .data
                .get("text")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            current_title = Some(header_text);
            current_blocks.push(block);
        } else {
            current_blocks.push(block);
        }
    }

    // Push remaining blocks
    if !current_blocks.is_empty() || slides.is_empty() {
        if !found_header && slides.is_empty() {
            // No headers at all — single slide with page title
            current_title = Some(page_title.to_string());
        }
        slides.push((current_title, current_blocks));
    }

    slides
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

/// Render a page as a standalone Reveal.js presentation HTML.
pub fn render_presentation_html(
    page: &Page,
    all_pages: &[Page],
    options: &PresentationOptions,
) -> String {
    let (page_slugs, block_texts) = build_lookup_maps(all_pages);
    let slides = split_into_slides(&page.content.blocks, &page.title);

    let mut slides_html = String::new();
    for (_title, blocks) in &slides {
        slides_html.push_str("          <section>\n");
        for block in blocks {
            let html = render_block(block, &page_slugs, &block_texts);
            if !html.is_empty() {
                slides_html.push_str("            ");
                slides_html.push_str(&html);
                slides_html.push('\n');
            }
        }
        slides_html.push_str("          </section>\n");
    }

    let theme = &options.theme;
    let transition = &options.transition;

    format!(
        r#"<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/{theme}.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/highlight/monokai.css">
  <style>
    .reveal section img {{
      max-height: 60vh;
      object-fit: contain;
      border: none;
      box-shadow: none;
    }}
    .reveal figure {{
      margin: 0;
    }}
    .reveal figcaption {{
      font-size: 0.6em;
      opacity: 0.7;
      margin-top: 0.5em;
    }}
    .reveal table {{
      margin: 0.5em auto;
      border-collapse: collapse;
      font-size: 0.7em;
    }}
    .reveal th, .reveal td {{
      border: 1px solid rgba(128,128,128,0.3);
      padding: 0.4em 0.8em;
    }}
    .reveal th {{
      background: rgba(128,128,128,0.1);
    }}
    .reveal .callout {{
      text-align: left;
      padding: 1em;
      border-radius: 8px;
      margin: 0.5em 0;
      font-size: 0.8em;
    }}
    .reveal .callout-info {{ background: rgba(59,130,246,0.1); border-left: 4px solid rgb(59,130,246); }}
    .reveal .callout-warning {{ background: rgba(245,158,11,0.1); border-left: 4px solid rgb(245,158,11); }}
    .reveal .callout-success {{ background: rgba(34,197,94,0.1); border-left: 4px solid rgb(34,197,94); }}
    .reveal .callout-error {{ background: rgba(239,68,68,0.1); border-left: 4px solid rgb(239,68,68); }}
    .reveal .callout-title {{
      font-weight: 600;
      margin-bottom: 0.5em;
    }}
    .reveal .checklist {{
      list-style: none;
      padding-left: 0;
      text-align: left;
    }}
    .reveal .checklist li {{
      margin: 0.3em 0;
    }}
    .reveal blockquote {{
      font-style: italic;
      border-left: 4px solid rgba(128,128,128,0.4);
      padding-left: 1em;
      text-align: left;
    }}
    .reveal pre {{
      width: 100%;
      font-size: 0.55em;
    }}
    .reveal ul, .reveal ol {{
      text-align: left;
    }}
    .reveal p {{
      text-align: left;
    }}
    .reveal h1, .reveal h2, .reveal h3 {{
      text-align: left;
    }}
  </style>
</head>
<body>
  <div class="reveal">
    <div class="slides">
{slides}
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/plugin/highlight/highlight.js"></script>
  <script>
    Reveal.initialize({{
      transition: '{transition}',
      plugins: [RevealHighlight],
      hash: true,
    }});
  </script>
</body>
</html>"#,
        title = page.title,
        theme = theme,
        slides = slides_html,
        transition = transition,
    )
}
