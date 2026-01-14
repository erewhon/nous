//! Git Commands
//!
//! Tauri commands for Git operations on notebooks.

use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::git::{self, CommitInfo, GitStatus};
use crate::AppState;

/// Error type for git commands
#[derive(Debug, Serialize)]
pub struct GitCommandError {
    message: String,
}

impl GitCommandError {
    pub fn new(message: &str) -> Self {
        Self {
            message: message.to_string(),
        }
    }
}

impl From<git::GitOperationError> for GitCommandError {
    fn from(e: git::GitOperationError) -> Self {
        Self {
            message: e.to_string(),
        }
    }
}

type CommandResult<T> = Result<T, GitCommandError>;

/// Get the notebook directory path
fn get_notebook_path(state: &State<AppState>, notebook_id: &str) -> CommandResult<std::path::PathBuf> {
    let uuid = Uuid::parse_str(notebook_id)
        .map_err(|_| GitCommandError::new(&format!("Invalid notebook ID: {}", notebook_id)))?;

    let storage = state
        .storage
        .lock()
        .map_err(|e| GitCommandError::new(&format!("Failed to lock storage: {}", e)))?;

    Ok(storage.get_notebook_path(uuid))
}

/// Check if a notebook has Git enabled
#[tauri::command]
pub fn git_is_enabled(state: State<AppState>, notebook_id: String) -> CommandResult<bool> {
    let path = get_notebook_path(&state, &notebook_id)?;
    Ok(git::is_git_repo(&path))
}

/// Initialize Git for a notebook
#[tauri::command]
pub fn git_init(state: State<AppState>, notebook_id: String) -> CommandResult<()> {
    let path = get_notebook_path(&state, &notebook_id)?;

    if git::is_git_repo(&path) {
        return Err(GitCommandError::new("Git is already initialized for this notebook"));
    }

    git::init_repo(&path)?;

    // Create initial commit with existing content
    git::commit_all(&path, "Initial commit: notebook created")?;

    Ok(())
}

/// Get Git status for a notebook
#[tauri::command]
pub fn git_status(state: State<AppState>, notebook_id: String) -> CommandResult<GitStatus> {
    let path = get_notebook_path(&state, &notebook_id)?;
    git::get_status(&path).map_err(Into::into)
}

/// Commit all changes in a notebook
#[tauri::command]
pub fn git_commit(
    state: State<AppState>,
    notebook_id: String,
    message: String,
) -> CommandResult<CommitInfo> {
    let path = get_notebook_path(&state, &notebook_id)?;
    git::commit_all(&path, &message).map_err(Into::into)
}

/// Get commit history for a notebook or specific page
#[tauri::command]
pub fn git_history(
    state: State<AppState>,
    notebook_id: String,
    page_id: Option<String>,
    limit: Option<usize>,
) -> CommandResult<Vec<CommitInfo>> {
    let path = get_notebook_path(&state, &notebook_id)?;

    let file_path = page_id.map(|id| format!("pages/{}.json", id));
    let limit = limit.unwrap_or(50);

    git::get_history(&path, file_path.as_deref(), limit).map_err(Into::into)
}

/// Get file content at a specific commit
#[tauri::command]
pub fn git_get_page_at_commit(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    commit_id: String,
) -> CommandResult<String> {
    let path = get_notebook_path(&state, &notebook_id)?;
    let file_path = format!("pages/{}.json", page_id);

    git::get_file_at_commit(&path, &commit_id, &file_path).map_err(Into::into)
}

/// Get diff between two commits for a page
#[tauri::command]
pub fn git_diff(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    old_commit_id: String,
    new_commit_id: String,
) -> CommandResult<String> {
    let path = get_notebook_path(&state, &notebook_id)?;
    let file_path = format!("pages/{}.json", page_id);

    git::get_file_diff(&path, &old_commit_id, &new_commit_id, &file_path).map_err(Into::into)
}

/// Restore a page to a previous commit version
#[tauri::command]
pub fn git_restore_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    commit_id: String,
) -> CommandResult<()> {
    let path = get_notebook_path(&state, &notebook_id)?;
    let file_path = format!("pages/{}.json", page_id);

    git::restore_file(&path, &commit_id, &file_path)?;

    // Commit the restoration
    git::commit_all(&path, &format!("Restored page to commit {}", &commit_id[..7]))?;

    Ok(())
}

/// Set remote URL for a notebook
#[tauri::command]
pub fn git_set_remote(
    state: State<AppState>,
    notebook_id: String,
    url: String,
) -> CommandResult<()> {
    let path = get_notebook_path(&state, &notebook_id)?;
    git::set_remote(&path, &url).map_err(Into::into)
}

/// Remove remote from a notebook
#[tauri::command]
pub fn git_remove_remote(state: State<AppState>, notebook_id: String) -> CommandResult<()> {
    let path = get_notebook_path(&state, &notebook_id)?;
    git::remove_remote(&path).map_err(Into::into)
}

/// Fetch from remote
#[tauri::command]
pub fn git_fetch(
    state: State<AppState>,
    notebook_id: String,
    username: Option<String>,
    password: Option<String>,
) -> CommandResult<()> {
    let path = get_notebook_path(&state, &notebook_id)?;

    let credentials = match (username, password) {
        (Some(u), Some(p)) => Some((u, p)),
        _ => None,
    };

    git::fetch(&path, credentials.as_ref().map(|(u, p)| (u.as_str(), p.as_str()))).map_err(Into::into)
}

/// Push to remote
#[tauri::command]
pub fn git_push(
    state: State<AppState>,
    notebook_id: String,
    username: Option<String>,
    password: Option<String>,
) -> CommandResult<()> {
    let path = get_notebook_path(&state, &notebook_id)?;

    let credentials = match (username, password) {
        (Some(u), Some(p)) => Some((u, p)),
        _ => None,
    };

    git::push(&path, credentials.as_ref().map(|(u, p)| (u.as_str(), p.as_str()))).map_err(Into::into)
}

/// Pull from remote
#[tauri::command]
pub fn git_pull(
    state: State<AppState>,
    notebook_id: String,
    username: Option<String>,
    password: Option<String>,
) -> CommandResult<()> {
    let path = get_notebook_path(&state, &notebook_id)?;

    let credentials = match (username, password) {
        (Some(u), Some(p)) => Some((u, p)),
        _ => None,
    };

    git::pull(&path, credentials.as_ref().map(|(u, p)| (u.as_str(), p.as_str()))).map_err(Into::into)
}

/// List branches
#[tauri::command]
pub fn git_list_branches(state: State<AppState>, notebook_id: String) -> CommandResult<Vec<String>> {
    let path = get_notebook_path(&state, &notebook_id)?;
    git::list_branches(&path).map_err(Into::into)
}

/// Get current branch
#[tauri::command]
pub fn git_current_branch(state: State<AppState>, notebook_id: String) -> CommandResult<String> {
    let path = get_notebook_path(&state, &notebook_id)?;
    git::current_branch(&path).map_err(Into::into)
}

/// Create a new branch
#[tauri::command]
pub fn git_create_branch(
    state: State<AppState>,
    notebook_id: String,
    branch_name: String,
) -> CommandResult<()> {
    let path = get_notebook_path(&state, &notebook_id)?;
    git::create_branch(&path, &branch_name).map_err(Into::into)
}

/// Switch to a branch
#[tauri::command]
pub fn git_switch_branch(
    state: State<AppState>,
    notebook_id: String,
    branch_name: String,
) -> CommandResult<()> {
    let path = get_notebook_path(&state, &notebook_id)?;
    git::switch_branch(&path, &branch_name).map_err(Into::into)
}
