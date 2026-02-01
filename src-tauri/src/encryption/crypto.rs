//! Cryptographic operations for encryption/decryption

use argon2::{
    password_hash::{PasswordHasher, SaltString},
    Argon2, Algorithm, Params, Version,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    ChaCha20Poly1305, Nonce,
};
use rand::RngCore;
use sha2::{Digest, Sha256};
use zeroize::Zeroize;

use super::errors::{EncryptionError, EncryptionResult};
use super::models::{Argon2Params, EncryptedContainer, EncryptionKey, ENCRYPTED_MAGIC};

/// Salt size in bytes
const SALT_SIZE: usize = 16;

/// Nonce size in bytes for ChaCha20-Poly1305
const NONCE_SIZE: usize = 12;

/// Generate a random salt for key derivation
pub fn generate_salt() -> String {
    let mut salt = [0u8; SALT_SIZE];
    rand::thread_rng().fill_bytes(&mut salt);
    BASE64.encode(salt)
}

/// Generate a random nonce for encryption
pub fn generate_nonce() -> [u8; NONCE_SIZE] {
    let mut nonce = [0u8; NONCE_SIZE];
    rand::thread_rng().fill_bytes(&mut nonce);
    nonce
}

/// Derive an encryption key from a password using Argon2id
pub fn derive_key(password: &str, salt_b64: &str, params: &Argon2Params) -> EncryptionResult<EncryptionKey> {
    let salt_bytes = BASE64.decode(salt_b64).map_err(EncryptionError::Base64Error)?;

    // Create Argon2id instance with our parameters
    let argon2_params = Params::new(
        params.memory_cost,
        params.time_cost,
        params.parallelism,
        Some(32), // Output 256-bit key
    )
    .map_err(|e| EncryptionError::KeyDerivationFailed(e.to_string()))?;

    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, argon2_params);

    // Derive the key
    let mut key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), &salt_bytes, &mut key)
        .map_err(|e| EncryptionError::KeyDerivationFailed(e.to_string()))?;

    Ok(EncryptionKey::new(key))
}

/// Create a verification hash from the derived key
/// This is stored to verify the password is correct without storing the key itself
pub fn create_verification_hash(key: &EncryptionKey) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    hasher.update(b"KATT_VERIFY");  // Domain separation
    let result = hasher.finalize();
    BASE64.encode(result)
}

/// Verify a password by checking the verification hash
pub fn verify_password(password: &str, salt_b64: &str, expected_hash: &str) -> EncryptionResult<EncryptionKey> {
    let key = derive_key(password, salt_b64, &Argon2Params::default())?;
    let computed_hash = create_verification_hash(&key);

    if computed_hash == expected_hash {
        Ok(key)
    } else {
        Err(EncryptionError::InvalidPassword)
    }
}

/// Encrypt data using ChaCha20-Poly1305
pub fn encrypt(plaintext: &[u8], key: &EncryptionKey) -> EncryptionResult<(Vec<u8>, [u8; NONCE_SIZE])> {
    let cipher = ChaCha20Poly1305::new_from_slice(key.as_bytes())
        .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))?;

    let nonce_bytes = generate_nonce();
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| EncryptionError::EncryptionFailed(e.to_string()))?;

    Ok((ciphertext, nonce_bytes))
}

/// Decrypt data using ChaCha20-Poly1305
pub fn decrypt(ciphertext: &[u8], key: &EncryptionKey, nonce_bytes: &[u8]) -> EncryptionResult<Vec<u8>> {
    if nonce_bytes.len() != NONCE_SIZE {
        return Err(EncryptionError::DecryptionFailed(format!(
            "Invalid nonce size: expected {}, got {}",
            NONCE_SIZE,
            nonce_bytes.len()
        )));
    }

    let cipher = ChaCha20Poly1305::new_from_slice(key.as_bytes())
        .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))?;

    let nonce = Nonce::from_slice(nonce_bytes);

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| EncryptionError::DecryptionFailed(e.to_string()))
}

/// Encrypt data and return an EncryptedContainer ready for storage
pub fn encrypt_to_container(
    plaintext: &[u8],
    key: &EncryptionKey,
    content_type: &str,
) -> EncryptionResult<EncryptedContainer> {
    let (ciphertext, nonce) = encrypt(plaintext, key)?;

    // ChaCha20-Poly1305 appends the auth tag to the ciphertext
    // We'll store them together but keep track of the tag separately for the format
    let tag_offset = ciphertext.len().saturating_sub(16);
    let (cipher_data, tag_data) = ciphertext.split_at(tag_offset);

    Ok(EncryptedContainer::new(
        BASE64.encode(nonce),
        BASE64.encode(cipher_data),
        BASE64.encode(tag_data),
        plaintext.len() as u64,
        content_type.to_string(),
    ))
}

/// Decrypt data from an EncryptedContainer
pub fn decrypt_from_container(container: &EncryptedContainer, key: &EncryptionKey) -> EncryptionResult<Vec<u8>> {
    if !container.is_valid_magic() {
        return Err(EncryptionError::InvalidMagic);
    }

    let nonce = BASE64.decode(&container.metadata.nonce)?;
    let cipher_data = BASE64.decode(&container.ciphertext)?;
    let tag_data = BASE64.decode(&container.tag)?;

    // Reconstruct the ciphertext with appended tag for ChaCha20-Poly1305
    let mut ciphertext = cipher_data;
    ciphertext.extend_from_slice(&tag_data);

    decrypt(&ciphertext, key, &nonce)
}

