use crate::storage::{EditorBlock, EditorData, Page};
use chrono::{DateTime, Utc};
use pulldown_cmark::{CodeBlockKind, Event, HeadingLevel, Options, Parser, Tag, TagEnd};
use regex::Regex;
use uuid::Uuid;

/// Frontmatter extracted from markdown
#[derive(Default)]
struct Frontmatter {
    title: Option<String>,
    tags: Vec<String>,
    created: Option<DateTime<Utc>>,
    updated: Option<DateTime<Utc>>,
}

/// Import markdown content and create a new Page
pub fn import_markdown_to_page(markdown: &str, notebook_id: Uuid, fallback_title: &str) -> Page {
    let (frontmatter, body) = parse_frontmatter(markdown);

    let blocks = parse_markdown_to_blocks(&body);

    let now = Utc::now();
    let title = frontmatter.title.unwrap_or_else(|| {
        // Try to extract title from first heading
        extract_title_from_blocks(&blocks).unwrap_or_else(|| fallback_title.to_string())
    });

    Page {
        id: Uuid::new_v4(),
        notebook_id,
        title,
        content: EditorData {
            time: Some(now.timestamp_millis()),
            version: Some("2.28.0".to_string()),
            blocks,
        },
        tags: frontmatter.tags,
        folder_id: None,
        section_id: None,
        is_archived: false,
        is_cover: false,
        position: 0,
        system_prompt: None,
        system_prompt_mode: crate::storage::SystemPromptMode::default(),
        ai_model: None,
        created_at: frontmatter.created.unwrap_or(now),
        updated_at: frontmatter.updated.unwrap_or(now),
    }
}

/// Parse YAML frontmatter from markdown content
fn parse_frontmatter(markdown: &str) -> (Frontmatter, String) {
    let mut frontmatter = Frontmatter::default();

    // Check if content starts with frontmatter delimiter
    if !markdown.starts_with("---") {
        return (frontmatter, markdown.to_string());
    }

    // Find the closing delimiter
    let content_after_first = &markdown[3..];
    if let Some(end_pos) = content_after_first.find("\n---") {
        let yaml_content = &content_after_first[..end_pos].trim();
        let body = &content_after_first[end_pos + 4..].trim_start();

        // Parse YAML-like frontmatter (simple key-value parsing)
        for line in yaml_content.lines() {
            let line = line.trim();
            if line.starts_with("title:") {
                frontmatter.title = Some(parse_yaml_string(&line[6..]));
            } else if line.starts_with("created:") {
                frontmatter.created = parse_datetime(&line[8..]);
            } else if line.starts_with("updated:") {
                frontmatter.updated = parse_datetime(&line[8..]);
            } else if line.starts_with("- ") && frontmatter.title.is_some() {
                // Tag item (assumes tags come after title)
                let tag = parse_yaml_string(&line[2..]);
                if !tag.is_empty() {
                    frontmatter.tags.push(tag);
                }
            }
        }

        return (frontmatter, body.to_string());
    }

    (frontmatter, markdown.to_string())
}

/// Parse a YAML string value (handles quoted and unquoted)
fn parse_yaml_string(s: &str) -> String {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"')) || (s.starts_with('\'') && s.ends_with('\'')) {
        s[1..s.len() - 1].replace("\\\"", "\"").replace("\\'", "'")
    } else {
        s.to_string()
    }
}

