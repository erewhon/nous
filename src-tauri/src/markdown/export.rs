use crate::storage::{EditorBlock, Page};
use regex::Regex;

/// Export a Page to Markdown format with YAML frontmatter
pub fn export_page_to_markdown(page: &Page) -> String {
    let mut output = String::new();

    // Generate YAML frontmatter
    output.push_str("---\n");
    output.push_str(&format!("title: \"{}\"\n", escape_yaml_string(&page.title)));

    if !page.tags.is_empty() {
        output.push_str("tags:\n");
        for tag in &page.tags {
            output.push_str(&format!("  - \"{}\"\n", escape_yaml_string(tag)));
        }
    }

    output.push_str(&format!("created: {}\n", page.created_at.to_rfc3339()));
    output.push_str(&format!("updated: {}\n", page.updated_at.to_rfc3339()));
    output.push_str("---\n\n");

    // Convert blocks to markdown
    for block in &page.content.blocks {
        let block_md = convert_block_to_markdown(block);
        if !block_md.is_empty() {
            output.push_str(&block_md);
            output.push_str("\n\n");
        }
    }

    // Remove trailing whitespace
    output.trim_end().to_string() + "\n"
}

/// Convert a single EditorBlock to Markdown
fn convert_block_to_markdown(block: &EditorBlock) -> String {
    match block.block_type.as_str() {
        "header" => convert_header(block),
        "paragraph" => convert_paragraph(block),
        "list" => convert_list(block),
        "checklist" => convert_checklist(block),
        "code" => convert_code(block),
        "quote" => convert_quote(block),
        "delimiter" => "---".to_string(),
        "table" => convert_table(block),
        "callout" => convert_callout(block),
        "image" => convert_image(block),
        _ => String::new(), // Skip unknown block types
    }
}

fn convert_header(block: &EditorBlock) -> String {
    let text = block.data.get("text")
        .and_then(|v| v.as_str())
        .map(strip_html_tags)
        .unwrap_or_default();

    let level = block.data.get("level")
        .and_then(|v| v.as_u64())
        .unwrap_or(2) as usize;

    let prefix = "#".repeat(level.min(6));
    format!("{} {}", prefix, text)
}

fn convert_paragraph(block: &EditorBlock) -> String {
    block.data.get("text")
        .and_then(|v| v.as_str())
        .map(|text| convert_inline_html_to_markdown(text))
        .unwrap_or_default()
}

