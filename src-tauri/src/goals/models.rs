//! Goals and streak tracking data models

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Frequency of goal tracking
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Frequency {
    Daily,
    Weekly,
    Monthly,
}

/// How the goal is tracked
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum TrackingType {
    Auto,
    Manual,
}

/// Type of auto-detection
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AutoDetectType {
    GitCommit,
    JjCommit,
    PageEdit,
    PageCreate,
    YoutubePublish,
}

/// How multiple checks should be combined
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum CheckCombineMode {
    #[default]
    Any, // OR: any check passing = goal complete
    All, // AND: all checks must pass
}

/// Scope for auto-detection
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AutoDetectScope {
    /// Track across all notebooks in the current library
    Global,
    /// Track within a specific library
    Library { id: String },
    /// Track within a specific notebook
    Notebook { id: String },
    /// Track within a specific section of a notebook
    Section {
        #[serde(rename = "notebookId")]
        notebook_id: String,
        #[serde(rename = "sectionId")]
        section_id: String,
    },
}

/// Individual check configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoDetectCheck {
    /// Unique identifier for this check
    pub id: Uuid,
    /// Type of activity to detect
    #[serde(rename = "type")]
    pub detect_type: AutoDetectType,
    /// Scope of detection (for page_edit, page_create)
    pub scope: AutoDetectScope,
    /// Path to repository (for git_commit and jj_commit types) - legacy single repo
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<String>,
    /// Paths to multiple repositories (for git_commit and jj_commit types)
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repo_paths: Vec<String>,
    /// YouTube channel ID (for youtube_publish type)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub youtube_channel_id: Option<String>,
    /// Minimum count to mark as completed (default: 1)
    pub threshold: Option<u32>,
}

impl AutoDetectCheck {
    /// Get all repository paths (handles both legacy single path and multiple paths)
    pub fn get_repo_paths(&self) -> Vec<&str> {
        if !self.repo_paths.is_empty() {
            self.repo_paths.iter().map(|s| s.as_str()).collect()
        } else if let Some(ref path) = self.repo_path {
            vec![path.as_str()]
        } else {
            vec![]
        }
    }
}

/// Auto-detection configuration with support for multiple checks
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoDetectConfig {
    /// List of checks to perform (empty for legacy format)
    #[serde(default)]
    pub checks: Vec<AutoDetectCheck>,
    /// How to combine multiple checks (default: Any/OR)
    #[serde(default)]
    pub combine_mode: CheckCombineMode,

    // Legacy fields for backward compatibility during deserialization
    // These are migrated to checks on load
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub detect_type: Option<AutoDetectType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<AutoDetectScope>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub repo_paths: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub youtube_channel_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub threshold: Option<u32>,
}

impl AutoDetectConfig {
    /// Check if this config uses the legacy single-check format
    pub fn is_legacy(&self) -> bool {
        self.checks.is_empty() && self.detect_type.is_some()
    }

    /// Migrate legacy format to new checks format
    pub fn migrate_legacy(&mut self) {
        if self.is_legacy() {
            if let (Some(detect_type), Some(scope)) = (self.detect_type.take(), self.scope.take()) {
                let check = AutoDetectCheck {
                    id: Uuid::new_v4(),
                    detect_type,
                    scope,
                    repo_path: self.repo_path.take(),
                    repo_paths: std::mem::take(&mut self.repo_paths),
                    youtube_channel_id: self.youtube_channel_id.take(),
                    threshold: self.threshold.take(),
                };
                self.checks.push(check);
            }
        }
    }

    /// Create a new config with a single check (for API compatibility)
    pub fn new_single(
        detect_type: AutoDetectType,
        scope: AutoDetectScope,
        repo_paths: Vec<String>,
        youtube_channel_id: Option<String>,
        threshold: Option<u32>,
    ) -> Self {
        let check = AutoDetectCheck {
            id: Uuid::new_v4(),
            detect_type,
            scope,
            repo_path: None,
            repo_paths,
            youtube_channel_id,
            threshold,
        };
        Self {
            checks: vec![check],
            combine_mode: CheckCombineMode::Any,
            detect_type: None,
            scope: None,
            repo_path: None,
            repo_paths: Vec::new(),
            youtube_channel_id: None,
            threshold: None,
        }
    }
}

/// Reminder configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderConfig {
    /// Whether the reminder is enabled
    pub enabled: bool,
    /// Time of day for reminder (HH:MM format)
    pub time: String,
}

/// Default value for `updated_at` when deserializing goals that lack the field
fn default_updated_at() -> DateTime<Utc> {
    DateTime::<Utc>::MIN_UTC
}

