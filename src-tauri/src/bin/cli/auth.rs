//! API key authentication for the Nous daemon.
//!
//! Keys are stored in `~/.local/share/nous/daemon-api-key`, one per line.
//! Format: `<scope>:<base64url-random>` where scope is `rw` or `ro`.
//! Lines starting with `#` are comments.

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use rand::Rng;

/// Key file name within the data directory.
const KEY_FILE_NAME: &str = "daemon-api-key";

/// Length of the random portion in bytes (256 bits).
const KEY_RANDOM_BYTES: usize = 32;

/// Permission scope for an API key or personal access token. Serialized
/// with the same short names the key-file prefixes use ("rw"/"ro") so the
/// tenant registry's token records read naturally.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Scope {
    #[serde(rename = "rw")]
    ReadWrite,
    #[serde(rename = "ro")]
    ReadOnly,
}

impl Scope {
    fn prefix(&self) -> &'static str {
        match self {
            Scope::ReadWrite => "rw",
            Scope::ReadOnly => "ro",
        }
    }

    fn from_prefix(s: &str) -> Option<Self> {
        match s {
            "rw" => Some(Scope::ReadWrite),
            "ro" => Some(Scope::ReadOnly),
            _ => None,
        }
    }

    /// Whether this scope allows the given HTTP method.
    pub fn allows_method(&self, method: &str) -> bool {
        match self {
            Scope::ReadWrite => true,
            Scope::ReadOnly => matches!(method, "GET" | "HEAD" | "OPTIONS"),
        }
    }
}

impl fmt::Display for Scope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.prefix())
    }
}

/// A single API key with its scope.
#[derive(Clone)]
struct ApiKey {
    /// Full key string including scope prefix (e.g., "rw:abc123...")
    full: String,
    scope: Scope,
}

/// Set of loaded API keys.
pub struct ApiKeySet {
    keys: Vec<ApiKey>,
}

impl ApiKeySet {
    /// Build an empty key set in memory. Primarily useful for tests; the
    /// production path is `load(path)` reading from disk.
    pub fn empty() -> Self {
        Self { keys: Vec::new() }
    }

    /// Insert a key with its scope. The full token includes the scope
    /// prefix (e.g. `rw:abc...`) — this is the format the validator
    /// expects and that `load` populates.
    pub fn insert(&mut self, full_token: String, scope: Scope) {
        self.keys.push(ApiKey {
            full: full_token,
            scope,
        });
    }

    /// Load keys from a file. Returns an empty set if the file doesn't exist.
    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self { keys: Vec::new() });
        }

        // Check file permissions on Unix
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let meta = fs::metadata(path)
                .with_context(|| format!("Failed to read key file: {}", path.display()))?;
            let mode = meta.permissions().mode() & 0o777;
            if mode & 0o077 != 0 {
                bail!(
                    "Key file {} has insecure permissions {:o} (must not be group/world accessible). \
                     Fix with: chmod 600 {}",
                    path.display(),
                    mode,
                    path.display()
                );
            }
        }

        let content = fs::read_to_string(path)
            .with_context(|| format!("Failed to read key file: {}", path.display()))?;

        let mut keys = Vec::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            if let Some((prefix, _random)) = line.split_once(':') {
                if let Some(scope) = Scope::from_prefix(prefix) {
                    keys.push(ApiKey {
                        full: line.to_string(),
                        scope,
                    });
                } else {
                    log::warn!("Ignoring key with unknown scope prefix: {}", prefix);
                }
            } else {
                log::warn!("Ignoring malformed key line (missing scope prefix)");
            }
        }

        Ok(Self { keys })
    }

    /// Whether there are any keys loaded.
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// Validate a token string. Returns the scope if valid, None if invalid.
    /// Uses constant-time comparison to prevent timing attacks.
    pub fn validate(&self, token: &str) -> Option<Scope> {
        use subtle::ConstantTimeEq;
        let token_bytes = token.as_bytes();
        for key in &self.keys {
            if key.full.as_bytes().ct_eq(token_bytes).into() {
                return Some(key.scope);
            }
        }
        None
    }

    /// Get the first read-write key (for display by `show-key`).
    pub fn first_rw_key(&self) -> Option<&str> {
        self.keys
            .iter()
            .find(|k| k.scope == Scope::ReadWrite)
            .map(|k| k.full.as_str())
    }
}

// ===== Multi-user request context =====

/// Authenticated per-request user context (multi-user mode). The auth
/// middleware inserts this as a request extension after validating the
/// credential; handlers declare `user: AuthedUser` and pass
/// `user.user_id` to tenant-scoped code explicitly — there is no
/// "current user" global. Scope rides along so handlers that need
/// finer-than-method gating can consult it (the middleware already
/// enforces the method-level rw/ro contract).
#[derive(Debug, Clone)]
pub struct AuthedUser {
    pub user_id: String,
    pub role: super::tenants::UserRole,
    pub scope: Scope,
}

