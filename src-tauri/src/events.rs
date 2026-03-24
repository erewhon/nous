//! Application-wide event system.
//!
//! Events emitted by the executor, storage operations, and other subsystems.
//! Consumed by the daemon's WebSocket endpoint and any future event listeners.

use serde::{Deserialize, Serialize};

/// An application event that can be broadcast to listeners.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppEvent {
    pub event: String,
    pub data: serde_json::Value,
}

impl AppEvent {
    pub fn new(event: impl Into<String>, data: serde_json::Value) -> Self {
        Self {
            event: event.into(),
            data,
        }
    }

    pub fn page_created(notebook_id: &str, page_id: &str, title: &str) -> Self {
        Self::new("page.created", serde_json::json!({
            "notebookId": notebook_id,
            "pageId": page_id,
            "title": title,
        }))
    }

    pub fn page_updated(notebook_id: &str, page_id: &str, title: &str) -> Self {
        Self::new("page.updated", serde_json::json!({
            "notebookId": notebook_id,
            "pageId": page_id,
            "title": title,
        }))
    }

    pub fn page_deleted(notebook_id: &str, page_id: &str, title: &str) -> Self {
        Self::new("page.deleted", serde_json::json!({
            "notebookId": notebook_id,
            "pageId": page_id,
            "title": title,
        }))
    }

    pub fn inbox_captured(item_id: &str, title: &str) -> Self {
        Self::new("inbox.captured", serde_json::json!({
            "itemId": item_id,
            "title": title,
        }))
    }

    pub fn action_completed(action_name: &str, created: &[String], modified: &[String]) -> Self {
        Self::new("action.completed", serde_json::json!({
            "actionName": action_name,
            "pagesCreated": created,
            "pagesModified": modified,
        }))
    }
}

/// Type alias for the event broadcast sender.
pub type EventSender = tokio::sync::broadcast::Sender<AppEvent>;
