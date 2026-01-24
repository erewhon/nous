//! Auto-detection for goal progress

use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};

use chrono::{NaiveDate, TimeZone, Utc};
use git2::Repository;
use uuid::Uuid;

use super::models::*;
use crate::storage::{FileStorage, StorageError};

type Result<T> = std::result::Result<T, StorageError>;

/// Detector for automatic goal progress tracking
pub struct GoalDetector {
    storage: Arc<Mutex<FileStorage>>,
}

impl GoalDetector {
    /// Create a new goal detector
    pub fn new(storage: Arc<Mutex<FileStorage>>) -> Self {
        Self { storage }
    }

    /// Check if a goal is completed for the given date
    pub fn check_goal_completion(&self, goal: &Goal, date: NaiveDate) -> Result<Option<GoalProgress>> {
        let Some(ref auto_detect) = goal.auto_detect else {
            return Ok(None);
        };

        let threshold = auto_detect.threshold.unwrap_or(1);

        let value = match auto_detect.detect_type {
            AutoDetectType::GitCommit => {
                let repo_paths = auto_detect.get_repo_paths();
                if repo_paths.is_empty() {
                    return Ok(None);
                }
                self.detect_git_commits_multi(&repo_paths, date)?
            }
            AutoDetectType::JjCommit => {
                let repo_paths = auto_detect.get_repo_paths();
                if repo_paths.is_empty() {
                    return Ok(None);
                }
                self.detect_jj_commits_multi(&repo_paths, date)?
            }
            AutoDetectType::PageEdit => {
                let (_, count) = self.detect_page_edits(&auto_detect.scope, date)?;
                count
            }
            AutoDetectType::PageCreate => {
                let (_, count) = self.detect_page_creates(&auto_detect.scope, date)?;
                count
            }
        };

        let completed = value >= threshold;

        Ok(Some(GoalProgress::new_auto(goal.id, date, completed, value)))
    }

    /// Detect git commits across multiple repositories on a given date
    fn detect_git_commits_multi(&self, repo_paths: &[&str], date: NaiveDate) -> Result<u32> {
        let mut total_count = 0;
        for repo_path in repo_paths {
            match self.detect_git_commits_single(repo_path, date) {
                Ok((_, count)) => total_count += count,
                Err(e) => {
                    log::warn!("Failed to detect git commits in {}: {}", repo_path, e);
                    // Continue with other repos even if one fails
                }
            }
        }
        Ok(total_count)
    }

    /// Detect git commits in a single repository on a given date
    fn detect_git_commits_single(&self, repo_path: &str, date: NaiveDate) -> Result<(bool, u32)> {
        let path = Path::new(repo_path);
        if !path.exists() {
            return Err(StorageError::NotFound(format!(
                "Repository path not found: {}",
                repo_path
            )));
        }

        let repo = Repository::open(path).map_err(|e| {
            StorageError::InvalidOperation(format!("Failed to open git repository: {}", e))
        })?;

        // Get the HEAD reference
        let head = match repo.head() {
            Ok(h) => h,
            Err(_) => return Ok((false, 0)), // Empty repository
        };

        let mut revwalk = repo.revwalk().map_err(|e| {
            StorageError::InvalidOperation(format!("Failed to create revwalk: {}", e))
        })?;

        revwalk.push_head().map_err(|e| {
            StorageError::InvalidOperation(format!("Failed to push head: {}", e))
        })?;

        // Count commits on the given date
        let date_start = Utc
            .from_utc_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
            .timestamp();
        let date_end = Utc
            .from_utc_datetime(&date.and_hms_opt(23, 59, 59).unwrap())
            .timestamp();

        let mut count = 0;

        for oid in revwalk {
            let oid = match oid {
                Ok(o) => o,
                Err(_) => continue,
            };

            let commit = match repo.find_commit(oid) {
                Ok(c) => c,
                Err(_) => continue,
            };

            let commit_time = commit.time().seconds();

            // Stop if we've gone past the date
            if commit_time < date_start {
                break;
            }

            if commit_time >= date_start && commit_time <= date_end {
                count += 1;
            }
        }

        Ok((count > 0, count))
    }

    /// Detect Jujutsu (jj) commits across multiple repositories on a given date
    fn detect_jj_commits_multi(&self, repo_paths: &[&str], date: NaiveDate) -> Result<u32> {
        let mut total_count = 0;
        for repo_path in repo_paths {
            match self.detect_jj_commits_single(repo_path, date) {
                Ok((_, count)) => total_count += count,
                Err(e) => {
                    log::warn!("Failed to detect jj commits in {}: {}", repo_path, e);
                    // Continue with other repos even if one fails
                }
            }
        }
        Ok(total_count)
    }

    /// Detect Jujutsu (jj) commits in a single repository on a given date
    fn detect_jj_commits_single(&self, repo_path: &str, date: NaiveDate) -> Result<(bool, u32)> {
        let path = Path::new(repo_path);
        if !path.exists() {
            return Err(StorageError::NotFound(format!(
                "Repository path not found: {}",
                repo_path
            )));
        }

        // Format the date for jj log filtering
        // jj uses revsets, we can filter by author_date()
        let date_str = date.format("%Y-%m-%d").to_string();
        let next_date = date.succ_opt().unwrap_or(date);
        let next_date_str = next_date.format("%Y-%m-%d").to_string();

        // Use jj log with a revset to filter commits by date
        // The revset filters commits where author_date is on the given date
        // We use --no-pager and count the output lines
        let output = Command::new("jj")
            .args([
                "log",
                "--no-pager",
                "-r",
                &format!(
                    "author_date(after:\"{}\") & author_date(before:\"{}\")",
                    date_str, next_date_str
                ),
                "--template",
                "commit_id ++ \"\\n\"",
            ])
            .current_dir(path)
            .output();

        match output {
            Ok(output) => {
                if !output.status.success() {
                    // jj command failed, might not be a jj repo
                    log::warn!(
                        "jj log failed in {}: {}",
                        repo_path,
                        String::from_utf8_lossy(&output.stderr)
                    );
                    return Ok((false, 0));
                }

                let stdout = String::from_utf8_lossy(&output.stdout);
                let count = stdout.lines().filter(|l| !l.trim().is_empty()).count() as u32;

                Ok((count > 0, count))
            }
            Err(e) => {
                // jj might not be installed
                log::warn!("Failed to run jj command: {}", e);
                Ok((false, 0))
            }
        }
    }

