//! HMAC-SHA256 token generation for collab sessions.
//!
//! Token format: `base64url(JSON payload).base64url(HMAC-SHA256 signature)`
//! Payload includes scope fields for multi-page collaboration support.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{Duration, Utc};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenPayload {
    /// Scope type: "page", "section", or "notebook"
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_type: Option<String>,
    /// Scope ID: page_id, section_id, or notebook_id depending on scope_type
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_id: Option<String>,
    /// Notebook ID — always present (needed to construct deterministic room IDs)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notebook_id: Option<String>,
    pub permissions: String,
    /// Unix timestamp (seconds) when token expires.
    pub exp: i64,
    // Backward compat: populated for single-page sessions and legacy tokens
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_id: Option<String>,
}

/// Generate an HMAC-SHA256 signed token for a single-page collab session.
/// `permissions` should be "rw" for read-write or "r" for read-only.
pub fn generate_token(
    room_id: &str,
    page_id: &str,
    secret: &[u8],
    expires_in: Duration,
    permissions: &str,
) -> String {
    let exp = (Utc::now() + expires_in).timestamp();
    // Extract notebook_id from deterministic room ID (format: notebook_id:page_id)
    let notebook_id = room_id.split(':').next().map(|s| s.to_string());
    let payload = TokenPayload {
        scope_type: Some("page".to_string()),
        scope_id: Some(page_id.to_string()),
        notebook_id,
        permissions: permissions.to_string(),
        exp,
        // Backward compat
        room_id: Some(room_id.to_string()),
        page_id: Some(page_id.to_string()),
    };

    sign_payload(&payload, secret)
}

/// Generate an HMAC-SHA256 signed token for a scoped collab session.
/// `scope_type` is "section" or "notebook".
pub fn generate_scoped_token(
    scope_type: &str,
    scope_id: &str,
    notebook_id: &str,
    secret: &[u8],
    expires_in: Duration,
    permissions: &str,
) -> String {
    let exp = (Utc::now() + expires_in).timestamp();
    let payload = TokenPayload {
        scope_type: Some(scope_type.to_string()),
        scope_id: Some(scope_id.to_string()),
        notebook_id: Some(notebook_id.to_string()),
        permissions: permissions.to_string(),
        exp,
        room_id: None,
        page_id: None,
    };

    sign_payload(&payload, secret)
}

fn sign_payload(payload: &TokenPayload, secret: &[u8]) -> String {
    let payload_json = serde_json::to_string(payload).expect("Failed to serialize token payload");
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
