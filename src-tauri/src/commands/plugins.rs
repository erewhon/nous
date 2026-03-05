//! Tauri commands for plugin management

use tauri::State;

use crate::AppState;

type CommandResult<T> = Result<T, String>;

/// List all loaded plugins with their manifests
#[cfg(feature = "plugins")]
#[tauri::command]
pub fn list_plugins(state: State<AppState>) -> CommandResult<Vec<crate::plugins::PluginManifest>> {
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
