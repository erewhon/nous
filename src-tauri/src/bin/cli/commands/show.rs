use anyhow::Result;

use crate::app::App;
use crate::render::terminal;

pub fn run(app: &App, notebook_name: &str, page_title: &str, use_color: bool) -> Result<()> {
    let notebook = app.find_notebook(notebook_name)?;
    let page = app.find_page(notebook.id, page_title)?;

    // Print header
    if use_color {
        println!("{}{}{}", terminal::Color::BOLD, page.title, terminal::Color::RESET);
    } else {
        println!("{}", page.title);
    }

    if !page.tags.is_empty() {
        let tags = page.tags.iter()
            .map(|t| format!("#{}", t))
            .collect::<Vec<_>>()
            .join(" ");
        if use_color {
            println!("{}{}{}", terminal::Color::DIM, tags, terminal::Color::RESET);
        } else {
            println!("{}", tags);
        }
    }

    let page_type = format!("{:?}", page.page_type).to_lowercase();
    match page_type.as_str() {
        "standard" => {
            println!();
            let rendered = terminal::render_blocks(&page.content.blocks, use_color);
            println!("{}", rendered);
        }
        "markdown" => {
            // For markdown pages, try to read the source file
            if let Some(ref source_file) = page.source_file {
                println!("\n[Markdown page: {}]", source_file);
            } else {
                println!("\n[Markdown page - no content blocks]");
            }
            // Also render any Editor.js blocks if present
            if !page.content.blocks.is_empty() {
                println!();
                let rendered = terminal::render_blocks(&page.content.blocks, use_color);
                println!("{}", rendered);
            }
        }
        _ => {
            println!("\n[{} page", page_type);
            if let Some(ref source_file) = page.source_file {
                println!("  File: {}", source_file);
            }
            println!("]");
            // Try to render any blocks
            if !page.content.blocks.is_empty() {
                println!();
                let rendered = terminal::render_blocks(&page.content.blocks, use_color);
                println!("{}", rendered);
            }
        }
    }

    Ok(())
}
