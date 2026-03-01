//! HMAC secret storage for collab sessions.
//!
//! Uses a single global secret shared between the Nous app and the
//! PartyKit Worker. Stored as hex in {data_dir}/.credentials/nous-collab/secret
//! with keyring as best-effort backup.

use std::path::{Path, PathBuf};

const SERVICE_NAME: &str = "nous-collab";
const KEYRING_ACCOUNT: &str = "global";

/// Path to the global collab secret file.
fn credentials_file_path(data_dir: &Path) -> PathBuf {
    data_dir
        .join(".credentials")
        .join(SERVICE_NAME)
        .join("secret")
}

/// Get or create the global HMAC secret for collab sessions.
/// Generates a new 32-byte secret on first call, persists it for subsequent use.
pub fn get_or_create_collab_secret(data_dir: &Path) -> Result<Vec<u8>, String> {
    if let Ok(secret) = get_collab_secret(data_dir) {
        return Ok(secret);
    }

    let secret: Vec<u8> = (0..32).map(|_| rand::random::<u8>()).collect();
    store_collab_secret(data_dir, &secret)?;
    Ok(secret)
}

/// Store the global collab HMAC secret.
fn store_collab_secret(data_dir: &Path, secret: &[u8]) -> Result<(), String> {
    let encoded = hex::encode(secret);

    let file_path = credentials_file_path(data_dir);
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create credentials dir: {}", e))?;
    }
    std::fs::write(&file_path, &encoded)
        .map_err(|e| format!("Failed to write collab secret: {}", e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file_path, std::fs::Permissions::from_mode(0o600));
    }

    if let Ok(entry) = keyring::Entry::new(SERVICE_NAME, KEYRING_ACCOUNT) {
        let _ = entry.set_password(&encoded);
    }

    Ok(())
}

/// Get the global collab HMAC secret.
pub fn get_collab_secret(data_dir: &Path) -> Result<Vec<u8>, String> {
    let file_path = credentials_file_path(data_dir);
    if let Ok(data) = std::fs::read_to_string(&file_path) {
        return hex::decode(data.trim())
            .map_err(|e| format!("Invalid secret encoding: {}", e));
    }

    let entry = keyring::Entry::new(SERVICE_NAME, KEYRING_ACCOUNT)
        .map_err(|e| format!("Keyring error: {}", e))?;
    let password = entry
        .get_password()
        .map_err(|_| "Collab secret not found".to_string())?;
    hex::decode(password.trim())
        .map_err(|e| format!("Invalid secret encoding: {}", e))
}
