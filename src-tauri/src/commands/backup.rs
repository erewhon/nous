use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Mutex as TokioMutex;
use uuid::Uuid;

use crate::storage::backup::{
    calculate_next_backup_time, create_auto_backup, export_notebook_to_zip, get_backup_info,
    import_notebook_from_zip, is_backup_due, list_auto_backups, load_backup_settings,
    save_backup_settings, BackupFrequency, BackupMetadata, BackupSettings,
};
use crate::AppState;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupInfo {
    pub path: String,
    pub version: String,
    pub created_at: DateTime<Utc>,
    pub notebook_id: String,
    pub notebook_name: String,
    pub page_count: usize,
    pub asset_count: usize,
}

impl From<BackupMetadata> for BackupInfo {
    fn from(m: BackupMetadata) -> Self {
        Self {
            path: String::new(),
            version: m.version,
            created_at: m.created_at,
            notebook_id: m.notebook_id.to_string(),
            notebook_name: m.notebook_name,
            page_count: m.page_count,
            asset_count: m.asset_count,
        }
    }
}

#[derive(Clone, Serialize)]
struct BackupProgress {
    current: usize,
    total: usize,
    message: String,
}

/// Export a notebook to a ZIP file
#[tauri::command]
pub fn export_notebook_zip(
    state: State<AppState>,
    notebook_id: Uuid,
    output_path: String,
) -> Result<BackupInfo, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;

    // Get notebook
    let notebook = storage
        .get_notebook(notebook_id)
        .map_err(|e| e.to_string())?;

    // Get notebook directory
    let data_dir = crate::storage::FileStorage::default_data_dir().map_err(|e| e.to_string())?;
    let notebook_dir = data_dir.join("notebooks").join(notebook_id.to_string());

    // Export to ZIP
    let metadata =
        export_notebook_to_zip(&notebook_dir, &notebook, std::path::Path::new(&output_path), None)
            .map_err(|e| e.to_string())?;

    let mut info: BackupInfo = metadata.into();
    info.path = output_path;

    Ok(info)
}

/// Import a notebook from a ZIP file
#[tauri::command]
pub fn import_notebook_zip(
    state: State<AppState>,
    zip_path: String,
) -> Result<crate::storage::Notebook, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;

    // Get existing notebook IDs
    let existing_notebooks = storage.list_notebooks().map_err(|e| e.to_string())?;
    let existing_ids: Vec<Uuid> = existing_notebooks.iter().map(|n| n.id).collect();

    // Get notebooks directory
    let data_dir = crate::storage::FileStorage::default_data_dir().map_err(|e| e.to_string())?;
    let notebooks_dir = data_dir.join("notebooks");

    // Import from ZIP
    let notebook =
        import_notebook_from_zip(std::path::Path::new(&zip_path), &notebooks_dir, &existing_ids)
            .map_err(|e| e.to_string())?;

    // Index the new pages in search
    drop(storage);

    let storage = state.storage.lock().map_err(|e| e.to_string())?;
    let mut search_index = state.search_index.lock().map_err(|e| e.to_string())?;

    if let Ok(pages) = storage.list_pages(notebook.id) {
        for page in pages {
            let _ = search_index.index_page(&page);
        }
    }

    Ok(notebook)
}

/// Get backup info from a ZIP file without extracting
#[tauri::command]
pub fn get_backup_metadata(zip_path: String) -> Result<BackupInfo, String> {
    let metadata =
        get_backup_info(std::path::Path::new(&zip_path)).map_err(|e| e.to_string())?;

    let mut info: BackupInfo = metadata.into();
    info.path = zip_path;

    Ok(info)
}

/// Create an auto-backup for a notebook
#[tauri::command]
pub fn create_notebook_backup(
    state: State<AppState>,
    notebook_id: Uuid,
) -> Result<BackupInfo, String> {
    let storage = state.storage.lock().map_err(|e| e.to_string())?;

    // Get notebook
    let notebook = storage
        .get_notebook(notebook_id)
        .map_err(|e| e.to_string())?;

    // Get paths
    let data_dir = crate::storage::FileStorage::default_data_dir().map_err(|e| e.to_string())?;
    let notebook_dir = data_dir.join("notebooks").join(notebook_id.to_string());

    // Create backup (keep max 5 auto-backups per notebook)
    let backup_path =
        create_auto_backup(&notebook_dir, &notebook, &data_dir, 5, None)
            .map_err(|e| e.to_string())?;

    // Get metadata
    let metadata = get_backup_info(&backup_path).map_err(|e| e.to_string())?;

    let mut info: BackupInfo = metadata.into();
    info.path = backup_path.to_string_lossy().to_string();

    Ok(info)
}

/// List all auto-backups
#[tauri::command]
pub fn list_backups(state: State<AppState>) -> Result<Vec<BackupInfo>, String> {
    // Just need to verify state is accessible
    let _storage = state.storage.lock().map_err(|e| e.to_string())?;

    let data_dir = crate::storage::FileStorage::default_data_dir().map_err(|e| e.to_string())?;

    let backups = list_auto_backups(&data_dir).map_err(|e| e.to_string())?;

    let infos: Vec<BackupInfo> = backups
        .into_iter()
        .map(|(path, metadata)| {
            let mut info: BackupInfo = metadata.into();
            info.path = path.to_string_lossy().to_string();
            info
        })
        .collect();

    Ok(infos)
}

