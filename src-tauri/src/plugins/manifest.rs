//! Plugin manifest types — capabilities, hooks, and metadata

use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::PathBuf;

use super::error::PluginError;

// ===== Capability Set =====

bitflags::bitflags! {
    /// Capabilities a plugin may request. Enforced by HostApi before each call.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
    pub struct CapabilitySet: u32 {
        const PAGE_READ       = 0b0000_0000_0001;
        const PAGE_WRITE      = 0b0000_0000_0010;
        const DATABASE_READ   = 0b0000_0000_0100;
        const DATABASE_WRITE  = 0b0000_0000_1000;
        const INBOX_CAPTURE   = 0b0000_0001_0000;
        const GOALS_READ      = 0b0000_0010_0000;
        const GOALS_WRITE     = 0b0000_0100_0000;
        const SEARCH          = 0b0000_1000_0000;
        const COMMAND_PALETTE = 0b0001_0000_0000;
        const NETWORK         = 0b0010_0000_0000;
        const ENERGY_READ     = 0b0100_0000_0000;
        const ENERGY_WRITE    = 0b1000_0000_0000;
        const DATABASE_VIEW   = 0b0001_0000_0000_0000;
        const BLOCK_RENDER    = 0b0010_0000_0000_0000;
        const EXPORT          = 0b0100_0000_0000_0000;
        const IMPORT          = 0b1000_0000_0000_0000;
        const SIDEBAR_PANEL       = 0b0001_0000_0000_0000_0000;
        const EDITOR_DECORATION   = 0b0010_0000_0000_0000_0000;
    }
}

impl CapabilitySet {
    /// Parse a list of capability name strings into a CapabilitySet.
    pub fn from_names(names: &[String]) -> Result<Self, PluginError> {
        let mut set = CapabilitySet::empty();
        for name in names {
            let cap = match name.as_str() {
                "page_read" => CapabilitySet::PAGE_READ,
                "page_write" => CapabilitySet::PAGE_WRITE,
                "database_read" => CapabilitySet::DATABASE_READ,
                "database_write" => CapabilitySet::DATABASE_WRITE,
                "inbox_capture" => CapabilitySet::INBOX_CAPTURE,
                "goals_read" => CapabilitySet::GOALS_READ,
                "goals_write" => CapabilitySet::GOALS_WRITE,
                "search" => CapabilitySet::SEARCH,
                "command_palette" => CapabilitySet::COMMAND_PALETTE,
                "network" => CapabilitySet::NETWORK,
                "energy_read" => CapabilitySet::ENERGY_READ,
                "energy_write" => CapabilitySet::ENERGY_WRITE,
                "database_view" => CapabilitySet::DATABASE_VIEW,
                "block_render" => CapabilitySet::BLOCK_RENDER,
                "export" => CapabilitySet::EXPORT,
                "import" => CapabilitySet::IMPORT,
                "sidebar_panel" => CapabilitySet::SIDEBAR_PANEL,
                "editor_decoration" => CapabilitySet::EDITOR_DECORATION,
                other => {
                    return Err(PluginError::ManifestParse(format!(
                        "unknown capability: {other}"
                    )))
                }
            };
            set |= cap;
        }
        Ok(set)
    }
}

impl fmt::Display for CapabilitySet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let names: Vec<&str> = [
            (CapabilitySet::PAGE_READ, "page_read"),
            (CapabilitySet::PAGE_WRITE, "page_write"),
            (CapabilitySet::DATABASE_READ, "database_read"),
            (CapabilitySet::DATABASE_WRITE, "database_write"),
            (CapabilitySet::INBOX_CAPTURE, "inbox_capture"),
            (CapabilitySet::GOALS_READ, "goals_read"),
            (CapabilitySet::GOALS_WRITE, "goals_write"),
            (CapabilitySet::SEARCH, "search"),
            (CapabilitySet::COMMAND_PALETTE, "command_palette"),
            (CapabilitySet::NETWORK, "network"),
            (CapabilitySet::ENERGY_READ, "energy_read"),
            (CapabilitySet::ENERGY_WRITE, "energy_write"),
            (CapabilitySet::DATABASE_VIEW, "database_view"),
            (CapabilitySet::BLOCK_RENDER, "block_render"),
            (CapabilitySet::EXPORT, "export"),
            (CapabilitySet::IMPORT, "import"),
            (CapabilitySet::SIDEBAR_PANEL, "sidebar_panel"),
            (CapabilitySet::EDITOR_DECORATION, "editor_decoration"),
        ]
        .iter()
        .filter(|(cap, _)| self.contains(*cap))
        .map(|(_, name)| *name)
        .collect();
        write!(f, "{}", names.join(", "))
    }
}

