//! External Editor Support
//!
//! Allows opening pages in external editors (VS Code, Vim, etc.)
//! with file watching for automatic reimport on save.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use notify::{Config, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::markdown::export_page_to_markdown;
use crate::storage::Page;

/// Known external editors with their launch commands
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorConfig {
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    pub wait: bool, // Whether to wait for editor to close
}

impl Default for EditorConfig {
    fn default() -> Self {
        Self {
            name: "System Default".to_string(),
            command: String::new(),
            args: vec![],
            wait: false,
        }
    }
}

/// Predefined editor configurations
pub fn get_known_editors() -> Vec<EditorConfig> {
    vec![
        EditorConfig {
            name: "System Default".to_string(),
            command: String::new(),
            args: vec![],
            wait: false,
        },
        EditorConfig {
            name: "VS Code".to_string(),
            command: "code".to_string(),
            args: vec!["--wait".to_string()],
            wait: true,
        },
        EditorConfig {
            name: "VS Code (no wait)".to_string(),
            command: "code".to_string(),
            args: vec![],
            wait: false,
        },
        EditorConfig {
            name: "Vim (Terminal)".to_string(),
            command: if cfg!(target_os = "macos") {
                "open".to_string()
            } else {
                "x-terminal-emulator".to_string()
            },
            args: if cfg!(target_os = "macos") {
                vec!["-a".to_string(), "Terminal".to_string(), "--args".to_string(), "vim".to_string()]
            } else {
                vec!["-e".to_string(), "vim".to_string()]
            },
            wait: false,
        },
        EditorConfig {
            name: "Neovim (Terminal)".to_string(),
            command: if cfg!(target_os = "macos") {
                "open".to_string()
            } else {
                "x-terminal-emulator".to_string()
            },
            args: if cfg!(target_os = "macos") {
                vec!["-a".to_string(), "Terminal".to_string(), "--args".to_string(), "nvim".to_string()]
            } else {
                vec!["-e".to_string(), "nvim".to_string()]
            },
            wait: false,
        },
        EditorConfig {
            name: "Sublime Text".to_string(),
            command: "subl".to_string(),
            args: vec!["--wait".to_string()],
            wait: true,
        },
        EditorConfig {
            name: "Atom".to_string(),
            command: "atom".to_string(),
            args: vec!["--wait".to_string()],
            wait: true,
        },
        EditorConfig {
            name: "Emacs".to_string(),
            command: "emacs".to_string(),
            args: vec![],
            wait: false,
        },
        EditorConfig {
            name: "TextMate".to_string(),
            command: "mate".to_string(),
            args: vec!["--wait".to_string()],
            wait: true,
        },
        EditorConfig {
            name: "Zed".to_string(),
            command: "zed".to_string(),
            args: vec!["--wait".to_string()],
            wait: true,
        },
    ]
}

/// Information about an active external edit session
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditSession {
    pub page_id: Uuid,
    pub notebook_id: Uuid,
    pub temp_path: PathBuf,
    pub last_modified: SystemTime,
    pub started_at: SystemTime,
}

/// Error types for external editor operations
#[derive(Debug, thiserror::Error)]
pub enum ExternalEditorError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Editor not found: {0}")]
    EditorNotFound(String),
    #[error("Session not found for page: {0}")]
    SessionNotFound(String),
    #[error("Watch error: {0}")]
    WatchError(String),
}

pub type Result<T> = std::result::Result<T, ExternalEditorError>;

/// Manages external editor sessions
pub struct ExternalEditorManager {
    sessions: Arc<Mutex<HashMap<Uuid, EditSession>>>,
    temp_dir: PathBuf,
    #[allow(dead_code)]
    watcher: Option<RecommendedWatcher>,
}

