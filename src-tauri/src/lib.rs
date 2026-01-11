use std::sync::Mutex;

mod commands;
mod search;
mod storage;

use search::SearchIndex;
use storage::FileStorage;

pub struct AppState {
    pub storage: Mutex<FileStorage>,
    pub search_index: Mutex<SearchIndex>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize storage
    let data_dir = FileStorage::default_data_dir().expect("Failed to get data directory");
    let storage = FileStorage::new(data_dir.clone());
    storage.init().expect("Failed to initialize storage");

    // Initialize search index
    let search_dir = data_dir.join("search_index");
    let search_index = SearchIndex::new(search_dir).expect("Failed to initialize search index");

    let state = AppState {
        storage: Mutex::new(storage),
        search_index: Mutex::new(search_index),
    };

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Notebook commands
            commands::list_notebooks,
            commands::get_notebook,
            commands::create_notebook,
            commands::update_notebook,
            commands::delete_notebook,
            // Page commands
            commands::list_pages,
            commands::get_page,
            commands::create_page,
            commands::update_page,
            commands::delete_page,
            // Search commands
            commands::search_pages,
            commands::fuzzy_search_pages,
            commands::rebuild_search_index,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
