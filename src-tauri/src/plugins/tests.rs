//! Integration tests for the plugin system.

use std::sync::{Arc, Mutex};

use tempfile::TempDir;
use uuid::Uuid;

use crate::energy::EnergyStorage;
use crate::goals::GoalsStorage;
use crate::inbox::InboxStorage;
use crate::storage::FileStorage;

use super::api::HostApi;
use super::error::PluginError;
use super::host::PluginHost;
use super::manifest::{CapabilitySet, HookPoint, PluginManifest, PluginSource};
use super::registry::PluginRegistry;
use super::runtime::lua::LuaPlugin;
use super::runtime::Plugin;

/// Create a test environment with all storages in a temp directory.
/// Returns (HostApi arc, TempDir, notebook_id).
fn create_test_env() -> (Arc<HostApi>, TempDir, Uuid) {
    let tmp = TempDir::new().expect("create temp dir");
    let base = tmp.path().to_path_buf();

    let storage = FileStorage::new(base.clone());
    storage.init().expect("init file storage");
    let storage = Arc::new(Mutex::new(storage));

    let goals = GoalsStorage::new(base.clone()).expect("init goals storage");
    let goals = Arc::new(Mutex::new(goals));

    let inbox = InboxStorage::new(base.clone()).expect("init inbox storage");
    let inbox = Arc::new(Mutex::new(inbox));

    let energy = EnergyStorage::new(base.clone()).expect("init energy storage");
    let energy = Arc::new(Mutex::new(energy));

    let mut api = HostApi::new(storage.clone(), goals, inbox);
    api.set_energy_storage(energy);

    let api = Arc::new(api);

    // Create a test notebook
    let notebook_id = {
        let s = storage.lock().unwrap();
        let nb = s
            .create_notebook(
                "Test Notebook".to_string(),
                crate::storage::NotebookType::default(),
            )
            .expect("create notebook");
        nb.id
    };

    (api, tmp, notebook_id)
}

// ========== Capability Enforcement ==========

#[test]
fn test_page_read_denied_without_capability() {
    let (api, _tmp, notebook_id) = create_test_env();
    let caps = CapabilitySet::empty();
    let result = api.page_list(caps, "test-plugin", &notebook_id.to_string());
    assert!(result.is_err());
    match result.unwrap_err() {
        PluginError::CapabilityDenied { plugin_id, .. } => {
            assert_eq!(plugin_id, "test-plugin");
        }
        other => panic!("expected CapabilityDenied, got: {other:?}"),
    }
}

#[test]
fn test_page_write_denied_without_capability() {
    let (api, _tmp, notebook_id) = create_test_env();
    let caps = CapabilitySet::PAGE_READ; // only read, not write
    let result = api.page_create(caps, "test-plugin", &notebook_id.to_string(), "Title");
    assert!(result.is_err());
    match result.unwrap_err() {
        PluginError::CapabilityDenied { .. } => {}
        other => panic!("expected CapabilityDenied, got: {other:?}"),
    }
}

#[test]
fn test_energy_read_denied_without_capability() {
    let (api, _tmp, _nid) = create_test_env();
    let caps = CapabilitySet::empty();
    let result = api.energy_get_checkins(caps, "test-plugin", None, None, None);
    assert!(result.is_err());
    match result.unwrap_err() {
        PluginError::CapabilityDenied { .. } => {}
        other => panic!("expected CapabilityDenied, got: {other:?}"),
    }
}

#[test]
fn test_capability_grants_access() {
    let (api, _tmp, notebook_id) = create_test_env();
    let caps = CapabilitySet::PAGE_READ;
    let result = api.page_list(caps, "test-plugin", &notebook_id.to_string());
    assert!(result.is_ok());
    let pages = result.unwrap();
    assert!(pages.is_array());
}

// ========== HostApi Methods ==========