impl ExternalEditorManager {
    /// Create a new external editor manager
    pub fn new() -> Result<Self> {
        let temp_dir = std::env::temp_dir().join("katt-external-edit");
        std::fs::create_dir_all(&temp_dir)?;

        Ok(Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            temp_dir,
            watcher: None,
        })
    }

    /// Get the temp directory path
    pub fn temp_dir(&self) -> &Path {
        &self.temp_dir
    }

    /// Export a page to a temp markdown file for editing
    pub fn export_page_for_editing(&self, page: &Page) -> Result<PathBuf> {
        let markdown = export_page_to_markdown(page);

        // Create temp file with page title as name
        let safe_title = sanitize_filename(&page.title);
        let filename = format!("{}_{}.md", safe_title, &page.id.to_string()[..8]);
        let temp_path = self.temp_dir.join(&filename);

        std::fs::write(&temp_path, &markdown)?;

        // Record the session
        let session = EditSession {
            page_id: page.id,
            notebook_id: page.notebook_id,
            temp_path: temp_path.clone(),
            last_modified: SystemTime::now(),
            started_at: SystemTime::now(),
        };

        self.sessions.lock().unwrap().insert(page.id, session);

        log::info!("Exported page {} to {:?} for external editing", page.id, temp_path);
        Ok(temp_path)
    }

    /// Open a file in an external editor
    pub fn open_in_editor(&self, path: &Path, config: &EditorConfig) -> Result<()> {
        use std::process::Command;

        if config.command.is_empty() {
            // Use system default
            #[cfg(target_os = "macos")]
            {
                Command::new("open")
                    .arg(path)
                    .spawn()
                    .map_err(|e| ExternalEditorError::Io(e))?;
            }
            #[cfg(target_os = "linux")]
            {
                Command::new("xdg-open")
                    .arg(path)
                    .spawn()
                    .map_err(|e| ExternalEditorError::Io(e))?;
            }
            #[cfg(target_os = "windows")]
            {
                Command::new("cmd")
                    .args(["/C", "start", ""])
                    .arg(path)
                    .spawn()
                    .map_err(|e| ExternalEditorError::Io(e))?;
            }
        } else {
            // Use specified editor
            let mut cmd = Command::new(&config.command);
            for arg in &config.args {
                cmd.arg(arg);
            }
            cmd.arg(path);

            if config.wait {
                cmd.status()
                    .map_err(|e| ExternalEditorError::EditorNotFound(format!("{}: {}", config.command, e)))?;
            } else {
                cmd.spawn()
                    .map_err(|e| ExternalEditorError::EditorNotFound(format!("{}: {}", config.command, e)))?;
            }
        }

        log::info!("Opened {:?} in editor: {}", path, config.name);
        Ok(())
    }

    /// Check if the temp file has been modified since export
    pub fn check_for_changes(&self, page_id: Uuid) -> Result<Option<String>> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(&page_id)
            .ok_or_else(|| ExternalEditorError::SessionNotFound(page_id.to_string()))?;

        let metadata = std::fs::metadata(&session.temp_path)?;
        let modified = metadata.modified()?;

        if modified > session.last_modified {
            let content = std::fs::read_to_string(&session.temp_path)?;
            Ok(Some(content))
        } else {
            Ok(None)
        }
    }

    /// Read the current content of a temp file
    pub fn read_temp_file(&self, page_id: Uuid) -> Result<String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(&page_id)
            .ok_or_else(|| ExternalEditorError::SessionNotFound(page_id.to_string()))?;

        let content = std::fs::read_to_string(&session.temp_path)?;
        Ok(content)
    }

    /// Update the last modified time after reimport
    pub fn mark_as_synced(&self, page_id: Uuid) -> Result<()> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.get_mut(&page_id) {
            session.last_modified = SystemTime::now();
        }
        Ok(())
    }

    /// End an editing session and clean up
    pub fn end_session(&self, page_id: Uuid) -> Result<()> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(session) = sessions.remove(&page_id) {
            // Clean up temp file
            let _ = std::fs::remove_file(&session.temp_path);
            log::info!("Ended external edit session for page {}", page_id);
        }
        Ok(())
    }

    /// Get active session for a page
    pub fn get_session(&self, page_id: Uuid) -> Option<EditSession> {
        self.sessions.lock().unwrap().get(&page_id).cloned()
    }

    /// Get all active sessions
    pub fn get_all_sessions(&self) -> Vec<EditSession> {
        self.sessions.lock().unwrap().values().cloned().collect()
    }

    /// Clean up old sessions (older than 24 hours)
    pub fn cleanup_old_sessions(&self) -> Result<()> {
        let mut sessions = self.sessions.lock().unwrap();
        let now = SystemTime::now();
        let max_age = Duration::from_secs(24 * 60 * 60);

        let old_ids: Vec<Uuid> = sessions.iter()
            .filter(|(_, s)| now.duration_since(s.started_at).unwrap_or_default() > max_age)
            .map(|(id, _)| *id)
            .collect();

        for id in old_ids {
            if let Some(session) = sessions.remove(&id) {
                let _ = std::fs::remove_file(&session.temp_path);
                log::info!("Cleaned up old session for page {}", id);
            }
        }

        Ok(())
    }
}

impl Default for ExternalEditorManager {
    fn default() -> Self {
        Self::new().expect("Failed to create ExternalEditorManager")
    }
}

/// Sanitize a filename to remove invalid characters
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .take(50) // Limit length
        .collect::<String>()
        .trim()
        .to_string()
}

/// Setup a file watcher for external edit sessions
pub fn setup_watcher<F>(
    temp_dir: &Path,
    callback: F,
) -> Result<RecommendedWatcher>
where
    F: Fn(PathBuf) + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();

    let mut watcher = RecommendedWatcher::new(
        move |res: std::result::Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                if event.kind.is_modify() {
                    for path in event.paths {
                        let _ = tx.send(path);
                    }
                }
            }
        },
        Config::default().with_poll_interval(Duration::from_secs(1)),
    ).map_err(|e| ExternalEditorError::WatchError(e.to_string()))?;

    watcher.watch(temp_dir, RecursiveMode::NonRecursive)
        .map_err(|e| ExternalEditorError::WatchError(e.to_string()))?;

    // Spawn thread to handle file change events
    std::thread::spawn(move || {
        while let Ok(path) = rx.recv() {
            callback(path);
        }
    });

    Ok(watcher)
}
