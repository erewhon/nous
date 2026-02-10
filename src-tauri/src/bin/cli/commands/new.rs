use anyhow::Result;

use crate::app::App;
use crate::OutputFormat;

pub fn run(
    app: &App,
    notebook_name: &str,
    title: Option<&str>,
    folder_name: Option<&str>,
    tags: Option<&str>,
    content: Option<String>,
    format: &OutputFormat,
    _use_color: bool,
) -> Result<()> {
    let notebook = app.find_notebook(notebook_name)?;

    // Default title if not provided
    let title = title
        .map(|t| t.to_string())
        .unwrap_or_else(|| {
            chrono::Local::now().format("Quick Note %Y-%m-%d %H:%M").to_string()
        });

    // Create the page
    let mut page = app.create_page(notebook.id, title)?;

    // Set folder if specified
    if let Some(fname) = folder_name {
        let folder = app.find_folder(notebook.id, fname)?;
        page.folder_id = Some(folder.id);
    }

    // Set tags if specified
    if let Some(tag_str) = tags {
        page.tags = tag_str.split(',')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
    }

    // Set content if specified
    if let Some(text) = content {
        if !text.is_empty() {
            page.content = App::make_paragraph_content(&text);
        }
    }

    // Update if we modified anything after creation
    if page.folder_id.is_some() || !page.tags.is_empty() || !page.content.blocks.is_empty() {
        app.update_page(&page)?;
    }

    match format {
        OutputFormat::Json => {
            let output = serde_json::json!({
                "id": page.id.to_string(),
                "title": page.title,
                "notebookId": notebook.id.to_string(),
                "notebookName": notebook.name,
                "folderId": page.folder_id.map(|f| f.to_string()),
                "tags": page.tags,
            });
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        OutputFormat::Plain => {
            println!("Created page \"{}\" in notebook \"{}\"", page.title, notebook.name);
            if let Some(fid) = page.folder_id {
                if let Ok(folders) = app.list_folders(notebook.id) {
                    if let Some(f) = folders.iter().find(|f| f.id == fid) {
                        println!("  Folder: {}", f.name);
                    }
                }
            }
            if !page.tags.is_empty() {
                println!("  Tags: {}", page.tags.iter().map(|t| format!("#{}", t)).collect::<Vec<_>>().join(" "));
            }
            println!("  ID: {}", page.id);
        }
    }

    Ok(())
}