#[test]
fn test_page_create_and_get() {
    let (api, _tmp, notebook_id) = create_test_env();
    let caps = CapabilitySet::PAGE_READ | CapabilitySet::PAGE_WRITE;
    let nid = notebook_id.to_string();

    // Create a page
    let created = api
        .page_create(caps, "test-plugin", &nid, "My Test Page")
        .expect("create page");
    let page_id = created["id"].as_str().unwrap().to_string();

    // Get the page
    let page = api
        .page_get(caps, "test-plugin", &nid, &page_id)
        .expect("get page");
    assert_eq!(page["title"].as_str().unwrap(), "My Test Page");
}

#[test]
fn test_page_update_content() {
    let (api, _tmp, notebook_id) = create_test_env();
    let caps = CapabilitySet::PAGE_READ | CapabilitySet::PAGE_WRITE;
    let nid = notebook_id.to_string();

    let created = api
        .page_create(caps, "test-plugin", &nid, "Update Test")
        .expect("create page");
    let page_id = created["id"].as_str().unwrap().to_string();

    // Update with markdown content
    api.page_update(
        caps,
        "test-plugin",
        &nid,
        &page_id,
        None,
        Some("Hello world\n\nSecond paragraph"),
        None,
    )
    .expect("update page");

    // Verify content changed
    let page = api
        .page_get(caps, "test-plugin", &nid, &page_id)
        .expect("get page");
    let blocks = page["content"]["blocks"].as_array().unwrap();
    assert!(blocks.len() >= 2, "should have at least 2 blocks");
}

