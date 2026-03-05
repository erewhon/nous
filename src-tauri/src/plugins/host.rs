//! PluginHost — central coordinator for the plugin system.
//!
//! Owns the HostApi and PluginRegistry. Provides high-level methods for
//! loading plugins, calling hooks, and managing the lifecycle.

use std::collections::HashSet;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::json;

use super::api::HostApi;
use super::error::PluginError;
use super::loader;
use super::manifest::{HookPoint, PluginManifest};
use super::registry::PluginRegistry;
use super::runtime::Plugin;

/// A command registered by a plugin for the Command Palette.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommand {
    pub plugin_id: String,
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub keywords: Option<Vec<String>>,
}

/// A database view type registered by a plugin.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginViewType {
    pub plugin_id: String,
    pub view_type: String,
    pub label: String,
    pub icon_svg: Option<String>,
}

/// Plugin manifest with runtime enabled/disabled status.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    #[serde(flatten)]
    pub manifest: PluginManifest,
    pub enabled: bool,
}

/// The central plugin host that coordinates loading, registration, and hook dispatch.
pub struct PluginHost {
    api: Arc<HostApi>,
    registry: PluginRegistry,
    plugins_dir: PathBuf,
    disabled: HashSet<String>,
}

impl PluginHost {
    pub fn new(api: Arc<HostApi>, plugins_dir: PathBuf) -> Self {
        let disabled = Self::load_disabled(&plugins_dir);
        Self {
            api,
            registry: PluginRegistry::new(),
            plugins_dir,
            disabled,
        }
    }

    fn load_disabled(plugins_dir: &PathBuf) -> HashSet<String> {
        let path = plugins_dir.join("disabled.json");
        match std::fs::read_to_string(&path) {
            Ok(content) => {
                serde_json::from_str::<Vec<String>>(&content)
                    .unwrap_or_default()
                    .into_iter()
                    .collect()
            }
            Err(_) => HashSet::new(),
        }
    }

    fn save_disabled(&self) {
        let path = self.plugins_dir.join("disabled.json");
        let list: Vec<&String> = self.disabled.iter().collect();
        if let Ok(json) = serde_json::to_string_pretty(&list) {
            if let Err(e) = std::fs::write(&path, json) {
                log::warn!("Failed to save disabled.json: {e}");
            }
        }
    }

    pub fn set_plugin_enabled(&mut self, plugin_id: &str, enabled: bool) {
        if enabled {
            self.disabled.remove(plugin_id);
        } else {
            self.disabled.insert(plugin_id.to_string());
        }
        self.save_disabled();
    }

    pub fn is_plugin_enabled(&self, plugin_id: &str) -> bool {
        !self.disabled.contains(plugin_id)
    }

    /// Load all plugins from the plugins directory and built-ins.
    pub fn load_all(&mut self) -> Result<(), PluginError> {
        // Ensure the plugins directory exists
        if !self.plugins_dir.exists() {
            std::fs::create_dir_all(&self.plugins_dir)?;
            log::info!("Created plugins directory: {}", self.plugins_dir.display());
        }

        // Load built-in plugins (Phase 4)
        for result in loader::load_builtins(&self.api) {
            match result {
                Ok(plugin) => self.registry.register(plugin),
                Err(e) => log::warn!("Failed to load built-in plugin: {e}"),
            }
        }

        // Scan plugins directory for user plugins
        for result in loader::scan_plugins_dir(&self.plugins_dir, &self.api) {
            match result {
                Ok(plugin) => self.registry.register(plugin),
                Err(e) => log::warn!("Failed to load plugin: {e}"),
            }
        }

        log::info!(
            "Plugin system loaded: {} plugins",
            self.registry.len()
        );
        Ok(())
    }

