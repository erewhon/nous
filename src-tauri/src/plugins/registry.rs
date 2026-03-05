//! Plugin registry — index of all loaded plugins

use std::collections::HashMap;
use std::sync::Mutex;

use super::error::PluginError;
use super::manifest::{HookPoint, PluginManifest};
use super::runtime::BoxedPlugin;

/// Holds all loaded plugins, keyed by plugin ID.
pub struct PluginRegistry {
    plugins: HashMap<String, Mutex<BoxedPlugin>>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self {
            plugins: HashMap::new(),
        }
    }

    /// Register a plugin. Replaces any existing plugin with the same ID.
    pub fn register(&mut self, plugin: BoxedPlugin) {
        let id = plugin.id().to_string();
        log::info!("Registered plugin: {} ({})", plugin.manifest().name, id);
        self.plugins.insert(id, Mutex::new(plugin));
    }

    /// Remove a plugin by ID.
    pub fn unregister(&mut self, id: &str) -> Option<BoxedPlugin> {
        self.plugins
            .remove(id)
            .and_then(|m| m.into_inner().ok())
    }

    /// Get a reference to the mutex-wrapped plugin by ID.
    pub fn get(&self, id: &str) -> Option<&Mutex<BoxedPlugin>> {
        self.plugins.get(id)
    }

    /// Get manifests for all registered plugins.
    pub fn list_manifests(&self) -> Vec<PluginManifest> {
        self.plugins
            .values()
            .filter_map(|m| m.lock().ok().map(|p| p.manifest().clone()))
            .collect()
    }

    /// Find all plugin IDs that handle a given hook point.
    pub fn plugins_for_hook(&self, hook: &HookPoint) -> Vec<String> {
        self.plugins
            .iter()
            .filter_map(|(id, m)| {
                m.lock()
                    .ok()
                    .and_then(|p| {
                        if p.handles_hook(hook) {
                            Some(id.clone())
                        } else {
                            None
                        }
                    })
            })
            .collect()
    }

    /// Number of loaded plugins.
    pub fn len(&self) -> usize {
        self.plugins.len()
    }

    pub fn is_empty(&self) -> bool {
        self.plugins.is_empty()
    }
}
