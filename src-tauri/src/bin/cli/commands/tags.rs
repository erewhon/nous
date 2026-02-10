use anyhow::Result;

use crate::app::App;
use crate::OutputFormat;

pub fn run(
    app: &App,
    notebook_name: Option<&str>,
    format: &OutputFormat,
    _use_color: bool,
) -> Result<()> {
    let mut tags = if let Some(nb_name) = notebook_name {
        let notebook = app.find_notebook(nb_name)?;
        app.get_notebook_tags(notebook.id)?
    } else {
        app.get_all_tags()?
    };

    // Sort by count descending
    tags.sort_by(|a, b| b.1.cmp(&a.1));

    match format {
        OutputFormat::Json => {
            let output: Vec<serde_json::Value> = tags.iter().map(|(tag, count)| {
                serde_json::json!({
                    "tag": tag,
                    "count": count,
                })
            }).collect();
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        OutputFormat::Plain => {
            if tags.is_empty() {
                println!("No tags found.");
                return Ok(());
            }

            let max_tag_len = tags.iter().map(|(t, _)| t.len()).max().unwrap_or(5).max(5);

            println!("{:<width$} Count", "Tag", width = max_tag_len + 1);
            println!("{} {}", "\u{2500}".repeat(max_tag_len + 1), "\u{2500}".repeat(6));

            for (tag, count) in &tags {
                println!("#{:<width$} {}", tag, count, width = max_tag_len);
            }

            println!("\n{} tags total", tags.len());
        }
    }

    Ok(())
}
