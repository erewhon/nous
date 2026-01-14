//! Git Repository Operations
//!
//! Core functions for managing Git repositories in notebooks.

use std::path::Path;

use chrono::{DateTime, Utc};
use git2::{
    Commit, Cred, DiffOptions, Error as GitError, FetchOptions, IndexAddOption,
    PushOptions, RemoteCallbacks, Repository, Signature, StatusOptions,
};
use serde::{Deserialize, Serialize};

/// Git operation errors
#[derive(Debug, thiserror::Error)]
pub enum GitOperationError {
    #[error("Git error: {0}")]
    Git(#[from] GitError),
    #[error("Repository not initialized")]
    NotInitialized,
    #[error("No commits yet")]
    NoCommits,
    #[error("Remote not configured")]
    NoRemote,
    #[error("Authentication failed: {0}")]
    AuthFailed(String),
    #[error("Merge conflict detected")]
    MergeConflict,
    #[error("Invalid path: {0}")]
    InvalidPath(String),
}

pub type Result<T> = std::result::Result<T, GitOperationError>;

/// Git repository status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    pub is_repo: bool,
    pub is_dirty: bool,
    pub branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub has_remote: bool,
    pub remote_url: Option<String>,
    pub last_commit: Option<CommitInfo>,
}

/// Information about a commit
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitInfo {
    pub id: String,
    pub short_id: String,
    pub message: String,
    pub author: String,
    pub timestamp: DateTime<Utc>,
}

/// File change in a commit
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    pub path: String,
    pub change_type: ChangeType,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
}

/// Check if a directory is a Git repository
pub fn is_git_repo(path: &Path) -> bool {
    Repository::open(path).is_ok()
}

/// Initialize a new Git repository in the given directory
pub fn init_repo(path: &Path) -> Result<()> {
    Repository::init(path)?;
    log::info!("Initialized Git repository at {:?}", path);
    Ok(())
}

/// Open an existing Git repository
pub fn open_repo(path: &Path) -> Result<Repository> {
    Repository::open(path).map_err(|e| {
        if e.code() == git2::ErrorCode::NotFound {
            GitOperationError::NotInitialized
        } else {
            GitOperationError::Git(e)
        }
    })
}

/// Get the status of a Git repository
pub fn get_status(path: &Path) -> Result<GitStatus> {
    if !is_git_repo(path) {
        return Ok(GitStatus {
            is_repo: false,
            is_dirty: false,
            branch: None,
            ahead: 0,
            behind: 0,
            has_remote: false,
            remote_url: None,
            last_commit: None,
        });
    }

    let repo = open_repo(path)?;

    // Get current branch
    let branch = repo
        .head()
        .ok()
        .and_then(|h| h.shorthand().map(String::from));

    // Check if dirty (has uncommitted changes)
    let mut status_opts = StatusOptions::new();
    status_opts.include_untracked(true);
    let statuses = repo.statuses(Some(&mut status_opts))?;
    let is_dirty = !statuses.is_empty();

    // Get remote info
    let (has_remote, remote_url) = get_remote_info(&repo);

    // Get ahead/behind counts
    let (ahead, behind) = get_ahead_behind(&repo).unwrap_or((0, 0));

    // Get last commit
    let last_commit = get_last_commit(&repo).ok();

    Ok(GitStatus {
        is_repo: true,
        is_dirty,
        branch,
        ahead,
        behind,
        has_remote,
        remote_url,
        last_commit,
    })
}

/// Get remote URL if configured
fn get_remote_info(repo: &Repository) -> (bool, Option<String>) {
    match repo.find_remote("origin") {
        Ok(remote) => (true, remote.url().map(String::from)),
        Err(_) => (false, None),
    }
}

/// Get ahead/behind counts relative to upstream
fn get_ahead_behind(repo: &Repository) -> Result<(usize, usize)> {
    let head = repo.head()?;
    let local_oid = head.target().ok_or(GitOperationError::NoCommits)?;

    // Try to find upstream branch
    let branch_name = head.shorthand().unwrap_or("main");
    let upstream_ref = format!("refs/remotes/origin/{}", branch_name);

    match repo.find_reference(&upstream_ref) {
        Ok(upstream) => {
            let upstream_oid = upstream.target().ok_or(GitOperationError::NoCommits)?;
            let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid)?;
            Ok((ahead, behind))
        }
        Err(_) => Ok((0, 0)),
    }
}

/// Get the last commit info
fn get_last_commit(repo: &Repository) -> Result<CommitInfo> {
    let head = repo.head()?;
    let commit = head.peel_to_commit()?;
    Ok(commit_to_info(&commit))
}

