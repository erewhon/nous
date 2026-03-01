//! HMAC-SHA256 token generation for collab sessions.
//!
//! Token format: `base64url(JSON payload).base64url(HMAC-SHA256 signature)`
//! Payload: `{ room_id, page_id, permissions, exp }`

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPayload {
    pub room_id: String,
    pub page_id: String,
    pub permissions: String,
    /// Unix timestamp (seconds) when token expires.
    pub exp: i64,
}

/// Generate an HMAC-SHA256 signed token for a collab session.
pub fn generate_token(
    room_id: &str,
    page_id: &str,
    secret: &[u8],
    expires_in: Duration,
) -> String {
    let exp = (Utc::now() + expires_in).timestamp();
    let payload = TokenPayload {
        room_id: room_id.to_string(),
        page_id: page_id.to_string(),
        permissions: "rw".to_string(),
        exp,
    };

    let payload_json = serde_json::to_string(&payload).expect("Failed to serialize token payload");
    let payload_b64 = URL_SAFE_NO_PAD.encode(payload_json.as_bytes());

    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC can take key of any size");
    mac.update(payload_b64.as_bytes());
    let sig = mac.finalize().into_bytes();
    let sig_b64 = URL_SAFE_NO_PAD.encode(sig);

    format!("{}.{}", payload_b64, sig_b64)
}

/// Verify a token's HMAC signature and check expiry. Returns the payload if valid.
pub fn verify_token(token: &str, secret: &[u8]) -> Result<TokenPayload, String> {
    let parts: Vec<&str> = token.splitn(2, '.').collect();
    if parts.len() != 2 {
        return Err("Invalid token format".to_string());
    }

    let payload_b64 = parts[0];
    let sig_b64 = parts[1];

    // Verify signature
    let mut mac = HmacSha256::new_from_slice(secret).expect("HMAC can take key of any size");
    mac.update(payload_b64.as_bytes());
    let expected_sig = URL_SAFE_NO_PAD
        .decode(sig_b64)
        .map_err(|e| format!("Invalid signature encoding: {}", e))?;
    mac.verify_slice(&expected_sig)
        .map_err(|_| "Invalid signature".to_string())?;

    // Decode payload
    let payload_bytes = URL_SAFE_NO_PAD
        .decode(payload_b64)
        .map_err(|e| format!("Invalid payload encoding: {}", e))?;
    let payload: TokenPayload =
        serde_json::from_slice(&payload_bytes).map_err(|e| format!("Invalid payload: {}", e))?;

    // Check expiry
    if Utc::now().timestamp() > payload.exp {
        return Err("Token expired".to_string());
    }

    Ok(payload)
}
