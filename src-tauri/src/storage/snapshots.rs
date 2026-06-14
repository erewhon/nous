//! Periodic page snapshots for recovery and history.
//!
//! Snapshots are full page JSON copies stored in `{notebook}/pages/{page_id}.snapshots/`.
//! A new snapshot is taken every N oplog entries (configurable, default 20).
//! Old snapshots beyond the retention limit are pruned.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::Page;

/// Default: take a snapshot every N saves
const SNAPSHOT_INTERVAL: usize = 20;

/// Default: keep the last N snapshots
const MAX_SNAPSHOTS: usize = 50;

/// Process-monotonic counter so two snapshots taken in the same microsecond
/// (e.g. a pre-overwrite snapshot immediately followed by a periodic one) never
/// share a filename and overwrite each other.
static SNAPSHOT_SEQ: AtomicU64 = AtomicU64::new(0);

/// Metadata stored alongside each snapshot
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotMeta {
    pub ts: DateTime<Utc>,
    pub content_hash: String,
    pub block_count: usize,
    pub oplog_entry_count: usize,
}

/// Get the snapshots directory for a page
pub fn snapshots_dir(pages_dir: &Path, page_id: Uuid) -> PathBuf {
    pages_dir.join(format!("{}.snapshots", page_id))
}

/// Check if a new snapshot should be taken, based on oplog entry count since last snapshot.
pub fn should_snapshot(pages_dir: &Path, page_id: Uuid) -> bool {
    let oplog_path = super::oplog::oplog_path(pages_dir, page_id);
    let oplog_count = super::oplog::read_entries(&oplog_path).len();

    let snap_dir = snapshots_dir(pages_dir, page_id);
    let last_snapshot_oplog_count = read_latest_meta(&snap_dir)
        .map(|m| m.oplog_entry_count)
        .unwrap_or(0);

    oplog_count >= last_snapshot_oplog_count + SNAPSHOT_INTERVAL
}

/// Take a snapshot of the current page state.
///
/// Snapshot files are written crash-atomically (`.json` first, then
/// `.meta.json`) so a torn write can never produce a corrupt snapshot. The
/// filename carries microseconds plus a process-monotonic counter so snapshots
/// taken in quick succession never overwrite each other.
pub fn take_snapshot(pages_dir: &Path, page: &Page) -> std::io::Result<()> {
    let snap_dir = snapshots_dir(pages_dir, page.id);
    fs::create_dir_all(&snap_dir)?;

    let oplog_path = super::oplog::oplog_path(pages_dir, page.id);
    let oplog_count = super::oplog::read_entries(&oplog_path).len();

    let ts = Utc::now();
    let seq = SNAPSHOT_SEQ.fetch_add(1, Ordering::Relaxed) % 1_000_000;
    // First 15 chars stay "%Y%m%d_%H%M%S" so prefix-based ordering/search works.
    let filename = format!("{}_{:06}", ts.format("%Y%m%d_%H%M%S_%6f"), seq);

    // Write page JSON snapshot (atomic + fsync).
    let page_json = super::content_format::page_to_disk_json(page).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e)
    })?;
    super::atomic::write_str(&snap_dir.join(format!("{}.json", filename)), &page_json)?;

    // Write metadata (atomic + fsync).
    let meta = SnapshotMeta {
        ts,
        content_hash: super::oplog::content_hash(&page.content),
        block_count: page.content.blocks.len(),
        oplog_entry_count: oplog_count,
    };
    let meta_json = serde_json::to_string_pretty(&meta).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e)
    })?;
    super::atomic::write_str(&snap_dir.join(format!("{}.meta.json", filename)), &meta_json)?;

    // Prune old snapshots if over limit
    prune_snapshots(&snap_dir, MAX_SNAPSHOTS)?;

    Ok(())
}

/// Content hash of the most recent snapshot, if any. Used to avoid writing a
/// duplicate snapshot of a state we already captured.
pub fn latest_content_hash(snap_dir: &Path) -> Option<String> {
    read_latest_meta(snap_dir).map(|m| m.content_hash)
}

