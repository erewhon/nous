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

/// Backup schedule frequency
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BackupFrequency {
    Daily,
    Weekly,
    Monthly,
}

impl Default for BackupFrequency {
    fn default() -> Self {
        Self::Daily
    }
}

/// Scheduled backup settings
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupSettings {
    /// Whether scheduled backups are enabled
    pub enabled: bool,
    /// Backup frequency
    pub frequency: BackupFrequency,
    /// Time of day to run backup (HH:MM format)
    pub time: String,
    /// Day of week for weekly backups (0 = Sunday, 6 = Saturday)
    pub day_of_week: Option<u8>,
    /// Day of month for monthly backups (1-28)
    pub day_of_month: Option<u8>,
    /// Maximum number of backups to keep per notebook
    pub max_backups_per_notebook: usize,
    /// Notebooks to backup (empty = all)
    pub notebook_ids: Vec<Uuid>,
    /// Last backup time
    pub last_backup: Option<DateTime<Utc>>,
    /// Next scheduled backup time
    pub next_backup: Option<DateTime<Utc>>,
}

impl Default for BackupSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            frequency: BackupFrequency::Daily,
            time: "02:00".to_string(), // 2 AM default
            day_of_week: Some(0), // Sunday for weekly
            day_of_month: Some(1), // 1st for monthly
            max_backups_per_notebook: 5,
            notebook_ids: Vec::new(), // Empty = all notebooks
            last_backup: None,
            next_backup: None,
        }
    }
}

/// Get the backup settings file path
pub fn get_backup_settings_path(data_dir: &Path) -> PathBuf {
    data_dir.join("backup_settings.json")
}

/// Load backup settings from file
pub fn load_backup_settings(data_dir: &Path) -> Result<BackupSettings> {
    let settings_path = get_backup_settings_path(data_dir);

    if !settings_path.exists() {
        return Ok(BackupSettings::default());
    }

    let content = fs::read_to_string(&settings_path)?;
    let settings: BackupSettings = serde_json::from_str(&content)?;
    Ok(settings)
}

/// Save backup settings to file
pub fn save_backup_settings(data_dir: &Path, settings: &BackupSettings) -> Result<()> {
    let settings_path = get_backup_settings_path(data_dir);
    let content = serde_json::to_string_pretty(settings)?;
    fs::write(&settings_path, content)?;
    Ok(())
}

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

/// Calculate the next backup time based on settings
pub fn calculate_next_backup_time(settings: &BackupSettings) -> Option<DateTime<Utc>> {
    use chrono::{Datelike, Local, NaiveTime, TimeZone, Weekday};

    if !settings.enabled {
        return None;
    }

    // Parse the time string
    let time_parts: Vec<&str> = settings.time.split(':').collect();
    if time_parts.len() != 2 {
        return None;
    }
    let hour: u32 = time_parts[0].parse().ok()?;
    let minute: u32 = time_parts[1].parse().ok()?;
    let scheduled_time = NaiveTime::from_hms_opt(hour, minute, 0)?;

    let now = Local::now();
    let mut date = now.date_naive();

    match settings.frequency {
        BackupFrequency::Daily => {
            // If today's time has passed, schedule for tomorrow
            if now.time() >= scheduled_time {
                date = date.succ_opt()?;
            }
        }
        BackupFrequency::Weekly => {
            let target_weekday = settings.day_of_week.unwrap_or(0);
            // Convert to chrono weekday (0 = Sunday in our settings)
            let target_day = match target_weekday {
                0 => Weekday::Sun,
                1 => Weekday::Mon,
                2 => Weekday::Tue,
                3 => Weekday::Wed,
                4 => Weekday::Thu,
                5 => Weekday::Fri,
                6 => Weekday::Sat,
                _ => Weekday::Sun,
            };

            // Find next occurrence of this weekday
            let mut days_until = (target_day.num_days_from_sunday() as i32
                - now.weekday().num_days_from_sunday() as i32)
                .rem_euclid(7) as u32;

            // If it's today but time has passed, go to next week
            if days_until == 0 && now.time() >= scheduled_time {
                days_until = 7;
            }

            for _ in 0..days_until {
                date = date.succ_opt()?;
            }
        }
        BackupFrequency::Monthly => {
            let target_day = settings.day_of_month.unwrap_or(1).min(28) as u32;
            let current_day = date.day();

            if current_day > target_day || (current_day == target_day && now.time() >= scheduled_time)
            {
                // Move to next month
                let mut month = date.month();
                let mut year = date.year();
                month += 1;
                if month > 12 {
                    month = 1;
                    year += 1;
                }
                date = chrono::NaiveDate::from_ymd_opt(year, month, target_day)?;
            } else {
                date = chrono::NaiveDate::from_ymd_opt(date.year(), date.month(), target_day)?;
            }
        }
    }

    let datetime = date.and_time(scheduled_time);
    Some(
        Local
            .from_local_datetime(&datetime)
            .single()?
            .with_timezone(&Utc),
    )
}

/// Check if a backup is due
pub fn is_backup_due(settings: &BackupSettings) -> bool {
    if !settings.enabled {
        return false;
    }

    if let Some(next_backup) = settings.next_backup {
        return Utc::now() >= next_backup;
    }

    // If no next_backup is set, check if we should run based on last_backup
    if settings.last_backup.is_none() {
        return true; // Never backed up
    }

    false
}
