use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::sync::config::SyncConfig;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NotebookType {
    Standard,
    Zettelkasten,
}

impl Default for NotebookType {
    fn default() -> Self {
        Self::Standard
    }
}

/// Type of folder - standard user folders or special system folders
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FolderType {
    Standard,
    Archive,
}

impl Default for FolderType {
    fn default() -> Self {
        Self::Standard
    }
}

/// Mode for how system prompts are applied
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SystemPromptMode {
    /// Override higher-level prompts (default behavior)
    Override,
    /// Concatenate with higher-level prompts
    Concatenate,
}

impl Default for SystemPromptMode {
    fn default() -> Self {
        Self::Override
    }
}

/// A section within a notebook for grouping folders and pages (like OneNote)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Section {
    pub id: Uuid,
    pub notebook_id: Uuid,
    pub name: String,
    /// Description for the section
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Color for the section tab (CSS color string: hex, rgb, etc.)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Custom AI system prompt for this section
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    /// How this prompt interacts with higher-level prompts
    #[serde(default)]
    pub system_prompt_mode: SystemPromptMode,
    /// AI model override for this section (e.g., "gpt-4o", "claude-sonnet-4-20250514")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_model: Option<String>,
    /// Position for ordering sections
    #[serde(default)]
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Section {
    pub fn new(notebook_id: Uuid, name: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            notebook_id,
            name,
            description: None,
            color: None,
            system_prompt: None,
            system_prompt_mode: SystemPromptMode::default(),
            ai_model: None,
            position: 0,
            created_at: now,
            updated_at: now,
        }
    }
}

/// A folder within a notebook for organizing pages
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: Uuid,
    pub notebook_id: Uuid,
    pub name: String,
    /// Parent folder ID, None means root level
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<Uuid>,
    /// Section this folder belongs to (None means root level when sections disabled)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub section_id: Option<Uuid>,
    /// Type of folder (standard or archive)
    #[serde(default)]
    pub folder_type: FolderType,
    /// Color for the folder (CSS color string)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Position for ordering within parent
    #[serde(default)]
    pub position: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Folder {
    pub fn new(notebook_id: Uuid, name: String, parent_id: Option<Uuid>) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            notebook_id,
            name,
            parent_id,
            section_id: None,
            folder_type: FolderType::Standard,
            color: None,
            position: 0,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn new_archive(notebook_id: Uuid) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            notebook_id,
            name: "Archive".to_string(),
            parent_id: None,
            section_id: None,
            folder_type: FolderType::Archive,
            color: None,
            position: i32::MAX, // Always last
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notebook {
    pub id: Uuid,
    pub name: String,
    #[serde(rename = "type")]
    pub notebook_type: NotebookType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    /// Whether sections are enabled for this notebook
    #[serde(default)]
    pub sections_enabled: bool,
    /// Whether this notebook is archived (hidden from default list)
    #[serde(default)]
    pub archived: bool,
    /// Custom AI system prompt for this notebook (overrides app default)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    /// How this prompt interacts with higher-level prompts
    #[serde(default)]
    pub system_prompt_mode: SystemPromptMode,
    /// AI provider override for this notebook (e.g., "openai", "anthropic", "ollama", "lmstudio")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_provider: Option<String>,
    /// AI model override for this notebook (e.g., "gpt-4o", "claude-sonnet-4-20250514")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ai_model: Option<String>,
    /// Sync configuration for this notebook
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_config: Option<SyncConfig>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Notebook {
    pub fn new(name: String, notebook_type: NotebookType) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            notebook_type,
            icon: None,
            color: None,
            sections_enabled: false,
            archived: false,
            system_prompt: None,
            system_prompt_mode: SystemPromptMode::default(),
            ai_provider: None,
            ai_model: None,
            sync_config: None,
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct EditorBlock {
    pub id: String,
    #[serde(rename = "type")]
    pub block_type: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorData {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    pub blocks: Vec<EditorBlock>,
}

impl Default for EditorData {
    fn default() -> Self {
        Self {
            time: Some(Utc::now().timestamp_millis()),
            version: Some("2.28.0".to_string()),
            blocks: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub id: Uuid,
    pub notebook_id: Uuid,
    pub title: String,
    pub content: EditorData,
    pub tags: Vec<String>,
    /// Folder this page belongs to, None means root level
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub folder_id: Option<Uuid>,
    /// Parent page for nested pages, None means root level or direct folder child
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub parent_page_id: Option<Uuid>,
    /// Section this page belongs to (when not in a folder)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub section_id: Option<Uuid>,
    /// Whether this page is archived
    #[serde(default)]
    pub is_archived: bool,
    /// Whether this is the cover page of the notebook
    #[serde(default)]
    pub is_cover: bool,
    /// Position for ordering within folder or root
    #[serde(default)]
    pub position: i32,
    /// Custom AI system prompt for this page (overrides notebook and app defaults)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub system_prompt: Option<String>,
    /// How this prompt interacts with higher-level prompts
    #[serde(default)]
    pub system_prompt_mode: SystemPromptMode,
    /// AI model override for this page (e.g., "gpt-4o", "claude-sonnet-4-20250514")
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ai_model: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Page {
    pub fn new(notebook_id: Uuid, title: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            notebook_id,
            title,
            content: EditorData::default(),
            tags: Vec::new(),
            folder_id: None,
            parent_page_id: None,
            section_id: None,
            is_archived: false,
            is_cover: false,
            position: 0,
            system_prompt: None,
            system_prompt_mode: SystemPromptMode::default(),
            ai_model: None,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn new_in_folder(notebook_id: Uuid, title: String, folder_id: Option<Uuid>) -> Self {
        let mut page = Self::new(notebook_id, title);
        page.folder_id = folder_id;
        page
    }

    pub fn new_cover(notebook_id: Uuid) -> Self {
        let mut page = Self::new(notebook_id, "Cover".to_string());
        page.is_cover = true;
        page
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Zettel {
    #[serde(flatten)]
    pub page: Page,
    pub links: Vec<Uuid>,
    pub backlinks: Vec<Uuid>,
    pub zettel_id: String,
}

impl Zettel {
    #[allow(dead_code)]
    pub fn new(notebook_id: Uuid, title: String) -> Self {
        let now = Utc::now();
        let zettel_id = now.format("%Y%m%d%H%M%S").to_string();
        Self {
            page: Page::new(notebook_id, title),
            links: Vec::new(),
            backlinks: Vec::new(),
            zettel_id,
        }
    }
}
