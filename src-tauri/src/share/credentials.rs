//! S3 credential storage for share uploads.
//!
//! Follows the same dual-storage pattern as sync credentials:
//! file-based store with keyring as best-effort backup.

use std::path::{Path, PathBuf};
use uuid::Uuid;

/// S3 credentials for share upload.
#[derive(Debug, Clone)]
pub struct S3Credentials {
    pub access_key_id: String,
    pub secret_access_key: String,
}

const SERVICE_NAME: &str = "nous-share-s3";

/// Path to file-based credential store.
fn credentials_file_path(data_dir: &Path, library_id: Uuid) -> PathBuf {
    data_dir
        .join(".credentials")
        .join(SERVICE_NAME)
        .join(library_id.to_string())
}

/// Store S3 credentials for a library.
pub fn store_s3_credentials(
    data_dir: &Path,
    library_id: Uuid,
    access_key_id: &str,
    secret_access_key: &str,
) -> Result<(), String> {
    let value = format!("{}:{}", access_key_id, secret_access_key);

    // Always write to file-based store
    let file_path = credentials_file_path(data_dir, library_id);
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create credentials dir: {}", e))?;
    }
    std::fs::write(&file_path, &value)
        .map_err(|e| format!("Failed to write credentials: {}", e))?;

    // Restrict permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file_path, std::fs::Permissions::from_mode(0o600));
    }

    // Also try keyring (best-effort)
    if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, &library_id.to_string()) {
        let _ = entry.set_password(&value);
    }

    Ok(())
}

/// Get S3 credentials for a library.
pub fn get_s3_credentials(data_dir: &Path, library_id: Uuid) -> Result<S3Credentials, String> {
    // Try file-based store first
    let file_path = credentials_file_path(data_dir, library_id);
    if let Ok(data) = std::fs::read_to_string(&file_path) {
        return parse_credentials(data.trim());
    }

    // Fall back to keyring
    let entry = keyring::Entry::new(SERVICE_NAME, &library_id.to_string())
        .map_err(|e| format!("Keyring error: {}", e))?;
    let password = entry
        .get_password()
        .map_err(|_| "S3 credentials not found".to_string())?;
    parse_credentials(&password)
}

/// Delete S3 credentials for a library.
pub fn delete_s3_credentials(data_dir: &Path, library_id: Uuid) -> Result<(), String> {
    // Delete file
    let file_path = credentials_file_path(data_dir, library_id);
    let _ = std::fs::remove_file(&file_path);

    // Delete from keyring
    if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, &library_id.to_string()) {
        let _ = entry.delete_credential();
    }

    Ok(())
}

fn parse_credentials(data: &str) -> Result<S3Credentials, String> {
    let parts: Vec<&str> = data.splitn(2, ':').collect();
    if parts.len() != 2 {
        return Err("Invalid credential format".to_string());
    }
    Ok(S3Credentials {
        access_key_id: parts[0].to_string(),
        secret_access_key: parts[1].to_string(),
    })
}
