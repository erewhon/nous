use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

use super::file_storage::{Result, StorageError};
use super::models::{Notebook, Page};

/// Backup metadata stored in the ZIP file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackupMetadata {
    pub version: String,
    pub created_at: DateTime<Utc>,
    pub notebook_id: Uuid,
    pub notebook_name: String,
    pub page_count: usize,
    pub asset_count: usize,
}

/// Export a notebook to a ZIP file
pub fn export_notebook_to_zip(
    notebook_dir: &Path,
    notebook: &Notebook,
    output_path: &Path,
) -> Result<BackupMetadata> {
    let file = File::create(output_path)?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    let mut page_count = 0;
    let mut asset_count = 0;

    // Walk through the notebook directory
    for entry in WalkDir::new(notebook_dir) {
        let entry = entry.map_err(|e| StorageError::Io(std::io::Error::other(e.to_string())))?;
        let path = entry.path();

        // Get relative path from notebook directory
        let relative_path = path
            .strip_prefix(notebook_dir)
            .map_err(|_| StorageError::Io(std::io::Error::other("Failed to get relative path")))?;

        if path.is_file() {
            // Count pages and assets
            let path_str = relative_path.to_string_lossy();
            if path_str.starts_with("pages/") && path_str.ends_with(".json") {
                page_count += 1;
            } else if path_str.starts_with("assets/") {
                asset_count += 1;
            }

            // Add file to ZIP
            let name = relative_path.to_string_lossy();
            zip.start_file(name.as_ref(), options)?;

            let mut file_content = Vec::new();
            File::open(path)?.read_to_end(&mut file_content)?;
            zip.write_all(&file_content)?;
        } else if path.is_dir() && path != notebook_dir {
            // Add empty directories
            let name = format!("{}/", relative_path.to_string_lossy());
            zip.add_directory(name.as_str(), options)?;
        }
    }

    // Create and add backup metadata
    let metadata = BackupMetadata {
        version: "1.0".to_string(),
        created_at: Utc::now(),
        notebook_id: notebook.id,
        notebook_name: notebook.name.clone(),
        page_count,
        asset_count,
    };

    let metadata_json = serde_json::to_string_pretty(&metadata)?;
    zip.start_file("_backup_metadata.json", options)?;
    zip.write_all(metadata_json.as_bytes())?;

    zip.finish()?;

    Ok(metadata)
}

/// Import a notebook from a ZIP file
/// Returns the new notebook (with a new UUID if it already exists)
pub fn import_notebook_from_zip(
    zip_path: &Path,
    notebooks_dir: &Path,
    existing_notebook_ids: &[Uuid],
) -> Result<Notebook> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;

    // First, read the notebook.json to get notebook info
    let notebook_json_index = archive.index_for_name("notebook.json");
    let notebook: Notebook = if let Some(index) = notebook_json_index {
        let mut notebook_file = archive.by_index(index)?;
        let mut contents = String::new();
        notebook_file.read_to_string(&mut contents)?;
        serde_json::from_str(&contents)?
    } else {
        return Err(StorageError::Io(std::io::Error::other(
            "Invalid backup: notebook.json not found",
        )));
    };

    // Generate new ID if the notebook already exists
    let new_id = if existing_notebook_ids.contains(&notebook.id) {
        Uuid::new_v4()
    } else {
        notebook.id
    };

    // Create new notebook directory
    let new_notebook_dir = notebooks_dir.join(new_id.to_string());
    fs::create_dir_all(&new_notebook_dir)?;
    fs::create_dir_all(new_notebook_dir.join("pages"))?;
    fs::create_dir_all(new_notebook_dir.join("assets"))?;

    // Extract all files
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();

        // Skip backup metadata (it's just for reference)
        if name == "_backup_metadata.json" {
            continue;
        }

        let outpath = new_notebook_dir.join(&name);

        if name.ends_with('/') {
            // It's a directory
            fs::create_dir_all(&outpath)?;
        } else {
            // It's a file
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent)?;
            }

            let mut outfile = File::create(&outpath)?;
            std::io::copy(&mut file, &mut outfile)?;
        }
    }

    // Update notebook.json with new ID if needed
    let mut imported_notebook = notebook;
    if new_id != imported_notebook.id {
        imported_notebook.id = new_id;
        imported_notebook.name = format!("{} (Restored)", imported_notebook.name);
        imported_notebook.updated_at = Utc::now();
    }

    // Update all page files to reference the new notebook ID
    let pages_dir = new_notebook_dir.join("pages");
    if pages_dir.exists() {
        for entry in fs::read_dir(&pages_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.is_file() && path.extension().map_or(false, |e| e == "json") {
                let content = fs::read_to_string(&path)?;
                let mut page: Page = serde_json::from_str(&content)?;
                page.notebook_id = new_id;
                let updated_content = serde_json::to_string_pretty(&page)?;
                fs::write(&path, updated_content)?;
            }
        }
    }

    // Write updated notebook.json
    let notebook_json_path = new_notebook_dir.join("notebook.json");
    let notebook_content = serde_json::to_string_pretty(&imported_notebook)?;
    fs::write(&notebook_json_path, notebook_content)?;

    Ok(imported_notebook)
}

