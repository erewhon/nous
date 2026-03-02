//! Bidirectional converter between BlockNote JSON and EditorJS EditorBlock format.
//!
//! When the on-disk `version` field starts with `"blocknote-"`, serde on [`EditorData`]
//! transparently converts BlockNote blocks to/from [`EditorBlock`] so that all 25+
//! processing files (search, export, HTML render, oplog, CRDT, RAG, TTS) work unchanged.

use serde_json::{json, Map, Value};

use super::EditorBlock;

// ─── Format detection ────────────────────────────────────────────────────────

/// Returns true if the version string indicates BlockNote format.
pub fn is_blocknote_version(version: &Option<String>) -> bool {
    version
        .as_ref()
        .map(|v| v.starts_with("blocknote-"))
        .unwrap_or(false)
}

// ─── BlockNote → EditorJS (deserialization path) ────────────────────────────

/// Convert an array of BlockNote blocks into EditorJS EditorBlocks.
pub fn blocknote_to_editor_blocks(bn_blocks: &[Value]) -> Vec<EditorBlock> {
    let mut result = Vec::new();
    for bn in bn_blocks {
        convert_bn_block(bn, &mut result);
    }
    result
}

fn convert_bn_block(bn: &Value, out: &mut Vec<EditorBlock>) {
    let block_type = bn.get("type").and_then(|v| v.as_str()).unwrap_or("");
    let id = bn
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let props = bn.get("props").cloned().unwrap_or(Value::Object(Map::new()));
    let content = bn.get("content");

    match block_type {
        "paragraph" => {
            out.push(EditorBlock {
                id,
                block_type: "paragraph".to_string(),
                data: json!({ "text": render_inline_to_html(content) }),
            });
        }

        "heading" => {
            let level = props.get("level").and_then(|v| v.as_u64()).unwrap_or(2);
            out.push(EditorBlock {
                id,
                block_type: "header".to_string(),
                data: json!({
                    "text": render_inline_to_html(content),
                    "level": level,
                }),
            });
        }

        "bulletListItem" => {
            // Collect this item with its children into a nested structure
            let item = bn_list_item_to_editor(bn);
            out.push(EditorBlock {
                id,
                block_type: "list".to_string(),
                data: json!({
                    "style": "unordered",
                    "items": [item],
                }),
            });
        }

        "numberedListItem" => {
            let item = bn_list_item_to_editor(bn);
            out.push(EditorBlock {
                id,
                block_type: "list".to_string(),
                data: json!({
                    "style": "ordered",
                    "items": [item],
                }),
            });
        }

        "checkListItem" => {
            let checked = props.get("checked").and_then(|v| v.as_bool()).unwrap_or(false);
            let text = render_inline_to_html(content);
            let mut item = json!({
                "text": text,
                "checked": checked,
            });
            // Handle children
            if let Some(children) = bn.get("children").and_then(|v| v.as_array()) {
                if !children.is_empty() {
                    let child_items: Vec<Value> = children
                        .iter()
                        .map(|c| bn_checklist_item_to_editor(c))
                        .collect();
                    item.as_object_mut().unwrap().insert("items".to_string(), json!(child_items));
                }
            }
            out.push(EditorBlock {
                id,
                block_type: "checklist".to_string(),
                data: json!({ "items": [item] }),
            });
        }

        "codeBlock" => {
            let code = extract_plain_text(content);
            let language = props
                .get("language")
                .and_then(|v| v.as_str())
                .unwrap_or("plaintext");
            out.push(EditorBlock {
                id,
                block_type: "code".to_string(),
                data: json!({ "code": code, "language": language }),
            });
        }

        "quote" => {
            out.push(EditorBlock {
                id,
                block_type: "quote".to_string(),
                data: json!({ "text": render_inline_to_html(content) }),
            });
        }

        "delimiter" => {
            out.push(EditorBlock {
                id,
                block_type: "delimiter".to_string(),
                data: json!({}),
            });
        }

        "table" => {
            // content is { type: "tableContent", rows: [{ cells: [[inline]] }] }
            let rows = content
                .and_then(|c| c.get("rows"))
                .and_then(|r| r.as_array())
                .cloned()
                .unwrap_or_default();
            let table_content: Vec<Vec<String>> = rows
                .iter()
                .map(|row| {
                    row.get("cells")
                        .and_then(|c| c.as_array())
                        .map(|cells| {
                            cells
                                .iter()
                                .map(|cell| render_inline_to_html(Some(cell)))
                                .collect()
                        })
                        .unwrap_or_default()
                })
                .collect();
            out.push(EditorBlock {
                id,
                block_type: "table".to_string(),
                data: json!({ "content": table_content }),
            });
        }

        "image" => {
            let url = props
                .get("url")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let caption = props
                .get("caption")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let mut data = json!({
                "file": { "url": url },
                "caption": caption,
            });
            if let Some(w) = props.get("previewWidth").and_then(|v| v.as_u64()) {
                data.as_object_mut()
                    .unwrap()
                    .insert("width".to_string(), json!(w));
            }
            out.push(EditorBlock {
                id,
                block_type: "image".to_string(),
                data,
            });
        }

        "callout" => {
            let callout_type = props
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("info");
            out.push(EditorBlock {
                id,
                block_type: "callout".to_string(),
                data: json!({
                    "type": callout_type,
                    "content": render_inline_to_html(content),
                }),
            });
        }

        "flashcard" => {
            out.push(EditorBlock {
                id,
                block_type: "flashcard".to_string(),
                data: json!({
                    "front": props.get("front").and_then(|v| v.as_str()).unwrap_or(""),
                    "back": props.get("back").and_then(|v| v.as_str()).unwrap_or(""),
                    "cardType": props.get("cardType").and_then(|v| v.as_str()).unwrap_or("basic"),
                    "deckId": props.get("deckId").and_then(|v| v.as_str()).unwrap_or(""),
                    "cardId": props.get("cardId").and_then(|v| v.as_str()).unwrap_or(""),
                }),
            });
        }

        "database" => {
            let content_val = props
                .get("contentJson")
                .and_then(|v| v.as_str())
                .and_then(|s| serde_json::from_str::<Value>(s).ok());
            let mut data = json!({});
            if let Some(cv) = content_val {
                data.as_object_mut()
                    .unwrap()
                    .insert("content".to_string(), cv);
            }
            out.push(EditorBlock {
                id,
                block_type: "database".to_string(),
                data,
            });
        }

        "liveQuery" => {
            let config_val = props
                .get("configJson")
                .and_then(|v| v.as_str())
                .and_then(|s| serde_json::from_str::<Value>(s).ok());
            let notebook_id = props
                .get("notebookId")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let mut data = json!({ "notebookId": notebook_id });
            if let Some(cv) = config_val {
                data.as_object_mut()
                    .unwrap()
                    .insert("config".to_string(), cv);
            }
            out.push(EditorBlock {
                id,
                block_type: "liveQuery".to_string(),
                data,
            });
        }

        "blockEmbed" => {
            out.push(EditorBlock {
                id,
                block_type: "blockEmbed".to_string(),
                data: json!({
                    "targetBlockId": props.get("targetBlockId").and_then(|v| v.as_str()).unwrap_or(""),
                    "targetPageId": props.get("targetPageId").and_then(|v| v.as_str()).unwrap_or(""),
                    "notebookId": props.get("notebookId").and_then(|v| v.as_str()).unwrap_or(""),
                }),
            });
        }

        "embed" => {
            out.push(EditorBlock {
                id,
                block_type: "embed".to_string(),
                data: json!({
                    "embedType": props.get("embedType").and_then(|v| v.as_str()).unwrap_or("page"),
                    "pageTitle": props.get("pageTitle").and_then(|v| v.as_str()).unwrap_or(""),
                    "pageId": props.get("pageId").and_then(|v| v.as_str()).unwrap_or(""),
                    "url": props.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                    "isCollapsed": props.get("isCollapsed").and_then(|v| v.as_bool()).unwrap_or(false),
                    "caption": props.get("caption").and_then(|v| v.as_str()).unwrap_or(""),
                    "displayMode": props.get("displayMode").and_then(|v| v.as_str()).unwrap_or("embed"),
                }),
            });
        }

        "pdf" => {
            out.push(EditorBlock {
                id,
                block_type: "pdf".to_string(),
                data: json!({
                    "filename": props.get("filename").and_then(|v| v.as_str()).unwrap_or(""),
                    "url": props.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                    "originalName": props.get("originalName").and_then(|v| v.as_str()).unwrap_or(""),
                    "caption": props.get("caption").and_then(|v| v.as_str()).unwrap_or(""),
                    "currentPage": props.get("currentPage").and_then(|v| v.as_u64()).unwrap_or(1),
                    "totalPages": props.get("totalPages").and_then(|v| v.as_u64()).unwrap_or(0),
                    "displayMode": props.get("displayMode").and_then(|v| v.as_str()).unwrap_or("preview"),
                }),
            });
        }

        "video" => {
            out.push(EditorBlock {
                id,
                block_type: "video".to_string(),
                data: json!({
                    "filename": props.get("filename").and_then(|v| v.as_str()).unwrap_or(""),
                    "url": props.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                    "caption": props.get("caption").and_then(|v| v.as_str()).unwrap_or(""),
                    "currentTime": props.get("currentTime").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    "displayMode": props.get("displayMode").and_then(|v| v.as_str()).unwrap_or("standard"),
                    "transcription": props.get("transcription").and_then(|v| v.as_str()).unwrap_or(""),
                    "transcriptionStatus": props.get("transcriptionStatus").and_then(|v| v.as_str()).unwrap_or("idle"),
                    "showTranscript": props.get("showTranscript").and_then(|v| v.as_bool()).unwrap_or(false),
                }),
            });
        }

        "audio" => {
            out.push(EditorBlock {
                id,
                block_type: "audio".to_string(),
                data: json!({
                    "filename": props.get("filename").and_then(|v| v.as_str()).unwrap_or(""),
                    "url": props.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                    "caption": props.get("caption").and_then(|v| v.as_str()).unwrap_or(""),
                    "transcription": props.get("transcription").and_then(|v| v.as_str()).unwrap_or(""),
                    "transcriptionStatus": props.get("transcriptionStatus").and_then(|v| v.as_str()).unwrap_or("idle"),
                    "showTranscript": props.get("showTranscript").and_then(|v| v.as_bool()).unwrap_or(false),
                    "recordedAt": props.get("recordedAt").and_then(|v| v.as_str()).unwrap_or(""),
                }),
            });
        }

        "drawing" => {
            let canvas_data = props
                .get("canvasDataJson")
                .and_then(|v| v.as_str())
                .and_then(|s| serde_json::from_str::<Value>(s).ok());
            let mut data = json!({
                "width": props.get("width").and_then(|v| v.as_u64()).unwrap_or(800),
                "height": props.get("height").and_then(|v| v.as_u64()).unwrap_or(400),
                "displayMode": props.get("displayMode").and_then(|v| v.as_str()).unwrap_or("standard"),
                "caption": props.get("caption").and_then(|v| v.as_str()).unwrap_or(""),
            });
            if let Some(cd) = canvas_data {
                data.as_object_mut()
                    .unwrap()
                    .insert("canvasData".to_string(), cd);
            }
            out.push(EditorBlock {
                id,
                block_type: "drawing".to_string(),
                data,
            });
        }

        "columnList" => {
            let children = bn.get("children").and_then(|v| v.as_array());
            let columns = children.map(|c| c.len()).unwrap_or(2);
            let column_data: Vec<Value> = children
                .map(|cols| {
                    cols.iter()
                        .map(|col| {
                            let col_children = col.get("children").and_then(|v| v.as_array());
                            let mut col_blocks = Vec::new();
                            if let Some(ccs) = col_children {
                                for cc in ccs {
                                    convert_bn_block(cc, &mut col_blocks);
                                }
                            }
                            let blocks_json: Vec<Value> = col_blocks
                                .into_iter()
                                .map(|b| {
                                    json!({
                                        "id": b.id,
                                        "type": b.block_type,
                                        "data": b.data,
                                    })
                                })
                                .collect();
                            json!({ "blocks": blocks_json })
                        })
                        .collect()
                })
                .unwrap_or_default();
            out.push(EditorBlock {
                id,
                block_type: "columns".to_string(),
                data: json!({
                    "columns": columns,
                    "columnData": column_data,
                }),
            });
        }

        // Skip "column" blocks — handled by columnList parent
        "column" => {}

        // Unknown types: pass through props as data
        _ => {
            out.push(EditorBlock {
                id,
                block_type: block_type.to_string(),
                data: props,
            });
        }
    }
}

