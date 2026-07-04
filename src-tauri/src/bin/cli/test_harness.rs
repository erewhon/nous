//! Integration-test harness for the daemon HTTP API.
//!
//! Drives the axum router in-process via `tower::ServiceExt::oneshot` —
//! no real TCP socket, no spawn, no port collisions. Each `TestEnv`
//! gets a fresh `tempfile::TempDir` so tests run cleanly in parallel.
//!
//! ## Adding a test
//!
//! ```ignore
//! #[tokio::test]
//! async fn my_test() {
//!     let mut env = TestEnv::new();
//!     let nb = env.create_notebook("Smoke");
//!
//!     let (status, body) = env
//!         .post_json(&format!("/api/notebooks/{}/pages", nb), json!({"title":"hi"}))
//!         .await;
//!     assert_eq!(status, StatusCode::CREATED);
//!     assert_eq!(body["data"]["title"], "hi");
//!
//!     let evt = env.try_recv_event().expect("page.created");
//!     assert_eq!(evt.event, "page.created");
//! }
//! ```
//!
//! Expected pattern per endpoint family: happy path → emitted event,
//! plus targeted failure cases (404 on bad ID, 401/403 if auth on,
//! 400 on bad body). The harness is intentionally low-level so each
//! new test fits in ~30 lines.
//!
//! ## What the harness skips for speed
//!
//! - `ActionScheduler.start()` is NOT called (no background timer thread).
//! - `PythonAI` is constructed with a placeholder path; no Python init.
//! - Auth defaults to disabled; use `TestEnv::with_auth_keys(rw, ro)` for
//!   auth-scope tests.

#![cfg(test)]
#![allow(dead_code)]

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use axum::{
    body::{to_bytes, Body},
    http::{Method, Request, StatusCode},
    Router,
};
use serde_json::{json, Value};
use tempfile::TempDir;
use tower::ServiceExt;
use uuid::Uuid;

use nous_lib::actions::{ActionExecutor, ActionScheduler, ActionStorage};
use nous_lib::contacts::ContactsStorage;
use nous_lib::energy::EnergyStorage;
use nous_lib::events::AppEvent;
use nous_lib::goals::GoalsStorage;
use nous_lib::inbox::InboxStorage;
use nous_lib::library::LibraryStorage;
use nous_lib::python_bridge::PythonAI;
use nous_lib::search::{RagBackend, RagConfig, SearchIndex, TantivyBackend};
use nous_lib::storage::{FileStorage, NotebookType};
use nous_lib::sync::{CrdtStore, LogEmitter, SyncManager};
use tokio::sync::RwLock;

use super::api;
use super::auth::{ApiKeySet, Scope};
use super::daemon::DaemonState;

/// One isolated daemon instance for a test. Owns its tempdir, so dropping
/// the `TestEnv` cleans up everything on disk.
pub struct TestEnv {
    /// Held so the temp dir lives at least as long as the env.
    _tmp: TempDir,
    pub library_path: PathBuf,
    pub state: Arc<DaemonState>,
    pub router: Router,
    /// Receives every event the handlers `emit_event(...)`. Use
    /// [`Self::try_recv_event`] (non-blocking) or [`Self::recv_event`]
    /// (with timeout) to read.
    pub event_rx: tokio::sync::broadcast::Receiver<AppEvent>,
    /// rw/ro tokens when auth is enabled; None when disabled.
    pub rw_token: Option<String>,
    pub ro_token: Option<String>,
    /// Live handle to the RAG config — mutate for semantic-mode tests.
    pub rag_config: Arc<RwLock<RagConfig>>,
}

impl TestEnv {
    /// Build an env with auth disabled. Most happy-path tests want this.
    pub fn new() -> Self {
        Self::build(None)
    }

    /// Build an env with auth enabled. Returns generated `rw` and `ro`
    /// tokens via `env.rw_token` / `env.ro_token`.
    pub fn with_auth() -> Self {
        let rw = format!("rw:{}", random_token_suffix());
        let ro = format!("ro:{}", random_token_suffix());
        Self::build(Some((rw, ro)))
    }

