use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use glob::glob;
use uuid::Uuid;

use super::models::{
    CreateExternalSourceRequest, ExternalFileFormat, ExternalSource, ProcessedFileInfo,
    ResolvedFileInfo, UpdateExternalSourceRequest,
};

/// Error type for external sources operations
#[derive(Debug, thiserror::Error)]
pub enum ExternalSourcesError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("Glob pattern error: {0}")]
    GlobPattern(#[from] glob::PatternError),

    #[error("External source not found: {0}")]
    NotFound(Uuid),

    #[error("Invalid path pattern: {0}")]
    InvalidPattern(String),
}

/// Storage container for external sources
#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalSourcesData {
    sources: Vec<ExternalSource>,
}

/// Storage manager for external sources
pub struct ExternalSourcesStorage {
    data_dir: PathBuf,
    data: ExternalSourcesData,
}

impl ExternalSourcesStorage {
    /// Create a new storage instance
    pub fn new(data_dir: PathBuf) -> Result<Self, ExternalSourcesError> {
        let storage_dir = data_dir.join("external_sources");
        fs::create_dir_all(&storage_dir)?;

        let storage_path = storage_dir.join("sources.json");
        let data = if storage_path.exists() {
            let content = fs::read_to_string(&storage_path)?;
            serde_json::from_str(&content)?
        } else {
            ExternalSourcesData::default()
        };

        Ok(Self {
            data_dir: storage_dir,
            data,
        })
    }

    /// Save data to disk
    fn save(&self) -> Result<(), ExternalSourcesError> {
        let storage_path = self.data_dir.join("sources.json");
        let content = serde_json::to_string_pretty(&self.data)?;
        fs::write(storage_path, content)?;
        Ok(())
    }

    /// List all external sources
    pub fn list_sources(&self) -> Vec<ExternalSource> {
        self.data.sources.clone()
    }

    /// Get a source by ID
    pub fn get_source(&self, id: Uuid) -> Result<ExternalSource, ExternalSourcesError> {
        self.data
            .sources
            .iter()
            .find(|s| s.id == id)
            .cloned()
            .ok_or(ExternalSourcesError::NotFound(id))
    }

    /// Create a new external source
    pub fn create_source(
        &mut self,
        request: CreateExternalSourceRequest,
    ) -> Result<ExternalSource, ExternalSourcesError> {
        let source = ExternalSource::new(request.name, request.path_pattern)
            .with_formats(request.file_formats);

        let mut source = source;
        source.enabled = request.enabled;

        self.data.sources.push(source.clone());
        self.save()?;
        Ok(source)
    }

    /// Update an external source
    pub fn update_source(
        &mut self,
        id: Uuid,
        request: UpdateExternalSourceRequest,
    ) -> Result<ExternalSource, ExternalSourcesError> {
        let source = self
            .data
            .sources
            .iter_mut()
            .find(|s| s.id == id)
            .ok_or(ExternalSourcesError::NotFound(id))?;

        if let Some(name) = request.name {
            source.name = name;
        }
        if let Some(path_pattern) = request.path_pattern {
            source.path_pattern = path_pattern;
        }
        if let Some(formats) = request.file_formats {
            source.file_formats = formats;
        }
        if let Some(enabled) = request.enabled {
            source.enabled = enabled;
        }
        source.updated_at = Utc::now();

        let updated = source.clone();
        self.save()?;
        Ok(updated)
    }

    /// Delete an external source
    pub fn delete_source(&mut self, id: Uuid) -> Result<(), ExternalSourcesError> {
        let idx = self
            .data
            .sources
            .iter()
            .position(|s| s.id == id)
            .ok_or(ExternalSourcesError::NotFound(id))?;
        self.data.sources.remove(idx);
        self.save()?;
        Ok(())
    }

    /// Resolve files from a path pattern
    pub fn resolve_files(
        &self,
        path_pattern: &str,
        formats: &[ExternalFileFormat],
    ) -> Result<Vec<ResolvedFileInfo>, ExternalSourcesError> {
        let expanded = expand_home_dir(path_pattern);
        let mut files = Vec::new();

        for entry in glob(&expanded)? {
            match entry {
                Ok(path) => {
                    if !path.is_file() {
                        continue;
                    }

                    // Get extension and determine format
                    let ext = path
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("");

                    let format = match ExternalFileFormat::from_extension(ext) {
                        Some(f) => f,
                        None => continue, // Skip unsupported files
                    };

                    // Filter by requested formats (empty means all)
                    if !formats.is_empty() && !formats.contains(&format) {
                        continue;
                    }

                    // Get file metadata
                    if let Ok(metadata) = fs::metadata(&path) {
                        let modified_at = metadata
                            .modified()
                            .ok()
                            .map(|t| DateTime::<Utc>::from(t))
                            .unwrap_or_else(Utc::now);

                        files.push(ResolvedFileInfo {
                            path: path.to_string_lossy().to_string(),
                            format,
                            size_bytes: metadata.len(),
                            modified_at,
                        });
                    }
                }
                Err(e) => {
                    log::warn!("Error accessing path: {}", e);
                }
            }
        }

        // Sort by path for consistent ordering
        files.sort_by(|a, b| a.path.cmp(&b.path));
        Ok(files)
    }

