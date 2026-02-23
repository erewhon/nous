//! Monitor data models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// How to capture data from a monitored app
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum CaptureMethod {
    AiVision,
    Accessibility,
    Both,
}

/// Category of the monitored application
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum AppCategory {
    Chat,
    Email,
    Notifications,
    Browser,
    Custom,
}

/// Configuration for a monitored application
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorTarget {
    pub id: Uuid,
    pub name: String,
    /// Window title pattern for matching (substring match)
    pub window_match: String,
    pub category: AppCategory,
    pub capture_method: CaptureMethod,
    /// How often to capture (in seconds)
    pub interval_secs: u64,
    pub enabled: bool,
    /// Custom instructions for the AI vision analysis
    pub watch_instructions: Option<String>,
    /// Whether to automatically send captures to the inbox
    pub send_to_inbox: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl MonitorTarget {
    pub fn new(name: String, window_match: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            window_match,
            category: AppCategory::Custom,
            capture_method: CaptureMethod::AiVision,
            interval_secs: 60,
            enabled: true,
            watch_instructions: None,
            send_to_inbox: false,
            created_at: now,
            updated_at: now,
        }
    }
}

/// A single structured item extracted from a capture
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedItem {
    pub item_type: String,
    pub sender: Option<String>,
    pub subject: Option<String>,
    pub content: String,
    pub timestamp: Option<String>,
    pub urgency: Option<String>,
}

/// Result of a single capture event
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureEvent {
    pub id: Uuid,
    pub target_id: Uuid,
    pub target_name: String,
    pub captured_at: DateTime<Utc>,
    pub capture_method: CaptureMethod,
    /// Raw content/summary from the capture
    pub content: String,
    /// Structured items extracted from the capture
    pub items: Vec<CapturedItem>,
    /// Path to the screenshot (if AI vision was used)
    pub screenshot_path: Option<String>,
    pub is_read: bool,
    pub sent_to_inbox: bool,
}

impl CaptureEvent {
    pub fn new(target_id: Uuid, target_name: String, capture_method: CaptureMethod) -> Self {
        Self {
            id: Uuid::new_v4(),
            target_id,
            target_name,
            captured_at: Utc::now(),
            capture_method,
            content: String::new(),
            items: Vec::new(),
            screenshot_path: None,
            is_read: false,
            sent_to_inbox: false,
        }
    }
}

/// Request to create a new monitor target
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTargetRequest {
    pub name: String,
    pub window_match: String,
    pub category: Option<AppCategory>,
    pub capture_method: Option<CaptureMethod>,
    pub interval_secs: Option<u64>,
    pub watch_instructions: Option<String>,
    pub send_to_inbox: Option<bool>,
}

/// Request to update a monitor target
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTargetRequest {
    pub name: Option<String>,
    pub window_match: Option<String>,
    pub category: Option<AppCategory>,
    pub capture_method: Option<CaptureMethod>,
    pub interval_secs: Option<u64>,
    pub enabled: Option<bool>,
    pub watch_instructions: Option<String>,
    pub send_to_inbox: Option<bool>,
}

/// Info about a discovered window
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub window_id: String,
    pub title: String,
    pub class_name: Option<String>,
}