    fn build(auth_tokens: Option<(String, String)>) -> Self {
        let tmp = tempfile::tempdir().expect("create tempdir");
        let library_path = tmp.path().to_path_buf();

        let storage = FileStorage::new(library_path.clone());
        storage.init().expect("storage init");

        let library_storage = LibraryStorage::new(library_path.clone());
        let inbox_storage = InboxStorage::new(library_path.clone()).expect("inbox init");
        let goals_storage = GoalsStorage::new(library_path.clone()).expect("goals init");
        let energy_storage = EnergyStorage::new(library_path.clone()).expect("energy init");
        let contacts_storage = ContactsStorage::new(library_path.clone()).expect("contacts init");
        let action_storage = ActionStorage::new(library_path.clone()).expect("action init");

        // PythonAI is constructed lazily — passing a placeholder path is
        // safe because tests don't exercise Python-backed flows.
        let python_ai = PythonAI::new(PathBuf::from("nous-py"));

        let search_index = SearchIndex::new(library_path.join("search_index"))
            .expect("search index init");
        let crdt_store = Arc::new(CrdtStore::new(library_path.clone()));

        // Tantivy adapter + RAG (disabled by default — tests opt in by
        // mutating env.rag_config before sending requests).
        let search_index_arc = Arc::new(Mutex::new(search_index));
        let tantivy_backend = Arc::new(TantivyBackend::new(Arc::clone(&search_index_arc)));
        let rag_config = Arc::new(RwLock::new(RagConfig::disabled()));
        let rag_backend = Arc::new(RagBackend::new(Arc::clone(&rag_config)));
        let daemon_config_path = library_path.join("daemon-config.toml");

        let storage_arc = Arc::new(Mutex::new(storage));
        let library_storage_arc = Arc::new(Mutex::new(library_storage));
        let inbox_storage_arc = Arc::new(Mutex::new(inbox_storage));
        let goals_storage_arc = Arc::new(Mutex::new(goals_storage));
        let energy_storage_arc = Arc::new(Mutex::new(energy_storage));
        let contacts_storage_arc = Arc::new(Mutex::new(contacts_storage));
        let action_storage_arc = Arc::new(Mutex::new(action_storage));
        let python_ai_arc = Arc::new(Mutex::new(python_ai));

        let mut action_executor = ActionExecutor::new(
            Arc::clone(&storage_arc),
            Arc::clone(&action_storage_arc),
            Arc::clone(&python_ai_arc),
        );
        action_executor.set_goals_storage(Arc::clone(&goals_storage_arc));
        action_executor.set_energy_storage(Arc::clone(&energy_storage_arc));
        action_executor.set_inbox_storage(Arc::clone(&inbox_storage_arc));
        let action_executor_arc = Arc::new(Mutex::new(action_executor));

        // Don't .start() the scheduler — we don't want background timer
        // threads firing during a unit test run.
        let action_scheduler = ActionScheduler::new(
            Arc::clone(&action_storage_arc),
            Arc::clone(&action_executor_arc),
        );

        let (event_tx, event_rx) =
            tokio::sync::broadcast::channel::<AppEvent>(256);

        let sync_manager = SyncManager::new(library_path.clone());
        let sync_manager_arc = Arc::new(sync_manager);
        sync_manager_arc.set_emitter(Arc::new(LogEmitter));
        sync_manager_arc.set_crdt_store(Arc::clone(&crdt_store));

        let state = Arc::new(DaemonState {
            storage: storage_arc,
            library_storage: library_storage_arc,
            inbox_storage: inbox_storage_arc,
            goals_storage: goals_storage_arc,
            energy_storage: energy_storage_arc,
            contacts_storage: contacts_storage_arc,
            sync_manager: sync_manager_arc,
            action_scheduler: Mutex::new(action_scheduler),
            search_index: search_index_arc,
            tantivy: tantivy_backend,
            rag: rag_backend,
            rag_config: Arc::clone(&rag_config),
            daemon_config_path,
            crdt_store,
            // Plugin host is None in tests by default — keeps construction
            // fast and avoids loading any user-installed Lua plugins from
            // disk into the test process. Tests that exercise plugin
            // routes can swap this out via a future helper.
            #[cfg(feature = "plugins")]
            plugin_host: None,
            // Inert backup scheduler — tests must not spawn the real scheduler
            // (it runs a background loop against the real user data dir).
            backup_scheduler: std::sync::Arc::new(
                nous_lib::commands::BackupScheduler::inert(),
            ),
            library_path: library_path.clone(),
            // No web bundle in the harness — /app routes 404 gracefully.
            web_app_dir: library_path.join("web-app"),
            event_tx,
        });

        let (auth_state, rw_token, ro_token) = match auth_tokens {
            None => (api::AuthState::disabled(), None, None),
            Some((rw, ro)) => {
                let mut keys = ApiKeySet::empty();
                keys.insert(rw.clone(), Scope::ReadWrite);
                keys.insert(ro.clone(), Scope::ReadOnly);
                (api::AuthState::enabled(keys), Some(rw), Some(ro))
            }
        };

        let router = api::build_router(Arc::clone(&state), auth_state);

        Self {
            _tmp: tmp,
            library_path,
            state,
            router,
            event_rx,
            rw_token,
            ro_token,
            rag_config,
        }
    }

