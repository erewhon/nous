//! Per-page operation log with hash chain and block-level change tracking.
//!
//! Each page gets a `.oplog` file (JSONL) alongside its `.json` file.
//! Every save appends a record with:
//! - Timestamp and client ID
//! - SHA-256 content hash (for corruption detection)
//! - Previous hash (hash chain)
//! - Block-level changes (insert/modify/delete per block)

use std::fs::{self, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::models::{EditorBlock, EditorData};

/// Type of operation recorded in the oplog
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum OpType {
    Create,
    Modify,
    Delete,
    Restore,
}

/// Block-level change within a single save
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockChange {
    pub block_id: String,
    pub op: BlockOp,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub block_type: Option<String>,
    /// For inserts: the block ID this was inserted after (None = first block)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after_block_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum BlockOp {
    Insert,
    Modify,
    Delete,
    Move,
}

/// A single oplog entry (one line of JSONL)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OplogEntry {
    pub ts: DateTime<Utc>,
    pub client_id: String,
    pub op: OpType,
    pub content_hash: String,
    pub prev_hash: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub block_changes: Vec<BlockChange>,
    /// Number of blocks in the page after this operation
    pub block_count: usize,
}

/// Compute SHA-256 hash of page content JSON
pub fn content_hash(content: &EditorData) -> String {
    let json = serde_json::to_string(content).unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(json.as_bytes());
    format!("sha256:{:x}", hasher.finalize())
}

/// Diff two EditorData snapshots to produce block-level changes.
/// Both old and new blocks are expected to have stable UUIDs as IDs.
pub fn diff_blocks(old: &EditorData, new: &EditorData) -> Vec<BlockChange> {
    use std::collections::HashMap;

    let old_map: HashMap<&str, (usize, &EditorBlock)> = old
        .blocks
        .iter()
        .enumerate()
        .map(|(i, b)| (b.id.as_str(), (i, b)))
        .collect();

    let new_map: HashMap<&str, (usize, &EditorBlock)> = new
        .blocks
        .iter()
        .enumerate()
        .map(|(i, b)| (b.id.as_str(), (i, b)))
        .collect();

    let mut changes = Vec::new();

    // Detect inserts, modifications, and moves
    for (i, block) in new.blocks.iter().enumerate() {
        let after_id = if i > 0 {
            Some(new.blocks[i - 1].id.clone())
        } else {
            None
        };

        match old_map.get(block.id.as_str()) {
            None => {
                // Block not in old → inserted
                changes.push(BlockChange {
                    block_id: block.id.clone(),
                    op: BlockOp::Insert,
                    block_type: Some(block.block_type.clone()),
                    after_block_id: after_id,
                });
            }
            Some((old_idx, old_block)) => {
                // Check if content changed
                if old_block.data != block.data || old_block.block_type != block.block_type {
                    changes.push(BlockChange {
                        block_id: block.id.clone(),
                        op: BlockOp::Modify,
                        block_type: Some(block.block_type.clone()),
                        after_block_id: None,
                    });
                }
                // Check if position changed (moved) — only if content didn't change
                else if *old_idx != i {
                    changes.push(BlockChange {
                        block_id: block.id.clone(),
                        op: BlockOp::Move,
                        block_type: Some(block.block_type.clone()),
                        after_block_id: after_id,
                    });
                }
            }
        }
    }

    // Detect deletions (in old but not in new)
    for block in &old.blocks {
        if !new_map.contains_key(block.id.as_str()) {
            changes.push(BlockChange {
                block_id: block.id.clone(),
                op: BlockOp::Delete,
                block_type: Some(block.block_type.clone()),
                after_block_id: None,
            });
        }
    }

    changes
}

/// Get the oplog file path for a page
pub fn oplog_path(pages_dir: &Path, page_id: uuid::Uuid) -> PathBuf {
    pages_dir.join(format!("{}.oplog", page_id))
}

/// Read the last entry's content_hash from an oplog file.
/// Returns "genesis" if the file doesn't exist or is empty.
pub fn read_last_hash(path: &Path) -> String {
    if !path.exists() {
        return "genesis".to_string();
    }

    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return "genesis".to_string(),
    };

    let reader = BufReader::new(file);
    let mut last_hash = "genesis".to_string();

    for line in reader.lines() {
        if let Ok(line) = line {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(entry) = serde_json::from_str::<OplogEntry>(trimmed) {
                last_hash = entry.content_hash;
            }
        }
    }

    last_hash
}

