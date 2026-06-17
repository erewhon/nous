//! Periodic page snapshots for recovery and history.
//!
//! Snapshots are full page JSON copies stored in `{notebook}/pages/{page_id}.snapshots/`.
//! A new snapshot is taken every N oplog entries (configurable, default 20).
//! Old snapshots beyond the retention limit are pruned.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use chrono::{DateTime, NaiveDateTime, Utc};
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

/// Read the metadata for a specific snapshot by name. Returns None if the
/// `.meta.json` sidecar is missing or unparseable.
pub fn read_snapshot_meta(snap_dir: &Path, name: &str) -> Option<SnapshotMeta> {
    let meta_path = snap_dir.join(format!("{}.meta.json", name));
    let content = fs::read_to_string(&meta_path).ok()?;
    serde_json::from_str(&content).ok()
}

/// Read the metadata for the most recent snapshot.
fn read_latest_meta(snap_dir: &Path) -> Option<SnapshotMeta> {
    let names = list_snapshots(snap_dir);
    let latest = names.last()?;
    read_snapshot_meta(snap_dir, latest)
}

/// Prune snapshots down to `max` using time-based exponential thinning.
///
/// A purely recency-based policy (keep the newest N) — or even "oldest baseline
/// plus newest N-1" — leaves a large, permanently unrecoverable GAP in the
/// middle of a heavily-edited page's history: content added after the baseline
/// and deleted before the recent window is gone, and the oplog stores only diffs
/// (no content), so snapshots are the only full copies. Instead we keep the
/// oldest and newest plus an exponentially-thinned spread of the middle (dense
/// recent, sparse old) so *some* recoverable copy survives across the whole
/// timeline. See [`snapshots_to_keep`]. (DL-35)
fn prune_snapshots(snap_dir: &Path, max: usize) -> std::io::Result<()> {
    let names = list_snapshots(snap_dir);
    let n = names.len();
    if n <= max || max < 2 {
        return Ok(());
    }

    // Parse a timestamp from each snapshot name (prefix "%Y%m%d_%H%M%S"). If any
    // name is unparseable, fall back to the conservative oldest + newest-window
    // policy rather than risk deleting a snapshot we can't reason about.
    let times: Option<Vec<DateTime<Utc>>> = names
        .iter()
        .map(|name| {
            name.get(0..15)
                .and_then(|p| NaiveDateTime::parse_from_str(p, "%Y%m%d_%H%M%S").ok())
                .map(|ndt| ndt.and_utc())
        })
        .collect();

    let keep: std::collections::BTreeSet<usize> = match times {
        Some(times) => snapshots_to_keep(&times, max),
        None => {
            let mut k = std::collections::BTreeSet::new();
            k.insert(0);
            k.extend((n - (max - 1))..n);
            k
        }
    };

    for (i, name) in names.iter().enumerate() {
        if !keep.contains(&i) {
            let _ = fs::remove_file(snap_dir.join(format!("{}.json", name)));
            let _ = fs::remove_file(snap_dir.join(format!("{}.meta.json", name)));
        }
    }

    Ok(())
}