fn convert_list(block: &EditorBlock) -> String {
    let items = block.data.get("items")
        .and_then(|v| v.as_array())
        .map(|arr| arr.to_vec())
        .unwrap_or_default();

    let style = block.data.get("style")
        .and_then(|v| v.as_str())
        .unwrap_or("unordered");

    let is_ordered = style == "ordered";

    items.iter()
        .enumerate()
        .map(|(i, item)| {
            let text = extract_list_item_text(item);
            let cleaned = convert_inline_html_to_markdown(&text);
            if is_ordered {
                format!("{}. {}", i + 1, cleaned)
            } else {
                format!("- {}", cleaned)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn convert_checklist(block: &EditorBlock) -> String {
    let items = block.data.get("items")
        .and_then(|v| v.as_array())
        .map(|arr| arr.to_vec())
        .unwrap_or_default();

    items.iter()
        .map(|item| {
            let text = item.get("text")
                .and_then(|v| v.as_str())
                .map(|s| convert_inline_html_to_markdown(s))
                .unwrap_or_default();
            let checked = item.get("checked")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            if checked {
                format!("- [x] {}", text)
            } else {
                format!("- [ ] {}", text)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn convert_code(block: &EditorBlock) -> String {
    let code = block.data.get("code")
        .and_then(|v| v.as_str())
        .unwrap_or_default();

    let language = block.data.get("language")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    format!("```{}\n{}\n```", language, code)
}

fn convert_quote(block: &EditorBlock) -> String {
    let text = block.data.get("text")
        .and_then(|v| v.as_str())
        .map(|text| convert_inline_html_to_markdown(text))
        .unwrap_or_default();

    // Handle multi-line quotes
    text.lines()
        .map(|line| format!("> {}", line))
        .collect::<Vec<_>>()
        .join("\n")
}

fn convert_table(block: &EditorBlock) -> String {
    let content = block.data.get("content")
        .and_then(|v| v.as_array())
        .map(|arr| arr.to_vec())
        .unwrap_or_default();

    let with_headings = block.data.get("withHeadings")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if content.is_empty() {
        return String::new();
    }

    let mut lines: Vec<String> = Vec::new();

    for (row_idx, row) in content.iter().enumerate() {
        let cells: Vec<String> = row.as_array()
            .map(|arr| {
                arr.iter()
                    .map(|cell| {
                        cell.as_str()
                            .map(|s| convert_inline_html_to_markdown(s))
                            .unwrap_or_default()
                    })
                    .collect()
            })
            .unwrap_or_default();

        let row_str = format!("| {} |", cells.join(" | "));
        lines.push(row_str);

        // Add separator after header row
        if row_idx == 0 && with_headings {
            let separator = format!("| {} |",
                cells.iter().map(|_| "---").collect::<Vec<_>>().join(" | ")
            );
            lines.push(separator);
        }
    }

    lines.join("\n")
}

fn convert_callout(block: &EditorBlock) -> String {
    let callout_type = block.data.get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("info")
        .to_uppercase();

    let title = block.data.get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let content = block.data.get("content")
        .and_then(|v| v.as_str())
        .map(|text| convert_inline_html_to_markdown(text))
        .unwrap_or_default();

    let mut lines: Vec<String> = Vec::new();

    // First line: > [!TYPE] Title (or just > [!TYPE] if no title)
    if title.is_empty() {
        lines.push(format!("> [!{}]", callout_type));
    } else {
        lines.push(format!("> [!{}] {}", callout_type, title));
    }

    // Content lines, each prefixed with >
    for line in content.lines() {
        lines.push(format!("> {}", line));
    }

    lines.join("\n")
}

fn convert_image(block: &EditorBlock) -> String {
    let file_data = block.data.get("file");
    let url = file_data
        .and_then(|f| f.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let caption = block.data.get("caption")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if url.is_empty() {
        return String::new();
    }

    // Convert asset:// URLs to relative paths
    let relative_path = if url.contains("/assets/") {
        // Extract just the assets/filename part
        if let Some(pos) = url.rfind("/assets/") {
            &url[pos + 1..] // Skip the leading /
        } else {
            url
        }
    } else {
        url
    };

    format!("![{}]({})", caption, relative_path)
}

/// Extract text from list item (handles both string and object formats)
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

/// Strip HTML tags from text, preserving wiki-links
fn strip_html_tags(text: &str) -> String {
    // Simple regex to remove HTML tags
    let re = Regex::new(r"<[^>]+>").unwrap();
    re.replace_all(text, "").to_string()
}

/// Convert inline HTML formatting to Markdown equivalents
fn convert_inline_html_to_markdown(text: &str) -> String {
    let mut result = text.to_string();

    // Convert bold: <b>text</b> or <strong>text</strong> -> **text**
    let bold_re = Regex::new(r"<(?:b|strong)>([^<]*)</(?:b|strong)>").unwrap();
    result = bold_re.replace_all(&result, "**$1**").to_string();

    // Convert italic: <i>text</i> or <em>text</em> -> *text*
    let italic_re = Regex::new(r"<(?:i|em)>([^<]*)</(?:i|em)>").unwrap();
    result = italic_re.replace_all(&result, "*$1*").to_string();

    // Convert inline code: <code>text</code> -> `text`
    let code_re = Regex::new(r"<code>([^<]*)</code>").unwrap();
    result = code_re.replace_all(&result, "`$1`").to_string();

    // Convert links: <a href="url">text</a> -> [text](url)
    let link_re = Regex::new(r#"<a[^>]*href="([^"]*)"[^>]*>([^<]*)</a>"#).unwrap();
    result = link_re.replace_all(&result, "[$2]($1)").to_string();

    // Convert mark/highlight: <mark>text</mark> -> ==text== (common markdown extension)
    let mark_re = Regex::new(r"<mark[^>]*>([^<]*)</mark>").unwrap();
    result = mark_re.replace_all(&result, "==$1==").to_string();

    // Strip any remaining HTML tags
    let remaining_re = Regex::new(r"<[^>]+>").unwrap();
    result = remaining_re.replace_all(&result, "").to_string();

    // Decode common HTML entities
    result = result
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&nbsp;", " ");

    result
}

/// Escape special characters for YAML strings
fn escape_yaml_string(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::EditorData;
    use chrono::Utc;
    use uuid::Uuid;

    fn create_test_page(title: &str, blocks: Vec<EditorBlock>, tags: Vec<String>) -> Page {
        Page {
            id: Uuid::new_v4(),
            notebook_id: Uuid::new_v4(),
            title: title.to_string(),
            content: EditorData {
                time: None,
                version: None,
                blocks,
            },
            tags,
            folder_id: None,
            parent_page_id: None,
            section_id: None,
            is_archived: false,
            is_cover: false,
            position: 0,
            system_prompt: None,
            system_prompt_mode: crate::storage::SystemPromptMode::default(),
            ai_model: None,
            page_type: crate::storage::PageType::default(),
            source_file: None,
            storage_mode: None,
            file_extension: None,
            last_file_sync: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn test_export_simple_page() {
        let page = create_test_page(
            "Test Page",
            vec![
                EditorBlock {
                    id: "1".to_string(),
                    block_type: "header".to_string(),
                    data: serde_json::json!({
                        "text": "Hello World",
                        "level": 1
                    }),
                },
                EditorBlock {
                    id: "2".to_string(),
                    block_type: "paragraph".to_string(),
                    data: serde_json::json!({
                        "text": "This is a test paragraph."
                    }),
                },
            ],
            vec!["test".to_string()],
        );

        let markdown = export_page_to_markdown(&page);

        assert!(markdown.contains("title: \"Test Page\""));
        assert!(markdown.contains("# Hello World"));
        assert!(markdown.contains("This is a test paragraph."));
        assert!(markdown.contains("- \"test\""));
    }

    #[test]
    fn test_convert_checklist() {
        let block = EditorBlock {
            id: "1".to_string(),
            block_type: "checklist".to_string(),
            data: serde_json::json!({
                "items": [
                    { "text": "Task 1", "checked": true },
                    { "text": "Task 2", "checked": false },
                ]
            }),
        };

        let result = convert_block_to_markdown(&block);
        assert!(result.contains("- [x] Task 1"));
        assert!(result.contains("- [ ] Task 2"));
    }

    #[test]
    fn test_convert_code_block() {
        let block = EditorBlock {
            id: "1".to_string(),
            block_type: "code".to_string(),
            data: serde_json::json!({
                "code": "fn main() {\n    println!(\"Hello\");\n}",
                "language": "rust"
            }),
        };

        let result = convert_block_to_markdown(&block);
        assert!(result.starts_with("```rust"));
        assert!(result.contains("fn main()"));
        assert!(result.ends_with("```"));
    }

    #[test]
    fn test_convert_ordered_list() {
        let block = EditorBlock {
            id: "1".to_string(),
            block_type: "list".to_string(),
            data: serde_json::json!({
                "style": "ordered",
                "items": ["First", "Second", "Third"]
            }),
        };

        let result = convert_block_to_markdown(&block);
        assert!(result.contains("1. First"));
        assert!(result.contains("2. Second"));
        assert!(result.contains("3. Third"));
    }

    #[test]
    fn test_convert_unordered_list() {
        let block = EditorBlock {
            id: "1".to_string(),
            block_type: "list".to_string(),
            data: serde_json::json!({
                "style": "unordered",
                "items": ["Apple", "Banana", "Cherry"]
            }),
        };

        let result = convert_block_to_markdown(&block);
        assert!(result.contains("- Apple"));
        assert!(result.contains("- Banana"));
        assert!(result.contains("- Cherry"));
    }

    #[test]
    fn test_convert_table() {
        let block = EditorBlock {
            id: "1".to_string(),
            block_type: "table".to_string(),
            data: serde_json::json!({
                "withHeadings": true,
                "content": [
                    ["Name", "Age"],
                    ["Alice", "30"],
                    ["Bob", "25"]
                ]
            }),
        };

        let result = convert_block_to_markdown(&block);
        assert!(result.contains("| Name | Age |"));
        assert!(result.contains("| --- | --- |"));
        assert!(result.contains("| Alice | 30 |"));
        assert!(result.contains("| Bob | 25 |"));
    }

    #[test]
    fn test_convert_callout() {
        let block = EditorBlock {
            id: "1".to_string(),
            block_type: "callout".to_string(),
            data: serde_json::json!({
                "type": "warning",
                "title": "Important",
                "content": "Be careful with this operation."
            }),
        };

        let result = convert_block_to_markdown(&block);
        assert!(result.contains("> [!WARNING] Important"));
        assert!(result.contains("> Be careful with this operation."));
    }

    #[test]
    fn test_convert_image() {
        let block = EditorBlock {
            id: "1".to_string(),
            block_type: "image".to_string(),
            data: serde_json::json!({
                "file": {
                    "url": "/path/to/assets/image.png"
                },
                "caption": "A test image"
            }),
        };

        let result = convert_block_to_markdown(&block);
        assert!(result.contains("![A test image]"));
        assert!(result.contains("assets/image.png"));
    }

    #[test]
    fn test_convert_quote() {
        let block = EditorBlock {
            id: "1".to_string(),
            block_type: "quote".to_string(),
            data: serde_json::json!({
                "text": "To be or not to be.\nThat is the question."
            }),
        };

        let result = convert_block_to_markdown(&block);
        assert!(result.contains("> To be or not to be."));
        assert!(result.contains("> That is the question."));
    }

    #[test]
    fn test_convert_delimiter() {
        let block = EditorBlock {
            id: "1".to_string(),
            block_type: "delimiter".to_string(),
            data: serde_json::json!({}),
        };

        let result = convert_block_to_markdown(&block);
        assert_eq!(result, "---");
    }

    #[test]
    fn test_convert_inline_formatting() {
        let result = convert_inline_html_to_markdown("<b>bold</b> and <i>italic</i>");
        assert_eq!(result, "**bold** and *italic*");
    }

    #[test]
    fn test_convert_inline_code() {
        let result = convert_inline_html_to_markdown("Use <code>println!</code> to print");
        assert_eq!(result, "Use `println!` to print");
    }

    #[test]
    fn test_convert_inline_link() {
        let result = convert_inline_html_to_markdown("Visit <a href=\"https://example.com\">Example</a>");
        assert_eq!(result, "Visit [Example](https://example.com)");
    }

    #[test]
    fn test_escape_yaml_string() {
        assert_eq!(escape_yaml_string("simple"), "simple");
        assert_eq!(escape_yaml_string("with \"quotes\""), "with \\\"quotes\\\"");
        assert_eq!(escape_yaml_string("back\\slash"), "back\\\\slash");
    }

    #[test]
    fn test_export_page_with_no_tags() {
        let page = create_test_page(
            "No Tags Page",
            vec![EditorBlock {
                id: "1".to_string(),
                block_type: "paragraph".to_string(),
                data: serde_json::json!({ "text": "Content here" }),
            }],
            vec![],
        );

        let markdown = export_page_to_markdown(&page);
        assert!(markdown.contains("title: \"No Tags Page\""));
        assert!(!markdown.contains("tags:"));
    }

    #[test]
    fn test_export_page_with_special_characters() {
        let page = create_test_page(
            "Page with \"quotes\" and \\backslash",
            vec![EditorBlock {
                id: "1".to_string(),
                block_type: "paragraph".to_string(),
                data: serde_json::json!({ "text": "Content with <special> chars & entities" }),
            }],
            vec![],
        );

        let markdown = export_page_to_markdown(&page);
        assert!(markdown.contains("\\\"quotes\\\""));
        assert!(markdown.contains("\\\\backslash"));
    }

    #[test]
    fn test_header_levels() {
        for level in 1..=6 {
            let block = EditorBlock {
                id: "1".to_string(),
                block_type: "header".to_string(),
                data: serde_json::json!({
                    "text": "Header",
                    "level": level
                }),
            };
            let result = convert_block_to_markdown(&block);
            let expected_prefix = "#".repeat(level);
            assert!(result.starts_with(&format!("{} ", expected_prefix)));
        }
    }
}
