//! Multi-user tenant registry for the Nous daemon.
//!
//! `{data_dir}/tenants.json` holds the user rows for multi-user mode (see
//! `docs/multi-user-daemon-plan.md`). Pure data — no HTTP or OIDC coupling
//! here; the auth middleware and OIDC provisioning layers consume this
//! module. Personal access token records are added to the same file by the
//! PAT work ("Personal access tokens with scopes"), which is why the file
//! carries a `version` field and tolerates unknown fields on load.
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

/// Registry file name within the daemon data directory.
pub const REGISTRY_FILE_NAME: &str = "tenants.json";

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

// ===== On-disk format =====

/// The serialized file. Additive fields (e.g. the PAT records) must use
/// `#[serde(default)]` so older files load; unknown fields are tolerated so
/// newer files still load in older builds.
#[derive(Debug, Serialize, Deserialize)]
struct RegistryFile {
    version: u32,
    #[serde(default)]
    users: Vec<User>,
}

// ===== Registry =====

/// In-memory registry bound to its file path. Mutations are in-memory
/// until [`TenantRegistry::save`]; callers own the read-modify-write cycle
/// (single-writer discipline: the daemon or one CLI invocation at a time).
#[derive(Debug)]
pub struct TenantRegistry {
    path: PathBuf,
    users: Vec<User>,
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

    fn set_mode_600(path: &Path) {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        let _ = path; // non-unix: nothing to do
    }
}