// ===== Hook Points =====

/// Points where plugins can hook into the application
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HookPoint {
    /// Goal auto-detection hook
    GoalDetector,
    /// Action step execution hook
    ActionStep {
        step_type: String,
    },
    /// Command palette command registration
    CommandPalette,
    /// Fired when a page is created
    OnPageCreated,
    /// Fired when a page is updated
    OnPageUpdated,
    /// Fired when a page is deleted (moved to trash)
    OnPageDeleted,
    /// Fired when an inbox item is captured
    OnInboxCaptured,
    /// Fired when goal progress is recorded
    OnGoalProgress,
    /// Fired when database rows are added (via plugin API)
    OnDatabaseRowAdded,
    /// Fired when database rows are updated (via plugin API)
    OnDatabaseRowUpdated,
    /// Custom database view rendering
    DatabaseView {
        view_type: String,
    },
    /// Custom editor block rendering
    BlockRender {
        block_type: String,
    },
    /// Custom export format
    ExportFormat {
        format_id: String,
    },
    /// Custom import format
    ImportFormat {
        format_id: String,
    },
    /// Custom sidebar panel
    SidebarPanel {
        panel_id: String,
    },
    /// Editor decoration overlay
    EditorDecoration {
        decoration_id: String,
    },
}

impl HookPoint {
    /// Parse a hook point from a TOML string value
    pub fn from_str_value(s: &str) -> Result<Self, PluginError> {
        match s {
            "goal_detector" => Ok(HookPoint::GoalDetector),
            "command_palette" => Ok(HookPoint::CommandPalette),
            "on_page_created" => Ok(HookPoint::OnPageCreated),
            "on_page_updated" => Ok(HookPoint::OnPageUpdated),
            "on_page_deleted" => Ok(HookPoint::OnPageDeleted),
            "on_inbox_captured" => Ok(HookPoint::OnInboxCaptured),
            "on_goal_progress" => Ok(HookPoint::OnGoalProgress),
            "on_database_row_added" => Ok(HookPoint::OnDatabaseRowAdded),
            "on_database_row_updated" => Ok(HookPoint::OnDatabaseRowUpdated),
            other if other.starts_with("action_step:") => {
                let step_type = other.strip_prefix("action_step:").unwrap().to_string();
                Ok(HookPoint::ActionStep { step_type })
            }
            other if other.starts_with("database_view:") => {
                let view_type = other.strip_prefix("database_view:").unwrap().to_string();
                Ok(HookPoint::DatabaseView { view_type })
            }
            other if other.starts_with("block_render:") => {
                let block_type = other.strip_prefix("block_render:").unwrap().to_string();
                Ok(HookPoint::BlockRender { block_type })
            }
            other if other.starts_with("export_format:") => {
                let format_id = other.strip_prefix("export_format:").unwrap().to_string();
                Ok(HookPoint::ExportFormat { format_id })
            }
            other if other.starts_with("import_format:") => {
                let format_id = other.strip_prefix("import_format:").unwrap().to_string();
                Ok(HookPoint::ImportFormat { format_id })
            }
            other if other.starts_with("sidebar_panel:") => {
                let panel_id = other.strip_prefix("sidebar_panel:").unwrap().to_string();
                Ok(HookPoint::SidebarPanel { panel_id })
            }
            other if other.starts_with("editor_decoration:") => {
                let decoration_id = other.strip_prefix("editor_decoration:").unwrap().to_string();
                Ok(HookPoint::EditorDecoration { decoration_id })
            }
            other => Err(PluginError::ManifestParse(format!(
                "unknown hook point: {other}"
            ))),
        }
    }
}

