//! Plugin runtime trait and type aliases

pub mod lua;
pub mod wasm;

use std::sync::Arc;

use super::api::HostApi;
use super::error::PluginError;
use super::manifest::PluginManifest;
use super::manifest::HookPoint;

/// Unified interface for both Lua and WASM plugin runtimes.
/// Each plugin instance implements this trait.
pub trait Plugin: Send {
    /// Unique plugin identifier
    fn id(&self) -> &str;

    /// Plugin metadata
    fn manifest(&self) -> &PluginManifest;

    /// Initialize the plugin, giving it access to host APIs
    fn init(&mut self, api: &Arc<HostApi>) -> Result<(), PluginError>;

    /// Call a named function in the plugin, passing JSON input and receiving JSON output
    fn call(
        &mut self,
        function: &str,
        input: &serde_json::Value,
    ) -> Result<serde_json::Value, PluginError>;

    /// Check whether this plugin handles a specific hook point
    fn handles_hook(&self, hook: &HookPoint) -> bool {
        self.manifest().hooks.contains(hook)
    }
}

/// Type-erased plugin
pub type BoxedPlugin = Box<dyn Plugin>;
