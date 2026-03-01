//! HMAC secret storage for collab sessions.
//!
//! Follows the same dual-storage pattern as share/credentials.rs:
//! file-based store with keyring as best-effort backup.

use std::path::{Path, PathBuf};
use uuid::Uuid;

const SERVICE_NAME: &str = "nous-collab";

/// Path to file-based credential store.
fn credentials_file_path(data_dir: &Path, library_id: Uuid) -> PathBuf {
    data_dir
        .join(".credentials")
        .join(SERVICE_NAME)
        .join(library_id.to_string())
}

/// Get or create a 32-byte HMAC secret for collab sessions.
/// Generates a new secret on first call, persists it for subsequent use.
pub fn get_or_create_collab_secret(data_dir: &Path, library_id: Uuid) -> Result<Vec<u8>, String> {
    // Try to load existing secret
    if let Ok(secret) = get_collab_secret(data_dir, library_id) {
        return Ok(secret);
    }

    // Generate new 32-byte secret
    let secret: Vec<u8> = (0..32).map(|_| rand::random::<u8>()).collect();
    store_collab_secret(data_dir, library_id, &secret)?;
    Ok(secret)
}

/// Store a collab HMAC secret for a library.
fn store_collab_secret(
    data_dir: &Path,
    library_id: Uuid,
    secret: &[u8],
) -> Result<(), String> {
    let encoded = hex::encode(secret);

    // Always write to file-based store
    let file_path = credentials_file_path(data_dir, library_id);
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create credentials dir: {}", e))?;
    }
    std::fs::write(&file_path, &encoded)
        .map_err(|e| format!("Failed to write collab secret: {}", e))?;

    // Restrict permissions on Unix
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file_path, std::fs::Permissions::from_mode(0o600));
    }

    // Also try keyring (best-effort)
    if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, &library_id.to_string()) {
        let _ = entry.set_password(&encoded);
    }

    Ok(())
}

/// Get the collab HMAC secret for a library.
pub fn get_collab_secret(data_dir: &Path, library_id: Uuid) -> Result<Vec<u8>, String> {
    // Try file-based store first
    let file_path = credentials_file_path(data_dir, library_id);
    if let Ok(data) = std::fs::read_to_string(&file_path) {
        return hex::decode(data.trim())
            .map_err(|e| format!("Invalid secret encoding: {}", e));
    }

    // Fall back to keyring
    let entry = keyring::Entry::new(SERVICE_NAME, &library_id.to_string())
        .map_err(|e| format!("Keyring error: {}", e))?;
    let password = entry
        .get_password()
        .map_err(|_| "Collab secret not found".to_string())?;
    hex::decode(password.trim())
        .map_err(|e| format!("Invalid secret encoding: {}", e))
}
