use nous_lib::storage::EditorBlock;
use regex::Regex;

/// ANSI color codes
#[allow(dead_code)]
pub struct Color;

#[allow(dead_code)]
impl Color {
    pub const RESET: &str = "\x1b[0m";
    pub const BOLD: &str = "\x1b[1m";
    pub const DIM: &str = "\x1b[2m";
    pub const ITALIC: &str = "\x1b[3m";
    pub const STRIKETHROUGH: &str = "\x1b[9m";
    pub const RED: &str = "\x1b[31m";
    pub const GREEN: &str = "\x1b[32m";
    pub const YELLOW: &str = "\x1b[33m";
    pub const BLUE: &str = "\x1b[34m";
    pub const MAGENTA: &str = "\x1b[35m";
    pub const CYAN: &str = "\x1b[36m";
    pub const GRAY: &str = "\x1b[90m";
}

/// Render Editor.js blocks to terminal text
pub fn render_blocks(blocks: &[EditorBlock], use_color: bool) -> String {
    let mut lines = Vec::new();

    for block in blocks {
        let block_lines = render_block(block, use_color, 0);
        if !block_lines.is_empty() {
            lines.extend(block_lines);
            lines.push(String::new()); // blank line between blocks
        }
    }

    // Remove trailing blank line
    while lines.last().map_or(false, |l| l.is_empty()) {
        lines.pop();
    }

    lines.join("\n")
}

fn render_block(block: &EditorBlock, use_color: bool, indent: usize) -> Vec<String> {
    let prefix = " ".repeat(indent);
    match block.block_type.as_str() {
        "paragraph" => render_paragraph(block, use_color, &prefix),
        "header" => render_header(block, use_color, &prefix),
        "list" => render_list(block, use_color, &prefix),
        "checklist" => render_checklist(block, use_color, &prefix),
        "code" => render_code(block, use_color, &prefix),
        "quote" => render_quote(block, use_color, &prefix),
        "table" => render_table(block, use_color, &prefix),
        "callout" => render_callout(block, use_color, &prefix),
        "image" => render_image(block, &prefix),
        "delimiter" => vec![format!("{}~~~", prefix)],
        "columns" => render_columns(block, use_color, &prefix),
        _ => render_generic(block, use_color, &prefix),
    }
}

fn render_paragraph(block: &EditorBlock, use_color: bool, prefix: &str) -> Vec<String> {
    if let Some(text) = block.data.get("text").and_then(|v| v.as_str()) {
        let plain = html_to_terminal(text, use_color);
        wrap_lines(&plain, prefix, 80)
    } else {
        Vec::new()
    }
}

fn render_header(block: &EditorBlock, use_color: bool, prefix: &str) -> Vec<String> {
    if let Some(text) = block.data.get("text").and_then(|v| v.as_str()) {
        let level = block.data.get("level").and_then(|v| v.as_u64()).unwrap_or(2);
        let hashes = "#".repeat(level as usize);
        let plain = strip_html(text);

        if use_color {
            vec![format!("{}{}{} {}{}", prefix, Color::BOLD, hashes, plain, Color::RESET)]
        } else {
            vec![format!("{}{} {}", prefix, hashes, plain)]
        }
    } else {
        Vec::new()
    }
}

fn render_list(block: &EditorBlock, use_color: bool, prefix: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let style = block.data.get("style").and_then(|v| v.as_str()).unwrap_or("unordered");

    if let Some(items) = block.data.get("items").and_then(|v| v.as_array()) {
        render_list_items(&mut lines, items, style, use_color, prefix, 0);
    }

    lines
}

