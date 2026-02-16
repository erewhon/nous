//! Energy and focus tracking data models

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A tracked habit entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitEntry {
    pub name: String,
    pub checked: bool,
}

/// Focus capacity types
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum FocusCapacity {
    DeepWork,
    LightWork,
    Physical,
    Creative,
}

/// An energy check-in for a specific day
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnergyCheckIn {
    /// Unique identifier
    pub id: Uuid,
    /// Date of check-in (YYYY-MM-DD), unique key
    pub date: NaiveDate,
    /// Energy level 1-5 (optional — user might set only mood)
    #[serde(default)]
    pub energy_level: Option<u8>,
    /// Mood level 1-5
    #[serde(default)]
    pub mood: Option<u8>,
    /// Focus capacities (multiple allowed)
    pub focus_capacity: Vec<FocusCapacity>,
    /// Tracked habits for the day
    #[serde(default)]
    pub habits: Vec<HabitEntry>,
    /// Sleep quality 1-4, optional
    pub sleep_quality: Option<u8>,
    /// Optional notes
    pub notes: Option<String>,
    /// When the check-in was created
    pub created_at: DateTime<Utc>,
    /// When the check-in was last updated
    pub updated_at: DateTime<Utc>,
}

/// Request to create a new check-in
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckInRequest {
    /// Date of check-in (YYYY-MM-DD)
    pub date: String,
    /// Energy level 1-5 (optional)
    pub energy_level: Option<u8>,
    /// Mood level 1-5
    #[serde(default)]
    pub mood: Option<u8>,
    /// Focus capacities
    pub focus_capacity: Vec<FocusCapacity>,
    /// Tracked habits
    #[serde(default)]
    pub habits: Vec<HabitEntry>,
    /// Sleep quality 1-4
    pub sleep_quality: Option<u8>,
    /// Optional notes
    pub notes: Option<String>,
}

/// Request to update an existing check-in
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckInRequest {
    /// Energy level 1-5
    pub energy_level: Option<u8>,
    /// Mood level 1-5
    pub mood: Option<u8>,
    /// Focus capacities
    pub focus_capacity: Option<Vec<FocusCapacity>>,
    /// Tracked habits
    pub habits: Option<Vec<HabitEntry>>,
    /// Sleep quality 1-4
    pub sleep_quality: Option<u8>,
    /// Optional notes
    pub notes: Option<String>,
}

/// Computed energy patterns (not stored)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnergyPattern {
    /// Average energy by day of week ("monday" -> 3.2)
    pub day_of_week_averages: HashMap<String, f32>,
    /// Average mood by day of week
    pub mood_day_of_week_averages: HashMap<String, f32>,
    /// Consecutive days with check-ins
    pub current_streak: u32,
    /// Days of week averaging < 2.5
    pub typical_low_days: Vec<String>,
    /// Days of week averaging >= 4.0
    pub typical_high_days: Vec<String>,
}