/// Select which snapshots (by index into a chronological, oldest-first list) to
/// retain when the count exceeds `max`.
///
/// We always keep the newest (latest state) and oldest (earliest baseline), then
/// fill the budget by greedily even-spreading the rest in **log-age space**:
/// each snapshot is positioned at `ln(age + 1)` and we repeatedly drop the
/// interior snapshot whose removal opens the smallest log-age gap (the most
/// redundant one). Even spacing in log-age is geometric spacing in real time —
/// dense for recent history, sparse for old — which is the exponential thinning
/// the audit asks for, without leaving an unrecoverable middle gap.
///
/// This formulation is STABLE under repeated pruning (append-newest then prune,
/// over and over): even-spreading in a fixed coordinate is a self-correcting
/// process, so the middle of the history never erodes away — unlike a sliding
/// recent-window policy, where snapshots die at the window edge before they can
/// age into the sparse tail.
fn snapshots_to_keep(times: &[DateTime<Utc>], max: usize) -> std::collections::BTreeSet<usize> {
    use std::collections::BTreeSet;

    let n = times.len();
    let mut keep = BTreeSet::new();
    if n == 0 {
        return keep;
    }
    if n <= max {
        keep.extend(0..n);
        return keep;
    }
    if max < 2 {
        // Degenerate budget: keep just the newest (latest state).
        keep.insert(n - 1);
        return keep;
    }

    let newest = times[n - 1];
    // Log-age coordinate. `times` is oldest-first, so lage is descending:
    // lage[0] (oldest) is largest, lage[n-1] (newest) is 0.
    let lage: Vec<f64> = times
        .iter()
        .map(|t| ((newest - *t).num_seconds().max(0) as f64 + 1.0).ln())
        .collect();

    // Greedily drop the most-redundant interior snapshot until at budget. The
    // endpoints (indices 0 and n-1) are never interior, so they always survive.
    let mut alive: Vec<usize> = (0..n).collect();
    while alive.len() > max {
        let mut best_pos = 1usize;
        let mut best_gap = f64::INFINITY;
        for p in 1..alive.len() - 1 {
            // Log-age span that would be merged if alive[p] were removed.
            let gap = lage[alive[p - 1]] - lage[alive[p + 1]];
            if gap < best_gap {
                best_gap = gap;
                best_pos = p;
            }
        }
        alive.remove(best_pos);
    }

    keep.extend(alive);
    keep
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
    fn read_snapshot_meta_returns_fields_for_named_snapshot() {
        let dir = std::env::temp_dir().join(format!("snap_meta_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let page_id = Uuid::new_v4();
        let page = make_test_page(Uuid::new_v4(), page_id);

        take_snapshot(&dir, &page).unwrap();
        let snap_dir = snapshots_dir(&dir, page_id);
        let name = list_snapshots(&snap_dir).pop().unwrap();

        let meta = read_snapshot_meta(&snap_dir, &name).expect("meta should parse");
        assert_eq!(meta.block_count, page.content.blocks.len());
        assert!(!meta.content_hash.is_empty());
        // Unknown snapshot name → None (not a panic).
        assert!(read_snapshot_meta(&snap_dir, "20990101_000000_000000_000000").is_none());

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
    fn snapshots_to_keep_retains_all_when_under_budget() {
        use chrono::TimeZone;
        let base = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let times: Vec<_> = (0..10i64).map(|h| base + chrono::Duration::hours(h)).collect();
        let keep = snapshots_to_keep(&times, 50);
        assert_eq!(keep.len(), 10);
    }

    #[test]
    fn snapshots_to_keep_thins_exponentially_recent_dense() {
        use chrono::TimeZone;
        let base = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let times: Vec<_> = (0..500i64).map(|h| base + chrono::Duration::hours(h)).collect();
        let max = 50;
        let keep = snapshots_to_keep(&times, max);

        // Endpoints always retained.
        assert!(keep.contains(&0), "oldest baseline must be kept");
        assert!(keep.contains(&499), "newest must be kept");
        assert!(keep.len() <= max, "must respect the budget");

        // Recency bias: the recent half is kept more densely than the old half.
        let recent = keep.iter().filter(|&&i| i >= 250).count();
        let old = keep.iter().filter(|&&i| i < 250).count();
        assert!(recent > old, "recent {recent} should be denser than old {old}");

        // No catastrophic middle gap: every quarter of the timeline has coverage.
        for q in 0..4 {
            let lo = q * 125;
            let hi = lo + 125;
            assert!(
                keep.iter().any(|&i| (lo..hi).contains(&i)),
                "quarter {q} ({lo}..{hi}) has no retained snapshot"
            );
        }
    }

    #[test]
    fn snapshots_to_keep_preserves_history_depth_under_iteration() {
        use chrono::TimeZone;
        // Simulate steady-state operation: append one snapshot per "day" and
        // prune each round, for far more rounds than the budget. The middle of
        // the history must NOT erode away to just the two endpoints.
        let base = Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap();
        let max = 50;
        let mut alive: Vec<DateTime<Utc>> = Vec::new();
        for day in 0..400i64 {
            alive.push(base + chrono::Duration::days(day));
            let keep = snapshots_to_keep(&alive, max);
            // BTreeSet yields ascending indices and `alive` is ascending by time,
            // so the survivors stay chronologically sorted.
            alive = keep.iter().map(|&i| alive[i]).collect();
        }

        assert_eq!(alive.first().copied(), Some(base), "oldest baseline lost");
        assert_eq!(
            alive.last().copied(),
            Some(base + chrono::Duration::days(399)),
            "newest lost"
        );
        assert!(alive.len() <= max, "budget exceeded: {}", alive.len());
        assert!(
            alive.len() >= 20,
            "history depth collapsed under iteration: only {} kept",
            alive.len()
        );

        // A genuinely mid-aged snapshot survived (not just recent + endpoints).
        let newest = *alive.last().unwrap();
        let has_mid = alive.iter().any(|t| {
            let age_days = (newest - *t).num_days();
            (100..300).contains(&age_days)
        });
        assert!(has_mid, "no mid-history snapshot retained across iterations");
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
