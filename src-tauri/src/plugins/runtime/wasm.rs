//! WASM plugin runtime — Extism-based sandboxed WASM execution
//!
//! Each WASM plugin gets its own Extism instance with host functions
//! that delegate to the shared HostApi.

use std::sync::Arc;

use extism::*;

use crate::plugins::api::HostApi;
use crate::plugins::error::PluginError;
use crate::plugins::manifest::{CapabilitySet, HookPoint, PluginManifest};
use crate::plugins::runtime::Plugin;

/// A plugin backed by an Extism WASM runtime.
pub struct WasmPlugin {
    manifest: PluginManifest,
    wasm_bytes: Option<Vec<u8>>,
    plugin: Option<extism::Plugin>,
}

// Safety: WasmPlugin is only accessed behind a Mutex in the registry.
unsafe impl Send for WasmPlugin {}

/// Shared state passed to host functions via UserData.
struct HostState {
    api: Arc<HostApi>,
    plugin_id: String,
    caps: CapabilitySet,
}

impl WasmPlugin {
    /// Create a new WASM plugin from a manifest and raw WASM bytes.
    /// Call `init()` to wire up host functions and instantiate the runtime.
    pub fn new(manifest: PluginManifest, wasm_bytes: Vec<u8>) -> Self {
        Self {
            manifest,
            wasm_bytes: Some(wasm_bytes),
            plugin: None,
        }
    }

    /// Build host functions that call through to the HostApi.
    fn build_host_functions(api: &Arc<HostApi>, plugin_id: &str, caps: CapabilitySet) -> Vec<Function> {
        let state = UserData::new(HostState {
            api: Arc::clone(api),
            plugin_id: plugin_id.to_string(),
            caps,
        });

        let mut fns = Vec::new();

        // Helper: create a host function that reads JSON from WASM memory, calls HostApi, writes JSON back
        macro_rules! host_fn {
            ($name:expr, $state:expr, |$st:ident, $input_str:ident| $body:expr) => {
                Function::new(
                    $name,
                    [PTR],
                    [PTR],
                    $state.clone(),
                    |plugin: &mut CurrentPlugin, inputs: &[Val], outputs: &mut [Val], user_data: UserData<HostState>| {
                        let $input_str: String = plugin.memory_get_val(&inputs[0])?;
                        let data = user_data.get()?;
                        let $st = data.lock().map_err(|e| extism::Error::msg(format!("lock: {e}")))?;
                        let result: Result<serde_json::Value, PluginError> = (|| { $body })();
                        match result {
                            Ok(val) => {
                                let out = serde_json::to_string(&val).unwrap_or_else(|_| "null".to_string());
                                let mem = plugin.memory_new(&out)?;
                                outputs[0] = plugin.memory_to_val(mem);
                                Ok(())
                            }
                            Err(e) => Err(extism::Error::msg(e.to_string())),
                        }
                    },
                )
            };
        }

        // Helper: void host function (no return value, e.g. logging)
        macro_rules! host_fn_void {
            ($name:expr, $state:expr, |$st:ident, $input_str:ident| $body:expr) => {
                Function::new(
                    $name,
                    [PTR],
                    [],
                    $state.clone(),
                    |plugin: &mut CurrentPlugin, inputs: &[Val], _outputs: &mut [Val], user_data: UserData<HostState>| {
                        let $input_str: String = plugin.memory_get_val(&inputs[0])?;
                        let data = user_data.get()?;
                        let $st = data.lock().map_err(|e| extism::Error::msg(format!("lock: {e}")))?;
                        $body;
                        Ok(())
                    },
                )
            };
        }

        // -- Logging --
        fns.push(host_fn_void!("nous_log_info", state, |st, msg| {
            st.api.log_info(&st.plugin_id, &msg)
        }));
        fns.push(host_fn_void!("nous_log_warn", state, |st, msg| {
            st.api.log_warn(&st.plugin_id, &msg)
        }));
        fns.push(host_fn_void!("nous_log_error", state, |st, msg| {
            st.api.log_error(&st.plugin_id, &msg)
        }));

        // -- Page APIs --
        fns.push(host_fn!("nous_page_list", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            st.api.page_list(st.caps, &st.plugin_id, nb)
        }));

