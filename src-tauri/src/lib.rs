use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use tauri::Manager;

mod actions;
mod commands;
pub mod encryption;
mod evernote;
mod external_editor;
mod external_sources;
mod flashcards;
mod git;
mod goals;
mod inbox;
mod joplin;
mod library;
mod markdown;
mod notion;
mod obsidian;
mod onenote;
mod orgmode;
mod publish;
mod python_bridge;
mod rag;
mod scrivener;
mod search;
mod storage;
pub mod sync;
mod video_server;

use actions::{ActionExecutor, ActionScheduler, ActionStorage};
use commands::BackupScheduler;
use encryption::EncryptionManager;
use external_editor::ExternalEditorManager;
use external_sources::ExternalSourcesStorage;
use flashcards::FlashcardStorage;
use goals::GoalsStorage;
use inbox::InboxStorage;
use library::LibraryStorage;
use python_bridge::PythonAI;
use rag::VectorIndex;
use search::SearchIndex;
use storage::FileStorage;
use sync::{SyncManager, SyncScheduler};
use video_server::VideoServer;

pub struct AppState {
    pub library_storage: Arc<Mutex<LibraryStorage>>,
    pub storage: Arc<Mutex<FileStorage>>,
    pub search_index: Mutex<SearchIndex>,
    pub vector_index: Mutex<VectorIndex>,
    pub python_ai: Arc<Mutex<PythonAI>>,
    pub action_storage: Arc<Mutex<ActionStorage>>,
    pub action_executor: Arc<Mutex<ActionExecutor>>,
    pub action_scheduler: Mutex<ActionScheduler>,
    pub inbox_storage: Arc<Mutex<InboxStorage>>,
    pub flashcard_storage: Mutex<FlashcardStorage>,
    pub goals_storage: Arc<Mutex<GoalsStorage>>,
    pub sync_manager: Arc<SyncManager>,
    pub external_editor: Mutex<ExternalEditorManager>,
    pub external_sources_storage: Arc<Mutex<ExternalSourcesStorage>>,
    pub backup_scheduler: Arc<tokio::sync::Mutex<Option<BackupScheduler>>>,
    pub sync_scheduler: Arc<tokio::sync::Mutex<Option<SyncScheduler>>>,
    pub video_server: Arc<tokio::sync::Mutex<Option<VideoServer>>>,
    pub encryption_manager: Arc<EncryptionManager>,
}