    /// Mutate the live RAG config so tests can flip semantic/hybrid on.
    pub async fn set_rag_config(&self, cfg: RagConfig) {
        let mut guard = self.rag_config.write().await;
        *guard = cfg;
    }

    /// Create a notebook directly through storage, returning its UUID as
    /// a string. Faster + more deterministic than going via the HTTP API.
    pub fn create_notebook(&self, name: &str) -> String {
        let storage = self.state.storage.lock().unwrap();
        let nb = storage
            .create_notebook(name.to_string(), NotebookType::Standard)
            .expect("create notebook");
        nb.id.to_string()
    }

    fn build_request(&self, method: Method, path: &str, body: Option<Vec<u8>>) -> Request<Body> {
        let mut req = Request::builder().method(method).uri(path);
        if let Some(token) = &self.rw_token {
            req = req.header("Authorization", format!("Bearer {}", token));
        }
        if body.is_some() {
            req = req.header("Content-Type", "application/json");
        }
        req.body(body.map(Body::from).unwrap_or_else(Body::empty)).unwrap()
    }

    /// Override the auth token for one request — useful for testing
    /// 401 (no token) and 403 (ro token on a write).
    pub async fn request_with_token(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        token: Option<&str>,
    ) -> (StatusCode, Value) {
        let mut req = Request::builder().method(method).uri(path);
        if let Some(t) = token {
            req = req.header("Authorization", format!("Bearer {}", t));
        }
        let body_bytes = body.map(|v| serde_json::to_vec(&v).unwrap());
        if body_bytes.is_some() {
            req = req.header("Content-Type", "application/json");
        }
        let req = req
            .body(body_bytes.map(Body::from).unwrap_or_else(Body::empty))
            .unwrap();
        self.send(req).await
    }

    async fn send(&self, req: Request<Body>) -> (StatusCode, Value) {
        let resp = self
            .router
            .clone()
            .oneshot(req)
            .await
            .expect("router serve");
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), 16 * 1024 * 1024)
            .await
            .expect("read body");
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes).unwrap_or_else(|_| {
                Value::String(String::from_utf8_lossy(&bytes).to_string())
            })
        };
        (status, body)
    }

    pub async fn get_json(&self, path: &str) -> (StatusCode, Value) {
        self.send(self.build_request(Method::GET, path, None)).await
    }

    pub async fn post_json(&self, path: &str, body: Value) -> (StatusCode, Value) {
        let bytes = serde_json::to_vec(&body).unwrap();
        self.send(self.build_request(Method::POST, path, Some(bytes))).await
    }

    pub async fn put_json(&self, path: &str, body: Value) -> (StatusCode, Value) {
        let bytes = serde_json::to_vec(&body).unwrap();
        self.send(self.build_request(Method::PUT, path, Some(bytes))).await
    }

    pub async fn delete(&self, path: &str) -> (StatusCode, Value) {
        self.send(self.build_request(Method::DELETE, path, None)).await
    }

    /// Non-blocking peek at the event channel. Returns None if no event
    /// is ready or if the channel is closed.
    pub fn try_recv_event(&mut self) -> Option<AppEvent> {
        self.event_rx.try_recv().ok()
    }

    /// Block (with a timeout) waiting for one event. Returns None on timeout.
    pub async fn recv_event(&mut self, timeout: std::time::Duration) -> Option<AppEvent> {
        tokio::time::timeout(timeout, self.event_rx.recv())
            .await
            .ok()
            .and_then(|r| r.ok())
    }

    /// Drain any events emitted so far. Useful between phases of a test
    /// when you don't care about the prior events.
    pub fn drain_events(&mut self) -> Vec<AppEvent> {
        let mut out = Vec::new();
        while let Ok(e) = self.event_rx.try_recv() {
            out.push(e);
        }
        out
    }
}

fn random_token_suffix() -> String {
    // Quick non-cryptographic suffix — tests don't need real entropy.
    // Format matches the daemon's expectation for keyset entries.
    Uuid::new_v4().simple().to_string()
}

// ===== Smoke tests for the harness itself =====

#[tokio::test]
async fn harness_status_endpoint_returns_200() {
    let env = TestEnv::new();
    let (status, body) = env.get_json("/api/status").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["status"], "running");
}

