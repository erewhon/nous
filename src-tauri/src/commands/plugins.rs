//! Tauri commands for plugin management

use tauri::State;

use crate::AppState;
use crate::python_bridge::AIConfig;

type CommandResult<T> = Result<T, String>;

/// Push the user's AI provider settings to the plugin host so plugins can use `nous.ai_complete()`.
#[cfg(feature = "plugins")]
#[tauri::command(rename_all = "camelCase")]
pub fn set_plugin_ai_config(
    state: State<AppState>,
    provider_type: String,
    api_key: Option<String>,
    base_url: Option<String>,
    model: Option<String>,
) -> CommandResult<()> {
    let Some(ref ph) = state.plugin_host else {
        return Ok(());
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    host.set_ai_config(AIConfig {
        provider_type,
        api_key,
        base_url,
        model,
        temperature: None,
        max_tokens: None,
    });
    Ok(())
}

/// Set plugin AI config (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command(rename_all = "camelCase")]
pub fn set_plugin_ai_config(
    _state: State<AppState>,
    _provider_type: String,
    _api_key: Option<String>,
    _base_url: Option<String>,
    _model: Option<String>,
) -> CommandResult<()> {
    Ok(())
}

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
/// Async + spawn_blocking because plugin commands may make HTTP requests.
#[cfg(feature = "plugins")]
#[tauri::command]
pub async fn execute_plugin_command(
    state: State<'_, AppState>,
    plugin_id: String,
    command_id: String,
    context: Option<serde_json::Value>,
) -> CommandResult<serde_json::Value> {
    let ph = state.plugin_host.clone();
    tokio::task::spawn_blocking(move || {
        let Some(ref ph) = ph else {
            return Err("Plugin host not available".to_string());
        };
        let host = ph.lock().map_err(|e| e.to_string())?;
        host.execute_plugin_command(&plugin_id, &command_id, context.as_ref())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Execute a plugin command (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn execute_plugin_command(
    _state: State<AppState>,
    _plugin_id: String,
    _command_id: String,
    _context: Option<serde_json::Value>,
) -> CommandResult<serde_json::Value> {
    Err("Plugins feature not enabled".to_string())
}

/// Get export formats registered by plugins
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn get_plugin_export_formats(
    state: State<AppState>,
) -> CommandResult<Vec<crate::plugins::host::PluginExportFormat>> {
    let Some(ref ph) = state.plugin_host else {
        return Ok(vec![]);
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    Ok(host.get_plugin_export_formats())
}

/// Get plugin export formats (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn get_plugin_export_formats(_state: State<AppState>) -> CommandResult<Vec<serde_json::Value>> {
    Ok(vec![])
}

/// Execute a plugin export
#[cfg(feature = "plugins")]
#[tauri::command(rename_all = "camelCase")]
pub fn execute_plugin_export(
    state: State<AppState>,
    plugin_id: String,
    format_id: String,
    page: serde_json::Value,
    notebook_id: String,
    options: serde_json::Value,
) -> CommandResult<serde_json::Value> {
    let Some(ref ph) = state.plugin_host else {
        return Err("Plugin host not available".to_string());
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    host.execute_plugin_export(&plugin_id, &format_id, &page, &notebook_id, &options)
        .map_err(|e| e.to_string())
}

/// Execute plugin export (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command(rename_all = "camelCase")]
pub fn execute_plugin_export(
    _state: State<AppState>,
    _plugin_id: String,
    _format_id: String,
    _page: serde_json::Value,
    _notebook_id: String,
    _options: serde_json::Value,
) -> CommandResult<serde_json::Value> {
    Err("Plugins feature not enabled".to_string())
}

/// Render export options form
#[cfg(feature = "plugins")]
#[tauri::command(rename_all = "camelCase")]
pub fn render_export_options(
    state: State<AppState>,
    plugin_id: String,
    format_id: String,
) -> CommandResult<serde_json::Value> {
    let Some(ref ph) = state.plugin_host else {
        return Err("Plugin host not available".to_string());
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    host.render_export_options(&plugin_id, &format_id)
        .map_err(|e| e.to_string())
}

/// Render export options (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command(rename_all = "camelCase")]
pub fn render_export_options(
    _state: State<AppState>,
    _plugin_id: String,
    _format_id: String,
) -> CommandResult<serde_json::Value> {
    Err("Plugins feature not enabled".to_string())
}

/// Get import formats registered by plugins
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn get_plugin_import_formats(
    state: State<AppState>,
) -> CommandResult<Vec<crate::plugins::host::PluginImportFormat>> {
    let Some(ref ph) = state.plugin_host else {
        return Ok(vec![]);
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    Ok(host.get_plugin_import_formats())
}

/// Get plugin import formats (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn get_plugin_import_formats(_state: State<AppState>) -> CommandResult<Vec<serde_json::Value>> {
    Ok(vec![])
}

/// Execute a plugin import
#[cfg(feature = "plugins")]
#[tauri::command(rename_all = "camelCase")]
pub fn execute_plugin_import(
    state: State<AppState>,
    plugin_id: String,
    format_id: String,
    file_content: String,
    file_name: String,
    notebook_id: String,
) -> CommandResult<serde_json::Value> {
    let Some(ref ph) = state.plugin_host else {
        return Err("Plugin host not available".to_string());
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    host.execute_plugin_import(&plugin_id, &format_id, &file_content, &file_name, &notebook_id)
        .map_err(|e| e.to_string())
}

/// Execute plugin import (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command(rename_all = "camelCase")]
pub fn execute_plugin_import(
    _state: State<AppState>,
    _plugin_id: String,
    _format_id: String,
    _file_content: String,
    _file_name: String,
    _notebook_id: String,
) -> CommandResult<serde_json::Value> {
    Err("Plugins feature not enabled".to_string())
}

/// Get editor decoration types registered by plugins
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn get_plugin_decoration_types(
    state: State<AppState>,
) -> CommandResult<Vec<crate::plugins::host::PluginDecorationType>> {
    let Some(ref ph) = state.plugin_host else {
        return Ok(vec![]);
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    Ok(host.get_plugin_decoration_types())
}

/// Get plugin decoration types (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command]
pub fn get_plugin_decoration_types(_state: State<AppState>) -> CommandResult<Vec<serde_json::Value>> {
    Ok(vec![])
}

/// Compute decorations for a page's blocks
#[cfg(feature = "plugins")]
#[tauri::command(rename_all = "camelCase")]
pub fn compute_plugin_decorations(
    state: State<AppState>,
    plugin_id: String,
    decoration_id: String,
    blocks: serde_json::Value,
) -> CommandResult<serde_json::Value> {
    let Some(ref ph) = state.plugin_host else {
        return Err("Plugin host not available".to_string());
    };
    let host = ph.lock().map_err(|e| e.to_string())?;
    host.compute_decorations(&plugin_id, &decoration_id, &blocks)
        .map_err(|e| e.to_string())
}

/// Compute plugin decorations (stub when plugins feature disabled)
#[cfg(not(feature = "plugins"))]
#[tauri::command(rename_all = "camelCase")]
pub fn compute_plugin_decorations(
    _state: State<AppState>,
    _plugin_id: String,
    _decoration_id: String,
    _blocks: serde_json::Value,
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
