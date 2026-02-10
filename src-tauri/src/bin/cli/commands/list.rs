use anyhow::Result;

use crate::app::App;
use crate::OutputFormat;

pub fn run(app: &App, format: &OutputFormat, _use_color: bool) -> Result<()> {
    let libraries = app.list_libraries()?;

    match format {
        OutputFormat::Json => {
            let mut output = Vec::new();
            for lib in &libraries {
                let notebooks = {
                    // Temporarily create a storage for this library
                    let storage = nous_lib::storage::FileStorage::new(lib.path.clone());
                    storage.list_notebooks().unwrap_or_default()
                };
                let mut nb_list = Vec::new();
                for nb in &notebooks {
                    let page_count = {
                        let storage = nous_lib::storage::FileStorage::new(lib.path.clone());
                        storage.list_pages(nb.id).map(|p| p.len()).unwrap_or(0)
                    };
                    nb_list.push(serde_json::json!({
                        "id": nb.id.to_string(),
                        "name": nb.name,
                        "pageCount": page_count,
                        "archived": nb.archived,
                    }));
                }
                output.push(serde_json::json!({
                    "id": lib.id.to_string(),
                    "name": lib.name,
                    "path": lib.path.to_string_lossy(),
                    "isDefault": lib.is_default,
                    "isCurrent": lib.id == app.current_library.id,
                    "notebooks": nb_list,
                }));
            }
            println!("{}", serde_json::to_string_pretty(&output)?);
        }
        OutputFormat::Plain => {
            for lib in &libraries {
                let current = if lib.id == app.current_library.id { "* " } else { "  " };
                println!("{}{} ({})", current, lib.name, lib.path.display());

                let storage = nous_lib::storage::FileStorage::new(lib.path.clone());
                let notebooks = storage.list_notebooks().unwrap_or_default();

                if notebooks.is_empty() {
                    println!("    (no notebooks)");
                } else {
                    for nb in &notebooks {
                        let page_count = storage.list_pages(nb.id).map(|p| p.len()).unwrap_or(0);
                        let archived = if nb.archived { " [archived]" } else { "" };
                        println!("    {} ({} pages){}", nb.name, page_count, archived);
                    }
                }
                println!();
            }
        }
    }

    Ok(())
}