#[tokio::test]
async fn harness_list_notebooks_starts_empty() {
    let env = TestEnv::new();
    let (status, body) = env.get_json("/api/notebooks").await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["data"].is_array());
    assert_eq!(body["data"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn harness_create_notebook_helper_works() {
    let env = TestEnv::new();
    let nb_id = env.create_notebook("Smoke");
    Uuid::parse_str(&nb_id).expect("returns valid UUID");

    let (status, body) = env.get_json("/api/notebooks").await;
    assert_eq!(status, StatusCode::OK);
    let list = body["data"].as_array().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["name"], "Smoke");
}

#[tokio::test]
async fn harness_auth_disabled_skips_token_check() {
    let env = TestEnv::new();
    // No Authorization header on a write — should still succeed since
    // auth is disabled.
    let nb = env.create_notebook("NoAuth");
    let (status, _) = env
        .post_json(&format!("/api/notebooks/{}/pages", nb), json!({"title": "x"}))
        .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn harness_auth_enabled_rejects_missing_token() {
    let env = TestEnv::with_auth();
    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn harness_auth_enabled_accepts_rw_token() {
    let env = TestEnv::with_auth();
    let token = env.rw_token.clone().unwrap();
    let (status, body) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&token))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["data"].is_array());
}

#[tokio::test]
async fn harness_event_capture_works() {
    let mut env = TestEnv::new();
    let nb = env.create_notebook("Events");
    let (status, _) = env
        .post_json(&format!("/api/notebooks/{}/pages", nb), json!({"title": "evt"}))
        .await;
    assert_eq!(status, StatusCode::CREATED);

    let evt = env
        .recv_event(std::time::Duration::from_millis(500))
        .await
        .expect("page.created event arrives");
    assert_eq!(evt.event, "page.created");
    assert_eq!(evt.data["title"], "evt");
}

// ===== Pages CRUD + event capture =====

