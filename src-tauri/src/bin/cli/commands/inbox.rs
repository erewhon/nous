use anyhow::Result;

use crate::app::App;
use crate::OutputFormat;

pub fn run_capture(
    app: &App,
    title: &str,
    content: Option<String>,
    tags: Option<&str>,
    format: &OutputFormat,
    _use_color: bool,
) -> Result<()> {
    let content_text = content.unwrap_or_default();
    let tag_list = tags.map(|t| {
        t.split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect()
    });

    let item = app.capture_inbox(title.to_string(), content_text, tag_list)?;

    match format {
        OutputFormat::Json => {
            let output = serde_json::json!({
                "id": item.id.to_string(),
                "title": item.title,
                "tags": item.tags,
                "capturedAt": item.captured_at.to_rfc3339(),
            });
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        OutputFormat::Plain => {
            println!("Captured to inbox: \"{}\"", item.title);
            if !item.tags.is_empty() {
                println!("  Tags: {}", item.tags.iter().map(|t| format!("#{}", t)).collect::<Vec<_>>().join(" "));
            }
            println!("  ID: {}", item.id);
        }
    }

    Ok(())
}

pub fn run_list(
    app: &App,
    unprocessed: bool,
    format: &OutputFormat,
    _use_color: bool,
) -> Result<()> {
    let items = app.list_inbox(unprocessed)?;

    match format {
        OutputFormat::Json => {
            let output: Vec<serde_json::Value> = items.iter().map(|item| {
                serde_json::json!({
                    "id": item.id.to_string(),
                    "title": item.title,
                    "content": item.content,
                    "tags": item.tags,
                    "capturedAt": item.captured_at.to_rfc3339(),
                    "isProcessed": item.is_processed,
                    "source": format!("{:?}", item.source),
                })
            }).collect();
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        OutputFormat::Plain => {
            if items.is_empty() {
                println!("No inbox items{}.", if unprocessed { " (unprocessed)" } else { "" });
                return Ok(());
            }

            let title_width = items.iter().map(|i| i.title.len()).max().unwrap_or(5).min(40).max(5);
            let status_width = 11;
            let tags_width = 20;

            println!("{:<tw$} {:<sw$} {:<tgw$} {}",
                "Title", "Status", "Tags", "Captured",
                tw = title_width, sw = status_width, tgw = tags_width);
            println!("{} {} {} {}",
                "\u{2500}".repeat(title_width),
                "\u{2500}".repeat(status_width),
                "\u{2500}".repeat(tags_width),
                "\u{2500}".repeat(10));

            for item in &items {
                let title = if item.title.len() > title_width {
                    format!("{}...", &item.title[..title_width - 3])
                } else {
                    item.title.clone()
                };

                let status = if item.is_processed {
                    "processed"
                } else if item.classification.is_some() {
                    "classified"
                } else {
                    "pending"
                };

                let tags = item.tags.iter()
                    .map(|t| format!("#{}", t))
                    .collect::<Vec<_>>()
                    .join(" ");
                let tags_display = if tags.len() > tags_width {
                    format!("{}...", &tags[..tags_width - 3])
                } else {
                    tags
                };

                let captured = item.captured_at.format("%Y-%m-%d").to_string();

                println!("{:<tw$} {:<sw$} {:<tgw$} {}",
                    title, status, tags_display, captured,
                    tw = title_width, sw = status_width, tgw = tags_width);
            }

            println!("\n{} items total", items.len());
        }
    }

    Ok(())
}
