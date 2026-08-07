//! Admin CLI for the multi-user tenant registry: users and personal
//! access tokens. V1's only admin surface (no web UI) — operates on
//! `{data_dir}/tenants.json` directly via [`TenantRegistry`].
//!
//! A running daemon picks changes up automatically: the auth layer
//! reloads the registry when the file's mtime moves, so invites,
//! disables, and revocations take effect without a restart.
//!
//! Command cores are separated from printing so they unit-test against a
//! temp registry; the `run_*` wrappers own I/O and process exit codes.

use std::path::Path;

use anyhow::{bail, Result};

use crate::auth::Scope;
use crate::tenants::{MintedToken, TenantRegistry, User, UserRole, UserStatus};
use crate::OutputFormat;

// ===== Command cores (testable) =====

/// Invite a new user. Registry invariants reject a duplicate email on a
/// live (non-disabled) row.
pub fn invite_core(
    reg: &mut TenantRegistry,
    email: &str,
    role: UserRole,
    username: Option<&str>,
) -> Result<User> {
    if email.trim().is_empty() || !email.contains('@') {
        bail!("'{email}' does not look like an email address");
    }
    let mut user = User::new_invited(email, role);
    user.username = username.map(str::to_string);
    let out = user.clone();
    reg.insert(user)?;
    Ok(out)
}

/// Resolve a user by id or (case-insensitive) email.
pub fn resolve_user<'r>(reg: &'r TenantRegistry, id_or_email: &str) -> Result<&'r User> {
    if let Some(u) = reg.find_by_id(id_or_email) {
        return Ok(u);
    }
    if let Some(u) = reg.find_by_email(id_or_email) {
        return Ok(u);
    }
    bail!("no user with id or email '{id_or_email}'");
}

/// Flip a user's status. `Disabled` kills their sessions/tokens on the
/// next request; `Active` (re-)enables regardless of prior status.
pub fn set_status_core(
    reg: &mut TenantRegistry,
    id_or_email: &str,
    status: UserStatus,
) -> Result<User> {
    let id = resolve_user(reg, id_or_email)?.id.clone();
    reg.update(&id, |u| u.status = status)?;
    Ok(reg.find_by_id(&id).expect("just updated").clone())
}

/// Mint a token for a user (id or email). Invited users may hold tokens;
/// authentication is what gates on active status.
pub fn mint_core(
    reg: &mut TenantRegistry,
    id_or_email: &str,
    name: &str,
    scope: Scope,
) -> Result<MintedToken> {
    if name.trim().is_empty() {
        bail!("token name must not be empty (e.g. --name \"mcp on delphi\")");
    }
    let id = resolve_user(reg, id_or_email)?.id.clone();
    reg.mint_token(&id, name, scope)
}

// ===== CLI wrappers =====

fn load(data_dir: &Path) -> Result<TenantRegistry> {
    TenantRegistry::load(&TenantRegistry::registry_path(data_dir))
}

fn print_user(u: &User) {
    println!(
        "{}  {}  {}  {}  {}",
        u.id,
        u.email,
        u.username.as_deref().unwrap_or("-"),
        u.role,
        u.status
    );
}

pub fn run_invite(
    data_dir: &Path,
    email: &str,
    role: &str,
    username: Option<&str>,
) -> Result<()> {
    let role = UserRole::parse(role)?;
    let mut reg = load(data_dir)?;
    let user = invite_core(&mut reg, email, role, username)?;
    reg.save()?;
    println!("Invited:");
    print_user(&user);
    eprintln!(
        "\nThey activate on first sign-in; a running daemon picks this up automatically."
    );
    Ok(())
}

pub fn run_list(data_dir: &Path, format: &OutputFormat) -> Result<()> {
    let reg = load(data_dir)?;
    match format {
        OutputFormat::Json => {
            println!("{}", serde_json::to_string_pretty(reg.users())?);
        }
        OutputFormat::Plain => {
            if reg.is_empty() {
                println!("No users. Invite one with: nous-cli daemon user invite <email>");
                return Ok(());
            }
            println!(
                "{:<36}  {:<30}  {:<12}  {:<6}  {}",
                "ID", "EMAIL", "USERNAME", "ROLE", "STATUS"
            );
            for u in reg.users() {
                println!(
                    "{:<36}  {:<30}  {:<12}  {:<6}  {}",
                    u.id,
                    u.email,
                    u.username.as_deref().unwrap_or("-"),
                    u.role,
                    u.status
                );
            }
        }
    }
    Ok(())
}

pub fn run_set_status(data_dir: &Path, id_or_email: &str, status: UserStatus) -> Result<()> {
    let mut reg = load(data_dir)?;
    let user = set_status_core(&mut reg, id_or_email, status)?;
    reg.save()?;
    println!("{} is now {}:", user.email, user.status);
    print_user(&user);
    Ok(())
}

pub fn run_token_mint(
    data_dir: &Path,
    id_or_email: &str,
    name: &str,
    scope: &str,
) -> Result<()> {
    let scope = match scope {
        "rw" => Scope::ReadWrite,
        "ro" => Scope::ReadOnly,
        other => bail!("invalid scope '{other}' (use rw or ro)"),
    };
    let mut reg = load(data_dir)?;
    let minted = mint_core(&mut reg, id_or_email, name, scope)?;
    reg.save()?;
    // Plaintext to stdout for scripting; everything else to stderr.
    println!("{}", minted.token);
    eprintln!(
        "\nToken '{}' ({}) minted for user {} — id {}.\n\
         This is the ONLY time the token is shown; store it now.\n\
         Revoke later with: nous-cli daemon token revoke {}",
        minted.name, minted.scope, minted.user_id, minted.token_id, minted.token_id
    );
    Ok(())
}