/// Look for a bundled Python distribution next to the running binary.
/// Returns the path to the python-bundle directory if found.
fn find_python_bundle() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let exe_dir = exe.parent()?;

    // macOS .app: Contents/MacOS/nous → ../Resources/python-bundle
    let macos = exe_dir.join("../Resources/python-bundle");
    if macos.join("lib").exists() {
        return Some(macos.canonicalize().ok()?);
    }

    // Linux: alongside binary
    let linux = exe_dir.join("python-bundle");
    if linux.join("lib").exists() {
        return Some(linux);
    }

    // Linux deb: ../lib/nous/python-bundle
    let deb = exe_dir.join("../lib/nous/python-bundle");
    if deb.join("lib").exists() {
        return Some(deb.canonicalize().ok()?);
    }

    None
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

    // Initialize vector index for RAG at the library path
    let vector_db_path = current_library.path.join(".nous").join("vectors.db");
    let vector_index = VectorIndex::new(vector_db_path).expect("Failed to initialize vector index");

    // Initialize Python AI bridge
    // Check for bundled Python first (release builds), then fall back to dev layout
    #[allow(deprecated)]
    let nous_py_path = if let Some(bundle_dir) = find_python_bundle() {
        // Bundled release mode — set PYTHONHOME so libpython finds the stdlib
        std::env::set_var("PYTHONHOME", &bundle_dir);
        log::info!("Using bundled Python at {:?}", bundle_dir);
        bundle_dir.join("nous-py")
    } else {
        // Dev mode — find nous-py relative to cwd
        std::env::current_dir()
            .map(|p| {
                let direct = p.join("nous-py");
                if direct.exists() {
                    direct
                } else {
                    p.parent()
                        .map(|parent| parent.join("nous-py"))
                        .unwrap_or(direct)
                }
            })
            .unwrap_or_else(|_| PathBuf::from("nous-py"))
    };
    log::info!("Python AI bridge path: {:?}", nous_py_path);
    let python_ai = PythonAI::new(nous_py_path);

    // Initialize action storage
    let action_storage = ActionStorage::new(data_dir.clone())
        .expect("Failed to initialize action storage");

    // Initialize inbox storage
    let inbox_storage = InboxStorage::new(data_dir.clone())
        .expect("Failed to initialize inbox storage");
    let inbox_storage_arc = Arc::new(Mutex::new(inbox_storage));

    // Initialize flashcard storage
    let flashcard_storage = FlashcardStorage::new(data_dir.join("notebooks"));

    // Initialize goals storage
    let goals_storage = GoalsStorage::new(data_dir.clone())
        .expect("Failed to initialize goals storage");
    let goals_storage_arc = Arc::new(Mutex::new(goals_storage));

    // Initialize sync manager
    let sync_manager = SyncManager::new(data_dir.clone());
    let sync_manager_arc = Arc::new(sync_manager);

    // Initialize external editor manager
    let external_editor = ExternalEditorManager::new()
        .expect("Failed to initialize external editor manager");

    // Initialize external sources storage
    let external_sources_storage = ExternalSourcesStorage::new(data_dir.clone())
        .expect("Failed to initialize external sources storage");
    let external_sources_storage_arc = Arc::new(Mutex::new(external_sources_storage));

    // Wrap storage in Arc<Mutex<>> for sharing with executor
    let storage_arc = Arc::new(Mutex::new(storage));
    let action_storage_arc = Arc::new(Mutex::new(action_storage));
    let python_ai_arc = Arc::new(Mutex::new(python_ai));

    // Initialize action executor (needs references to storage, action_storage, and python_ai)
    let mut action_executor = ActionExecutor::new(
        Arc::clone(&storage_arc),
        Arc::clone(&action_storage_arc),
        Arc::clone(&python_ai_arc),
    );
    // Wire up external sources storage to executor
    action_executor.set_external_sources_storage(Arc::clone(&external_sources_storage_arc));
    let action_executor_arc = Arc::new(Mutex::new(action_executor));

    // Initialize action scheduler
    let action_scheduler = ActionScheduler::new(
        Arc::clone(&action_storage_arc),
        Arc::clone(&action_executor_arc),
    );

    let library_storage_arc = Arc::new(Mutex::new(library_storage));

    // Start backup scheduler
    let backup_scheduler = commands::start_backup_scheduler(Arc::clone(&storage_arc));
    let backup_scheduler_arc = Arc::new(tokio::sync::Mutex::new(Some(backup_scheduler)));

    // Start sync scheduler for periodic syncs
    let sync_scheduler = sync::scheduler::start_sync_scheduler(
        Arc::clone(&sync_manager_arc),
        Arc::clone(&storage_arc),
        Arc::clone(&library_storage_arc),
        Arc::clone(&goals_storage_arc),
        Arc::clone(&inbox_storage_arc),
    );
    let sync_scheduler_arc = Arc::new(tokio::sync::Mutex::new(Some(sync_scheduler)));

    // Video server will be started in setup hook
    let video_server_arc = Arc::new(tokio::sync::Mutex::new(None));

    // Initialize encryption manager
    let encryption_manager = Arc::new(EncryptionManager::new());

    let state = AppState {
        library_storage: library_storage_arc,
        storage: storage_arc,
        search_index: Mutex::new(search_index),
        vector_index: Mutex::new(vector_index),
        python_ai: python_ai_arc,
        action_storage: action_storage_arc,
        action_executor: action_executor_arc,
        action_scheduler: Mutex::new(action_scheduler),
        inbox_storage: inbox_storage_arc,
        flashcard_storage: Mutex::new(flashcard_storage),
        goals_storage: goals_storage_arc,
        sync_manager: sync_manager_arc,
        external_editor: Mutex::new(external_editor),
        external_sources_storage: external_sources_storage_arc,
        backup_scheduler: backup_scheduler_arc,
        sync_scheduler: sync_scheduler_arc,
        video_server: video_server_arc,
        encryption_manager,
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

            // Register the data directory with the asset protocol scope
            // This allows all assets (images, videos, etc.) to be loaded via convertFileSrc
            if let Ok(data_dir) = storage::FileStorage::default_data_dir() {
                log::info!("Registering data directory with asset protocol: {:?}", data_dir);
                if let Err(e) = app.asset_protocol_scope().allow_directory(&data_dir, true) {
                    log::error!("Failed to register data directory with asset protocol: {}", e);
                } else {
                    log::info!("Successfully registered data directory with asset protocol");
                }
            }

            // Register /tmp/nous-videos for video assets (workaround for hidden directory issues)
            let video_tmp_dir = std::path::PathBuf::from("/tmp/nous-videos");
            if let Err(e) = std::fs::create_dir_all(&video_tmp_dir) {
                log::warn!("Failed to create /tmp/nous-videos directory: {}", e);
            }
            if let Err(e) = app.asset_protocol_scope().allow_directory(&video_tmp_dir, true) {
                log::error!("Failed to register /tmp/nous-videos with asset protocol: {}", e);
            } else {
                log::info!("Successfully registered /tmp/nous-videos with asset protocol");
            }

            // Start the action scheduler
            let state: tauri::State<AppState> = app.handle().state();
            if let Ok(mut scheduler) = state.action_scheduler.lock() {
                scheduler.start();
                log::info!("Action scheduler started");
            }

            // Give the sync manager the app handle so scheduler-triggered syncs
            // can emit events (e.g., sync-pages-updated) to the frontend.
            state.sync_manager.set_app_handle(app.handle().clone());

            // Start the video streaming server
            let video_server_handle = state.video_server.clone();
            tauri::async_runtime::spawn(async move {
                // Allow serving videos from the data directory and /tmp
                let allowed_dirs = if let Ok(data_dir) = storage::FileStorage::default_data_dir() {
                    vec![
                        data_dir,
                        std::path::PathBuf::from("/tmp"),
                    ]
                } else {
                    vec![std::path::PathBuf::from("/tmp")]
                };

                match video_server::start_server(allowed_dirs).await {
                    Ok(server) => {
                        log::info!(
                            "Video server started on port {} with token {}...",
                            server.port,
                            &server.token[..8]
                        );
                        let mut handle = video_server_handle.lock().await;
                        *handle = Some(server);
                    }
                    Err(e) => {
                        log::error!("Failed to start video server: {}", e);
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Notebook commands
            commands::list_notebooks,
            commands::get_notebook,
            commands::create_notebook,
            commands::update_notebook,
            commands::delete_notebook,
            commands::reorder_notebooks,
            // Page commands
            commands::list_pages,
            commands::get_page,
            commands::get_page_content,
            commands::create_page,
            commands::update_page,
            commands::delete_page,
            commands::permanent_delete_page,
            commands::restore_page,
            commands::list_trash,
            commands::purge_old_trash,
            commands::move_page_to_parent,
            commands::move_page_to_notebook,
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
            commands::discover_ai_models,
            // Study tools commands
            commands::generate_study_guide,
            commands::generate_faq,
            commands::ai_generate_flashcards,
            commands::generate_briefing,
            commands::extract_timeline,
            commands::extract_concepts,
            commands::chat_with_citations,
            // Markdown commands
            commands::export_page_markdown,
            commands::import_markdown,
            commands::export_page_to_file,
            commands::import_markdown_file,
            // Asset commands
            commands::get_notebook_assets_path,
            commands::save_notebook_asset,
            commands::register_asset_path,
            commands::get_asset_data_url,
            commands::save_video_asset,
            commands::list_notebook_media_assets,
            commands::delete_notebook_media_asset,
            // Web research commands
            commands::web_search,
            commands::scrape_url,
            commands::summarize_research,
            commands::fetch_link_metadata,
            commands::fetch_url_content,
            // Web clipper commands
            commands::clip_web_page,
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
            commands::get_backup_settings,
            commands::update_backup_settings,
            commands::run_scheduled_backup,
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
            // OneNote import commands
            commands::preview_onenote_cmd,
            commands::import_onenote_cmd,
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
            commands::move_section_to_notebook,
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
            // External sources commands
            commands::list_external_sources,
            commands::get_external_source,
            commands::create_external_source,
            commands::update_external_source,
            commands::delete_external_source,
            commands::preview_external_source_files,
            commands::preview_path_pattern_files,
            // Inbox commands
            commands::inbox_capture,
            commands::inbox_list,
            commands::inbox_list_unprocessed,
            commands::inbox_summary,
            commands::inbox_classify,
            commands::inbox_apply_actions,
            commands::inbox_delete,
            commands::inbox_clear_processed,
            // Goals commands
            commands::list_goals,
            commands::list_active_goals,
            commands::get_goal,
            commands::create_goal,
            commands::update_goal,
            commands::archive_goal,
            commands::delete_goal,
            commands::get_goal_stats,
            commands::record_goal_progress,
            commands::get_goal_progress,
            commands::check_auto_goals,
            commands::get_goals_summary,
            commands::toggle_goal_today,
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
            // Library sync commands
            commands::library_sync_configure,
            commands::library_sync_disable,
            commands::library_sync_now,
            commands::library_sync_configure_notebook,
            commands::sync_update_config,
            commands::library_sync_update_config,
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
            commands::link_external_video,
            // Video thumbnail and streaming commands
            commands::generate_video_thumbnail,
            commands::get_video_thumbnail_data_url,
            commands::get_video_metadata,
            commands::read_video_chunk,
            commands::open_video_with_system_player,
            commands::get_video_stream_url,
            // Drawing/annotation commands
            commands::get_page_annotation,
            commands::save_page_annotation,
            commands::delete_page_annotation,
            // PDF annotation commands
            commands::get_pdf_annotations,
            commands::save_pdf_annotations,
            commands::add_pdf_highlight,
            commands::update_pdf_highlight,
            commands::delete_pdf_highlight,
            commands::delete_pdf_annotations,
            // File-based page commands
            commands::import_file_as_page,
            commands::get_file_content,
            commands::update_file_content,
            commands::get_file_path,
            commands::check_linked_file_modified,
            commands::mark_linked_file_synced,
            commands::get_supported_page_extensions,
            commands::delete_file_page,
            commands::execute_jupyter_cell,
            commands::check_python_execution_available,
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
            commands::move_notebook_to_library,
            // MCP server commands
            commands::mcp_load_config,
            commands::mcp_save_config,
            commands::mcp_start_servers,
            commands::mcp_stop_servers,
            commands::mcp_get_tools,
            commands::mcp_get_running_servers,
            commands::mcp_call_tool,
            // RAG commands
            commands::configure_embeddings,
            commands::get_embedding_config,
            commands::semantic_search,
            commands::hybrid_search,
            commands::get_rag_context,
            commands::index_page_embedding,
            commands::remove_page_embedding,
            commands::get_page_chunks,
            commands::rebuild_vector_index,
            commands::get_vector_index_stats,
            commands::generate_embedding,
            commands::generate_embeddings_batch,
            commands::discover_embedding_models,
            // Window commands
            commands::open_library_window,
            commands::close_library_window,
            commands::is_library_window_open,
            // Encryption commands
            commands::enable_notebook_encryption,
            commands::disable_notebook_encryption,
            commands::unlock_notebook,
            commands::lock_notebook,
            commands::is_notebook_unlocked,
            commands::is_notebook_encrypted,
            commands::get_notebook_password_hint,
            commands::change_notebook_password,
            commands::get_unlocked_notebooks,
            commands::enable_library_encryption,
            commands::disable_library_encryption,
            commands::unlock_library,
            commands::lock_library,
            commands::is_library_unlocked,
            commands::is_library_encrypted,
            commands::get_library_password_hint,
            commands::lock_all,
            commands::get_encryption_stats,
            commands::cleanup_expired_sessions,
            // Audio generation commands
            commands::generate_page_audio,
            commands::get_tts_providers,
            commands::list_tts_voices,
            // Infographic generation commands
            commands::generate_infographic,
            commands::check_infographic_availability,
            // Video generation commands
            commands::generate_study_video,
            commands::check_video_generation_availability,
            // Smart organize commands
            commands::smart_organize_suggest,
            commands::smart_organize_apply,
            // Publish commands
            commands::publish_notebook,
            commands::publish_selected_pages,
            commands::preview_publish_page,
            commands::generate_presentation,
            commands::generate_print_html,
            // Daily notes commands
            commands::get_daily_note,
            commands::create_daily_note,
            commands::list_daily_notes,
            commands::get_or_create_today_daily_note,
            commands::mark_as_daily_note,
            commands::unmark_daily_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
