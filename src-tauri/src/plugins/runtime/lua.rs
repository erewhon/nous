//! Lua plugin runtime — one sandboxed mlua VM per plugin

use std::sync::Arc;

use mlua::prelude::*;

use crate::plugins::api::HostApi;
use crate::plugins::error::PluginError;
use crate::plugins::manifest::{CapabilitySet, HookPoint, PluginManifest};
use crate::plugins::runtime::Plugin;

/// A plugin backed by an mlua Lua 5.4 VM.
pub struct LuaPlugin {
    manifest: PluginManifest,
    lua: Lua,
}

impl LuaPlugin {
    /// Create a new Lua plugin from a manifest and source code.
    /// The VM is created and source loaded, but `init()` must be called to wire up host APIs.
    pub fn new(manifest: PluginManifest, source_code: String) -> Result<Self, PluginError> {
        // Create sandboxed Lua VM with limited stdlib
        let lua = Lua::new_with(
            LuaStdLib::TABLE | LuaStdLib::STRING | LuaStdLib::MATH | LuaStdLib::COROUTINE | LuaStdLib::UTF8,
            LuaOptions::default(),
        )
        .map_err(|e| PluginError::LoadFailed(format!("Lua VM creation failed: {e}")))?;

        // Set memory limit (64 MB)
        lua.set_memory_limit(64 * 1024 * 1024);

        // Load the plugin source
        lua.load(&source_code)
            .set_name(&manifest.id)
            .exec()
            .map_err(|e| {
                PluginError::LoadFailed(format!(
                    "Lua source load failed for '{}': {e}",
                    manifest.id
                ))
            })?;

        Ok(Self { manifest, lua })
    }

    /// Register the `nous.*` global table with host API functions.
    fn register_host_api(&self, api: &Arc<HostApi>) -> Result<(), PluginError> {
        let nous = self.lua.create_table().map_err(|e| {
            PluginError::InitFailed(format!("create nous table: {e}"))
        })?;

        let plugin_id = self.manifest.id.clone();
        let caps = self.manifest.capabilities;

        // -- JSON helpers --
        {
            let json_decode = self.lua.create_function(|lua, s: String| {
                let val: serde_json::Value = serde_json::from_str(&s)
                    .map_err(|e| LuaError::external(e))?;
                lua.to_value(&val)
            }).map_err(|e| PluginError::InitFailed(format!("json_decode: {e}")))?;
            nous.set("json_decode", json_decode).map_err(|e| {
                PluginError::InitFailed(format!("set json_decode: {e}"))
            })?;
        }

        {
            let json_encode = self.lua.create_function(|_, val: LuaValue| {
                let json = lua_value_to_json(&val)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&json)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("json_encode: {e}")))?;
            nous.set("json_encode", json_encode).map_err(|e| {
                PluginError::InitFailed(format!("set json_encode: {e}"))
            })?;
        }