/// Delete a backup file
#[tauri::command]
pub fn delete_backup(backup_path: String) -> Result<(), String> {
    std::fs::remove_file(&backup_path).map_err(|e| e.to_string())
}

// ===== Scheduled Backup Settings =====

/// Get backup settings
#[tauri::command]
pub fn get_backup_settings() -> Result<BackupSettings, String> {
    let data_dir = crate::storage::FileStorage::default_data_dir().map_err(|e| e.to_string())?;
    load_backup_settings(&data_dir).map_err(|e| e.to_string())
}

/// Update backup settings
#[tauri::command]
pub fn update_backup_settings(
    state: State<AppState>,
    settings: BackupSettings,
) -> Result<BackupSettings, String> {
    let data_dir = crate::storage::FileStorage::default_data_dir().map_err(|e| e.to_string())?;

    // Calculate next backup time
    let mut settings = settings;
    settings.next_backup = calculate_next_backup_time(&settings);

    // Save settings
    save_backup_settings(&data_dir, &settings).map_err(|e| e.to_string())?;

    // Notify the backup scheduler to reload
    if let Some(scheduler) = &*state.backup_scheduler.blocking_lock() {
        scheduler.reload();
    }

    Ok(settings)
}

/// Manually trigger scheduled backup for all configured notebooks
#[tauri::command]
pub fn run_scheduled_backup(
    app: AppHandle,
    state: State<AppState>,
) -> Result<Vec<BackupInfo>, String> {
    let data_dir = crate::storage::FileStorage::default_data_dir().map_err(|e| e.to_string())?;
    let settings = load_backup_settings(&data_dir).map_err(|e| e.to_string())?;

    let storage = state.storage.lock().map_err(|e| e.to_string())?;

    // Get notebooks to backup
    let notebooks = if settings.notebook_ids.is_empty() {
        // Backup all notebooks
        storage.list_notebooks().map_err(|e| e.to_string())?
    } else {
        // Backup only specified notebooks
        settings
            .notebook_ids
            .iter()
            .filter_map(|id| storage.get_notebook(*id).ok())
            .collect()
    };

    let mut backup_infos = Vec::new();
    let total_notebooks = notebooks.len();

    for (idx, notebook) in notebooks.iter().enumerate() {
        let notebook_dir = data_dir.join("notebooks").join(notebook.id.to_string());

        // Emit notebook-level progress
        let _ = app.emit(
            "backup-progress",
            BackupProgress {
                current: idx,
                total: total_notebooks,
                message: format!("Backing up {}...", notebook.name),
            },
        );

        let app_clone = app.clone();
        let notebook_name = notebook.name.clone();
        let progress_fn = move |file_current: usize, file_total: usize, _name: &str| {
            let _ = app_clone.emit(
                "backup-progress",
                BackupProgress {
                    current: file_current,
                    total: file_total,
                    message: format!(
                        "Backing up {} ({}/{})",
                        notebook_name, file_current, file_total
                    ),
                },
            );
        };

        match create_auto_backup(
            &notebook_dir,
            notebook,
            &data_dir,
            settings.max_backups_per_notebook,
            Some(&progress_fn),
        ) {
            Ok(backup_path) => {
                if let Ok(metadata) = get_backup_info(&backup_path) {
                    let mut info: BackupInfo = metadata.into();
                    info.path = backup_path.to_string_lossy().to_string();
                    backup_infos.push(info);
                }
            }
            Err(e) => {
                log::error!("Failed to backup notebook '{}': {}", notebook.name, e);
            }
        }
    }

    // Emit completion
    let _ = app.emit(
        "backup-progress",
        BackupProgress {
            current: total_notebooks,
            total: total_notebooks,
            message: "Backup complete".to_string(),
        },
    );

    // Update last backup time
    drop(storage);
    let mut updated_settings = load_backup_settings(&data_dir).map_err(|e| e.to_string())?;
    updated_settings.last_backup = Some(Utc::now());
    updated_settings.next_backup = calculate_next_backup_time(&updated_settings);
    save_backup_settings(&data_dir, &updated_settings).map_err(|e| e.to_string())?;

    Ok(backup_infos)
}

// ===== Backup Scheduler =====

/// Message types for backup scheduler communication
#[derive(Debug)]
pub enum BackupSchedulerMessage {
    /// Reload settings
    Reload,
    /// Run backup now
    RunNow,
    /// Shutdown
    Shutdown,
}

/// Backup scheduler handle
pub struct BackupScheduler {
    sender: tokio::sync::mpsc::Sender<BackupSchedulerMessage>,
}

impl BackupScheduler {
    pub fn reload(&self) {
        let _ = self.sender.try_send(BackupSchedulerMessage::Reload);
    }

