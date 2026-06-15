//! Commands for file-based pages (markdown, PDF, Jupyter, EPUB, calendar)

use std::io::Cursor;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use uuid::Uuid;

use crate::storage::{FileStorageMode, Page, PageType};
use crate::AppState;

use super::notebook::CommandError;

type CommandResult<T> = Result<T, CommandError>;

/// Result of importing a file as a page
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFileResult {
    pub page: Page,
    pub file_type: String,
}

/// Import a file as a new page in the notebook
#[tauri::command]
pub fn import_file_as_page(
    state: State<AppState>,
    notebook_id: String,
    file_path: String,
    storage_mode: String,
    folder_id: Option<String>,
    section_id: Option<String>,
) -> CommandResult<ImportFileResult> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let folder_uuid = folder_id
        .as_ref()
        .map(|id| Uuid::parse_str(id))
        .transpose()
        .map_err(|e| CommandError {
            message: format!("Invalid folder ID: {}", e),
        })?;

    let section_uuid = section_id
        .as_ref()
        .map(|id| Uuid::parse_str(id))
        .transpose()
        .map_err(|e| CommandError {
            message: format!("Invalid section ID: {}", e),
        })?;

    let mode = match storage_mode.as_str() {
        "embedded" => FileStorageMode::Embedded,
        "linked" => FileStorageMode::Linked,
        _ => {
            return Err(CommandError {
                message: format!("Invalid storage mode: {}", storage_mode),
            })
        }
    };

    let path = PathBuf::from(&file_path);
    if !path.exists() {
        return Err(CommandError {
            message: format!("File not found: {}", file_path),
        });
    }

    let page = storage
        .import_file_as_page(notebook_uuid, &path, mode, folder_uuid, section_uuid)
        .map_err(|e| CommandError {
            message: format!("Failed to import file: {}", e),
        })?;

    let file_type = format!("{:?}", page.page_type).to_lowercase();

    // Search index belongs to the daemon. File-based imports (PDF, EPUB,
    // Jupyter, etc.) need richer text extraction than the daemon's basic
    // index_page does today; until the daemon grows that path, run
    // POST /api/search/rebuild after large imports to pick up file content.

    Ok(ImportFileResult { page, file_type })
}

/// Get the file path for a file-based page (for binary files like PDF, EPUB)
#[tauri::command]
pub fn get_file_path(
    app: tauri::AppHandle,
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<String> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let page = storage
        .get_page_any_type(notebook_uuid, page_uuid)
        .map_err(|e| CommandError {
            message: format!("Page not found: {}", e),
        })?;

    let path = storage.get_file_path(&page).map_err(|e| CommandError {
        message: format!("Failed to get file path: {}", e),
    })?;

    // For Html pages, register the parent directory with asset protocol
    // so relative assets (CSS, images) resolve correctly in the iframe
    if page.page_type == PageType::Html {
        if let Some(parent) = path.parent() {
            let _ = app.asset_protocol_scope().allow_directory(parent, true);
        }
    }

    Ok(path.to_string_lossy().to_string())
}

/// Readable HTML content extracted via readability
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadableHtmlResponse {
    pub title: String,
    pub content: String,
}

/// Extract readable article content from an HTML page using readability
#[tauri::command(rename_all = "camelCase")]
pub fn get_readable_html(
    app: tauri::AppHandle,
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<ReadableHtmlResponse> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let page = storage
        .get_page_any_type(notebook_uuid, page_uuid)
        .map_err(|e| CommandError {
            message: format!("Page not found: {}", e),
        })?;

    if page.page_type != PageType::Html {
        return Err(CommandError {
            message: format!("Page is not an HTML page: {:?}", page.page_type),
        });
    }

    let path = storage.get_file_path(&page).map_err(|e| CommandError {
        message: format!("Failed to get file path: {}", e),
    })?;

    // Register parent directory with asset protocol (same as get_file_path)
    if let Some(parent) = path.parent() {
        let _ = app.asset_protocol_scope().allow_directory(parent, true);
    }

    let bytes = std::fs::read(&path).map_err(|e| CommandError {
        message: format!("Failed to read HTML file: {}", e),
    })?;

    let url_str = format!("file://{}", path.to_string_lossy());
    let url = reqwest::Url::parse(&url_str).map_err(|e| CommandError {
        message: format!("Failed to parse file URL: {}", e),
    })?;

    let mut cursor = Cursor::new(&bytes);
    let product = readability::extractor::extract(&mut cursor, &url).map_err(|e| CommandError {
        message: format!("Failed to extract readable content: {}", e),
    })?;

    Ok(ReadableHtmlResponse {
        title: product.title,
        content: product.content,
    })
}

