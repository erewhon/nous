use std::path::Path;

use futures_util::StreamExt;
use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::AsyncWriteExt;

use crate::sync::config::SyncCredentials;

/// WebDAV client for sync operations
pub struct WebDAVClient {
    client: Client,
    base_url: String,
    credentials: SyncCredentials,
}

#[derive(Error, Debug)]
pub enum WebDAVError {
    #[error("HTTP error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Authentication failed")]
    AuthFailed,
    #[error("Resource not found: {0}")]
    NotFound(String),
    #[error("Conflict: resource was modified")]
    Conflict,
    #[error("Server error: {status} - {message}")]
    Server { status: u16, message: String },
    #[error("XML parse error: {0}")]
    XmlParse(String),
    #[error("Invalid URL: {0}")]
    InvalidUrl(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Response from a HEAD operation
#[derive(Debug)]
pub struct HeadResponse {
    pub etag: Option<String>,
    pub content_length: Option<u64>,
    pub exists: bool,
}

/// Response from a PUT operation
#[derive(Debug)]
pub struct PutResponse {
    pub success: bool,
    pub etag: Option<String>,
    pub conflict: bool,
}

/// File/directory info from PROPFIND
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceInfo {
    pub path: String,
    pub is_collection: bool,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub content_length: Option<u64>,
}

impl WebDAVClient {
    /// Create a new WebDAV client
    pub fn new(base_url: String, credentials: SyncCredentials) -> Result<Self, WebDAVError> {
        // Normalize URL - ensure no trailing slash
        let base_url = base_url.trim_end_matches('/').to_string();

        // Validate URL
        if !base_url.starts_with("http://") && !base_url.starts_with("https://") {
            return Err(WebDAVError::InvalidUrl("URL must start with http:// or https://".to_string()));
        }

        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .connect_timeout(std::time::Duration::from_secs(30))
            .build()?;

        Ok(Self {
            client,
            base_url,
            credentials,
        })
    }

    /// Build full URL for a path
    fn url(&self, path: &str) -> String {
        let path = path.trim_start_matches('/');
        if path.is_empty() {
            self.base_url.clone()
        } else {
            format!("{}/{}", self.base_url, path)
        }
    }

    /// Test connection to the WebDAV server
    pub async fn test_connection(&self) -> Result<bool, WebDAVError> {
        let response = self.propfind("", 0).await?;
        Ok(!response.is_empty())
    }

    /// PROPFIND - List directory or get resource properties
    pub async fn propfind(&self, path: &str, depth: u32) -> Result<Vec<ResourceInfo>, WebDAVError> {
        let url = self.url(path);

        let response = self.client
            .request(Method::from_bytes(b"PROPFIND").unwrap(), &url)
            .header("Depth", depth.to_string())
            .header("Content-Type", "application/xml")
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .body(PROPFIND_BODY)
            .send()
            .await?;

        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                return Err(WebDAVError::AuthFailed);
            }
            StatusCode::NOT_FOUND => {
                return Err(WebDAVError::NotFound(path.to_string()));
            }
            status if !status.is_success() && status != StatusCode::MULTI_STATUS => {
                return Err(WebDAVError::Server {
                    status: status.as_u16(),
                    message: response.text().await.unwrap_or_default(),
                });
            }
            _ => {}
        }

        let xml = response.text().await?;
        parse_propfind_response(&xml, &self.base_url)
    }

    /// GET - Download file contents
    pub async fn get(&self, path: &str) -> Result<Vec<u8>, WebDAVError> {
        let url = self.url(path);

        let response = self.client
            .get(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .send()
            .await?;

        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                return Err(WebDAVError::AuthFailed);
            }
            StatusCode::NOT_FOUND => {
                return Err(WebDAVError::NotFound(path.to_string()));
            }
            status if !status.is_success() => {
                return Err(WebDAVError::Server {
                    status: status.as_u16(),
                    message: response.text().await.unwrap_or_default(),
                });
            }
            _ => {}
        }

