//! Encryption commands for notebooks and libraries

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::encryption::{
    create_verification_hash, derive_key, generate_salt, verify_password, Argon2Params,
    EncryptionConfig, EncryptionStats, UnlockResult,
};
use crate::storage::StorageError;
use crate::AppState;

// Use local error type to avoid conflicts with other command modules
#[derive(Debug, Serialize)]
pub struct CmdError {
    message: String,
}

impl From<StorageError> for CmdError {
    fn from(err: StorageError) -> Self {
        Self {
            message: err.to_string(),
        }
    }
}

impl From<crate::encryption::EncryptionError> for CmdError {
    fn from(err: crate::encryption::EncryptionError) -> Self {
        Self {
            message: err.to_string(),
        }
    }
}

type CmdResult<T> = Result<T, CmdError>;

// ===== Notebook Encryption Commands =====

/// Enable encryption for a notebook
///
/// This will:
/// 1. Derive a key from the password
/// 2. Create encryption config with salt and verification hash
/// 3. Encrypt all existing pages
/// 4. Update notebook metadata
#[tauri::command]
pub fn enable_notebook_encryption(
    state: State<AppState>,
    notebook_id: String,
    password: String,
    password_hint: Option<String>,
) -> CmdResult<EncryptionConfig> {
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CmdError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    if password.is_empty() {
        return Err(CmdError {
            message: "Password cannot be empty".to_string(),
        });
    }

    // Generate salt and derive key
    let salt = generate_salt();
    let key = derive_key(&password, &salt, &Argon2Params::default())?;
    let verification_hash = create_verification_hash(&key);

    // Create encryption config
    let config = EncryptionConfig::new(salt, verification_hash, password_hint);

    // Encrypt all pages
    {
        let storage = state.storage.lock().unwrap();
        storage.encrypt_all_pages(id, &key)?;
    }

    // Update notebook with encryption config
    {
        let storage = state.storage.lock().unwrap();
        let mut notebook = storage.get_notebook(id)?;
        notebook.encryption_config = Some(config.clone());
        notebook.updated_at = chrono::Utc::now();
        storage.update_notebook(&notebook)?;
    }

    // Store key in memory (notebook is now unlocked)
    state.encryption_manager.unlock_notebook(id, key);

    Ok(config)
}

/// Disable encryption for a notebook
///
/// This will:
/// 1. Verify the password
/// 2. Decrypt all pages
/// 3. Remove encryption config from notebook
/// 4. Remove key from memory
#[tauri::command]
pub fn disable_notebook_encryption(
    state: State<AppState>,
    notebook_id: String,
    password: String,
) -> CmdResult<()> {
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CmdError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    // Get notebook and verify it's encrypted
    let notebook = {
        let storage = state.storage.lock().unwrap();
        storage.get_notebook(id)?
    };

    let config = notebook.encryption_config.ok_or_else(|| CmdError {
        message: "Notebook is not encrypted".to_string(),
    })?;

    // Verify password
    let key = verify_password(&password, &config.salt, &config.verification_hash)?;

    // Decrypt all pages
    {
        let storage = state.storage.lock().unwrap();
        storage.decrypt_all_pages(id, &key)?;
    }

    // Remove encryption config
    {
        let storage = state.storage.lock().unwrap();
        let mut notebook = storage.get_notebook(id)?;
        notebook.encryption_config = None;
        notebook.updated_at = chrono::Utc::now();
        storage.update_notebook(&notebook)?;
    }

    // Remove key from memory
    state.encryption_manager.lock_notebook(id);

    Ok(())
}

/// Unlock an encrypted notebook
#[tauri::command]
pub fn unlock_notebook(
    state: State<AppState>,
    notebook_id: String,
    password: String,
) -> CmdResult<UnlockResult> {
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CmdError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    // Get notebook and verify it's encrypted
    let notebook = {
        let storage = state.storage.lock().unwrap();
        storage.get_notebook(id)?
    };

    let config = match notebook.encryption_config {
        Some(c) if c.enabled => c,
        _ => {
            return Ok(UnlockResult::failure("Notebook is not encrypted"));
        }
    };

    // Verify password and get key
    match verify_password(&password, &config.salt, &config.verification_hash) {
        Ok(key) => {
            state.encryption_manager.unlock_notebook(id, key);
            Ok(UnlockResult::success())
        }
        Err(_) => Ok(UnlockResult::failure("Invalid password")),
    }
}

/// Lock an encrypted notebook (clear key from memory)
#[tauri::command]
pub fn lock_notebook(state: State<AppState>, notebook_id: String) -> CmdResult<()> {
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CmdError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    state.encryption_manager.lock_notebook(id);
    Ok(())
}

