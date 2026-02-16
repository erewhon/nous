//! Live CRDT store for open pages with per-pane base tracking.
//!
//! The CrdtStore holds in-memory CRDT documents for pages that are currently
//! open in editor panes.  Each pane tracks the EditorData it was loaded with
//! ("base"), so that on save the diff is computed against *that pane's* base
//! rather than the CRDT's current state.  This ensures multi-pane edits merge
//! correctly — pane B's save won't undo pane A's earlier changes.

use std::collections::HashMap;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use uuid::Uuid;
use yrs::{Map, ReadTxn, Transact, WriteTxn};

use super::converter::{CRDTError, PageDocument};
use crate::storage::oplog::diff_blocks;
use crate::storage::EditorData;

/// A page that is currently open in at least one editor pane.
struct LivePage {
    doc: PageDocument,
    /// Per-pane base: the EditorData this pane was loaded with / last saw.
    pane_bases: HashMap<String, EditorData>,
    notebook_id: Uuid,
}

/// In-memory store of live CRDT documents for open pages.
pub struct CrdtStore {
    live: Mutex<HashMap<Uuid, LivePage>>,
    data_dir: Mutex<PathBuf>,
}

impl CrdtStore {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            live: Mutex::new(HashMap::new()),
            data_dir: Mutex::new(data_dir),
        }
    }

    /// Update the data directory (used on library switch).
    ///
    /// Clears all live pages (they belong to the old library) and updates the path.
    pub fn set_data_dir(&self, new_path: PathBuf) {
        {
            let mut live = self.live.lock().unwrap();
            live.clear();
        }
        {
            let mut data_dir = self.data_dir.lock().unwrap();
            *data_dir = new_path;
        }
        log::info!("CrdtStore: data_dir updated, all live pages cleared");
    }

    /// CRDT state file path: {data_dir}/notebooks/{notebook_id}/sync/pages/{page_id}.crdt
    fn crdt_path(&self, notebook_id: Uuid, page_id: Uuid) -> PathBuf {
        let data_dir = self.data_dir.lock().unwrap();
        data_dir
            .join("notebooks")
            .join(notebook_id.to_string())
            .join("sync")
            .join("pages")
            .join(format!("{}.crdt", page_id))
    }

    /// Binary updates log path: {data_dir}/notebooks/{notebook_id}/sync/pages/{page_id}.updates
    fn updates_path(&self, notebook_id: Uuid, page_id: Uuid) -> PathBuf {
        let data_dir = self.data_dir.lock().unwrap();
        data_dir
            .join("notebooks")
            .join(notebook_id.to_string())
            .join("sync")
            .join("pages")
            .join(format!("{}.updates", page_id))
    }

    /// Register a pane as having opened a page.
    ///
    /// Loads or creates the CRDT document and stores the pane's base.
    pub fn open_page(
        &self,
        notebook_id: Uuid,
        page_id: Uuid,
        pane_id: &str,
        content: &EditorData,
    ) -> Result<(), CRDTError> {
        let mut live = self.live.lock().unwrap();

        if let Some(page) = live.get_mut(&page_id) {
            // Page already open in another pane — just register this pane's base.
            // Use the current CRDT state as this pane's base (so it sees all
            // existing changes).
            let current = page.doc.to_editor_data()?;
            page.pane_bases.insert(pane_id.to_string(), current);
            return Ok(());
        }

        // Load existing CRDT state from disk, or create from content
        let crdt_path = self.crdt_path(notebook_id, page_id);
        let doc = if crdt_path.exists() {
            let data = fs::read(&crdt_path)
                .map_err(|e| CRDTError::DecodeError(format!("Failed to read CRDT file: {}", e)))?;
            let doc = PageDocument::from_state(&data)?;

            // If content is newer (has changes not in CRDT), update CRDT from content.
            // This handles the case where saves happened without the CRDT store running.
            let crdt_data = doc.to_editor_data()?;
            let changes = diff_blocks(&crdt_data, content);
            if !changes.is_empty() {
                let update = doc.apply_block_changes(
                    &changes,
                    &content.blocks,
                    content.time,
                    content.version.as_deref(),
                )?;
                // Persist the catch-up update
                if !update.is_empty() {
                    let updates_path = self.updates_path(notebook_id, page_id);
                    let _ = append_binary_update(&updates_path, &update);
                }
                // Flush updated CRDT state
                let state = doc.encode_state();
                if let Some(parent) = crdt_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(&crdt_path, &state);
            }

            doc
        } else {
            PageDocument::from_editor_data(content)?
        };

        // Set pane base to the current CRDT state (which now includes content)
        let base = doc.to_editor_data()?;
        let mut pane_bases = HashMap::new();
        pane_bases.insert(pane_id.to_string(), base);

        live.insert(
            page_id,
            LivePage {
                doc,
                pane_bases,
                notebook_id,
            },
        );

        Ok(())
    }

    /// Apply a save from a specific pane.
    ///
    /// Diffs the pane's base against `new_content`, applies mutations to the
    /// CRDT, and returns the canonical EditorData (which may differ from what
    /// the pane sent if another pane has also made changes).
    ///
    /// Returns `Ok(Some(canonical))` if the page is live, `Ok(None)` if not.
    pub fn apply_save(
        &self,
        page_id: Uuid,
        pane_id: &str,
        new_content: &EditorData,
    ) -> Result<Option<EditorData>, CRDTError> {
        let mut live = self.live.lock().unwrap();

        let page = match live.get_mut(&page_id) {
            Some(p) => p,
            None => return Ok(None),
        };

        // Get or default the pane's base
        let base = page.pane_bases.get(pane_id).cloned().unwrap_or_else(|| {
            // Pane wasn't registered (e.g. backward compat) — use CRDT current state
            page.doc
                .to_editor_data()
                .unwrap_or_else(|_| EditorData::default())
        });

        // Compute what this pane actually changed
        let changes = diff_blocks(&base, new_content);

        if !changes.is_empty() {
            let update = page.doc.apply_block_changes(
                &changes,
                &new_content.blocks,
                new_content.time,
                new_content.version.as_deref(),
            )?;

            // Append binary update to log
            if !update.is_empty() {
                let updates_path = self.updates_path(page.notebook_id, page_id);
                let _ = append_binary_update(&updates_path, &update);
            }

            // Flush CRDT state to disk
            let crdt_path = self.crdt_path(page.notebook_id, page_id);
            let state = page.doc.encode_state();
            if let Some(parent) = crdt_path.parent() {
                let _ = fs::create_dir_all(parent);
            }
            let _ = fs::write(&crdt_path, &state);
        } else {
            // Even with no block changes, update time/version metadata
            let sv_before = {
                let txn = page.doc.doc.transact();
                txn.state_vector()
            };
            {
                let mut txn = page.doc.doc.transact_mut();
                let root = txn.get_or_insert_map("page");
                if let Some(time) = new_content.time {
                    root.insert(&mut txn, "time", time);
                }
                if let Some(version) = &new_content.version {
                    root.insert(&mut txn, "version", version.clone());
                }
            }
        }

        // Derive canonical state from CRDT
        let canonical = page.doc.to_editor_data()?;

        // Update this pane's base to canonical
        page.pane_bases
            .insert(pane_id.to_string(), canonical.clone());

        Ok(Some(canonical))
    }

    /// Unregister a pane from a page.  If no panes remain, flush to disk and remove.
    pub fn close_pane(&self, page_id: Uuid, pane_id: &str) {
        let mut live = self.live.lock().unwrap();

        let should_remove = if let Some(page) = live.get_mut(&page_id) {
            page.pane_bases.remove(pane_id);
            page.pane_bases.is_empty()
        } else {
            false
        };

        if should_remove {
            if let Some(page) = live.remove(&page_id) {
                // Final flush to disk
                let crdt_path = self.crdt_path(page.notebook_id, page_id);
                let state = page.doc.encode_state();
                if let Some(parent) = crdt_path.parent() {
                    let _ = fs::create_dir_all(parent);
                }
                let _ = fs::write(&crdt_path, &state);
            }
        }
    }

    /// Check if a page is currently live (open in at least one pane).
    pub fn is_live(&self, page_id: Uuid) -> bool {
        let live = self.live.lock().unwrap();
        live.contains_key(&page_id)
    }

    /// Get the full encoded CRDT state for a live page (for sync manager).
    pub fn get_encoded_state(&self, page_id: Uuid) -> Option<Vec<u8>> {
        let live = self.live.lock().unwrap();
        live.get(&page_id).map(|p| p.doc.encode_state())
    }

    /// Apply a remote update to a live page (from sync manager).
    ///
    /// Returns the new canonical EditorData if the page is live.
    pub fn apply_remote_update(
        &self,
        page_id: Uuid,
        update: &[u8],
    ) -> Result<Option<EditorData>, CRDTError> {
        let mut live = self.live.lock().unwrap();

        let page = match live.get_mut(&page_id) {
            Some(p) => p,
            None => return Ok(None),
        };

        page.doc.apply_update(update)?;

        let canonical = page.doc.to_editor_data()?;

        // Update all pane bases to the new canonical state so that
        // subsequent saves from those panes won't diff against stale bases
        // (which would undo the remote changes).
        for base in page.pane_bases.values_mut() {
            *base = canonical.clone();
        }

        Ok(Some(canonical))
    }
}