        Ok(response.bytes().await?.to_vec())
    }

    /// GET with ETag - Download file contents and return ETag
    pub async fn get_with_etag(&self, path: &str) -> Result<(Vec<u8>, Option<String>), WebDAVError> {
        let url = self.url(path);

        let response = self.client
            .get(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .send()
            .await?;

        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                return Err(WebDAVError::AuthFailed);
            }
            StatusCode::NOT_FOUND => {
                return Err(WebDAVError::NotFound(path.to_string()));
            }
            status if !status.is_success() => {
                return Err(WebDAVError::Server {
                    status: status.as_u16(),
                    message: response.text().await.unwrap_or_default(),
                });
            }
            _ => {}
        }

        let etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim_matches('"').to_string());

        let data = response.bytes().await?.to_vec();
        Ok((data, etag))
    }

    /// HEAD - Check resource existence and get metadata without downloading content
    pub async fn head(&self, path: &str) -> Result<HeadResponse, WebDAVError> {
        let url = self.url(path);

        let response = self.client
            .head(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .send()
            .await?;

        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                return Err(WebDAVError::AuthFailed);
            }
            StatusCode::NOT_FOUND => {
                return Ok(HeadResponse {
                    etag: None,
                    content_length: None,
                    exists: false,
                });
            }
            status if !status.is_success() => {
                return Err(WebDAVError::Server {
                    status: status.as_u16(),
                    message: String::new(),
                });
            }
            _ => {}
        }

        let etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim_matches('"').to_string());

        let content_length = response
            .headers()
            .get("content-length")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.parse().ok());

        Ok(HeadResponse {
            etag,
            content_length,
            exists: true,
        })
    }

    /// PUT - Upload file with optional ETag checking for conflict detection
    pub async fn put(&self, path: &str, data: &[u8], etag: Option<&str>) -> Result<PutResponse, WebDAVError> {
        let url = self.url(path);

        let mut request = self.client
            .put(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .body(data.to_vec());

        // Use If-Match for optimistic locking
        if let Some(etag) = etag {
            request = request.header("If-Match", format!("\"{}\"", etag));
        }

        let response = request.send().await?;

        match response.status() {
            StatusCode::CREATED | StatusCode::NO_CONTENT | StatusCode::OK => {
                let new_etag = response
                    .headers()
                    .get("etag")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.trim_matches('"').to_string());

                Ok(PutResponse {
                    success: true,
                    etag: new_etag,
                    conflict: false,
                })
            }
            StatusCode::PRECONDITION_FAILED => {
                Ok(PutResponse {
                    success: false,
                    etag: None,
                    conflict: true,
                })
            }
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                Err(WebDAVError::AuthFailed)
            }
            status => {
                Err(WebDAVError::Server {
                    status: status.as_u16(),
                    message: response.text().await.unwrap_or_default(),
                })
            }
        }
    }

    /// MKCOL - Create a directory
    pub async fn mkcol(&self, path: &str) -> Result<(), WebDAVError> {
        let url = self.url(path);

        let response = self.client
            .request(Method::from_bytes(b"MKCOL").unwrap(), &url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .send()
            .await?;

        match response.status() {
            StatusCode::CREATED | StatusCode::OK => Ok(()),
            StatusCode::METHOD_NOT_ALLOWED => {
                // Directory might already exist, that's OK
                Ok(())
            }
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                Err(WebDAVError::AuthFailed)
            }
            status => {
                Err(WebDAVError::Server {
                    status: status.as_u16(),
                    message: response.text().await.unwrap_or_default(),
                })
            }
        }
    }

    /// DELETE - Remove file or directory
    pub async fn delete(&self, path: &str) -> Result<(), WebDAVError> {
        let url = self.url(path);

        let response = self.client
            .delete(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .send()
            .await?;

        match response.status() {
            StatusCode::OK | StatusCode::NO_CONTENT | StatusCode::NOT_FOUND => Ok(()),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                Err(WebDAVError::AuthFailed)
            }
            status => {
                Err(WebDAVError::Server {
                    status: status.as_u16(),
                    message: response.text().await.unwrap_or_default(),
                })
            }
        }
    }

    /// Check if a resource exists
    pub async fn exists(&self, path: &str) -> Result<bool, WebDAVError> {
        match self.propfind(path, 0).await {
            Ok(_) => Ok(true),
            Err(WebDAVError::NotFound(_)) => Ok(false),
            Err(e) => Err(e),
        }
    }

    /// Create directory structure recursively
    pub async fn mkdir_p(&self, path: &str) -> Result<(), WebDAVError> {
        let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
        let mut current_path = String::new();

        for part in parts {
            if part.is_empty() {
                continue;
            }
            current_path = if current_path.is_empty() {
                part.to_string()
            } else {
                format!("{}/{}", current_path, part)
            };

            // Try to create, ignore if already exists
            let _ = self.mkcol(&current_path).await;
        }

        Ok(())
    }

    /// GET streaming - Download file to a local path, returning the ETag
    pub async fn get_to_file(
        &self,
        remote_path: &str,
        local_path: &Path,
    ) -> Result<Option<String>, WebDAVError> {
        let url = self.url(remote_path);

        let response = self
            .client
            .get(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .send()
            .await?;

        match response.status() {
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                return Err(WebDAVError::AuthFailed);
            }
            StatusCode::NOT_FOUND => {
                return Err(WebDAVError::NotFound(remote_path.to_string()));
            }
            status if !status.is_success() => {
                return Err(WebDAVError::Server {
                    status: status.as_u16(),
                    message: response.text().await.unwrap_or_default(),
                });
            }
            _ => {}
        }

        let etag = response
            .headers()
            .get("etag")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.trim_matches('"').to_string());

        // Create parent directories
        if let Some(parent) = local_path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        // Stream response body to file
        let mut file = tokio::fs::File::create(local_path).await?;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(WebDAVError::Http)?;
            file.write_all(&chunk).await?;
        }

        file.flush().await?;

        Ok(etag)
    }

    /// PUT streaming - Upload a local file to a remote path
    pub async fn put_file(
        &self,
        remote_path: &str,
        local_path: &Path,
        etag: Option<&str>,
    ) -> Result<PutResponse, WebDAVError> {
        let url = self.url(remote_path);

        let file = tokio::fs::File::open(local_path).await?;
        let metadata = file.metadata().await?;
        let file_size = metadata.len();

        let stream = tokio_util::io::ReaderStream::new(file);
        let body = reqwest::Body::wrap_stream(stream);

        let mut request = self
            .client
            .put(&url)
            .basic_auth(&self.credentials.username, Some(&self.credentials.password))
            .header("Content-Length", file_size)
            .body(body);

        if let Some(etag) = etag {
            request = request.header("If-Match", format!("\"{}\"", etag));
        }

        let response = request.send().await?;

        match response.status() {
            StatusCode::CREATED | StatusCode::NO_CONTENT | StatusCode::OK => {
                let new_etag = response
                    .headers()
                    .get("etag")
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.trim_matches('"').to_string());

                Ok(PutResponse {
                    success: true,
                    etag: new_etag,
                    conflict: false,
                })
            }
            StatusCode::PRECONDITION_FAILED => Ok(PutResponse {
                success: false,
                etag: None,
                conflict: true,
            }),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => Err(WebDAVError::AuthFailed),
            status => Err(WebDAVError::Server {
                status: status.as_u16(),
                message: response.text().await.unwrap_or_default(),
            }),
        }
    }

    /// List all files recursively under a path using iterative BFS
    pub async fn list_files_recursive(
        &self,
        path: &str,
    ) -> Result<Vec<ResourceInfo>, WebDAVError> {
        let mut files = Vec::new();
        let mut dirs_to_visit = vec![path.to_string()];
        let mut visited = std::collections::HashSet::new();

        while let Some(dir) = dirs_to_visit.pop() {
            // Normalize for cycle detection
            let dir_normalized = dir.trim_matches('/').to_string();
            if !visited.insert(dir_normalized.clone()) {
                continue;
            }

            let entries = match self.propfind(&dir, 1).await {
                Ok(entries) => entries,
                Err(WebDAVError::NotFound(_)) => continue,
                Err(e) => return Err(e),
            };

            log::debug!(
                "list_files_recursive: PROPFIND '{}' returned {} entries",
                dir, entries.len()
            );

            for entry in entries {
                // Skip the directory itself (normalize both sides for comparison)
                let entry_normalized = entry.path.trim_matches('/');
                if entry_normalized == dir_normalized {
                    continue;
                }

                if entry.is_collection {
                    dirs_to_visit.push(entry.path.clone());
                } else {
                    files.push(entry);
                }
            }
        }

        Ok(files)
    }
}

