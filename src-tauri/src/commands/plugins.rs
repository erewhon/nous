//! Tauri commands for plugin management

use tauri::State;

use crate::AppState;

type CommandResult<T> = Result<T, String>;

/// List all loaded plugins with their manifests and enabled status
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn list_plugins(state: State<AppState>) -> CommandResult<Vec<crate::plugins::PluginInfo>> {
    let Some(ref ph) = state.plugin_host else {
        return Ok(vec![]);
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    Ok(host.list_plugins())
}

/// List all loaded plugins (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn list_plugins(_state: State<AppState>) -> CommandResult<Vec<serde_json::Value>> {
    Ok(vec![])
}

/// Reload a plugin by ID (re-reads from disk)
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn reload_plugin(state: State<AppState>, plugin_id: String) -> CommandResult<()> {
    let Some(ref ph) = state.plugin_host else {
        return Err("Plugin host not available".to_string());
    };
    let mut host = ph.lock().map_err(|e| e.to_string())?;
    host.reload(&plugin_id).map_err(|e| e.to_string())
}

/// Reload a plugin (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn reload_plugin(_state: State<AppState>, _plugin_id: String) -> CommandResult<()> {
    Err("Plugins feature not enabled".to_string())
}

/// Get commands registered by plugins for the Command Palette
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn get_plugin_commands(
    state: State<AppState>,
) -> CommandResult<Vec<crate::plugins::host::PluginCommand>> {
    let Some(ref ph) = state.plugin_host else {
        return Ok(vec![]);
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    Ok(host.get_plugin_commands())
}

/// Get plugin commands (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn get_plugin_commands(_state: State<AppState>) -> CommandResult<Vec<serde_json::Value>> {
    Ok(vec![])
}

/// Execute a command registered by a plugin
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn execute_plugin_command(
    state: State<AppState>,
    plugin_id: String,
    command_id: String,
) -> CommandResult<serde_json::Value> {
    let Some(ref ph) = state.plugin_host else {
        return Err("Plugin host not available".to_string());
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    host.execute_plugin_command(&plugin_id, &command_id)
        .map_err(|e| e.to_string())
}

/// Execute a plugin command (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn execute_plugin_command(
    _state: State<AppState>,
    _plugin_id: String,
    _command_id: String,
) -> CommandResult<serde_json::Value> {
    Err("Plugins feature not enabled".to_string())
}

/// Get database view types registered by plugins
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn get_plugin_view_types(
    state: State<AppState>,
) -> CommandResult<Vec<crate::plugins::host::PluginViewType>> {
    let Some(ref ph) = state.plugin_host else {
        return Ok(vec![]);
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    Ok(host.get_plugin_view_types())
}

/// Get plugin view types (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn get_plugin_view_types(_state: State<AppState>) -> CommandResult<Vec<serde_json::Value>> {
    Ok(vec![])
}

/// Render a plugin database view
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn render_plugin_view(
    state: State<AppState>,
    plugin_id: String,
    view_type: String,
    content: serde_json::Value,
    view: serde_json::Value,
) -> CommandResult<serde_json::Value> {
    let Some(ref ph) = state.plugin_host else {
        return Err("Plugin host not available".to_string());
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    host.render_plugin_view(&plugin_id, &view_type, &content, &view)
        .map_err(|e| e.to_string())
}

/// Render plugin view (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn render_plugin_view(
    _state: State<AppState>,
    _plugin_id: String,
    _view_type: String,
    _content: serde_json::Value,
    _view: serde_json::Value,
) -> CommandResult<serde_json::Value> {
    Err("Plugins feature not enabled".to_string())
}

/// Handle an interactive action from a plugin database view
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn handle_plugin_view_action(
    state: State<AppState>,
    plugin_id: String,
    action: serde_json::Value,
) -> CommandResult<serde_json::Value> {
    let Some(ref ph) = state.plugin_host else {
        return Err("Plugin host not available".to_string());
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    host.handle_plugin_view_action(&plugin_id, &action)
        .map_err(|e| e.to_string())
}

/// Handle plugin view action (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn handle_plugin_view_action(
    _state: State<AppState>,
    _plugin_id: String,
    _action: serde_json::Value,
) -> CommandResult<serde_json::Value> {
    Err("Plugins feature not enabled".to_string())
}

/// Get editor block types registered by plugins
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn get_plugin_block_types(
    state: State<AppState>,
) -> CommandResult<Vec<crate::plugins::host::PluginBlockType>> {
    let Some(ref ph) = state.plugin_host else {
        return Ok(vec![]);
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    Ok(host.get_plugin_block_types())
}

/// Get plugin block types (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn get_plugin_block_types(_state: State<AppState>) -> CommandResult<Vec<serde_json::Value>> {
    Ok(vec![])
}

/// Render a plugin editor block
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn render_plugin_block(
    state: State<AppState>,
    plugin_id: String,
    block_type: String,
    data: serde_json::Value,
) -> CommandResult<serde_json::Value> {
    let Some(ref ph) = state.plugin_host else {
        return Err("Plugin host not available".to_string());
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    host.render_plugin_block(&plugin_id, &block_type, &data)
        .map_err(|e| e.to_string())
}

/// Render plugin block (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn render_plugin_block(
    _state: State<AppState>,
    _plugin_id: String,
    _block_type: String,
    _data: serde_json::Value,
) -> CommandResult<serde_json::Value> {
    Err("Plugins feature not enabled".to_string())
}

/// Handle an interactive action from a plugin editor block
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn handle_plugin_block_action(
    state: State<AppState>,
    plugin_id: String,
    action: serde_json::Value,
) -> CommandResult<serde_json::Value> {
    let Some(ref ph) = state.plugin_host else {
        return Err("Plugin host not available".to_string());
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    host.handle_plugin_block_action(&plugin_id, &action)
        .map_err(|e| e.to_string())
}

/// Handle plugin block action (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn handle_plugin_block_action(
    _state: State<AppState>,
    _plugin_id: String,
    _action: serde_json::Value,
) -> CommandResult<serde_json::Value> {
    Err("Plugins feature not enabled".to_string())
}

/// Enable or disable a plugin by ID
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn set_plugin_enabled(
    state: State<AppState>,
    plugin_id: String,
    enabled: bool,
) -> CommandResult<()> {
    let Some(ref ph) = state.plugin_host else {
        return Err("Plugin host not available".to_string());
    };
    let mut host = ph.lock().map_err(|e| e.to_string())?;
    host.set_plugin_enabled(&plugin_id, enabled);
    Ok(())
}

/// Enable/disable a plugin (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn set_plugin_enabled(
    _state: State<AppState>,
    _plugin_id: String,
    _enabled: bool,
) -> CommandResult<()> {
    Err("Plugins feature not enabled".to_string())
}