// ===== Plugin Source =====

/// Where a plugin came from
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PluginSource {
    /// Embedded in the binary (built-in)
    Builtin,
    /// Loaded from a .lua file on disk
    LuaFile { path: PathBuf },
    /// Loaded from a .wasm file with sidecar .toml
    WasmFile { wasm_path: PathBuf, toml_path: PathBuf },
}

// ===== Plugin Manifest =====

/// Metadata parsed from a plugin's manifest (TOML header or sidecar file)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    /// Unique plugin identifier (e.g. "builtin-daily-outcomes")
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Semver version string
    pub version: String,
    /// Optional description
    pub description: Option<String>,
    /// Requested capabilities
    pub capabilities: CapabilitySet,
    /// Hook points this plugin registers for
    pub hooks: Vec<HookPoint>,
    /// Whether this plugin ships with the binary
    pub is_builtin: bool,
    /// Where the plugin was loaded from
    pub source: PluginSource,
}

/// Raw TOML structure for deserialization before converting to PluginManifest
#[derive(Debug, Deserialize)]
pub(crate) struct RawManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub hooks: Vec<String>,
    #[serde(default)]
    pub is_builtin: bool,
}

impl RawManifest {
    /// Convert to a full PluginManifest with the given source
    pub fn into_manifest(self, source: PluginSource) -> Result<PluginManifest, PluginError> {
        let capabilities = CapabilitySet::from_names(&self.capabilities)?;
        let hooks = self
            .hooks
            .iter()
            .map(|h| HookPoint::from_str_value(h))
            .collect::<Result<Vec<_>, _>>()?;

        Ok(PluginManifest {
            id: self.id,
            name: self.name,
            version: self.version,
            description: self.description,
            capabilities,
            hooks,
            is_builtin: self.is_builtin,
            source,
        })
    }
}

/// Parse a TOML manifest block from the `--[[ [manifest] ... ]]` header of a Lua file.
pub fn parse_lua_manifest_header(lua_source: &str) -> Result<RawManifest, PluginError> {
    // Look for --[[ [manifest] ... ]]
    let start_marker = "--[[ [manifest]";
    let end_marker = "]]";

    let start = lua_source.find(start_marker).ok_or_else(|| {
        PluginError::ManifestParse("missing --[[ [manifest] header".to_string())
    })?;

    let toml_start = start + start_marker.len();
    let toml_end = lua_source[toml_start..].find(end_marker).ok_or_else(|| {
        PluginError::ManifestParse("unclosed manifest header (missing ]])".to_string())
    })?;

    let toml_str = &lua_source[toml_start..toml_start + toml_end];

    // The TOML block should have a [manifest] table, but we already consumed that marker.
    // The content inside is the manifest fields directly.
    let raw: RawManifest = toml::from_str(toml_str).map_err(|e| {
        PluginError::ManifestParse(format!("TOML parse error: {e}"))
    })?;

    Ok(raw)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_lua_manifest_header() {
        let lua = r#"--[[ [manifest]
id = "test-plugin"
name = "Test Plugin"
version = "0.1.0"
capabilities = ["page_read", "goals_read"]
hooks = ["goal_detector"]
]]

function detect_goal(input_json)
  return "{}"
end
"#;
        let raw = parse_lua_manifest_header(lua).unwrap();
        assert_eq!(raw.id, "test-plugin");
        assert_eq!(raw.capabilities, vec!["page_read", "goals_read"]);
        assert_eq!(raw.hooks, vec!["goal_detector"]);
    }

    #[test]
    fn test_capability_set_from_names() {
        let caps = CapabilitySet::from_names(&[
            "page_read".to_string(),
            "goals_write".to_string(),
        ])
        .unwrap();
        assert!(caps.contains(CapabilitySet::PAGE_READ));
        assert!(caps.contains(CapabilitySet::GOALS_WRITE));
        assert!(!caps.contains(CapabilitySet::NETWORK));
    }
}
