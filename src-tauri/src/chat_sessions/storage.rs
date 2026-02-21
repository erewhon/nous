use std::fs;
use std::path::PathBuf;

use uuid::Uuid;

use super::models::*;
use crate::storage::StorageError;

type Result<T> = std::result::Result<T, StorageError>;

/// Storage for AI chat sessions (one JSON file per session)
pub struct ChatSessionStorage {
    sessions_dir: PathBuf,
}

impl ChatSessionStorage {
    /// Create a new chat session storage, creating the directory if needed
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        let sessions_dir = data_dir.join("ai_sessions");
        fs::create_dir_all(&sessions_dir)?;
        Ok(Self { sessions_dir })
    }

    /// Get the file path for a session
    fn session_path(&self, id: Uuid) -> PathBuf {
        self.sessions_dir.join(format!("{}.json", id))
    }

    /// Save a session using atomic write (write to .tmp then rename)
    pub fn save_session(&self, session: &ChatSession) -> Result<()> {
        let path = self.session_path(session.id);
        let tmp_path = path.with_extension("json.tmp");
        let json = serde_json::to_string_pretty(session)?;
        fs::write(&tmp_path, json)?;
        fs::rename(&tmp_path, &path)?;
        Ok(())
    }

    /// Load a full session by ID
    pub fn get_session(&self, id: Uuid) -> Result<ChatSession> {
        let path = self.session_path(id);
        if !path.exists() {
            return Err(StorageError::PageNotFound(id));
        }
        let content = fs::read_to_string(path)?;
        let session: ChatSession = serde_json::from_str(&content)?;
        Ok(session)
    }

    /// List all sessions as lightweight summaries, sorted by updatedAt desc
    pub fn list_sessions(&self) -> Result<Vec<ChatSessionSummary>> {
        let mut summaries = Vec::new();

        if !self.sessions_dir.exists() {
            return Ok(summaries);
        }

        for entry in fs::read_dir(&self.sessions_dir)? {
            let entry = entry?;
            let path = entry.path();

            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(session) = serde_json::from_str::<ChatSession>(&content) {
                        summaries.push(ChatSessionSummary {
                            id: session.id,
                            title: session.title,
                            model: session.model,
                            message_count: session.messages.len(),
                            created_at: session.created_at,
                            updated_at: session.updated_at,
                        });
                    }
                }
            }
        }

        // Sort by updated_at descending (most recent first)
        summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        Ok(summaries)
    }

    /// Delete a session by ID
    pub fn delete_session(&self, id: Uuid) -> Result<()> {
        let path = self.session_path(id);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    /// Update just the title of a session
    pub fn update_title(&self, id: Uuid, title: String) -> Result<()> {
        let mut session = self.get_session(id)?;
        session.title = title;
        session.updated_at = chrono::Utc::now();
        self.save_session(&session)
    }
}