    /// Reload a specific plugin by ID (re-reads from disk).
    pub fn reload(&mut self, plugin_id: &str) -> Result<(), PluginError> {
        // Get the current source path
        let source = {
            let plugin_mutex = self.registry.get(plugin_id).ok_or_else(|| {
                PluginError::NotFound(plugin_id.to_string())
            })?;
            let plugin = plugin_mutex.lock().map_err(|e| {
                PluginError::Runtime(format!("lock: {e}"))
            })?;
            plugin.manifest().source.clone()
        };

        // Unregister old plugin
        self.registry.unregister(plugin_id);

        // Re-load from source
        match source {
            super::manifest::PluginSource::LuaFile { ref path } => {
                let source_code = std::fs::read_to_string(path)?;
                let raw = super::manifest::parse_lua_manifest_header(&source_code)?;
                let manifest = raw.into_manifest(source)?;
                let mut plugin = super::runtime::lua::LuaPlugin::new(manifest, source_code)?;
                plugin.init(&self.api)?;
                self.registry.register(Box::new(plugin));
            }
            super::manifest::PluginSource::Builtin => {
                return Err(PluginError::Runtime(
                    "Cannot reload built-in plugins".to_string(),
                ));
            }
            super::manifest::PluginSource::WasmFile { ref wasm_path, ref toml_path } => {
                let wasm_path = wasm_path.clone();
                let toml_path = toml_path.clone();
                let toml_content = std::fs::read_to_string(&toml_path)?;
                let raw: super::manifest::RawManifest = toml::from_str(&toml_content)
                    .map_err(|e| PluginError::ManifestParse(format!("TOML parse error: {e}")))?;
                let manifest = raw.into_manifest(source)?;
                let wasm_bytes = std::fs::read(&wasm_path)?;
                let mut plugin = super::runtime::wasm::WasmPlugin::new(manifest, wasm_bytes);
                plugin.init(&self.api)?;
                self.registry.register(Box::new(plugin));
            }
        }

        log::info!("Reloaded plugin: {plugin_id}");
        Ok(())
    }

    /// List all loaded plugins with their enabled/disabled status.
    pub fn list_plugins(&self) -> Vec<PluginInfo> {
        self.registry
            .list_manifests()
            .into_iter()
            .map(|manifest| {
                let enabled = self.is_plugin_enabled(&manifest.id);
                PluginInfo { manifest, enabled }
            })
            .collect()
    }

    /// Run all goal detector plugins for a given goal/check/date.
    /// Returns (completed, value) from the first matching plugin.
    pub fn run_goal_detector(
        &self,
        plugin_id: &str,
        goal: &serde_json::Value,
        check: &serde_json::Value,
        date: &str,
    ) -> Result<(bool, u32), PluginError> {
        if !self.is_plugin_enabled(plugin_id) {
            return Err(PluginError::Runtime(format!(
                "plugin '{plugin_id}' is disabled"
            )));
        }
        let plugin_mutex = self.registry.get(plugin_id).ok_or_else(|| {
            PluginError::NotFound(plugin_id.to_string())
        })?;

        let input = json!({
            "goal": goal,
            "check": check,
            "date": date,
        });

        let mut plugin = plugin_mutex.lock().map_err(|e| {
            PluginError::Runtime(format!("lock: {e}"))
        })?;

        let result = plugin.call("detect_goal", &input)?;

        let completed = result
            .get("completed")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let value = result
            .get("value")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        Ok((completed, value))
    }

    /// Run a plugin function for an action step.
    /// Returns the result JSON.
    pub fn run_action_step(
        &self,
        plugin_id: &str,
        function: &str,
        input: &serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        if !self.is_plugin_enabled(plugin_id) {
            return Err(PluginError::Runtime(format!(
                "plugin '{plugin_id}' is disabled"
            )));
        }
        let plugin_mutex = self.registry.get(plugin_id).ok_or_else(|| {
            PluginError::NotFound(plugin_id.to_string())
        })?;

        let mut plugin = plugin_mutex.lock().map_err(|e| {
            PluginError::Runtime(format!("lock: {e}"))
        })?;

        plugin.call(function, input)
    }

