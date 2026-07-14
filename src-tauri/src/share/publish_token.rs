//! HMAC-SHA256 publish token + shared secret for Publish-Static-to-Nous.
//!
//! Mirrors the collab pattern (a 32-byte secret shared with the cloud Worker,
//! set there as the hex-encoded `PUBLISH_HMAC_SECRET` binding). Token format
//! matches `cloud/src/crypto/publish-token.ts`:
//! `base64url(payloadJSON).base64url(HMAC-SHA256(payload_b64))`, payload `{pub, exp}`.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::path::{Path, PathBuf};

type HmacSha256 = Hmac<Sha256>;

const SERVICE_NAME: &str = "nous-publish";

#[derive(Debug, Serialize, Deserialize)]
struct PublishTokenPayload {
    #[serde(rename = "pub")]
    publisher: String,
    exp: i64,
}

fn secret_file_path(data_dir: &Path) -> PathBuf {
    data_dir
        .join(".credentials")
        .join(SERVICE_NAME)
        .join("secret")
}

/// Get or create the 32-byte publish secret (stored hex on disk). The same hex
/// must be set on the cloud Worker as the `PUBLISH_HMAC_SECRET` binding.
pub fn get_or_create_publish_secret(data_dir: &Path) -> Result<Vec<u8>, String> {
    let path = secret_file_path(data_dir);
    if let Ok(data) = std::fs::read_to_string(&path) {
        return hex::decode(data.trim()).map_err(|e| format!("Invalid publish secret: {}", e));
    }

    let secret: Vec<u8> = (0..32).map(|_| rand::random::<u8>()).collect();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create credentials dir: {}", e))?;
    }
    std::fs::write(&path, hex::encode(&secret))
        .map_err(|e| format!("Failed to write publish secret: {}", e))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(secret)
}

/// Sign a publish token for `publisher_id`, valid for `ttl`.
pub fn sign_publish_token(publisher_id: &str, secret: &[u8], ttl: Duration) -> String {
    let payload = PublishTokenPayload {
        publisher: publisher_id.to_string(),
        exp: (Utc::now() + ttl).timestamp(),
    };
    let payload_json = serde_json::to_string(&payload).expect("serialize publish payload");
    let payload_b64 = URL_SAFE_NO_PAD.encode(payload_json.as_bytes());

    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC can take key of any size");
    mac.update(payload_b64.as_bytes());
    let sig_b64 = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    format!("{}.{}", payload_b64, sig_b64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_token_has_two_base64url_parts_and_verifies() {
        let secret = [7u8; 32];
        let token = sign_publish_token("lib-123", &secret, Duration::hours(1));

        let parts: Vec<&str> = token.splitn(2, '.').collect();
        assert_eq!(parts.len(), 2);

        // Recompute the HMAC over payload_b64 and confirm it matches the sig —
        // this is exactly what the cloud Worker's verifyPublishToken does.
        let mut mac = HmacSha256::new_from_slice(&secret).unwrap();
        mac.update(parts[0].as_bytes());
        let expected_sig = URL_SAFE_NO_PAD.decode(parts[1]).unwrap();
        assert!(mac.verify_slice(&expected_sig).is_ok());

        // Payload decodes and carries the publisher + a future expiry.
        let payload_bytes = URL_SAFE_NO_PAD.decode(parts[0]).unwrap();
        let payload: PublishTokenPayload = serde_json::from_slice(&payload_bytes).unwrap();
        assert_eq!(payload.publisher, "lib-123");
        assert!(payload.exp > Utc::now().timestamp());
    }

    #[test]
    fn different_secret_produces_different_signature() {
        let token_a = sign_publish_token("x", &[1u8; 32], Duration::hours(1));
        let token_b = sign_publish_token("x", &[2u8; 32], Duration::hours(1));
        // Same publisher, but the signatures differ.
        assert_ne!(
            token_a.split('.').nth(1).unwrap(),
            token_b.split('.').nth(1).unwrap()
        );
    }
}
