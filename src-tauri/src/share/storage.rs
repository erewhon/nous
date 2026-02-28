use chrono::{DateTime, Duration, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

/// How long a share link stays valid.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ShareExpiry {
    OneHour,
    OneDay,
    OneWeek,
    OneMonth,
    Never,
}

impl ShareExpiry {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "1h" => Ok(Self::OneHour),
            "1d" => Ok(Self::OneDay),
            "1w" => Ok(Self::OneWeek),
            "1m" => Ok(Self::OneMonth),
            "never" => Ok(Self::Never),
            _ => Err(format!("Invalid expiry: {}", s)),
        }
    }

    fn to_duration(&self) -> Option<Duration> {
        match self {
            Self::OneHour => Some(Duration::hours(1)),
            Self::OneDay => Some(Duration::days(1)),
            Self::OneWeek => Some(Duration::weeks(1)),
            Self::OneMonth => Some(Duration::days(30)),
            Self::Never => None,
        }
    }
}

/// What kind of content is shared.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum ShareType {
    SinglePage { page_id: Uuid },
    Folder { folder_id: Uuid },
    Section { section_id: Uuid },
}

/// Metadata for a shared resource.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRecord {
    pub id: String,
    /// Discriminated share type (single page, folder, or section).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub share_type: Option<ShareType>,
    pub notebook_id: Uuid,
    /// Display title (page title, folder name, or section name).
    pub title: String,
    pub theme: String,
    pub expiry: ShareExpiry,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub external_url: Option<String>,
    /// Number of pages (for multi-page shares).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_count: Option<usize>,

    // Backward compat: old records have page_id + page_title at top level.
    // New records use share_type instead. On load we migrate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page_title: Option<String>,
}

impl ShareRecord {
    /// Ensure share_type is populated (migrates old records).
    pub fn normalized(mut self) -> Self {
        if self.share_type.is_none() {
            if let Some(pid) = self.page_id {
                self.share_type = Some(ShareType::SinglePage { page_id: pid });
            }
        }
        // Migrate page_title -> title if title is empty
        if self.title.is_empty() {
            if let Some(pt) = &self.page_title {
                self.title = pt.clone();
            }
        }
        self
    }

    /// Get the page_id if this is a single-page share.
    pub fn single_page_id(&self) -> Option<Uuid> {
        match &self.share_type {
            Some(ShareType::SinglePage { page_id }) => Some(*page_id),
            None => self.page_id,
            _ => None,
        }
    }
}

/// Manages share records and files on disk.
pub struct ShareStorage {
    shares_dir: PathBuf,
}

impl ShareStorage {
    pub fn new(library_path: PathBuf) -> Self {
        Self {
            shares_dir: library_path.join("shares"),
        }
    }

    /// Create the shares directory if it doesn't exist.
    pub fn init(&self) -> Result<(), String> {
        fs::create_dir_all(&self.shares_dir)
            .map_err(|e| format!("Failed to create shares dir: {}", e))
    }

    /// Persist a new share record and its rendered HTML (single page).
    pub fn create_share(&self, record: ShareRecord, html: &str) -> Result<ShareRecord, String> {
        // Write the HTML file
        let html_path = self.shares_dir.join(format!("{}.html", record.id));
        fs::write(&html_path, html)
            .map_err(|e| format!("Failed to write share HTML: {}", e))?;

        // Update the index
        let mut records = self.load_records()?;
        records.push(record.clone());
        self.save_records(&records)?;

        Ok(record)
    }

    /// Persist a new multi-page share from a generated site directory.
    pub fn create_multi_share(
        &self,
        record: ShareRecord,
        source_dir: &Path,
    ) -> Result<ShareRecord, String> {
        let target_dir = self.shares_dir.join(&record.id);
        copy_dir_recursive(source_dir, &target_dir)?;

        let mut records = self.load_records()?;
        records.push(record.clone());
        self.save_records(&records)?;

        Ok(record)
    }

    /// Look up a share record by ID. Returns None if not found.
    pub fn get_share(&self, id: &str) -> Result<Option<ShareRecord>, String> {
        let records = self.load_records()?;
        Ok(records.into_iter().find(|r| r.id == id).map(|r| r.normalized()))
    }

    /// Read the rendered HTML for a single-page share.
    pub fn get_share_html(&self, id: &str) -> Result<Option<String>, String> {
        let path = self.shares_dir.join(format!("{}.html", id));
        if !path.exists() {
            return Ok(None);
        }
        fs::read_to_string(&path)
            .map(Some)
            .map_err(|e| format!("Failed to read share HTML: {}", e))
    }

    /// Read a file from a multi-page share site.
    pub fn get_share_file(&self, id: &str, relative_path: &str) -> Result<Option<Vec<u8>>, String> {
        let dir = self.shares_dir.join(id);
        if !dir.is_dir() {
            return Ok(None);
        }
        let file_path = dir.join(relative_path);
        // Prevent path traversal
        if !file_path.starts_with(&dir) {
            return Err("Invalid path".to_string());
        }
        if !file_path.exists() {
            return Ok(None);
        }
        fs::read(&file_path)
            .map(Some)
            .map_err(|e| format!("Failed to read share file: {}", e))
    }

