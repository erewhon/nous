//! Tauri commands for goals and streak tracking

use chrono::{Duration, NaiveDate};
use tauri::State;
use uuid::Uuid;

use crate::goals::{
    CreateGoalRequest, Goal, GoalDetector, GoalProgress, GoalStats, GoalsSummary, TrackingType,
    UpdateGoalRequest,
};
use crate::AppState;

type CommandResult<T> = Result<T, String>;

/// List all goals
#[tauri::command]
pub fn list_goals(state: State<AppState>) -> CommandResult<Vec<Goal>> {
    let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
    goals.list_goals().map_err(|e| e.to_string())
}

/// List active (non-archived) goals
#[tauri::command]
pub fn list_active_goals(state: State<AppState>) -> CommandResult<Vec<Goal>> {
    let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
    goals.list_active_goals().map_err(|e| e.to_string())
}

/// Get a goal by ID
#[tauri::command]
pub fn get_goal(state: State<AppState>, id: String) -> CommandResult<Goal> {
    let goal_id = Uuid::parse_str(&id).map_err(|e| format!("Invalid goal ID: {}", e))?;
    let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
    goals.get_goal(goal_id).map_err(|e| e.to_string())
}

/// Create a new goal
#[tauri::command]
pub fn create_goal(state: State<AppState>, request: CreateGoalRequest) -> CommandResult<Goal> {
    let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
    goals.create_goal(request).map_err(|e| e.to_string())
}

/// Update an existing goal
#[tauri::command]
pub fn update_goal(
    state: State<AppState>,
    id: String,
    updates: UpdateGoalRequest,
) -> CommandResult<Goal> {
    let goal_id = Uuid::parse_str(&id).map_err(|e| format!("Invalid goal ID: {}", e))?;
    let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
    goals.update_goal(goal_id, updates).map_err(|e| e.to_string())
}

/// Archive a goal
#[tauri::command]
pub fn archive_goal(state: State<AppState>, id: String) -> CommandResult<Goal> {
    let goal_id = Uuid::parse_str(&id).map_err(|e| format!("Invalid goal ID: {}", e))?;
    let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
    goals.archive_goal(goal_id).map_err(|e| e.to_string())
}

/// Delete a goal
#[tauri::command]
pub fn delete_goal(state: State<AppState>, id: String) -> CommandResult<()> {
    let goal_id = Uuid::parse_str(&id).map_err(|e| format!("Invalid goal ID: {}", e))?;
    let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
    goals.delete_goal(goal_id).map_err(|e| e.to_string())
}

/// Get statistics for a goal
#[tauri::command]
pub fn get_goal_stats(state: State<AppState>, id: String) -> CommandResult<GoalStats> {
    let goal_id = Uuid::parse_str(&id).map_err(|e| format!("Invalid goal ID: {}", e))?;
    let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
    goals.calculate_stats(goal_id).map_err(|e| e.to_string())
}

/// Record progress for a goal
#[tauri::command]
pub fn record_goal_progress(
    state: State<AppState>,
    goal_id: String,
    date: String,
    completed: bool,
) -> CommandResult<GoalProgress> {
    let goal_id = Uuid::parse_str(&goal_id).map_err(|e| format!("Invalid goal ID: {}", e))?;
    let date =
        NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|e| format!("Invalid date: {}", e))?;

    let progress = GoalProgress::new_manual(goal_id, date, completed);
    let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
    goals.record_progress(progress).map_err(|e| e.to_string())
}

/// Get progress for a goal within a date range
/// For auto-tracked goals, this will also detect and backfill any missing progress
#[tauri::command]
pub fn get_goal_progress(
    state: State<AppState>,
    goal_id: String,
    start_date: String,
    end_date: String,
) -> CommandResult<Vec<GoalProgress>> {
    let goal_id = Uuid::parse_str(&goal_id).map_err(|e| format!("Invalid goal ID: {}", e))?;
    let start = NaiveDate::parse_from_str(&start_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid start date: {}", e))?;
    let end = NaiveDate::parse_from_str(&end_date, "%Y-%m-%d")
        .map_err(|e| format!("Invalid end date: {}", e))?;

    // Get the goal to check if it's auto-tracked
    let goal = {
        let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
        goals.get_goal(goal_id).map_err(|e| e.to_string())?
    };

    // For auto-tracked goals, detect and backfill missing progress
    if goal.tracking_type == TrackingType::Auto && goal.auto_detect.is_some() {
        let existing_progress = {
            let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
            goals
                .get_progress_range(goal_id, start, end)
                .map_err(|e| e.to_string())?
        };

        // Find dates that don't have progress entries
        let existing_dates: std::collections::HashSet<NaiveDate> =
            existing_progress.iter().map(|p| p.date).collect();

        let detector = GoalDetector::new(state.storage.clone());
        let goals_storage = state.goals_storage.lock().map_err(|e| e.to_string())?;

        // Check each date in the range
        let mut current_date = start;
        while current_date <= end {
            if !existing_dates.contains(&current_date) {
                // Detect progress for this date
                if let Ok(Some(progress)) = detector.check_goal_completion(&goal, current_date) {
                    if let Err(e) = goals_storage.record_progress(progress) {
                        log::warn!("Failed to save backfilled progress: {}", e);
                    }
                }
            }
            current_date = current_date + Duration::days(1);
        }

        // Return the updated progress
        goals_storage
            .get_progress_range(goal_id, start, end)
            .map_err(|e| e.to_string())
    } else {
        let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
        goals
            .get_progress_range(goal_id, start, end)
            .map_err(|e| e.to_string())
    }
}

/// Check auto-detected goals for today
#[tauri::command]
pub fn check_auto_goals(state: State<AppState>) -> CommandResult<Vec<GoalProgress>> {
    // Get all active goals
    let active_goals = {
        let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
        goals.list_active_goals().map_err(|e| e.to_string())?
    };

    // Create detector and check goals
    let detector = GoalDetector::new(state.storage.clone());
    let detected = detector
        .check_all_auto_goals(&active_goals)
        .map_err(|e| e.to_string())?;

    // Save detected progress
    let goals_storage = state.goals_storage.lock().map_err(|e| e.to_string())?;
    let mut saved = Vec::new();
    for progress in detected {
        match goals_storage.record_progress(progress.clone()) {
            Ok(p) => saved.push(p),
            Err(e) => log::warn!("Failed to save progress for goal {}: {}", progress.goal_id, e),
        }
    }

    Ok(saved)
}

/// Get goals summary
#[tauri::command]
pub fn get_goals_summary(state: State<AppState>) -> CommandResult<GoalsSummary> {
    let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;
    goals.get_summary().map_err(|e| e.to_string())
}

/// Toggle goal completion for today
#[tauri::command]
pub fn toggle_goal_today(state: State<AppState>, goal_id: String) -> CommandResult<GoalProgress> {
    let goal_id = Uuid::parse_str(&goal_id).map_err(|e| format!("Invalid goal ID: {}", e))?;
    let today = chrono::Utc::now().date_naive();

    let goals = state.goals_storage.lock().map_err(|e| e.to_string())?;

    // Check current progress for today
    let current_progress = goals.get_progress_range(goal_id, today, today).map_err(|e| e.to_string())?;
    let currently_completed = current_progress.first().map(|p| p.completed).unwrap_or(false);

    // Toggle the completion status
    let progress = GoalProgress::new_manual(goal_id, today, !currently_completed);
    goals.record_progress(progress).map_err(|e| e.to_string())
}