/// Whether a block-count change is a "destructive shrink" worth a snapshot of
/// the pre-edit state before overwriting. Catches the silent-wipe class of bug:
/// a save that drops a large fraction of the page's blocks.
pub fn is_destructive_shrink(old_count: usize, new_count: usize) -> bool {
    if new_count >= old_count {
        return false;
    }
    let lost = old_count - new_count;
    // Losing >= 3 blocks, or more than half the page (covers a full wipe).
    lost >= 3 || new_count * 2 < old_count
}

/// List snapshot timestamps in chronological order.
pub fn list_snapshots(snap_dir: &Path) -> Vec<String> {
    if !snap_dir.exists() {
        return Vec::new();
    }

    let mut names: Vec<String> = fs::read_dir(snap_dir)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let name = entry.file_name().to_string_lossy().to_string();
            // Only include .json files (not .meta.json)
            if name.ends_with(".json") && !name.ends_with(".meta.json") {
                Some(name.trim_end_matches(".json").to_string())
            } else {
                None
            }
        })
        .collect();

    names.sort();
    names
}

/// Read a specific snapshot's page data.
pub fn read_snapshot(snap_dir: &Path, name: &str) -> Option<Page> {
    let path = snap_dir.join(format!("{}.json", name));
    let content = fs::read_to_string(&path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Get a specific block's data from a snapshot.
/// Returns the block data as a JSON value if found.
pub fn get_block_at_snapshot(
    snap_dir: &Path,
    name: &str,
    block_id: &str,
) -> Option<serde_json::Value> {
    let page = read_snapshot(snap_dir, name)?;
    page.content
        .blocks
        .iter()
        .find(|b| b.id == block_id)
        .map(|b| {
            serde_json::json!({
                "id": b.id,
                "type": b.block_type,
                "data": b.data,
            })
        })
}

/// Find the nearest snapshot at or before a given timestamp.
pub fn find_nearest_snapshot(snap_dir: &Path, ts: &chrono::DateTime<chrono::Utc>) -> Option<String> {
    let names = list_snapshots(snap_dir);
    // Snapshots are named YYYYMMDD_HHMMSS, sorted chronologically.
    // Find the last one whose timestamp is <= the given ts.
    let target = ts.format("%Y%m%d_%H%M%S").to_string();
    let mut best: Option<String> = None;
    for name in &names {
        // Snapshot names are "%Y%m%d_%H%M%S_<micros>_<seq>"; compare on the
        // 15-char datetime prefix so the sub-second suffix doesn't skew ordering.
        let name_prefix = name.get(0..target.len()).unwrap_or(name.as_str());
        if name_prefix <= target.as_str() {
            best = Some(name.clone());
        } else {
            break;
        }
    }
    // If no snapshot is before this timestamp, return the earliest one
    best.or_else(|| names.first().cloned())
}

/// Read the metadata for the most recent snapshot.
fn read_latest_meta(snap_dir: &Path) -> Option<SnapshotMeta> {
    let names = list_snapshots(snap_dir);
    let latest = names.last()?;
    let meta_path = snap_dir.join(format!("{}.meta.json", latest));
    let content = fs::read_to_string(&meta_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Prune snapshots down to `max`, but ALWAYS keep the single oldest snapshot as
/// a baseline. Pruning purely by recency could otherwise delete the last full
/// copy of content that was silently lost long ago; keeping the oldest preserves
/// the earliest recoverable state. We therefore retain the oldest snapshot plus
/// the newest `max - 1`, removing only those in between.
fn prune_snapshots(snap_dir: &Path, max: usize) -> std::io::Result<()> {
    let names = list_snapshots(snap_dir);
    if names.len() <= max || max < 2 {
        return Ok(());
    }

    // Keep names[0] (oldest baseline) and the last `max - 1` (most recent).
    let keep_oldest = 1usize;
    let remove_start = keep_oldest;
    let remove_end = names.len() - (max - keep_oldest);
    for name in &names[remove_start..remove_end] {
        let _ = fs::remove_file(snap_dir.join(format!("{}.json", name)));
        let _ = fs::remove_file(snap_dir.join(format!("{}.meta.json", name)));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::models::{EditorBlock, EditorData, PageType, SystemPromptMode};
    use serde_json::json;

    fn make_test_page(notebook_id: Uuid, page_id: Uuid) -> Page {
        Page {
            id: page_id,
            notebook_id,
            title: "Test Page".to_string(),
            content: EditorData {
                time: Some(1000),
                version: Some("2.28.0".to_string()),
                blocks: vec![EditorBlock {
                    id: "block-1".to_string(),
                    block_type: "paragraph".to_string(),
                    data: json!({ "text": "hello world" }),
                }],
            },
            tags: vec![],
            folder_id: None,
            parent_page_id: None,
            section_id: None,
            is_archived: false,
            is_cover: false,
            position: 0,
            system_prompt: None,
            system_prompt_mode: SystemPromptMode::default(),
            ai_model: None,
            page_type: PageType::default(),
            source_file: None,
            storage_mode: None,
            file_extension: None,
            last_file_sync: None,
            template_id: None,
            deleted_at: None,
            color: None,
            is_favorite: false,
            is_daily_note: false,
            daily_note_date: None,
            plugin_page_type: None,
            plugin_data: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        }
    }

    #[test]
    fn test_snapshot_roundtrip() {
        let dir = std::env::temp_dir().join(format!("snap_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let page_id = Uuid::new_v4();
        let notebook_id = Uuid::new_v4();
        let page = make_test_page(notebook_id, page_id);

        take_snapshot(&dir, &page).unwrap();

        let snap_dir = snapshots_dir(&dir, page_id);
        let names = list_snapshots(&snap_dir);
        assert_eq!(names.len(), 1);

        let restored = read_snapshot(&snap_dir, &names[0]).unwrap();
        assert_eq!(restored.id, page_id);
        assert_eq!(restored.title, "Test Page");
        assert_eq!(restored.content.blocks.len(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_snapshot_pruning() {
        let dir = std::env::temp_dir().join(format!("snap_prune_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let page_id = Uuid::new_v4();
        let notebook_id = Uuid::new_v4();
        let page = make_test_page(notebook_id, page_id);
        let snap_dir = snapshots_dir(&dir, page_id);
        fs::create_dir_all(&snap_dir).unwrap();

        // Create 5 fake snapshots
        for i in 0..5 {
            let name = format!("20260101_0000{:02}", i);
            fs::write(snap_dir.join(format!("{}.json", name)), "{}").unwrap();
            fs::write(snap_dir.join(format!("{}.meta.json", name)), "{}").unwrap();
        }

        assert_eq!(list_snapshots(&snap_dir).len(), 5);

        // Prune to 3
        prune_snapshots(&snap_dir, 3).unwrap();
        let remaining = list_snapshots(&snap_dir);
        assert_eq!(remaining.len(), 3);
        // Keeps the oldest baseline (000000) plus the newest 2 (000003, 000004),
        // dropping the middle ones — so the earliest recoverable state survives.
        assert_eq!(remaining[0], "20260101_000000");
        assert_eq!(remaining[1], "20260101_000003");
        assert_eq!(remaining[2], "20260101_000004");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_destructive_shrink_detection() {
        // Full wipe and large drops are destructive.
        assert!(is_destructive_shrink(1, 0));
        assert!(is_destructive_shrink(10, 0));
        assert!(is_destructive_shrink(10, 4)); // lost 6
        assert!(is_destructive_shrink(4, 1)); // lost >half
        // Small or non-shrinking edits are not.
        assert!(!is_destructive_shrink(4, 3)); // lost 1
        assert!(!is_destructive_shrink(5, 5));
        assert!(!is_destructive_shrink(3, 10)); // grew
    }
}