#[test]
fn test_page_manage_tags() {
    let (api, _tmp, notebook_id) = create_test_env();
    let caps = CapabilitySet::PAGE_READ | CapabilitySet::PAGE_WRITE;
    let nid = notebook_id.to_string();

    let created = api
        .page_create(caps, "test-plugin", &nid, "Tags Test")
        .expect("create page");
    let page_id = created["id"].as_str().unwrap().to_string();

    // Add tags
    let result = api
        .page_manage_tags(
            caps,
            "test-plugin",
            &nid,
            &page_id,
            Some(r#"["alpha", "beta", "gamma"]"#),
            None,
        )
        .expect("add tags");
    let tags = result["tags"].as_array().unwrap();
    assert_eq!(tags.len(), 3);

    // Remove one tag
    let result = api
        .page_manage_tags(
            caps,
            "test-plugin",
            &nid,
            &page_id,
            None,
            Some(r#"["beta"]"#),
        )
        .expect("remove tag");
    let tags = result["tags"].as_array().unwrap();
    assert_eq!(tags.len(), 2);
    let tag_strs: Vec<&str> = tags.iter().filter_map(|t| t.as_str()).collect();
    assert!(tag_strs.contains(&"alpha"));
    assert!(tag_strs.contains(&"gamma"));
    assert!(!tag_strs.contains(&"beta"));
}

#[test]
fn test_list_notebooks() {
    let (api, _tmp, _nid) = create_test_env();
    let caps = CapabilitySet::PAGE_READ;
    let result = api
        .list_notebooks(caps, "test-plugin")
        .expect("list notebooks");
    let notebooks = result.as_array().unwrap();
    assert!(
        notebooks.len() >= 1,
        "should have at least the test notebook"
    );
}

#[test]
fn test_inbox_capture_and_delete() {
    let (api, _tmp, _nid) = create_test_env();
    let caps = CapabilitySet::INBOX_CAPTURE;

    // Capture an item
    let item = api
        .inbox_capture(caps, "test-plugin", "Test Item", "Some content", &[])
        .expect("capture inbox item");
    let item_id = item["id"].as_str().unwrap().to_string();

    // List and verify present
    let items = api.inbox_list(caps, "test-plugin").expect("list inbox");
    let items_arr = items.as_array().unwrap();
    assert!(items_arr.iter().any(|i| i["id"].as_str() == Some(&item_id)));

    // Delete
    api.inbox_delete(caps, "test-plugin", &item_id)
        .expect("delete inbox item");

    // List and verify gone
    let items = api.inbox_list(caps, "test-plugin").expect("list inbox");
    let items_arr = items.as_array().unwrap();
    assert!(!items_arr.iter().any(|i| i["id"].as_str() == Some(&item_id)));
}

#[test]
fn test_goal_progress() {
    let (api, _tmp, _nid) = create_test_env();
    let caps = CapabilitySet::GOALS_READ | CapabilitySet::GOALS_WRITE;

    // Create a goal first (via storage directly)
    let goal = {
        let goals = api.goals_storage.lock().unwrap();
        goals
            .create_goal(crate::goals::CreateGoalRequest {
                name: "Test Goal".to_string(),
                description: None,
                frequency: crate::goals::Frequency::Daily,
                tracking_type: crate::goals::TrackingType::Manual,
                auto_detect: None,
                reminder: None,
            })
            .expect("create goal")
    };

    // Record progress via HostApi
    api.goal_record_progress(
        caps,
        "test-plugin",
        &goal.id.to_string(),
        "2025-01-15",
        true,
        Some(5),
    )
    .expect("record progress");

    // Get progress
    let progress = api
        .goal_get_progress(caps, "test-plugin", &goal.id.to_string(), None)
        .expect("get progress");
    let entries = progress.as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["completed"].as_bool(), Some(true));
    assert_eq!(entries[0]["value"].as_u64(), Some(5));
}

// ========== Lua Plugin Lifecycle ==========

fn make_test_lua_manifest(id: &str, caps: CapabilitySet, hooks: Vec<HookPoint>) -> PluginManifest {
    PluginManifest {
        id: id.to_string(),
        name: format!("Test: {id}"),
        version: "0.1.0".to_string(),
        description: None,
        capabilities: caps,
        hooks,
        is_builtin: false,
        source: PluginSource::Builtin,
    }
}

#[test]
fn test_lua_plugin_load_and_call() {
    let (api, _tmp, _nid) = create_test_env();

    let source = r#"
function greet(input_json)
    local input = nous.json_decode(input_json)
    local name = input.name or "world"
    return nous.json_encode({ greeting = "Hello, " .. name .. "!" })
end
"#;

    let manifest = make_test_lua_manifest("test-greet", CapabilitySet::empty(), vec![]);
    let mut plugin = LuaPlugin::new(manifest, source.to_string()).expect("create lua plugin");
    plugin.init(&api).expect("init lua plugin");

    let result = plugin
        .call("greet", &serde_json::json!({"name": "Nous"}))
        .expect("call greet");
    assert_eq!(result["greeting"].as_str(), Some("Hello, Nous!"));
}

#[test]
fn test_lua_plugin_host_api_access() {
    let (api, _tmp, notebook_id) = create_test_env();

    let source = format!(
        r#"
function list_pages(input_json)
    local result = nous.page_list("{nid}")
    return result
end
"#,
        nid = notebook_id
    );

    let manifest = make_test_lua_manifest(
        "test-api-access",
        CapabilitySet::PAGE_READ,
        vec![],
    );
    let mut plugin = LuaPlugin::new(manifest, source).expect("create lua plugin");
    plugin.init(&api).expect("init lua plugin");

    let result = plugin
        .call("list_pages", &serde_json::Value::Null)
        .expect("call list_pages");
    assert!(result.is_array());
}

#[test]
fn test_lua_plugin_capability_enforcement() {
    let (api, _tmp, notebook_id) = create_test_env();

    let source = format!(
        r#"
function try_page_list(input_json)
    local result = nous.page_list("{nid}")
    return result
end
"#,
        nid = notebook_id
    );

    // No capabilities
    let manifest = make_test_lua_manifest("test-no-caps", CapabilitySet::empty(), vec![]);
    let mut plugin = LuaPlugin::new(manifest, source).expect("create lua plugin");
    plugin.init(&api).expect("init lua plugin");

    let result = plugin.call("try_page_list", &serde_json::Value::Null);
    assert!(
        result.is_err(),
        "should fail without PAGE_READ capability"
    );
}

// ========== Hook Dispatch ==========

#[test]
fn test_hook_dispatch_calls_registered_plugins() {
    let (api, tmp, _nid) = create_test_env();
    let plugins_dir = tmp.path().join("plugins");
    std::fs::create_dir_all(&plugins_dir).unwrap();

    let source = r#"--[[ [manifest]
id = "test-event-handler"
name = "Test Event Handler"
version = "0.1.0"
capabilities = ["inbox_capture"]
hooks = ["on_page_created"]
]]

