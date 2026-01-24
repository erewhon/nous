//! Inbox data models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An item in the inbox awaiting classification
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxItem {
    /// Unique identifier
    pub id: Uuid,
    /// Title/subject of the captured note
    pub title: String,
    /// Content of the note (plain text or markdown)
    pub content: String,
    /// Optional tags added during capture
    pub tags: Vec<String>,
    /// When the item was captured
    pub captured_at: DateTime<Utc>,
    /// Source of capture (hotkey, button, api, etc.)
    pub source: CaptureSource,
    /// AI classification result (if classified)
    pub classification: Option<InboxClassification>,
    /// Whether this item has been processed
    pub is_processed: bool,
}

impl InboxItem {
    pub fn new(title: String, content: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            title,
            content,
            tags: Vec::new(),
            captured_at: Utc::now(),
            source: CaptureSource::QuickCapture,
            classification: None,
            is_processed: false,
        }
    }

    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }

    pub fn with_source(mut self, source: CaptureSource) -> Self {
        self.source = source;
        self
    }
}

/// How the inbox item was captured
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CaptureSource {
    /// Captured via quick capture dialog
    QuickCapture,
    /// Captured via web clipper
    WebClipper { url: String },
    /// Captured from email
    Email { from: String },
    /// Captured via API
    Api { source: String },
    /// Imported from another format
    Import { format: String },
}

/// AI classification result for an inbox item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxClassification {
    /// Suggested action type
    pub action: ClassificationAction,
    /// Confidence score (0.0 - 1.0)
    pub confidence: f32,
    /// Reasoning for the classification
    pub reasoning: String,
    /// When classification was performed
    pub classified_at: DateTime<Utc>,
}

/// Suggested action for an inbox item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
pub enum ClassificationAction {
    /// Create a new page in a notebook
    #[serde(rename_all = "camelCase")]
    CreatePage {
        notebook_id: Uuid,
        notebook_name: String,
        suggested_title: String,
        suggested_tags: Vec<String>,
    },
    /// Append to an existing page
    #[serde(rename_all = "camelCase")]
    AppendToPage {
        notebook_id: Uuid,
        notebook_name: String,
        page_id: Uuid,
        page_title: String,
    },
    /// Create a new notebook for this content
    #[serde(rename_all = "camelCase")]
    CreateNotebook {
        suggested_name: String,
        suggested_icon: Option<String>,
    },
    /// Keep in inbox (unclear classification)
    KeepInInbox {
        reason: String,
    },
}

/// Request to capture a new inbox item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRequest {
    pub title: String,
    pub content: String,
    pub tags: Option<Vec<String>>,
    pub source: Option<CaptureSource>,
    /// Whether to auto-classify after capture
    pub auto_classify: Option<bool>,
}

/// Request to apply classification actions to inbox items
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyActionsRequest {
    /// List of inbox item IDs to process
    pub item_ids: Vec<Uuid>,
    /// Optional overrides for specific items
    pub overrides: Option<Vec<ActionOverride>>,
}

/// Override the AI-suggested action for a specific item
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionOverride {
    pub item_id: Uuid,
    pub action: ClassificationAction,
}

/// Result of applying actions to inbox items
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyActionsResult {
    pub processed_count: usize,
    pub created_pages: Vec<Uuid>,
    pub updated_pages: Vec<Uuid>,
    pub created_notebooks: Vec<Uuid>,
    pub errors: Vec<String>,
}

/// Summary of inbox state
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InboxSummary {
    pub total_items: usize,
    pub unclassified_count: usize,
    pub classified_count: usize,
    pub processed_count: usize,
}
