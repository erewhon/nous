//! HostApi — the set of host functions exposed to plugins.
//!
//! Every method checks the calling plugin's capabilities before touching storage.

use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use uuid::Uuid;

use super::error::PluginError;
use super::manifest::CapabilitySet;
use crate::goals::GoalsStorage;
use crate::inbox::InboxStorage;
use crate::search::SearchIndex;
use crate::storage::{FileStorage, FileStorageMode, PageType};

/// Maximum timeout for HTTP requests (60 seconds).
const MAX_TIMEOUT_SECS: u64 = 60;
/// Maximum response body size (10 MB).
const MAX_RESPONSE_BYTES: usize = 10 * 1024 * 1024;

/// Host API available to all plugin runtimes.
/// Holds Arc references to the app's storage layers.
pub struct HostApi {
    pub(crate) storage: Arc<Mutex<FileStorage>>,
    pub(crate) goals_storage: Arc<Mutex<GoalsStorage>>,
    pub(crate) inbox_storage: Arc<Mutex<InboxStorage>>,
    pub(crate) search_index: Option<Arc<Mutex<SearchIndex>>>,
    pub(crate) http_client: reqwest::blocking::Client,
}

impl HostApi {
    pub fn new(
        storage: Arc<Mutex<FileStorage>>,
        goals_storage: Arc<Mutex<GoalsStorage>>,
        inbox_storage: Arc<Mutex<InboxStorage>>,
    ) -> Self {
        let http_client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::limited(5))
            .user_agent("nous-plugin/1.0")
            .build()
            .unwrap_or_else(|_| reqwest::blocking::Client::new());