/// Convert a BlockNote list item (with potential children) to EditorJS nested format.
fn bn_list_item_to_editor(bn: &Value) -> Value {
    let text = render_inline_to_html(bn.get("content"));
    let children = bn.get("children").and_then(|v| v.as_array());
    let child_items: Vec<Value> = children
        .map(|cs| cs.iter().map(|c| bn_list_item_to_editor(c)).collect())
        .unwrap_or_default();
    json!({
        "content": text,
        "items": child_items,
    })
}

/// Convert a BlockNote checklist item (with potential children) to EditorJS nested format.
fn bn_checklist_item_to_editor(bn: &Value) -> Value {
    let text = render_inline_to_html(bn.get("content"));
    let checked = bn
        .get("props")
        .and_then(|p| p.get("checked"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let children = bn.get("children").and_then(|v| v.as_array());
    let child_items: Vec<Value> = children
        .map(|cs| cs.iter().map(|c| bn_checklist_item_to_editor(c)).collect())
        .unwrap_or_default();
    let mut item = json!({
        "text": text,
        "checked": checked,
    });
    if !child_items.is_empty() {
        item.as_object_mut()
            .unwrap()
            .insert("items".to_string(), json!(child_items));
    }
    item
}

// ─── EditorJS → BlockNote (serialization path) ─────────────────────────────

/// Convert EditorJS blocks back to BlockNote blocks array.
pub fn editor_blocks_to_blocknote(blocks: &[EditorBlock]) -> Vec<Value> {
    let mut result = Vec::new();
    let mut i = 0;
    while i < blocks.len() {
        let block = &blocks[i];
        match block.block_type.as_str() {
            "paragraph" => {
                let text = block.data.get("text").and_then(|v| v.as_str()).unwrap_or("");
                result.push(json!({
                    "id": block.id,
                    "type": "paragraph",
                    "content": parse_html_to_inline(text),
                }));
                i += 1;
            }

            "header" => {
                let text = block.data.get("text").and_then(|v| v.as_str()).unwrap_or("");
                let level = block.data.get("level").and_then(|v| v.as_u64()).unwrap_or(2);
                let level = level.min(3);
                result.push(json!({
                    "id": block.id,
                    "type": "heading",
                    "props": { "level": level },
                    "content": parse_html_to_inline(text),
                }));
                i += 1;
            }

            "list" => {
                let style = block
                    .data
                    .get("style")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unordered");
                let bn_type = if style == "ordered" {
                    "numberedListItem"
                } else {
                    "bulletListItem"
                };
                let items = block
                    .data
                    .get("items")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                flatten_list_items_to_bn(&items, bn_type, &block.id, 0, &mut result);
                i += 1;
            }

            "checklist" => {
                let items = block
                    .data
                    .get("items")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                flatten_checklist_items_to_bn(&items, &block.id, 0, &mut result);
                i += 1;
            }

            "code" => {
                let code = block.data.get("code").and_then(|v| v.as_str()).unwrap_or("");
                let language = block
                    .data
                    .get("language")
                    .and_then(|v| v.as_str())
                    .unwrap_or("plaintext");
                result.push(json!({
                    "id": block.id,
                    "type": "codeBlock",
                    "props": { "language": language },
                    "content": [{ "type": "text", "text": code, "styles": {} }],
                }));
                i += 1;
            }

            "quote" => {
                let text = block.data.get("text").and_then(|v| v.as_str()).unwrap_or("");
                result.push(json!({
                    "id": block.id,
                    "type": "quote",
                    "content": parse_html_to_inline(text),
                }));
                i += 1;
            }

            "delimiter" => {
                result.push(json!({ "id": block.id, "type": "delimiter" }));
                i += 1;
            }

            "table" => {
                let content = block
                    .data
                    .get("content")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let rows: Vec<Value> = content
                    .iter()
                    .map(|row| {
                        let cells: Vec<Value> = row
                            .as_array()
                            .map(|r| {
                                r.iter()
                                    .map(|cell| {
                                        let s = cell.as_str().unwrap_or("");
                                        parse_html_to_inline(s)
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();
                        json!({ "cells": cells })
                    })
                    .collect();
                result.push(json!({
                    "id": block.id,
                    "type": "table",
                    "content": { "type": "tableContent", "rows": rows },
                }));
                i += 1;
            }

            "image" => {
                let url = block
                    .data
                    .get("file")
                    .and_then(|f| f.get("url"))
                    .and_then(|v| v.as_str())
                    .or_else(|| block.data.get("url").and_then(|v| v.as_str()))
                    .unwrap_or("");
                let caption = block
                    .data
                    .get("caption")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let mut props = json!({
                    "url": url,
                    "caption": caption,
                });
                if let Some(w) = block.data.get("width").and_then(|v| v.as_u64()) {
                    props
                        .as_object_mut()
                        .unwrap()
                        .insert("previewWidth".to_string(), json!(w));
                }
                result.push(json!({
                    "id": block.id,
                    "type": "image",
                    "props": props,
                }));
                i += 1;
            }

            "callout" => {
                let callout_type = block
                    .data
                    .get("type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("info");
                let content_html = block
                    .data
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                result.push(json!({
                    "id": block.id,
                    "type": "callout",
                    "props": { "type": callout_type },
                    "content": parse_html_to_inline(content_html),
                }));
                i += 1;
            }

            "flashcard" => {
                result.push(json!({
                    "id": block.id,
                    "type": "flashcard",
                    "props": {
                        "front": block.data.get("front").and_then(|v| v.as_str()).unwrap_or(""),
                        "back": block.data.get("back").and_then(|v| v.as_str()).unwrap_or(""),
                        "cardType": block.data.get("cardType").and_then(|v| v.as_str()).unwrap_or("basic"),
                        "deckId": block.data.get("deckId").and_then(|v| v.as_str()).unwrap_or(""),
                        "cardId": block.data.get("cardId").and_then(|v| v.as_str()).unwrap_or(""),
                    },
                }));
                i += 1;
            }

            "database" => {
                let content_json = block
                    .data
                    .get("content")
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .unwrap_or_default();
                result.push(json!({
                    "id": block.id,
                    "type": "database",
                    "props": { "contentJson": content_json },
                }));
                i += 1;
            }

            "liveQuery" => {
                let config_json = block
                    .data
                    .get("config")
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .unwrap_or_default();
                let notebook_id = block
                    .data
                    .get("notebookId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                result.push(json!({
                    "id": block.id,
                    "type": "liveQuery",
                    "props": {
                        "configJson": config_json,
                        "notebookId": notebook_id,
                    },
                }));
                i += 1;
            }

            "blockEmbed" => {
                result.push(json!({
                    "id": block.id,
                    "type": "blockEmbed",
                    "props": {
                        "targetBlockId": block.data.get("targetBlockId").and_then(|v| v.as_str()).unwrap_or(""),
                        "targetPageId": block.data.get("targetPageId").and_then(|v| v.as_str()).unwrap_or(""),
                        "notebookId": block.data.get("notebookId").and_then(|v| v.as_str()).unwrap_or(""),
                    },
                }));
                i += 1;
            }

            "embed" => {
                result.push(json!({
                    "id": block.id,
                    "type": "embed",
                    "props": {
                        "embedType": block.data.get("embedType").and_then(|v| v.as_str()).unwrap_or("page"),
                        "pageTitle": block.data.get("pageTitle").and_then(|v| v.as_str()).unwrap_or(""),
                        "pageId": block.data.get("pageId").and_then(|v| v.as_str()).unwrap_or(""),
                        "url": block.data.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                        "isCollapsed": block.data.get("isCollapsed").and_then(|v| v.as_bool()).unwrap_or(false),
                        "caption": block.data.get("caption").and_then(|v| v.as_str()).unwrap_or(""),
                        "displayMode": block.data.get("displayMode").and_then(|v| v.as_str()).unwrap_or("embed"),
                    },
                }));
                i += 1;
            }

            "pdf" => {
                result.push(json!({
                    "id": block.id,
                    "type": "pdf",
                    "props": {
                        "filename": block.data.get("filename").and_then(|v| v.as_str()).unwrap_or(""),
                        "url": block.data.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                        "originalName": block.data.get("originalName").and_then(|v| v.as_str()).unwrap_or(""),
                        "caption": block.data.get("caption").and_then(|v| v.as_str()).unwrap_or(""),
                        "currentPage": block.data.get("currentPage").and_then(|v| v.as_u64()).unwrap_or(1),
                        "totalPages": block.data.get("totalPages").and_then(|v| v.as_u64()).unwrap_or(0),
                        "displayMode": block.data.get("displayMode").and_then(|v| v.as_str()).unwrap_or("preview"),
                    },
                }));
                i += 1;
            }

            "video" => {
                result.push(json!({
                    "id": block.id,
                    "type": "video",
                    "props": {
                        "filename": block.data.get("filename").and_then(|v| v.as_str()).unwrap_or(""),
                        "url": block.data.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                        "caption": block.data.get("caption").and_then(|v| v.as_str()).unwrap_or(""),
                        "currentTime": block.data.get("currentTime").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        "displayMode": block.data.get("displayMode").and_then(|v| v.as_str()).unwrap_or("standard"),
                        "transcription": block.data.get("transcription").and_then(|v| v.as_str()).unwrap_or(""),
                        "transcriptionStatus": block.data.get("transcriptionStatus").and_then(|v| v.as_str()).unwrap_or("idle"),
                        "showTranscript": block.data.get("showTranscript").and_then(|v| v.as_bool()).unwrap_or(false),
                    },
                }));
                i += 1;
            }

            "audio" => {
                result.push(json!({
                    "id": block.id,
                    "type": "audio",
                    "props": {
                        "filename": block.data.get("filename").and_then(|v| v.as_str()).unwrap_or(""),
                        "url": block.data.get("url").and_then(|v| v.as_str()).unwrap_or(""),
                        "caption": block.data.get("caption").and_then(|v| v.as_str()).unwrap_or(""),
                        "transcription": block.data.get("transcription").and_then(|v| v.as_str()).unwrap_or(""),
                        "transcriptionStatus": block.data.get("transcriptionStatus").and_then(|v| v.as_str()).unwrap_or("idle"),
                        "showTranscript": block.data.get("showTranscript").and_then(|v| v.as_bool()).unwrap_or(false),
                        "recordedAt": block.data.get("recordedAt").and_then(|v| v.as_str()).unwrap_or(""),
                    },
                }));
                i += 1;
            }

            "drawing" => {
                let canvas_json = block
                    .data
                    .get("canvasData")
                    .map(|v| serde_json::to_string(v).unwrap_or_default())
                    .unwrap_or_default();
                result.push(json!({
                    "id": block.id,
                    "type": "drawing",
                    "props": {
                        "canvasDataJson": canvas_json,
                        "width": block.data.get("width").and_then(|v| v.as_u64()).unwrap_or(800),
                        "height": block.data.get("height").and_then(|v| v.as_u64()).unwrap_or(400),
                        "displayMode": block.data.get("displayMode").and_then(|v| v.as_str()).unwrap_or("standard"),
                        "caption": block.data.get("caption").and_then(|v| v.as_str()).unwrap_or(""),
                    },
                }));
                i += 1;
            }

            "columns" => {
                let column_data = block
                    .data
                    .get("columnData")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let num_cols = column_data.len();
                let children: Vec<Value> = column_data
                    .iter()
                    .enumerate()
                    .map(|(ci, col)| {
                        let col_blocks = col
                            .get("blocks")
                            .and_then(|v| v.as_array())
                            .cloned()
                            .unwrap_or_default();
                        // Convert each EditorBlock in the column
                        let editor_blocks: Vec<EditorBlock> = col_blocks
                            .iter()
                            .filter_map(|b| serde_json::from_value::<EditorBlock>(b.clone()).ok())
                            .collect();
                        let bn_blocks = editor_blocks_to_blocknote(&editor_blocks);
                        json!({
                            "id": format!("{}-col-{}", block.id, ci),
                            "type": "column",
                            "props": { "width": 1.0 / num_cols as f64 },
                            "children": bn_blocks,
                        })
                    })
                    .collect();
                result.push(json!({
                    "id": block.id,
                    "type": "columnList",
                    "children": children,
                }));
                i += 1;
            }

            // Unknown: pass through as-is with data → props
            _ => {
                result.push(json!({
                    "id": block.id,
                    "type": block.block_type,
                    "props": block.data,
                }));
                i += 1;
            }
        }
    }

    // Post-process: merge consecutive same-type list blocks into one
    merge_consecutive_lists(&mut result);

    result
}

/// Merge consecutive list blocks of the same type into single blocks.
///
/// During EditorJS → BlockNote conversion, each EditorJS `list` block may have
/// been serialized as separate blocks. In the normal flow (frontend conversion),
/// each list item is a separate BlockNote block. But when the backend converts
/// an EditorJS list, it already expands items. This merge handles the case where
/// multiple EditorJS list blocks of the same style are adjacent — they should
/// remain separate BlockNote item groups (no merge needed for correctness, but
/// the function is here for future edge cases).
fn merge_consecutive_lists(_result: &mut Vec<Value>) {
    // Currently a no-op: each EditorJS list block already expands to N BlockNote
    // items via flatten_list_items_to_bn. No merge is needed.
}

fn flatten_list_items_to_bn(
    items: &[Value],
    bn_type: &str,
    base_id: &str,
    depth: usize,
    out: &mut Vec<Value>,
) {
    for (i, item) in items.iter().enumerate() {
        let (text, children) = if let Some(s) = item.as_str() {
            (s.to_string(), Vec::new())
        } else {
            let text = item
                .get("content")
                .and_then(|v| v.as_str())
                .or_else(|| item.get("text").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();
            let children = item
                .get("items")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            (text, children)
        };

        let child_id = format!("{}-{}-{}", base_id, depth, i);
        let mut child_blocks = Vec::new();
        if !children.is_empty() {
            flatten_list_items_to_bn(&children, bn_type, base_id, depth + 1, &mut child_blocks);
        }

        out.push(json!({
            "id": child_id,
            "type": bn_type,
            "content": parse_html_to_inline(&text),
            "children": child_blocks,
        }));
    }
}

fn flatten_checklist_items_to_bn(
    items: &[Value],
    base_id: &str,
    depth: usize,
    out: &mut Vec<Value>,
) {
    for (i, item) in items.iter().enumerate() {
        let text = item
            .get("text")
            .and_then(|v| v.as_str())
            .or_else(|| item.get("content").and_then(|v| v.as_str()))
            .unwrap_or("");
        let checked = item
            .get("checked")
            .and_then(|v| v.as_bool())
            .or_else(|| {
                item.get("meta")
                    .and_then(|m| m.get("checked"))
                    .and_then(|v| v.as_bool())
            })
            .unwrap_or(false);
        let children = item
            .get("items")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        let child_id = format!("{}-{}-{}", base_id, depth, i);
        let mut child_blocks = Vec::new();
        if !children.is_empty() {
            flatten_checklist_items_to_bn(&children, base_id, depth + 1, &mut child_blocks);
        }

        out.push(json!({
            "id": child_id,
            "type": "checkListItem",
            "props": { "checked": checked },
            "content": parse_html_to_inline(text),
            "children": child_blocks,
        }));
    }
}

// ─── Inline content: structured → HTML ──────────────────────────────────────

/// Render BlockNote structured inline content to HTML string.
/// `content` is either a JSON array of inline nodes, or None.
pub fn render_inline_to_html(content: Option<&Value>) -> String {
    let arr = match content {
        Some(Value::Array(a)) => a,
        _ => return String::new(),
    };

    let mut html = String::new();
    for node in arr {
        render_inline_node(&mut html, node);
    }
    html
}

fn render_inline_node(out: &mut String, node: &Value) {
    let node_type = node.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match node_type {
        "text" => {
            let text = node.get("text").and_then(|v| v.as_str()).unwrap_or("");
            let mut html = escape_html(text);
            let styles = node.get("styles");

            if let Some(color) = styles.and_then(|s| s.get("highlight")).and_then(|v| v.as_str()) {
                html = format!(
                    "<mark data-color=\"{}\" style=\"background-color: {}\">{}</mark>",
                    escape_attr(color),
                    escape_attr(color),
                    html
                );
            }
            if styles.and_then(|s| s.get("code")).and_then(|v| v.as_bool()) == Some(true) {
                html = format!("<code>{}</code>", html);
            }
            if styles.and_then(|s| s.get("bold")).and_then(|v| v.as_bool()) == Some(true) {
                html = format!("<b>{}</b>", html);
            }
            if styles.and_then(|s| s.get("italic")).and_then(|v| v.as_bool()) == Some(true) {
                html = format!("<i>{}</i>", html);
            }
            if styles.and_then(|s| s.get("underline")).and_then(|v| v.as_bool()) == Some(true) {
                html = format!("<u>{}</u>", html);
            }
            if styles.and_then(|s| s.get("strike")).and_then(|v| v.as_bool()) == Some(true) {
                html = format!("<s>{}</s>", html);
            }

            out.push_str(&html);
        }

        "link" => {
            let href = node.get("href").and_then(|v| v.as_str()).unwrap_or("");
            let inner = render_inline_to_html(node.get("content"));
            out.push_str(&format!("<a href=\"{}\">{}</a>", escape_attr(href), inner));
        }

        "wikiLink" => {
            let props = node.get("props");
            let title = props
                .and_then(|p| p.get("pageTitle"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let page_id = props
                .and_then(|p| p.get("pageId"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            out.push_str(&format!(
                "<wiki-link data-page-title=\"{}\" data-page-id=\"{}\">{}</wiki-link>",
                escape_attr(title),
                escape_attr(page_id),
                escape_html(title)
            ));
        }

        "blockRef" => {
            let props = node.get("props");
            let block_id = props
                .and_then(|p| p.get("blockId"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let page_id = props
                .and_then(|p| p.get("pageId"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let text = props
                .and_then(|p| p.get("text"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            out.push_str(&format!(
                "<block-ref data-block-id=\"{}\" data-page-id=\"{}\">{}</block-ref>",
                escape_attr(block_id),
                escape_attr(page_id),
                escape_html(text)
            ));
        }

        _ => {}
    }
}

/// Extract plain text from inline content (for code blocks etc.).
fn extract_plain_text(content: Option<&Value>) -> String {
    let arr = match content {
        Some(Value::Array(a)) => a,
        _ => return String::new(),
    };

    let mut text = String::new();
    for node in arr {
        let node_type = node.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match node_type {
            "text" => {
                text.push_str(node.get("text").and_then(|v| v.as_str()).unwrap_or(""));
            }
            "link" => {
                if let Some(Value::Array(inner)) = node.get("content") {
                    for c in inner {
                        text.push_str(c.get("text").and_then(|v| v.as_str()).unwrap_or(""));
                    }
                }
            }
            "wikiLink" => {
                text.push_str(
                    node.get("props")
                        .and_then(|p| p.get("pageTitle"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(""),
                );
            }
            "blockRef" => {
                text.push_str(
                    node.get("props")
                        .and_then(|p| p.get("text"))
                        .and_then(|v| v.as_str())
                        .unwrap_or(""),
                );
            }
            _ => {}
        }
    }
    text
}

// ─── Inline content: HTML → structured ──────────────────────────────────────

/// Parse an HTML string (from EditorJS inline content) into BlockNote structured
/// inline content nodes. Hand-written state machine — no DOM dependency.
pub fn parse_html_to_inline(html: &str) -> Value {
    if html.is_empty() {
        return json!([]);
    }

    // Fast path: no HTML tags and no entities
    if !html.contains('<') && !html.contains('&') {
        return json!([{ "type": "text", "text": html, "styles": {} }]);
    }

    let mut result: Vec<Value> = Vec::new();
    let mut parser = HtmlInlineParser::new(html);
    parser.parse(&mut result);
    Value::Array(result)
}

/// Style state tracked during HTML parsing.
#[derive(Clone, Default)]
struct StyleState {
    bold: bool,
    italic: bool,
    code: bool,
    underline: bool,
    strike: bool,
    highlight: Option<String>,
}

impl StyleState {
    fn to_json(&self) -> Value {
        let mut map = Map::new();
        if self.bold {
            map.insert("bold".to_string(), json!(true));
        }
        if self.italic {
            map.insert("italic".to_string(), json!(true));
        }
        if self.code {
            map.insert("code".to_string(), json!(true));
        }
        if self.underline {
            map.insert("underline".to_string(), json!(true));
        }
        if self.strike {
            map.insert("strike".to_string(), json!(true));
        }
        if let Some(ref color) = self.highlight {
            map.insert("highlight".to_string(), json!(color));
        }
        Value::Object(map)
    }

    fn eq(&self, other: &StyleState) -> bool {
        self.bold == other.bold
            && self.italic == other.italic
            && self.code == other.code
            && self.underline == other.underline
            && self.strike == other.strike
            && self.highlight == other.highlight
    }
}

struct HtmlInlineParser<'a> {
    input: &'a str,
    pos: usize,
}

impl<'a> HtmlInlineParser<'a> {
    fn new(input: &'a str) -> Self {
        Self { input, pos: 0 }
    }

    fn remaining(&self) -> &'a str {
        &self.input[self.pos..]
    }

    fn parse(&mut self, result: &mut Vec<Value>) {
        self.parse_nodes(result, &StyleState::default());
    }

    fn parse_nodes(&mut self, result: &mut Vec<Value>, styles: &StyleState) {
        while self.pos < self.input.len() {
            if self.remaining().starts_with("</") {
                // Closing tag — return to parent
                break;
            }

            if self.remaining().starts_with('<') {
                // Opening tag or self-closing
                if let Some(tag) = self.try_parse_tag() {
                    self.handle_tag(tag, result, styles);
                    continue;
                }
                // Not a valid tag, treat '<' as text
                self.push_text_char('<', result, styles);
                self.pos += 1;
                continue;
            }

            if self.remaining().starts_with('&') {
                if let Some((decoded, len)) = self.try_decode_entity() {
                    for ch in decoded.chars() {
                        self.push_text_char(ch, result, styles);
                    }
                    self.pos += len;
                    continue;
                }
                // Not a valid entity, treat '&' as text
                self.push_text_char('&', result, styles);
                self.pos += 1;
                continue;
            }

            // Regular text character
            let ch = self.remaining().chars().next().unwrap();
            self.push_text_char(ch, result, styles);
            self.pos += ch.len_utf8();
        }
    }

    fn push_text_char(&self, ch: char, result: &mut Vec<Value>, styles: &StyleState) {
        // Try to merge with previous text node if same styles
        if let Some(last) = result.last_mut() {
            if last.get("type").and_then(|v| v.as_str()) == Some("text") {
                let last_styles_val = last.get("styles").cloned().unwrap_or(json!({}));
                let last_styles = json_to_style_state(&last_styles_val);
                if last_styles.eq(styles) {
                    if let Some(t) = last.get_mut("text") {
                        if let Some(s) = t.as_str() {
                            let mut new_s = s.to_string();
                            new_s.push(ch);
                            *t = json!(new_s);
                            return;
                        }
                    }
                }
            }
        }
        let mut s = String::new();
        s.push(ch);
        result.push(json!({
            "type": "text",
            "text": s,
            "styles": styles.to_json(),
        }));
    }

    fn try_parse_tag(&mut self) -> Option<ParsedTag> {
        if !self.remaining().starts_with('<') {
            return None;
        }

        // Find the end of the tag
        let tag_end = self.remaining().find('>')?;
        let tag_content = &self.remaining()[1..tag_end];
        let is_self_closing = tag_content.ends_with('/');
        let tag_content = if is_self_closing {
            &tag_content[..tag_content.len() - 1]
        } else {
            tag_content
        };

        // Parse tag name and attributes
        let tag_content = tag_content.trim();
        let (name, attrs_str) = match tag_content.find(|c: char| c.is_whitespace()) {
            Some(i) => (&tag_content[..i], &tag_content[i..]),
            None => (tag_content, ""),
        };

        let name = name.to_lowercase();
        let attrs = parse_attributes(attrs_str);

        self.pos += tag_end + 1; // Move past '>'

        Some(ParsedTag { name, attrs, is_self_closing })
    }

    fn skip_closing_tag(&mut self, tag_name: &str) {
        let expected = format!("</{}>", tag_name);
        let expected_upper = format!("</{}>", tag_name.to_uppercase());
        if self.remaining().starts_with(&expected)
            || self.remaining().starts_with(&expected_upper)
            || self
                .remaining()
                .to_lowercase()
                .starts_with(&expected.to_lowercase())
        {
            self.pos += expected.len();
        }
    }

    fn handle_tag(&mut self, tag: ParsedTag, result: &mut Vec<Value>, styles: &StyleState) {
        match tag.name.as_str() {
            "wiki-link" => {
                let page_title = tag.attrs.get("data-page-title").cloned().unwrap_or_default();
                let page_id = tag.attrs.get("data-page-id").cloned().unwrap_or_default();
                // Skip inner content (it's just the display text)
                self.skip_inner_content("wiki-link");
                self.skip_closing_tag("wiki-link");
                result.push(json!({
                    "type": "wikiLink",
                    "props": {
                        "pageTitle": page_title,
                        "pageId": page_id,
                    },
                }));
            }

            "block-ref" => {
                let block_id = tag.attrs.get("data-block-id").cloned().unwrap_or_default();
                let page_id = tag.attrs.get("data-page-id").cloned().unwrap_or_default();
                let text = self.extract_inner_text("block-ref");
                self.skip_closing_tag("block-ref");
                result.push(json!({
                    "type": "blockRef",
                    "props": {
                        "blockId": block_id,
                        "pageId": page_id,
                        "text": text,
                    },
                }));
            }

            "br" => {
                // Line break → newline in text
                self.push_text_char('\n', result, styles);
            }

            "b" | "strong" => {
                let mut new_styles = styles.clone();
                new_styles.bold = true;
                self.parse_nodes(result, &new_styles);
                self.skip_closing_tag(&tag.name);
            }

            "i" | "em" => {
                let mut new_styles = styles.clone();
                new_styles.italic = true;
                self.parse_nodes(result, &new_styles);
                self.skip_closing_tag(&tag.name);
            }

            "code" => {
                let mut new_styles = styles.clone();
                new_styles.code = true;
                self.parse_nodes(result, &new_styles);
                self.skip_closing_tag(&tag.name);
            }

            "u" => {
                let mut new_styles = styles.clone();
                new_styles.underline = true;
                self.parse_nodes(result, &new_styles);
                self.skip_closing_tag(&tag.name);
            }

            "s" | "strike" | "del" => {
                let mut new_styles = styles.clone();
                new_styles.strike = true;
                self.parse_nodes(result, &new_styles);
                self.skip_closing_tag(&tag.name);
            }

            "a" => {
                let href = tag.attrs.get("href").cloned().unwrap_or_default();
                if !href.is_empty() {
                    // Collect inner content as link text
                    let mut inner: Vec<Value> = Vec::new();
                    self.parse_nodes(&mut inner, styles);
                    self.skip_closing_tag("a");

                    // Extract plain text from inner content
                    let link_text: String = inner
                        .iter()
                        .filter_map(|n| {
                            if n.get("type").and_then(|v| v.as_str()) == Some("text") {
                                n.get("text").and_then(|v| v.as_str()).map(|s| s.to_string())
                            } else {
                                None
                            }
                        })
                        .collect();

                    result.push(json!({
                        "type": "link",
                        "href": href,
                        "content": [{ "type": "text", "text": link_text, "styles": styles.to_json() }],
                    }));
                } else {
                    // No href, treat children as regular content
                    self.parse_nodes(result, styles);
                    self.skip_closing_tag("a");
                }
            }

            "mark" => {
                let color = tag
                    .attrs
                    .get("data-color")
                    .cloned()
                    .unwrap_or_else(|| "yellow".to_string());
                let mut new_styles = styles.clone();
                new_styles.highlight = Some(color);
                self.parse_nodes(result, &new_styles);
                self.skip_closing_tag("mark");
            }

            // Unknown tags: just parse children with current styles
            _ => {
                if !tag.is_self_closing {
                    self.parse_nodes(result, styles);
                    self.skip_closing_tag(&tag.name);
                }
            }
        }
    }

    /// Skip over inner content until we hit the closing tag for `tag_name`.
    fn skip_inner_content(&mut self, tag_name: &str) {
        let closing = format!("</{}", tag_name);
        let mut depth = 1;
        while self.pos < self.input.len() && depth > 0 {
            if self.remaining().to_lowercase().starts_with(&closing) {
                depth -= 1;
                if depth == 0 {
                    break;
                }
            }
            let opening = format!("<{}", tag_name);
            if self.remaining().to_lowercase().starts_with(&opening) {
                depth += 1;
            }
            let ch = self.remaining().chars().next().unwrap();
            self.pos += ch.len_utf8();
        }
    }

    /// Extract plain text from inner content until closing tag.
    fn extract_inner_text(&mut self, tag_name: &str) -> String {
        let closing = format!("</{}", tag_name);
        let mut text = String::new();
        let mut in_tag = false;
        while self.pos < self.input.len() {
            if self.remaining().to_lowercase().starts_with(&closing) {
                break;
            }
            let ch = self.remaining().chars().next().unwrap();
            if ch == '<' {
                in_tag = true;
            } else if ch == '>' {
                in_tag = false;
            } else if !in_tag {
                text.push(ch);
            }
            self.pos += ch.len_utf8();
        }
        decode_entities(&text)
    }

    fn try_decode_entity(&self) -> Option<(String, usize)> {
        let rem = self.remaining();
        if !rem.starts_with('&') {
            return None;
        }

        // Find semicolon within reasonable distance
        let end = rem[1..].find(';')?;
        if end > 10 {
            return None;
        }
        let entity = &rem[1..=end];
        let total_len = end + 2; // includes '&' and ';'

        let decoded = match entity {
            "amp" => "&".to_string(),
            "lt" => "<".to_string(),
            "gt" => ">".to_string(),
            "quot" => "\"".to_string(),
            "apos" => "'".to_string(),
            "nbsp" => "\u{00A0}".to_string(),
            _ if entity.starts_with('#') => {
                let num_str = &entity[1..];
                let code_point = if num_str.starts_with('x') || num_str.starts_with('X') {
                    u32::from_str_radix(&num_str[1..], 16).ok()
                } else {
                    num_str.parse::<u32>().ok()
                };
                code_point
                    .and_then(char::from_u32)
                    .map(|c| c.to_string())?
            }
            _ => return None,
        };

        Some((decoded, total_len))
    }
}

struct ParsedTag {
    name: String,
    attrs: std::collections::HashMap<String, String>,
    is_self_closing: bool,
}

fn parse_attributes(s: &str) -> std::collections::HashMap<String, String> {
    let mut attrs = std::collections::HashMap::new();
    let s = s.trim();
    if s.is_empty() {
        return attrs;
    }

    let mut pos = 0;
    let bytes = s.as_bytes();

    while pos < bytes.len() {
        // Skip whitespace
        while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }
        if pos >= bytes.len() {
            break;
        }

        // Read attribute name
        let name_start = pos;
        while pos < bytes.len() && bytes[pos] != b'=' && !bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }
        let name = s[name_start..pos].to_lowercase();

        // Skip whitespace
        while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }

        if pos >= bytes.len() || bytes[pos] != b'=' {
            // Boolean attribute
            attrs.insert(name, String::new());
            continue;
        }
        pos += 1; // skip '='

        // Skip whitespace
        while pos < bytes.len() && bytes[pos].is_ascii_whitespace() {
            pos += 1;
        }

        // Read attribute value
        if pos >= bytes.len() {
            attrs.insert(name, String::new());
            break;
        }

        let value = if bytes[pos] == b'"' {
            pos += 1;
            let start = pos;
            while pos < bytes.len() && bytes[pos] != b'"' {
                pos += 1;
            }
            let val = &s[start..pos];
            if pos < bytes.len() {
                pos += 1;
            }
            val
        } else if bytes[pos] == b'\'' {
            pos += 1;
            let start = pos;
            while pos < bytes.len() && bytes[pos] != b'\'' {
                pos += 1;
            }
            let val = &s[start..pos];
            if pos < bytes.len() {
                pos += 1;
            }
            val
        } else {
            let start = pos;
            while pos < bytes.len() && !bytes[pos].is_ascii_whitespace() {
                pos += 1;
            }
            &s[start..pos]
        };

        attrs.insert(name, decode_attr_entities(value));
    }

    attrs
}

fn decode_attr_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn decode_entities(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&nbsp;", "\u{00A0}")
}

fn json_to_style_state(v: &Value) -> StyleState {
    StyleState {
        bold: v.get("bold").and_then(|v| v.as_bool()).unwrap_or(false),
        italic: v.get("italic").and_then(|v| v.as_bool()).unwrap_or(false),
        code: v.get("code").and_then(|v| v.as_bool()).unwrap_or(false),
        underline: v
            .get("underline")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        strike: v.get("strike").and_then(|v| v.as_bool()).unwrap_or(false),
        highlight: v
            .get("highlight")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    }
}

// ─── HTML helpers ───────────────────────────────────────────────────────────

fn escape_html(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            _ => result.push(ch),
        }
    }
    result
}

fn escape_attr(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for ch in text.chars() {
        match ch {
            '&' => result.push_str("&amp;"),
            '"' => result.push_str("&quot;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            _ => result.push(ch),
        }
    }
    result
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Format detection ────────────────────────────────────────────────

    #[test]
    fn test_is_blocknote_version() {
        assert!(is_blocknote_version(&Some("blocknote-0.47.0".to_string())));
        assert!(is_blocknote_version(&Some(
            "blocknote-1.0.0-beta".to_string()
        )));
        assert!(!is_blocknote_version(&Some("2.28.0".to_string())));
        assert!(!is_blocknote_version(&None));
        assert!(!is_blocknote_version(&Some("".to_string())));
    }

    // ── Inline: HTML → structured → HTML round-trip ─────────────────────

    #[test]
    fn test_inline_plain_text() {
        let html = "Hello world";
        let structured = parse_html_to_inline(html);
        let back = render_inline_to_html(Some(&structured));
        assert_eq!(back, "Hello world");
    }

    #[test]
    fn test_inline_bold() {
        let html = "Hello <b>world</b>!";
        let structured = parse_html_to_inline(html);
        let back = render_inline_to_html(Some(&structured));
        assert_eq!(back, "Hello <b>world</b>!");
    }

    #[test]
    fn test_inline_nested_styles() {
        let html = "<b><i>bold italic</i></b>";
        let structured = parse_html_to_inline(html);
        // Verify the structured content has both bold and italic
        let node = &structured.as_array().unwrap()[0];
        assert_eq!(node.get("styles").unwrap().get("bold").unwrap().as_bool().unwrap(), true);
        assert_eq!(node.get("styles").unwrap().get("italic").unwrap().as_bool().unwrap(), true);
        // Round-trip: serializer applies styles in a fixed order (bold wraps italic)
        let back = render_inline_to_html(Some(&structured));
        assert!(back.contains("bold italic"));
        assert!(back.contains("<b>") && back.contains("<i>"));
    }

    #[test]
    fn test_inline_code() {
        let html = "use <code>println!</code> macro";
        let structured = parse_html_to_inline(html);
        let back = render_inline_to_html(Some(&structured));
        assert_eq!(back, "use <code>println!</code> macro");
    }

    #[test]
    fn test_inline_underline_strike() {
        let html = "<u>underlined</u> and <s>struck</s>";
        let structured = parse_html_to_inline(html);
        let back = render_inline_to_html(Some(&structured));
        assert_eq!(back, "<u>underlined</u> and <s>struck</s>");
    }

    #[test]
    fn test_inline_link() {
        let html = "click <a href=\"https://example.com\">here</a> now";
        let structured = parse_html_to_inline(html);
        let back = render_inline_to_html(Some(&structured));
        assert_eq!(back, "click <a href=\"https://example.com\">here</a> now");
    }

    #[test]
    fn test_inline_wiki_link() {
        let html =
            "see <wiki-link data-page-title=\"My Page\" data-page-id=\"abc\">My Page</wiki-link>";
        let structured = parse_html_to_inline(html);
        let back = render_inline_to_html(Some(&structured));
        assert_eq!(
            back,
            "see <wiki-link data-page-title=\"My Page\" data-page-id=\"abc\">My Page</wiki-link>"
        );
    }

    #[test]
    fn test_inline_block_ref() {
        let html = "ref: <block-ref data-block-id=\"b1\" data-page-id=\"p1\">some text</block-ref>";
        let structured = parse_html_to_inline(html);
        let back = render_inline_to_html(Some(&structured));
        assert_eq!(
            back,
            "ref: <block-ref data-block-id=\"b1\" data-page-id=\"p1\">some text</block-ref>"
        );
    }

    #[test]
    fn test_inline_entities() {
        let html = "Tom &amp; Jerry &lt;3";
        let structured = parse_html_to_inline(html);
        let back = render_inline_to_html(Some(&structured));
        assert_eq!(back, "Tom &amp; Jerry &lt;3");
    }

    #[test]
    fn test_inline_highlight() {
        let html = "<mark data-color=\"yellow\">highlighted</mark>";
        let structured = parse_html_to_inline(html);
        let back = render_inline_to_html(Some(&structured));
        assert!(back.contains("highlighted"));
        assert!(back.contains("data-color=\"yellow\""));
    }

    #[test]
    fn test_inline_br() {
        let html = "line1<br>line2";
        let structured = parse_html_to_inline(html);
        // The text should contain a newline
        let arr = structured.as_array().unwrap();
        let full_text: String = arr
            .iter()
            .filter_map(|n| n.get("text").and_then(|v| v.as_str()))
            .collect();
        assert!(full_text.contains('\n'));
    }

    #[test]
    fn test_inline_empty() {
        let structured = parse_html_to_inline("");
        assert_eq!(structured, json!([]));
        let back = render_inline_to_html(Some(&structured));
        assert_eq!(back, "");
    }

    #[test]
    fn test_inline_special_chars_in_wiki_link() {
        let html = "<wiki-link data-page-title=\"Tom &amp; Jerry\" data-page-id=\"\">Tom &amp; Jerry</wiki-link>";
        let structured = parse_html_to_inline(html);
        // Should decode the entity in the attribute
        let node = &structured.as_array().unwrap()[0];
        assert_eq!(
            node.get("props")
                .unwrap()
                .get("pageTitle")
                .unwrap()
                .as_str()
                .unwrap(),
            "Tom & Jerry"
        );
        // Round-trip should re-escape
        let back = render_inline_to_html(Some(&structured));
        assert!(back.contains("data-page-title=\"Tom &amp; Jerry\""));
    }

    // ── Block conversions: BlockNote → EditorJS ─────────────────────────

    #[test]
    fn test_paragraph_bn_to_ejs() {
        let bn = json!([{
            "id": "p1",
            "type": "paragraph",
            "content": [{ "type": "text", "text": "Hello", "styles": {} }],
        }]);
        let blocks = blocknote_to_editor_blocks(bn.as_array().unwrap());
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].block_type, "paragraph");
        assert_eq!(blocks[0].data.get("text").unwrap().as_str().unwrap(), "Hello");
    }

    #[test]
    fn test_heading_bn_to_ejs() {
        let bn = json!([{
            "id": "h1",
            "type": "heading",
            "props": { "level": 2 },
            "content": [{ "type": "text", "text": "Title", "styles": {} }],
        }]);
        let blocks = blocknote_to_editor_blocks(bn.as_array().unwrap());
        assert_eq!(blocks[0].block_type, "header");
        assert_eq!(blocks[0].data.get("level").unwrap().as_u64().unwrap(), 2);
        assert_eq!(blocks[0].data.get("text").unwrap().as_str().unwrap(), "Title");
    }

    #[test]
    fn test_code_bn_to_ejs() {
        let bn = json!([{
            "id": "c1",
            "type": "codeBlock",
            "props": { "language": "rust" },
            "content": [{ "type": "text", "text": "fn main() {}", "styles": {} }],
        }]);
        let blocks = blocknote_to_editor_blocks(bn.as_array().unwrap());
        assert_eq!(blocks[0].block_type, "code");
        assert_eq!(blocks[0].data.get("code").unwrap().as_str().unwrap(), "fn main() {}");
        assert_eq!(blocks[0].data.get("language").unwrap().as_str().unwrap(), "rust");
    }

    #[test]
    fn test_delimiter_bn_to_ejs() {
        let bn = json!([{ "id": "d1", "type": "delimiter" }]);
        let blocks = blocknote_to_editor_blocks(bn.as_array().unwrap());
        assert_eq!(blocks[0].block_type, "delimiter");
    }

    #[test]
    fn test_image_bn_to_ejs() {
        let bn = json!([{
            "id": "i1",
            "type": "image",
            "props": { "url": "https://example.com/img.png", "caption": "A pic" },
        }]);
        let blocks = blocknote_to_editor_blocks(bn.as_array().unwrap());
        assert_eq!(blocks[0].block_type, "image");
        assert_eq!(
            blocks[0].data.get("file").unwrap().get("url").unwrap().as_str().unwrap(),
            "https://example.com/img.png"
        );
    }

    #[test]
    fn test_table_bn_to_ejs() {
        let bn = json!([{
            "id": "t1",
            "type": "table",
            "content": {
                "type": "tableContent",
                "rows": [
                    { "cells": [
                        [{ "type": "text", "text": "A", "styles": {} }],
                        [{ "type": "text", "text": "B", "styles": {} }],
                    ]},
                ],
            },
        }]);
        let blocks = blocknote_to_editor_blocks(bn.as_array().unwrap());
        assert_eq!(blocks[0].block_type, "table");
        let content = blocks[0].data.get("content").unwrap().as_array().unwrap();
        assert_eq!(content[0].as_array().unwrap()[0].as_str().unwrap(), "A");
    }

    // ── Block conversions: EditorJS → BlockNote ─────────────────────────

    #[test]
    fn test_paragraph_ejs_to_bn() {
        let blocks = vec![EditorBlock {
            id: "p1".to_string(),
            block_type: "paragraph".to_string(),
            data: json!({ "text": "Hello world" }),
        }];
        let bn = editor_blocks_to_blocknote(&blocks);
        assert_eq!(bn.len(), 1);
        assert_eq!(bn[0].get("type").unwrap().as_str().unwrap(), "paragraph");
    }

    #[test]
    fn test_header_ejs_to_bn() {
        let blocks = vec![EditorBlock {
            id: "h1".to_string(),
            block_type: "header".to_string(),
            data: json!({ "text": "Title", "level": 2 }),
        }];
        let bn = editor_blocks_to_blocknote(&blocks);
        assert_eq!(bn[0].get("type").unwrap().as_str().unwrap(), "heading");
        assert_eq!(
            bn[0].get("props").unwrap().get("level").unwrap().as_u64().unwrap(),
            2
        );
    }

    #[test]
    fn test_list_ejs_to_bn_and_back() {
        let blocks = vec![EditorBlock {
            id: "l1".to_string(),
            block_type: "list".to_string(),
            data: json!({
                "style": "unordered",
                "items": [
                    { "content": "Item 1", "items": [] },
                    { "content": "Item 2", "items": [
                        { "content": "Nested", "items": [] },
                    ]},
                ],
            }),
        }];

        // EditorJS → BlockNote
        let bn = editor_blocks_to_blocknote(&blocks);
        assert_eq!(bn.len(), 2); // 2 top-level items
        assert_eq!(bn[0].get("type").unwrap().as_str().unwrap(), "bulletListItem");
        assert_eq!(bn[1].get("type").unwrap().as_str().unwrap(), "bulletListItem");
        // Second item has nested child
        let children = bn[1].get("children").unwrap().as_array().unwrap();
        assert_eq!(children.len(), 1);

        // BlockNote → EditorJS (round-trip each item individually since they become separate list blocks)
        let back = blocknote_to_editor_blocks(&bn);
        // Each bulletListItem becomes its own list block
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].block_type, "list");
        assert_eq!(back[1].block_type, "list");
    }

    #[test]
    fn test_checklist_ejs_to_bn_and_back() {
        let blocks = vec![EditorBlock {
            id: "cl1".to_string(),
            block_type: "checklist".to_string(),
            data: json!({
                "items": [
                    { "text": "Todo 1", "checked": false },
                    { "text": "Done 1", "checked": true },
                ],
            }),
        }];

        let bn = editor_blocks_to_blocknote(&blocks);
        assert_eq!(bn.len(), 2);
        assert_eq!(bn[0].get("type").unwrap().as_str().unwrap(), "checkListItem");
        assert!(!bn[0].get("props").unwrap().get("checked").unwrap().as_bool().unwrap());
        assert!(bn[1].get("props").unwrap().get("checked").unwrap().as_bool().unwrap());

        let back = blocknote_to_editor_blocks(&bn);
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].block_type, "checklist");
    }

    // ── Full round-trip: BlockNote JSON → EditorData → BlockNote JSON ───

    #[test]
    fn test_full_round_trip_paragraph() {
        let original_bn = json!([{
            "id": "p1",
            "type": "paragraph",
            "content": [
                { "type": "text", "text": "Hello ", "styles": {} },
                { "type": "text", "text": "world", "styles": { "bold": true } },
            ],
        }]);

        let editor_blocks = blocknote_to_editor_blocks(original_bn.as_array().unwrap());
        assert_eq!(editor_blocks[0].data.get("text").unwrap().as_str().unwrap(), "Hello <b>world</b>");

        let back_bn = editor_blocks_to_blocknote(&editor_blocks);
        // The text content should be equivalent
        let content = back_bn[0].get("content").unwrap().as_array().unwrap();
        let full_text: String = content
            .iter()
            .filter_map(|n| n.get("text").and_then(|v| v.as_str()))
            .collect();
        assert_eq!(full_text, "Hello world");
    }

    #[test]
    fn test_full_round_trip_with_wiki_link() {
        let original_bn = json!([{
            "id": "p1",
            "type": "paragraph",
            "content": [
                { "type": "text", "text": "see ", "styles": {} },
                { "type": "wikiLink", "props": { "pageTitle": "Test Page", "pageId": "uuid-123" } },
            ],
        }]);

        let editor_blocks = blocknote_to_editor_blocks(original_bn.as_array().unwrap());
        let html = editor_blocks[0].data.get("text").unwrap().as_str().unwrap();
        assert!(html.contains("wiki-link"));
        assert!(html.contains("Test Page"));

        let back_bn = editor_blocks_to_blocknote(&editor_blocks);
        let content = back_bn[0].get("content").unwrap().as_array().unwrap();
        assert_eq!(content.len(), 2);
        assert_eq!(content[1].get("type").unwrap().as_str().unwrap(), "wikiLink");
        assert_eq!(
            content[1].get("props").unwrap().get("pageTitle").unwrap().as_str().unwrap(),
            "Test Page"
        );
    }

    #[test]
    fn test_empty_blocks() {
        let bn = json!([]);
        let blocks = blocknote_to_editor_blocks(bn.as_array().unwrap());
        assert!(blocks.is_empty());

        let back = editor_blocks_to_blocknote(&blocks);
        assert!(back.is_empty());
    }

    #[test]
    fn test_callout_round_trip() {
        let bn = json!([{
            "id": "co1",
            "type": "callout",
            "props": { "type": "warning" },
            "content": [{ "type": "text", "text": "Be careful!", "styles": {} }],
        }]);
        let blocks = blocknote_to_editor_blocks(bn.as_array().unwrap());
        assert_eq!(blocks[0].block_type, "callout");
        assert_eq!(blocks[0].data.get("type").unwrap().as_str().unwrap(), "warning");

        let back = editor_blocks_to_blocknote(&blocks);
        assert_eq!(back[0].get("type").unwrap().as_str().unwrap(), "callout");
        assert_eq!(
            back[0].get("props").unwrap().get("type").unwrap().as_str().unwrap(),
            "warning"
        );
    }

    #[test]
    fn test_columns_round_trip() {
        let bn = json!([{
            "id": "cols1",
            "type": "columnList",
            "children": [
                {
                    "id": "col1",
                    "type": "column",
                    "props": { "width": 0.5 },
                    "children": [{
                        "id": "p1",
                        "type": "paragraph",
                        "content": [{ "type": "text", "text": "Left", "styles": {} }],
                    }],
                },
                {
                    "id": "col2",
                    "type": "column",
                    "props": { "width": 0.5 },
                    "children": [{
                        "id": "p2",
                        "type": "paragraph",
                        "content": [{ "type": "text", "text": "Right", "styles": {} }],
                    }],
                },
            ],
        }]);

        let blocks = blocknote_to_editor_blocks(bn.as_array().unwrap());
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].block_type, "columns");
        let col_data = blocks[0].data.get("columnData").unwrap().as_array().unwrap();
        assert_eq!(col_data.len(), 2);

        let back = editor_blocks_to_blocknote(&blocks);
        assert_eq!(back[0].get("type").unwrap().as_str().unwrap(), "columnList");
        let children = back[0].get("children").unwrap().as_array().unwrap();
        assert_eq!(children.len(), 2);
    }

    #[test]
    fn test_flashcard_round_trip() {
        let bn = json!([{
            "id": "fc1",
            "type": "flashcard",
            "props": {
                "front": "What is Rust?",
                "back": "A systems programming language",
                "cardType": "basic",
                "deckId": "d1",
                "cardId": "c1",
            },
        }]);
        let blocks = blocknote_to_editor_blocks(bn.as_array().unwrap());
        assert_eq!(blocks[0].block_type, "flashcard");
        assert_eq!(blocks[0].data.get("front").unwrap().as_str().unwrap(), "What is Rust?");

        let back = editor_blocks_to_blocknote(&blocks);
        assert_eq!(
            back[0].get("props").unwrap().get("front").unwrap().as_str().unwrap(),
            "What is Rust?"
        );
    }

    #[test]
    fn test_quote_round_trip() {
        let bn = json!([{
            "id": "q1",
            "type": "quote",
            "content": [{ "type": "text", "text": "To be or not to be", "styles": {} }],
        }]);
        let blocks = blocknote_to_editor_blocks(bn.as_array().unwrap());
        assert_eq!(blocks[0].block_type, "quote");

        let back = editor_blocks_to_blocknote(&blocks);
        assert_eq!(back[0].get("type").unwrap().as_str().unwrap(), "quote");
    }
}
