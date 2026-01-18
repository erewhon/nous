use std::sync::{Arc, Mutex};

use tauri::Manager;

mod actions;
mod commands;
mod evernote;
mod external_editor;
mod flashcards;
mod git;
mod inbox;
mod joplin;
mod library;
mod markdown;
mod notion;
mod obsidian;
mod orgmode;
mod python_bridge;
mod scrivener;
mod search;
mod storage;
pub mod sync;

use actions::{ActionExecutor, ActionScheduler, ActionStorage};
use external_editor::ExternalEditorManager;
use flashcards::FlashcardStorage;
use inbox::InboxStorage;
use library::LibraryStorage;
use python_bridge::PythonAI;
use search::SearchIndex;
use storage::FileStorage;
use sync::SyncManager;

pub struct AppState {
    pub library_storage: Arc<Mutex<LibraryStorage>>,
    pub storage: Arc<Mutex<FileStorage>>,
    pub search_index: Mutex<SearchIndex>,
    pub python_ai: Arc<Mutex<PythonAI>>,
    pub action_storage: Arc<Mutex<ActionStorage>>,
    pub action_executor: Arc<Mutex<ActionExecutor>>,
    pub action_scheduler: Mutex<ActionScheduler>,
    pub inbox_storage: Mutex<InboxStorage>,
    pub flashcard_storage: Mutex<FlashcardStorage>,
    pub sync_manager: Arc<tokio::sync::Mutex<SyncManager>>,
    pub external_editor: Mutex<ExternalEditorManager>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Get base data directory
    let data_dir = FileStorage::default_data_dir().expect("Failed to get data directory");

    // Initialize library storage first - this handles default library creation
    let library_storage = LibraryStorage::new(data_dir.clone());
    let current_library = library_storage.init().expect("Failed to initialize library storage");

    // Use the current library's path for storage components
    let library_path = current_library.path.clone();

    // Initialize file storage at the library path
    let storage = FileStorage::new(library_path.clone());
    storage.init().expect("Failed to initialize storage");

    // Initialize search index at the library path
    let search_dir = current_library.search_index_path();
    let search_index = SearchIndex::new(search_dir).expect("Failed to initialize search index");

    // Initialize Python AI bridge
    // The katt-py package should be in the project root
    let katt_py_path = std::env::current_dir()
        .map(|p| p.join("../katt-py"))
        .unwrap_or_else(|_| std::path::PathBuf::from("katt-py"));
    let python_ai = PythonAI::new(katt_py_path);

    // Initialize action storage
    let action_storage = ActionStorage::new(data_dir.clone())
        .expect("Failed to initialize action storage");

    // Initialize inbox storage
    let inbox_storage = InboxStorage::new(data_dir.clone())
        .expect("Failed to initialize inbox storage");

    // Initialize flashcard storage
    let flashcard_storage = FlashcardStorage::new(data_dir.join("notebooks"));

    // Initialize sync manager
    let sync_manager = SyncManager::new(data_dir.clone());
    let sync_manager_arc = Arc::new(tokio::sync::Mutex::new(sync_manager));

    // Initialize external editor manager
    let external_editor = ExternalEditorManager::new()
        .expect("Failed to initialize external editor manager");

    // Wrap storage in Arc<Mutex<>> for sharing with executor
    let storage_arc = Arc::new(Mutex::new(storage));
    let action_storage_arc = Arc::new(Mutex::new(action_storage));
    let python_ai_arc = Arc::new(Mutex::new(python_ai));

    // Initialize action executor (needs references to storage, action_storage, and python_ai)
    let action_executor = ActionExecutor::new(
        Arc::clone(&storage_arc),
        Arc::clone(&action_storage_arc),
        Arc::clone(&python_ai_arc),
    );
    let action_executor_arc = Arc::new(Mutex::new(action_executor));

    // Initialize action scheduler
    let action_scheduler = ActionScheduler::new(
        Arc::clone(&action_storage_arc),
        Arc::clone(&action_executor_arc),
    );

    let library_storage_arc = Arc::new(Mutex::new(library_storage));