/// Encrypt a JSON-serializable value
pub fn encrypt_json<T: serde::Serialize>(value: &T, key: &EncryptionKey) -> EncryptionResult<EncryptedContainer> {
    let json = serde_json::to_string_pretty(value)?;
    encrypt_to_container(json.as_bytes(), key, "application/json")
}

/// Decrypt and deserialize a JSON value from an EncryptedContainer
pub fn decrypt_json<T: serde::de::DeserializeOwned>(
    container: &EncryptedContainer,
    key: &EncryptionKey,
) -> EncryptionResult<T> {
    let plaintext = decrypt_from_container(container, key)?;
    let value: T = serde_json::from_slice(&plaintext)?;
    Ok(value)
}

/// Check if file content appears to be an encrypted container
pub fn is_encrypted_file(content: &str) -> bool {
    // Quick check before parsing JSON
    content.trim_start().starts_with("{") && content.contains(ENCRYPTED_MAGIC)
}

/// Parse file content as an EncryptedContainer if it's encrypted
pub fn parse_encrypted_file(content: &str) -> EncryptionResult<Option<EncryptedContainer>> {
    if !is_encrypted_file(content) {
        return Ok(None);
    }

    match serde_json::from_str::<EncryptedContainer>(content) {
        Ok(container) if container.is_valid_magic() => Ok(Some(container)),
        Ok(_) => Ok(None),  // Valid JSON but not our format
        Err(_) => Ok(None), // Not valid JSON
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_salt_generation() {
        let salt1 = generate_salt();
        let salt2 = generate_salt();
        assert_ne!(salt1, salt2);
        assert!(BASE64.decode(&salt1).is_ok());
    }

    #[test]
    fn test_key_derivation() {
        let salt = generate_salt();
        let key = derive_key("test_password", &salt, &Argon2Params::default()).unwrap();
        assert_eq!(key.as_bytes().len(), 32);
    }

    #[test]
    fn test_verification_hash() {
        let salt = generate_salt();
        let key = derive_key("test_password", &salt, &Argon2Params::default()).unwrap();
        let hash = create_verification_hash(&key);

        // Same password should produce same hash
        let key2 = derive_key("test_password", &salt, &Argon2Params::default()).unwrap();
        let hash2 = create_verification_hash(&key2);
        assert_eq!(hash, hash2);

        // Different password should produce different hash
        let key3 = derive_key("wrong_password", &salt, &Argon2Params::default()).unwrap();
        let hash3 = create_verification_hash(&key3);
        assert_ne!(hash, hash3);
    }

    #[test]
    fn test_password_verification() {
        let salt = generate_salt();
        let key = derive_key("test_password", &salt, &Argon2Params::default()).unwrap();
        let hash = create_verification_hash(&key);

        // Correct password
        assert!(verify_password("test_password", &salt, &hash).is_ok());

        // Wrong password
        assert!(verify_password("wrong_password", &salt, &hash).is_err());
    }

    #[test]
    fn test_encrypt_decrypt() {
        let salt = generate_salt();
        let key = derive_key("test_password", &salt, &Argon2Params::default()).unwrap();

        let plaintext = b"Hello, World!";
        let (ciphertext, nonce) = encrypt(plaintext, &key).unwrap();
        let decrypted = decrypt(&ciphertext, &key, &nonce).unwrap();

        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_container_roundtrip() {
        let salt = generate_salt();
        let key = derive_key("test_password", &salt, &Argon2Params::default()).unwrap();

        let plaintext = b"Hello, encrypted World!";
        let container = encrypt_to_container(plaintext, &key, "text/plain").unwrap();

        assert!(container.is_valid_magic());
        assert_eq!(container.metadata.content_type, "text/plain");
        assert_eq!(container.metadata.original_size, plaintext.len() as u64);

        let decrypted = decrypt_from_container(&container, &key).unwrap();
        assert_eq!(plaintext.as_slice(), decrypted.as_slice());
    }

    #[test]
    fn test_json_encrypt_decrypt() {
        #[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
        struct TestData {
            name: String,
            value: i32,
        }

        let salt = generate_salt();
        let key = derive_key("test_password", &salt, &Argon2Params::default()).unwrap();

        let data = TestData {
            name: "test".to_string(),
            value: 42,
        };

        let container = encrypt_json(&data, &key).unwrap();
        let decrypted: TestData = decrypt_json(&container, &key).unwrap();

        assert_eq!(data, decrypted);
    }

    #[test]
    fn test_is_encrypted_file() {
        let encrypted_content = r#"{"magic":"KATT_ENC","metadata":{},"ciphertext":"","tag":""}"#;
        assert!(is_encrypted_file(encrypted_content));

        let normal_content = r#"{"id":"123","title":"test"}"#;
        assert!(!is_encrypted_file(normal_content));

        let not_json = "Hello, World!";
        assert!(!is_encrypted_file(not_json));
    }
}
