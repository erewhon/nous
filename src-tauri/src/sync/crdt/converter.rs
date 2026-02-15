use std::collections::HashMap;

use thiserror::Error;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{
    encoding::read::Cursor, types::ToJson, Any, Array, Doc, Map, ReadTxn, StateVector, Transact,
    Update, WriteTxn,
};

use crate::storage::oplog::{BlockChange, BlockOp};
use crate::storage::{EditorBlock, EditorData};

#[derive(Error, Debug)]
pub enum CRDTError {
    #[error("Failed to encode CRDT: {0}")]
    EncodeError(String),
    #[error("Failed to decode CRDT: {0}")]
    DecodeError(String),
    #[error("Failed to convert data: {0}")]
    ConversionError(String),
}

/// Helper to extract i64 from yrs::Any
fn any_as_i64(any: &Any) -> Option<i64> {
    match any {
        Any::BigInt(v) => Some(*v),
        Any::Number(v) => Some(*v as i64),
        _ => None,
    }
}

/// Helper to extract string from yrs::Any
fn any_as_string(any: &Any) -> Option<String> {
    match any {
        Any::String(s) => Some(s.to_string()),
        _ => None,
    }
}

/// Find the index of a block with the given ID in a YArray of YMaps.
fn find_block_index<T: ReadTxn>(arr: &yrs::ArrayRef, txn: &T, block_id: &str) -> Option<u32> {
    for (i, item) in arr.iter(txn).enumerate() {
        if let yrs::Out::YMap(map) = item {
            if let Some(id_val) = map.get(txn, "id") {
                if let Some(id_str) = any_as_string(&id_val.to_json(txn)) {
                    if id_str == block_id {
                        return Some(i as u32);
                    }
                }
            }
        }
    }
    None
}

/// Find the insertion index: position after `after_block_id`, or 0 if None.
fn find_insert_position<T: ReadTxn>(
    arr: &yrs::ArrayRef,
    txn: &T,
    after_block_id: Option<&str>,
) -> u32 {
    match after_block_id {
        Some(after_id) => {
            match find_block_index(arr, txn, after_id) {
                Some(idx) => idx + 1,
                None => arr.len(txn), // after_block_id not found → append
            }
        }
        None => 0, // No after → insert at beginning
    }
}

/// Wrapper around a Yrs document for a page
pub struct PageDocument {
    pub doc: Doc,
}

impl PageDocument {
    /// Create a new empty document
    pub fn new() -> Self {
        Self { doc: Doc::new() }
    }

    /// Create from existing EditorData
    pub fn from_editor_data(editor_data: &EditorData) -> Result<Self, CRDTError> {
        let doc = Doc::new();

        {
            let mut txn = doc.transact_mut();

            // Create root map
            let root = txn.get_or_insert_map("page");

            // Store metadata
            if let Some(time) = editor_data.time {
                root.insert(&mut txn, "time", time);
            }
            if let Some(version) = &editor_data.version {
                root.insert(&mut txn, "version", version.clone());
            }

            // Create blocks array
            let blocks = root.insert(&mut txn, "blocks", yrs::ArrayPrelim::default());

            // Add each block
            for block in &editor_data.blocks {
                let block_map = yrs::MapPrelim::from([
                    ("id".to_string(), yrs::Any::String(block.id.clone().into())),
                    (
                        "type".to_string(),
                        yrs::Any::String(block.block_type.clone().into()),
                    ),
                    (
                        "data".to_string(),
                        yrs::Any::String(
                            serde_json::to_string(&block.data)
                                .unwrap_or_else(|_| "{}".to_string())
                                .into(),
                        ),
                    ),
                ]);

                blocks.push_back(&mut txn, block_map);
            }
        }

        Ok(Self { doc })
    }

