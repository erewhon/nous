use chrono::{DateTime, Duration, Utc};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
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

/// Metadata for a single shared page.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareRecord {
    pub id: String,
    pub page_id: Uuid,
    pub notebook_id: Uuid,
    pub page_title: String,
    pub theme: String,
    pub expiry: ShareExpiry,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub external_url: Option<String>,
}

/// Manages share records and HTML files on disk.
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

    /// Persist a new share record and its rendered HTML.
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

    /// Look up a share record by ID. Returns None if not found.
    pub fn get_share(&self, id: &str) -> Result<Option<ShareRecord>, String> {
        let records = self.load_records()?;
        Ok(records.into_iter().find(|r| r.id == id))
    }

    /// Read the rendered HTML for a share.
    pub fn get_share_html(&self, id: &str) -> Result<Option<String>, String> {
        let path = self.shares_dir.join(format!("{}.html", id));
        if !path.exists() {
            return Ok(None);
        }
        fs::read_to_string(&path)
            .map(Some)
            .map_err(|e| format!("Failed to read share HTML: {}", e))
    }

    /// List all share records.
    pub fn list_shares(&self) -> Result<Vec<ShareRecord>, String> {
        self.load_records()
    }

    /// Delete a share record and its HTML file.
    pub fn delete_share(&self, id: &str) -> Result<(), String> {
        let mut records = self.load_records()?;
        records.retain(|r| r.id != id);
        self.save_records(&records)?;

        let html_path = self.shares_dir.join(format!("{}.html", id));
        if html_path.exists() {
            let _ = fs::remove_file(&html_path);
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
            let path = self.shares_dir.join(format!("{}.html", r.id));
            let _ = fs::remove_file(&path);
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

/// Build a ShareRecord from request parameters.
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
        page_id,
        notebook_id,
        page_title: page_title.to_string(),
        theme: theme.to_string(),
        expiry,
        created_at: now,
        expires_at,
        external_url: None,
    }
}