        // -- Logging --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let log_info = self.lua.create_function(move |_, msg: String| {
                api_ref.log_info(&pid, &msg);
                Ok(())
            }).map_err(|e| PluginError::InitFailed(format!("log_info: {e}")))?;
            nous.set("log_info", log_info).map_err(|e| {
                PluginError::InitFailed(format!("set log_info: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let log_warn = self.lua.create_function(move |_, msg: String| {
                api_ref.log_warn(&pid, &msg);
                Ok(())
            }).map_err(|e| PluginError::InitFailed(format!("log_warn: {e}")))?;
            nous.set("log_warn", log_warn).map_err(|e| {
                PluginError::InitFailed(format!("set log_warn: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let log_error = self.lua.create_function(move |_, msg: String| {
                api_ref.log_error(&pid, &msg);
                Ok(())
            }).map_err(|e| PluginError::InitFailed(format!("log_error: {e}")))?;
            nous.set("log_error", log_error).map_err(|e| {
                PluginError::InitFailed(format!("set log_error: {e}"))
            })?;
        }

        // -- Page APIs --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let page_list = self.lua.create_function(move |_, notebook_id: String| {
                let result = api_ref.page_list(c, &pid, &notebook_id)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("page_list: {e}")))?;
            nous.set("page_list", page_list).map_err(|e| {
                PluginError::InitFailed(format!("set page_list: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let page_get = self.lua.create_function(move |_, (notebook_id, page_id): (String, String)| {
                let result = api_ref.page_get(c, &pid, &notebook_id, &page_id)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("page_get: {e}")))?;
            nous.set("page_get", page_get).map_err(|e| {
                PluginError::InitFailed(format!("set page_get: {e}"))
            })?;
        }

        // -- Inbox APIs --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let inbox_capture = self.lua.create_function(move |_, (title, content, tags_json): (String, String, Option<String>)| {
                let tags: Vec<String> = if let Some(ref tj) = tags_json {
                    serde_json::from_str(tj).unwrap_or_default()
                } else {
                    vec![]
                };
                let result = api_ref.inbox_capture(c, &pid, &title, &content, &tags)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("inbox_capture: {e}")))?;
            nous.set("inbox_capture", inbox_capture).map_err(|e| {
                PluginError::InitFailed(format!("set inbox_capture: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let inbox_list = self.lua.create_function(move |_, ()| {
                let result = api_ref.inbox_list(c, &pid)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("inbox_list: {e}")))?;
            nous.set("inbox_list", inbox_list).map_err(|e| {
                PluginError::InitFailed(format!("set inbox_list: {e}"))
            })?;
        }

        // -- Goals APIs --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let goals_list = self.lua.create_function(move |_, ()| {
                let result = api_ref.goals_list(c, &pid)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("goals_list: {e}")))?;
            nous.set("goals_list", goals_list).map_err(|e| {
                PluginError::InitFailed(format!("set goals_list: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let goal_record_progress = self.lua.create_function(
                move |_, (goal_id, date, completed, value): (String, String, bool, Option<u32>)| {
                    let result = api_ref
                        .goal_record_progress(c, &pid, &goal_id, &date, completed, value)
                        .map_err(|e| LuaError::external(e))?;
                    let s = serde_json::to_string(&result)
                        .map_err(|e| LuaError::external(e))?;
                    Ok(s)
                },
            ).map_err(|e| PluginError::InitFailed(format!("goal_record_progress: {e}")))?;
            nous.set("goal_record_progress", goal_record_progress)
                .map_err(|e| PluginError::InitFailed(format!("set goal_record_progress: {e}")))?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let goal_get_stats = self.lua.create_function(move |_, goal_id: String| {
                let result = api_ref.goal_get_stats(c, &pid, &goal_id)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("goal_get_stats: {e}")))?;
            nous.set("goal_get_stats", goal_get_stats).map_err(|e| {
                PluginError::InitFailed(format!("set goal_get_stats: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let goal_get_summary = self.lua.create_function(move |_, ()| {
                let result = api_ref.goal_get_summary(c, &pid)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("goal_get_summary: {e}")))?;
            nous.set("goal_get_summary", goal_get_summary).map_err(|e| {
                PluginError::InitFailed(format!("set goal_get_summary: {e}"))
            })?;
        }

        // -- Database APIs --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let database_list = self.lua.create_function(move |_, notebook_id: String| {
                let result = api_ref.database_list(c, &pid, &notebook_id)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("database_list: {e}")))?;
            nous.set("database_list", database_list).map_err(|e| {
                PluginError::InitFailed(format!("set database_list: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let database_get = self.lua.create_function(move |_, (notebook_id, page_id): (String, String)| {
                let result = api_ref.database_get(c, &pid, &notebook_id, &page_id)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("database_get: {e}")))?;
            nous.set("database_get", database_get).map_err(|e| {
                PluginError::InitFailed(format!("set database_get: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let database_create = self.lua.create_function(move |_, (notebook_id, title, properties_json): (String, String, String)| {
                let result = api_ref.database_create(c, &pid, &notebook_id, &title, &properties_json)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("database_create: {e}")))?;
            nous.set("database_create", database_create).map_err(|e| {
                PluginError::InitFailed(format!("set database_create: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let database_add_rows = self.lua.create_function(move |_, (notebook_id, page_id, rows_json): (String, String, String)| {
                let result = api_ref.database_add_rows(c, &pid, &notebook_id, &page_id, &rows_json)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("database_add_rows: {e}")))?;
            nous.set("database_add_rows", database_add_rows).map_err(|e| {
                PluginError::InitFailed(format!("set database_add_rows: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let database_update_rows = self.lua.create_function(move |_, (notebook_id, page_id, updates_json): (String, String, String)| {
                let result = api_ref.database_update_rows(c, &pid, &notebook_id, &page_id, &updates_json)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("database_update_rows: {e}")))?;
            nous.set("database_update_rows", database_update_rows).map_err(|e| {
                PluginError::InitFailed(format!("set database_update_rows: {e}"))
            })?;
        }

        // -- Search API --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let search = self.lua.create_function(move |_, (query, limit): (String, Option<usize>)| {
                let result = api_ref.search(c, &pid, &query, limit.unwrap_or(20))
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("search: {e}")))?;
            nous.set("search", search).map_err(|e| {
                PluginError::InitFailed(format!("set search: {e}"))
            })?;
        }

        // Set nous as a global
        self.lua.globals().set("nous", nous).map_err(|e| {
            PluginError::InitFailed(format!("set global nous: {e}"))
        })?;

        Ok(())
    }
}

impl Plugin for LuaPlugin {
    fn id(&self) -> &str {
        &self.manifest.id
    }

    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn init(&mut self, api: &Arc<HostApi>) -> Result<(), PluginError> {
        self.register_host_api(api)
    }

    fn call(
        &mut self,
        function: &str,
        input: &serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        let func: LuaFunction = self.lua.globals().get(function).map_err(|e| {
            PluginError::CallFailed(format!(
                "function '{function}' not found in plugin '{}': {e}",
                self.manifest.id
            ))
        })?;

        let input_str = serde_json::to_string(input)?;

        let result_str: String = func.call(input_str).map_err(|e| {
            PluginError::CallFailed(format!(
                "function '{function}' in plugin '{}' failed: {e}",
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

// -- Lua → JSON conversion helper --

/// Convert a mlua LuaValue to serde_json::Value (for json_encode).
fn lua_value_to_json(val: &LuaValue) -> Result<serde_json::Value, String> {
    match val {
        LuaValue::Nil => Ok(serde_json::Value::Null),
        LuaValue::Boolean(b) => Ok(serde_json::Value::Bool(*b)),
        LuaValue::Integer(i) => Ok(serde_json::json!(*i)),
        LuaValue::Number(f) => {
            serde_json::Number::from_f64(*f)
                .map(serde_json::Value::Number)
                .ok_or_else(|| format!("cannot convert {f} to JSON number"))
        }
        LuaValue::String(s) => {
            let s = s.to_str().map_err(|e| format!("non-UTF8 string: {e}"))?;
            Ok(serde_json::Value::String(s.to_string()))
        }
        LuaValue::Table(t) => {
            // Check if it's an array (sequential integer keys starting at 1)
            let len = t.raw_len();
            if len > 0 {
                // Try as array first
                let mut arr = Vec::new();
                let mut is_array = true;
                for i in 1..=len {
                    match t.raw_get::<LuaValue>(i) {
                        Ok(v) => arr.push(lua_value_to_json(&v)?),
                        Err(_) => {
                            is_array = false;
                            break;
                        }
                    }
                }
                if is_array {
                    return Ok(serde_json::Value::Array(arr));
                }
            }

            // Treat as object
            let mut map = serde_json::Map::new();
            for pair in t.clone().pairs::<LuaValue, LuaValue>() {
                let (k, v) = pair.map_err(|e| format!("table iteration: {e}"))?;
                let key = match &k {
                    LuaValue::String(s) => {
                        s.to_str().map_err(|e| format!("non-UTF8 key: {e}"))?.to_string()
                    }
                    LuaValue::Integer(i) => i.to_string(),
                    LuaValue::Number(f) => f.to_string(),
                    _ => continue, // skip non-string keys
                };
                map.insert(key, lua_value_to_json(&v)?);
            }
            Ok(serde_json::Value::Object(map))
        }
        _ => Ok(serde_json::Value::Null), // functions, userdata, etc. → null
    }
}

// Safety: LuaPlugin contains a Lua VM which is Send but not Sync.
// We only access each LuaPlugin behind a Mutex in the registry.
unsafe impl Send for LuaPlugin {}
