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
            sig.name().unwrap_or("Nous User"),
            sig.email().unwrap_or("nous@local"),
        )?);
    }

    // Fall back to default
    Ok(Signature::now("Nous User", "nous@local")?)
}

/// Get commit history for a file or the entire repo
pub fn get_history(path: &Path, file_path: Option<&str>, limit: usize, skip: usize) -> Result<Vec<CommitInfo>> {
    let repo = open_repo(path)?;

    let mut revwalk = repo.revwalk()?;
    revwalk.push_head()?;
    revwalk.set_sorting(git2::Sort::TIME)?;

    let mut commits = Vec::new();
    let mut skipped = 0;

    for oid_result in revwalk {
        let oid = oid_result?;
        let commit = repo.find_commit(oid)?;

        // If filtering by file, check if file was changed in this commit
        if let Some(fp) = file_path {
            if !commit_touches_file(&repo, &commit, fp)? {
                continue;
            }
        }

        // Skip the first `skip` matching commits
        if skipped < skip {
            skipped += 1;
            continue;
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

/// Delete a branch
pub fn delete_branch(path: &Path, branch_name: &str) -> Result<()> {
    let repo = open_repo(path)?;

    // Can't delete the current branch
    let current = current_branch(path)?;
    if current == branch_name {
        return Err(GitOperationError::InvalidPath(
            "Cannot delete the current branch".to_string()
        ));
    }

    let mut branch = repo.find_branch(branch_name, git2::BranchType::Local)?;
    branch.delete()?;

    log::info!("Deleted branch: {}", branch_name);
    Ok(())
}

/// Merge result
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeResult {
    pub success: bool,
    pub has_conflicts: bool,
    pub conflicts: Vec<ConflictInfo>,
    pub message: String,
}

/// Information about a merge conflict
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    pub path: String,
    pub ancestor_id: Option<String>,
    pub our_id: Option<String>,
    pub their_id: Option<String>,
}

/// Content of a conflicted file from different versions
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictContent {
    pub path: String,
    pub ancestor: Option<String>,
    pub ours: Option<String>,
    pub theirs: Option<String>,
}

/// Merge another branch into the current branch
pub fn merge_branch(path: &Path, branch_name: &str) -> Result<MergeResult> {
    let repo = open_repo(path)?;

    // Get the branch to merge
    let refname = format!("refs/heads/{}", branch_name);
    let reference = repo.find_reference(&refname)?;
    let commit = reference.peel_to_commit()?;
    let annotated = repo.find_annotated_commit(commit.id())?;

    // Analyze merge situation
    let (analysis, _preference) = repo.merge_analysis(&[&annotated])?;

    if analysis.is_up_to_date() {
        return Ok(MergeResult {
            success: true,
            has_conflicts: false,
            conflicts: vec![],
            message: "Already up to date".to_string(),
        });
    }

    if analysis.is_fast_forward() {
        // Fast-forward merge
        let mut head_ref = repo.head()?;
        head_ref.set_target(commit.id(), &format!("Fast-forward to {}", branch_name))?;
        repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))?;

        log::info!("Fast-forward merge to {}", branch_name);
        return Ok(MergeResult {
            success: true,
            has_conflicts: false,
            conflicts: vec![],
            message: format!("Fast-forward merge to {}", branch_name),
        });
    }

    // Normal merge
    repo.merge(&[&annotated], None, None)?;

    // Check for conflicts
    let mut index = repo.index()?;
    if index.has_conflicts() {
        let conflicts = list_conflicts_internal(&repo)?;
        let conflict_count = conflicts.len();

        log::warn!("Merge has {} conflicts", conflict_count);
        return Ok(MergeResult {
            success: false,
            has_conflicts: true,
            conflicts,
            message: format!("Merge has {} conflicts that need to be resolved", conflict_count),
        });
    }

    // No conflicts - create merge commit
    let sig = get_signature(&repo)?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let head_commit = repo.head()?.peel_to_commit()?;

    let message = format!("Merge branch '{}'", branch_name);
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &message,
        &tree,
        &[&head_commit, &commit],
    )?;
    repo.cleanup_state()?;

    log::info!("Merged branch {}", branch_name);
    Ok(MergeResult {
        success: true,
        has_conflicts: false,
        conflicts: vec![],
        message: format!("Successfully merged branch '{}'", branch_name),
    })
}