        Self {
            storage,
            goals_storage,
            inbox_storage,
            search_index: None,
            http_client,
        }
    }

    /// Set the search index reference (called after construction when Arc is available).
    pub fn set_search_index(&mut self, search_index: Arc<Mutex<SearchIndex>>) {
        self.search_index = Some(search_index);
    }

    // -- Capability gate helper --

    fn require(
        caps: CapabilitySet,
        needed: CapabilitySet,
        plugin_id: &str,
    ) -> Result<(), PluginError> {
        if !caps.contains(needed) {
            return Err(PluginError::CapabilityDenied {
                plugin_id: plugin_id.to_string(),
                capability: format!("{needed}"),
            });
        }
        Ok(())
    }

    // -- Page APIs --

    pub fn page_list(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        notebook_id: &str,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::PAGE_READ, plugin_id)?;
        let nid = Uuid::parse_str(notebook_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid notebook_id: {e}")))?;
        let storage = self.storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("storage lock: {e}"))
        })?;
        let pages = storage
            .list_pages(nid)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        serde_json::to_value(&pages).map_err(PluginError::Json)
    }

    pub fn page_get(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        notebook_id: &str,
        page_id: &str,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::PAGE_READ, plugin_id)?;
        let nid = Uuid::parse_str(notebook_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid notebook_id: {e}")))?;
        let pid = Uuid::parse_str(page_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid page_id: {e}")))?;
        let storage = self.storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("storage lock: {e}"))
        })?;
        let page = storage
            .get_page(nid, pid)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        serde_json::to_value(&page).map_err(PluginError::Json)
    }

    // -- Inbox APIs --

    pub fn inbox_capture(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        title: &str,
        content: &str,
        tags: &[String],
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::INBOX_CAPTURE, plugin_id)?;
        let inbox = self.inbox_storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("inbox lock: {e}"))
        })?;
        let request = crate::inbox::CaptureRequest {
            title: title.to_string(),
            content: content.to_string(),
            tags: if tags.is_empty() {
                None
            } else {
                Some(tags.to_vec())
            },
            source: Some(crate::inbox::CaptureSource::Api {
                source: format!("plugin:{plugin_id}"),
            }),
            auto_classify: None,
        };
        let item = inbox
            .capture(request)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        serde_json::to_value(&item).map_err(PluginError::Json)
    }

    pub fn inbox_list(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::INBOX_CAPTURE, plugin_id)?;
        let inbox = self.inbox_storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("inbox lock: {e}"))
        })?;
        let items = inbox
            .list_items()
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        serde_json::to_value(&items).map_err(PluginError::Json)
    }

    // -- Goals APIs --

    pub fn goals_list(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::GOALS_READ, plugin_id)?;
        let goals = self.goals_storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("goals lock: {e}"))
        })?;
        let list = goals
            .list_active_goals()
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        serde_json::to_value(&list).map_err(PluginError::Json)
    }

    pub fn goal_record_progress(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        goal_id: &str,
        date: &str,
        completed: bool,
        value: Option<u32>,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::GOALS_WRITE, plugin_id)?;
        let gid = Uuid::parse_str(goal_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid goal_id: {e}")))?;
        let date = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
            .map_err(|e| PluginError::CallFailed(format!("invalid date: {e}")))?;

        let progress = crate::goals::GoalProgress {
            goal_id: gid,
            date,
            completed,
            auto_detected: true,
            value,
        };

        let goals = self.goals_storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("goals lock: {e}"))
        })?;
        goals
            .record_progress(progress.clone())
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        serde_json::to_value(&progress).map_err(PluginError::Json)
    }

    pub fn goal_get_stats(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        goal_id: &str,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::GOALS_READ, plugin_id)?;
        let gid = Uuid::parse_str(goal_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid goal_id: {e}")))?;
        let goals = self.goals_storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("goals lock: {e}"))
        })?;
        let stats = goals
            .calculate_stats(gid)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        serde_json::to_value(&stats).map_err(PluginError::Json)
    }

    pub fn goal_get_summary(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::GOALS_READ, plugin_id)?;
        let goals = self.goals_storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("goals lock: {e}"))
        })?;
        let summary = goals
            .get_summary()
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        serde_json::to_value(&summary).map_err(PluginError::Json)
    }

    // -- Database APIs --

    /// List database pages in a notebook.
    pub fn database_list(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        notebook_id: &str,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::DATABASE_READ, plugin_id)?;
        let nid = Uuid::parse_str(notebook_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid notebook_id: {e}")))?;
        let storage = self.storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("storage lock: {e}"))
        })?;
        let pages = storage
            .list_pages(nid)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;

        let databases: Vec<serde_json::Value> = pages
            .into_iter()
            .filter(|p| p.page_type == PageType::Database)
            .map(|p| {
                // Try to read database content to get property/row counts
                let (prop_count, row_count) = storage
                    .read_native_file_content(&p)
                    .ok()
                    .and_then(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
                    .map(|v| {
                        let props = v.get("properties").and_then(|a| a.as_array()).map_or(0, |a| a.len());
                        let rows = v.get("rows").and_then(|a| a.as_array()).map_or(0, |a| a.len());
                        (props, rows)
                    })
                    .unwrap_or((0, 0));

                serde_json::json!({
                    "id": p.id.to_string(),
                    "title": p.title,
                    "tags": p.tags,
                    "folderId": p.folder_id,
                    "sectionId": p.section_id,
                    "propertyCount": prop_count,
                    "rowCount": row_count,
                })
            })
            .collect();

        Ok(serde_json::Value::Array(databases))
    }

    /// Get full database content (properties, rows, views).
    pub fn database_get(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        notebook_id: &str,
        page_id: &str,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::DATABASE_READ, plugin_id)?;
        let nid = Uuid::parse_str(notebook_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid notebook_id: {e}")))?;
        let pid = Uuid::parse_str(page_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid page_id: {e}")))?;
        let storage = self.storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("storage lock: {e}"))
        })?;
        let page = storage
            .get_page(nid, pid)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;

        if page.page_type != PageType::Database {
            return Err(PluginError::CallFailed(format!(
                "page {} is not a database",
                pid
            )));
        }

        let content = storage
            .read_native_file_content(&page)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        let db: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| PluginError::CallFailed(format!("invalid database JSON: {e}")))?;
        Ok(db)
    }

    /// Create a new database page.
    pub fn database_create(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        notebook_id: &str,
        title: &str,
        properties_json: &str,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::DATABASE_WRITE, plugin_id)?;
        let nid = Uuid::parse_str(notebook_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid notebook_id: {e}")))?;

        // Parse properties from plugin input: [{"name":"Name","type":"text"}, ...]
        let input_props: Vec<serde_json::Value> = serde_json::from_str(properties_json)
            .map_err(|e| PluginError::CallFailed(format!("invalid properties JSON: {e}")))?;

        // Build versioned property definitions with generated IDs
        let properties: Vec<serde_json::Value> = input_props
            .into_iter()
            .map(|mut prop| {
                if prop.get("id").is_none() {
                    prop.as_object_mut().map(|m| {
                        m.insert("id".to_string(), serde_json::json!(Uuid::new_v4().to_string()));
                    });
                }
                prop
            })
            .collect();

        // Build default table view
        let default_view = serde_json::json!({
            "id": Uuid::new_v4().to_string(),
            "name": "Table",
            "type": "table",
            "sorts": [],
            "filters": [],
            "config": { "type": "table" },
        });

        let db_content = serde_json::json!({
            "version": 2,
            "properties": properties,
            "rows": [],
            "views": [default_view],
        });

        let storage = self.storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("storage lock: {e}"))
        })?;

        // Create the page
        let mut page = storage
            .create_page(nid, title.to_string())
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;

        // Set database page type and file info
        page.page_type = PageType::Database;
        page.file_extension = Some("database".to_string());
        page.storage_mode = Some(FileStorageMode::Embedded);
        page.source_file = Some(format!("files/{}.database", page.id));

        // Write the database content file
        let notebook_dir = storage.get_notebook_path(nid);
        let files_dir = notebook_dir.join("files");
        std::fs::create_dir_all(&files_dir).map_err(|e| {
            PluginError::CallFailed(format!("create files dir: {e}"))
        })?;
        let db_json = serde_json::to_string_pretty(&db_content)
            .map_err(|e| PluginError::CallFailed(format!("serialize database: {e}")))?;
        std::fs::write(files_dir.join(format!("{}.database", page.id)), &db_json)
            .map_err(|e| PluginError::CallFailed(format!("write database file: {e}")))?;

        // Update the page metadata
        storage
            .update_page(&page)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;

        Ok(serde_json::json!({
            "id": page.id.to_string(),
            "title": page.title,
            "notebookId": nid.to_string(),
            "propertyCount": properties.len(),
        }))
    }

    /// Append rows to an existing database.
    pub fn database_add_rows(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        notebook_id: &str,
        page_id: &str,
        rows_json: &str,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::DATABASE_WRITE, plugin_id)?;
        let nid = Uuid::parse_str(notebook_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid notebook_id: {e}")))?;
        let pid = Uuid::parse_str(page_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid page_id: {e}")))?;

        let storage = self.storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("storage lock: {e}"))
        })?;
        let page = storage
            .get_page(nid, pid)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;

        if page.page_type != PageType::Database {
            return Err(PluginError::CallFailed(format!(
                "page {} is not a database",
                pid
            )));
        }

        // Read existing database content
        let content = storage
            .read_native_file_content(&page)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        let mut db: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| PluginError::CallFailed(format!("invalid database JSON: {e}")))?;

        // Parse input rows: [{"PropName": "value", ...}, ...]
        // Plugins use property names; we need to resolve them to property IDs.
        let input_rows: Vec<serde_json::Map<String, serde_json::Value>> =
            serde_json::from_str(rows_json)
                .map_err(|e| PluginError::CallFailed(format!("invalid rows JSON: {e}")))?;

        // Build name→id map from properties
        let name_to_id = Self::build_property_name_map(&db);

        let now = chrono::Utc::now().to_rfc3339();
        let rows_arr = db
            .get_mut("rows")
            .and_then(|v| v.as_array_mut())
            .ok_or_else(|| PluginError::CallFailed("database has no rows array".to_string()))?;

        let added = input_rows.len();
        for input_row in input_rows {
            let mut cells = serde_json::Map::new();
            for (key, value) in input_row {
                // Resolve property name to ID, fall back to using key as-is (might be an ID)
                let prop_id = name_to_id.get(&key).cloned().unwrap_or(key);
                cells.insert(prop_id, value);
            }
            rows_arr.push(serde_json::json!({
                "id": Uuid::new_v4().to_string(),
                "cells": cells,
                "createdAt": now,
                "updatedAt": now,
            }));
        }

        let total = rows_arr.len();

        // Write back
        let db_json = serde_json::to_string_pretty(&db)
            .map_err(|e| PluginError::CallFailed(format!("serialize database: {e}")))?;
        storage
            .write_native_file_content(&page, &db_json)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;

        Ok(serde_json::json!({
            "databaseId": pid.to_string(),
            "rowsAdded": added,
            "totalRows": total,
        }))
    }

    /// Update specific cells in existing database rows.
    pub fn database_update_rows(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        notebook_id: &str,
        page_id: &str,
        updates_json: &str,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::DATABASE_WRITE, plugin_id)?;
        let nid = Uuid::parse_str(notebook_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid notebook_id: {e}")))?;
        let pid = Uuid::parse_str(page_id)
            .map_err(|e| PluginError::CallFailed(format!("invalid page_id: {e}")))?;

        let storage = self.storage.lock().map_err(|e| {
            PluginError::CallFailed(format!("storage lock: {e}"))
        })?;
        let page = storage
            .get_page(nid, pid)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;

        if page.page_type != PageType::Database {
            return Err(PluginError::CallFailed(format!(
                "page {} is not a database",
                pid
            )));
        }

        // Read existing database content
        let content = storage
            .read_native_file_content(&page)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        let mut db: serde_json::Value = serde_json::from_str(&content)
            .map_err(|e| PluginError::CallFailed(format!("invalid database JSON: {e}")))?;

        // Parse updates: [{"row": 0_or_"uuid", "cells": {"PropName": "value"}}, ...]
        let updates: Vec<serde_json::Value> = serde_json::from_str(updates_json)
            .map_err(|e| PluginError::CallFailed(format!("invalid updates JSON: {e}")))?;

        let name_to_id = Self::build_property_name_map(&db);
        let now = chrono::Utc::now().to_rfc3339();

        let rows_arr = db
            .get_mut("rows")
            .and_then(|v| v.as_array_mut())
            .ok_or_else(|| PluginError::CallFailed("database has no rows array".to_string()))?;

        let mut updated_count = 0usize;
        for update in &updates {
            let row_ref = update.get("row").ok_or_else(|| {
                PluginError::CallFailed("update missing 'row' field".to_string())
            })?;
            let cell_updates = update
                .get("cells")
                .and_then(|v| v.as_object())
                .ok_or_else(|| {
                    PluginError::CallFailed("update missing 'cells' object".to_string())
                })?;

            // Find the row by index or UUID
            let row = if let Some(idx) = row_ref.as_u64() {
                rows_arr.get_mut(idx as usize)
            } else if let Some(uuid_str) = row_ref.as_str() {
                rows_arr.iter_mut().find(|r| {
                    r.get("id").and_then(|v| v.as_str()) == Some(uuid_str)
                })
            } else {
                None
            };

            let Some(row) = row else {
                continue;
            };

            let cells = row
                .get_mut("cells")
                .and_then(|v| v.as_object_mut())
                .ok_or_else(|| {
                    PluginError::CallFailed("row has no cells object".to_string())
                })?;

            for (key, value) in cell_updates {
                let prop_id = name_to_id.get(key).cloned().unwrap_or_else(|| key.clone());
                cells.insert(prop_id, value.clone());
            }

            // Update timestamp
            if let Some(obj) = row.as_object_mut() {
                obj.insert("updatedAt".to_string(), serde_json::json!(now));
            }

            updated_count += 1;
        }

        // Write back
        let db_json = serde_json::to_string_pretty(&db)
            .map_err(|e| PluginError::CallFailed(format!("serialize database: {e}")))?;
        storage
            .write_native_file_content(&page, &db_json)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;

        Ok(serde_json::json!({
            "databaseId": pid.to_string(),
            "rowsUpdated": updated_count,
        }))
    }

    /// Build a map from property name → property id from a database JSON value.
    fn build_property_name_map(db: &serde_json::Value) -> std::collections::HashMap<String, String> {
        let mut map = std::collections::HashMap::new();
        if let Some(props) = db.get("properties").and_then(|v| v.as_array()) {
            for prop in props {
                if let (Some(name), Some(id)) = (
                    prop.get("name").and_then(|v| v.as_str()),
                    prop.get("id").and_then(|v| v.as_str()),
                ) {
                    map.insert(name.to_string(), id.to_string());
                }
            }
        }
        map
    }

    // -- Search API --

    /// Search pages across all notebooks.
    pub fn search(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        query: &str,
        limit: usize,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::SEARCH, plugin_id)?;
        let search_index = self
            .search_index
            .as_ref()
            .ok_or_else(|| PluginError::CallFailed("search index not available".to_string()))?;
        let index = search_index.lock().map_err(|e| {
            PluginError::CallFailed(format!("search lock: {e}"))
        })?;
        let results = index
            .search(query, limit)
            .map_err(|e| PluginError::CallFailed(e.to_string()))?;
        serde_json::to_value(&results).map_err(PluginError::Json)
    }

    // -- Network API --

    /// Make an HTTP request. Gated on NETWORK capability.
    pub fn http_request(
        &self,
        caps: CapabilitySet,
        plugin_id: &str,
        method: &str,
        url: &str,
        body: Option<&str>,
        headers: Option<&std::collections::HashMap<String, String>>,
        timeout_secs: Option<u64>,
    ) -> Result<serde_json::Value, PluginError> {
        Self::require(caps, CapabilitySet::NETWORK, plugin_id)?;

        // Validate URL scheme
        let parsed_url: reqwest::Url = url
            .parse()
            .map_err(|e| PluginError::CallFailed(format!("invalid URL: {e}")))?;
        match parsed_url.scheme() {
            "http" | "https" => {}
            other => {
                return Err(PluginError::CallFailed(format!(
                    "blocked URL scheme: {other} (only http/https allowed)"
                )));
            }
        }

        // SSRF prevention: block private/loopback addresses
        if let Some(host) = parsed_url.host_str() {
            let is_blocked = match host {
                "localhost" | "0.0.0.0" => true,
                h => {
                    if let Ok(ip) = h.parse::<IpAddr>() {
                        match ip {
                            IpAddr::V4(v4) => {
                                v4.is_loopback()
                                    || v4.is_private()
                                    || v4.is_link_local()
                                    || v4.is_unspecified()
                            }
                            IpAddr::V6(v6) => v6.is_loopback() || v6.is_unspecified(),
                        }
                    } else {
                        false
                    }
                }
            };
            if is_blocked {
                return Err(PluginError::CallFailed(format!(
                    "blocked request to private/loopback address: {host}"
                )));
            }
        }

        // Parse method
        let http_method = match method.to_uppercase().as_str() {
            "GET" => reqwest::Method::GET,
            "POST" => reqwest::Method::POST,
            "PUT" => reqwest::Method::PUT,
            "PATCH" => reqwest::Method::PATCH,
            "DELETE" => reqwest::Method::DELETE,
            "HEAD" => reqwest::Method::HEAD,
            other => {
                return Err(PluginError::CallFailed(format!(
                    "unsupported HTTP method: {other}"
                )));
            }
        };

        // Cap timeout
        let timeout = Duration::from_secs(timeout_secs.unwrap_or(30).min(MAX_TIMEOUT_SECS));

        // Build request
        let mut req = self.http_client.request(http_method, url).timeout(timeout);

        // Add headers (filter dangerous ones)
        if let Some(hdrs) = headers {
            for (k, v) in hdrs {
                let lower = k.to_lowercase();
                if lower == "host" || lower == "transfer-encoding" {
                    continue;
                }
                req = req.header(k.as_str(), v.as_str());
            }
        }

        // Add body
        if let Some(b) = body {
            req = req.body(b.to_string());
        }

        // Execute
        let response = req
            .send()
            .map_err(|e| PluginError::CallFailed(format!("HTTP request failed: {e}")))?;

        let status = response.status().as_u16();

        // Collect response headers
        let resp_headers: std::collections::HashMap<String, String> = response
            .headers()
            .iter()
            .filter_map(|(k, v)| v.to_str().ok().map(|vs| (k.to_string(), vs.to_string())))
            .collect();

        // Read body with size limit
        let body_bytes = response
            .bytes()
            .map_err(|e| PluginError::CallFailed(format!("failed to read response body: {e}")))?;
        if body_bytes.len() > MAX_RESPONSE_BYTES {
            return Err(PluginError::CallFailed(format!(
                "response body too large: {} bytes (max {})",
                body_bytes.len(),
                MAX_RESPONSE_BYTES
            )));
        }
        let body_str = String::from_utf8_lossy(&body_bytes).to_string();

        Ok(serde_json::json!({
            "status": status,
            "headers": resp_headers,
            "body": body_str,
        }))
    }

    // -- Logging APIs (no capability required) --

    pub fn log_info(&self, _plugin_id: &str, msg: &str) {
        log::info!("[plugin] {msg}");
    }

    pub fn log_warn(&self, _plugin_id: &str, msg: &str) {
        log::warn!("[plugin] {msg}");
    }

    pub fn log_error(&self, _plugin_id: &str, msg: &str) {
        log::error!("[plugin] {msg}");
    }
}
