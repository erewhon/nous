//! Encryption data models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

/// Magic bytes to identify encrypted files
pub const ENCRYPTED_MAGIC: &str = "KATT_ENC";

/// Current encryption algorithm version
pub const ALGORITHM_VERSION: u32 = 1;

/// Encryption level for notebooks/libraries
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum EncryptionLevel {
    /// No encryption
    #[default]
    None,
    /// Individual notebook encrypted
    Notebook,
    /// Entire library encrypted
    Library,
}

/// Configuration stored with encrypted notebooks/libraries
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionConfig {
    /// Whether encryption is enabled
    pub enabled: bool,
    /// Encryption level
    pub level: EncryptionLevel,
    /// Salt for key derivation (base64-encoded)
    pub salt: String,
    /// Verification hash to check password correctness (base64-encoded)
    pub verification_hash: String,
    /// Algorithm version for future compatibility
    pub algorithm_version: u32,
    /// When encryption was enabled
    pub encrypted_at: DateTime<Utc>,
    /// Optional password hint
    pub password_hint: Option<String>,
}

impl EncryptionConfig {
    /// Create a new encryption config
    pub fn new(salt: String, verification_hash: String, password_hint: Option<String>) -> Self {
        Self {
            enabled: true,
            level: EncryptionLevel::Notebook,
            salt,
            verification_hash,
            algorithm_version: ALGORITHM_VERSION,
            encrypted_at: Utc::now(),
            password_hint,
        }
    }

    /// Create a library-level encryption config
    pub fn new_library(salt: String, verification_hash: String, password_hint: Option<String>) -> Self {
        let mut config = Self::new(salt, verification_hash, password_hint);
        config.level = EncryptionLevel::Library;
        config
    }
}

/// Metadata stored with each encrypted file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionMetadata {
    /// Encryption algorithm version
    pub version: u32,
    /// Nonce used for this encryption (base64-encoded)
    pub nonce: String,
    /// Original unencrypted size in bytes
    pub original_size: u64,
    /// Content type (e.g., "application/json", "image/png")
    pub content_type: String,
}

/// Container format for encrypted files on disk
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedContainer {
    /// Magic identifier
    pub magic: String,
    /// Encryption metadata
    pub metadata: EncryptionMetadata,
    /// Encrypted data (base64-encoded)
    pub ciphertext: String,
    /// Authentication tag (base64-encoded) - included in ciphertext for ChaCha20-Poly1305
    pub tag: String,
}

impl EncryptedContainer {
    /// Create a new encrypted container
    pub fn new(
        nonce: String,
        ciphertext: String,
        tag: String,
        original_size: u64,
        content_type: String,
    ) -> Self {
        Self {
            magic: ENCRYPTED_MAGIC.to_string(),
            metadata: EncryptionMetadata {
                version: ALGORITHM_VERSION,
                nonce,
                original_size,
                content_type,
            },
            ciphertext,
            tag,
        }
    }

    /// Check if the magic bytes are valid
    pub fn is_valid_magic(&self) -> bool {
        self.magic == ENCRYPTED_MAGIC
    }

    /// Serialize to JSON string
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Deserialize from JSON string
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

/// Encryption key with secure memory handling
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct EncryptionKey {
    /// The 256-bit key
    key: [u8; 32],
}

impl EncryptionKey {
    /// Create a new encryption key from raw bytes
    pub fn new(key: [u8; 32]) -> Self {
        Self { key }
    }

    /// Get the key bytes
    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.key
    }
}

impl std::fmt::Debug for EncryptionKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EncryptionKey")
            .field("key", &"[REDACTED]")
            .finish()
    }
}

/// Argon2id parameters for key derivation
#[derive(Debug, Clone)]
pub struct Argon2Params {
    /// Memory cost in KiB (65536 = 64MB)
    pub memory_cost: u32,
    /// Number of iterations
    pub time_cost: u32,
    /// Parallelism factor
    pub parallelism: u32,
}

impl Default for Argon2Params {
    fn default() -> Self {
        Self {
            memory_cost: 65536, // 64 MB
            time_cost: 3,
            parallelism: 4,
        }
    }
}

/// Response for unlock operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnlockResult {
    pub success: bool,
    pub error: Option<String>,
}

impl UnlockResult {
    pub fn success() -> Self {
        Self {
            success: true,
            error: None,
        }
    }

    pub fn failure(error: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(error.into()),
        }
    }
}
