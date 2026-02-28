use serde::{Deserialize, Serialize};

/// Configuration for uploading shared HTML to an external host.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadConfig {
    pub endpoint_url: String,
    pub auth_header: Option<String>,
}

/// Upload a rendered share HTML to an external host.
///
/// Returns the public URL where the share can be accessed.
///
/// Implementation deferred — this is a stub for future external hosting support.
pub async fn upload_share(
    _config: &UploadConfig,
    _share_id: &str,
    _html: &str,
) -> Result<String, String> {
    Err("External upload not yet implemented".to_string())
}