/// List conflicts in the current merge
fn list_conflicts_internal(repo: &Repository) -> Result<Vec<ConflictInfo>> {
    let index = repo.index()?;
    let conflicts = index.conflicts()?;

    let mut conflict_list = Vec::new();
    for conflict_result in conflicts {
        let conflict = conflict_result?;

        // Get path from whichever entry is available
        let path = conflict.our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref())
            .map(|e| {
                String::from_utf8_lossy(&e.path).to_string()
            })
            .unwrap_or_default();

        conflict_list.push(ConflictInfo {
            path,
            ancestor_id: conflict.ancestor.as_ref().map(|e| e.id.to_string()),
            our_id: conflict.our.as_ref().map(|e| e.id.to_string()),
            their_id: conflict.their.as_ref().map(|e| e.id.to_string()),
        });
    }

    Ok(conflict_list)
}

/// List conflicts in the current merge (public wrapper)
pub fn list_conflicts(path: &Path) -> Result<Vec<ConflictInfo>> {
    let repo = open_repo(path)?;
    list_conflicts_internal(&repo)
}

/// Check if repository is in a merge state
pub fn is_merging(path: &Path) -> Result<bool> {
    let repo = open_repo(path)?;
    Ok(repo.state() == git2::RepositoryState::Merge)
}

/// Get the content of a conflicted file from all versions
pub fn get_conflict_content(path: &Path, file_path: &str) -> Result<ConflictContent> {
    let repo = open_repo(path)?;
    let index = repo.index()?;

    let conflicts = index.conflicts()?;

    for conflict_result in conflicts {
        let conflict = conflict_result?;

        // Check if this conflict matches the requested file
        let conflict_path = conflict.our
            .as_ref()
            .or(conflict.their.as_ref())
            .or(conflict.ancestor.as_ref())
            .map(|e| String::from_utf8_lossy(&e.path).to_string())
            .unwrap_or_default();

        if conflict_path == file_path {
            // Get content from each version
            let ancestor = conflict.ancestor
                .as_ref()
                .and_then(|e| repo.find_blob(e.id).ok())
                .and_then(|b| std::str::from_utf8(b.content()).ok().map(String::from));

            let ours = conflict.our
                .as_ref()
                .and_then(|e| repo.find_blob(e.id).ok())
                .and_then(|b| std::str::from_utf8(b.content()).ok().map(String::from));

            let theirs = conflict.their
                .as_ref()
                .and_then(|e| repo.find_blob(e.id).ok())
                .and_then(|b| std::str::from_utf8(b.content()).ok().map(String::from));

            return Ok(ConflictContent {
                path: file_path.to_string(),
                ancestor,
                ours,
                theirs,
            });
        }
    }

    Err(GitOperationError::InvalidPath(format!(
        "No conflict found for file: {}",
        file_path
    )))
}

/// Resolution strategy for conflicts
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ResolutionStrategy {
    /// Use our version (current branch)
    Ours,
    /// Use their version (branch being merged)
    Theirs,
    /// Use custom content
    Custom,
}