    /// Get built-in action definitions from Lua plugins.
    ///
    /// Iterates all plugins where `is_builtin == true` and calls `describe_action()`.
    /// Returns successfully parsed actions; logs and skips failures.
    pub fn get_builtin_actions(&self) -> Vec<crate::actions::models::Action> {
        let mut actions = Vec::new();

        for manifest in self.registry.list_manifests() {
            if !manifest.is_builtin || !self.is_plugin_enabled(&manifest.id) {
                continue;
            }

            let plugin_mutex = match self.registry.get(&manifest.id) {
                Some(m) => m,
                None => continue,
            };

            let mut plugin = match plugin_mutex.lock() {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("Failed to lock builtin plugin '{}': {e}", manifest.id);
                    continue;
                }
            };

            // Try calling describe_action — not all builtins may have it
            let input = serde_json::Value::Null;
            match plugin.call("describe_action", &input) {
                Ok(val) => {
                    match serde_json::from_value::<crate::actions::models::Action>(val) {
                        Ok(mut action) => {
                            // Ensure timestamps are current
                            action.created_at = chrono::Utc::now();
                            action.updated_at = chrono::Utc::now();
                            actions.push(action);
                        }
                        Err(e) => {
                            log::warn!(
                                "Failed to parse action from builtin plugin '{}': {e}",
                                manifest.id
                            );
                        }
                    }
                }
                Err(e) => {
                    // Not all builtins are action-description plugins, that's OK
                    log::debug!(
                        "Builtin plugin '{}' has no describe_action: {e}",
                        manifest.id
                    );
                }
            }
        }

