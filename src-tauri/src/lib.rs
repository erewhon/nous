use std::sync::Mutex;

mod commands;
mod markdown;
mod python_bridge;
mod search;
mod storage;

use python_bridge::PythonAI;
use search::SearchIndex;
use storage::FileStorage;

pub struct AppState {
    pub storage: Mutex<FileStorage>,
    pub search_index: Mutex<SearchIndex>,
    pub python_ai: Mutex<PythonAI>,
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

    // Initialize Python AI bridge
    // The katt-py package should be in the project root
    let katt_py_path = std::env::current_dir()
        .map(|p| p.join("../katt-py"))
        .unwrap_or_else(|_| std::path::PathBuf::from("katt-py"));
    let python_ai = PythonAI::new(katt_py_path);

    let state = AppState {
        storage: Mutex::new(storage),
        search_index: Mutex::new(search_index),
        python_ai: Mutex::new(python_ai),
    };

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
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
            // AI commands
            commands::ai_chat,
            commands::ai_chat_with_context,
            commands::ai_summarize_page,
            commands::ai_suggest_tags,
            commands::ai_suggest_related_pages,
            // Markdown commands
            commands::export_page_markdown,
            commands::import_markdown,
            commands::export_page_to_file,
            commands::import_markdown_file,
            // Asset commands
            commands::get_notebook_assets_path,
            // Web research commands
            commands::web_search,
            commands::scrape_url,
            commands::summarize_research,
            // Tag management commands
            commands::get_all_tags,
            commands::get_notebook_tags,
            commands::rename_tag,
            commands::merge_tags,
            commands::delete_tag,
            // Backup commands
            commands::export_notebook_zip,
            commands::import_notebook_zip,
            commands::get_backup_metadata,
            commands::create_notebook_backup,
            commands::list_backups,
            commands::delete_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
