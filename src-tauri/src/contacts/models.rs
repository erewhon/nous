//! Contact and activity data models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Type of contact activity
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub enum ActivityType {
    Message,
    Call,
    FaceTimeAudio,
    FaceTimeVideo,
    MissedCall,
}

/// Direction of communication
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Incoming,
    Outgoing,
}

/// A contact in the personal CRM
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub id: Uuid,
    pub name: String,
    #[serde(default)]
    pub phone_numbers: Vec<String>,
    #[serde(default)]
    pub emails: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    pub last_contacted: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

impl Contact {
    pub fn new(name: String) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            phone_numbers: Vec::new(),
            emails: Vec::new(),
            tags: Vec::new(),
            notes: String::new(),
            last_contacted: None,
            created_at: now,
            updated_at: now,
        }
    }
}

/// A communication activity associated with a contact
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactActivity {
    pub id: Uuid,
    pub contact_id: Uuid,
    pub activity_type: ActivityType,
    pub direction: Direction,
    pub timestamp: DateTime<Utc>,
    pub preview: Option<String>,
    pub duration_seconds: Option<u64>,
}

/// State for incremental harvesting
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HarvestState {
    pub last_message_timestamp: Option<i64>,
    pub last_call_timestamp: Option<i64>,
    pub last_contact_timestamp: Option<i64>,
}

/// Result of a harvest operation
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HarvestResult {
    pub contacts_added: usize,
    pub contacts_updated: usize,
    pub activities_added: usize,
}

/// Request to update a contact
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateContactRequest {
    pub name: Option<String>,
    pub phone_numbers: Option<Vec<String>>,
    pub emails: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub notes: Option<String>,
}

/// Normalize a phone number: strip non-digits, remove leading "1" if 11 digits
pub fn normalize_phone(raw: &str) -> String {
    let digits: String = raw.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.len() == 11 && digits.starts_with('1') {
        digits[1..].to_string()
    } else {
        digits
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_phone() {
        assert_eq!(normalize_phone("+1 (555) 123-4567"), "5551234567");
        assert_eq!(normalize_phone("15551234567"), "5551234567");
        assert_eq!(normalize_phone("555-123-4567"), "5551234567");
        assert_eq!(normalize_phone("5551234567"), "5551234567");
        // Non-US numbers stay as-is
        assert_eq!(normalize_phone("+44 20 7946 0958"), "442079460958");
    }
}
