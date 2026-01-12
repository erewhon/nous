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

    #[test]
    fn test_export_simple_page() {
        let page = Page {
            id: Uuid::new_v4(),
            notebook_id: Uuid::new_v4(),
            title: "Test Page".to_string(),
            content: EditorData {
                time: None,
                version: None,
                blocks: vec![
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
            },
            tags: vec!["test".to_string()],
            created_at: Utc::now(),
            updated_at: Utc::now(),
        };

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
}
