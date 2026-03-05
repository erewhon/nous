//! Lua plugin runtime — one sandboxed mlua VM per plugin

use std::sync::Arc;

use chrono::Datelike;
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

        // -- Date helpers (sandbox has no os library) --
        {
            let current_date = self.lua.create_function(|lua, ()| {
                let now = chrono::Local::now().date_naive();
                let tbl = lua.create_table()?;
                tbl.set("year", now.year())?;
                tbl.set("month", now.month())?;
                tbl.set("day", now.day())?;
                tbl.set("wday", now.weekday().num_days_from_sunday() + 1)?; // 1=Sun like Lua
                // ISO date string for convenience
                tbl.set("iso", now.format("%Y-%m-%d").to_string())?;
                Ok(tbl)
            }).map_err(|e| PluginError::InitFailed(format!("current_date: {e}")))?;
            nous.set("current_date", current_date).map_err(|e| {
                PluginError::InitFailed(format!("set current_date: {e}"))
            })?;
        }

        {
            // date_offset(iso_date_string, days) -> {year, month, day, wday, iso}
            let date_offset = self.lua.create_function(|lua, (date_str, days): (String, i64)| {
                let base = chrono::NaiveDate::parse_from_str(&date_str, "%Y-%m-%d")
                    .map_err(|e| LuaError::external(format!("invalid date '{}': {}", date_str, e)))?;
                let result = base + chrono::Duration::days(days);
                let tbl = lua.create_table()?;
                tbl.set("year", result.year())?;
                tbl.set("month", result.month())?;
                tbl.set("day", result.day())?;
                tbl.set("wday", result.weekday().num_days_from_sunday() + 1)?;
                tbl.set("iso", result.format("%Y-%m-%d").to_string())?;
                Ok(tbl)
            }).map_err(|e| PluginError::InitFailed(format!("date_offset: {e}")))?;
            nous.set("date_offset", date_offset).map_err(|e| {
                PluginError::InitFailed(format!("set date_offset: {e}"))
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

        // -- Page WRITE APIs --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let page_create = self.lua.create_function(move |_, (notebook_id, title): (String, String)| {
                let result = api_ref.page_create(c, &pid, &notebook_id, &title)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("page_create: {e}")))?;
            nous.set("page_create", page_create).map_err(|e| {
                PluginError::InitFailed(format!("set page_create: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let page_update = self.lua.create_function(
                move |_, (notebook_id, page_id, title, content, tags_json): (String, String, Option<String>, Option<String>, Option<String>)| {
                    let result = api_ref
                        .page_update(c, &pid, &notebook_id, &page_id, title.as_deref(), content.as_deref(), tags_json.as_deref())
                        .map_err(|e| LuaError::external(e))?;
                    let s = serde_json::to_string(&result).map_err(|e| LuaError::external(e))?;
                    Ok(s)
                },
            ).map_err(|e| PluginError::InitFailed(format!("page_update: {e}")))?;
            nous.set("page_update", page_update).map_err(|e| {
                PluginError::InitFailed(format!("set page_update: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let page_append = self.lua.create_function(move |_, (notebook_id, page_id, content): (String, String, String)| {
                let result = api_ref.page_append(c, &pid, &notebook_id, &page_id, &content)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("page_append: {e}")))?;
            nous.set("page_append", page_append).map_err(|e| {
                PluginError::InitFailed(format!("set page_append: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let page_delete = self.lua.create_function(move |_, (notebook_id, page_id): (String, String)| {
                let result = api_ref.page_delete(c, &pid, &notebook_id, &page_id)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("page_delete: {e}")))?;
            nous.set("page_delete", page_delete).map_err(|e| {
                PluginError::InitFailed(format!("set page_delete: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let page_move = self.lua.create_function(
                move |_, (notebook_id, page_id, folder_id, section_id): (String, String, Option<String>, Option<String>)| {
                    let result = api_ref
                        .page_move(c, &pid, &notebook_id, &page_id, folder_id.as_deref(), section_id.as_deref())
                        .map_err(|e| LuaError::external(e))?;
                    let s = serde_json::to_string(&result).map_err(|e| LuaError::external(e))?;
                    Ok(s)
                },
            ).map_err(|e| PluginError::InitFailed(format!("page_move: {e}")))?;
            nous.set("page_move", page_move).map_err(|e| {
                PluginError::InitFailed(format!("set page_move: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let page_manage_tags = self.lua.create_function(
                move |_, (notebook_id, page_id, add_json, remove_json): (String, String, Option<String>, Option<String>)| {
                    let result = api_ref
                        .page_manage_tags(c, &pid, &notebook_id, &page_id, add_json.as_deref(), remove_json.as_deref())
                        .map_err(|e| LuaError::external(e))?;
                    let s = serde_json::to_string(&result).map_err(|e| LuaError::external(e))?;
                    Ok(s)
                },
            ).map_err(|e| PluginError::InitFailed(format!("page_manage_tags: {e}")))?;
            nous.set("page_manage_tags", page_manage_tags).map_err(|e| {
                PluginError::InitFailed(format!("set page_manage_tags: {e}"))
            })?;
        }

        // -- Notebook/Folder APIs --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let list_notebooks = self.lua.create_function(move |_, ()| {
                let result = api_ref.list_notebooks(c, &pid)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("list_notebooks: {e}")))?;
            nous.set("list_notebooks", list_notebooks).map_err(|e| {
                PluginError::InitFailed(format!("set list_notebooks: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let list_sections = self.lua.create_function(move |_, notebook_id: String| {
                let result = api_ref.list_sections(c, &pid, &notebook_id)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("list_sections: {e}")))?;
            nous.set("list_sections", list_sections).map_err(|e| {
                PluginError::InitFailed(format!("set list_sections: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let list_folders = self.lua.create_function(move |_, notebook_id: String| {
                let result = api_ref.list_folders(c, &pid, &notebook_id)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("list_folders: {e}")))?;
            nous.set("list_folders", list_folders).map_err(|e| {
                PluginError::InitFailed(format!("set list_folders: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let create_folder = self.lua.create_function(
                move |_, (notebook_id, name, parent_id): (String, String, Option<String>)| {
                    let result = api_ref.create_folder(c, &pid, &notebook_id, &name, parent_id.as_deref())
                        .map_err(|e| LuaError::external(e))?;
                    let s = serde_json::to_string(&result).map_err(|e| LuaError::external(e))?;
                    Ok(s)
                },
            ).map_err(|e| PluginError::InitFailed(format!("create_folder: {e}")))?;
            nous.set("create_folder", create_folder).map_err(|e| {
                PluginError::InitFailed(format!("set create_folder: {e}"))
            })?;
        }

        // -- Daily Notes APIs --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let daily_note_list = self.lua.create_function(move |_, (notebook_id, limit): (String, Option<usize>)| {
                let result = api_ref.daily_note_list(c, &pid, &notebook_id, limit)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("daily_note_list: {e}")))?;
            nous.set("daily_note_list", daily_note_list).map_err(|e| {
                PluginError::InitFailed(format!("set daily_note_list: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let daily_note_get = self.lua.create_function(move |_, (notebook_id, date): (String, String)| {
                let result = api_ref.daily_note_get(c, &pid, &notebook_id, &date)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("daily_note_get: {e}")))?;
            nous.set("daily_note_get", daily_note_get).map_err(|e| {
                PluginError::InitFailed(format!("set daily_note_get: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let daily_note_create = self.lua.create_function(
                move |_, (notebook_id, date, content): (String, String, Option<String>)| {
                    let result = api_ref.daily_note_create(c, &pid, &notebook_id, &date, content.as_deref())
                        .map_err(|e| LuaError::external(e))?;
                    let s = serde_json::to_string(&result).map_err(|e| LuaError::external(e))?;
                    Ok(s)
                },
            ).map_err(|e| PluginError::InitFailed(format!("daily_note_create: {e}")))?;
            nous.set("daily_note_create", daily_note_create).map_err(|e| {
                PluginError::InitFailed(format!("set daily_note_create: {e}"))
            })?;
        }

        // -- Additional Inbox API --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let inbox_delete = self.lua.create_function(move |_, item_id: String| {
                let result = api_ref.inbox_delete(c, &pid, &item_id)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("inbox_delete: {e}")))?;
            nous.set("inbox_delete", inbox_delete).map_err(|e| {
                PluginError::InitFailed(format!("set inbox_delete: {e}"))
            })?;
        }

        // -- Additional Goals API --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let goal_get_progress = self.lua.create_function(move |_, (goal_id, limit): (String, Option<usize>)| {
                let result = api_ref.goal_get_progress(c, &pid, &goal_id, limit)
                    .map_err(|e| LuaError::external(e))?;
                let s = serde_json::to_string(&result)
                    .map_err(|e| LuaError::external(e))?;
                Ok(s)
            }).map_err(|e| PluginError::InitFailed(format!("goal_get_progress: {e}")))?;
            nous.set("goal_get_progress", goal_get_progress).map_err(|e| {
                PluginError::InitFailed(format!("set goal_get_progress: {e}"))
            })?;
        }

        // -- Energy APIs --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let energy_get_checkins = self.lua.create_function(
                move |_, (start, end, limit): (Option<String>, Option<String>, Option<usize>)| {
                    let result = api_ref
                        .energy_get_checkins(c, &pid, start.as_deref(), end.as_deref(), limit)
                        .map_err(|e| LuaError::external(e))?;
                    let s = serde_json::to_string(&result).map_err(|e| LuaError::external(e))?;
                    Ok(s)
                },
            ).map_err(|e| PluginError::InitFailed(format!("energy_get_checkins: {e}")))?;
            nous.set("energy_get_checkins", energy_get_checkins).map_err(|e| {
                PluginError::InitFailed(format!("set energy_get_checkins: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let energy_get_patterns = self.lua.create_function(
                move |_, (start, end): (Option<String>, Option<String>)| {
                    let result = api_ref
                        .energy_get_patterns(c, &pid, start.as_deref(), end.as_deref())
                        .map_err(|e| LuaError::external(e))?;
                    let s = serde_json::to_string(&result).map_err(|e| LuaError::external(e))?;
                    Ok(s)
                },
            ).map_err(|e| PluginError::InitFailed(format!("energy_get_patterns: {e}")))?;
            nous.set("energy_get_patterns", energy_get_patterns).map_err(|e| {
                PluginError::InitFailed(format!("set energy_get_patterns: {e}"))
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

        // -- Network API --
        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let http_request = self.lua.create_function(
                move |_, (method, url, body, headers_json, timeout): (String, String, Option<String>, Option<String>, Option<u64>)| {
                    let headers: Option<std::collections::HashMap<String, String>> =
                        headers_json.as_deref().and_then(|h| serde_json::from_str(h).ok());
                    let result = api_ref
                        .http_request(c, &pid, &method, &url, body.as_deref(), headers.as_ref(), timeout)
                        .map_err(|e| LuaError::external(e))?;
                    let s = serde_json::to_string(&result).map_err(|e| LuaError::external(e))?;
                    Ok(s)
                },
            ).map_err(|e| PluginError::InitFailed(format!("http_request: {e}")))?;
            nous.set("http_request", http_request).map_err(|e| {
                PluginError::InitFailed(format!("set http_request: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let http_get = self.lua.create_function(
                move |_, (url, headers_json): (String, Option<String>)| {
                    let headers: Option<std::collections::HashMap<String, String>> =
                        headers_json.as_deref().and_then(|h| serde_json::from_str(h).ok());
                    let result = api_ref
                        .http_request(c, &pid, "GET", &url, None, headers.as_ref(), None)
                        .map_err(|e| LuaError::external(e))?;
                    let s = serde_json::to_string(&result).map_err(|e| LuaError::external(e))?;
                    Ok(s)
                },
            ).map_err(|e| PluginError::InitFailed(format!("http_get: {e}")))?;
            nous.set("http_get", http_get).map_err(|e| {
                PluginError::InitFailed(format!("set http_get: {e}"))
            })?;
        }

        {
            let api_ref = Arc::clone(api);
            let pid = plugin_id.clone();
            let c = caps;
            let http_post = self.lua.create_function(
                move |_, (url, body, headers_json): (String, String, Option<String>)| {
                    let headers: Option<std::collections::HashMap<String, String>> =
                        headers_json.as_deref().and_then(|h| serde_json::from_str(h).ok());
                    let result = api_ref
                        .http_request(c, &pid, "POST", &url, Some(&body), headers.as_ref(), None)
                        .map_err(|e| LuaError::external(e))?;
                    let s = serde_json::to_string(&result).map_err(|e| LuaError::external(e))?;
                    Ok(s)
                },
            ).map_err(|e| PluginError::InitFailed(format!("http_post: {e}")))?;
            nous.set("http_post", http_post).map_err(|e| {
                PluginError::InitFailed(format!("set http_post: {e}"))
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