pub fn run_token_list(data_dir: &Path, format: &OutputFormat) -> Result<()> {
    let reg = load(data_dir)?;

    // Display view — the stored record's token_hash never reaches output.
    #[derive(serde::Serialize)]
    struct TokenRow<'a> {
        id: &'a str,
        user: String,
        name: &'a str,
        scope: Scope,
        created_at: chrono::DateTime<chrono::Utc>,
        last_used_at: Option<chrono::DateTime<chrono::Utc>>,
        revoked: bool,
    }
    let rows: Vec<TokenRow> = reg
        .tokens()
        .iter()
        .map(|t| TokenRow {
            id: &t.id,
            user: reg
                .find_by_id(&t.user_id)
                .map(|u| u.email.clone())
                .unwrap_or_else(|| t.user_id.clone()),
            name: &t.name,
            scope: t.scope,
            created_at: t.created_at,
            last_used_at: t.last_used_at,
            revoked: t.revoked_at.is_some(),
        })
        .collect();

    match format {
        OutputFormat::Json => println!("{}", serde_json::to_string_pretty(&rows)?),
        OutputFormat::Plain => {
            if rows.is_empty() {
                println!("No tokens. Mint one with: nous-cli daemon token mint <user> --name <label>");
                return Ok(());
            }
            println!(
                "{:<36}  {:<30}  {:<20}  {:<5}  {:<20}  {:<20}  {}",
                "ID", "USER", "NAME", "SCOPE", "CREATED", "LAST USED", "REVOKED"
            );
            for r in &rows {
                println!(
                    "{:<36}  {:<30}  {:<20}  {:<5}  {:<20}  {:<20}  {}",
                    r.id,
                    r.user,
                    r.name,
                    match r.scope {
                        Scope::ReadWrite => "rw",
                        Scope::ReadOnly => "ro",
                    },
                    r.created_at.format("%Y-%m-%d %H:%M"),
                    r.last_used_at
                        .map(|t| t.format("%Y-%m-%d %H:%M").to_string())
                        .unwrap_or_else(|| "-".into()),
                    if r.revoked { "yes" } else { "" },
                );
            }
        }
    }
    Ok(())
}

pub fn run_token_revoke(data_dir: &Path, token_id: &str) -> Result<()> {
    let mut reg = load(data_dir)?;
    if reg.revoke_token(token_id) {
        reg.save()?;
        println!("Token {token_id} revoked.");
    } else {
        // Idempotent from the operator's view, but say which case it was.
        let known = reg.tokens().iter().any(|t| t.id == token_id);
        if known {
            println!("Token {token_id} was already revoked.");
        } else {
            bail!("no token with id {token_id} (see: nous-cli daemon token list)");
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn reg(dir: &TempDir) -> TenantRegistry {
        TenantRegistry::load(&TenantRegistry::registry_path(dir.path())).unwrap()
    }

    #[test]
    fn invite_validates_and_rejects_live_duplicates() {
        let dir = TempDir::new().unwrap();
        let mut r = reg(&dir);

        let u = invite_core(&mut r, "Friend@Example.org", UserRole::Member, Some("friend")).unwrap();
        assert_eq!(u.email, "friend@example.org");
        assert_eq!(u.username.as_deref(), Some("friend"));
        assert_eq!(u.status, UserStatus::Invited);

        // Live duplicate rejected; junk rejected.
        assert!(invite_core(&mut r, "friend@example.org", UserRole::Member, None).is_err());
        assert!(invite_core(&mut r, "not-an-email", UserRole::Member, None).is_err());
        assert!(invite_core(&mut r, "  ", UserRole::Member, None).is_err());
    }

    #[test]
    fn set_status_resolves_by_id_and_email() {
        let dir = TempDir::new().unwrap();
        let mut r = reg(&dir);
        let u = invite_core(&mut r, "flip@example.org", UserRole::Member, None).unwrap();

        // Enable by email (case-insensitive), disable by id.
        let active = set_status_core(&mut r, "FLIP@example.org", UserStatus::Active).unwrap();
        assert_eq!(active.status, UserStatus::Active);
        let disabled = set_status_core(&mut r, &u.id, UserStatus::Disabled).unwrap();
        assert_eq!(disabled.status, UserStatus::Disabled);

        assert!(set_status_core(&mut r, "ghost@example.org", UserStatus::Active).is_err());
    }

    #[test]
    fn mint_core_resolves_user_and_validates_name() {
        let dir = TempDir::new().unwrap();
        let mut r = reg(&dir);
        invite_core(&mut r, "dev@example.org", UserRole::Member, None).unwrap();

        let minted = mint_core(&mut r, "dev@example.org", "laptop", Scope::ReadOnly).unwrap();
        assert_eq!(minted.scope, Scope::ReadOnly);
        assert!(minted.token.starts_with("nous_"));

        assert!(mint_core(&mut r, "dev@example.org", "  ", Scope::ReadWrite).is_err());
        assert!(mint_core(&mut r, "nobody@example.org", "x", Scope::ReadWrite).is_err());
    }
}