/// Parse a datetime string
fn parse_datetime(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim();
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

/// Parse markdown body into Editor.js blocks
fn parse_markdown_to_blocks(markdown: &str) -> Vec<EditorBlock> {
    // Enable tables extension
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    let parser = Parser::new_ext(markdown, options);
    let mut blocks: Vec<EditorBlock> = Vec::new();
    let mut current_text = String::new();
    let mut in_code_block = false;
    let mut code_content = String::new();
    let mut code_language = String::new();
    let mut list_items: Vec<String> = Vec::new();
    let mut checklist_items: Vec<(String, bool)> = Vec::new();
    let mut is_ordered_list = false;
    let mut in_quote = false;
    let mut quote_text = String::new();
    let mut current_heading_level = 0;
    // Table state
    let mut in_table = false;
    let mut table_rows: Vec<Vec<String>> = Vec::new();
    let mut current_table_row: Vec<String> = Vec::new();
    let mut current_table_cell = String::new();
    let mut table_has_header = false;
    // Image state
    let mut current_image_url = String::new();
    let mut current_image_alt = String::new();

    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                flush_paragraph(&mut blocks, &mut current_text);
                current_heading_level = heading_level_to_int(level);
            }
            Event::End(TagEnd::Heading(_)) => {
                if !current_text.is_empty() {
                    blocks.push(EditorBlock {
                        id: generate_block_id(),
                        block_type: "header".to_string(),
                        data: serde_json::json!({
                            "text": current_text.trim(),
                            "level": current_heading_level
                        }),
                    });
                    current_text.clear();
                }
            }
            Event::Start(Tag::Paragraph) => {
                // Paragraph start
            }
            Event::End(TagEnd::Paragraph) => {
                if in_quote {
                    quote_text.push_str(&current_text);
                    current_text.clear();
                } else if !current_text.trim().is_empty() {
                    // Check for checklist pattern
                    if let Some(items) = try_parse_checklist(&current_text) {
                        for (text, checked) in items {
                            checklist_items.push((text, checked));
                        }
                    } else {
                        flush_paragraph(&mut blocks, &mut current_text);
                    }
                } else {
                    current_text.clear();
                }
            }
            Event::Start(Tag::CodeBlock(kind)) => {
                flush_paragraph(&mut blocks, &mut current_text);
                in_code_block = true;
                // Extract language from fenced code block
                if let CodeBlockKind::Fenced(info) = kind {
                    code_language = info.split_whitespace().next().unwrap_or("").to_string();
                }
            }
            Event::End(TagEnd::CodeBlock) => {
                in_code_block = false;
                blocks.push(EditorBlock {
                    id: generate_block_id(),
                    block_type: "code".to_string(),
                    data: serde_json::json!({
                        "code": code_content.trim_end(),
                        "language": code_language
                    }),
                });
                code_content.clear();
                code_language.clear();
            }
            Event::Start(Tag::List(first_item)) => {
                flush_paragraph(&mut blocks, &mut current_text);
                is_ordered_list = first_item.is_some();
            }
            Event::End(TagEnd::List(_)) => {
                if !checklist_items.is_empty() {
                    blocks.push(EditorBlock {
                        id: generate_block_id(),
                        block_type: "checklist".to_string(),
                        data: serde_json::json!({
                            "items": checklist_items.iter()
                                .map(|(text, checked)| serde_json::json!({
                                    "text": text,
                                    "checked": checked
                                }))
                                .collect::<Vec<_>>()
                        }),
                    });
                    checklist_items.clear();
                } else if !list_items.is_empty() {
                    blocks.push(EditorBlock {
                        id: generate_block_id(),
                        block_type: "list".to_string(),
                        data: serde_json::json!({
                            "style": if is_ordered_list { "ordered" } else { "unordered" },
                            "items": list_items
                        }),
                    });
                    list_items.clear();
                }
            }
            Event::Start(Tag::Item) => {
                current_text.clear();
            }
            Event::End(TagEnd::Item) => {
                let text = current_text.trim().to_string();
                // Check if this is a checklist item
                if let Some((content, checked)) = parse_checklist_item(&text) {
                    checklist_items.push((content, checked));
                } else {
                    list_items.push(text);
                }
                current_text.clear();
            }
            Event::Start(Tag::BlockQuote) => {
                flush_paragraph(&mut blocks, &mut current_text);
                in_quote = true;
            }
            Event::End(TagEnd::BlockQuote) => {
                in_quote = false;
                if !quote_text.is_empty() {
                    // Check if this is a callout/admonition: [!TYPE] or [!TYPE] Title
                    let callout_re = Regex::new(r"^\[!(\w+)\]\s*(.*)").unwrap();
                    let quote_trimmed = quote_text.trim();

                    if let Some(caps) = callout_re.captures(quote_trimmed) {
                        let callout_type = caps.get(1).map(|m| m.as_str().to_lowercase()).unwrap_or_default();
                        let rest = caps.get(2).map(|m| m.as_str()).unwrap_or("");

                        // First line after [!TYPE] could be a title, rest is content
                        let (title, content) = if let Some(newline_pos) = rest.find('\n') {
                            (rest[..newline_pos].trim().to_string(), rest[newline_pos + 1..].trim().to_string())
                        } else {
                            // Only one line - could be title only or content only
                            // If short, treat as title; otherwise treat as content
                            if rest.len() < 50 {
                                (rest.trim().to_string(), String::new())
                            } else {
                                (String::new(), rest.trim().to_string())
                            }
                        };

                        // Validate callout type
                        let valid_type = match callout_type.as_str() {
                            "info" | "warning" | "tip" | "danger" => callout_type,
                            "note" => "info".to_string(),
                            "caution" => "warning".to_string(),
                            _ => "info".to_string(),
                        };

                        blocks.push(EditorBlock {
                            id: generate_block_id(),
                            block_type: "callout".to_string(),
                            data: serde_json::json!({
                                "type": valid_type,
                                "title": title,
                                "content": content
                            }),
                        });
                    } else {
                        // Regular quote
                        blocks.push(EditorBlock {
                            id: generate_block_id(),
                            block_type: "quote".to_string(),
                            data: serde_json::json!({
                                "text": quote_trimmed
                            }),
                        });
                    }
                    quote_text.clear();
                }
            }
            Event::Start(Tag::Strong) => {
                current_text.push_str("<b>");
            }
            Event::End(TagEnd::Strong) => {
                current_text.push_str("</b>");
            }
            Event::Start(Tag::Emphasis) => {
                current_text.push_str("<i>");
            }
            Event::End(TagEnd::Emphasis) => {
                current_text.push_str("</i>");
            }
            Event::Code(text) => {
                current_text.push_str(&format!("<code>{}</code>", text));
            }
            Event::Start(Tag::Link { dest_url, .. }) => {
                current_text.push_str(&format!("<a href=\"{}\">", dest_url));
            }
            Event::End(TagEnd::Link) => {
                current_text.push_str("</a>");
            }
            Event::Text(text) => {
                if in_code_block {
                    code_content.push_str(&text);
                } else if in_table {
                    current_table_cell.push_str(&text);
                } else {
                    current_text.push_str(&text);
                }
            }
            Event::SoftBreak | Event::HardBreak => {
                if in_code_block {
                    code_content.push('\n');
                } else {
                    current_text.push(' ');
                }
            }
            Event::Rule => {
                flush_paragraph(&mut blocks, &mut current_text);
                blocks.push(EditorBlock {
                    id: generate_block_id(),
                    block_type: "delimiter".to_string(),
                    data: serde_json::json!({}),
                });
            }
            // Table handling
            Event::Start(Tag::Table(_)) => {
                flush_paragraph(&mut blocks, &mut current_text);
                in_table = true;
                table_rows.clear();
                table_has_header = false;
            }
            Event::End(TagEnd::Table) => {
                in_table = false;
                if !table_rows.is_empty() {
                    blocks.push(EditorBlock {
                        id: generate_block_id(),
                        block_type: "table".to_string(),
                        data: serde_json::json!({
                            "withHeadings": table_has_header,
                            "content": table_rows
                        }),
                    });
                }
                table_rows.clear();
            }
            Event::Start(Tag::TableHead) => {
                table_has_header = true;
                current_table_row.clear();
            }
            Event::End(TagEnd::TableHead) => {
                if !current_table_row.is_empty() {
                    table_rows.push(current_table_row.clone());
                    current_table_row.clear();
                }
            }
            Event::Start(Tag::TableRow) => {
                current_table_row.clear();
            }
            Event::End(TagEnd::TableRow) => {
                if !current_table_row.is_empty() {
                    table_rows.push(current_table_row.clone());
                    current_table_row.clear();
                }
            }
            Event::Start(Tag::TableCell) => {
                current_table_cell.clear();
            }
            Event::End(TagEnd::TableCell) => {
                current_table_row.push(current_table_cell.trim().to_string());
                current_table_cell.clear();
            }
            // Image handling
            Event::Start(Tag::Image { dest_url, title, .. }) => {
                current_image_url = dest_url.to_string();
                current_image_alt.clear();
                // title could be used as caption fallback
                if !title.is_empty() {
                    current_image_alt = title.to_string();
                }
            }
            Event::End(TagEnd::Image) => {
                if !current_image_url.is_empty() {
                    // Use alt text as caption if available
                    let caption = if !current_image_alt.is_empty() {
                        current_image_alt.clone()
                    } else {
                        current_text.trim().to_string()
                    };

                    blocks.push(EditorBlock {
                        id: generate_block_id(),
                        block_type: "image".to_string(),
                        data: serde_json::json!({
                            "file": {
                                "url": current_image_url
                            },
                            "caption": caption,
                            "withBorder": false,
                            "withBackground": false,
                            "stretched": false
                        }),
                    });
                    current_image_url.clear();
                    current_image_alt.clear();
                    current_text.clear();
                }
            }
            _ => {}
        }
    }

    // Flush any remaining content
    flush_paragraph(&mut blocks, &mut current_text);

    blocks
}

