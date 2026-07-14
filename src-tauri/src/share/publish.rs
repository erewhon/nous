//! Shared Publish-Static-to-Nous flow, used by both the desktop Tauri command
//! (`commands/share.rs`) and the daemon HTTP endpoint (`bin/cli/api.rs`) so the
//! render → sign → upload path stays identical regardless of entry point.

use std::path::Path;

use chrono::Duration;

use super::publish_token;
use super::storage::ShareRecord;
use super::upload;

/// Cloud API base for Publish-Static-to-Nous uploads.
pub const NOUS_API_BASE: &str = "https://api.nous.page";

/// Get-or-create the publish secret and sign a short-lived (~10-min) publish
/// token for `publisher_id`. Shared by the single-page and multi-page helpers so
/// the signing path stays identical. `publisher_id` must be stable per library
/// (the library id) so shares are co-owned across the desktop app and the daemon.
fn sign_token(data_dir: &Path, publisher_id: &str) -> Result<String, String> {
    let secret = publish_token::get_or_create_publish_secret(data_dir)?;
    Ok(publish_token::sign_publish_token(
        publisher_id,
        &secret,
        Duration::minutes(10),
    ))
}

/// Sign a short-lived publish token, upload the already-rendered single-page
/// HTML to Nous (Worker-fronted R2), and return the public `pub.nous.page/{id}/`
/// URL. `publisher_id` must be stable per library (the library id) so shares are
/// co-owned across the desktop app and the daemon.
pub async fn publish_rendered_page(
    html: &str,
    record: &ShareRecord,
    data_dir: &Path,
    publisher_id: &str,
) -> Result<String, String> {
    let tmp_dir = std::env::temp_dir().join(format!("nous-publish-{}", record.id));
    std::fs::create_dir_all(&tmp_dir)
        .map_err(|e| format!("Failed to create temp dir: {}", e))?;
    std::fs::write(tmp_dir.join("index.html"), html)
        .map_err(|e| format!("Failed to write render: {}", e))?;

    let result = publish_rendered_site(&tmp_dir, record, data_dir, publisher_id).await;

    let _ = std::fs::remove_dir_all(&tmp_dir);
    result
}

/// Sign a short-lived publish token, upload an already-rendered multi-page static
/// site directory to Nous (Worker-fronted R2), and return the public
/// `pub.nous.page/{id}/` URL. The multi-page twin of [`publish_rendered_page`]:
/// `site_dir` is a directory produced by `share::html_gen::generate_share_site`
/// (an `index.html` plus sub-pages/assets); every file under it is uploaded,
/// preserving relative paths. `publisher_id` must be stable per library.
pub async fn publish_rendered_site(
    site_dir: &Path,
    record: &ShareRecord,
    data_dir: &Path,
    publisher_id: &str,
) -> Result<String, String> {
    let token = sign_token(data_dir, publisher_id)?;

    let expires_at = record.expires_at.map(|d| d.to_rfc3339());
    upload::publish_share_site_to_nous(
        NOUS_API_BASE,
        &token,
        &record.id,
        site_dir,
        Some(&record.title),
        Some(&record.theme),
        expires_at.as_deref(),
    )
    .await
}
