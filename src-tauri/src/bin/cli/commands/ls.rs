use anyhow::Result;

use crate::app::App;
use crate::OutputFormat;

pub fn run(
    app: &App,
    notebook_name: &str,
    folder_name: Option<&str>,
    format: &OutputFormat,
    _use_color: bool,
) -> Result<()> {
    let notebook = app.find_notebook(notebook_name)?;
    let mut pages = app.list_pages(notebook.id)?;

    // Filter by folder if specified
    if let Some(fname) = folder_name {
        let folders = app.list_folders(notebook.id)?;
        let folder = folders.iter()
            .find(|f| f.name.to_lowercase() == fname.to_lowercase()
                || f.name.to_lowercase().starts_with(&fname.to_lowercase()))
            .ok_or_else(|| anyhow::anyhow!("Folder '{}' not found", fname))?;

        pages.retain(|p| p.folder_id == Some(folder.id));
    }

    // Filter out deleted pages
    pages.retain(|p| p.deleted_at.is_none());

    // Sort by updated_at descending
    pages.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    match format {
        OutputFormat::Json => {
            let output: Vec<serde_json::Value> = pages.iter().map(|p| {
                serde_json::json!({
                    "id": p.id.to_string(),
                    "title": p.title,
                    "pageType": format!("{:?}", p.page_type).to_lowercase(),
                    "tags": p.tags,
                    "folderId": p.folder_id.map(|f| f.to_string()),
                    "updatedAt": p.updated_at.to_rfc3339(),
                    "createdAt": p.created_at.to_rfc3339(),
                })
            }).collect();
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        OutputFormat::Plain => {
            if pages.is_empty() {
                println!("No pages found.");
                return Ok(());
            }

            // Calculate column widths
            let title_width = pages.iter().map(|p| p.title.len()).max().unwrap_or(5).min(40).max(5);
            let type_width = 10;
            let tags_width = 25;

            // Header
            println!("{:<title_w$} {:<type_w$} {:<tags_w$} {}",
                "Title", "Type", "Tags", "Updated",
                title_w = title_width, type_w = type_width, tags_w = tags_width);
            println!("{} {} {} {}",
                "\u{2500}".repeat(title_width),
                "\u{2500}".repeat(type_width),
                "\u{2500}".repeat(tags_width),
                "\u{2500}".repeat(10));

            for page in &pages {
                let title = if page.title.len() > title_width {
                    format!("{}...", &page.title[..title_width - 3])
                } else {
                    page.title.clone()
                };

                let page_type = format!("{:?}", page.page_type).to_lowercase();
                let tags = page.tags.iter()
                    .map(|t| format!("#{}", t))
                    .collect::<Vec<_>>()
                    .join(" ");
                let tags_display = if tags.len() > tags_width {
                    format!("{}...", &tags[..tags_width - 3])
                } else {
                    tags
                };

                let updated = page.updated_at.format("%Y-%m-%d").to_string();

                println!("{:<title_w$} {:<type_w$} {:<tags_w$} {}",
                    title, page_type, tags_display, updated,
                    title_w = title_width, type_w = type_width, tags_w = tags_width);
            }

            println!("\n{} pages total", pages.len());
        }
    }

    Ok(())
}
