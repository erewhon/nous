use anyhow::Result;

use crate::app::App;
use nous_lib::storage::{Folder, Page};

pub fn run(app: &App, notebook_name: &str, _use_color: bool) -> Result<()> {
    let notebook = app.find_notebook(notebook_name)?;
    let folders = app.list_folders(notebook.id)?;
    let mut pages = app.list_pages(notebook.id)?;

    // Filter out deleted pages
    pages.retain(|p| p.deleted_at.is_none());

    println!("{}", notebook.name);

    // Build tree: root folders + root pages
    let root_folders: Vec<&Folder> = folders.iter()
        .filter(|f| f.parent_id.is_none())
        .collect();
    let root_pages: Vec<&Page> = pages.iter()
        .filter(|p| p.folder_id.is_none())
        .collect();

    let total_items = root_folders.len() + root_pages.len();
    let mut item_idx = 0;

    // Print root folders
    for folder in &root_folders {
        item_idx += 1;
        let is_last = item_idx == total_items;
        print_folder(folder, &folders, &pages, "", is_last);
    }

    // Print root pages
    for page in &root_pages {
        item_idx += 1;
        let is_last = item_idx == total_items;
        let connector = if is_last { "\u{2514}\u{2500}\u{2500} " } else { "\u{251c}\u{2500}\u{2500} " };
        println!("{}{}", connector, page.title);
    }

    Ok(())
}

fn print_folder(folder: &Folder, all_folders: &[Folder], all_pages: &[Page], prefix: &str, is_last: bool) {
    let connector = if is_last { "\u{2514}\u{2500}\u{2500} " } else { "\u{251c}\u{2500}\u{2500} " };
    println!("{}{}{}/", prefix, connector, folder.name);

    let child_prefix = format!("{}{}", prefix, if is_last { "    " } else { "\u{2502}   " });

    // Child folders
    let child_folders: Vec<&Folder> = all_folders.iter()
        .filter(|f| f.parent_id == Some(folder.id))
        .collect();

    // Child pages
    let child_pages: Vec<&Page> = all_pages.iter()
        .filter(|p| p.folder_id == Some(folder.id))
        .collect();

    let total_children = child_folders.len() + child_pages.len();
    let mut child_idx = 0;

    for child_folder in &child_folders {
        child_idx += 1;
        let child_is_last = child_idx == total_children;
        print_folder(child_folder, all_folders, all_pages, &child_prefix, child_is_last);
    }

    for page in &child_pages {
        child_idx += 1;
        let child_is_last = child_idx == total_children;
        let child_connector = if child_is_last { "\u{2514}\u{2500}\u{2500} " } else { "\u{251c}\u{2500}\u{2500} " };
        println!("{}{}{}", child_prefix, child_connector, page.title);
    }
}