// --- Binary Update Log ---

/// Append a length-prefixed binary update to the `.updates` file.
///
/// Format: [4 bytes: u32 LE length][N bytes: Yrs v1 binary update]
fn append_binary_update(path: &Path, update: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    let len = update.len() as u32;
    file.write_all(&len.to_le_bytes())?;
    file.write_all(update)?;
    Ok(())
}

/// Read all binary updates from a `.updates` file.
pub fn read_binary_updates(path: &Path) -> io::Result<Vec<Vec<u8>>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = fs::read(path)?;
    let mut updates = Vec::new();
    let mut cursor = 0;
    while cursor + 4 <= data.len() {
        let len = u32::from_le_bytes([
            data[cursor],
            data[cursor + 1],
            data[cursor + 2],
            data[cursor + 3],
        ]) as usize;
        cursor += 4;
        if cursor + len > data.len() {
            break; // truncated frame — stop reading
        }
        updates.push(data[cursor..cursor + len].to_vec());
        cursor += len;
    }
    Ok(updates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::EditorBlock;

    fn make_block(id: &str, btype: &str, text: &str) -> EditorBlock {
        EditorBlock {
            id: id.to_string(),
            block_type: btype.to_string(),
            data: serde_json::json!({"text": text}),
        }
    }

    fn make_data(blocks: Vec<EditorBlock>) -> EditorData {
        EditorData {
            time: Some(1000),
            version: Some("2.28.0".to_string()),
            blocks,
        }
    }

    #[test]
    fn test_open_and_apply_save() {
        let dir = std::env::temp_dir().join(format!("crdt_store_test_{}", Uuid::new_v4()));
        let store = CrdtStore::new(dir.clone());
        let nb_id = Uuid::new_v4();
        let page_id = Uuid::new_v4();

        let content = make_data(vec![make_block("a", "paragraph", "hello")]);
        store.open_page(nb_id, page_id, "pane1", &content).unwrap();

        assert!(store.is_live(page_id));

        // Save with a new block added
        let new_content = make_data(vec![
            make_block("a", "paragraph", "hello"),
            make_block("b", "paragraph", "world"),
        ]);
        let canonical = store
            .apply_save(page_id, "pane1", &new_content)
            .unwrap()
            .unwrap();
        assert_eq!(canonical.blocks.len(), 2);
        assert_eq!(canonical.blocks[1].id, "b");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_multi_pane_merge() {
        let dir = std::env::temp_dir().join(format!("crdt_store_test_{}", Uuid::new_v4()));
        let store = CrdtStore::new(dir.clone());
        let nb_id = Uuid::new_v4();
        let page_id = Uuid::new_v4();

        let initial = make_data(vec![
            make_block("a", "paragraph", "block A"),
            make_block("b", "paragraph", "block B"),
        ]);

        // Open in two panes
        store.open_page(nb_id, page_id, "pane1", &initial).unwrap();
        store.open_page(nb_id, page_id, "pane2", &initial).unwrap();

        // Pane 1 adds block C
        let pane1_content = make_data(vec![
            make_block("a", "paragraph", "block A"),
            make_block("b", "paragraph", "block B"),
            make_block("c", "paragraph", "block C"),
        ]);
        let after_pane1 = store
            .apply_save(page_id, "pane1", &pane1_content)
            .unwrap()
            .unwrap();
        assert_eq!(after_pane1.blocks.len(), 3);

        // Pane 2 adds block D (based on its original base, before pane1's save)
        let pane2_content = make_data(vec![
            make_block("a", "paragraph", "block A"),
            make_block("b", "paragraph", "block B"),
            make_block("d", "paragraph", "block D"),
        ]);
        let after_pane2 = store
            .apply_save(page_id, "pane2", &pane2_content)
            .unwrap()
            .unwrap();
        // Both C and D should be preserved
        assert_eq!(after_pane2.blocks.len(), 4);
        let ids: Vec<&str> = after_pane2.blocks.iter().map(|b| b.id.as_str()).collect();
        assert!(ids.contains(&"c"), "block C should be preserved");
        assert!(ids.contains(&"d"), "block D should be preserved");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_close_pane_flushes_and_removes() {
        let dir = std::env::temp_dir().join(format!("crdt_store_test_{}", Uuid::new_v4()));
        let store = CrdtStore::new(dir.clone());
        let nb_id = Uuid::new_v4();
        let page_id = Uuid::new_v4();

        let content = make_data(vec![make_block("a", "paragraph", "hello")]);
        store.open_page(nb_id, page_id, "pane1", &content).unwrap();
        assert!(store.is_live(page_id));

        store.close_pane(page_id, "pane1");
        assert!(!store.is_live(page_id));

        // CRDT file should exist on disk
        let crdt_path = store.crdt_path(nb_id, page_id);
        assert!(crdt_path.exists());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_apply_save_not_live_returns_none() {
        let dir = std::env::temp_dir().join(format!("crdt_store_test_{}", Uuid::new_v4()));
        let store = CrdtStore::new(dir.clone());
        let page_id = Uuid::new_v4();

        let content = make_data(vec![make_block("a", "paragraph", "hello")]);
        let result = store.apply_save(page_id, "pane1", &content).unwrap();
        assert!(result.is_none());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_binary_update_log_roundtrip() {
        let dir = std::env::temp_dir().join(format!("crdt_updates_test_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("test.updates");

        let update1 = vec![1, 2, 3, 4, 5];
        let update2 = vec![10, 20, 30];
        append_binary_update(&path, &update1).unwrap();
        append_binary_update(&path, &update2).unwrap();

        let updates = read_binary_updates(&path).unwrap();
        assert_eq!(updates.len(), 2);
        assert_eq!(updates[0], update1);
        assert_eq!(updates[1], update2);

        let _ = fs::remove_dir_all(&dir);
    }
}