fn render_list_items(
    lines: &mut Vec<String>,
    items: &[serde_json::Value],
    style: &str,
    use_color: bool,
    prefix: &str,
    depth: usize,
) {
    let indent = "  ".repeat(depth);
    for (i, item) in items.iter().enumerate() {
        let text = if let Some(s) = item.as_str() {
            s.to_string()
        } else if let Some(obj) = item.as_object() {
            obj.get("content")
                .or(obj.get("text"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        } else {
            continue;
        };

        let plain = html_to_terminal(&text, use_color);
        let bullet = if style == "ordered" {
            format!("{}. ", i + 1)
        } else {
            "\u{2022} ".to_string()
        };
        lines.push(format!("{}{}{}{}", prefix, indent, bullet, plain));

        // Handle nested items
        if let Some(obj) = item.as_object() {
            if let Some(children) = obj.get("items").and_then(|v| v.as_array()) {
                render_list_items(lines, children, style, use_color, prefix, depth + 1);
            }
        }
    }
}

fn render_checklist(block: &EditorBlock, use_color: bool, prefix: &str) -> Vec<String> {
    let mut lines = Vec::new();

    if let Some(items) = block.data.get("items").and_then(|v| v.as_array()) {
        for item in items {
            if let Some(obj) = item.as_object() {
                let text = obj.get("text")
                    .or(obj.get("content"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let checked = obj.get("checked").and_then(|v| v.as_bool()).unwrap_or(false);
                let plain = html_to_terminal(text, use_color);

                if checked {
                    if use_color {
                        lines.push(format!("{}[x] {}{}{}", prefix, Color::STRIKETHROUGH, plain, Color::RESET));
                    } else {
                        lines.push(format!("{}[x] {}", prefix, plain));
                    }
                } else {
                    lines.push(format!("{}[ ] {}", prefix, plain));
                }
            }
        }
    }

    lines
}

fn render_code(block: &EditorBlock, use_color: bool, prefix: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let lang = block.data.get("language")
        .or(block.data.get("lang"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if let Some(code) = block.data.get("code").and_then(|v| v.as_str()) {
        if use_color {
            lines.push(format!("{}{}```{}{}", prefix, Color::CYAN, lang, Color::RESET));
            for line in code.lines() {
                lines.push(format!("{}{}{}{}", prefix, Color::CYAN, line, Color::RESET));
            }
            lines.push(format!("{}{}```{}", prefix, Color::CYAN, Color::RESET));
        } else {
            lines.push(format!("{}```{}", prefix, lang));
            for line in code.lines() {
                lines.push(format!("{}{}", prefix, line));
            }
            lines.push(format!("{}```", prefix));
        }
    }

    lines
}

fn render_quote(block: &EditorBlock, use_color: bool, prefix: &str) -> Vec<String> {
    let mut lines = Vec::new();

    if let Some(text) = block.data.get("text").and_then(|v| v.as_str()) {
        let plain = html_to_terminal(text, use_color);
        for line in plain.lines() {
            if use_color {
                lines.push(format!("{}{}\u{2502} {}{}", prefix, Color::DIM, line, Color::RESET));
            } else {
                lines.push(format!("{}> {}", prefix, line));
            }
        }
    }

    lines
}

fn render_table(block: &EditorBlock, _use_color: bool, prefix: &str) -> Vec<String> {
    let mut lines = Vec::new();

    let with_headings = block.data.get("withHeadings").and_then(|v| v.as_bool()).unwrap_or(false);

    if let Some(content) = block.data.get("content").and_then(|v| v.as_array()) {
        if content.is_empty() {
            return lines;
        }

        // Calculate column widths
        let mut col_widths: Vec<usize> = Vec::new();
        for row in content {
            if let Some(cells) = row.as_array() {
                for (i, cell) in cells.iter().enumerate() {
                    let text = cell.as_str().unwrap_or("");
                    let plain = strip_html(text);
                    let width = plain.len().max(3);
                    if i >= col_widths.len() {
                        col_widths.push(width);
                    } else {
                        col_widths[i] = col_widths[i].max(width);
                    }
                }
            }
        }

        for (row_idx, row) in content.iter().enumerate() {
            if let Some(cells) = row.as_array() {
                let mut parts = Vec::new();
                for (i, cell) in cells.iter().enumerate() {
                    let text = cell.as_str().unwrap_or("");
                    let plain = strip_html(text);
                    let width = col_widths.get(i).copied().unwrap_or(3);
                    parts.push(format!("{:width$}", plain, width = width));
                }
                lines.push(format!("{}\u{2502} {} \u{2502}", prefix, parts.join(" \u{2502} ")));

                // Header separator
                if row_idx == 0 && with_headings {
                    let sep: Vec<String> = col_widths.iter()
                        .map(|w| "\u{2500}".repeat(*w))
                        .collect();
                    lines.push(format!("{}\u{251c}\u{2500}{}\u{2500}\u{2524}", prefix,
                        sep.join("\u{2500}\u{253c}\u{2500}")));
                }
            }
        }
    }

    lines
}

fn render_callout(block: &EditorBlock, use_color: bool, prefix: &str) -> Vec<String> {
    let mut lines = Vec::new();

    let callout_type = block.data.get("type")
        .or(block.data.get("style"))
        .and_then(|v| v.as_str())
        .unwrap_or("info");

    let icon = match callout_type {
        "warning" | "warn" => "[!]",
        "error" | "danger" => "[X]",
        "success" | "tip" => "[*]",
        _ => "[i]", // info
    };

    if let Some(text) = block.data.get("text")
        .or(block.data.get("message"))
        .and_then(|v| v.as_str())
    {
        let plain = html_to_terminal(text, use_color);
        let color = if use_color {
            match callout_type {
                "warning" | "warn" => Color::YELLOW,
                "error" | "danger" => Color::RED,
                "success" | "tip" => Color::GREEN,
                _ => Color::BLUE,
            }
        } else {
            ""
        };
        let reset = if use_color { Color::RESET } else { "" };

        for (i, line) in plain.lines().enumerate() {
            if i == 0 {
                lines.push(format!("{}{}{} {}{}", prefix, color, icon, line, reset));
            } else {
                lines.push(format!("{}{}    {}{}", prefix, color, line, reset));
            }
        }
    }

    lines
}

fn render_image(block: &EditorBlock, prefix: &str) -> Vec<String> {
    let filename = block.data.get("file")
        .and_then(|v| v.get("url"))
        .and_then(|v| v.as_str())
        .or_else(|| block.data.get("url").and_then(|v| v.as_str()))
        .unwrap_or("unknown");

    let caption = block.data.get("caption").and_then(|v| v.as_str()).unwrap_or("");

    if caption.is_empty() {
        vec![format!("{}[Image: {}]", prefix, filename)]
    } else {
        vec![format!("{}[Image: {} - {}]", prefix, filename, strip_html(caption))]
    }
}

fn render_columns(block: &EditorBlock, use_color: bool, prefix: &str) -> Vec<String> {
    let mut lines = Vec::new();

    if let Some(cols) = block.data.get("cols").and_then(|v| v.as_array()) {
        for (i, col) in cols.iter().enumerate() {
            if i > 0 {
                lines.push(String::new());
            }
            if let Some(blocks) = col.get("blocks").and_then(|v| v.as_array()) {
                for block_val in blocks {
                    if let Ok(b) = serde_json::from_value::<EditorBlock>(block_val.clone()) {
                        lines.extend(render_block(&b, use_color, prefix.len()));
                    }
                }
            }
        }
    }

    lines
}

fn render_generic(block: &EditorBlock, use_color: bool, prefix: &str) -> Vec<String> {
    // Try to extract common text fields
    if let Some(text) = block.data.get("text").and_then(|v| v.as_str()) {
        let plain = html_to_terminal(text, use_color);
        return wrap_lines(&plain, prefix, 80);
    }
    Vec::new()
}

/// Convert HTML to terminal text, preserving wiki-links and block-refs
fn html_to_terminal(html: &str, _use_color: bool) -> String {
    let mut text = html.to_string();

    // Convert <wiki-link> to [[title]]
    let wl_re = Regex::new(r#"<wiki-link[^>]*data-page-title="([^"]*)"[^>]*>[^<]*</wiki-link>"#).unwrap();
    text = wl_re.replace_all(&text, "[[${1}]]").to_string();

    // Alternative wiki-link pattern
    let wl_re2 = Regex::new(r#"<wiki-link[^>]*>([^<]*)</wiki-link>"#).unwrap();
    text = wl_re2.replace_all(&text, "[[${1}]]").to_string();

    // Convert <block-ref> to ((id))
    let br_re = Regex::new(r#"<block-ref[^>]*data-block-ref-id="([^"]*)"[^>]*>[^<]*</block-ref>"#).unwrap();
    text = br_re.replace_all(&text, "((${1}))").to_string();

    let br_re2 = Regex::new(r#"<block-ref[^>]*>([^<]*)</block-ref>"#).unwrap();
    text = br_re2.replace_all(&text, "((${1}))").to_string();

    // Strip remaining HTML tags
    strip_html(&text)
}

/// Strip HTML tags and decode entities
fn strip_html(html: &str) -> String {
    let mut result = String::with_capacity(html.len());
    let mut in_tag = false;

    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
        } else if ch == '>' {
            in_tag = false;
        } else if !in_tag {
            result.push(ch);
        }
    }

    result
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

/// Simple word-wrapping for terminal output
fn wrap_lines(text: &str, prefix: &str, max_width: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let effective_width = max_width.saturating_sub(prefix.len());

    for line in text.lines() {
        if line.len() <= effective_width {
            lines.push(format!("{}{}", prefix, line));
        } else {
            // Simple word wrap
            let words: Vec<&str> = line.split_whitespace().collect();
            let mut current_line = String::new();
            for word in words {
                if current_line.is_empty() {
                    current_line = word.to_string();
                } else if current_line.len() + 1 + word.len() <= effective_width {
                    current_line.push(' ');
                    current_line.push_str(word);
                } else {
                    lines.push(format!("{}{}", prefix, current_line));
                    current_line = word.to_string();
                }
            }
            if !current_line.is_empty() {
                lines.push(format!("{}{}", prefix, current_line));
            }
        }
    }

    if lines.is_empty() && !text.is_empty() {
        lines.push(format!("{}{}", prefix, text));
    }

    lines
}

/// Render blocks to plain text lines (for TUI use - no ANSI codes)
pub fn render_blocks_plain(blocks: &[EditorBlock]) -> Vec<String> {
    let output = render_blocks(blocks, false);
    output.lines().map(String::from).collect()
}