    /// Preview files that would be matched by a source
    pub fn preview_source_files(
        &self,
        source_id: Uuid,
    ) -> Result<Vec<ResolvedFileInfo>, ExternalSourcesError> {
        let source = self.get_source(source_id)?;
        self.resolve_files(&source.path_pattern, &source.file_formats)
    }

    /// Mark a file as processed
    pub fn mark_processed(
        &mut self,
        source_id: Uuid,
        file_path: &str,
        modified_at: DateTime<Utc>,
        page_id: Option<Uuid>,
    ) -> Result<(), ExternalSourcesError> {
        let source = self
            .data
            .sources
            .iter_mut()
            .find(|s| s.id == source_id)
            .ok_or(ExternalSourcesError::NotFound(source_id))?;

        // Remove existing entry for this path if present
        source.processed_files.retain(|f| f.path != file_path);

        // Add new entry
        source.processed_files.push(ProcessedFileInfo {
            path: file_path.to_string(),
            modified_at,
            processed_at: Utc::now(),
            page_id,
        });

        source.last_processed = Some(Utc::now());
        source.updated_at = Utc::now();

        self.save()?;
        Ok(())
    }

    /// Check if a file needs processing (for incremental mode)
    pub fn needs_processing(
        &self,
        source_id: Uuid,
        file_path: &str,
        current_modified_at: DateTime<Utc>,
    ) -> Result<bool, ExternalSourcesError> {
        let source = self.get_source(source_id)?;

        // Find existing processed info
        let processed = source
            .processed_files
            .iter()
            .find(|f| f.path == file_path);

        match processed {
            Some(info) => {
                // File was processed before - check if it's been modified
                Ok(current_modified_at > info.modified_at)
            }
            None => {
                // File has never been processed
                Ok(true)
            }
        }
    }

    /// Get the page ID for a previously processed file
    pub fn get_processed_page_id(
        &self,
        source_id: Uuid,
        file_path: &str,
    ) -> Result<Option<Uuid>, ExternalSourcesError> {
        let source = self.get_source(source_id)?;

        Ok(source
            .processed_files
            .iter()
            .find(|f| f.path == file_path)
            .and_then(|f| f.page_id))
    }
}

/// Expand ~ to home directory in path
fn expand_home_dir(path: &str) -> String {
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return format!("{}{}", home.display(), &path[1..]);
        }
    }
    path.to_string()
}

/// Read file content based on format
pub fn read_file_content(path: &Path, format: &ExternalFileFormat) -> Result<String, std::io::Error> {
    let raw = fs::read_to_string(path)?;

    match format {
        ExternalFileFormat::Json => {
            // Pretty-print JSON for better readability
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                Ok(serde_json::to_string_pretty(&value).unwrap_or(raw))
            } else {
                Ok(raw)
            }
        }
        ExternalFileFormat::Markdown | ExternalFileFormat::PlainText | ExternalFileFormat::Html => Ok(raw),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expand_home_dir() {
        let expanded = expand_home_dir("~/test");
        assert!(expanded.contains("/test"));
        assert!(!expanded.starts_with("~"));

        // Non-home paths should be unchanged
        assert_eq!(expand_home_dir("/absolute/path"), "/absolute/path");
        assert_eq!(expand_home_dir("relative/path"), "relative/path");
    }

    #[test]
    fn test_format_from_extension() {
        assert_eq!(
            ExternalFileFormat::from_extension("json"),
            Some(ExternalFileFormat::Json)
        );
        assert_eq!(
            ExternalFileFormat::from_extension("md"),
            Some(ExternalFileFormat::Markdown)
        );
        assert_eq!(
            ExternalFileFormat::from_extension("txt"),
            Some(ExternalFileFormat::PlainText)
        );
        assert_eq!(ExternalFileFormat::from_extension("unknown"), None);
    }
}