/// Check if a notebook is unlocked
#[tauri::command]
pub fn is_notebook_unlocked(state: State<AppState>, notebook_id: String) -> CmdResult<bool> {
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CmdError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    Ok(state.encryption_manager.is_notebook_unlocked(id))
}

/// Check if a notebook is encrypted
#[tauri::command]
pub fn is_notebook_encrypted(state: State<AppState>, notebook_id: String) -> CmdResult<bool> {
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CmdError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let storage = state.storage.lock().unwrap();
    let notebook = storage.get_notebook(id)?;

    Ok(notebook.is_encrypted())
}

/// Get the password hint for an encrypted notebook
#[tauri::command]
pub fn get_notebook_password_hint(
    state: State<AppState>,
    notebook_id: String,
) -> CmdResult<Option<String>> {
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CmdError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let storage = state.storage.lock().unwrap();
    let notebook = storage.get_notebook(id)?;

    Ok(notebook.encryption_hint().map(|s| s.to_string()))
}

/// Change the password for an encrypted notebook
#[tauri::command]
pub fn change_notebook_password(
    state: State<AppState>,
    notebook_id: String,
    old_password: String,
    new_password: String,
    new_hint: Option<String>,
) -> CmdResult<EncryptionConfig> {
    let id = Uuid::parse_str(&notebook_id).map_err(|e| CmdError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    if new_password.is_empty() {
        return Err(CmdError {
            message: "New password cannot be empty".to_string(),
        });
    }

    // Get notebook and verify it's encrypted
    let notebook = {
        let storage = state.storage.lock().unwrap();
        storage.get_notebook(id)?
    };

    let config = notebook.encryption_config.ok_or_else(|| CmdError {
        message: "Notebook is not encrypted".to_string(),
    })?;

    // Verify old password
    let old_key = verify_password(&old_password, &config.salt, &config.verification_hash)?;

    // Generate new salt and derive new key
    let new_salt = generate_salt();
    let new_key = derive_key(&new_password, &new_salt, &Argon2Params::default())?;
    let new_verification_hash = create_verification_hash(&new_key);

    // Re-encrypt all pages with new key
    {
        let storage = state.storage.lock().unwrap();
        storage.reencrypt_all_pages(id, &old_key, &new_key)?;
    }

    // Create new encryption config
    let new_config = EncryptionConfig::new(new_salt, new_verification_hash, new_hint);

    // Update notebook
    {
        let storage = state.storage.lock().unwrap();
        let mut notebook = storage.get_notebook(id)?;
        notebook.encryption_config = Some(new_config.clone());
        notebook.updated_at = chrono::Utc::now();
        storage.update_notebook(&notebook)?;
    }

    // Update key in memory
    state.encryption_manager.unlock_notebook(id, new_key);

    Ok(new_config)
}

/// Get all unlocked notebook IDs
#[tauri::command]
pub fn get_unlocked_notebooks(state: State<AppState>) -> CmdResult<Vec<String>> {
    let ids = state.encryption_manager.unlocked_notebook_ids();
    Ok(ids.into_iter().map(|id| id.to_string()).collect())
}

// ===== Library Encryption Commands =====

/// Enable encryption for a library
#[tauri::command]
pub fn enable_library_encryption(
    state: State<AppState>,
    library_id: String,
    password: String,
    password_hint: Option<String>,
) -> CmdResult<EncryptionConfig> {
    let id = Uuid::parse_str(&library_id).map_err(|e| CmdError {
        message: format!("Invalid library ID: {}", e),
    })?;

    if password.is_empty() {
        return Err(CmdError {
            message: "Password cannot be empty".to_string(),
        });
    }

    // Generate salt and derive key
    let salt = generate_salt();
    let key = derive_key(&password, &salt, &Argon2Params::default())?;
    let verification_hash = create_verification_hash(&key);

    // Create encryption config
    let config = EncryptionConfig::new_library(salt, verification_hash, password_hint);

    // Get all notebooks in this library and encrypt their pages
    let notebooks = {
        let storage = state.storage.lock().unwrap();
        storage.list_notebooks()?
    };

    for notebook in &notebooks {
        let storage = state.storage.lock().unwrap();
        storage.encrypt_all_pages(notebook.id, &key)?;
    }

    // Update library with encryption config
    {
        let library_storage = state.library_storage.lock().unwrap();
        library_storage
            .update_library_encryption(id, Some(config.clone()))
            .map_err(|e| CmdError {
                message: e.to_string(),
            })?;
    }

    // Store key in memory (library is now unlocked)
    state.encryption_manager.unlock_library(id, key);

    Ok(config)
}

/// Disable encryption for a library
#[tauri::command]
pub fn disable_library_encryption(
    state: State<AppState>,
    library_id: String,
    password: String,
) -> CmdResult<()> {
    let id = Uuid::parse_str(&library_id).map_err(|e| CmdError {
        message: format!("Invalid library ID: {}", e),
    })?;

    // Get library and verify it's encrypted
    let library = {
        let library_storage = state.library_storage.lock().unwrap();
        library_storage.get_library(id).map_err(|e| CmdError {
            message: e.to_string(),
        })?
    };

    let config = library.encryption_config.ok_or_else(|| CmdError {
        message: "Library is not encrypted".to_string(),
    })?;

    // Verify password
    let key = verify_password(&password, &config.salt, &config.verification_hash)?;

    // Get all notebooks and decrypt their pages
    let notebooks = {
        let storage = state.storage.lock().unwrap();
        storage.list_notebooks()?
    };

    for notebook in &notebooks {
        let storage = state.storage.lock().unwrap();
        storage.decrypt_all_pages(notebook.id, &key)?;
    }

    // Remove encryption config from library
    {
        let library_storage = state.library_storage.lock().unwrap();
        library_storage
            .update_library_encryption(id, None)
            .map_err(|e| CmdError {
                message: e.to_string(),
            })?;
    }

    // Remove key from memory
    state.encryption_manager.lock_library(id);

    Ok(())
}

/// Unlock an encrypted library
#[tauri::command]
pub fn unlock_library(
    state: State<AppState>,
    library_id: String,
    password: String,
) -> CmdResult<UnlockResult> {
    let id = Uuid::parse_str(&library_id).map_err(|e| CmdError {
        message: format!("Invalid library ID: {}", e),
    })?;

    // Get library and verify it's encrypted
    let library = {
        let library_storage = state.library_storage.lock().unwrap();
        library_storage.get_library(id).map_err(|e| CmdError {
            message: e.to_string(),
        })?
    };

    let config = match library.encryption_config {
        Some(c) if c.enabled => c,
        _ => {
            return Ok(UnlockResult::failure("Library is not encrypted"));
        }
    };

    // Verify password and get key
    match verify_password(&password, &config.salt, &config.verification_hash) {
        Ok(key) => {
            state.encryption_manager.unlock_library(id, key);
            Ok(UnlockResult::success())
        }
        Err(_) => Ok(UnlockResult::failure("Invalid password")),
    }
}

/// Lock an encrypted library
#[tauri::command]
pub fn lock_library(state: State<AppState>, library_id: String) -> CmdResult<()> {
    let id = Uuid::parse_str(&library_id).map_err(|e| CmdError {
        message: format!("Invalid library ID: {}", e),
    })?;

    state.encryption_manager.lock_library(id);
    Ok(())
}

/// Check if a library is unlocked
#[tauri::command]
pub fn is_library_unlocked(state: State<AppState>, library_id: String) -> CmdResult<bool> {
    let id = Uuid::parse_str(&library_id).map_err(|e| CmdError {
        message: format!("Invalid library ID: {}", e),
    })?;

    Ok(state.encryption_manager.is_library_unlocked(id))
}

/// Check if a library is encrypted
#[tauri::command]
pub fn is_library_encrypted(state: State<AppState>, library_id: String) -> CmdResult<bool> {
    let id = Uuid::parse_str(&library_id).map_err(|e| CmdError {
        message: format!("Invalid library ID: {}", e),
    })?;

    let library_storage = state.library_storage.lock().unwrap();
    let library = library_storage.get_library(id).map_err(|e| CmdError {
        message: e.to_string(),
    })?;

    Ok(library.is_encrypted())
}

/// Get the password hint for an encrypted library
#[tauri::command]
pub fn get_library_password_hint(
    state: State<AppState>,
    library_id: String,
) -> CmdResult<Option<String>> {
    let id = Uuid::parse_str(&library_id).map_err(|e| CmdError {
        message: format!("Invalid library ID: {}", e),
    })?;

    let library_storage = state.library_storage.lock().unwrap();
    let library = library_storage.get_library(id).map_err(|e| CmdError {
        message: e.to_string(),
    })?;

    Ok(library.encryption_hint().map(|s| s.to_string()))
}

// ===== Global Encryption Commands =====

/// Lock all notebooks and libraries
#[tauri::command]
pub fn lock_all(state: State<AppState>) -> CmdResult<()> {
    state.encryption_manager.lock_all();
    Ok(())
}

/// Get encryption statistics
#[tauri::command]
pub fn get_encryption_stats(state: State<AppState>) -> CmdResult<EncryptionStats> {
    Ok(state.encryption_manager.stats())
}

/// Cleanup expired sessions (auto-lock)
#[tauri::command]
pub fn cleanup_expired_sessions(state: State<AppState>) -> CmdResult<()> {
    state.encryption_manager.cleanup_expired();
    Ok(())
}