        fns.push(host_fn!("nous_page_get", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let pg = args["page_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing page_id".into()))?;
            st.api.page_get(st.caps, &st.plugin_id, nb, pg)
        }));

        fns.push(host_fn!("nous_page_create", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let title = args["title"].as_str().ok_or_else(|| PluginError::CallFailed("missing title".into()))?;
            st.api.page_create(st.caps, &st.plugin_id, nb, title)
        }));

        fns.push(host_fn!("nous_page_update", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let pg = args["page_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing page_id".into()))?;
            st.api.page_update(st.caps, &st.plugin_id, nb, pg, args["title"].as_str(), args["content"].as_str(), args["tags"].as_str())
        }));

        fns.push(host_fn!("nous_page_append", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let pg = args["page_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing page_id".into()))?;
            let content = args["content"].as_str().ok_or_else(|| PluginError::CallFailed("missing content".into()))?;
            st.api.page_append(st.caps, &st.plugin_id, nb, pg, content)
        }));

        fns.push(host_fn!("nous_page_delete", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let pg = args["page_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing page_id".into()))?;
            st.api.page_delete(st.caps, &st.plugin_id, nb, pg)
        }));

        fns.push(host_fn!("nous_page_move", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let pg = args["page_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing page_id".into()))?;
            st.api.page_move(st.caps, &st.plugin_id, nb, pg, args["folder_id"].as_str(), args["section_id"].as_str())
        }));

        fns.push(host_fn!("nous_page_manage_tags", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let pg = args["page_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing page_id".into()))?;
            st.api.page_manage_tags(st.caps, &st.plugin_id, nb, pg, args["add"].as_str(), args["remove"].as_str())
        }));

        // -- Notebook/Folder APIs --
        fns.push(host_fn!("nous_list_notebooks", state, |st, _input| {
            st.api.list_notebooks(st.caps, &st.plugin_id)
        }));

        fns.push(host_fn!("nous_list_sections", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            st.api.list_sections(st.caps, &st.plugin_id, nb)
        }));

        fns.push(host_fn!("nous_list_folders", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            st.api.list_folders(st.caps, &st.plugin_id, nb)
        }));

        fns.push(host_fn!("nous_create_folder", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let name = args["name"].as_str().ok_or_else(|| PluginError::CallFailed("missing name".into()))?;
            st.api.create_folder(st.caps, &st.plugin_id, nb, name, args["parent_id"].as_str())
        }));

        // -- Inbox APIs --
        fns.push(host_fn!("nous_inbox_capture", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let title = args["title"].as_str().ok_or_else(|| PluginError::CallFailed("missing title".into()))?;
            let content = args["content"].as_str().unwrap_or("");
            let tags: Vec<String> = args["tags"].as_array()
                .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();
            st.api.inbox_capture(st.caps, &st.plugin_id, title, content, &tags)
        }));

        fns.push(host_fn!("nous_inbox_list", state, |st, _input| {
            st.api.inbox_list(st.caps, &st.plugin_id)
        }));

        fns.push(host_fn!("nous_inbox_delete", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let id = args["item_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing item_id".into()))?;
            st.api.inbox_delete(st.caps, &st.plugin_id, id)
        }));

        // -- Goals APIs --
        fns.push(host_fn!("nous_goals_list", state, |st, _input| {
            st.api.goals_list(st.caps, &st.plugin_id)
        }));

        fns.push(host_fn!("nous_goal_record_progress", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let gid = args["goal_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing goal_id".into()))?;
            let date = args["date"].as_str().ok_or_else(|| PluginError::CallFailed("missing date".into()))?;
            let completed = args["completed"].as_bool().unwrap_or(true);
            let value = args["value"].as_u64().map(|v| v as u32);
            st.api.goal_record_progress(st.caps, &st.plugin_id, gid, date, completed, value)
        }));

        fns.push(host_fn!("nous_goal_get_stats", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let gid = args["goal_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing goal_id".into()))?;
            st.api.goal_get_stats(st.caps, &st.plugin_id, gid)
        }));

        fns.push(host_fn!("nous_goal_get_summary", state, |st, _input| {
            st.api.goal_get_summary(st.caps, &st.plugin_id)
        }));

        fns.push(host_fn!("nous_goal_get_progress", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let gid = args["goal_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing goal_id".into()))?;
            let limit = args["limit"].as_u64().map(|v| v as usize);
            st.api.goal_get_progress(st.caps, &st.plugin_id, gid, limit)
        }));

        // -- Database APIs --
        fns.push(host_fn!("nous_database_list", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            st.api.database_list(st.caps, &st.plugin_id, nb)
        }));

        fns.push(host_fn!("nous_database_get", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let pg = args["page_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing page_id".into()))?;
            st.api.database_get(st.caps, &st.plugin_id, nb, pg)
        }));

        fns.push(host_fn!("nous_database_create", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let title = args["title"].as_str().ok_or_else(|| PluginError::CallFailed("missing title".into()))?;
            let props = args["properties"].as_str().ok_or_else(|| PluginError::CallFailed("missing properties".into()))?;
            st.api.database_create(st.caps, &st.plugin_id, nb, title, props)
        }));

        fns.push(host_fn!("nous_database_add_rows", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let pg = args["page_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing page_id".into()))?;
            let rows = args["rows"].as_str().ok_or_else(|| PluginError::CallFailed("missing rows".into()))?;
            st.api.database_add_rows(st.caps, &st.plugin_id, nb, pg, rows)
        }));

        fns.push(host_fn!("nous_database_update_rows", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let pg = args["page_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing page_id".into()))?;
            let updates = args["updates"].as_str().ok_or_else(|| PluginError::CallFailed("missing updates".into()))?;
            st.api.database_update_rows(st.caps, &st.plugin_id, nb, pg, updates)
        }));

        // -- Daily Notes APIs --
        fns.push(host_fn!("nous_daily_note_list", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let limit = args["limit"].as_u64().map(|v| v as usize);
            st.api.daily_note_list(st.caps, &st.plugin_id, nb, limit)
        }));

        fns.push(host_fn!("nous_daily_note_get", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let date = args["date"].as_str().ok_or_else(|| PluginError::CallFailed("missing date".into()))?;
            st.api.daily_note_get(st.caps, &st.plugin_id, nb, date)
        }));

        fns.push(host_fn!("nous_daily_note_create", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let nb = args["notebook_id"].as_str().ok_or_else(|| PluginError::CallFailed("missing notebook_id".into()))?;
            let date = args["date"].as_str().ok_or_else(|| PluginError::CallFailed("missing date".into()))?;
            st.api.daily_note_create(st.caps, &st.plugin_id, nb, date, args["content"].as_str())
        }));

        // -- Search API --
        fns.push(host_fn!("nous_search", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let query = args["query"].as_str().ok_or_else(|| PluginError::CallFailed("missing query".into()))?;
            let limit = args["limit"].as_u64().map(|v| v as usize).unwrap_or(20);
            st.api.search(st.caps, &st.plugin_id, query, limit)
        }));

        // -- Energy APIs --
        fns.push(host_fn!("nous_energy_get_checkins", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let limit = args["limit"].as_u64().map(|v| v as usize);
            st.api.energy_get_checkins(st.caps, &st.plugin_id, args["start"].as_str(), args["end"].as_str(), limit)
        }));

        fns.push(host_fn!("nous_energy_get_patterns", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            st.api.energy_get_patterns(st.caps, &st.plugin_id, args["start"].as_str(), args["end"].as_str())
        }));

        // -- Network API --
        fns.push(host_fn!("nous_http_request", state, |st, input| {
            let args: serde_json::Value = serde_json::from_str(&input).map_err(|e| PluginError::CallFailed(e.to_string()))?;
            let method = args["method"].as_str().ok_or_else(|| PluginError::CallFailed("missing method".into()))?;
            let url = args["url"].as_str().ok_or_else(|| PluginError::CallFailed("missing url".into()))?;
            let body = args["body"].as_str();
            let headers: Option<std::collections::HashMap<String, String>> = args.get("headers")
                .and_then(|v| serde_json::from_value(v.clone()).ok());
            let timeout = args["timeout"].as_u64();
            st.api.http_request(st.caps, &st.plugin_id, method, url, body, headers.as_ref(), timeout)
        }));

        fns
    }
}