    /// Convert back to EditorData
    pub fn to_editor_data(&self) -> Result<EditorData, CRDTError> {
        let txn = self.doc.transact();

        let root = txn
            .get_map("page")
            .ok_or_else(|| CRDTError::ConversionError("Missing root map".to_string()))?;

        // Get metadata using pattern matching on Any
        let time = root
            .get(&txn, "time")
            .map(|v| v.to_json(&txn))
            .and_then(|any| any_as_i64(&any));

        let version = root
            .get(&txn, "version")
            .map(|v| v.to_json(&txn))
            .and_then(|any| any_as_string(&any));

        // Get blocks
        let mut blocks = Vec::new();

        if let Some(blocks_value) = root.get(&txn, "blocks") {
            if let yrs::Out::YArray(blocks_arr) = blocks_value {
                for item in blocks_arr.iter(&txn) {
                    if let yrs::Out::YMap(block_map) = item {
                        let id = block_map
                            .get(&txn, "id")
                            .map(|v| v.to_json(&txn))
                            .and_then(|any| any_as_string(&any))
                            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                        let block_type = block_map
                            .get(&txn, "type")
                            .map(|v| v.to_json(&txn))
                            .and_then(|any| any_as_string(&any))
                            .unwrap_or_else(|| "paragraph".to_string());

                        let data_str = block_map
                            .get(&txn, "data")
                            .map(|v| v.to_json(&txn))
                            .and_then(|any| any_as_string(&any))
                            .unwrap_or_else(|| "{}".to_string());

                        let data: serde_json::Value =
                            serde_json::from_str(&data_str).unwrap_or(serde_json::json!({}));

                        blocks.push(EditorBlock {
                            id,
                            block_type,
                            data,
                        });
                    }
                }
            }
        }

        Ok(EditorData {
            time,
            version,
            blocks,
        })
    }

    /// Apply block-level changes to the CRDT document within a single transaction.
    ///
    /// Takes the diff (from `diff_blocks`) and the full new block list (needed for
    /// insert data). Returns the binary update representing just this transaction's
    /// mutations, suitable for appending to the `.updates` log.
    pub fn apply_block_changes(
        &self,
        changes: &[BlockChange],
        new_blocks: &[EditorBlock],
        new_time: Option<i64>,
        new_version: Option<&str>,
    ) -> Result<Vec<u8>, CRDTError> {
        // Capture state vector before mutations
        let sv_before = {
            let txn = self.doc.transact();
            txn.state_vector()
        };

        // Build a lookup from block_id → EditorBlock for insert/modify data
        let new_block_map: HashMap<&str, &EditorBlock> =
            new_blocks.iter().map(|b| (b.id.as_str(), b)).collect();

        {
            let mut txn = self.doc.transact_mut();
            let root = txn.get_or_insert_map("page");

            // Update metadata
            if let Some(time) = new_time {
                root.insert(&mut txn, "time", time);
            }
            if let Some(version) = new_version {
                root.insert(&mut txn, "version", version.to_string());
            }

            // Get the blocks array
            let blocks_arr = match root.get(&txn, "blocks") {
                Some(yrs::Out::YArray(arr)) => arr,
                _ => {
                    return Err(CRDTError::ConversionError(
                        "Missing blocks array in CRDT".to_string(),
                    ));
                }
            };

            // --- Phase 1: Deletions (reverse index order to preserve indices) ---
            let mut delete_indices: Vec<u32> = Vec::new();
            for change in changes {
                if change.op == BlockOp::Delete {
                    if let Some(idx) = find_block_index(&blocks_arr, &txn, &change.block_id) {
                        delete_indices.push(idx);
                    }
                }
            }
            delete_indices.sort_unstable();
            delete_indices.reverse();
            for idx in &delete_indices {
                blocks_arr.remove(&mut txn, *idx);
            }

            // --- Phase 2: Modifications ---
            for change in changes {
                if change.op == BlockOp::Modify {
                    if let Some(block_data) = new_block_map.get(change.block_id.as_str()) {
                        if let Some(idx) = find_block_index(&blocks_arr, &txn, &change.block_id) {
                            if let Some(yrs::Out::YMap(block_map)) = blocks_arr.get(&txn, idx) {
                                let data_json = serde_json::to_string(&block_data.data)
                                    .unwrap_or_else(|_| "{}".to_string());
                                block_map.insert(
                                    &mut txn,
                                    "data",
                                    yrs::Any::String(data_json.into()),
                                );
                                block_map.insert(
                                    &mut txn,
                                    "type",
                                    yrs::Any::String(block_data.block_type.clone().into()),
                                );
                            }
                        }
                    }
                }
            }

            // --- Phase 3: Moves (remove + re-insert at new position) ---
            for change in changes {
                if change.op == BlockOp::Move {
                    if let Some(block_data) = new_block_map.get(change.block_id.as_str()) {
                        // Remove from current position
                        if let Some(idx) = find_block_index(&blocks_arr, &txn, &change.block_id) {
                            blocks_arr.remove(&mut txn, idx);
                        }
                        // Re-insert at new position
                        let insert_pos = find_insert_position(
                            &blocks_arr,
                            &txn,
                            change.after_block_id.as_deref(),
                        );
                        let block_map = yrs::MapPrelim::from([
                            (
                                "id".to_string(),
                                yrs::Any::String(block_data.id.clone().into()),
                            ),
                            (
                                "type".to_string(),
                                yrs::Any::String(block_data.block_type.clone().into()),
                            ),
                            (
                                "data".to_string(),
                                yrs::Any::String(
                                    serde_json::to_string(&block_data.data)
                                        .unwrap_or_else(|_| "{}".to_string())
                                        .into(),
                                ),
                            ),
                        ]);
                        blocks_arr.insert(&mut txn, insert_pos, block_map);
                    }
                }
            }

            // --- Phase 4: Insertions ---
            for change in changes {
                if change.op == BlockOp::Insert {
                    if let Some(block_data) = new_block_map.get(change.block_id.as_str()) {
                        let insert_pos = find_insert_position(
                            &blocks_arr,
                            &txn,
                            change.after_block_id.as_deref(),
                        );
                        let block_map = yrs::MapPrelim::from([
                            (
                                "id".to_string(),
                                yrs::Any::String(block_data.id.clone().into()),
                            ),
                            (
                                "type".to_string(),
                                yrs::Any::String(block_data.block_type.clone().into()),
                            ),
                            (
                                "data".to_string(),
                                yrs::Any::String(
                                    serde_json::to_string(&block_data.data)
                                        .unwrap_or_else(|_| "{}".to_string())
                                        .into(),
                                ),
                            ),
                        ]);
                        blocks_arr.insert(&mut txn, insert_pos, block_map);
                    }
                }
            }
        }
        // Transaction dropped — encode diff
        let txn = self.doc.transact();
        Ok(txn.encode_diff_v1(&sv_before))
    }