/// Convert a git2::Commit to CommitInfo
fn commit_to_info(commit: &Commit) -> CommitInfo {
    let timestamp = DateTime::from_timestamp(commit.time().seconds(), 0)
        .unwrap_or_else(Utc::now);

    CommitInfo {
        id: commit.id().to_string(),
        short_id: commit.id().to_string()[..7].to_string(),
        message: commit.message().unwrap_or("").trim().to_string(),
        author: commit.author().name().unwrap_or("Unknown").to_string(),
        timestamp,
    }
}

/// Stage all changes and create a commit
pub fn commit_all(path: &Path, message: &str) -> Result<CommitInfo> {
    let repo = open_repo(path)?;

    // Stage all changes
    let mut index = repo.index()?;
    index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)?;
    index.write()?;

    // Check if there are staged changes
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;

    // Get parent commit (if any)
    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());

    // Create signature
    let sig = get_signature(&repo)?;

    // Create commit
    let commit_id = if let Some(parent) = parent_commit {
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])?
    } else {
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[])?
    };

    let commit = repo.find_commit(commit_id)?;
    log::info!("Created commit: {} - {}", &commit_id.to_string()[..7], message);

    Ok(commit_to_info(&commit))
}

/// Stage and commit a specific file
pub fn commit_file(path: &Path, file_path: &str, message: &str) -> Result<CommitInfo> {
    let repo = open_repo(path)?;

    // Stage the specific file
    let mut index = repo.index()?;
    index.add_path(Path::new(file_path))?;
    index.write()?;

    // Check if there are staged changes
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;

    // Get parent commit
    let parent_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());

    // Create signature
    let sig = get_signature(&repo)?;

    // Create commit
    let commit_id = if let Some(parent) = parent_commit {
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[&parent])?
    } else {
        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &[])?
    };

    let commit = repo.find_commit(commit_id)?;
    Ok(commit_to_info(&commit))
}

/// Get or create a signature for commits
fn get_signature(repo: &Repository) -> Result<Signature<'static>> {
    // Try to get from git config
    if let Ok(sig) = repo.signature() {
        return Ok(Signature::now(
            sig.name().unwrap_or("Katt User"),
            sig.email().unwrap_or("katt@local"),
        )?);
    }

    // Fall back to default
    Ok(Signature::now("Katt User", "katt@local")?)
}

/// Get commit history for a file or the entire repo
pub fn get_history(path: &Path, file_path: Option<&str>, limit: usize) -> Result<Vec<CommitInfo>> {
    let repo = open_repo(path)?;

    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    let mut commits = Vec::new();

    for oid_result in revwalk {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;

        // If filtering by file, check if file was changed in this commit
        if let Some(fp) = file_path {
            if !commit_touches_file(&repo, &commit, fp)? {
                continue;
            }
        }

        commits.push(commit_to_info(&commit));

        if commits.len() >= limit {
            break;
        }
    }

    Ok(commits)
}

/// Check if a commit touches a specific file
fn commit_touches_file(repo: &Repository, commit: &Commit, file_path: &str) -> Result<bool> {
    let tree = commit.tree()?;

    // Get parent tree (or empty tree for first commit)
    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());

    let mut diff_opts = DiffOptions::new();
    diff_opts.pathspec(file_path);

    let diff = repo.diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut diff_opts))?;

    Ok(diff.deltas().count() > 0)
}

/// Get the content of a file at a specific commit
pub fn get_file_at_commit(path: &Path, commit_id: &str, file_path: &str) -> Result<String> {
    let repo = open_repo(path)?;

    let oid = git2::Oid::from_str(commit_id)?;
    let commit = repo.find_commit(oid)?;
    let tree = commit.tree()?;

    let entry = tree.get_path(Path::new(file_path))?;
    let blob = repo.find_blob(entry.id())?;

    let content = std::str::from_utf8(blob.content())
        .map_err(|_| GitOperationError::InvalidPath("File is not valid UTF-8".to_string()))?;

    Ok(content.to_string())
}

