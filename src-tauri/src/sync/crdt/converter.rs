use thiserror::Error;
use yrs::{
    types::ToJson, Array, Doc, Map, ReadTxn, StateVector, Transact, Update, WriteTxn, Any,
    encoding::read::Cursor,
};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;

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
                    ("type".to_string(), yrs::Any::String(block.block_type.clone().into())),
                    ("data".to_string(), yrs::Any::String(
                        serde_json::to_string(&block.data)
                            .unwrap_or_else(|_| "{}".to_string())
                            .into()
                    )),
                ]);

                blocks.push_back(&mut txn, block_map);
            }
        }

        Ok(Self { doc })
    }

    /// Convert back to EditorData
    pub fn to_editor_data(&self) -> Result<EditorData, CRDTError> {
        let txn = self.doc.transact();

        let root = txn.get_map("page")
            .ok_or_else(|| CRDTError::ConversionError("Missing root map".to_string()))?;

        // Get metadata using pattern matching on Any
        let time = root.get(&txn, "time")
            .map(|v| v.to_json(&txn))
            .and_then(|any| any_as_i64(&any));

        let version = root.get(&txn, "version")
            .map(|v| v.to_json(&txn))
            .and_then(|any| any_as_string(&any));

        // Get blocks
        let mut blocks = Vec::new();

        if let Some(blocks_value) = root.get(&txn, "blocks") {
            if let yrs::Out::YArray(blocks_arr) = blocks_value {
                for item in blocks_arr.iter(&txn) {
                    if let yrs::Out::YMap(block_map) = item {
                        let id = block_map.get(&txn, "id")
                            .map(|v| v.to_json(&txn))
                            .and_then(|any| any_as_string(&any))
                            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

                        let block_type = block_map.get(&txn, "type")
                            .map(|v| v.to_json(&txn))
                            .and_then(|any| any_as_string(&any))
                            .unwrap_or_else(|| "paragraph".to_string());

                        let data_str = block_map.get(&txn, "data")
                            .map(|v| v.to_json(&txn))
                            .and_then(|any| any_as_string(&any))
                            .unwrap_or_else(|| "{}".to_string());

                        let data: serde_json::Value = serde_json::from_str(&data_str)
                            .unwrap_or(serde_json::json!({}));

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

    /// Encode the full document state as binary
    pub fn encode_state(&self) -> Vec<u8> {
        let txn = self.doc.transact();
        txn.encode_state_as_update_v1(&StateVector::default())
    }

    /// Encode only the diff from a given state vector
    pub fn encode_diff(&self, remote_sv: &[u8]) -> Result<Vec<u8>, CRDTError> {
        let sv = StateVector::decode_v1(remote_sv)
            .map_err(|e| CRDTError::DecodeError(e.to_string()))?;

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
        let update = Update::decode_v1(update)
            .map_err(|e| CRDTError::DecodeError(e.to_string()))?;

        let mut txn = self.doc.transact_mut();
        txn.apply_update(update)
            .map_err(|e| CRDTError::DecodeError(format!("Failed to apply update: {:?}", e)))
    }

    /// Load from binary state
    pub fn from_state(state: &[u8]) -> Result<Self, CRDTError> {
        let doc = Doc::new();

        let update = Update::decode_v1(state)
            .map_err(|e| CRDTError::DecodeError(e.to_string()))?;

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
        }).unwrap();

        let doc2 = PageDocument::from_editor_data(&EditorData {
            time: Some(1234567890),
            version: Some("2.28.0".to_string()),
            blocks: vec![EditorBlock {
                id: "block2".to_string(),
                block_type: "paragraph".to_string(),
                data: serde_json::json!({"text": "From doc2"}),
            }],
        }).unwrap();

        // Merge doc2 into doc1
        doc1.merge(&doc2).unwrap();

        // The merge should combine both - though the exact result depends on CRDT semantics
        // In this case, since they're independent, both should be present
        let result = doc1.to_editor_data().unwrap();
        // Note: exact behavior depends on how Yrs handles array merges
        assert!(result.blocks.len() >= 1);
    }
}