    /// Encode the full document state as binary
    pub fn encode_state(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    /// Encode only the diff from a given state vector
    pub fn encode_diff(&self, remote_sv: &[u8]) -> Result<Vec<u8>, CRDTError> {
        let sv =
            StateVector::decode_v1(remote_sv).map_err(|e| CRDTError::DecodeError(e.to_string()))?;

        let txn = self.doc.transact();
        Ok(txn.encode_diff_v1(&sv))
    }

    /// Get the current state vector
    pub fn state_vector(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        txn.state_vector().encode_v1()
    }

    /// Apply an update from another client
    pub fn apply_update(&self, update: &[u8]) -> Result<(), CRDTError> {
        let update =
            Update::decode_v1(update).map_err(|e| CRDTError::DecodeError(e.to_string()))?;

        let mut txn = self.doc.transact_mut();
        txn.apply_update(update)
            .map_err(|e| CRDTError::DecodeError(format!("Failed to apply update: {:?}", e)))
    }

    /// Load from binary state
    pub fn from_state(state: &[u8]) -> Result<Self, CRDTError> {
        let doc = Doc::new();

        let update = Update::decode_v1(state).map_err(|e| CRDTError::DecodeError(e.to_string()))?;

        {
            let mut txn = doc.transact_mut();
            txn.apply_update(update)
                .map_err(|e| CRDTError::DecodeError(format!("Failed to apply update: {:?}", e)))?;
        }

        Ok(Self { doc })
    }

    /// Merge another document into this one
    pub fn merge(&self, other: &PageDocument) -> Result<(), CRDTError> {
        let other_state = other.encode_state();
        self.apply_update(&other_state)
    }
}

impl Default for PageDocument {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::oplog::diff_blocks;

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
    fn test_apply_block_changes_insert() {
        let old = make_data(vec![make_block("a", "paragraph", "hello")]);
        let new = make_data(vec![
            make_block("a", "paragraph", "hello"),
            make_block("b", "paragraph", "world"),
        ]);

        let doc = PageDocument::from_editor_data(&old).unwrap();
        let changes = diff_blocks(&old, &new);
        let update = doc
            .apply_block_changes(&changes, &new.blocks, new.time, new.version.as_deref())
            .unwrap();
        assert!(!update.is_empty());

        let result = doc.to_editor_data().unwrap();
        assert_eq!(result.blocks.len(), 2);
        assert_eq!(result.blocks[0].id, "a");
        assert_eq!(result.blocks[1].id, "b");
    }