/// Convert heading level enum to integer
fn heading_level_to_int(level: HeadingLevel) -> u8 {
    match level {
        HeadingLevel::H1 => 1,
        HeadingLevel::H2 => 2,
        HeadingLevel::H3 => 3,
        HeadingLevel::H4 => 4,
        HeadingLevel::H5 => 5,
        HeadingLevel::H6 => 6,
    }
}

/// Flush current text as a paragraph block
fn flush_paragraph(blocks: &mut Vec<EditorBlock>, text: &mut String) {
    let trimmed = text.trim();
    if !trimmed.is_empty() {
        blocks.push(EditorBlock {
            id: generate_block_id(),
            block_type: "paragraph".to_string(),
            data: serde_json::json!({
                "text": trimmed
            }),
        });
    }
    text.clear();
}

/// Parse a checklist item pattern: "[ ]" or "[x]" at the start
fn parse_checklist_item(text: &str) -> Option<(String, bool)> {
    let text = text.trim();
    if text.starts_with("[ ] ") {
        Some((text[4..].to_string(), false))
    } else if text.starts_with("[x] ") || text.starts_with("[X] ") {
        Some((text[4..].to_string(), true))
    } else {
        None
    }
}

/// Try to parse entire text as checklist items
fn try_parse_checklist(text: &str) -> Option<Vec<(String, bool)>> {
    let lines: Vec<&str> = text.lines().collect();
    let mut items = Vec::new();

    for line in lines {
        let line = line.trim();
        if line.starts_with("- [ ] ") {
            items.push((line[6..].to_string(), false));
        } else if line.starts_with("- [x] ") || line.starts_with("- [X] ") {
            items.push((line[6..].to_string(), true));
        } else if !line.is_empty() {
            return None; // Not a checklist
        }
    }

    if items.is_empty() {
        None
    } else {
        Some(items)
    }
}

