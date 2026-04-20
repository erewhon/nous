//! Command to read the daemon API key for the frontend.

use std::fs;

use tauri::command;

use crate::storage::FileStorage;

const KEY_FILE_NAME: &str = "daemon-api-key";

/// Read the first rw: key from the daemon key file.
/// Returns null if the file doesn't exist (auth disabled, localhost only).
#[command]
pub fn get_daemon_api_key() -> Result<Option<String>, String> {
    let data_dir = FileStorage::default_data_dir().map_err(|e| e.to_string())?;
    let key_path = data_dir.join(KEY_FILE_NAME);

    if !key_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(&key_path).map_err(|e| e.to_string())?;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if line.starts_with("rw:") {
            return Ok(Some(line.to_string()));
        }
    }

    Ok(None)
}