/// Check if a linked file has been modified externally
#[tauri::command]
pub fn check_linked_file_modified(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<bool> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let page = storage
        .get_page_any_type(notebook_uuid, page_uuid)
        .map_err(|e| CommandError {
            message: format!("Page not found: {}", e),
        })?;

    storage
        .check_linked_file_modified(&page)
        .map_err(|e| CommandError {
            message: format!("Failed to check file modification: {}", e),
        })
}

/// Mark a linked file as synced (update last_file_sync timestamp)
#[tauri::command]
pub fn mark_linked_file_synced(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<Page> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    let mut page = storage
        .get_page_any_type(notebook_uuid, page_uuid)
        .map_err(|e| CommandError {
            message: format!("Page not found: {}", e),
        })?;

    // Update the last_file_sync timestamp
    page.last_file_sync = Some(chrono::Utc::now());

    storage.update_page_metadata(&page).map_err(|e| CommandError {
        message: format!("Failed to update page metadata: {}", e),
    })?;

    Ok(page)
}

/// Get list of supported file extensions for import
#[tauri::command]
pub fn get_supported_page_extensions() -> Vec<String> {
    vec![
        "md".to_string(),
        "markdown".to_string(),
        "pdf".to_string(),
        "ipynb".to_string(),
        "epub".to_string(),
        "ics".to_string(),
        "ical".to_string(),
        "html".to_string(),
        "htm".to_string(),
    ]
}

/// Delete a file-based page and its associated files
#[tauri::command]
pub fn delete_file_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
) -> CommandResult<()> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let notebook_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;

    let page_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    // Search index removal happens via the daemon's delete_page handler.
    // Tauri's delete_file_page no longer reaches into the index directly.

    storage
        .delete_file_page(notebook_uuid, page_uuid)
        .map_err(|e| CommandError {
            message: format!("Failed to delete file page: {}", e),
        })
}

/// Execute a Jupyter notebook code cell
#[tauri::command]
pub fn execute_jupyter_cell(
    state: State<AppState>,
    code: String,
    cell_index: usize,
) -> CommandResult<crate::python_bridge::JupyterCellOutput> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python bridge lock: {}", e),
    })?;

    python_ai
        .execute_jupyter_cell(code, cell_index)
        .map_err(|e| CommandError {
            message: format!("Failed to execute cell: {}", e),
        })
}

/// Check if Python execution environment is available
#[tauri::command]
pub fn check_python_execution_available(
    state: State<AppState>,
) -> CommandResult<crate::python_bridge::PythonEnvironmentInfo> {
    let python_ai = state.python_ai.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire Python bridge lock: {}", e),
    })?;

    python_ai
        .check_python_available()
        .map_err(|e| CommandError {
            message: format!("Failed to check Python environment: {}", e),
        })
}