/// Get backup metadata from a ZIP file without extracting
pub fn get_backup_info(zip_path: &Path) -> Result<BackupMetadata> {
    let file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(file)?;

    // Try to read backup metadata first
    if let Some(index) = archive.index_for_name("_backup_metadata.json") {
        let mut metadata_file = archive.by_index(index)?;
        let mut contents = String::new();
        metadata_file.read_to_string(&mut contents)?;
        let metadata: BackupMetadata = serde_json::from_str(&contents)?;
        return Ok(metadata);
    }

    // Fall back to reading notebook.json and counting files
    let notebook: Notebook = if let Some(index) = archive.index_for_name("notebook.json") {
        let mut notebook_file = archive.by_index(index)?;
        let mut contents = String::new();
        notebook_file.read_to_string(&mut contents)?;
        serde_json::from_str(&contents)?
    } else {
        return Err(StorageError::Io(std::io::Error::other(
            "Invalid backup: notebook.json not found",
        )));
    };

    // Count pages and assets
    let mut page_count = 0;
    let mut asset_count = 0;

    for i in 0..archive.len() {
        let file = archive.by_index(i)?;
        let name = file.name();
        if name.starts_with("pages/") && name.ends_with(".json") {
            page_count += 1;
        } else if name.starts_with("assets/") && !name.ends_with('/') {
            asset_count += 1;
        }
    }

    Ok(BackupMetadata {
        version: "unknown".to_string(),
        created_at: notebook.updated_at,
        notebook_id: notebook.id,
        notebook_name: notebook.name,
        page_count,
        asset_count,
    })
}

/// Get the auto-backup directory
pub fn get_auto_backup_dir(data_dir: &Path) -> PathBuf {
    data_dir.join("backups")
}

/// Create an auto-backup for a notebook
pub fn create_auto_backup(
    notebook_dir: &Path,
    notebook: &Notebook,
    data_dir: &Path,
    max_backups: usize,
) -> Result<PathBuf> {
    let backup_dir = get_auto_backup_dir(data_dir);
    fs::create_dir_all(&backup_dir)?;

    // Create backup filename with timestamp
    let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
    let safe_name = notebook
        .name
        .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
    let filename = format!("{}_{}.katt.zip", safe_name, timestamp);
    let backup_path = backup_dir.join(&filename);

    // Create the backup
    export_notebook_to_zip(notebook_dir, notebook, &backup_path)?;

    // Clean up old backups for this notebook
    cleanup_old_backups(&backup_dir, &notebook.id, max_backups)?;

    Ok(backup_path)
}

/// Remove old backups keeping only the most recent `max_backups`
fn cleanup_old_backups(backup_dir: &Path, notebook_id: &Uuid, max_backups: usize) -> Result<()> {
    let mut backups: Vec<(PathBuf, BackupMetadata)> = Vec::new();

    for entry in fs::read_dir(backup_dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_file() && path.extension().map_or(false, |e| e == "zip") {
            if let Ok(metadata) = get_backup_info(&path) {
                if metadata.notebook_id == *notebook_id {
                    backups.push((path, metadata));
                }
            }
        }
    }

    // Sort by creation date, newest first
    backups.sort_by(|a, b| b.1.created_at.cmp(&a.1.created_at));

    // Remove old backups
    for (path, _) in backups.into_iter().skip(max_backups) {
        fs::remove_file(path)?;
    }

    Ok(())
}

/// List all auto-backups
pub fn list_auto_backups(data_dir: &Path) -> Result<Vec<(PathBuf, BackupMetadata)>> {
    let backup_dir = get_auto_backup_dir(data_dir);

    if !backup_dir.exists() {
        return Ok(Vec::new());
    }

    let mut backups: Vec<(PathBuf, BackupMetadata)> = Vec::new();

    for entry in fs::read_dir(&backup_dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_file() && path.extension().map_or(false, |e| e == "zip") {
            if let Ok(metadata) = get_backup_info(&path) {
                backups.push((path, metadata));
            }
        }
    }

    // Sort by creation date, newest first
    backups.sort_by(|a, b| b.1.created_at.cmp(&a.1.created_at));

    Ok(backups)
}