/// Append an oplog entry to the page's oplog file.
pub fn append_entry(path: &Path, entry: &OplogEntry) -> std::io::Result<()> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;

    let json = serde_json::to_string(entry).map_err(|e| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, e)
    })?;
    writeln!(file, "{}", json)?;

    Ok(())
}

/// Read all oplog entries for a page. Returns entries in chronological order.
pub fn read_entries(path: &Path) -> Vec<OplogEntry> {
    if !path.exists() {
        return Vec::new();
    }

    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };

    let reader = BufReader::new(file);
    let mut entries = Vec::new();

    for line in reader.lines() {
        if let Ok(line) = line {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(entry) = serde_json::from_str::<OplogEntry>(trimmed) {
                entries.push(entry);
            }
        }
    }

    entries
}

/// Read the last N oplog entries for a page. More efficient than reading all.
pub fn read_last_n_entries(path: &Path, n: usize) -> Vec<OplogEntry> {
    if !path.exists() || n == 0 {
        return Vec::new();
    }

    let file = match fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return Vec::new(),
    };

    let reader = BufReader::new(file);
    let mut ring: Vec<OplogEntry> = Vec::with_capacity(n);

    for line in reader.lines() {
        if let Ok(line) = line {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(entry) = serde_json::from_str::<OplogEntry>(trimmed) {
                if ring.len() >= n {
                    ring.remove(0);
                }
                ring.push(entry);
            }
        }
    }

    ring
}

/// Verify the hash chain integrity of an oplog.
/// Returns Ok(()) if valid, or Err with the index of the first broken link.
pub fn verify_chain(path: &Path) -> Result<(), usize> {
    let entries = read_entries(path);
    let mut expected_prev = "genesis".to_string();

    for (i, entry) in entries.iter().enumerate() {
        if entry.prev_hash != expected_prev {
            return Err(i);
        }
        expected_prev = entry.content_hash.clone();
    }

    Ok(())
}