/// Get diff between two commits for a file
pub fn get_file_diff(
    path: &Path,
    old_commit_id: &str,
    new_commit_id: &str,
    file_path: &str,
) -> Result<String> {
    let repo = open_repo(path)?;

    let old_oid = git2::Oid::from_str(old_commit_id)?;
    let new_oid = git2::Oid::from_str(new_commit_id)?;

    let old_commit = repo.find_commit(old_oid)?;
    let new_commit = repo.find_commit(new_oid)?;

    let old_tree = old_commit.tree()?;
    let new_tree = new_commit.tree()?;

    let mut diff_opts = DiffOptions::new();
    diff_opts.pathspec(file_path);

    let diff = repo.diff_tree_to_tree(Some(&old_tree), Some(&new_tree), Some(&mut diff_opts))?;

    let mut diff_text = String::new();
    diff.print(git2::DiffFormat::Patch, |_delta, _hunk, line| {
        let prefix = match line.origin() {
            '+' => "+",
            '-' => "-",
            ' ' => " ",
            _ => "",
        };
        if let Ok(content) = std::str::from_utf8(line.content()) {
            diff_text.push_str(prefix);
            diff_text.push_str(content);
        }
        true
    })?;

    Ok(diff_text)
}

/// Configure remote repository
pub fn set_remote(path: &Path, url: &str) -> Result<()> {
    let repo = open_repo(path)?;

    // Remove existing origin if present
    let _ = repo.remote_delete("origin");

    // Add new remote
    repo.remote("origin", url)?;
    log::info!("Set remote origin to: {}", url);

    Ok(())
}

/// Remove remote configuration
pub fn remove_remote(path: &Path) -> Result<()> {
    let repo = open_repo(path)?;
    repo.remote_delete("origin")?;
    log::info!("Removed remote origin");
    Ok(())
}

/// Fetch from remote
pub fn fetch(path: &Path, credentials: Option<(&str, &str)>) -> Result<()> {
    let repo = open_repo(path)?;
    let mut remote = repo.find_remote("origin").map_err(|_| GitOperationError::NoRemote)?;

    let mut callbacks = RemoteCallbacks::new();

    if let Some((username, password)) = credentials {
        let username = username.to_string();
        let password = password.to_string();
        callbacks.credentials(move |_url, _username_from_url, _allowed_types| {
            Cred::userpass_plaintext(&username, &password)
        });
    }

    let mut fetch_opts = FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);

    remote.fetch(&["refs/heads/*:refs/remotes/origin/*"], Some(&mut fetch_opts), None)?;
    log::info!("Fetched from remote");

    Ok(())
}

/// Push to remote
pub fn push(path: &Path, credentials: Option<(&str, &str)>) -> Result<()> {
    let repo = open_repo(path)?;
    let mut remote = repo.find_remote("origin").map_err(|_| GitOperationError::NoRemote)?;

    let head = repo.head()?;
    let branch_name = head.shorthand().unwrap_or("main");
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch_name, branch_name);

    let mut callbacks = RemoteCallbacks::new();

    if let Some((username, password)) = credentials {
        let username = username.to_string();
        let password = password.to_string();
        callbacks.credentials(move |_url, _username_from_url, _allowed_types| {
            Cred::userpass_plaintext(&username, &password)
        });
    }

    let mut push_opts = PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    remote.push(&[&refspec], Some(&mut push_opts))?;
    log::info!("Pushed to remote");

    Ok(())
}

/// Pull from remote (fetch + merge)
pub fn pull(path: &Path, credentials: Option<(&str, &str)>) -> Result<()> {
    // First fetch
    fetch(path, credentials)?;

    let repo = open_repo(path)?;

    // Get current branch
    let head = repo.head()?;
    let branch_name = head.shorthand().unwrap_or("main");

    // Find the remote tracking branch
    let remote_ref = format!("refs/remotes/origin/{}", branch_name);
    let remote_branch = repo.find_reference(&remote_ref)?;
    let remote_commit = remote_branch.peel_to_commit()?;

    // Get local commit
    let local_commit = head.peel_to_commit()?;

    // Check if we need to merge
    let (ahead, behind) = repo.graph_ahead_behind(local_commit.id(), remote_commit.id())?;

    if behind == 0 {
        log::info!("Already up to date");
        return Ok(());
    }

    if ahead > 0 {
        // We have local commits - need to handle merge/rebase
        // For now, just do a merge
        log::warn!("Local commits exist, attempting merge");
    }

    // Perform merge
    let annotated_commit = repo.find_annotated_commit(remote_commit.id())?;
    let (analysis, _) = repo.merge_analysis(&[&annotated_commit])?;

    if analysis.is_fast_forward() {
        // Fast-forward merge
        let mut reference = repo.find_reference("HEAD")?;
        reference.set_target(remote_commit.id(), "Fast-forward pull")?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;
        log::info!("Fast-forward merge completed");
    } else if analysis.is_normal() {
        // Normal merge required
        repo.merge(&[&annotated_commit], None, None)?;

        // Check for conflicts
        let mut index = repo.index()?;
        if index.has_conflicts() {
            return Err(GitOperationError::MergeConflict);
        }

        // Commit the merge
        let sig = get_signature(&repo)?;
        let tree_id = index.write_tree()?;
        let tree = repo.find_tree(tree_id)?;
        let message = format!("Merge remote-tracking branch 'origin/{}'", branch_name);
        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            &message,
            &tree,
            &[&local_commit, &remote_commit],
        )?;
        repo.cleanup_state()?;
        log::info!("Merge commit created");
    }

    Ok(())
}

