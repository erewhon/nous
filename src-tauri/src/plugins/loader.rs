//! Plugin discovery — scan plugins directory and load built-ins

use std::path::Path;
use std::sync::Arc;

use super::api::HostApi;
use super::error::PluginError;
use super::manifest::{parse_lua_manifest_header, PluginSource, RawManifest};
use super::runtime::lua::LuaPlugin;
use super::runtime::wasm::WasmPlugin;
use super::runtime::{BoxedPlugin, Plugin};

/// Embedded built-in Lua plugin sources
static BUILTIN_PLUGINS: &[(&str, &str)] = &[
    ("daily_outcomes", include_str!("builtins/daily_outcomes.lua")),
    ("weekly_outcomes", include_str!("builtins/weekly_outcomes.lua")),
    ("monthly_outcomes", include_str!("builtins/monthly_outcomes.lua")),
    ("daily_reflection", include_str!("builtins/daily_reflection.lua")),
    ("weekly_review", include_str!("builtins/weekly_review.lua")),
    ("carry_forward", include_str!("builtins/carry_forward.lua")),
    ("weekly_carry_forward", include_str!("builtins/weekly_carry_forward.lua")),
    ("daily_note_carry_forward", include_str!("builtins/daily_note_carry_forward.lua")),
    ("weekly_study_review", include_str!("builtins/weekly_study_review.lua")),
    ("exam_prep", include_str!("builtins/exam_prep.lua")),
    ("daily_learning_summary", include_str!("builtins/daily_learning_summary.lua")),
    ("daily_goal_nudge", include_str!("builtins/daily_goal_nudge.lua")),
    ("goal_brainstorm", include_str!("builtins/goal_brainstorm.lua")),
    ("database_heatmap", include_str!("builtins/database_heatmap.lua")),
    ("mermaid_block", include_str!("builtins/mermaid_block.lua")),
    ("map_view", include_str!("builtins/map_view.lua")),
    ("external_data_embed", include_str!("builtins/external_data_embed.lua")),
    ("pomodoro_timer", include_str!("builtins/pomodoro_timer.lua")),
    ("food_tracker", include_str!("builtins/food_tracker.lua")),
    ("treemap_view", include_str!("builtins/treemap_view.lua")),
    ("sprint_planning", include_str!("builtins/sprint_planning.lua")),
    ("database_automation", include_str!("builtins/database_automation.lua")),
    ("database_templates", include_str!("builtins/database_templates.lua")),
    ("export_revealjs", include_str!("builtins/export_revealjs.lua")),
    ("export_print", include_str!("builtins/export_print.lua")),
];

/// Scan a directory for plugin files and return loaded (but not yet initialized) plugins.
pub fn scan_plugins_dir(
    dir: &Path,
    api: &Arc<HostApi>,
) -> Vec<Result<BoxedPlugin, PluginError>> {
    let mut results = Vec::new();

    if !dir.exists() {
        log::info!("Plugins directory does not exist: {}", dir.display());
        return results;
    }

    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("Failed to read plugins directory: {e}");
            return results;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();

        if path.extension().map_or(false, |ext| ext == "lua") {
            results.push(load_lua_file(&path, api));
        }
        // WASM: look for .toml files with a sibling .wasm
        else if path.extension().map_or(false, |ext| ext == "toml") {
            let wasm_path = path.with_extension("wasm");
            if wasm_path.exists() {
                results.push(load_wasm_file(&path, &wasm_path, api));
            }
        }
    }

    results
}

/// Load a single .lua plugin file
fn load_lua_file(path: &Path, api: &Arc<HostApi>) -> Result<BoxedPlugin, PluginError> {
    let source_code = std::fs::read_to_string(path)?;
    let raw = parse_lua_manifest_header(&source_code)?;
    let source = PluginSource::LuaFile {
        path: path.to_path_buf(),
    };
    let manifest = raw.into_manifest(source)?;
    let id = manifest.id.clone();

    let mut plugin = LuaPlugin::new(manifest, source_code)?;
    plugin.init(api)?;

    log::info!("Loaded Lua plugin: {} from {}", id, path.display());
    Ok(Box::new(plugin))
}

/// Load a WASM plugin from a .toml manifest + .wasm binary.
fn load_wasm_file(toml_path: &Path, wasm_path: &Path, api: &Arc<HostApi>) -> Result<BoxedPlugin, PluginError> {
    let toml_content = std::fs::read_to_string(toml_path)?;
    let raw: RawManifest = toml::from_str(&toml_content)
        .map_err(|e| PluginError::ManifestParse(format!("TOML parse error: {e}")))?;

    let source = PluginSource::WasmFile {
        wasm_path: wasm_path.to_path_buf(),
        toml_path: toml_path.to_path_buf(),
    };
    let manifest = raw.into_manifest(source)?;
    let id = manifest.id.clone();

    let wasm_bytes = std::fs::read(wasm_path)?;
    let mut plugin = WasmPlugin::new(manifest, wasm_bytes);
    plugin.init(api)?;

    log::info!("Loaded WASM plugin: {} from {}", id, wasm_path.display());
    Ok(Box::new(plugin))
}

/// Load built-in plugins embedded in the binary via `include_str!`.
pub fn load_builtins(api: &Arc<HostApi>) -> Vec<Result<BoxedPlugin, PluginError>> {
    BUILTIN_PLUGINS
        .iter()
        .map(|(label, source_code)| {
            load_builtin_lua(label, source_code, api)
        })
        .collect()
}

/// Load a single embedded Lua plugin
fn load_builtin_lua(
    label: &str,
    source_code: &str,
    api: &Arc<HostApi>,
) -> Result<BoxedPlugin, PluginError> {
    let raw = parse_lua_manifest_header(source_code)?;
    let source = PluginSource::Builtin;
    let manifest = raw.into_manifest(source)?;
    let id = manifest.id.clone();

    let mut plugin = LuaPlugin::new(manifest, source_code.to_string())?;
    plugin.init(api)?;

    log::info!("Loaded built-in plugin: {} ({})", id, label);
    Ok(Box::new(plugin))
}