    /// Check if a share is stored as a multi-page directory.
    pub fn is_multi_page_share(&self, id: &str) -> bool {
        self.shares_dir.join(id).is_dir()
    }

    /// List all share records.
    pub fn list_shares(&self) -> Result<Vec<ShareRecord>, String> {
        let records = self.load_records()?;
        Ok(records.into_iter().map(|r| r.normalized()).collect())
    }

    /// Delete a share record and its files (HTML file or directory).
    pub fn delete_share(&self, id: &str) -> Result<(), String> {
        let mut records = self.load_records()?;
        records.retain(|r| r.id != id);
        self.save_records(&records)?;

        // Remove single-page HTML file
        let html_path = self.shares_dir.join(format!("{}.html", id));
        if html_path.exists() {
            let _ = fs::remove_file(&html_path);
        }

        // Remove multi-page directory
        let dir_path = self.shares_dir.join(id);
        if dir_path.is_dir() {
            let _ = fs::remove_dir_all(&dir_path);
        }

        Ok(())
    }

    /// Remove shares that have passed their expiry time.
    pub fn cleanup_expired(&self) -> Result<usize, String> {
        let now = Utc::now();
        let records = self.load_records()?;
        let (expired, active): (Vec<_>, Vec<_>) =
            records.into_iter().partition(|r| match r.expires_at {
                Some(exp) => exp < now,
                None => false,
            });

        let count = expired.len();
        for r in &expired {
            // Remove single-page HTML
            let path = self.shares_dir.join(format!("{}.html", r.id));
            let _ = fs::remove_file(&path);
            // Remove multi-page directory
            let dir = self.shares_dir.join(&r.id);
            if dir.is_dir() {
                let _ = fs::remove_dir_all(&dir);
            }
        }

        self.save_records(&active)?;
        Ok(count)
    }

    // -- private helpers --

    fn index_path(&self) -> PathBuf {
        self.shares_dir.join("shares.json")
    }

    fn load_records(&self) -> Result<Vec<ShareRecord>, String> {
        let path = self.index_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let data =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read shares index: {}", e))?;
        serde_json::from_str(&data).map_err(|e| format!("Failed to parse shares index: {}", e))
    }

    fn save_records(&self, records: &[ShareRecord]) -> Result<(), String> {
        let path = self.index_path();
        let tmp_path = path.with_extension("json.tmp");
        let data = serde_json::to_string_pretty(records)
            .map_err(|e| format!("Failed to serialize shares: {}", e))?;
        fs::write(&tmp_path, &data)
            .map_err(|e| format!("Failed to write shares tmp: {}", e))?;
        fs::rename(&tmp_path, &path)
            .map_err(|e| format!("Failed to rename shares tmp: {}", e))?;
        Ok(())
    }
}

/// Generate a 12-character alphanumeric share ID.
pub fn generate_share_id() -> String {
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..12)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}

/// Build a ShareRecord for a single page share.
pub fn build_share_record(
    page_id: Uuid,
    notebook_id: Uuid,
    page_title: &str,
    theme: &str,
    expiry: ShareExpiry,
) -> ShareRecord {
    let now = Utc::now();
    let expires_at = expiry.to_duration().map(|d| now + d);

    ShareRecord {
        id: generate_share_id(),
        share_type: Some(ShareType::SinglePage { page_id }),
        notebook_id,
        title: page_title.to_string(),
        theme: theme.to_string(),
        expiry,
        created_at: now,
        expires_at,
        external_url: None,
        page_count: None,
        // Backward compat fields
        page_id: Some(page_id),
        page_title: Some(page_title.to_string()),
    }
}

/// Build a ShareRecord for a folder or section share.
pub fn build_multi_share_record(
    share_type: ShareType,
    notebook_id: Uuid,
    title: &str,
    theme: &str,
    expiry: ShareExpiry,
    page_count: usize,
) -> ShareRecord {
    let now = Utc::now();
    let expires_at = expiry.to_duration().map(|d| now + d);

    ShareRecord {
        id: generate_share_id(),
        share_type: Some(share_type),
        notebook_id,
        title: title.to_string(),
        theme: theme.to_string(),
        expiry,
        created_at: now,
        expires_at,
        external_url: None,
        page_count: Some(page_count),
        page_id: None,
        page_title: None,
    }
}

/// Recursively copy a directory tree.
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| format!("Failed to create dir {}: {}", dst.display(), e))?;

    for entry in fs::read_dir(src).map_err(|e| format!("Failed to read dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Dir entry error: {}", e))?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            fs::copy(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy file: {}", e))?;
        }
    }

    Ok(())
}
