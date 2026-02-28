//! S3-compatible upload for shared pages and multi-page sites.
//!
//! Supports AWS S3, Cloudflare R2, MinIO, and any S3-compatible endpoint.

use serde::{Deserialize, Serialize};
use std::path::Path;

use super::credentials::S3Credentials;
use super::s3_signer;

/// Configuration for uploading shares to S3-compatible storage.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareUploadConfig {
    /// S3-compatible endpoint URL (e.g. "https://s3.us-east-1.amazonaws.com")
    pub endpoint_url: String,
    /// Bucket name
    pub bucket: String,
    /// AWS region (use "auto" for Cloudflare R2)
    pub region: String,
    /// Key prefix for uploaded objects (e.g. "nous-shares/")
    pub path_prefix: String,
    /// Base URL for public access (e.g. "https://shares.example.com")
    pub public_url_base: String,
}

/// Upload a single-page share HTML to S3.
///
/// Uploads as `{prefix}{share_id}/index.html`.
/// Returns the public URL.
pub async fn upload_share_html(
    config: &ShareUploadConfig,
    creds: &S3Credentials,
    share_id: &str,
    html: &str,
) -> Result<String, String> {
    let key = format!("{}{}index.html", normalize_prefix(&config.path_prefix), share_id);
    let body = html.as_bytes();

    let (url, headers) = s3_signer::sign_put_object(
        &config.endpoint_url,
        &config.bucket,
        &key,
        &config.region,
        &creds.access_key_id,
        &creds.secret_access_key,
        body,
        "text/html; charset=utf-8",
    );

    let client = reqwest::Client::new();
    let mut request = client.put(&url).body(body.to_vec());
    for (name, value) in &headers {
        request = request.header(name.as_str(), value.as_str());
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Upload failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("S3 upload failed ({}): {}", status, body));
    }

    Ok(build_public_url(config, share_id))
}

/// Upload a multi-page share site directory to S3.
///
/// Walks the directory and uploads all files under `{prefix}{share_id}/`.
/// Returns the public URL for the site root.
pub async fn upload_share_site(
    config: &ShareUploadConfig,
    creds: &S3Credentials,
    share_id: &str,
    site_dir: &Path,
) -> Result<String, String> {
    let prefix = format!("{}{}/", normalize_prefix(&config.path_prefix), share_id);
    let client = reqwest::Client::new();

    for entry in walkdir::WalkDir::new(site_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let rel_path = entry
            .path()
            .strip_prefix(site_dir)
            .map_err(|e| format!("Path error: {}", e))?;
        let key = format!("{}{}", prefix, rel_path.to_string_lossy().replace('\\', "/"));

        let body = std::fs::read(entry.path())
            .map_err(|e| format!("Failed to read {}: {}", entry.path().display(), e))?;

        let content_type = mime_for_path(entry.path());

        let (url, headers) = s3_signer::sign_put_object(
            &config.endpoint_url,
            &config.bucket,
            &key,
            &config.region,
            &creds.access_key_id,
            &creds.secret_access_key,
            &body,
            content_type,
        );

        let mut request = client.put(&url).body(body);
        for (name, value) in &headers {
            request = request.header(name.as_str(), value.as_str());
        }

        let response = request
            .send()
            .await
            .map_err(|e| format!("Upload failed for {}: {}", key, e))?;

        if !response.status().is_success() {
            let status = response.status();
            let resp_body = response.text().await.unwrap_or_default();
            return Err(format!(
                "S3 upload failed for {} ({}): {}",
                key, status, resp_body
            ));
        }
    }

    Ok(build_public_url(config, share_id))
}

/// Delete all objects for a share from S3.
///
/// For single-page shares, deletes `{prefix}{share_id}/index.html`.
/// For multi-page shares, we attempt to delete common files but S3 doesn't
/// support directory listing without ListObjects, so we delete the known index
/// file and rely on bucket lifecycle rules for the rest.
pub async fn delete_share_remote(
    config: &ShareUploadConfig,
    creds: &S3Credentials,
    share_id: &str,
) -> Result<(), String> {
    let prefix = normalize_prefix(&config.path_prefix);
    let key = format!("{}{}index.html", prefix, share_id);

    let (url, headers) = s3_signer::sign_delete_object(
        &config.endpoint_url,
        &config.bucket,
        &key,
        &config.region,
        &creds.access_key_id,
        &creds.secret_access_key,
    );

    let client = reqwest::Client::new();
    let mut request = client.delete(&url);
    for (name, value) in &headers {
        request = request.header(name.as_str(), value.as_str());
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Delete failed: {}", e))?;

    // S3 returns 204 for successful deletes, 404 if already gone
    if !response.status().is_success() && response.status().as_u16() != 404 {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("S3 delete failed ({}): {}", status, body));
    }

    Ok(())
}

/// Upload a test object to verify S3 configuration.
pub async fn test_upload(
    config: &ShareUploadConfig,
    creds: &S3Credentials,
) -> Result<(), String> {
    let key = format!(
        "{}.nous-test-{}",
        normalize_prefix(&config.path_prefix),
        chrono::Utc::now().timestamp()
    );
    let body = b"nous-share-test";

    let (url, headers) = s3_signer::sign_put_object(
        &config.endpoint_url,
        &config.bucket,
        &key,
        &config.region,
        &creds.access_key_id,
        &creds.secret_access_key,
        body,
        "text/plain",
    );

    let client = reqwest::Client::new();
    let mut request = client.put(&url).body(body.to_vec());
    for (name, value) in &headers {
        request = request.header(name.as_str(), value.as_str());
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Test upload failed: {}", e))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Test upload failed ({}): {}", status, body));
    }

    // Clean up test object
    let (del_url, del_headers) = s3_signer::sign_delete_object(
        &config.endpoint_url,
        &config.bucket,
        &key,
        &config.region,
        &creds.access_key_id,
        &creds.secret_access_key,
    );

    let mut del_request = client.delete(&del_url);
    for (name, value) in &del_headers {
        del_request = del_request.header(name.as_str(), value.as_str());
    }
    // Best-effort cleanup
    let _ = del_request.send().await;

    Ok(())
}

fn normalize_prefix(prefix: &str) -> String {
    if prefix.is_empty() {
        return String::new();
    }
    let mut p = prefix.to_string();
    if !p.ends_with('/') {
        p.push('/');
    }
    p
}

fn build_public_url(config: &ShareUploadConfig, share_id: &str) -> String {
    let base = config.public_url_base.trim_end_matches('/');
    let prefix = normalize_prefix(&config.path_prefix);
    format!("{}/{}{}", base, prefix, share_id)
}

fn mime_for_path(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    match ext.as_str() {
        "html" | "htm" => "text/html; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        _ => "application/octet-stream",
    }
}