function on_page_created(input_json)
    nous.inbox_capture("page-created-event", "handled", nil)
    return "{}"
end
"#;

    let manifest = super::manifest::parse_lua_manifest_header(source).unwrap();
    let manifest = manifest
        .into_manifest(PluginSource::Builtin)
        .unwrap();
    let mut plugin = LuaPlugin::new(manifest, source.to_string()).unwrap();
    plugin.init(&api).unwrap();

    let mut host = PluginHost::new(Arc::clone(&api), plugins_dir);
    host.registry_mut().register(Box::new(plugin));

    // Dispatch event
    host.dispatch_event(
        &HookPoint::OnPageCreated,
        &serde_json::json!({"pageId": "test"}),
    );

    // Verify side-effect: inbox should have the item
    let caps = CapabilitySet::INBOX_CAPTURE;
    let items = api.inbox_list(caps, "test").unwrap();
    let items_arr = items.as_array().unwrap();
    assert!(
        items_arr
            .iter()
            .any(|i| i["title"].as_str() == Some("page-created-event")),
        "event handler should have captured an inbox item"
    );
}

#[test]
fn test_hook_dispatch_skips_unregistered() {
    let (api, tmp, _nid) = create_test_env();
    let plugins_dir = tmp.path().join("plugins");
    std::fs::create_dir_all(&plugins_dir).unwrap();

    let source = r#"--[[ [manifest]
id = "test-no-hook"
name = "Test No Hook"
version = "0.1.0"
capabilities = ["inbox_capture"]
hooks = ["on_page_updated"]
]]

function on_page_updated(input_json)
    nous.inbox_capture("should-not-appear", "error", nil)
    return "{}"
end
"#;

    let manifest = super::manifest::parse_lua_manifest_header(source).unwrap();
    let manifest = manifest.into_manifest(PluginSource::Builtin).unwrap();
    let mut plugin = LuaPlugin::new(manifest, source.to_string()).unwrap();
    plugin.init(&api).unwrap();

    let mut host = PluginHost::new(Arc::clone(&api), plugins_dir);
    host.registry_mut().register(Box::new(plugin));

    // Dispatch OnPageCreated (plugin only registered for OnPageUpdated)
    host.dispatch_event(
        &HookPoint::OnPageCreated,
        &serde_json::json!({"pageId": "test"}),
    );

    // Verify no side-effect
    let caps = CapabilitySet::INBOX_CAPTURE;
    let items = api.inbox_list(caps, "test").unwrap();
    let items_arr = items.as_array().unwrap();
    assert!(
        !items_arr
            .iter()
            .any(|i| i["title"].as_str() == Some("should-not-appear")),
        "unregistered hook should not be called"
    );
}

// ========== Registry ==========

#[test]
fn test_register_and_unregister() {
    let mut registry = PluginRegistry::new();

    let (api, _tmp, _nid) = create_test_env();

    let source = r#"
function noop(input_json)
    return "{}"
end
"#;
    let manifest = make_test_lua_manifest("test-reg", CapabilitySet::empty(), vec![]);
    let mut plugin = LuaPlugin::new(manifest, source.to_string()).unwrap();
    plugin.init(&api).unwrap();

    registry.register(Box::new(plugin));
    assert_eq!(registry.len(), 1);
    assert!(registry.get("test-reg").is_some());

    registry.unregister("test-reg");
    assert_eq!(registry.len(), 0);
    assert!(registry.get("test-reg").is_none());
}

