//! Browser sessions: a stateless signed cookie so web clients (and plain
//! `<img>` tags and same-origin WebSockets, which cannot send
//! Authorization headers) authenticate against the daemon.
//!
//! Ported from Astra's `daemon/session.rs`. `POST /api/session` verifies a
//! Zitadel **ID token** (access tokens lack the email claim
//! invite-matching needs) through the same invite-gated
//! [`super::oidc::resolve_user`] path as bearer JWTs, then sets an
//! HttpOnly cookie `nous_session=<user_id_b64>.<exp>.<hmac>` signed with a
//! key generated once into `{data_dir}/session-key` (0600). No session
//! table — the cookie is self-authenticating, and the auth middleware
//! re-checks the user's status on every request, so disabling a user
//! kills their sessions immediately. Logout clears the cookie client-side
//! only; the value stays cryptographically valid until `exp` (same
//! trade-off as Astra — revocation is the status re-check).
//!
//! The session bootstrap routes (`POST/DELETE /api/session`,
//! `GET /api/session/config`) are on the public-route allowlist — logging
//! in is how you obtain credentials. `GET /api/me` is a normal
//! authenticated route.

use std::path::Path;
use std::sync::Arc;

use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64URL, Engine};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;

use super::daemon::DaemonState;
use super::oidc::{OidcAuthError, OidcVerifier};
use super::tenants::ReloadingRegistry;

pub const COOKIE_NAME: &str = "nous_session";
const SESSION_TTL_SECS: i64 = 7 * 24 * 3600;

type HmacSha256 = Hmac<Sha256>;

/// Everything multi-user mode shares between the auth middleware and the
/// session/`/api/me` handlers: one registry handle, one verifier, one
/// cookie-signing key.
#[derive(Clone)]
pub struct MultiUserCtx {
    /// HMAC key for session cookies ({data_dir}/session-key).
    pub session_key: [u8; 32],
    pub registry: Arc<std::sync::Mutex<ReloadingRegistry>>,
    /// None → no OIDC: sign-in and session config 404/401; PATs only.
    pub oidc: Option<Arc<OidcVerifier>>,
}

/// Load the cookie-signing key, generating it on first boot (0600).
pub fn load_or_create_session_key(data_dir: &Path) -> Result<[u8; 32], String> {
    let path = data_dir.join("session-key");
    if path.exists() {
        let hex_str =
            std::fs::read_to_string(&path).map_err(|e| format!("read session key: {e}"))?;
        let bytes = hex::decode(hex_str.trim()).map_err(|e| format!("session key: {e}"))?;
        return bytes
            .try_into()
            .map_err(|_| "session key must be 32 bytes".to_string());
    }

    let mut key = [0u8; 32];
    rand::Rng::fill(&mut rand::thread_rng(), &mut key);
    #[cfg(unix)]
    {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .map_err(|e| format!("create session key: {e}"))?;
        f.write_all(hex::encode(key).as_bytes())
            .map_err(|e| format!("write session key: {e}"))?;
    }
    #[cfg(not(unix))]
    std::fs::write(&path, hex::encode(key)).map_err(|e| format!("write session key: {e}"))?;
    Ok(key)
}

