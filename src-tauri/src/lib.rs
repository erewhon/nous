use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::Manager;

pub mod actions;
mod chat_sessions;
pub mod collab;
pub mod events;
pub mod commands;
pub mod contacts;
pub mod energy;
mod freeze_watchdog;
pub mod encryption;
mod evernote;
mod external_editor;
pub mod external_sources;
mod flashcards;
pub mod git;
pub mod goals;
pub mod inbox;
mod joplin;
mod monitor;
pub mod library;
pub mod markdown;
mod notion;
mod obsidian;
mod onenote;
mod orgmode;
mod publish;
pub mod python_bridge;
pub mod share;
mod rag;
mod scrivener;
pub mod search;
pub mod storage;
pub mod sync;
mod video_server;
#[cfg(feature = "plugins")]
pub mod plugins;

use actions::{ActionExecutor, ActionScheduler, ActionStorage};
use chat_sessions::ChatSessionStorage;
use contacts::ContactsStorage;
use encryption::EncryptionManager;
use external_editor::ExternalEditorManager;
use external_sources::ExternalSourcesStorage;
use flashcards::FlashcardStorage;
use energy::EnergyStorage;
use goals::GoalsStorage;
use inbox::InboxStorage;
use library::LibraryStorage;
use monitor::MonitorStorage;
use python_bridge::PythonAI;
use rag::VectorIndex;
use storage::FileStorage;
use sync::{SyncManager, SyncScheduler};
use collab::storage::CollabStorage;
use share::storage::ShareStorage;
use video_server::VideoServer;

pub struct AppState {
    pub library_storage: Arc<Mutex<LibraryStorage>>,
    pub storage: Arc<Mutex<FileStorage>>,
    // CRDT store now lives in the daemon. Frontend pane lifecycle goes
    // through the daemon's /api/events WS; updatePage routes through the
    // daemon's update_page handler which calls apply_save.
    pub vector_index: Mutex<VectorIndex>,
    pub python_ai: Arc<Mutex<PythonAI>>,
    pub action_storage: Arc<Mutex<ActionStorage>>,
    pub action_executor: Arc<Mutex<ActionExecutor>>,
    pub action_scheduler: Mutex<ActionScheduler>,
    pub inbox_storage: Arc<Mutex<InboxStorage>>,
    pub flashcard_storage: Mutex<FlashcardStorage>,
    pub goals_storage: Arc<Mutex<GoalsStorage>>,
    pub energy_storage: Arc<Mutex<EnergyStorage>>,
    pub contacts_storage: Arc<Mutex<ContactsStorage>>,
    pub sync_manager: Arc<SyncManager>,
    pub external_editor: Mutex<ExternalEditorManager>,
    pub external_sources_storage: Arc<Mutex<ExternalSourcesStorage>>,
    pub sync_scheduler: Arc<tokio::sync::Mutex<Option<SyncScheduler>>>,
    pub video_server: Arc<tokio::sync::Mutex<Option<VideoServer>>>,
    pub chat_session_storage: Arc<Mutex<ChatSessionStorage>>,
    pub encryption_manager: Arc<EncryptionManager>,
    pub monitor_storage: Arc<Mutex<MonitorStorage>>,
    pub monitor_scheduler: Mutex<Option<monitor::scheduler::MonitorScheduler>>,
    pub share_storage: Arc<Mutex<ShareStorage>>,
    pub collab_storage: Arc<Mutex<CollabStorage>>,
    /// Keeps the MCP file watcher alive for the app's lifetime.
    /// Plugin host for Lua/WASM plugins (None when plugins feature is disabled)
    #[cfg(feature = "plugins")]
    pub plugin_host: Option<Arc<Mutex<plugins::PluginHost>>>,
}