const PROPFIND_BODY: &str = r#"<?xml version="1.0" encoding="utf-8" ?>
<D:propfind xmlns:D="DAV:">
  <D:prop>
    <D:getlastmodified/>
    <D:getetag/>
    <D:getcontentlength/>
    <D:resourcetype/>
  </D:prop>
</D:propfind>"#;

/// Parse PROPFIND XML response
fn parse_propfind_response(xml: &str, base_url: &str) -> Result<Vec<ResourceInfo>, WebDAVError> {
    let mut resources = Vec::new();

    // Simple XML parsing - look for response elements
    // This is a basic implementation; could use quick-xml for more robust parsing
    log::debug!("parse_propfind: xml length={}, base_url={}", xml.len(), base_url);

    let mut current_path = String::new();
    let mut current_etag = None;
    let mut current_length = None;
    let mut current_modified = None;
    let mut is_collection = false;
    let mut in_response = false;

    for line in xml.lines() {
        let line = line.trim();

        if line.contains("<D:response>") || line.contains("<d:response>") {
            in_response = true;
            current_path.clear();
            current_etag = None;
            current_length = None;
            current_modified = None;
            is_collection = false;
        }

        if in_response {
            // Extract href
            if let Some(start) = line.find("<D:href>").or_else(|| line.find("<d:href>")) {
                let start = start + 8;
                if let Some(end) = line.find("</D:href>").or_else(|| line.find("</d:href>")) {
                    let href = &line[start..end];
                    // Remove base URL prefix if present
                    // Try full URL first (some servers return full URLs in href)
                    // Then try just the path component (most servers return absolute paths)
                    let path = if let Some(stripped) = href.strip_prefix(base_url) {
                        stripped
                    } else if let Some(scheme_end) = base_url.find("://") {
                        // Extract path component from base_url (e.g., "/remote.php/dav/files/user")
                        let after_scheme = &base_url[scheme_end + 3..];
                        let base_path = after_scheme.find('/').map(|i| &after_scheme[i..]).unwrap_or("");
                        let base_path = base_path.trim_end_matches('/');
                        href.strip_prefix(base_path).unwrap_or(href)
                    } else {
                        href
                    };
                    let path = path.trim_start_matches('/');
                    current_path = urlencoding::decode(path)
                        .unwrap_or_else(|_| path.into())
                        .to_string();
                }
            }

            // Extract ETag
            if let Some(start) = line.find("<D:getetag>").or_else(|| line.find("<d:getetag>")) {
                let start = start + 11;
                if let Some(end) = line.find("</D:getetag>").or_else(|| line.find("</d:getetag>")) {
                    current_etag = Some(line[start..end].trim_matches('"').to_string());
                }
            }

            // Extract content length
            if let Some(start) = line.find("<D:getcontentlength>").or_else(|| line.find("<d:getcontentlength>")) {
                let start = start + 20;
                if let Some(end) = line.find("</D:getcontentlength>").or_else(|| line.find("</d:getcontentlength>")) {
                    current_length = line[start..end].parse().ok();
                }
            }

            // Extract last modified
            if let Some(start) = line.find("<D:getlastmodified>").or_else(|| line.find("<d:getlastmodified>")) {
                let start = start + 19;
                if let Some(end) = line.find("</D:getlastmodified>").or_else(|| line.find("</d:getlastmodified>")) {
                    current_modified = Some(line[start..end].to_string());
                }
            }

            // Check if collection
            if line.contains("<D:collection") || line.contains("<d:collection") {
                is_collection = true;
            }
        }

        if line.contains("</D:response>") || line.contains("</d:response>") {
            if in_response && !current_path.is_empty() {
                resources.push(ResourceInfo {
                    path: current_path.clone(),
                    is_collection,
                    etag: current_etag.clone(),
                    last_modified: current_modified.clone(),
                    content_length: current_length,
                });
            }
            in_response = false;
        }
    }

    log::debug!(
        "parse_propfind: parsed {} resources from response",
        resources.len()
    );
    if resources.is_empty() && xml.len() > 100 {
        // Log first part of XML to help diagnose parsing failures
        let preview: String = xml.chars().take(500).collect();
        log::debug!("parse_propfind: XML preview (0 resources): {}", preview);
    }

    Ok(resources)
}
