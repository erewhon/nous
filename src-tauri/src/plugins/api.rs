//! HostApi — the set of host functions exposed to plugins.
//!
//! Every method checks the calling plugin's capabilities before touching storage.

use std::sync::{Arc, Mutex};

use uuid::Uuid;

use super::error::PluginError;
use super::manifest::CapabilitySet;
use crate::goals::GoalsStorage;
use crate::inbox::InboxStorage;
use crate::storage::FileStorage;

/// Host API available to all plugin runtimes.
/// Holds Arc references to the app's storage layers.
pub struct HostApi {
    pub(crate) storage: Arc<Mutex<FileStorage>>,
    pub(crate) goals_storage: Arc<Mutex<GoalsStorage>>,
    pub(crate) inbox_storage: Arc<Mutex<InboxStorage>>,
}

impl HostApi {
    pub fn new(
        storage: Arc<Mutex<FileStorage>>,
        goals_storage: Arc<Mutex<GoalsStorage>>,
        inbox_storage: Arc<Mutex<InboxStorage>>,
    ) -> Self {
        Self {
            storage,
            goals_storage,
            inbox_storage,
        }
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