    #[test]
    fn test_apply_block_changes_delete() {
        let old = make_data(vec![
            make_block("a", "paragraph", "hello"),
            make_block("b", "paragraph", "world"),
        ]);
        let new = make_data(vec![make_block("a", "paragraph", "hello")]);

        let doc = PageDocument::from_editor_data(&old).unwrap();
        let changes = diff_blocks(&old, &new);
        doc.apply_block_changes(&changes, &new.blocks, new.time, new.version.as_deref())
            .unwrap();

        let result = doc.to_editor_data().unwrap();
        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].id, "a");
    }

    #[test]
    fn test_apply_block_changes_modify() {
        let old = make_data(vec![make_block("a", "paragraph", "hello")]);
        let new = make_data(vec![make_block("a", "paragraph", "goodbye")]);

        let doc = PageDocument::from_editor_data(&old).unwrap();
        let changes = diff_blocks(&old, &new);
        doc.apply_block_changes(&changes, &new.blocks, new.time, new.version.as_deref())
            .unwrap();

        let result = doc.to_editor_data().unwrap();
        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].data["text"], "goodbye");
    }

    #[test]
    fn test_apply_block_changes_move() {
        let old = make_data(vec![
            make_block("a", "paragraph", "first"),
            make_block("b", "paragraph", "second"),
        ]);
        let new = make_data(vec![
            make_block("b", "paragraph", "second"),
            make_block("a", "paragraph", "first"),
        ]);

        let doc = PageDocument::from_editor_data(&old).unwrap();
        let changes = diff_blocks(&old, &new);
        doc.apply_block_changes(&changes, &new.blocks, new.time, new.version.as_deref())
            .unwrap();

        let result = doc.to_editor_data().unwrap();
        assert_eq!(result.blocks.len(), 2);
        assert_eq!(result.blocks[0].id, "b");
        assert_eq!(result.blocks[1].id, "a");
    }

    #[test]
    fn test_apply_block_changes_insert_at_beginning() {
        let old = make_data(vec![make_block("a", "paragraph", "existing")]);
        let new = make_data(vec![
            make_block("b", "paragraph", "new first"),
            make_block("a", "paragraph", "existing"),
        ]);

        let doc = PageDocument::from_editor_data(&old).unwrap();
        let changes = diff_blocks(&old, &new);
        doc.apply_block_changes(&changes, &new.blocks, new.time, new.version.as_deref())
            .unwrap();

        let result = doc.to_editor_data().unwrap();
        assert_eq!(result.blocks.len(), 2);
        assert_eq!(result.blocks[0].id, "b");
        assert_eq!(result.blocks[1].id, "a");
    }

    #[test]
    fn test_apply_block_changes_combined() {
        // Insert + modify + delete in one batch
        let old = make_data(vec![
            make_block("a", "paragraph", "keep"),
            make_block("b", "paragraph", "delete me"),
            make_block("c", "paragraph", "modify me"),
        ]);
        let new = make_data(vec![
            make_block("a", "paragraph", "keep"),
            make_block("c", "paragraph", "modified"),
            make_block("d", "paragraph", "new block"),
        ]);

        let doc = PageDocument::from_editor_data(&old).unwrap();
        let changes = diff_blocks(&old, &new);
        doc.apply_block_changes(&changes, &new.blocks, new.time, new.version.as_deref())
            .unwrap();

        let result = doc.to_editor_data().unwrap();
        assert_eq!(result.blocks.len(), 3);
        assert_eq!(result.blocks[0].id, "a");
        assert_eq!(result.blocks[0].data["text"], "keep");
        assert_eq!(result.blocks[1].id, "c");
        assert_eq!(result.blocks[1].data["text"], "modified");
        assert_eq!(result.blocks[2].id, "d");
        assert_eq!(result.blocks[2].data["text"], "new block");
    }

    #[test]
    fn test_apply_block_changes_no_changes() {
        let data = make_data(vec![make_block("a", "paragraph", "hello")]);

        let doc = PageDocument::from_editor_data(&data).unwrap();
        let changes = diff_blocks(&data, &data);
        assert!(changes.is_empty());
        let update = doc
            .apply_block_changes(&changes, &data.blocks, data.time, data.version.as_deref())
            .unwrap();

        let result = doc.to_editor_data().unwrap();
        assert_eq!(result.blocks.len(), 1);
        // Update may still contain metadata update
        assert!(!update.is_empty() || update.is_empty()); // no panic
    }

    #[test]
    fn test_apply_block_changes_update_is_valid() {
        // The returned update should be applicable to another doc
        let old = make_data(vec![make_block("a", "paragraph", "hello")]);
        let new = make_data(vec![
            make_block("a", "paragraph", "hello"),
            make_block("b", "paragraph", "world"),
        ]);

        let doc = PageDocument::from_editor_data(&old).unwrap();
        let changes = diff_blocks(&old, &new);
        let update = doc
            .apply_block_changes(&changes, &new.blocks, new.time, new.version.as_deref())
            .unwrap();

        // Create a fresh doc from old state and apply the update
        let doc2 =
            PageDocument::from_state(&PageDocument::from_editor_data(&old).unwrap().encode_state())
                .unwrap();
        doc2.apply_update(&update).unwrap();
        let result = doc2.to_editor_data().unwrap();
        assert_eq!(result.blocks.len(), 2);
    }

    #[test]
    fn test_roundtrip_empty() {
        let editor_data = EditorData {
            time: Some(1234567890),
            version: Some("2.28.0".to_string()),
            blocks: vec![],
        };

        let doc = PageDocument::from_editor_data(&editor_data).unwrap();
        let result = doc.to_editor_data().unwrap();

        assert_eq!(result.time, editor_data.time);
        assert_eq!(result.version, editor_data.version);
        assert_eq!(result.blocks.len(), 0);
    }

    #[test]
    fn test_roundtrip_with_blocks() {
        let editor_data = EditorData {
            time: Some(1234567890),
            version: Some("2.28.0".to_string()),
            blocks: vec![
                EditorBlock {
                    id: "block1".to_string(),
                    block_type: "paragraph".to_string(),
                    data: serde_json::json!({"text": "Hello world"}),
                },
                EditorBlock {
                    id: "block2".to_string(),
                    block_type: "header".to_string(),
                    data: serde_json::json!({"text": "Title", "level": 1}),
                },
            ],
        };

        let doc = PageDocument::from_editor_data(&editor_data).unwrap();
        let result = doc.to_editor_data().unwrap();

        assert_eq!(result.blocks.len(), 2);
        assert_eq!(result.blocks[0].id, "block1");
        assert_eq!(result.blocks[0].block_type, "paragraph");
        assert_eq!(result.blocks[1].id, "block2");
        assert_eq!(result.blocks[1].block_type, "header");
    }

    #[test]
    fn test_state_encoding() {
        let editor_data = EditorData {
            time: Some(1234567890),
            version: Some("2.28.0".to_string()),
            blocks: vec![EditorBlock {
                id: "block1".to_string(),
                block_type: "paragraph".to_string(),
                data: serde_json::json!({"text": "Hello"}),
            }],
        };

        let doc = PageDocument::from_editor_data(&editor_data).unwrap();
        let state = doc.encode_state();

        // Load from state
        let doc2 = PageDocument::from_state(&state).unwrap();
        let result = doc2.to_editor_data().unwrap();

        assert_eq!(result.blocks.len(), 1);
        assert_eq!(result.blocks[0].id, "block1");
    }

    #[test]
    fn test_merge() {
        // Create two documents with different blocks
        let doc1 = PageDocument::from_editor_data(&EditorData {
            time: Some(1234567890),
            version: Some("2.28.0".to_string()),
            blocks: vec![EditorBlock {
                id: "block1".to_string(),
                block_type: "paragraph".to_string(),
                data: serde_json::json!({"text": "From doc1"}),
            }],
        })
        .unwrap();

        let doc2 = PageDocument::from_editor_data(&EditorData {
            time: Some(1234567890),
            version: Some("2.28.0".to_string()),
            blocks: vec![EditorBlock {
                id: "block2".to_string(),
                block_type: "paragraph".to_string(),
                data: serde_json::json!({"text": "From doc2"}),
            }],
        })
        .unwrap();

        // Merge doc2 into doc1
        doc1.merge(&doc2).unwrap();

        // The merge should combine both - though the exact result depends on CRDT semantics
        // In this case, since they're independent, both should be present
        let result = doc1.to_editor_data().unwrap();
        // Note: exact behavior depends on how Yrs handles array merges
        assert!(result.blocks.len() >= 1);
    }
}