/// Check whether the Nous daemon is running by reading its PID file and
/// verifying the process is alive.  When the daemon is active it already
/// runs the `ActionScheduler`, so the Tauri app should skip starting its
/// own copy to avoid duplicate scheduled-action execution.
fn is_daemon_running(pid_path: &Path) -> bool {
    let pid_str = match std::fs::read_to_string(pid_path) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let pid: u32 = match pid_str.trim().parse() {
        Ok(p) => p,
        Err(_) => return false,
    };

    #[cfg(target_os = "linux")]
    {
        Path::new(&format!("/proc/{}", pid)).exists()
    }

    #[cfg(target_os = "macos")]
    {
        extern "C" {
            #[link_name = "kill"]
            fn libc_kill(pid: i32, sig: i32) -> i32;
        }
        unsafe { libc_kill(pid as i32, 0) == 0 }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = pid;
        false
    }
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

    // Search index now lives in the daemon (single-writer; daemon owns the
    // Tantivy lock). Tauri-side commands that touched the index have been
    // stubbed; frontend queries go through daemon HTTP.

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

    // Run one-time migration of global data into the library directory
    storage::migration::migrate_global_to_library(&data_dir, &library_path)
        .expect("Failed to migrate global data to library");

    // Migrate videos from /tmp/nous-videos back to notebook assets
    if let Err(e) = storage::migration::migrate_tmp_videos(&library_path) {
        log::warn!("Failed to migrate /tmp/nous-videos: {}", e);
    }

    // Initialize action storage (library-scoped)
    let action_storage = ActionStorage::new(library_path.clone())
        .expect("Failed to initialize action storage");

    // Initialize inbox storage (library-scoped)
    let inbox_storage = InboxStorage::new(library_path.clone())
        .expect("Failed to initialize inbox storage");
    let inbox_storage_arc = Arc::new(Mutex::new(inbox_storage));

    // Initialize monitor storage (library-scoped)
    let monitor_storage = MonitorStorage::new(library_path.clone())
        .expect("Failed to initialize monitor storage");
    let monitor_storage_arc = Arc::new(Mutex::new(monitor_storage));

    // Initialize flashcard storage (library-scoped)
    let flashcard_storage = FlashcardStorage::new(library_path.join("notebooks"));

    // Initialize goals storage (library-scoped)
    let goals_storage = GoalsStorage::new(library_path.clone())
        .expect("Failed to initialize goals storage");
    let goals_storage_arc = Arc::new(Mutex::new(goals_storage));

    // Initialize energy storage
    let energy_storage = EnergyStorage::new(data_dir.clone())
        .expect("Failed to initialize energy storage");
    let energy_storage_arc = Arc::new(Mutex::new(energy_storage));

    // Initialize contacts storage
    let contacts_storage = ContactsStorage::new(data_dir.clone())
        .expect("Failed to initialize contacts storage");
    let contacts_storage_arc = Arc::new(Mutex::new(contacts_storage));

    // Initialize chat session storage (library-scoped)
    let chat_session_storage = ChatSessionStorage::new(library_path.clone())
        .expect("Failed to initialize chat session storage");
    let chat_session_storage_arc = Arc::new(Mutex::new(chat_session_storage));

    // Initialize sync manager
    let sync_manager = SyncManager::new(data_dir.clone());
    let sync_manager_arc = Arc::new(sync_manager);

    // CRDT store moved to the daemon (Daemon API migration). Tauri no
    // longer constructs one — multi-pane merge happens via daemon HTTP/WS.

    // Initialize share storage (library-scoped)
    let share_storage = ShareStorage::new(library_path.clone());
    share_storage.init().expect("Failed to initialize share storage");
    let share_storage_arc = Arc::new(Mutex::new(share_storage));

    // Initialize collab storage (library-scoped)
    let collab_storage = CollabStorage::new(library_path.clone());
    collab_storage.init().expect("Failed to initialize collab storage");
    let collab_storage_arc = Arc::new(Mutex::new(collab_storage));

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
    action_executor.set_goals_storage(Arc::clone(&goals_storage_arc));
    action_executor.set_energy_storage(Arc::clone(&energy_storage_arc));
    action_executor.set_inbox_storage(Arc::clone(&inbox_storage_arc));

    // Initialize plugin host (optional, behind "plugins" feature)
    #[cfg(feature = "plugins")]
    let plugin_host = {
        let mut api = plugins::HostApi::new(
            Arc::clone(&storage_arc),
            Arc::clone(&goals_storage_arc),
            Arc::clone(&inbox_storage_arc),
        );
        // search_index is no longer set on the plugin API — plugins that need
        // search must go through the daemon HTTP API. The setter remains so the
        // type compiles, but it's a no-op in this build.
        api.set_energy_storage(Arc::clone(&energy_storage_arc));
        api.set_python_ai(Arc::clone(&python_ai_arc));
        let api = Arc::new(api);
        let mut host = plugins::PluginHost::new(api, library_path.join("plugins"));
        if let Err(e) = host.load_all() {
            log::warn!("Plugin load error: {e}");
        }
        Some(Arc::new(Mutex::new(host)))
    };

    #[cfg(feature = "plugins")]
    action_executor.set_plugin_host(plugin_host.clone());

    // Refresh built-in actions from Lua plugin definitions (if plugins loaded successfully)
    #[cfg(feature = "plugins")]
    if let Some(ref ph) = plugin_host {
        if let Ok(host) = ph.lock() {
            let builtins = host.get_builtin_actions();
            if !builtins.is_empty() {
                if let Ok(storage) = action_storage_arc.lock() {
                    if let Err(e) = storage.refresh_builtins(builtins) {
                        log::warn!("Failed to refresh builtins from plugins: {e}");
                    }
                }
            }
        }
    }

    let action_executor_arc = Arc::new(Mutex::new(action_executor));

    // Initialize action scheduler
    let action_scheduler = ActionScheduler::new(
        Arc::clone(&action_storage_arc),
        Arc::clone(&action_executor_arc),
    );

    let library_storage_arc = Arc::new(Mutex::new(library_storage));

    // Backup scheduler now lives in the daemon (see `bin/cli/daemon.rs::run`) and settings flow through `POST /api/backup/settings`.

    // Start sync scheduler for periodic syncs — but skip if the daemon is
    // already running one. Both processes hitting WebDAV against the same
    // library wastes round-trips and opens a small race window when
    // something has actually changed since the last sync. Mirrors the
    // action-scheduler PID-file guard below in the setup hook.
    let daemon_pid_path = data_dir.join(".nous-daemon.pid");
    let sync_scheduler_arc = if is_daemon_running(&daemon_pid_path) {
        log::info!(
            "Daemon detected (PID file {:?}); skipping local sync scheduler — daemon owns sync",
            daemon_pid_path
        );
        Arc::new(tokio::sync::Mutex::new(None))
    } else {
        let sync_scheduler = sync::scheduler::start_sync_scheduler(
            Arc::clone(&sync_manager_arc),
            Arc::clone(&storage_arc),
            Arc::clone(&library_storage_arc),
            Arc::clone(&goals_storage_arc),
            Arc::clone(&inbox_storage_arc),
            Arc::clone(&contacts_storage_arc),
            Arc::clone(&energy_storage_arc),
        );
        Arc::new(tokio::sync::Mutex::new(Some(sync_scheduler)))
    };

    // Video server will be started in setup hook
    let video_server_arc = Arc::new(tokio::sync::Mutex::new(None));

    // Initialize encryption manager
    let encryption_manager = Arc::new(EncryptionManager::new());

    let state = AppState {
        library_storage: library_storage_arc,
        storage: storage_arc,
        vector_index: Mutex::new(vector_index),
        python_ai: python_ai_arc,
        action_storage: action_storage_arc,
        action_executor: action_executor_arc,
        action_scheduler: Mutex::new(action_scheduler),
        inbox_storage: inbox_storage_arc,
        flashcard_storage: Mutex::new(flashcard_storage),
        goals_storage: goals_storage_arc,
        energy_storage: energy_storage_arc,
        contacts_storage: contacts_storage_arc,
        sync_manager: sync_manager_arc,
        external_editor: Mutex::new(external_editor),
        external_sources_storage: external_sources_storage_arc,
        chat_session_storage: chat_session_storage_arc,
        sync_scheduler: sync_scheduler_arc,
        video_server: video_server_arc,
        encryption_manager,
        monitor_storage: monitor_storage_arc,
        monitor_scheduler: Mutex::new(None),
        share_storage: share_storage_arc,
        collab_storage: collab_storage_arc,
        #[cfg(feature = "plugins")]
        plugin_host,
    };

    let watchdog_state = Arc::new(freeze_watchdog::WatchdogState::new());

    tauri::Builder::default()
        .manage(state)
        .manage(Arc::clone(&watchdog_state))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
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

            // Devtools: uncomment to enable for debugging
            // if let Some(window) = app.get_webview_window("main") {
            //     window.open_devtools();
            // }

            // Enable microphone/media permissions on Linux WebKitGTK
            #[cfg(target_os = "linux")]
            {
                if let Some(main_window) = app.get_webview_window("main") {
                    main_window.with_webview(|webview| {
                        use webkit2gtk::glib::object::Cast;
                        use webkit2gtk::{PermissionRequestExt, WebViewExt};

                        let wv = webview.inner();

                        // Enable media stream support
                        if let Some(settings) = wv.settings() {
                            use webkit2gtk::SettingsExt;
                            settings.set_enable_media_stream(true);
                            settings.set_media_playback_requires_user_gesture(false);
                        }

                        // Auto-allow media permission requests (microphone/camera)
                        wv.connect_permission_request(|_, request| {
                            if request.downcast_ref::<webkit2gtk::UserMediaPermissionRequest>().is_some() {
                                request.allow();
                                return true;
                            }
                            false // Let other permission types use default handling
                        });
                    }).unwrap_or_else(|e| {
                        log::warn!("Failed to configure WebKitGTK media permissions: {:?}", e);
                    });
                }
            }

            // Start the action scheduler (skip if the daemon is already running one)
            let state: tauri::State<AppState> = app.handle().state();
            let daemon_pid_path = data_dir.join(".nous-daemon.pid");
            if is_daemon_running(&daemon_pid_path) {
                log::info!(
                    "Daemon detected (PID file {:?}); skipping local action scheduler",
                    daemon_pid_path
                );
            } else if let Ok(mut scheduler) = state.action_scheduler.lock() {
                scheduler.start();
                log::info!("Action scheduler started");
            }

            // Give the sync manager the Tauri emitter so scheduler-triggered syncs
            // can emit events (e.g., sync-pages-updated) to the frontend.
            state.sync_manager.set_emitter(Arc::new(
                sync::TauriEmitter::new(app.handle().clone()),
            ));

            // CRDT store ownership moved to the daemon — sync_manager.set_crdt_store
            // is now a no-op on the Tauri side. Sync manager that needs CRDT-aware
            // skip semantics should run in the daemon process going forward.

            // Give the sync manager the collab storage so it can skip pages with active sessions
            state.sync_manager.set_collab_storage(Arc::clone(&state.collab_storage));

            // Start the freeze watchdog (Rust-side ping/pong to detect frontend freezes)
            freeze_watchdog::start_watchdog(
                app.handle().clone(),
                Arc::clone(&watchdog_state),
            );

            // MCP file watcher removed: the daemon's WS event stream
            // (page.created/updated/deleted, folder.*, section.*, ...) now
            // drives live UI refresh. External file edits (git pull, manual
            // edits, restored backups) are NOT detected by the daemon yet —
            // users need to refresh after such operations. A daemon-side
            // file watcher is a possible follow-up.

            // Start the video streaming server
            let video_server_handle = state.video_server.clone();
            let library_path_for_video = {
                let lib_storage = state.library_storage.lock().unwrap();
                lib_storage.get_current_library().map(|l| l.path.clone()).ok()
            };
            tauri::async_runtime::spawn(async move {
                // Allow serving videos from the data directory and the current library path
                let mut allowed_dirs = Vec::new();
                if let Ok(data_dir) = storage::FileStorage::default_data_dir() {
                    allowed_dirs.push(data_dir);
                }
                if let Some(lib_path) = library_path_for_video {
                    allowed_dirs.push(lib_path);
                }

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
            // Daemon API key (for frontend → daemon HTTP client)
            commands::get_daemon_api_key,
            // Notebook commands
            commands::list_notebooks,
            commands::get_notebook,
            commands::create_notebook,
            commands::update_notebook,
            commands::delete_notebook,
            commands::reorder_notebooks,
            commands::merge_notebook,
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
            commands::get_all_favorite_pages,
            // Page history commands
            commands::get_page_oplog,
            commands::list_page_snapshots,
            commands::restore_page_snapshot,
            // Block-level history commands
            commands::get_block_version_counts,
            commands::get_block_history,
            commands::revert_block,
            // Search: migrated to daemon HTTP (/api/search, /api/search/rebuild).
            // CRDT pane lifecycle: migrated to daemon WS (pane_open/pane_close).
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
            // Website mirror import commands
            commands::preview_website_mirror_cmd,
            commands::import_website_mirror_cmd,
            commands::rescan_website_mirror_cmd,
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
            commands::move_folder_to_notebook,
            commands::archive_folder,
            commands::unarchive_folder,
            // Section commands
            commands::list_sections,
            commands::get_section,
            commands::create_section,
            commands::update_section,
            commands::delete_section,
            commands::reorder_sections,
            commands::move_section_to_notebook,
            commands::repair_orphaned_sections,
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
            // Monitor commands
            commands::monitor_list_targets,
            commands::monitor_get_target,
            commands::monitor_create_target,
            commands::monitor_update_target,
            commands::monitor_delete_target,
            commands::monitor_capture_now,
            commands::monitor_list_events,
            commands::monitor_mark_read,
            commands::monitor_dismiss_event,
            commands::monitor_start,
            commands::monitor_stop,
            commands::monitor_list_windows,
            commands::monitor_unread_count,
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
            // Energy commands
            commands::log_energy_checkin,
            commands::get_energy_checkin,
            commands::get_energy_checkins_range,
            commands::update_energy_checkin,
            commands::delete_energy_checkin,
            commands::get_energy_patterns,
            commands::get_energy_log,
            // Contacts commands
            commands::list_contacts,
            commands::get_contact,
            commands::update_contact,
            commands::delete_contact,
            commands::list_contact_activities,
            commands::list_all_activities,
            commands::harvest_contacts,
            commands::is_harvester_available,
            commands::get_harvest_state,
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
            commands::duplicate_database_page,
            commands::get_file_path,
            commands::get_readable_html,
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
            commands::find_similar_pages,
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
            // Audio recording & transcription commands
            commands::transcribe_audio,
            commands::save_audio_recording,
            commands::synthesize_text,
            // Infographic generation commands
            commands::generate_infographic,
            commands::check_infographic_availability,
            // Video generation commands
            commands::generate_study_video,
            commands::check_video_generation_availability,
            // Smart organize commands
            commands::smart_organize_suggest,
            commands::smart_organize_apply,
            // Collab commands
            commands::start_collab_session,
            commands::start_collab_session_scoped,
            commands::list_pages_for_scope,
            commands::stop_collab_session,
            commands::list_collab_sessions,
            commands::get_collab_config,
            // Share commands
            commands::share_page,
            commands::share_folder,
            commands::share_section,
            commands::share_notebook,
            commands::list_shares,
            commands::delete_share,
            commands::configure_share_upload,
            commands::get_share_upload_config,
            commands::test_share_upload,
            commands::remove_share_upload_config,
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
            // Chat session commands
            commands::chat_session_create,
            commands::chat_session_save,
            commands::chat_session_get,
            commands::chat_session_list,
            commands::chat_session_delete,
            commands::chat_session_update_title,
            commands::migrate_chat_sessions_to_pages,
            // Plugin commands
            commands::list_plugins,
            commands::reload_plugin,
            commands::get_plugin_commands,
            commands::execute_plugin_command,
            commands::set_plugin_enabled,
            commands::get_plugin_view_types,
            commands::render_plugin_view,
            commands::handle_plugin_view_action,
            commands::get_plugin_block_types,
            commands::render_plugin_block,
            commands::handle_plugin_block_action,
            commands::get_plugin_export_formats,
            commands::execute_plugin_export,
            commands::render_export_options,
            commands::get_plugin_import_formats,
            commands::execute_plugin_import,
            commands::get_plugin_panel_types,
            commands::render_plugin_panel,
            commands::handle_plugin_panel_action,
            commands::get_plugin_decoration_types,
            commands::compute_plugin_decorations,
            commands::get_plugin_page_types,
            commands::render_plugin_page,
            commands::handle_plugin_page_action,
            commands::set_plugin_ai_config,
            // Freeze watchdog
            freeze_watchdog::freeze_pong,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
