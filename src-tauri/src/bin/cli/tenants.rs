//! Multi-user tenant registry for the Nous daemon.
//!
//! `{data_dir}/tenants.json` holds the user rows for multi-user mode (see
//! `docs/multi-user-daemon-plan.md`). Pure data — no HTTP or OIDC coupling
//! here; the auth middleware and OIDC provisioning layers consume this
//! module. The file also holds personal access token records — bearer
//! credentials for non-browser clients (MCP, SDK, Emacs): plaintext is
//! `nous_` + 64 hex chars of a random 256-bit secret, only its SHA-256
//! hash is stored (a fast hash is correct for high-entropy secrets —
//! argon2 is for low-entropy passwords), and each token carries a
//! rw/ro [`Scope`] preserving today's key-file semantics.
//!
//! Same file-hygiene contract as the API key file (`auth.rs`): written
//! atomically (`nous_lib::storage::atomic`), kept 0600, and load refuses a
//! group/world-accessible file.
//!
//! Enumerated columns follow Astra's `db/tenancy.rs` shape: the allowed
//! values of `role` and `status` are enforced through [`UserRole`] /
//! [`UserStatus`] with strict parsing — an unknown value is an error,
//! never a default.

use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::auth::Scope;

/// Registry file name within the daemon data directory.
pub const REGISTRY_FILE_NAME: &str = "tenants.json";

/// Prefix distinguishing personal access tokens from other bearer values
/// (the auth middleware routes on it: `nous_` → PAT, otherwise OIDC JWT).
pub const TOKEN_PREFIX: &str = "nous_";

/// Current on-disk format version. Bump only on breaking layout changes;
/// additive fields use `#[serde(default)]` instead.
const REGISTRY_VERSION: u32 = 1;

// ===== Enumerated columns =====

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserRole {
    Owner,
    Member,
}

impl UserRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Member => "member",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "owner" => Ok(Self::Owner),
            "member" => Ok(Self::Member),
            other => bail!("unknown user role '{other}'"),
        }
    }
}

impl fmt::Display for UserRole {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UserStatus {
    /// Row created by an owner invite; not yet signed in.
    Invited,
    /// May authenticate.
    Active,
    /// Refused at every authentication path; kills live sessions because
    /// status is re-checked per request.
    Disabled,
}

impl UserStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Invited => "invited",
            Self::Active => "active",
            Self::Disabled => "disabled",
        }
    }

    pub fn parse(s: &str) -> Result<Self> {
        match s {
            "invited" => Ok(Self::Invited),
            "active" => Ok(Self::Active),
            "disabled" => Ok(Self::Disabled),
            other => bail!("unknown user status '{other}'"),
        }
    }
}

impl fmt::Display for UserStatus {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

// ===== User rows =====

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    /// Stable id (uuid v4); tenant data lives under `tenants/{id}/`.
    pub id: String,
    /// Invite key. Stored lowercased; lookups are case-insensitive.
    pub email: String,
    /// URL-safe handle; optional until the user (or activation) claims one.
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    pub role: UserRole,
    pub status: UserStatus,
    /// OIDC subject (Zitadel `sub`) once linked; unique across the registry.
    #[serde(default)]
    pub external_subject: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl User {
    /// A fresh invited row — the only way users enter the registry in v1
    /// (CLI invite). Email is normalized to lowercase here so every later
    /// comparison is exact.
    pub fn new_invited(email: &str, role: UserRole) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            email: email.trim().to_lowercase(),
            username: None,
            display_name: None,
            role,
            status: UserStatus::Invited,
            external_subject: None,
            created_at: Utc::now(),
        }
    }
}

// ===== Personal access tokens =====

/// A stored token record. Only the SHA-256 hash of the plaintext lives
/// here — the plaintext exists exactly once, in the [`MintedToken`]
/// returned by [`TenantRegistry::mint_token`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessToken {
    /// Token id (uuid v4) — the handle for revocation and listing.
    pub id: String,
    pub user_id: String,
    /// Human label ("mcp on delphi"), display-only.
    pub name: String,
    pub scope: Scope,
    /// Hex SHA-256 of the plaintext token.
    pub token_hash: String,
    pub created_at: DateTime<Utc>,
    #[serde(default)]
    pub revoked_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub last_used_at: Option<DateTime<Utc>>,
}

