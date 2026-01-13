use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tauri::State;
use uuid::Uuid;

use crate::storage::backup::{
    create_auto_backup, export_notebook_to_zip, get_backup_info, import_notebook_from_zip,
    list_auto_backups, BackupMetadata,
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
        export_notebook_to_zip(&notebook_dir, &notebook, std::path::Path::new(&output_path))
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
        create_auto_backup(&notebook_dir, &notebook, &data_dir, 5).map_err(|e| e.to_string())?;

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