/// Resolve a conflict
pub fn resolve_conflict(
    path: &Path,
    file_path: &str,
    strategy: ResolutionStrategy,
    custom_content: Option<&str>,
) -> Result<()> {
    let repo = open_repo(path)?;
    let mut index = repo.index()?;

    // Find the conflict entries
    let conflicts: Vec<_> = index.conflicts()?.collect::<std::result::Result<Vec<_>, _>>()?;

    let conflict = conflicts.iter().find(|c| {
        c.our.as_ref()
            .or(c.their.as_ref())
            .or(c.ancestor.as_ref())
            .map(|e| String::from_utf8_lossy(&e.path).to_string())
            .unwrap_or_default() == file_path
    }).ok_or_else(|| GitOperationError::InvalidPath(format!(
        "No conflict found for file: {}",
        file_path
    )))?;

    // Get the content based on strategy
    let content = match strategy {
        ResolutionStrategy::Ours => {
            conflict.our
                .as_ref()
                .and_then(|e| repo.find_blob(e.id).ok())
                .map(|b| b.content().to_vec())
                .ok_or_else(|| GitOperationError::InvalidPath(
                    "Our version not available".to_string()
                ))?
        }
        ResolutionStrategy::Theirs => {
            conflict.their
                .as_ref()
                .and_then(|e| repo.find_blob(e.id).ok())
                .map(|b| b.content().to_vec())
                .ok_or_else(|| GitOperationError::InvalidPath(
                    "Their version not available".to_string()
                ))?
        }
        ResolutionStrategy::Custom => {
            custom_content
                .ok_or_else(|| GitOperationError::InvalidPath(
                    "Custom content required for custom resolution".to_string()
                ))?
                .as_bytes()
                .to_vec()
        }
    };

    // Write the resolved content to the working directory
    let full_path = path.join(file_path);
    std::fs::write(&full_path, &content)
        .map_err(|e| GitOperationError::InvalidPath(e.to_string()))?;

    // Stage the resolved file
    index.add_path(Path::new(file_path))?;
    index.write()?;

    // Remove the conflict marker
    index.remove_path(Path::new(file_path))?;
    index.add_path(Path::new(file_path))?;
    index.write()?;

    log::info!("Resolved conflict for {} using {:?}", file_path, strategy);
    Ok(())
}

/// Resolve all conflicts with a single strategy
pub fn resolve_all_conflicts(path: &Path, strategy: ResolutionStrategy) -> Result<()> {
    let conflicts = list_conflicts(path)?;

    for conflict in conflicts {
        resolve_conflict(path, &conflict.path, strategy, None)?;
    }

    Ok(())
}

/// Commit the merge after resolving conflicts
pub fn commit_merge(path: &Path, message: Option<&str>) -> Result<CommitInfo> {
    let repo = open_repo(path)?;

    // Check if we're in a merge state
    if repo.state() != git2::RepositoryState::Merge {
        return Err(GitOperationError::InvalidPath(
            "Not in a merge state".to_string()
        ));
    }

    // Check for remaining conflicts
    let index = repo.index()?;
    if index.has_conflicts() {
        return Err(GitOperationError::MergeConflict);
    }

    // Get MERGE_HEAD
    let merge_head_path = path.join(".git").join("MERGE_HEAD");
    let merge_head_content = std::fs::read_to_string(&merge_head_path)
        .map_err(|e| GitOperationError::InvalidPath(e.to_string()))?;
    let merge_head_id = git2::Oid::from_str(merge_head_content.trim())?;
    let merge_commit = repo.find_commit(merge_head_id)?;

    // Get HEAD commit
    let head_commit = repo.head()?.peel_to_commit()?;

    // Create merge commit
    let sig = get_signature(&repo)?;
    let mut index = repo.index()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;

    let default_message = format!(
        "Merge commit (resolved conflicts)"
    );
    let message = message.unwrap_or(&default_message);

    let commit_id = repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        message,
        &tree,
        &[&head_commit, &merge_commit],
    )?;

    repo.cleanup_state()?;

    let commit = repo.find_commit(commit_id)?;
    log::info!("Created merge commit: {}", &commit_id.to_string()[..7]);

    Ok(commit_to_info(&commit))
}

/// Abort the current merge
pub fn abort_merge(path: &Path) -> Result<()> {
    let repo = open_repo(path)?;

    // Check if we're in a merge state
    if repo.state() != git2::RepositoryState::Merge {
        return Err(GitOperationError::InvalidPath(
            "Not in a merge state".to_string()
        ));
    }

    // Reset to HEAD and cleanup merge state
    let head = repo.head()?.peel_to_commit()?;
    repo.reset(head.as_object(), git2::ResetType::Hard, None)?;
    repo.cleanup_state()?;

    log::info!("Merge aborted");
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

        let history = get_history(&path, None, 10, 0).unwrap();
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