/// A recurring goal to track
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    /// Unique identifier
    pub id: Uuid,
    /// Name of the goal
    pub name: String,
    /// Optional description
    pub description: Option<String>,
    /// How often to track (daily, weekly, monthly)
    pub frequency: Frequency,
    /// Whether tracked automatically or manually
    pub tracking_type: TrackingType,
    /// Auto-detection configuration (if tracking_type is Auto)
    pub auto_detect: Option<AutoDetectConfig>,
    /// Reminder settings
    pub reminder: Option<ReminderConfig>,
    /// When the goal was created
    pub created_at: DateTime<Utc>,
    /// When the goal was last updated (for sync conflict resolution)
    #[serde(default = "default_updated_at")]
    pub updated_at: DateTime<Utc>,
    /// When the goal was archived (if archived)
    pub archived_at: Option<DateTime<Utc>>,
}

impl Goal {
    /// Create a new manual goal
    pub fn new_manual(name: String, frequency: Frequency) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            description: None,
            frequency,
            tracking_type: TrackingType::Manual,
            auto_detect: None,
            reminder: None,
            created_at: now,
            updated_at: now,
            archived_at: None,
        }
    }

    /// Create a new auto-detected goal
    pub fn new_auto(name: String, frequency: Frequency, auto_detect: AutoDetectConfig) -> Self {
        let now = Utc::now();
        Self {
            id: Uuid::new_v4(),
            name,
            description: None,
            frequency,
            tracking_type: TrackingType::Auto,
            auto_detect: Some(auto_detect),
            reminder: None,
            created_at: now,
            updated_at: now,
            archived_at: None,
        }
    }

    /// Builder method to add description
    pub fn with_description(mut self, description: String) -> Self {
        self.description = Some(description);
        self
    }

    /// Builder method to add reminder
    pub fn with_reminder(mut self, time: String) -> Self {
        self.reminder = Some(ReminderConfig {
            enabled: true,
            time,
        });
        self
    }

    /// Check if the goal is archived
    pub fn is_archived(&self) -> bool {
        self.archived_at.is_some()
    }
}

/// Progress entry for a specific date
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalProgress {
    /// Goal ID this progress belongs to
    pub goal_id: Uuid,
    /// Date of progress (YYYY-MM-DD)
    pub date: NaiveDate,
    /// Whether the goal was completed
    pub completed: bool,
    /// Whether this was auto-detected
    pub auto_detected: bool,
    /// Optional value (pages edited, commits made, etc.)
    pub value: Option<u32>,
}

impl GoalProgress {
    /// Create a new manual progress entry
    pub fn new_manual(goal_id: Uuid, date: NaiveDate, completed: bool) -> Self {
        Self {
            goal_id,
            date,
            completed,
            auto_detected: false,
            value: None,
        }
    }

    /// Create a new auto-detected progress entry
    pub fn new_auto(goal_id: Uuid, date: NaiveDate, completed: bool, value: u32) -> Self {
        Self {
            goal_id,
            date,
            completed,
            auto_detected: true,
            value: Some(value),
        }
    }
}

/// Statistics for a goal
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalStats {
    /// Goal ID
    pub goal_id: Uuid,
    /// Current consecutive streak
    pub current_streak: u32,
    /// Longest ever streak
    pub longest_streak: u32,
    /// Total days/periods completed
    pub total_completed: u32,
    /// Completion rate (last 30 days), 0.0 - 1.0
    pub completion_rate: f32,
}

impl GoalStats {
    /// Create empty stats for a goal
    pub fn empty(goal_id: Uuid) -> Self {
        Self {
            goal_id,
            current_streak: 0,
            longest_streak: 0,
            total_completed: 0,
            completion_rate: 0.0,
        }
    }
}

/// Request to create a new goal
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateGoalRequest {
    pub name: String,
    pub description: Option<String>,
    pub frequency: Frequency,
    pub tracking_type: TrackingType,
    pub auto_detect: Option<AutoDetectConfig>,
    pub reminder: Option<ReminderConfig>,
}

/// Request to update an existing goal
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateGoalRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub frequency: Option<Frequency>,
    pub auto_detect: Option<AutoDetectConfig>,
    pub reminder: Option<ReminderConfig>,
}

/// Summary of all goals
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalsSummary {
    /// Total number of active goals
    pub active_goals: usize,
    /// Number of goals completed today
    pub completed_today: usize,
    /// Total current streaks across all goals
    pub total_streaks: u32,
    /// Highest current streak
    pub highest_streak: u32,
}