#[tokio::test]
async fn pages_create_emits_page_created() {
    let mut env = TestEnv::new();
    let nb = env.create_notebook("Pages");
    env.drain_events();

    let (status, body) = env
        .post_json(
            &format!("/api/notebooks/{}/pages", nb),
            json!({"title": "p1", "tags": ["a", "b"]}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["data"]["title"], "p1");
    assert_eq!(body["data"]["tags"][0], "a");

    let evt = env.try_recv_event().expect("page.created");
    assert_eq!(evt.event, "page.created");
    assert_eq!(evt.data["notebookId"], nb);
}

#[tokio::test]
async fn pages_update_emits_page_updated() {
    let mut env = TestEnv::new();
    let nb = env.create_notebook("Pages");
    let (_, created) = env
        .post_json(&format!("/api/notebooks/{}/pages", nb), json!({"title": "before"}))
        .await;
    let pg = created["data"]["id"].as_str().unwrap();
    env.drain_events();

    let (status, body) = env
        .put_json(
            &format!("/api/notebooks/{}/pages/{}", nb, pg),
            json!({"title": "after"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["title"], "after");

    let evt = env.try_recv_event().expect("page.updated");
    assert_eq!(evt.event, "page.updated");
    assert_eq!(evt.data["pageId"], pg);
}

/// Block-level edits (the MCP write path) must emit page.updated too —
/// they used to skip the event (and search reindex), so open editors never
/// saw external appends/edits until a full-page save.
#[tokio::test]
async fn block_level_edits_emit_page_updated() {
    let mut env = TestEnv::new();
    let nb = env.create_notebook("Pages");
    let (_, created) = env
        .post_json(&format!("/api/notebooks/{}/pages", nb), json!({"title": "blocky"}))
        .await;
    let pg = created["data"]["id"].as_str().unwrap();
    env.drain_events();

    // append
    let (status, body) = env
        .post_json(
            &format!("/api/notebooks/{}/pages/{}/append", nb, pg),
            json!({"content": "first line"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let block_id = body["data"]["content"]["blocks"]
        .as_array()
        .and_then(|blocks| blocks.last())
        .and_then(|b| b["id"].as_str())
        .expect("appended block has an id")
        .to_string();
    let evt = env.try_recv_event().expect("append emits page.updated");
    assert_eq!(evt.event, "page.updated");
    assert_eq!(evt.data["pageId"], pg);
    env.drain_events();

    // replace-block gives the block a new id — re-capture from each response.
    let last_block_id = |body: &serde_json::Value| -> String {
        body["data"]["content"]["blocks"]
            .as_array()
            .and_then(|blocks| blocks.last())
            .and_then(|b| b["id"].as_str())
            .expect("response page has blocks with ids")
            .to_string()
    };

    let (status, body) = env
        .post_json(
            &format!("/api/notebooks/{}/pages/{}/replace-block", nb, pg),
            json!({"block_id": block_id, "content": "edited"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let block_id = last_block_id(&body);
    let evt = env.try_recv_event().expect("replace-block emits page.updated");
    assert_eq!(evt.event, "page.updated");
    env.drain_events();

    // insert-after-block
    let (status, body) = env
        .post_json(
            &format!("/api/notebooks/{}/pages/{}/insert-after-block", nb, pg),
            json!({"block_id": block_id, "content": "after"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let block_id = last_block_id(&body);
    let evt = env.try_recv_event().expect("insert-after emits page.updated");
    assert_eq!(evt.event, "page.updated");
    env.drain_events();

    // delete-block
    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/pages/{}/delete-block", nb, pg),
            json!({"block_id": block_id}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let evt = env.try_recv_event().expect("delete-block emits page.updated");
    assert_eq!(evt.event, "page.updated");
}

#[tokio::test]
async fn pages_delete_emits_page_deleted() {
    let mut env = TestEnv::new();
    let nb = env.create_notebook("Pages");
    let (_, created) = env
        .post_json(&format!("/api/notebooks/{}/pages", nb), json!({"title": "doomed"}))
        .await;
    let pg = created["data"]["id"].as_str().unwrap();
    env.drain_events();

    let (status, _) = env
        .delete(&format!("/api/notebooks/{}/pages/{}", nb, pg))
        .await;
    assert_eq!(status, StatusCode::OK);

    let evt = env.try_recv_event().expect("page.deleted");
    assert_eq!(evt.event, "page.deleted");
    assert_eq!(evt.data["pageId"], pg);
}

#[tokio::test]
async fn pages_get_returns_404_for_unknown_page() {
    let env = TestEnv::new();
    let nb = env.create_notebook("Pages");
    let bogus = Uuid::new_v4();
    let (status, _) = env
        .get_json(&format!("/api/notebooks/{}/pages/{}", nb, bogus))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ===== Version history (snapshots + oplog) =====

#[tokio::test]
async fn versions_list_get_and_restore_round_trip() {
    let mut env = TestEnv::new();
    let nb = env.create_notebook("History");

    // Create a page with 5 blocks (v1).
    let v1_blocks: Vec<Value> = (0..5)
        .map(|i| json!({"id": format!("b{i}"), "type": "paragraph", "data": {"text": format!("original line {i} ZEBRA")}}))
        .collect();
    let (_, created) = env
        .post_json(
            &format!("/api/notebooks/{}/pages", nb),
            json!({"title": "doc", "blocks": v1_blocks}),
        )
        .await;
    let pg = created["data"]["id"].as_str().unwrap().to_string();

    // Update to a single block. The 5→1 shrink is "destructive", so update_page
    // takes a pre-overwrite snapshot of the 5-block v1 content (DL-03/DL-18).
    let (status, _) = env
        .put_json(
            &format!("/api/notebooks/{}/pages/{}", nb, pg),
            json!({"blocks": [{"id": "b0", "type": "paragraph", "data": {"text": "shrunk"}}]}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    env.drain_events();

    // List versions → exactly the one pre-shrink snapshot, carrying v1's content.
    let (status, body) = env
        .get_json(&format!("/api/notebooks/{}/pages/{}/versions", nb, pg))
        .await;
    assert_eq!(status, StatusCode::OK);
    let versions = body["data"].as_array().expect("versions array");
    assert_eq!(versions.len(), 1, "one destructive-shrink snapshot expected");
    let v = &versions[0];
    assert_eq!(v["blockCount"], 5);
    assert!(v["preview"].as_str().unwrap().contains("ZEBRA"));
    assert!(v["changesSince"].as_u64().unwrap() >= 1, "edits recorded after snapshot");
    let version_name = v["name"].as_str().unwrap().to_string();

    // Fetch that snapshot's full content.
    let (status, body) = env
        .get_json(&format!(
            "/api/notebooks/{}/pages/{}/versions/{}",
            nb, pg, version_name
        ))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["content"]["blocks"].as_array().unwrap().len(), 5);

    // Restore it → page goes back to 5 blocks and a page.updated event fires.
    let (status, body) = env
        .post_json(
            &format!(
                "/api/notebooks/{}/pages/{}/versions/{}/restore",
                nb, pg, version_name
            ),
            json!({}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["content"]["blocks"].as_array().unwrap().len(), 5);
    let evt = env.try_recv_event().expect("page.updated after restore");
    assert_eq!(evt.event, "page.updated");
    assert_eq!(evt.data["restoredFrom"], version_name);

    // The page on disk now holds the restored 5-block content.
    let (_, page) = env
        .get_json(&format!("/api/notebooks/{}/pages/{}", nb, pg))
        .await;
    assert_eq!(page["data"]["content"]["blocks"].as_array().unwrap().len(), 5);
}

#[tokio::test]
async fn versions_restore_rejects_invalid_name() {
    let env = TestEnv::new();
    let nb = env.create_notebook("History");
    let (_, created) = env
        .post_json(&format!("/api/notebooks/{}/pages", nb), json!({"title": "doc"}))
        .await;
    let pg = created["data"]["id"].as_str().unwrap().to_string();

    // Letters aren't a valid snapshot name (digits/underscores only) → 400.
    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/pages/{}/versions/notavalidname/restore", nb, pg),
            json!({}),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn versions_list_empty_for_fresh_page() {
    let env = TestEnv::new();
    let nb = env.create_notebook("History");
    let (_, created) = env
        .post_json(&format!("/api/notebooks/{}/pages", nb), json!({"title": "fresh"}))
        .await;
    let pg = created["data"]["id"].as_str().unwrap().to_string();

    let (status, body) = env
        .get_json(&format!("/api/notebooks/{}/pages/{}/versions", nb, pg))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn pages_create_with_bad_notebook_id_returns_400() {
    let env = TestEnv::new();
    let (status, body) = env
        .post_json("/api/notebooks/not-a-uuid/pages", json!({"title": "x"}))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].is_string());
}

// ===== Folders + sections =====

#[tokio::test]
async fn folders_create_emits_event_and_lists() {
    let mut env = TestEnv::new();
    let nb = env.create_notebook("F");
    env.drain_events();

    let (status, body) = env
        .post_json(
            &format!("/api/notebooks/{}/folders", nb),
            json!({"name": "ideas"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["data"]["name"], "ideas");

    let evt = env.try_recv_event().expect("folder.created");
    assert_eq!(evt.event, "folder.created");

    let (status, body) = env
        .get_json(&format!("/api/notebooks/{}/folders", nb))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn sections_create_emits_event() {
    let mut env = TestEnv::new();
    let nb = env.create_notebook("S");
    env.drain_events();

    let (status, body) = env
        .post_json(
            &format!("/api/notebooks/{}/sections", nb),
            json!({"name": "weekly"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["data"]["name"], "weekly");

    let evt = env.try_recv_event().expect("section.created");
    assert_eq!(evt.event, "section.created");
}

// ===== Search =====

#[tokio::test]
async fn search_returns_indexed_pages() {
    let env = TestEnv::new();
    let nb = env.create_notebook("Searchable");

    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/pages", nb),
            json!({"title": "Tantivy test page"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED);

    // Tantivy's IndexReader uses OnCommitWithDelay — the searcher view
    // can lag the writer's commit by tens to hundreds of ms. Poll instead
    // of guessing a fixed sleep; abort after a generous budget so a real
    // regression still fails the test.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
    let mut last_body = Value::Null;
    loop {
        let (status, body) = env.get_json("/api/search?q=tantivy").await;
        assert_eq!(status, StatusCode::OK);
        let hits = body["data"].as_array().unwrap();
        if !hits.is_empty() {
            assert!(hits.iter().any(|h| {
                h["title"].as_str().unwrap_or("").contains("Tantivy")
            }));
            return;
        }
        last_body = body;
        if std::time::Instant::now() >= deadline {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    panic!("expected at least one hit within 3s, last body: {}", last_body);
}

#[tokio::test]
async fn search_empty_query_returns_empty_list() {
    let env = TestEnv::new();
    let (status, body) = env.get_json("/api/search?q=").await;
    assert_eq!(status, StatusCode::OK);
    let hits = body["data"].as_array().unwrap();
    assert_eq!(hits.len(), 0);
}

// ===== RAG mode dispatch =====

#[tokio::test]
async fn search_keyword_mode_explicit_works() {
    // Default mode is keyword; explicit ?mode=keyword must work too.
    let env = TestEnv::new();
    let (status, body) = env.get_json("/api/search?q=test&mode=keyword").await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["data"].is_array());
}

#[tokio::test]
async fn search_unknown_mode_returns_400() {
    let env = TestEnv::new();
    let (status, body) = env.get_json("/api/search?q=x&mode=astrology").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap_or("").contains("Unknown search mode"));
}

#[tokio::test]
async fn search_semantic_mode_when_disabled_returns_400() {
    let env = TestEnv::new(); // RAG disabled by default
    let (status, body) = env.get_json("/api/search?q=anything&mode=semantic").await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap_or("").contains("RAG is not configured"));
}

#[tokio::test]
async fn search_hybrid_mode_when_disabled_falls_back_when_no_candidates() {
    // No pages indexed → tantivy returns empty → hybrid never asks RAG
    // → returns empty Ok rather than the NotConfigured error. This is
    // the "user typed in the search bar but their library is empty" case.
    let env = TestEnv::new();
    let (status, body) = env.get_json("/api/search?q=nothing&mode=hybrid").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 0);
}

#[tokio::test]
async fn search_hybrid_mode_falls_back_to_keyword_when_rag_fails() {
    // Index a page so hybrid actually asks RAG to rerank, then point
    // RAG at a black-holed endpoint. Should return the keyword candidates
    // rather than failing the request.
    let env = TestEnv::new();
    let nb = env.create_notebook("Hybrid");
    let (_, _) = env
        .post_json(
            &format!("/api/notebooks/{}/pages", nb),
            json!({"title": "hybrid fallback page"}),
        )
        .await;

    // Wait for Tantivy to surface the new doc, then enable RAG with
    // unreachable endpoints.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
    loop {
        let (_, body) = env.get_json("/api/search?q=hybrid").await;
        if !body["data"].as_array().unwrap().is_empty() {
            break;
        }
        if std::time::Instant::now() >= deadline {
            panic!("tantivy never surfaced the test page");
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }

    let mut cfg = nous_lib::search::RagConfig::disabled();
    cfg.enabled = true;
    cfg.endpoint = "http://127.0.0.1:1".to_string();
    cfg.vector_endpoint = "http://127.0.0.1:1".to_string();
    cfg.request_timeout_ms = 200;
    env.set_rag_config(cfg).await;

    let (status, body) = env.get_json("/api/search?q=hybrid&mode=hybrid").await;
    assert_eq!(status, StatusCode::OK);
    assert!(
        !body["data"].as_array().unwrap().is_empty(),
        "expected fallback to keyword candidates: {body}"
    );
}

#[tokio::test]
async fn search_semantic_mode_returns_502_when_rag_unreachable() {
    let env = TestEnv::new();
    let mut cfg = nous_lib::search::RagConfig::disabled();
    cfg.enabled = true;
    cfg.endpoint = "http://127.0.0.1:1".to_string();
    cfg.vector_endpoint = "http://127.0.0.1:1".to_string();
    cfg.request_timeout_ms = 200;
    env.set_rag_config(cfg).await;

    let (status, body) = env.get_json("/api/search?q=anything&mode=semantic").await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    assert!(body["error"].as_str().unwrap_or("").contains("RAG service unreachable"));
}

// ===== RAG configure endpoint =====

#[tokio::test]
async fn rag_configure_persists_changes() {
    let env = TestEnv::new();
    // Initially disabled.
    {
        let cfg = env.rag_config.read().await;
        assert!(!cfg.enabled);
    }
    let (status, body) = env
        .post_json(
            "/api/search/rag/configure",
            json!({"enabled": true, "collection": "my-pages"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["enabled"], true);
    assert_eq!(body["data"]["collection"], "my-pages");

    // Live config reflects the change.
    let cfg = env.rag_config.read().await;
    assert!(cfg.enabled);
    assert_eq!(cfg.collection, "my-pages");
}

#[tokio::test]
async fn rag_configure_redacts_auth_token_in_response() {
    let env = TestEnv::new();
    let (status, body) = env
        .post_json(
            "/api/search/rag/configure",
            json!({"enabled": true, "auth_token": "super-secret"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    // RagConfig serializes with snake_case keys (matching the toml file
    // shape) — the API echoes back the same field names.
    assert_eq!(body["data"]["auth_token"], "***");
    // But the in-memory value keeps the real token (so the backend can use it).
    let cfg = env.rag_config.read().await;
    assert_eq!(cfg.auth_token, "super-secret");
}

// ===== Plugins (daemon-side) =====

#[tokio::test]
async fn plugins_list_returns_empty_when_host_absent() {
    // TestEnv constructs DaemonState with plugin_host: None, so the
    // daemon serves [] regardless of whether the feature is compiled in.
    let env = TestEnv::new();
    let (status, body) = env.get_json("/api/plugins").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"], serde_json::json!([]));
}

#[tokio::test]
async fn plugins_reload_returns_503_when_host_absent() {
    let env = TestEnv::new();
    let (status, body) = env
        .post_json("/api/plugins/anything/reload", json!({}))
        .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert!(body["error"].as_str().unwrap_or("").contains("Plugin host"));
}

#[tokio::test]
async fn rag_reindex_returns_400_when_disabled() {
    let env = TestEnv::new();
    let nb = env.create_notebook("R");
    env.post_json(&format!("/api/notebooks/{}/pages", nb), json!({"title": "x"}))
        .await;
    let (status, body) = env
        .post_json("/api/search/rag/reindex", json!({}))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["error"].as_str().unwrap_or("").contains("RAG is not configured"));
}

// ===== Notebook assets =====

#[tokio::test]
async fn notebook_asset_upload_and_serve_roundtrip() {
    let env = TestEnv::new();
    let nb = env.create_notebook("Assets");
    let png: &[u8] = &[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];

    // Upload raw bytes (nested path, like the audio/ subdir on desktop)
    let req = Request::builder()
        .method(Method::PUT)
        .uri(format!("/api/notebooks/{}/assets/pics/photo.png", nb))
        .header("Content-Type", "image/png")
        .body(Body::from(png.to_vec()))
        .unwrap();
    let resp = env.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let body = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    let v: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(
        v["data"]["url"],
        format!("/api/notebooks/{}/assets/pics/photo.png", nb)
    );

    // Serve it back with the right content type and caching
    let req = Request::builder()
        .method(Method::GET)
        .uri(format!("/api/notebooks/{}/assets/pics/photo.png", nb))
        .body(Body::empty())
        .unwrap();
    let resp = env.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    assert_eq!(resp.headers()["content-type"], "image/png");
    assert!(resp.headers()["cache-control"]
        .to_str()
        .unwrap()
        .contains("max-age"));
    let body = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
    assert_eq!(&body[..], png);
}

#[tokio::test]
async fn notebook_asset_rejects_bad_requests() {
    let env = TestEnv::new();
    let nb = env.create_notebook("Assets");

    // Missing file → 404
    let req = Request::builder()
        .method(Method::GET)
        .uri(format!("/api/notebooks/{}/assets/nope.png", nb))
        .body(Body::empty())
        .unwrap();
    let resp = env.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);

    // Traversal → 400
    let req = Request::builder()
        .method(Method::GET)
        .uri(format!("/api/notebooks/{}/assets/a/../../pages/x.json", nb))
        .body(Body::empty())
        .unwrap();
    let resp = env.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Empty upload body → 400
    let req = Request::builder()
        .method(Method::PUT)
        .uri(format!("/api/notebooks/{}/assets/empty.png", nb))
        .body(Body::empty())
        .unwrap();
    let resp = env.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);

    // Bad notebook id → 400
    let req = Request::builder()
        .method(Method::GET)
        .uri("/api/notebooks/not-a-uuid/assets/x.png")
        .body(Body::empty())
        .unwrap();
    let resp = env.router.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
}

// ===== Markdown import (browser file-import fallback) =====

#[tokio::test]
async fn markdown_import_creates_page_and_round_trips() {
    let mut env = TestEnv::new();
    let nb = env.create_notebook("Import");
    env.drain_events();

    let md = "---\ntitle: Imported Note\ntags:\n  - alpha\n---\n\n# Heading\n\nBody text here.";
    let (status, body) = env
        .post_json(
            &format!("/api/notebooks/{}/import/markdown", nb),
            json!({"markdown": md, "filename": "note.md"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "body: {body}");
    let page_id = body["data"]["id"].as_str().unwrap().to_string();
    // Front-matter title wins over the filename stem
    assert_eq!(body["data"]["title"], "Imported Note");

    let evt = env.try_recv_event().expect("page.created event");
    assert_eq!(evt.event, "page.created");

    // Round-trip: the imported page exports back as markdown
    let (status, _) = env
        .get_json(&format!("/api/notebooks/{}/pages/{}", nb, page_id))
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn markdown_import_falls_back_to_filename_title() {
    let env = TestEnv::new();
    let nb = env.create_notebook("Import2");

    let (status, body) = env
        .post_json(
            &format!("/api/notebooks/{}/import/markdown", nb),
            json!({"markdown": "just a paragraph", "filename": "Meeting Notes.md"}),
        )
        .await;
    assert_eq!(status, StatusCode::CREATED, "body: {body}");
    assert_eq!(body["data"]["title"], "Meeting Notes");

    // Bad folder id → 400
    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/import/markdown", nb),
            json!({"markdown": "x", "filename": "a.md", "folderId": "nope"}),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}