    pub fn run_now(&self) {
        let _ = self.sender.try_send(BackupSchedulerMessage::RunNow);
    }

    pub fn shutdown(&self) {
        let _ = self.sender.try_send(BackupSchedulerMessage::Shutdown);
    }
}

/// Start the backup scheduler
pub fn start_backup_scheduler(
    storage: Arc<std::sync::Mutex<crate::storage::FileStorage>>,
) -> BackupScheduler {
    let (tx, rx) = tokio::sync::mpsc::channel(32);

    tauri::async_runtime::spawn(async move {
        backup_scheduler_loop(storage, rx).await;
    });

    // Trigger initial load
    let _ = tx.try_send(BackupSchedulerMessage::Reload);

    BackupScheduler { sender: tx }
}

/// Main backup scheduler loop
async fn backup_scheduler_loop(
    storage: Arc<std::sync::Mutex<crate::storage::FileStorage>>,
    mut receiver: tokio::sync::mpsc::Receiver<BackupSchedulerMessage>,
) {
    use std::time::Duration;

    let data_dir = match crate::storage::FileStorage::default_data_dir() {
        Ok(dir) => dir,
        Err(e) => {
            log::error!("Backup scheduler: Failed to get data dir: {}", e);
            return;
        }
    };

    let mut settings = load_backup_settings(&data_dir).unwrap_or_default();
    let mut next_check: Option<DateTime<Utc>> = settings.next_backup;

    log::info!(
        "Backup scheduler started. Enabled: {}, Next: {:?}",
        settings.enabled,
        next_check
    );

    loop {
        // Calculate wait duration
        let wait_duration = if let Some(next) = next_check {
            let now = Utc::now();
            if next <= now {
                Duration::from_secs(0)
            } else {
                (next - now)
                    .to_std()
                    .unwrap_or(Duration::from_secs(60 * 60)) // Default 1 hour
            }
        } else {
            Duration::from_secs(60 * 60) // Check every hour if no schedule
        };

        tokio::select! {
            _ = tokio::time::sleep(wait_duration) => {
                // Check if backup is due
                if settings.enabled && is_backup_due(&settings) {
                    log::info!("Backup scheduler: Running scheduled backup");
                    run_backup(&storage, &data_dir, &mut settings);
                }

                // Recalculate next check
                next_check = settings.next_backup;
            }

            msg = receiver.recv() => {
                match msg {
                    Some(BackupSchedulerMessage::Reload) => {
                        log::info!("Backup scheduler: Reloading settings");
                        settings = load_backup_settings(&data_dir).unwrap_or_default();
                        next_check = settings.next_backup;
                        log::info!(
                            "Backup scheduler: Enabled: {}, Next: {:?}",
                            settings.enabled,
                            next_check
                        );
                    }
                    Some(BackupSchedulerMessage::RunNow) => {
                        log::info!("Backup scheduler: Running backup now (manual trigger)");
                        run_backup(&storage, &data_dir, &mut settings);
                        next_check = settings.next_backup;
                    }
                    Some(BackupSchedulerMessage::Shutdown) | None => {
                        log::info!("Backup scheduler: Shutting down");
                        break;
                    }
                }
            }
        }
    }
}

/// Run backup for all configured notebooks
fn run_backup(
    storage: &Arc<std::sync::Mutex<crate::storage::FileStorage>>,
    data_dir: &std::path::Path,
    settings: &mut BackupSettings,
) {
    let storage_guard = match storage.lock() {
        Ok(s) => s,
        Err(e) => {
            log::error!("Backup scheduler: Failed to lock storage: {}", e);
            return;
        }
    };

    // Get notebooks to backup
    let notebooks: Vec<crate::storage::Notebook> = if settings.notebook_ids.is_empty() {
        storage_guard.list_notebooks().unwrap_or_default()
    } else {
        settings
            .notebook_ids
            .iter()
            .filter_map(|id| storage_guard.get_notebook(*id).ok())
            .collect()
    };

    drop(storage_guard);

    let mut success_count = 0;
    let mut error_count = 0;

    for notebook in notebooks {
        let notebook_dir = data_dir.join("notebooks").join(notebook.id.to_string());

        match create_auto_backup(
            &notebook_dir,
            &notebook,
            data_dir,
            settings.max_backups_per_notebook,
            None,
        ) {
            Ok(_) => {
                log::info!("Backup scheduler: Backed up '{}'", notebook.name);
                success_count += 1;
            }
            Err(e) => {
                log::error!(
                    "Backup scheduler: Failed to backup '{}': {}",
                    notebook.name,
                    e
                );
                error_count += 1;
            }
        }
    }

    log::info!(
        "Backup scheduler: Completed. {} succeeded, {} failed",
        success_count,
        error_count
    );

    // Update settings with new times
    settings.last_backup = Some(Utc::now());
    settings.next_backup = calculate_next_backup_time(settings);

    if let Err(e) = save_backup_settings(data_dir, settings) {
        log::error!("Backup scheduler: Failed to save settings: {}", e);
    }
}
