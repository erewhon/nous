//! Goals storage implementation

use std::fs;
use std::path::PathBuf;

use chrono::{Datelike, Duration, Local, NaiveDate, Utc};
use uuid::Uuid;

use super::models::*;
use crate::storage::StorageError;

type Result<T> = std::result::Result<T, StorageError>;

/// Storage for goals and progress tracking
pub struct GoalsStorage {
    goals_dir: PathBuf,
    progress_dir: PathBuf,
}

impl GoalsStorage {
    /// Create a new goals storage
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        let goals_dir = data_dir.join("goals");
        let progress_dir = goals_dir.join("progress");

        fs::create_dir_all(&goals_dir)?;
        fs::create_dir_all(&progress_dir)?;

        Ok(Self {
            goals_dir,
            progress_dir,
        })
    }

    /// Get the path to the goals list file
    fn goals_file(&self) -> PathBuf {
        self.goals_dir.join("goals.json")
    }

    /// Get the path to a goal's progress file
    fn progress_file(&self, goal_id: Uuid) -> PathBuf {
        self.progress_dir.join(format!("{}.json", goal_id))
    }

    // ===== Goal CRUD Operations =====

    /// List all goals (including archived)
    pub fn list_goals(&self) -> Result<Vec<Goal>> {
        let path = self.goals_file();
        if !path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(path)?;
        let goals: Vec<Goal> = serde_json::from_str(&content)?;
        Ok(goals)
    }

    /// List active (non-archived) goals
    pub fn list_active_goals(&self) -> Result<Vec<Goal>> {
        let goals = self.list_goals()?;
        Ok(goals.into_iter().filter(|g| !g.is_archived()).collect())
    }

    /// Get a goal by ID
    pub fn get_goal(&self, id: Uuid) -> Result<Goal> {
        let goals = self.list_goals()?;
        goals
            .into_iter()
            .find(|g| g.id == id)
            .ok_or_else(|| StorageError::NotFound(format!("Goal {} not found", id)))
    }

    /// Create a new goal
    pub fn create_goal(&self, request: CreateGoalRequest) -> Result<Goal> {
        let now = Utc::now();
        let goal = Goal {
            id: Uuid::new_v4(),
            name: request.name,
            description: request.description,
            frequency: request.frequency,
            tracking_type: request.tracking_type,
            auto_detect: request.auto_detect,
            reminder: request.reminder,
            created_at: now,
            updated_at: now,
            archived_at: None,
        };

        let mut goals = self.list_goals()?;
        goals.push(goal.clone());
        self.save_goals(&goals)?;

        Ok(goal)
    }

    /// Update an existing goal
    pub fn update_goal(&self, id: Uuid, updates: UpdateGoalRequest) -> Result<Goal> {
        let mut goals = self.list_goals()?;
        let goal = goals
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| StorageError::NotFound(format!("Goal {} not found", id)))?;

        if let Some(name) = updates.name {
            goal.name = name;
        }
        if let Some(description) = updates.description {
            goal.description = Some(description);
        }
        if let Some(frequency) = updates.frequency {
            goal.frequency = frequency;
        }
        if updates.auto_detect.is_some() {
            goal.auto_detect = updates.auto_detect;
        }
        if updates.reminder.is_some() {
            goal.reminder = updates.reminder;
        }

        goal.updated_at = Utc::now();

        let updated = goal.clone();
        self.save_goals(&goals)?;

        Ok(updated)
    }

    /// Archive a goal
    pub fn archive_goal(&self, id: Uuid) -> Result<Goal> {
        let mut goals = self.list_goals()?;
        let goal = goals
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or_else(|| StorageError::NotFound(format!("Goal {} not found", id)))?;

        let now = Utc::now();
        goal.archived_at = Some(now);
        goal.updated_at = now;
        let updated = goal.clone();
        self.save_goals(&goals)?;

        Ok(updated)
    }

    /// Delete a goal and its progress
    pub fn delete_goal(&self, id: Uuid) -> Result<()> {
        let mut goals = self.list_goals()?;
        let len_before = goals.len();
        goals.retain(|g| g.id != id);

        if goals.len() == len_before {
            return Err(StorageError::NotFound(format!("Goal {} not found", id)));
        }

        self.save_goals(&goals)?;

        // Delete progress file if exists
        let progress_path = self.progress_file(id);
        if progress_path.exists() {
            fs::remove_file(progress_path)?;
        }

        Ok(())
    }

    /// Save all goals to file
    fn save_goals(&self, goals: &[Goal]) -> Result<()> {
        let json = serde_json::to_string_pretty(goals)?;
        fs::write(self.goals_file(), json)?;
        Ok(())
    }

    /// Replace the full goals list (used by sync merge)
    pub fn replace_goals(&self, goals: &[Goal]) -> Result<()> {
        self.save_goals(goals)
    }

    /// Replace progress entries for a goal (used by sync merge)
    pub fn replace_progress(&self, goal_id: Uuid, entries: &[GoalProgress]) -> Result<()> {
        self.save_progress(goal_id, entries)
    }

    // ===== Progress Operations =====

    /// Get progress entries for a goal
    pub fn get_progress(&self, goal_id: Uuid) -> Result<Vec<GoalProgress>> {
        let path = self.progress_file(goal_id);
        if !path.exists() {
            return Ok(Vec::new());
        }

        let content = fs::read_to_string(path)?;
        let progress: Vec<GoalProgress> = serde_json::from_str(&content)?;
        Ok(progress)
    }

    /// Get progress for a date range
    pub fn get_progress_range(
        &self,
        goal_id: Uuid,
        start_date: NaiveDate,
        end_date: NaiveDate,
    ) -> Result<Vec<GoalProgress>> {
        let progress = self.get_progress(goal_id)?;
        Ok(progress
            .into_iter()
            .filter(|p| p.date >= start_date && p.date <= end_date)
            .collect())
    }

    /// Record progress for a goal
    pub fn record_progress(&self, progress: GoalProgress) -> Result<GoalProgress> {
        // Verify goal exists
        self.get_goal(progress.goal_id)?;

        let mut entries = self.get_progress(progress.goal_id)?;

        // Remove existing entry for this date if any
        entries.retain(|p| p.date != progress.date);

        // Add new entry
        entries.push(progress.clone());

        // Sort by date
        entries.sort_by(|a, b| a.date.cmp(&b.date));

        self.save_progress(progress.goal_id, &entries)?;
        Ok(progress)
    }

    /// Delete progress for a specific date
    pub fn delete_progress(&self, goal_id: Uuid, date: NaiveDate) -> Result<()> {
        let mut entries = self.get_progress(goal_id)?;
        entries.retain(|p| p.date != date);
        self.save_progress(goal_id, &entries)?;
        Ok(())
    }

    /// Save progress entries to file
    fn save_progress(&self, goal_id: Uuid, entries: &[GoalProgress]) -> Result<()> {
        let json = serde_json::to_string_pretty(entries)?;
        fs::write(self.progress_file(goal_id), json)?;
        Ok(())
    }

    // ===== Statistics =====

    /// Calculate statistics for a goal
    pub fn calculate_stats(&self, goal_id: Uuid) -> Result<GoalStats> {
        let goal = self.get_goal(goal_id)?;
        let progress = self.get_progress(goal_id)?;

        if progress.is_empty() {
            return Ok(GoalStats::empty(goal_id));
        }

        let today = Local::now().date_naive();

        // Calculate current streak
        let current_streak = self.calculate_current_streak(&goal, &progress, today);

        // Calculate longest streak
        let longest_streak = self.calculate_longest_streak(&goal, &progress);

        // Calculate total completed
        let total_completed = progress.iter().filter(|p| p.completed).count() as u32;

        // Calculate completion rate (last 30 days)
        let thirty_days_ago = today - Duration::days(30);
        let recent_progress: Vec<_> = progress
            .iter()
            .filter(|p| p.date >= thirty_days_ago && p.date <= today)
            .collect();

        let days_tracked = match goal.frequency {
            Frequency::Daily => 30,
            Frequency::Weekly => 4,
            Frequency::Monthly => 1,
        };

        let completed_count = recent_progress.iter().filter(|p| p.completed).count();
        let completion_rate = if days_tracked > 0 {
            (completed_count as f32) / (days_tracked as f32)
        } else {
            0.0
        };

        Ok(GoalStats {
            goal_id,
            current_streak,
            longest_streak,
            total_completed,
            completion_rate: completion_rate.min(1.0),
        })
    }

    /// Calculate current streak
    fn calculate_current_streak(
        &self,
        goal: &Goal,
        progress: &[GoalProgress],
        today: NaiveDate,
    ) -> u32 {
        let completed_dates: Vec<NaiveDate> = progress
            .iter()
            .filter(|p| p.completed)
            .map(|p| p.date)
            .collect();

        if completed_dates.is_empty() {
            return 0;
        }

        let mut streak = 0;
        let mut check_date = today;

        // For daily goals, check if today or yesterday was completed
        // (allow checking today even if not yet marked)
        match goal.frequency {
            Frequency::Daily => {
                // First check if today is completed
                if completed_dates.contains(&check_date) {
                    streak = 1;
                    check_date = check_date - Duration::days(1);
                } else {
                    // Check yesterday (today might not be over yet)
                    check_date = check_date - Duration::days(1);
                    if !completed_dates.contains(&check_date) {
                        return 0;
                    }
                    streak = 1;
                    check_date = check_date - Duration::days(1);
                }

                // Count consecutive days backwards
                while completed_dates.contains(&check_date) {
                    streak += 1;
                    check_date = check_date - Duration::days(1);
                }
            }
            Frequency::Weekly => {
                // Simplified: count consecutive weeks with at least one completion
                // Implementation would check week boundaries
                let mut weeks_back = 0;
                loop {
                    let week_start = today - Duration::days(today.weekday().num_days_from_monday() as i64)
                        - Duration::weeks(weeks_back);
                    let week_end = week_start + Duration::days(6);

                    let has_completion = completed_dates
                        .iter()
                        .any(|d| *d >= week_start && *d <= week_end);

                    if has_completion {
                        streak += 1;
                        weeks_back += 1;
                    } else if weeks_back == 0 {
                        // Current week not done yet, check previous
                        weeks_back += 1;
                    } else {
                        break;
                    }

                    if weeks_back > 52 {
                        break; // Safety limit
                    }
                }
            }
            Frequency::Monthly => {
                // Count consecutive months with completion
                let mut months_back = 0;
                loop {
                    let check_month = today.month() as i32 - months_back;
                    let check_year = today.year() + (check_month - 1).div_euclid(12);
                    let check_month = ((check_month - 1).rem_euclid(12) + 1) as u32;

                    let has_completion = completed_dates
                        .iter()
                        .any(|d| d.year() == check_year && d.month() == check_month);

                    if has_completion {
                        streak += 1;
                        months_back += 1;
                    } else if months_back == 0 {
                        months_back += 1;
                    } else {
                        break;
                    }

                    if months_back > 12 {
                        break;
                    }
                }
            }
        }

        streak
    }

    /// Calculate longest streak
    fn calculate_longest_streak(&self, goal: &Goal, progress: &[GoalProgress]) -> u32 {
        let mut completed_dates: Vec<NaiveDate> = progress
            .iter()
            .filter(|p| p.completed)
            .map(|p| p.date)
            .collect();

        if completed_dates.is_empty() {
            return 0;
        }

        completed_dates.sort();

        let mut longest = 0;
        let mut current = 1;

        match goal.frequency {
            Frequency::Daily => {
                for i in 1..completed_dates.len() {
                    let diff = completed_dates[i] - completed_dates[i - 1];
                    if diff == Duration::days(1) {
                        current += 1;
                    } else {
                        longest = longest.max(current);
                        current = 1;
                    }
                }
            }
            Frequency::Weekly => {
                // Simplified: count consecutive weeks
                for i in 1..completed_dates.len() {
                    let diff = completed_dates[i] - completed_dates[i - 1];
                    if diff <= Duration::days(7) {
                        current += 1;
                    } else {
                        longest = longest.max(current);
                        current = 1;
                    }
                }
            }
            Frequency::Monthly => {
                // Count consecutive months
                for i in 1..completed_dates.len() {
                    let prev = completed_dates[i - 1];
                    let curr = completed_dates[i];
                    let month_diff = (curr.year() - prev.year()) * 12
                        + (curr.month() as i32 - prev.month() as i32);
                    if month_diff == 1 {
                        current += 1;
                    } else {
                        longest = longest.max(current);
                        current = 1;
                    }
                }
            }
        }

        longest.max(current)
    }

    /// Get summary of all goals
    pub fn get_summary(&self) -> Result<GoalsSummary> {
        let goals = self.list_active_goals()?;
        let today = Local::now().date_naive();

        let active_goals = goals.len();
        let mut completed_today = 0;
        let mut total_streaks = 0;
        let mut highest_streak = 0;

        for goal in &goals {
            let progress = self.get_progress(goal.id)?;
            let today_progress = progress.iter().find(|p| p.date == today);

            if today_progress.map(|p| p.completed).unwrap_or(false) {
                completed_today += 1;
            }

            let stats = self.calculate_stats(goal.id)?;
            total_streaks += stats.current_streak;
            highest_streak = highest_streak.max(stats.current_streak);
        }

        Ok(GoalsSummary {
            active_goals,
            completed_today,
            total_streaks,
            highest_streak,
        })
    }
}