/// Get a client ID for this device (hostname-based, stable across restarts).
pub fn get_client_id() -> String {
    hostname::get()
        .map(|h| h.to_string_lossy().to_string())
        .unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    fn make_block(id: &str, block_type: &str, text: &str) -> EditorBlock {
        EditorBlock {
            id: id.to_string(),
            block_type: block_type.to_string(),
            data: json!({ "text": text }),
        }
    }

    fn make_editor_data(blocks: Vec<EditorBlock>) -> EditorData {
        EditorData {
            time: Some(1000),
            version: Some("2.28.0".to_string()),
            blocks,
        }
    }

    #[test]
    fn test_content_hash_deterministic() {
        let data = make_editor_data(vec![make_block("a", "paragraph", "hello")]);
        let h1 = content_hash(&data);
        let h2 = content_hash(&data);
        assert_eq!(h1, h2);
        assert!(h1.starts_with("sha256:"));
    }

    /// Known hash for cross-language compatibility with Python page_storage.py.
    /// If this test fails, the Python and Rust hashes have diverged.
    #[test]
    fn test_content_hash_cross_compat() {
        let data = make_editor_data(vec![make_block("abc", "paragraph", "hello")]);
        let hash = content_hash(&data);
        assert_eq!(
            hash,
            "sha256:88be9bf189ecc5accc9152e7f6eb9b66443c26247150c4f441239c8794072339",
            "Hash must match Python nous_ai.page_storage._content_hash for same input"
        );
    }

    #[test]
    fn test_diff_blocks_no_changes() {
        let data = make_editor_data(vec![
            make_block("a", "paragraph", "hello"),
            make_block("b", "paragraph", "world"),
        ]);
        let changes = diff_blocks(&data, &data);
        assert!(changes.is_empty());
    }

    #[test]
    fn test_diff_blocks_insert() {
        let old = make_editor_data(vec![make_block("a", "paragraph", "hello")]);
        let new = make_editor_data(vec![
            make_block("a", "paragraph", "hello"),
            make_block("b", "paragraph", "world"),
        ]);
        let changes = diff_blocks(&old, &new);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].op, BlockOp::Insert);
        assert_eq!(changes[0].block_id, "b");
        assert_eq!(changes[0].after_block_id, Some("a".to_string()));
    }

    #[test]
    fn test_diff_blocks_delete() {
        let old = make_editor_data(vec![
            make_block("a", "paragraph", "hello"),
            make_block("b", "paragraph", "world"),
        ]);
        let new = make_editor_data(vec![make_block("a", "paragraph", "hello")]);
        let changes = diff_blocks(&old, &new);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].op, BlockOp::Delete);
        assert_eq!(changes[0].block_id, "b");
    }

    #[test]
    fn test_diff_blocks_modify() {
        let old = make_editor_data(vec![make_block("a", "paragraph", "hello")]);
        let new = make_editor_data(vec![make_block("a", "paragraph", "goodbye")]);
        let changes = diff_blocks(&old, &new);
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0].op, BlockOp::Modify);
        assert_eq!(changes[0].block_id, "a");
    }

    #[test]
    fn test_diff_blocks_move() {
        let old = make_editor_data(vec![
            make_block("a", "paragraph", "first"),
            make_block("b", "paragraph", "second"),
        ]);
        let new = make_editor_data(vec![
            make_block("b", "paragraph", "second"),
            make_block("a", "paragraph", "first"),
        ]);
        let changes = diff_blocks(&old, &new);
        // Both blocks moved
        assert!(changes.iter().any(|c| c.op == BlockOp::Move && c.block_id == "b"));
        assert!(changes.iter().any(|c| c.op == BlockOp::Move && c.block_id == "a"));
    }

    #[test]
    fn test_oplog_roundtrip() {
        let dir = std::env::temp_dir().join(format!("oplog_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let page_id = Uuid::new_v4();
        let path = oplog_path(&dir, page_id);

        let entry = OplogEntry {
            ts: Utc::now(),
            client_id: "test-host".to_string(),
            op: OpType::Modify,
            content_hash: "sha256:abc123".to_string(),
            prev_hash: "genesis".to_string(),
            block_changes: vec![BlockChange {
                block_id: "block-1".to_string(),
                op: BlockOp::Modify,
                block_type: Some("paragraph".to_string()),
                after_block_id: None,
            }],
            block_count: 5,
        };

        append_entry(&path, &entry).unwrap();

        let entries = read_entries(&path);
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].content_hash, "sha256:abc123");
        assert_eq!(entries[0].block_changes.len(), 1);

        // Verify hash chain
        assert!(verify_chain(&path).is_ok());

        // Clean up
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_hash_chain_detection() {
        let dir = std::env::temp_dir().join(format!("oplog_chain_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();

        let page_id = Uuid::new_v4();
        let path = oplog_path(&dir, page_id);

        // Write two valid entries
        let entry1 = OplogEntry {
            ts: Utc::now(),
            client_id: "test".to_string(),
            op: OpType::Create,
            content_hash: "sha256:aaa".to_string(),
            prev_hash: "genesis".to_string(),
            block_changes: vec![],
            block_count: 1,
        };
        append_entry(&path, &entry1).unwrap();

        let entry2 = OplogEntry {
            ts: Utc::now(),
            client_id: "test".to_string(),
            op: OpType::Modify,
            content_hash: "sha256:bbb".to_string(),
            prev_hash: "sha256:aaa".to_string(),
            block_changes: vec![],
            block_count: 2,
        };
        append_entry(&path, &entry2).unwrap();

        assert!(verify_chain(&path).is_ok());

        // Write a broken entry (wrong prev_hash)
        let entry3 = OplogEntry {
            ts: Utc::now(),
            client_id: "test".to_string(),
            op: OpType::Modify,
            content_hash: "sha256:ccc".to_string(),
            prev_hash: "sha256:WRONG".to_string(),
            block_changes: vec![],
            block_count: 3,
        };
        append_entry(&path, &entry3).unwrap();

        assert_eq!(verify_chain(&path), Err(2));

        let _ = fs::remove_dir_all(&dir);
    }
}
