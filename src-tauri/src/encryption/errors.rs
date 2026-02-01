//! Encryption error types

use thiserror::Error;

/// Errors that can occur during encryption operations
#[derive(Debug, Error)]
pub enum EncryptionError {
    #[error("Encryption is not enabled for this notebook")]
    NotEncrypted,

    #[error("Notebook is locked. Please unlock with password first.")]
    NotebookLocked,

    #[error("Library is locked. Please unlock with password first.")]
    LibraryLocked,

    #[error("Invalid password")]
    InvalidPassword,

    #[error("Password is required")]
    PasswordRequired,

    #[error("Key derivation failed: {0}")]
    KeyDerivationFailed(String),

    #[error("Encryption failed: {0}")]
    EncryptionFailed(String),

    #[error("Decryption failed: {0}")]
    DecryptionFailed(String),

    #[error("Invalid encrypted data format")]
    InvalidFormat,

    #[error("Invalid magic bytes - not an encrypted file")]
    InvalidMagic,

    #[error("Unsupported encryption version: {0}")]
    UnsupportedVersion(u32),

    #[error("Base64 decode error: {0}")]
    Base64Error(#[from] base64::DecodeError),

    #[error("JSON serialization error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("UUID parse error: {0}")]
    UuidError(#[from] uuid::Error),
}

impl From<EncryptionError> for String {
    fn from(err: EncryptionError) -> Self {
        err.to_string()
    }
}

/// Result type alias for encryption operations
pub type EncryptionResult<T> = Result<T, EncryptionError>;
