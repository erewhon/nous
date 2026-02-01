//! Encryption module for notebook and library password protection
//!
//! This module provides:
//! - ChaCha20-Poly1305 authenticated encryption
//! - Argon2id password-based key derivation
//! - In-memory key management for unlocked notebooks/libraries
//! - Encrypted file container format

pub mod crypto;
pub mod errors;
pub mod manager;
pub mod models;

// Re-export commonly used types
pub use crypto::{
    create_verification_hash, decrypt, decrypt_from_container, decrypt_json, derive_key, encrypt,
    encrypt_json, encrypt_to_container, generate_salt, is_encrypted_file, parse_encrypted_file,
    verify_password,
};
pub use errors::{EncryptionError, EncryptionResult};
pub use manager::{EncryptionManager, EncryptionStats};
pub use models::{
    Argon2Params, EncryptedContainer, EncryptionConfig, EncryptionKey, EncryptionLevel,
    EncryptionMetadata, UnlockResult, ALGORITHM_VERSION, ENCRYPTED_MAGIC,
};
