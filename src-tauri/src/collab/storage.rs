//! Collab session storage — tracks active real-time collaboration sessions.
//!
//! Follows the same pattern as share/storage.rs: JSON file with atomic writes.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

/// How long a collab session stays valid.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CollabExpiry {
    OneHour,
    EightHours,
    OneDay,
    Never,
}

impl CollabExpiry {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "1h" => Ok(Self::OneHour),
            "8h" => Ok(Self::EightHours),
            "1d" => Ok(Self::OneDay),
            "never" => Ok(Self::Never),
            _ => Err(format!("Invalid collab expiry: {}", s)),
        }
    }

    pub fn to_duration(&self) -> Option<Duration> {
        match self {
            Self::OneHour => Some(Duration::hours(1)),
            Self::EightHours => Some(Duration::hours(8)),
            Self::OneDay => Some(Duration::days(1)),
            Self::Never => None,
        }
    }
}

/// Metadata for an active collaboration session.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollabSession {
    /// Room ID (used as the PartyKit room identifier).
    pub id: String,
    pub page_id: Uuid,
    pub notebook_id: Uuid,
    pub page_title: String,
    pub expiry: CollabExpiry,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub share_url: String,
    /// Read-only share URL (view-only permission token).
    #[serde(default)]
    pub read_only_share_url: Option<String>,
    pub is_active: bool,
}

/// Manages collab session records on disk.
pub struct CollabStorage {
    collab_dir: PathBuf,
}

impl CollabStorage {
    pub fn new(library_path: PathBuf) -> Self {
        Self {
            collab_dir: library_path.join("collab"),
        }
    }

    /// Create the collab directory if it doesn't exist.
    pub fn init(&self) -> Result<(), String> {
        fs::create_dir_all(&self.collab_dir)
            .map_err(|e| format!("Failed to create collab dir: {}", e))
    }

    /// Create a new collab session.
    pub fn create_session(&self, session: CollabSession) -> Result<CollabSession, String> {
        let mut records = self.load_records()?;
        records.push(session.clone());
        self.save_records(&records)?;
        Ok(session)
    }

    /// Get a session by ID.
    pub fn get_session(&self, id: &str) -> Result<Option<CollabSession>, String> {
        let records = self.load_records()?;
        Ok(records.into_iter().find(|r| r.id == id))
    }

    /// Get the active session for a specific page, if any.
    pub fn get_active_session_for_page(
        &self,
        page_id: Uuid,
    ) -> Result<Option<CollabSession>, String> {
        let now = Utc::now();
        let records = self.load_records()?;
        Ok(records.into_iter().find(|r| {
            r.page_id == page_id
                && r.is_active
                && r.expires_at.map_or(true, |exp| exp > now)
        }))
    }

    /// List all active (non-expired) sessions.
    pub fn list_active_sessions(&self) -> Result<Vec<CollabSession>, String> {
        let now = Utc::now();
        let records = self.load_records()?;
        Ok(records
            .into_iter()
            .filter(|r| r.is_active && r.expires_at.map_or(true, |exp| exp > now))
            .collect())
    }

    /// Stop a session (mark inactive).
    pub fn stop_session(&self, id: &str) -> Result<(), String> {
        let mut records = self.load_records()?;
        if let Some(session) = records.iter_mut().find(|r| r.id == id) {
            session.is_active = false;
        }
        self.save_records(&records)
    }

    /// Delete a session record entirely.
    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        let mut records = self.load_records()?;
        records.retain(|r| r.id != id);
        self.save_records(&records)
    }

    /// Remove sessions that have passed their expiry time.
    pub fn cleanup_expired(&self) -> Result<usize, String> {
        let now = Utc::now();
        let records = self.load_records()?;
        let (expired, active): (Vec<_>, Vec<_>) =
            records.into_iter().partition(|r| match r.expires_at {
                Some(exp) => exp < now,
                None => false,
            });

        let count = expired.len();
        self.save_records(&active)?;
        Ok(count)
    }

    // -- private helpers --

    fn index_path(&self) -> PathBuf {
        self.collab_dir.join("sessions.json")
    }

    fn load_records(&self) -> Result<Vec<CollabSession>, String> {
        let path = self.index_path();
        if !path.exists() {
            return Ok(Vec::new());
        }
        let data = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read collab sessions: {}", e))?;
        serde_json::from_str(&data)
            .map_err(|e| format!("Failed to parse collab sessions: {}", e))
    }

    fn save_records(&self, records: &[CollabSession]) -> Result<(), String> {
        let path = self.index_path();
        let tmp_path = path.with_extension("json.tmp");
        let data = serde_json::to_string_pretty(records)
            .map_err(|e| format!("Failed to serialize collab sessions: {}", e))?;
        fs::write(&tmp_path, &data)
            .map_err(|e| format!("Failed to write collab sessions tmp: {}", e))?;
        fs::rename(&tmp_path, &path)
            .map_err(|e| format!("Failed to rename collab sessions tmp: {}", e))?;
        Ok(())
    }
}

/// Generate a 12-character alphanumeric room ID.
pub fn generate_room_id() -> String {
    use rand::Rng;
    const CHARSET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut rng = rand::thread_rng();
    (0..12)
        .map(|_| {
            let idx = rng.gen_range(0..CHARSET.len());
            CHARSET[idx] as char
        })
        .collect()
}