#[test]
fn test_plugins_for_hook() {
    let mut registry = PluginRegistry::new();
    let (api, _tmp, _nid) = create_test_env();

    let source = r#"
function on_page_created(input_json)
    return "{}"
end
"#;

    // Plugin A: handles OnPageCreated
    let manifest_a = make_test_lua_manifest(
        "plugin-a",
        CapabilitySet::empty(),
        vec![HookPoint::OnPageCreated],
    );
    let mut pa = LuaPlugin::new(manifest_a, source.to_string()).unwrap();
    pa.init(&api).unwrap();
    registry.register(Box::new(pa));

    // Plugin B: handles OnPageUpdated
    let manifest_b = make_test_lua_manifest(
        "plugin-b",
        CapabilitySet::empty(),
        vec![HookPoint::OnPageUpdated],
    );
    let mut pb = LuaPlugin::new(manifest_b, source.to_string()).unwrap();
    pb.init(&api).unwrap();
    registry.register(Box::new(pb));

    let created_hooks = registry.plugins_for_hook(&HookPoint::OnPageCreated);
    assert_eq!(created_hooks.len(), 1);
    assert!(created_hooks.contains(&"plugin-a".to_string()));

    let updated_hooks = registry.plugins_for_hook(&HookPoint::OnPageUpdated);
    assert_eq!(updated_hooks.len(), 1);
    assert!(updated_hooks.contains(&"plugin-b".to_string()));

    let deleted_hooks = registry.plugins_for_hook(&HookPoint::OnPageDeleted);
    assert_eq!(deleted_hooks.len(), 0);
}

// ========== Enable/Disable ==========

#[test]
fn test_enable_disable_persists() {
    let (api, tmp, _nid) = create_test_env();
    let plugins_dir = tmp.path().join("plugins");
    std::fs::create_dir_all(&plugins_dir).unwrap();

    {
        let mut host = PluginHost::new(Arc::clone(&api), plugins_dir.clone());
        assert!(host.is_plugin_enabled("some-plugin"));

        host.set_plugin_enabled("some-plugin", false);
        assert!(!host.is_plugin_enabled("some-plugin"));
    }

    // New host should load persisted state
    let host = PluginHost::new(Arc::clone(&api), plugins_dir);
    assert!(!host.is_plugin_enabled("some-plugin"));
}

#[test]
fn test_disabled_plugin_skipped_in_dispatch() {
    let (api, tmp, _nid) = create_test_env();
    let plugins_dir = tmp.path().join("plugins");
    std::fs::create_dir_all(&plugins_dir).unwrap();

    let source = r#"--[[ [manifest]
id = "test-disabled-dispatch"
name = "Test Disabled Dispatch"
version = "0.1.0"
capabilities = ["inbox_capture"]
hooks = ["on_page_created"]
]]

function on_page_created(input_json)
    nous.inbox_capture("disabled-plugin-fired", "error", nil)
    return "{}"
end
"#;

    let manifest = super::manifest::parse_lua_manifest_header(source).unwrap();
    let manifest = manifest.into_manifest(PluginSource::Builtin).unwrap();
    let mut plugin = LuaPlugin::new(manifest, source.to_string()).unwrap();
    plugin.init(&api).unwrap();

    let mut host = PluginHost::new(Arc::clone(&api), plugins_dir);
    host.registry_mut().register(Box::new(plugin));

    // Disable the plugin
    host.set_plugin_enabled("test-disabled-dispatch", false);

    // Dispatch event
    host.dispatch_event(
        &HookPoint::OnPageCreated,
        &serde_json::json!({"pageId": "test"}),
    );

    // Verify plugin was NOT called
    let caps = CapabilitySet::INBOX_CAPTURE;
    let items = api.inbox_list(caps, "test").unwrap();
    let items_arr = items.as_array().unwrap();
    assert!(
        !items_arr
            .iter()
            .any(|i| i["title"].as_str() == Some("disabled-plugin-fired")),
        "disabled plugin should not be called during dispatch"
    );
}