/// Extract title from first heading block
fn extract_title_from_blocks(blocks: &[EditorBlock]) -> Option<String> {
    blocks.iter()
        .find(|b| b.block_type == "header")
        .and_then(|b| b.data.get("text"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Generate a unique block ID
fn generate_block_id() -> String {
    // Generate a short random ID similar to Editor.js
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis();
    format!("{:x}", timestamp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Datelike;

    #[test]
    fn test_parse_frontmatter() {
        let markdown = r#"---
title: "Test Title"
tags:
  - "tag1"
  - "tag2"
created: 2024-01-01T00:00:00Z
updated: 2024-01-02T00:00:00Z
---

# Content here
"#;
        let (fm, body) = parse_frontmatter(markdown);
        assert_eq!(fm.title, Some("Test Title".to_string()));
        assert_eq!(fm.tags, vec!["tag1", "tag2"]);
        assert!(body.contains("# Content here"));
    }

    #[test]
    fn test_parse_frontmatter_no_frontmatter() {
        let markdown = "# Just a heading\n\nSome content.";
        let (fm, body) = parse_frontmatter(markdown);
        assert_eq!(fm.title, None);
        assert!(fm.tags.is_empty());
        assert_eq!(body, markdown);
    }

    #[test]
    fn test_parse_yaml_string_quoted() {
        assert_eq!(parse_yaml_string("\"quoted value\""), "quoted value");
        assert_eq!(parse_yaml_string("'single quoted'"), "single quoted");
        assert_eq!(parse_yaml_string("unquoted"), "unquoted");
    }

    #[test]
    fn test_import_simple_markdown() {
        let markdown = r#"# Hello World

This is a paragraph.

- Item 1
- Item 2

> A quote
"#;
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        assert_eq!(page.title, "Hello World");
        assert!(!page.content.blocks.is_empty());

        let block_types: Vec<&str> = page.content.blocks.iter()
            .map(|b| b.block_type.as_str())
            .collect();

        assert!(block_types.contains(&"header"));
        assert!(block_types.contains(&"paragraph"));
        assert!(block_types.contains(&"list"));
        assert!(block_types.contains(&"quote"));
    }

    #[test]
    fn test_import_checklist() {
        let markdown = r#"- [ ] Task 1
- [x] Task 2
"#;
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        let checklist = page.content.blocks.iter()
            .find(|b| b.block_type == "checklist");

        assert!(checklist.is_some());
        let items = checklist.unwrap().data.get("items").unwrap().as_array().unwrap();
        assert_eq!(items.len(), 2);
    }

    #[test]
    fn test_import_code_block() {
        let markdown = r#"```rust
fn main() {
    println!("Hello");
}
```
"#;
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        let code_block = page.content.blocks.iter()
            .find(|b| b.block_type == "code");

        assert!(code_block.is_some());
        let block = code_block.unwrap();
        assert_eq!(block.data.get("language").unwrap().as_str().unwrap(), "rust");
        assert!(block.data.get("code").unwrap().as_str().unwrap().contains("fn main()"));
    }

    #[test]
    fn test_import_table() {
        let markdown = r#"| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |
"#;
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        let table_block = page.content.blocks.iter()
            .find(|b| b.block_type == "table");

        assert!(table_block.is_some());
        let block = table_block.unwrap();
        assert!(block.data.get("withHeadings").unwrap().as_bool().unwrap());
        let content = block.data.get("content").unwrap().as_array().unwrap();
        assert_eq!(content.len(), 3); // header + 2 data rows
    }

    #[test]
    fn test_import_callout() {
        let markdown = r#"> [!WARNING] Be Careful
> This is important information.
"#;
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        let callout_block = page.content.blocks.iter()
            .find(|b| b.block_type == "callout");

        assert!(callout_block.is_some());
        let block = callout_block.unwrap();
        assert_eq!(block.data.get("type").unwrap().as_str().unwrap(), "warning");
    }

    #[test]
    fn test_import_ordered_list() {
        let markdown = r#"1. First item
2. Second item
3. Third item
"#;
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        let list_block = page.content.blocks.iter()
            .find(|b| b.block_type == "list");

        assert!(list_block.is_some());
        let block = list_block.unwrap();
        assert_eq!(block.data.get("style").unwrap().as_str().unwrap(), "ordered");
    }

    #[test]
    fn test_import_horizontal_rule() {
        let markdown = r#"Some text

---

More text
"#;
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        let delimiter = page.content.blocks.iter()
            .find(|b| b.block_type == "delimiter");

        assert!(delimiter.is_some());
    }

    #[test]
    fn test_import_with_inline_formatting() {
        let markdown = "This has **bold** and *italic* and `code` text.";
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        let paragraph = page.content.blocks.iter()
            .find(|b| b.block_type == "paragraph");

        assert!(paragraph.is_some());
        let text = paragraph.unwrap().data.get("text").unwrap().as_str().unwrap();
        assert!(text.contains("<b>bold</b>"));
        assert!(text.contains("<i>italic</i>"));
        assert!(text.contains("<code>code</code>"));
    }

    #[test]
    fn test_import_image() {
        let markdown = "![Alt text](https://example.com/image.png)";
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        let image_block = page.content.blocks.iter()
            .find(|b| b.block_type == "image");

        assert!(image_block.is_some());
        let block = image_block.unwrap();
        let url = block.data.get("file").unwrap().get("url").unwrap().as_str().unwrap();
        assert_eq!(url, "https://example.com/image.png");
    }

    #[test]
    fn test_import_uses_fallback_title() {
        let markdown = "Just some content without a heading.";
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Fallback Title");
        assert_eq!(page.title, "Fallback Title");
    }

    #[test]
    fn test_import_preserves_dates_from_frontmatter() {
        let markdown = r#"---
title: "Dated Page"
created: 2023-06-15T10:30:00Z
updated: 2023-06-16T14:00:00Z
---

Content
"#;
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        // Check that dates were parsed from frontmatter
        assert_eq!(page.created_at.year(), 2023);
        assert_eq!(page.created_at.month(), 6);
        assert_eq!(page.created_at.day(), 15);
    }

    #[test]
    fn test_parse_checklist_item() {
        assert_eq!(parse_checklist_item("[ ] unchecked"), Some(("unchecked".to_string(), false)));
        assert_eq!(parse_checklist_item("[x] checked"), Some(("checked".to_string(), true)));
        assert_eq!(parse_checklist_item("[X] checked uppercase"), Some(("checked uppercase".to_string(), true)));
        assert_eq!(parse_checklist_item("not a checklist"), None);
    }

    #[test]
    fn test_heading_levels() {
        let markdown = r#"# H1
## H2
### H3
#### H4
##### H5
###### H6
"#;
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        let headers: Vec<_> = page.content.blocks.iter()
            .filter(|b| b.block_type == "header")
            .collect();

        assert_eq!(headers.len(), 6);

        for (i, header) in headers.iter().enumerate() {
            let level = header.data.get("level").unwrap().as_u64().unwrap();
            assert_eq!(level, (i + 1) as u64);
        }
    }

    #[test]
    fn test_import_link() {
        let markdown = "Check out [this link](https://example.com).";
        let page = import_markdown_to_page(markdown, Uuid::new_v4(), "Untitled");

        let paragraph = page.content.blocks.iter()
            .find(|b| b.block_type == "paragraph");

        assert!(paragraph.is_some());
        let text = paragraph.unwrap().data.get("text").unwrap().as_str().unwrap();
        assert!(text.contains("<a href=\"https://example.com\">this link</a>"));
    }
}
