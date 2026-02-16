use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Supported file formats for external sources
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum ExternalFileFormat {
    Json,
    Markdown,
    PlainText,
    Html,
}

impl ExternalFileFormat {
    /// Get file extensions associated with this format
    pub fn extensions(&self) -> &[&str] {
        match self {
            ExternalFileFormat::Json => &["json"],
            ExternalFileFormat::Markdown => &["md", "markdown"],
            ExternalFileFormat::PlainText => &["txt", "text"],
            ExternalFileFormat::Html => &["html", "htm"],
        }
    }

    /// Try to detect format from file extension
    pub fn from_extension(ext: &str) -> Option<Self> {
        let ext_lower = ext.to_lowercase();
        match ext_lower.as_str() {
            "json" => Some(ExternalFileFormat::Json),
            "md" | "markdown" => Some(ExternalFileFormat::Markdown),
            "txt" | "text" => Some(ExternalFileFormat::PlainText),
            "html" | "htm" => Some(ExternalFileFormat::Html),
            _ => None,
        }
    }
}

/// Information about a processed file
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessedFileInfo {
    /// Full path to the file
    pub path: String,
    /// File's modification time when it was processed
    pub modified_at: DateTime<Utc>,
    /// When we processed the file
    pub processed_at: DateTime<Utc>,
    /// ID of the page created from this file (if any)
    pub page_id: Option<Uuid>,
}

/// An external source configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSource {
    pub id: Uuid,
    pub name: String,
    /// Path pattern supporting glob syntax and ~ for home directory
    /// e.g., ~/research/*.json, /data/notes/**/*.md
    pub path_pattern: String,
    /// File formats to include (empty means all supported)
    pub file_formats: Vec<ExternalFileFormat>,
    pub enabled: bool,
    pub last_processed: Option<DateTime<Utc>>,
    #[serde(default)]
    pub processed_files: Vec<ProcessedFileInfo>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl ExternalSource {
    pub fn new(name: String, path_pattern: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            path_pattern,
            file_formats: Vec::new(),
            enabled: true,
            last_processed: None,
            processed_files: Vec::new(),
            created_at: now,
            updated_at: now,
        }
    }

    pub fn with_formats(mut self, formats: Vec<ExternalFileFormat>) -> Self {
        self.file_formats = formats;
        self
    }
}

/// Request to create a new external source
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateExternalSourceRequest {
    pub name: String,
    pub path_pattern: String,
    #[serde(default)]
    pub file_formats: Vec<ExternalFileFormat>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

fn default_true() -> bool {
    true
}

/// Request to update an external source
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateExternalSourceRequest {
    pub name: Option<String>,
    pub path_pattern: Option<String>,
    pub file_formats: Option<Vec<ExternalFileFormat>>,
    pub enabled: Option<bool>,
}

/// File info returned from preview/resolve operations
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedFileInfo {
    pub path: String,
    pub format: ExternalFileFormat,
    pub size_bytes: u64,
    pub modified_at: DateTime<Utc>,
}