impl<S> axum::extract::FromRequestParts<S> for AuthedUser
where
    S: Send + Sync,
{
    type Rejection = axum::response::Response;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        _state: &S,
    ) -> Result<Self, Self::Rejection> {
        use axum::response::IntoResponse;
        parts.extensions.get::<AuthedUser>().cloned().ok_or_else(|| {
            // A handler asked for AuthedUser on a route that isn't behind
            // the multi-user auth middleware — fail loudly rather than
            // invent a user context.
            log::error!(
                "AuthedUser extracted on a route outside the authenticated scope: {}",
                parts.uri.path()
            );
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                axum::Json(serde_json::json!({ "error": "internal error" })),
            )
                .into_response()
        })
    }
}

/// Generate a new API key with the given scope.
pub fn generate_key(scope: Scope) -> String {
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;

    let mut rng = rand::thread_rng();
    let mut bytes = [0u8; KEY_RANDOM_BYTES];
    rng.fill(&mut bytes);

    let random = URL_SAFE_NO_PAD.encode(bytes);
    format!("{}:{}", scope.prefix(), random)
}

/// Path to the key file within a data directory.
pub fn key_file_path(data_dir: &Path) -> PathBuf {
    data_dir.join(KEY_FILE_NAME)
}

/// Write a key to the key file, appending if the file exists.
/// Creates the file with mode 0600 if it doesn't exist.
pub fn write_key_to_file(path: &Path, key: &str, comment: Option<&str>) -> Result<()> {
    let mut content = String::new();

    // Read existing content if file exists
    if path.exists() {
        content = fs::read_to_string(path)
            .with_context(|| format!("Failed to read key file: {}", path.display()))?;
        if !content.ends_with('\n') {
            content.push('\n');
        }
    } else {
        // New file header
        content.push_str("# Nous daemon API keys\n");
        content.push_str("# Format: <scope>:<random> where scope is rw (read-write) or ro (read-only)\n");
    }

    if let Some(comment) = comment {
        content.push_str(&format!("# {}\n", comment));
    }
    content.push_str(key);
    content.push('\n');

    fs::write(path, &content)
        .with_context(|| format!("Failed to write key file: {}", path.display()))?;

    // Set permissions to 0600
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .with_context(|| format!("Failed to set permissions on: {}", path.display()))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn test_generate_key_format() {
        let rw = generate_key(Scope::ReadWrite);
        assert!(rw.starts_with("rw:"));
        assert!(rw.len() > 10);

        let ro = generate_key(Scope::ReadOnly);
        assert!(ro.starts_with("ro:"));
    }

    #[test]
    fn test_load_and_validate() {
        let mut f = NamedTempFile::new().unwrap();
        let key = generate_key(Scope::ReadWrite);
        writeln!(f, "# comment").unwrap();
        writeln!(f, "{}", key).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(f.path(), fs::Permissions::from_mode(0o600)).unwrap();
        }

        let set = ApiKeySet::load(f.path()).unwrap();
        assert!(!set.is_empty());
        assert_eq!(set.validate(&key), Some(Scope::ReadWrite));
        assert_eq!(set.validate("rw:bogus"), None);
        assert_eq!(set.validate(""), None);
    }

    #[test]
    fn test_load_empty_file() {
        let mut f = NamedTempFile::new().unwrap();
        writeln!(f, "# only comments").unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(f.path(), fs::Permissions::from_mode(0o600)).unwrap();
        }

        let set = ApiKeySet::load(f.path()).unwrap();
        assert!(set.is_empty());
    }

    #[test]
    fn test_load_missing_file() {
        let set = ApiKeySet::load(Path::new("/nonexistent/path")).unwrap();
        assert!(set.is_empty());
    }

    #[test]
    fn test_scope_allows_method() {
        assert!(Scope::ReadWrite.allows_method("GET"));
        assert!(Scope::ReadWrite.allows_method("POST"));
        assert!(Scope::ReadWrite.allows_method("PUT"));
        assert!(Scope::ReadWrite.allows_method("DELETE"));

        assert!(Scope::ReadOnly.allows_method("GET"));
        assert!(Scope::ReadOnly.allows_method("HEAD"));
        assert!(!Scope::ReadOnly.allows_method("POST"));
        assert!(!Scope::ReadOnly.allows_method("PUT"));
        assert!(!Scope::ReadOnly.allows_method("DELETE"));
    }

    #[tokio::test]
    async fn authed_user_outside_auth_scope_fails_loudly() {
        use tower::ServiceExt;
        // A handler that takes AuthedUser on a route without the auth
        // middleware must 500 (misconfiguration), never invent a context.
        let router: axum::Router = axum::Router::new().route(
            "/naked",
            axum::routing::get(|user: AuthedUser| async move { user.user_id }),
        );
        let resp = router
            .oneshot(
                axum::http::Request::builder()
                    .uri("/naked")
                    .body(axum::body::Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(resp.status(), axum::http::StatusCode::INTERNAL_SERVER_ERROR);
    }

    #[test]
    fn test_multiple_keys() {
        let mut f = NamedTempFile::new().unwrap();
        let rw = generate_key(Scope::ReadWrite);
        let ro = generate_key(Scope::ReadOnly);
        writeln!(f, "{}", rw).unwrap();
        writeln!(f, "{}", ro).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(f.path(), fs::Permissions::from_mode(0o600)).unwrap();
        }

        let set = ApiKeySet::load(f.path()).unwrap();
        assert_eq!(set.validate(&rw), Some(Scope::ReadWrite));
        assert_eq!(set.validate(&ro), Some(Scope::ReadOnly));
    }
}