    /// Detect page edits on a given date
    fn detect_page_edits(&self, scope: &AutoDetectScope, date: NaiveDate) -> Result<(bool, u32)> {
        let storage = self.storage.lock().map_err(|e| {
            StorageError::InvalidOperation(format!("Failed to lock storage: {}", e))
        })?;

        let date_start = Utc.from_utc_datetime(&date.and_hms_opt(0, 0, 0).unwrap());
        let date_end = Utc.from_utc_datetime(&date.and_hms_opt(23, 59, 59).unwrap());

        let mut count = 0;

        match scope {
            AutoDetectScope::Section { notebook_id, section_id } => {
                // Filter pages by section
                let notebook_uuid = Uuid::parse_str(notebook_id).map_err(|e| {
                    StorageError::InvalidOperation(format!("Invalid notebook ID: {}", e))
                })?;
                let section_uuid = Uuid::parse_str(section_id).map_err(|e| {
                    StorageError::InvalidOperation(format!("Invalid section ID: {}", e))
                })?;
                let pages = storage.list_pages(notebook_uuid)?;
                for page in pages {
                    if page.section_id == Some(section_uuid)
                        && page.updated_at >= date_start
                        && page.updated_at <= date_end
                    {
                        count += 1;
                    }
                }
            }
            _ => {
                // Handle other scopes (global, library, notebook)
                let notebooks = match scope {
                    AutoDetectScope::Global => storage.list_notebooks()?,
                    AutoDetectScope::Library { id: _ } => {
                        // For now, treat library scope same as global
                        // In the future, this could filter by library
                        storage.list_notebooks()?
                    }
                    AutoDetectScope::Notebook { id } => {
                        let notebook_id = Uuid::parse_str(id).map_err(|e| {
                            StorageError::InvalidOperation(format!("Invalid notebook ID: {}", e))
                        })?;
                        vec![storage.get_notebook(notebook_id)?]
                    }
                    AutoDetectScope::Section { .. } => unreachable!(),
                };

                for notebook in notebooks {
                    let pages = storage.list_pages(notebook.id)?;
                    for page in pages {
                        if page.updated_at >= date_start && page.updated_at <= date_end {
                            count += 1;
                        }
                    }
                }
            }
        }

        Ok((count > 0, count))
    }

    /// Detect page creates on a given date
    fn detect_page_creates(&self, scope: &AutoDetectScope, date: NaiveDate) -> Result<(bool, u32)> {
        let storage = self.storage.lock().map_err(|e| {
            StorageError::InvalidOperation(format!("Failed to lock storage: {}", e))
        })?;

        let date_start = Utc.from_utc_datetime(&date.and_hms_opt(0, 0, 0).unwrap());
        let date_end = Utc.from_utc_datetime(&date.and_hms_opt(23, 59, 59).unwrap());

        let mut count = 0;

        match scope {
            AutoDetectScope::Section { notebook_id, section_id } => {
                // Filter pages by section
                let notebook_uuid = Uuid::parse_str(notebook_id).map_err(|e| {
                    StorageError::InvalidOperation(format!("Invalid notebook ID: {}", e))
                })?;
                let section_uuid = Uuid::parse_str(section_id).map_err(|e| {
                    StorageError::InvalidOperation(format!("Invalid section ID: {}", e))
                })?;
                let pages = storage.list_pages(notebook_uuid)?;
                for page in pages {
                    if page.section_id == Some(section_uuid)
                        && page.created_at >= date_start
                        && page.created_at <= date_end
                    {
                        count += 1;
                    }
                }
            }
            _ => {
                // Handle other scopes (global, library, notebook)
                let notebooks = match scope {
                    AutoDetectScope::Global => storage.list_notebooks()?,
                    AutoDetectScope::Library { id: _ } => {
                        storage.list_notebooks()?
                    }
                    AutoDetectScope::Notebook { id } => {
                        let notebook_id = Uuid::parse_str(id).map_err(|e| {
                            StorageError::InvalidOperation(format!("Invalid notebook ID: {}", e))
                        })?;
                        vec![storage.get_notebook(notebook_id)?]
                    }
                    AutoDetectScope::Section { .. } => unreachable!(),
                };

                for notebook in notebooks {
                    let pages = storage.list_pages(notebook.id)?;
                    for page in pages {
                        if page.created_at >= date_start && page.created_at <= date_end {
                            count += 1;
                        }
                    }
                }
            }
        }

        Ok((count > 0, count))
    }

    /// Check all auto-detected goals for today
    pub fn check_all_auto_goals(
        &self,
        goals: &[Goal],
    ) -> Result<Vec<GoalProgress>> {
        let today = Utc::now().date_naive();
        let mut results = Vec::new();

        for goal in goals {
            if goal.tracking_type != TrackingType::Auto || goal.is_archived() {
                continue;
            }

            if let Some(progress) = self.check_goal_completion(goal, today)? {
                results.push(progress);
            }
        }

        Ok(results)
    }
}