fn signature(key: &[u8], payload: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(key).expect("hmac accepts any key length");
    mac.update(payload.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// `<user_id_b64url>.<exp_unix>.<hmac_hex>`
pub fn mint_cookie_value(key: &[u8], user_id: &str, expires_at_unix: i64) -> String {
    let payload = format!("{}.{}", B64URL.encode(user_id), expires_at_unix);
    let sig = signature(key, &payload);
    format!("{payload}.{sig}")
}

/// Verify signature + expiry; returns the user id.
pub fn verify_cookie_value(key: &[u8], value: &str, now_unix: i64) -> Option<String> {
    let mut parts = value.splitn(3, '.');
    let (user_b64, exp_str, sig) = (parts.next()?, parts.next()?, parts.next()?);
    let payload = format!("{user_b64}.{exp_str}");

    let mut mac = HmacSha256::new_from_slice(key).ok()?;
    mac.update(payload.as_bytes());
    mac.verify_slice(&hex::decode(sig).ok()?).ok()?;

    let exp: i64 = exp_str.parse().ok()?;
    if exp <= now_unix {
        return None;
    }
    String::from_utf8(B64URL.decode(user_b64).ok()?).ok()
}

/// Pull the session cookie value out of request headers, if any.
pub fn cookie_from_headers(headers: &HeaderMap) -> Option<String> {
    let prefix = format!("{COOKIE_NAME}=");
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|line| line.split(';'))
        .map(str::trim)
        .find_map(|pair| pair.strip_prefix(prefix.as_str()).map(str::to_string))
}

fn set_cookie(value: &str, max_age: i64) -> String {
    format!("{COOKIE_NAME}={value}; Path=/; Max-Age={max_age}; HttpOnly; Secure; SameSite=Lax")
}

/// The `/api/me` payload — also returned by a successful login.
fn me_payload(reg: &ReloadingRegistryUser) -> serde_json::Value {
    serde_json::json!({
        "userId": reg.user_id,
        "username": reg.username,
        "displayName": reg.display_name,
        "role": reg.role,
        "status": reg.status,
    })
}

/// Flat view of a registry user for responses.
struct ReloadingRegistryUser {
    user_id: String,
    username: Option<String>,
    display_name: Option<String>,
    role: String,
    status: String,
}

fn fetch_me(ctx: &MultiUserCtx, user_id: &str) -> Option<ReloadingRegistryUser> {
    let mut reg = ctx.registry.lock().unwrap_or_else(|p| p.into_inner());
    reg.with_fresh(|r| {
        r.find_by_id(user_id).map(|u| ReloadingRegistryUser {
            user_id: u.id.clone(),
            username: u.username.clone(),
            display_name: u.display_name.clone(),
            role: u.role.as_str().to_string(),
            status: u.status.as_str().to_string(),
        })
    })
}

fn unauthorized() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(serde_json::json!({ "error": "unauthorized" })),
    )
        .into_response()
}

fn server_error() -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({ "error": "internal error" })),
    )
        .into_response()
}

fn not_multi_user() -> Response {
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({ "error": "multi-user mode is not enabled" })),
    )
        .into_response()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionBody {
    id_token: String,
}

/// `GET /api/session/config` — issuer + client id for the SPA login flow.
/// 404 when multi-user/OIDC isn't configured, so the frontend can show
/// "sign-in unavailable" instead of a broken redirect.
pub async fn session_config(State(state): State<Arc<DaemonState>>) -> Response {
    let Some(ctx) = &state.multi_user else {
        return not_multi_user();
    };
    let Some(oidc) = &ctx.oidc else {
        return not_multi_user();
    };
    let cfg = oidc.config();
    Json(serde_json::json!({
        "issuer": cfg.issuer,
        "clientId": cfg.client_id,
    }))
    .into_response()
}