/// A freshly minted token. `token` is the only copy of the plaintext —
/// show it once, never log it.
#[derive(Debug)]
pub struct MintedToken {
    pub token: String,
    pub token_id: String,
    pub user_id: String,
    pub name: String,
    pub scope: Scope,
}

/// Successful token authentication: who, and with what rights.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TokenAuth {
    pub user_id: String,
    pub role: UserRole,
    pub scope: Scope,
}

/// Why a token was rejected. Kept coarse on purpose: the HTTP layer maps
/// both to 401 without leaking which failed (the distinction matters only
/// for logs).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenAuthError {
    /// Unknown, malformed, or revoked token.
    InvalidToken,
    /// Token is valid but the user is not active (invited/disabled).
    InactiveUser,
}

fn hash_token(token: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(token.as_bytes()))
}

// ===== On-disk format =====

/// The serialized file. Additive fields must use `#[serde(default)]` so
/// older files load; unknown fields are tolerated so newer files still
/// load in older builds.
#[derive(Debug, Serialize, Deserialize)]
struct RegistryFile {
    version: u32,
    #[serde(default)]
    users: Vec<User>,
    #[serde(default)]
    tokens: Vec<AccessToken>,
}

// ===== Registry =====

/// In-memory registry bound to its file path. Mutations are in-memory
/// until [`TenantRegistry::save`]; callers own the read-modify-write cycle
/// (single-writer discipline: the daemon or one CLI invocation at a time).
#[derive(Debug)]
pub struct TenantRegistry {
    path: PathBuf,
    users: Vec<User>,
    tokens: Vec<AccessToken>,
}

impl TenantRegistry {
    /// Path of the registry file within a daemon data directory.
    pub fn registry_path(data_dir: &Path) -> PathBuf {
        data_dir.join(REGISTRY_FILE_NAME)
    }

    /// Load the registry. A missing file is an empty registry (multi-user
    /// mode simply has no users yet); an unreadable or malformed file is an
    /// error — never silently treated as empty, that would resurrect
    /// deleted access rules.
    pub fn load(path: &Path) -> Result<Self> {
        if !path.exists() {
            return Ok(Self {
                path: path.to_path_buf(),
                users: Vec::new(),
                tokens: Vec::new(),
            });
        }

        // Refuse group/world-accessible registries, same as the API key file.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let meta = fs::metadata(path)
                .with_context(|| format!("Failed to stat registry: {}", path.display()))?;
            let mode = meta.permissions().mode() & 0o777;
            if mode & 0o077 != 0 {
                bail!(
                    "Registry {} has insecure permissions {:o} (must not be group/world accessible). \
                     Fix with: chmod 600 {}",
                    path.display(),
                    mode,
                    path.display()
                );
            }
        }

        let content = fs::read_to_string(path)
            .with_context(|| format!("Failed to read registry: {}", path.display()))?;
        let file: RegistryFile = serde_json::from_str(&content)
            .with_context(|| format!("Malformed registry file: {}", path.display()))?;
        if file.version > REGISTRY_VERSION {
            bail!(
                "Registry {} has version {} but this build understands up to {} — \
                 refusing to load (a newer daemon wrote it)",
                path.display(),
                file.version,
                REGISTRY_VERSION
            );
        }

