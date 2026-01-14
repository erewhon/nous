use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

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
    /// Type of folder (standard or archive)
    #[serde(default)]
    pub folder_type: FolderType,
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
            folder_type: FolderType::Standard,
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
            folder_type: FolderType::Archive,
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
    /// Custom AI system prompt for this notebook (overrides app default)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
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
            system_prompt: None,
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
    /// Whether this page is archived
    #[serde(default)]
    pub is_archived: bool,
    /// Position for ordering within folder or root
    #[serde(default)]
    pub position: i32,
    /// Custom AI system prompt for this page (overrides notebook and app defaults)
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub system_prompt: Option<String>,
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
            is_archived: false,
            position: 0,
            system_prompt: None,
            created_at: now,
            updated_at: now,
        }
    }

    pub fn new_in_folder(notebook_id: Uuid, title: String, folder_id: Option<Uuid>) -> Self {
        let mut page = Self::new(notebook_id, title);
        page.folder_id = folder_id;
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