/// Duplicate a database page — copies schema (properties, views) and optionally rows.
/// Returns the newly created page.
#[tauri::command(rename_all = "camelCase")]
pub fn duplicate_database_page(
    state: State<AppState>,
    notebook_id: String,
    page_id: String,
    include_rows: bool,
) -> CommandResult<Page> {
    let storage = state.storage.lock().map_err(|e| CommandError {
        message: format!("Failed to acquire storage lock: {}", e),
    })?;

    let nb_uuid = Uuid::parse_str(&notebook_id).map_err(|e| CommandError {
        message: format!("Invalid notebook ID: {}", e),
    })?;
    let pg_uuid = Uuid::parse_str(&page_id).map_err(|e| CommandError {
        message: format!("Invalid page ID: {}", e),
    })?;

    // 1. Load original page
    let original = storage
        .get_page_any_type(nb_uuid, pg_uuid)
        .map_err(|e| CommandError {
            message: format!("Page not found: {}", e),
        })?;

    if original.page_type != PageType::Database {
        return Err(CommandError {
            message: "Only database pages can be duplicated with this command".to_string(),
        });
    }

    // 2. Read original content
    let content_str = storage.read_native_file_content(&original).map_err(|e| CommandError {
        message: format!("Failed to read database content: {}", e),
    })?;

    let mut content: serde_json::Value = serde_json::from_str(&content_str).map_err(|e| CommandError {
        message: format!("Failed to parse database JSON: {}", e),
    })?;

    // 3. Regenerate UUIDs in properties, rows, and views
    let mut prop_id_map = std::collections::HashMap::new();

    if let Some(props) = content.get_mut("properties").and_then(|v| v.as_array_mut()) {
        for prop in props.iter_mut() {
            if let Some(old_id) = prop.get("id").and_then(|v| v.as_str()).map(|s| s.to_string()) {
                let new_id = Uuid::new_v4().to_string();
                prop["id"] = serde_json::Value::String(new_id.clone());
                prop_id_map.insert(old_id, new_id);
            }
            // Clear relation back-references (the duplicate is independent)
            if let Some(rc) = prop.get_mut("relationConfig") {
                if let Some(obj) = rc.as_object_mut() {
                    obj.remove("backRelationPropertyId");
                }
            }
        }
    }

    if let Some(views) = content.get_mut("views").and_then(|v| v.as_array_mut()) {
        for view in views.iter_mut() {
            view["id"] = serde_json::Value::String(Uuid::new_v4().to_string());
            // Remap property references in sorts, filters, groups, hiddenProperties, pinnedProperties
            remap_view_property_refs(view, &prop_id_map);
        }
    }

    if include_rows {
        if let Some(rows) = content.get_mut("rows").and_then(|v| v.as_array_mut()) {
            for row in rows.iter_mut() {
                row["id"] = serde_json::Value::String(Uuid::new_v4().to_string());
                // Remap cell keys from old property IDs to new ones
                if let Some(cells) = row.get("cells").and_then(|v| v.as_object()).cloned() {
                    let mut new_cells = serde_json::Map::new();
                    for (key, val) in cells {
                        let new_key = prop_id_map.get(&key).cloned().unwrap_or(key);
                        new_cells.insert(new_key, val);
                    }
                    row["cells"] = serde_json::Value::Object(new_cells);
                }
            }
        }
    } else {
        content["rows"] = serde_json::Value::Array(vec![]);
    }

    // 4. Create new page
    let new_title = format!("{} (copy)", original.title);
    let mut new_page = storage.create_page(nb_uuid, new_title).map_err(|e| CommandError {
        message: format!("Failed to create page: {}", e),
    })?;

    // Set page type to database
    new_page.page_type = PageType::Database;
    new_page.file_extension = Some("database".to_string());
    new_page.source_file = Some(format!("files/{}.database", new_page.id));
    new_page.storage_mode = Some(FileStorageMode::Embedded);
    new_page.folder_id = original.folder_id;
    new_page.section_id = original.section_id;
    storage.update_page(&new_page).map_err(|e| CommandError {
        message: format!("Failed to update page: {}", e),
    })?;

    // 5. Write cloned content
    let new_content = serde_json::to_string_pretty(&content).map_err(|e| CommandError {
        message: format!("Failed to serialize database content: {}", e),
    })?;
    storage
        .write_native_file_content(&new_page, &new_content)
        .map_err(|e| CommandError {
            message: format!("Failed to write database content: {}", e),
        })?;

    // 6. Notify sync
    state.sync_manager.queue_page_update(nb_uuid, new_page.id);

    // Daemon handles search indexing now; the duplicated page becomes
    // searchable on its next daemon-side write or via manual rebuild.

    log::info!(
        "Duplicated database page '{}' -> '{}' (include_rows={})",
        original.title,
        new_page.title,
        include_rows,
    );

    Ok(new_page)
}

/// Remap property ID references within a view's sorts, filters, groups, etc.
fn remap_view_property_refs(
    view: &mut serde_json::Value,
    prop_id_map: &std::collections::HashMap<String, String>,
) {
    // Helper: remap a "propertyId" field in an array of objects
    fn remap_array(arr: &mut serde_json::Value, key: &str, map: &std::collections::HashMap<String, String>) {
        if let Some(items) = arr.as_array_mut() {
            for item in items {
                if let Some(old) = item.get(key).and_then(|v| v.as_str()).map(|s| s.to_string()) {
                    if let Some(new) = map.get(&old) {
                        item[key] = serde_json::Value::String(new.clone());
                    }
                }
            }
        }
    }

    if let Some(sorts) = view.get_mut("sorts") {
        remap_array(sorts, "propertyId", prop_id_map);
    }
    if let Some(filters) = view.get_mut("filters") {
        remap_array(filters, "propertyId", prop_id_map);
    }
    if let Some(groups) = view.get_mut("groups") {
        remap_array(groups, "propertyId", prop_id_map);
    }
    // hiddenProperties and pinnedProperties are arrays of property IDs (strings)
    fn remap_id_array(arr: &mut serde_json::Value, map: &std::collections::HashMap<String, String>) {
        if let Some(items) = arr.as_array_mut() {
            for item in items.iter_mut() {
                if let Some(old) = item.as_str().map(|s| s.to_string()) {
                    if let Some(new) = map.get(&old) {
                        *item = serde_json::Value::String(new.clone());
                    }
                }
            }
        }
    }
    if let Some(hidden) = view.get_mut("hiddenProperties") {
        remap_id_array(hidden, prop_id_map);
    }
    if let Some(pinned) = view.get_mut("pinnedProperties") {
        remap_id_array(pinned, prop_id_map);
    }
    // config.columnWidths: remap keys
    if let Some(config) = view.get_mut("config") {
        if let Some(widths) = config.get("columnWidths").and_then(|v| v.as_object()).cloned() {
            let mut new_widths = serde_json::Map::new();
            for (key, val) in widths {
                let new_key = prop_id_map.get(&key).cloned().unwrap_or(key);
                new_widths.insert(new_key, val);
            }
            config["columnWidths"] = serde_json::Value::Object(new_widths);
        }
    }
}