        Ok(Self {
            path: path.to_path_buf(),
            users: file.users,
            tokens: file.tokens,
        })
    }

    /// Persist atomically (temp + fsync + rename via `storage::atomic`),
    /// then clamp to 0600. The rename installs the file with default perms
    /// for one syscall's width inside the user-owned data dir; the load-side
    /// permission check is what enforces the contract long-term.
    pub fn save(&self) -> Result<()> {
        let file = RegistryFile {
            version: REGISTRY_VERSION,
            users: self.users.clone(),
            tokens: self.tokens.clone(),
        };
        let mut content = serde_json::to_string_pretty(&file)?;
        content.push('\n');
        nous_lib::storage::atomic::write_str(&self.path, &content)
            .with_context(|| format!("Failed to write registry: {}", self.path.display()))?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&self.path, fs::Permissions::from_mode(0o600))
                .with_context(|| format!("Failed to chmod registry: {}", self.path.display()))?;
        }

        Ok(())
    }

    pub fn is_empty(&self) -> bool {
        self.users.is_empty()
    }

    pub fn users(&self) -> &[User] {
        &self.users
    }

    pub fn find_by_id(&self, id: &str) -> Option<&User> {
        self.users.iter().find(|u| u.id == id)
    }

    pub fn find_by_subject(&self, subject: &str) -> Option<&User> {
        self.users
            .iter()
            .find(|u| u.external_subject.as_deref() == Some(subject))
    }

    /// Case-insensitive email lookup (rows store lowercase; the query is
    /// lowercased here so IdP-cased claims still match).
    pub fn find_by_email(&self, email: &str) -> Option<&User> {
        let needle = email.trim().to_lowercase();
        self.users.iter().find(|u| u.email == needle)
    }

    /// Insert a user, enforcing the registry invariants:
    /// - unique `id`
    /// - unique `external_subject` (when present)
    /// - unique email among non-disabled rows (a disabled row's email may
    ///   be re-invited as a fresh user; two live rows must never share one,
    ///   or invite-linking would be ambiguous)
    pub fn insert(&mut self, user: User) -> Result<()> {
        if self.find_by_id(&user.id).is_some() {
            bail!("user id already exists: {}", user.id);
        }
        if let Some(sub) = user.external_subject.as_deref() {
            if self.find_by_subject(sub).is_some() {
                bail!("external subject already linked: {sub}");
            }
        }
        if let Some(existing) = self.find_by_email(&user.email) {
            if existing.status != UserStatus::Disabled {
                bail!(
                    "email already registered to a {} user: {}",
                    existing.status,
                    user.email
                );
            }
        }
        self.users.push(user);
        Ok(())
    }

    /// Mutate a user by id. The closure edits in place; invariant-relevant
    /// fields (subject uniqueness) are re-checked afterwards.
    pub fn update<F: FnOnce(&mut User)>(&mut self, id: &str, f: F) -> Result<()> {
        let idx = self
            .users
            .iter()
            .position(|u| u.id == id)
            .with_context(|| format!("user not found: {id}"))?;
        f(&mut self.users[idx]);
        // Normalize + re-check what the closure may have touched.
        self.users[idx].email = self.users[idx].email.trim().to_lowercase();
        if let Some(sub) = self.users[idx].external_subject.clone() {
            let dup = self
                .users
                .iter()
                .any(|u| u.id != id && u.external_subject.as_deref() == Some(sub.as_str()));
            if dup {
                bail!("external subject already linked to another user: {sub}");
            }
        }
        Ok(())
    }

    // ===== Personal access tokens =====

    /// Mint a new token for an existing user. The user may be in any
    /// status — an invited user can hold a token before activation;
    /// [`TenantRegistry::authenticate_token`] is what gates on `active`.
    /// Caller must [`TenantRegistry::save`] to persist.
    pub fn mint_token(&mut self, user_id: &str, name: &str, scope: Scope) -> Result<MintedToken> {
        if self.find_by_id(user_id).is_none() {
            bail!("user not found: {user_id}");
        }

        let mut secret = [0u8; 32];
        rand::Rng::fill(&mut rand::thread_rng(), &mut secret);
        let token = format!("{TOKEN_PREFIX}{}", hex::encode(secret));
        let token_id = uuid::Uuid::new_v4().to_string();

        self.tokens.push(AccessToken {
            id: token_id.clone(),
            user_id: user_id.to_string(),
            name: name.to_string(),
            scope,
            token_hash: hash_token(&token),
            created_at: Utc::now(),
            revoked_at: None,
            last_used_at: None,
        });

        Ok(MintedToken {
            token,
            token_id,
            user_id: user_id.to_string(),
            name: name.to_string(),
            scope,
        })
    }

    /// Revoke a token by id. Idempotent: returns `true` only when the
    /// token was live and is now revoked; unknown or already-revoked ids
    /// return `false`. Caller must [`TenantRegistry::save`] to persist.
    pub fn revoke_token(&mut self, token_id: &str) -> bool {
        match self
            .tokens
            .iter_mut()
            .find(|t| t.id == token_id && t.revoked_at.is_none())
        {
            Some(t) => {
                t.revoked_at = Some(Utc::now());
                true
            }
            None => false,
        }
    }

    /// Token records (hashes included — display layers must not print
    /// `token_hash`; it is not secret-equivalent but has no business in
    /// terminal output).
    pub fn tokens(&self) -> &[AccessToken] {
        &self.tokens
    }

    /// Resolve a plaintext bearer token to its active user.
    ///
    /// Rejects unknown/revoked tokens and tokens of non-active users
    /// (status is checked here, at use — not at mint). Stamps
    /// `last_used_at` in memory; persistence of the stamp is the caller's
    /// choice (best-effort — the daemon saves opportunistically, and losing
    /// a stamp on crash is harmless).
    ///
    /// Hash comparison is a plain `==` on SHA-256 hex: with a 256-bit
    /// random preimage, hash-timing leaks nothing an attacker can use
    /// (unlike the raw key comparison in `auth.rs`, which is over the
    /// secret itself and therefore constant-time).
    pub fn authenticate_token(&mut self, token: &str) -> Result<TokenAuth, TokenAuthError> {
        let hash = hash_token(token);
        let record = self
            .tokens
            .iter_mut()
            .find(|t| t.revoked_at.is_none() && t.token_hash == hash)
            .ok_or(TokenAuthError::InvalidToken)?;

        let user_id = record.user_id.clone();
        record.last_used_at = Some(Utc::now());
        let scope = record.scope;

        let user = self
            .find_by_id(&user_id)
            // A token whose user row vanished is invalid, not a panic.
            .ok_or(TokenAuthError::InvalidToken)?;
        if user.status != UserStatus::Active {
            return Err(TokenAuthError::InactiveUser);
        }

        Ok(TokenAuth {
            user_id: user.id.clone(),
            role: user.role,
            scope,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn registry_in(dir: &TempDir) -> TenantRegistry {
        TenantRegistry::load(&TenantRegistry::registry_path(dir.path())).unwrap()
    }

    #[test]
    fn missing_file_loads_empty() {
        let dir = TempDir::new().unwrap();
        let reg = registry_in(&dir);
        assert!(reg.is_empty());
    }

    #[test]
    fn save_load_round_trip_preserves_all_fields() {
        let dir = TempDir::new().unwrap();
        let mut reg = registry_in(&dir);

        let mut alice = User::new_invited("Alice@Example.org", UserRole::Owner);
        alice.username = Some("alice".into());
        alice.display_name = Some("Alice".into());
        alice.status = UserStatus::Active;
        alice.external_subject = Some("zitadel|1".into());
        let alice_id = alice.id.clone();
        reg.insert(alice).unwrap();
        reg.insert(User::new_invited("bob@example.org", UserRole::Member))
            .unwrap();
        reg.save().unwrap();

        let reloaded = registry_in(&dir);
        assert_eq!(reloaded.users().len(), 2);
        let a = reloaded.find_by_id(&alice_id).unwrap();
        assert_eq!(a.email, "alice@example.org"); // lowercased at creation
        assert_eq!(a.username.as_deref(), Some("alice"));
        assert_eq!(a.display_name.as_deref(), Some("Alice"));
        assert_eq!(a.role, UserRole::Owner);
        assert_eq!(a.status, UserStatus::Active);
        assert_eq!(a.external_subject.as_deref(), Some("zitadel|1"));
    }

    #[test]
    fn lookups_by_id_subject_and_email() {
        let dir = TempDir::new().unwrap();
        let mut reg = registry_in(&dir);
        let mut u = User::new_invited("who@example.org", UserRole::Member);
        u.external_subject = Some("zitadel|42".into());
        let id = u.id.clone();
        reg.insert(u).unwrap();

        assert_eq!(reg.find_by_id(&id).unwrap().id, id);
        assert_eq!(reg.find_by_subject("zitadel|42").unwrap().id, id);
        // Case-insensitive email match.
        assert_eq!(reg.find_by_email("WHO@Example.ORG").unwrap().id, id);
        assert!(reg.find_by_id("nope").is_none());
        assert!(reg.find_by_subject("zitadel|43").is_none());
        assert!(reg.find_by_email("other@example.org").is_none());
    }

    #[test]
    fn insert_rejects_duplicate_id_subject_and_live_email() {
        let dir = TempDir::new().unwrap();
        let mut reg = registry_in(&dir);
        let mut u = User::new_invited("dup@example.org", UserRole::Member);
        u.external_subject = Some("zitadel|dup".into());
        let dup_id = u.id.clone();
        reg.insert(u).unwrap();

        // Duplicate id.
        let mut same_id = User::new_invited("x@example.org", UserRole::Member);
        same_id.id = dup_id;
        assert!(reg.insert(same_id).is_err());

        // Duplicate subject.
        let mut same_sub = User::new_invited("y@example.org", UserRole::Member);
        same_sub.external_subject = Some("zitadel|dup".into());
        assert!(reg.insert(same_sub).is_err());

        // Duplicate email on a live (non-disabled) row — case-insensitive.
        assert!(reg
            .insert(User::new_invited("DUP@example.org", UserRole::Member))
            .is_err());
    }

    #[test]
    fn disabled_email_may_be_reinvited() {
        let dir = TempDir::new().unwrap();
        let mut reg = registry_in(&dir);
        let u = User::new_invited("back@example.org", UserRole::Member);
        let id = u.id.clone();
        reg.insert(u).unwrap();
        reg.update(&id, |u| u.status = UserStatus::Disabled).unwrap();

        reg.insert(User::new_invited("back@example.org", UserRole::Member))
            .unwrap();
        assert_eq!(reg.users().len(), 2);
    }

    #[test]
    fn update_mutates_persists_and_guards_subject_uniqueness() {
        let dir = TempDir::new().unwrap();
        let mut reg = registry_in(&dir);
        let a = User::new_invited("a@example.org", UserRole::Member);
        let b = User::new_invited("b@example.org", UserRole::Member);
        let (a_id, b_id) = (a.id.clone(), b.id.clone());
        reg.insert(a).unwrap();
        reg.insert(b).unwrap();

        reg.update(&a_id, |u| {
            u.status = UserStatus::Active;
            u.external_subject = Some("zitadel|a".into());
        })
        .unwrap();
        reg.save().unwrap();

        let reloaded = registry_in(&dir);
        let a = reloaded.find_by_id(&a_id).unwrap();
        assert_eq!(a.status, UserStatus::Active);
        assert_eq!(a.external_subject.as_deref(), Some("zitadel|a"));

        // Linking B to A's subject must fail.
        let mut reg = reloaded;
        assert!(reg
            .update(&b_id, |u| u.external_subject = Some("zitadel|a".into()))
            .is_err());
        // Unknown id errors.
        assert!(reg.update("nope", |_| {}).is_err());
    }

    #[test]
    fn enum_parsing_is_strict() {
        assert!(UserRole::parse("owner").is_ok());
        assert!(UserRole::parse("boss").is_err());
        assert!(UserStatus::parse("invited").is_ok());
        assert!(UserStatus::parse("banned").is_err());

        // Serde path is equally strict: an unknown status fails the load.
        let dir = TempDir::new().unwrap();
        let path = TenantRegistry::registry_path(dir.path());
        let bad = r#"{"version":1,"users":[{"id":"u1","email":"x@example.org",
            "role":"member","status":"banned","created_at":"2026-01-01T00:00:00Z"}]}"#;
        std::fs::write(&path, bad).unwrap();
        set_mode_600(&path);
        assert!(TenantRegistry::load(&path).is_err());
    }

    #[test]
    fn newer_version_is_refused() {
        let dir = TempDir::new().unwrap();
        let path = TenantRegistry::registry_path(dir.path());
        std::fs::write(&path, r#"{"version":99,"users":[]}"#).unwrap();
        set_mode_600(&path);
        let err = TenantRegistry::load(&path).unwrap_err().to_string();
        assert!(err.contains("version 99"), "unexpected error: {err}");
    }

    #[test]
    fn malformed_file_is_an_error_not_empty() {
        let dir = TempDir::new().unwrap();
        let path = TenantRegistry::registry_path(dir.path());
        std::fs::write(&path, "not json").unwrap();
        set_mode_600(&path);
        assert!(TenantRegistry::load(&path).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn saved_file_is_0600_and_loose_perms_are_rejected() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TempDir::new().unwrap();
        let mut reg = registry_in(&dir);
        reg.insert(User::new_invited("p@example.org", UserRole::Member))
            .unwrap();
        reg.save().unwrap();

        let path = TenantRegistry::registry_path(dir.path());
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);

        // Loosen and expect rejection with the chmod hint.
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        let err = TenantRegistry::load(&path).unwrap_err().to_string();
        assert!(err.contains("chmod 600"), "unexpected error: {err}");
    }

    // ===== Personal access tokens =====

    /// Insert an active user and return its id.
    fn insert_active(reg: &mut TenantRegistry, email: &str) -> String {
        let u = User::new_invited(email, UserRole::Member);
        let id = u.id.clone();
        reg.insert(u).unwrap();
        reg.update(&id, |u| u.status = UserStatus::Active).unwrap();
        id
    }

    #[test]
    fn mint_and_authenticate_round_trip() {
        let dir = TempDir::new().unwrap();
        let mut reg = registry_in(&dir);
        let alice = insert_active(&mut reg, "alice@example.org");

        let minted = reg.mint_token(&alice, "cli", Scope::ReadWrite).unwrap();
        assert!(minted.token.starts_with(TOKEN_PREFIX));
        assert_eq!(minted.token.len(), TOKEN_PREFIX.len() + 64);

        // Only the hash is stored, and it matches the plaintext's digest.
        let stored = &reg.tokens()[0];
        assert_ne!(stored.token_hash, minted.token);
        assert_eq!(stored.token_hash, hash_token(&minted.token));
        assert!(stored.last_used_at.is_none());

        let auth = reg.authenticate_token(&minted.token).unwrap();
        assert_eq!(auth.user_id, alice);
        assert_eq!(auth.role, UserRole::Member);
        assert_eq!(auth.scope, Scope::ReadWrite);

        // last_used_at stamped on successful auth.
        assert!(reg.tokens()[0].last_used_at.is_some());

        // Minting for an unknown user is an error.
        assert!(reg.mint_token("nobody", "x", Scope::ReadOnly).is_err());
    }

    #[test]
    fn authenticate_rejects_garbage_revoked_and_inactive() {
        let dir = TempDir::new().unwrap();
        let mut reg = registry_in(&dir);
        let alice = insert_active(&mut reg, "alice@example.org");

        // Garbage.
        assert_eq!(
            reg.authenticate_token("nous_definitely_not_a_token"),
            Err(TokenAuthError::InvalidToken)
        );

        // Revoked: first revocation true, second false, then auth fails.
        let minted = reg.mint_token(&alice, "cli", Scope::ReadWrite).unwrap();
        assert!(reg.revoke_token(&minted.token_id));
        assert!(!reg.revoke_token(&minted.token_id));
        assert!(!reg.revoke_token("nope"));
        assert_eq!(
            reg.authenticate_token(&minted.token),
            Err(TokenAuthError::InvalidToken)
        );

        // Invited (not yet active) user: token mints but doesn't authenticate.
        let invited = User::new_invited("new@example.org", UserRole::Member);
        let invited_id = invited.id.clone();
        reg.insert(invited).unwrap();
        let tok = reg.mint_token(&invited_id, "onboarding", Scope::ReadWrite).unwrap();
        assert_eq!(
            reg.authenticate_token(&tok.token),
            Err(TokenAuthError::InactiveUser)
        );

        // Disabling a user kills their live token immediately.
        let disabled_tok = reg.mint_token(&alice, "later", Scope::ReadWrite).unwrap();
        reg.update(&alice, |u| u.status = UserStatus::Disabled).unwrap();
        assert_eq!(
            reg.authenticate_token(&disabled_tok.token),
            Err(TokenAuthError::InactiveUser)
        );
    }

    #[test]
    fn scope_is_carried_and_enforces_methods() {
        let dir = TempDir::new().unwrap();
        let mut reg = registry_in(&dir);
        let alice = insert_active(&mut reg, "alice@example.org");

        let ro = reg.mint_token(&alice, "reader", Scope::ReadOnly).unwrap();
        let auth = reg.authenticate_token(&ro.token).unwrap();
        assert_eq!(auth.scope, Scope::ReadOnly);
        // Same enforcement contract as the legacy key file.
        assert!(auth.scope.allows_method("GET"));
        assert!(auth.scope.allows_method("HEAD"));
        assert!(auth.scope.allows_method("OPTIONS"));
        assert!(!auth.scope.allows_method("POST"));
        assert!(!auth.scope.allows_method("PUT"));
        assert!(!auth.scope.allows_method("DELETE"));

        let rw = reg.mint_token(&alice, "writer", Scope::ReadWrite).unwrap();
        let auth = reg.authenticate_token(&rw.token).unwrap();
        assert!(auth.scope.allows_method("POST"));
        assert!(auth.scope.allows_method("DELETE"));
    }

    #[test]
    fn tokens_map_to_distinct_users_and_persist() {
        let dir = TempDir::new().unwrap();
        let mut reg = registry_in(&dir);
        let alice = insert_active(&mut reg, "alice@example.org");
        let bob = insert_active(&mut reg, "bob@example.org");

        let a_tok = reg.mint_token(&alice, "a", Scope::ReadWrite).unwrap();
        let b_tok = reg.mint_token(&bob, "b", Scope::ReadOnly).unwrap();
        let revoked = reg.mint_token(&bob, "old", Scope::ReadWrite).unwrap();
        assert!(reg.revoke_token(&revoked.token_id));
        reg.save().unwrap();

        // Everything — scope, revocation, ownership — survives reload.
        let mut reloaded = registry_in(&dir);
        assert_eq!(reloaded.tokens().len(), 3);
        assert_eq!(reloaded.authenticate_token(&a_tok.token).unwrap().user_id, alice);
        let b_auth = reloaded.authenticate_token(&b_tok.token).unwrap();
        assert_eq!(b_auth.user_id, bob);
        assert_eq!(b_auth.scope, Scope::ReadOnly);
        assert_eq!(
            reloaded.authenticate_token(&revoked.token),
            Err(TokenAuthError::InvalidToken)
        );
    }

    #[test]
    fn tokenless_v1_file_still_loads() {
        // A registry written before token records existed (no "tokens"
        // field) must load cleanly — serde(default) contract.
        let dir = TempDir::new().unwrap();
        let path = TenantRegistry::registry_path(dir.path());
        std::fs::write(
            &path,
            r#"{"version":1,"users":[{"id":"u1","email":"x@example.org",
                "role":"member","status":"active","created_at":"2026-01-01T00:00:00Z"}]}"#,
        )
        .unwrap();
        set_mode_600(&path);
        let reg = TenantRegistry::load(&path).unwrap();
        assert_eq!(reg.users().len(), 1);
        assert!(reg.tokens().is_empty());
    }

    fn set_mode_600(path: &Path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        let _ = path; // non-unix: nothing to do
    }
}
