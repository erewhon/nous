use anyhow::Result;

use crate::app::App;
use crate::OutputFormat;

pub fn run(
    app: &App,
    query: &str,
    notebook_name: Option<&str>,
    limit: usize,
    format: &OutputFormat,
    _use_color: bool,
) -> Result<()> {
    let search_index = app.search_index.as_ref()
        .ok_or_else(|| anyhow::anyhow!("Search index not available. Run the GUI app first to build the index."))?;

    let mut results = search_index.search(query, limit)
        .map_err(|e| anyhow::anyhow!("Search error: {}", e))?;

    // Filter by notebook if specified
    if let Some(nb_name) = notebook_name {
        let notebook = app.find_notebook(nb_name)?;
        let nb_id = notebook.id.to_string();
        results.retain(|r| r.notebook_id == nb_id);
    }

    // Build a notebook name lookup
    let notebooks = app.list_notebooks()?;
    let nb_names: std::collections::HashMap<String, String> = notebooks.iter()
        .map(|n| (n.id.to_string(), n.name.clone()))
        .collect();

    match format {
        OutputFormat::Json => {
            let output: Vec<serde_json::Value> = results.iter().map(|r| {
                serde_json::json!({
                    "pageId": r.page_id,
                    "notebookId": r.notebook_id,
                    "title": r.title,
                    "score": r.score,
                    "tags": r.snippet,
                    "pageType": r.page_type,
                    "notebookName": nb_names.get(&r.notebook_id).unwrap_or(&"?".to_string()),
                })
            }).collect();
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        OutputFormat::Plain => {
            if results.is_empty() {
                println!("No results found for '{}'.", query);
                return Ok(());
            }

            let title_w = results.iter().map(|r| r.title.len()).max().unwrap_or(5).min(40).max(5);
            let nb_w = 20;

            println!("{:<title_w$} {:<nb_w$} {:<6} {}",
                "Title", "Notebook", "Score", "Tags",
                title_w = title_w, nb_w = nb_w);
            println!("{} {} {} {}",
                "\u{2500}".repeat(title_w),
                "\u{2500}".repeat(nb_w),
                "\u{2500}".repeat(6),
                "\u{2500}".repeat(20));

            for r in &results {
                let title = if r.title.len() > title_w {
                    format!("{}...", &r.title[..title_w - 3])
                } else {
                    r.title.clone()
                };

                let nb_name = nb_names.get(&r.notebook_id)
                    .cloned()
                    .unwrap_or_else(|| "?".to_string());
                let nb_display = if nb_name.len() > nb_w {
                    format!("{}...", &nb_name[..nb_w - 3])
                } else {
                    nb_name
                };

                println!("{:<title_w$} {:<nb_w$} {:<6.2} {}",
                    title, nb_display, r.score, r.snippet,
                    title_w = title_w, nb_w = nb_w);
            }

            println!("\n{} results", results.len());
        }
    }

    Ok(())
}
