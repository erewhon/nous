//! Plugin system for Nous — Lua (mlua) and WASM (Extism) plugin runtimes.
//!
//! Plugins live in `{library_path}/plugins/` and built-ins are bundled in the binary.
//! All plugin code is behind the `plugins` feature gate.

pub mod api;
pub mod error;
pub mod host;
pub mod loader;
pub mod manifest;
pub mod registry;
pub mod runtime;

pub use error::PluginError;
pub use host::{dispatch_plugin_event_bg, PluginHost};
pub use api::HostApi;
pub use manifest::{CapabilitySet, HookPoint, PluginManifest, PluginSource};
pub use runtime::Plugin;