impl Plugin for WasmPlugin {
    fn id(&self) -> &str {
        &self.manifest.id
    }

    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn init(&mut self, api: &Arc<HostApi>) -> Result<(), PluginError> {
        let wasm_bytes = self.wasm_bytes.take().ok_or_else(|| {
            PluginError::InitFailed("WASM bytes already consumed".to_string())
        })?;

        let host_fns = Self::build_host_functions(api, &self.manifest.id, self.manifest.capabilities);

        let plugin = extism::Plugin::new(wasm_bytes, host_fns, true)
            .map_err(|e| PluginError::InitFailed(format!("Extism plugin creation failed: {e}")))?;

        self.plugin = Some(plugin);
        Ok(())
    }

    fn call(
        &mut self,
        function: &str,
        input: &serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        let plugin = self.plugin.as_mut().ok_or_else(|| {
            PluginError::CallFailed("WASM plugin not initialized".to_string())
        })?;

        let input_str = serde_json::to_string(input)?;

        let result_str = plugin
            .call::<&str, String>(function, &input_str)
            .map_err(|e| {
                PluginError::CallFailed(format!(
                    "WASM function '{function}' in plugin '{}' failed: {e}",
                    self.manifest.id
                ))
            })?;

        let result: serde_json::Value = serde_json::from_str(&result_str)?;
        Ok(result)
    }

    fn handles_hook(&self, hook: &HookPoint) -> bool {
        self.manifest.hooks.contains(hook)
    }
}