        actions
    }

    /// Get commands from all plugins that have the CommandPalette hook.
    pub fn get_plugin_commands(&self) -> Vec<PluginCommand> {
        let mut commands = Vec::new();

        let plugin_ids = self.registry.plugins_for_hook(&HookPoint::CommandPalette);
        for plugin_id in plugin_ids {
            if !self.is_plugin_enabled(&plugin_id) {
                continue;
            }

            let plugin_mutex = match self.registry.get(&plugin_id) {
                Some(m) => m,
                None => continue,
            };

            let mut plugin = match plugin_mutex.lock() {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("Failed to lock plugin '{}' for get_commands: {e}", plugin_id);
                    continue;
                }
            };

            let input = serde_json::Value::Null;
            match plugin.call("get_commands", &input) {
                Ok(val) => {
                    // Expect an array of command objects
                    if let Some(arr) = val.as_array() {
                        for cmd_val in arr {
                            let id = cmd_val.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let title = cmd_val.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let subtitle = cmd_val.get("subtitle").and_then(|v| v.as_str()).map(|s| s.to_string());
                            let keywords = cmd_val.get("keywords").and_then(|v| v.as_array()).map(|arr| {
                                arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()
                            });

                            if !id.is_empty() && !title.is_empty() {
                                commands.push(PluginCommand {
                                    plugin_id: plugin_id.clone(),
                                    id,
                                    title,
                                    subtitle,
                                    keywords,
                                });
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!("Plugin '{}' get_commands failed: {e}", plugin_id);
                }
            }
        }

        commands
    }

    /// Execute a specific command from a plugin.
    pub fn execute_plugin_command(
        &self,
        plugin_id: &str,
        command_id: &str,
    ) -> Result<serde_json::Value, PluginError> {
        let plugin_mutex = self.registry.get(plugin_id).ok_or_else(|| {
            PluginError::NotFound(plugin_id.to_string())
        })?;

        let input = json!({
            "command_id": command_id,
        });

        let mut plugin = plugin_mutex.lock().map_err(|e| {
            PluginError::Runtime(format!("lock: {e}"))
        })?;

        plugin.call("execute_command", &input)
    }

    /// Dispatch an event to all plugins that registered for the given hook.
    /// Calls the corresponding Lua function with the provided data JSON.
    /// Errors are logged but never propagated — events are best-effort.
    pub fn dispatch_event(&self, hook: &HookPoint, data: &serde_json::Value) {
        let func_name = match hook {
            HookPoint::OnPageCreated => "on_page_created",
            HookPoint::OnPageUpdated => "on_page_updated",
            HookPoint::OnPageDeleted => "on_page_deleted",
            HookPoint::OnInboxCaptured => "on_inbox_captured",
            HookPoint::OnGoalProgress => "on_goal_progress",
            _ => return, // Not an event hook
        };

        let plugin_ids = self.registry.plugins_for_hook(hook);
        for plugin_id in plugin_ids {
            if !self.is_plugin_enabled(&plugin_id) {
                continue;
            }
            let plugin_mutex = match self.registry.get(&plugin_id) {
                Some(m) => m,
                None => continue,
            };
            let mut plugin = match plugin_mutex.lock() {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("Failed to lock plugin '{}' for event dispatch: {e}", plugin_id);
                    continue;
                }
            };
            if let Err(e) = plugin.call(func_name, data) {
                log::warn!(
                    "Plugin '{}' event handler '{}' failed: {e}",
                    plugin_id,
                    func_name
                );
            }
        }
    }

    /// Get database view types registered by plugins.
    pub fn get_plugin_view_types(&self) -> Vec<PluginViewType> {
        let mut view_types = Vec::new();

        for manifest in self.registry.list_manifests() {
            if !self.is_plugin_enabled(&manifest.id) {
                continue;
            }
            for hook in &manifest.hooks {
                if let HookPoint::DatabaseView { view_type } = hook {
                    let plugin_mutex = match self.registry.get(&manifest.id) {
                        Some(m) => m,
                        None => continue,
                    };

                    let mut plugin = match plugin_mutex.lock() {
                        Ok(p) => p,
                        Err(e) => {
                            log::warn!("Failed to lock plugin '{}' for describe_view: {e}", manifest.id);
                            continue;
                        }
                    };

                    match plugin.call("describe_view", &serde_json::Value::Null) {
                        Ok(val) => {
                            let label = val.get("label").and_then(|v| v.as_str()).unwrap_or(view_type.as_str()).to_string();
                            let icon_svg = val.get("icon_svg").and_then(|v| v.as_str()).map(|s| s.to_string());
                            view_types.push(PluginViewType {
                                plugin_id: manifest.id.clone(),
                                view_type: view_type.clone(),
                                label,
                                icon_svg,
                            });
                        }
                        Err(e) => {
                            log::warn!("Plugin '{}' describe_view failed: {e}", manifest.id);
                            view_types.push(PluginViewType {
                                plugin_id: manifest.id.clone(),
                                view_type: view_type.clone(),
                                label: view_type.clone(),
                                icon_svg: None,
                            });
                        }
                    }
                }
            }
        }

        view_types
    }

    /// Render a plugin database view. Returns JSON with html, styles, height.
    pub fn render_plugin_view(
        &self,
        plugin_id: &str,
        view_type: &str,
        content: &serde_json::Value,
        view: &serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        if !self.is_plugin_enabled(plugin_id) {
            return Err(PluginError::Runtime(format!(
                "plugin '{plugin_id}' is disabled"
            )));
        }
        let plugin_mutex = self.registry.get(plugin_id).ok_or_else(|| {
            PluginError::NotFound(plugin_id.to_string())
        })?;

        let input = json!({
            "view_type": view_type,
            "content": content,
            "view": view,
        });

        let mut plugin = plugin_mutex.lock().map_err(|e| {
            PluginError::Runtime(format!("lock: {e}"))
        })?;

        plugin.call("render_view", &input)
    }

    /// Handle an interactive action from a plugin database view.
    pub fn handle_plugin_view_action(
        &self,
        plugin_id: &str,
        action: &serde_json::Value,
    ) -> Result<serde_json::Value, PluginError> {
        if !self.is_plugin_enabled(plugin_id) {
            return Err(PluginError::Runtime(format!(
                "plugin '{plugin_id}' is disabled"
            )));
        }
        let plugin_mutex = self.registry.get(plugin_id).ok_or_else(|| {
            PluginError::NotFound(plugin_id.to_string())
        })?;

        let mut plugin = plugin_mutex.lock().map_err(|e| {
            PluginError::Runtime(format!("lock: {e}"))
        })?;

        plugin.call("handle_action", action)
    }

    /// Get plugins directory path
    pub fn plugins_dir(&self) -> &PathBuf {
        &self.plugins_dir
    }

    /// Get mutable access to the registry (for testing).
    #[cfg(test)]
    pub(crate) fn registry_mut(&mut self) -> &mut PluginRegistry {
        &mut self.registry
    }
}

/// Dispatch a plugin event in a background thread.
/// Takes the same `Option<Arc<Mutex<PluginHost>>>` type as `AppState.plugin_host`.
/// Fire-and-forget: errors are logged, never propagated.
pub fn dispatch_plugin_event_bg(
    plugin_host: &Option<Arc<Mutex<PluginHost>>>,
    hook: HookPoint,
    data: serde_json::Value,
) {
    if let Some(ref ph) = plugin_host {
        let ph = Arc::clone(ph);
        std::thread::spawn(move || {
            if let Ok(host) = ph.lock() {
                host.dispatch_event(&hook, &data);
            }
        });
    }
}