/// Restore a file to a previous commit version
pub fn restore_file(path: &Path, commit_id: &str, file_path: &str) -> Result<()> {
    let content = get_file_at_commit(path, commit_id, file_path)?;
    let full_path = path.join(file_path);
    std::fs::write(&full_path, content)
        .map_err(|e| GitOperationError::InvalidPath(e.to_string()))?;
    log::info!("Restored {} to commit {}", file_path, &commit_id[..7]);
    Ok(())
}

/// List branches
pub fn list_branches(path: &Path) -> Result<Vec<String>> {
    let repo = open_repo(path)?;
    let branches = repo.branches(Some(git2::BranchType::Local))?;

    let mut branch_names = Vec::new();
    for branch_result in branches {
        let (branch, _) = branch_result?;
        if let Some(name) = branch.name()? {
            branch_names.push(name.to_string());
        }
    }

    Ok(branch_names)
}

/// Get current branch name
pub fn current_branch(path: &Path) -> Result<String> {
    let repo = open_repo(path)?;
    let head = repo.head()?;
    Ok(head.shorthand().unwrap_or("HEAD").to_string())
}

/// Create a new branch
pub fn create_branch(path: &Path, branch_name: &str) -> Result<()> {
    let repo = open_repo(path)?;
    let head = repo.head()?;
    let commit = head.peel_to_commit()?;
    repo.branch(branch_name, &commit, false)?;
    log::info!("Created branch: {}", branch_name);
    Ok(())
}

/// Switch to a branch
pub fn switch_branch(path: &Path, branch_name: &str) -> Result<()> {
    let repo = open_repo(path)?;

    let refname = format!("refs/heads/{}", branch_name);
    let obj = repo.revparse_single(&refname)?;

    repo.checkout_tree(&obj, None)?;
    repo.set_head(&refname)?;

    log::info!("Switched to branch: {}", branch_name);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_repo() -> (TempDir, std::path::PathBuf) {
        let temp_dir = TempDir::new().unwrap();
        let path = temp_dir.path().to_path_buf();
        init_repo(&path).unwrap();
        (temp_dir, path)
    }

    #[test]
    fn test_init_and_status() {
        let (_temp, path) = create_test_repo();

        let status = get_status(&path).unwrap();
        assert!(status.is_repo);
        assert!(!status.is_dirty);
    }

    #[test]
    fn test_commit() {
        let (_temp, path) = create_test_repo();

        // Create a file
        std::fs::write(path.join("test.txt"), "Hello, World!").unwrap();

        // Commit
        let commit = commit_all(&path, "Initial commit").unwrap();
        assert!(!commit.id.is_empty());
        assert_eq!(commit.message, "Initial commit");
    }

    #[test]
    fn test_history() {
        let (_temp, path) = create_test_repo();

        // Create and commit multiple files
        std::fs::write(path.join("file1.txt"), "Content 1").unwrap();
        commit_all(&path, "First commit").unwrap();

        std::fs::write(path.join("file2.txt"), "Content 2").unwrap();
        commit_all(&path, "Second commit").unwrap();

        let history = get_history(&path, None, 10).unwrap();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].message, "Second commit");
        assert_eq!(history[1].message, "First commit");
    }

    #[test]
    fn test_file_at_commit() {
        let (_temp, path) = create_test_repo();

        std::fs::write(path.join("test.txt"), "Version 1").unwrap();
        let commit1 = commit_all(&path, "Version 1").unwrap();

        std::fs::write(path.join("test.txt"), "Version 2").unwrap();
        commit_all(&path, "Version 2").unwrap();

        let content = get_file_at_commit(&path, &commit1.id, "test.txt").unwrap();
        assert_eq!(content, "Version 1");
    }

    #[test]
    fn test_branches() {
        let (_temp, path) = create_test_repo();

        std::fs::write(path.join("test.txt"), "Content").unwrap();
        commit_all(&path, "Initial").unwrap();

        create_branch(&path, "feature").unwrap();

        let branches = list_branches(&path).unwrap();
        assert!(branches.contains(&"master".to_string()) || branches.contains(&"main".to_string()));
        assert!(branches.contains(&"feature".to_string()));
    }
}