/// `POST /api/session` — Zitadel ID token in, session cookie out.
pub async fn create_session(
    State(state): State<Arc<DaemonState>>,
    Json(body): Json<CreateSessionBody>,
) -> Response {
    let Some(ctx) = &state.multi_user else {
        return not_multi_user();
    };
    let Some(oidc) = ctx.oidc.clone() else {
        log::debug!("session login attempted but OIDC is not configured");
        return unauthorized();
    };

    let claims = match oidc.verify(&body.id_token).await {
        Ok(claims) => claims,
        Err(reason) => {
            log::debug!("session login rejected: {reason}");
            return unauthorized();
        }
    };

    let resolved = {
        let mut reg = ctx.registry.lock().unwrap_or_else(|p| p.into_inner());
        reg.with_fresh(|r| super::oidc::resolve_user(r, &claims))
    };
    let user = match resolved {
        Ok(user) => user,
        Err(OidcAuthError::Forbidden(message)) => {
            // The one place a rejected login is diagnosable server-side:
            // which subject knocked, and why it was turned away.
            log::info!(
                "session login forbidden for sub {} (email {}): {message}",
                claims.sub,
                claims.email.as_deref().unwrap_or("-")
            );
            return (
                StatusCode::FORBIDDEN,
                Json(serde_json::json!({ "error": "forbidden", "message": message })),
            )
                .into_response();
        }
        Err(OidcAuthError::Registry(e)) => {
            log::error!("session login backend error: {e}");
            return server_error();
        }
    };

    let expires_at = chrono::Utc::now().timestamp() + SESSION_TTL_SECS;
    let cookie = set_cookie(
        &mint_cookie_value(&ctx.session_key, &user.user_id, expires_at),
        SESSION_TTL_SECS,
    );

    let Some(me) = fetch_me(ctx, &user.user_id) else {
        log::error!("session me lookup failed: user {} vanished", user.user_id);
        return server_error();
    };

    let mut response = Json(me_payload(&me)).into_response();
    if let Ok(value) = cookie.parse() {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

/// `DELETE /api/session` — clears the cookie (stateless server side).
pub async fn destroy_session() -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    if let Ok(value) = set_cookie("", 0).parse() {
        response.headers_mut().insert(header::SET_COOKIE, value);
    }
    response
}

/// `GET /api/me` — the authenticated user's registry row. Behind the auth
/// middleware; the extension is absent only in legacy (single-user) mode,
/// where the endpoint doesn't apply.
pub async fn get_me(
    State(state): State<Arc<DaemonState>>,
    user: Option<axum::Extension<super::auth::AuthedUser>>,
) -> Response {
    let Some(ctx) = &state.multi_user else {
        return not_multi_user();
    };
    let Some(axum::Extension(user)) = user else {
        // Multi-user mode always inserts the extension on authed routes;
        // reaching here means a middleware misconfiguration.
        log::error!("/api/me reached without AuthedUser in multi-user mode");
        return server_error();
    };
    match fetch_me(ctx, &user.user_id) {
        Some(me) => Json(me_payload(&me)).into_response(),
        None => unauthorized(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; 32] = [7u8; 32];

    #[test]
    fn cookie_round_trip_and_rejections() {
        let now = 1_700_000_000i64;
        let value = mint_cookie_value(&KEY, "user-1", now + 60);
        assert_eq!(verify_cookie_value(&KEY, &value, now).as_deref(), Some("user-1"));

        // Expired.
        let stale = mint_cookie_value(&KEY, "user-1", now - 1);
        assert_eq!(verify_cookie_value(&KEY, &stale, now), None);

        // Tampered signature.
        let mut tampered = value.clone();
        let flip = if tampered.ends_with('0') { '1' } else { '0' };
        tampered.pop();
        tampered.push(flip);
        assert_eq!(verify_cookie_value(&KEY, &tampered, now), None);

        // Tampered payload (swap user id, keep signature).
        let sig = value.rsplit('.').next().unwrap();
        let forged = format!("{}.{}.{}", B64URL.encode("user-2"), now + 60, sig);
        assert_eq!(verify_cookie_value(&KEY, &forged, now), None);

        // Wrong key.
        let other = [9u8; 32];
        assert_eq!(verify_cookie_value(&other, &value, now), None);

        // Garbage shapes.
        assert_eq!(verify_cookie_value(&KEY, "", now), None);
        assert_eq!(verify_cookie_value(&KEY, "a.b", now), None);
        assert_eq!(verify_cookie_value(&KEY, "a.b.c", now), None);
    }

    #[test]
    fn cookie_header_parsing() {
        let mut headers = HeaderMap::new();
        headers.insert(
            header::COOKIE,
            format!("other=1; {COOKIE_NAME}=abc.def.ghi; more=2")
                .parse()
                .unwrap(),
        );
        assert_eq!(
            cookie_from_headers(&headers).as_deref(),
            Some("abc.def.ghi")
        );

        let empty = HeaderMap::new();
        assert_eq!(cookie_from_headers(&empty), None);

        let mut wrong = HeaderMap::new();
        wrong.insert(header::COOKIE, "unrelated=x".parse().unwrap());
        assert_eq!(cookie_from_headers(&wrong), None);
    }

    #[test]
    fn session_key_created_0600_and_stable() {
        let dir = tempfile::tempdir().unwrap();
        let k1 = load_or_create_session_key(dir.path()).unwrap();
        let k2 = load_or_create_session_key(dir.path()).unwrap();
        assert_eq!(k1, k2, "second load must return the same key");

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(dir.path().join("session-key"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }

        // A corrupt key file is an error, not a silent regeneration
        // (regenerating would invalidate every live session).
        std::fs::write(dir.path().join("session-key"), "not-hex").unwrap();
        assert!(load_or_create_session_key(dir.path()).is_err());
    }
}