    let state = AppState {
        library_storage: library_storage_arc,
        storage: storage_arc,
        search_index: Mutex::new(search_index),
        python_ai: python_ai_arc,
        action_storage: action_storage_arc,
        action_executor: action_executor_arc,
        action_scheduler: Mutex::new(action_scheduler),
        inbox_storage: Mutex::new(inbox_storage),
        flashcard_storage: Mutex::new(flashcard_storage),
        sync_manager: sync_manager_arc,
        external_editor: Mutex::new(external_editor),
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

            // Start the action scheduler
            let state: tauri::State<AppState> = app.handle().state();
            if let Ok(mut scheduler) = state.action_scheduler.lock() {
                scheduler.start();
                log::info!("Action scheduler started");
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
            commands::move_page_to_parent,
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
            commands::ai_chat_with_tools,
            commands::ai_chat_stream,
            commands::ai_summarize_pages,
            commands::browser_run_task,
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
            commands::fetch_link_metadata,
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
            // Notion import commands
            commands::preview_notion_export,
            commands::import_notion_export,
            // Obsidian import commands
            commands::preview_obsidian_vault_cmd,
            commands::import_obsidian_vault_cmd,
            // Evernote import commands
            commands::preview_evernote_enex_cmd,
            commands::import_evernote_enex_cmd,
            // Scrivener import commands
            commands::preview_scrivener_project_cmd,
            commands::import_scrivener_project_cmd,
            // Joplin import commands
            commands::preview_joplin_import_cmd,
            commands::import_joplin_cmd,
            // Org-mode import commands
            commands::preview_orgmode_cmd,
            commands::import_orgmode_cmd,
            // Folder commands
            commands::list_folders,
            commands::get_folder,
            commands::create_folder,
            commands::update_folder,
            commands::delete_folder,
            commands::move_page_to_folder,
            commands::archive_page,
            commands::unarchive_page,
            commands::reorder_folders,
            commands::reorder_pages,
            commands::ensure_archive_folder,
            // Section commands
            commands::list_sections,
            commands::get_section,
            commands::create_section,
            commands::update_section,
            commands::delete_section,
            commands::reorder_sections,
            // Cover page commands
            commands::get_cover_page,
            commands::create_cover_page,
            commands::set_cover_page,
            // Action commands
            commands::list_actions,
            commands::get_action,
            commands::create_action,
            commands::update_action,
            commands::delete_action,
            commands::run_action,
            commands::run_action_by_name,
            commands::find_actions_by_keywords,
            commands::get_actions_by_category,
            commands::get_scheduled_actions,
            commands::set_action_enabled,
            // Inbox commands
            commands::inbox_capture,
            commands::inbox_list,
            commands::inbox_list_unprocessed,
            commands::inbox_summary,
            commands::inbox_classify,
            commands::inbox_apply_actions,
            commands::inbox_delete,
            commands::inbox_clear_processed,
            // Git commands
            commands::git_is_enabled,
            commands::git_init,
            commands::git_status,
            commands::git_commit,
            commands::git_history,
            commands::git_get_page_at_commit,
            commands::git_diff,
            commands::git_restore_page,
            commands::git_set_remote,
            commands::git_remove_remote,
            commands::git_fetch,
            commands::git_push,
            commands::git_pull,
            commands::git_list_branches,
            commands::git_current_branch,
            commands::git_create_branch,
            commands::git_switch_branch,
            commands::git_delete_branch,
            commands::git_merge_branch,
            commands::git_is_merging,
            commands::git_list_conflicts,
            commands::git_get_conflict_content,
            commands::git_resolve_conflict,
            commands::git_resolve_all_conflicts,
            commands::git_commit_merge,
            commands::git_abort_merge,
            // External editor commands
            commands::get_external_editors,
            commands::open_page_in_editor,
            commands::check_external_changes,
            commands::get_external_file_content,
            commands::sync_from_external_editor,
            commands::end_external_edit_session,
            commands::get_external_edit_session,
            commands::get_all_external_edit_sessions,
            commands::cleanup_external_edit_sessions,
            // Flashcard commands
            commands::list_decks,
            commands::get_deck,
            commands::create_deck,
            commands::update_deck,
            commands::delete_deck,
            commands::list_cards,
            commands::get_card,
            commands::create_card,
            commands::create_card_from_block,
            commands::update_card,
            commands::delete_card,
            commands::get_due_cards,
            commands::submit_review,
            commands::get_review_stats,
            commands::get_card_state,
            commands::preview_review_intervals,
            // Sync commands
            commands::sync_test_connection,
            commands::sync_configure,
            commands::sync_status,
            commands::sync_now,
            commands::sync_queue_status,
            commands::sync_disable,
            // Document conversion commands (markitdown)
            commands::convert_document,
            commands::convert_documents_batch,
            commands::get_supported_document_extensions,
            commands::is_supported_document,
            // Video transcription commands
            commands::transcribe_video,
            commands::get_video_duration,
            commands::is_supported_video,
            commands::get_supported_video_extensions,
            // Drawing/annotation commands
            commands::get_page_annotation,
            commands::save_page_annotation,
            commands::delete_page_annotation,
            // Library commands
            commands::list_libraries,
            commands::get_library,
            commands::get_current_library,
            commands::create_library,
            commands::update_library,
            commands::delete_library,
            commands::switch_library,
            commands::get_library_stats,
            commands::validate_library_path,
            commands::pick_library_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
