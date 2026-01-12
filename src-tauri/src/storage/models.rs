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
            created_at: now,
            updated_at: now,
        }
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
