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

use nous_lib::events::AppEvent;
use nous_lib::python_bridge::PythonAI;
use nous_lib::search::{RagBackend, RagConfig};
use nous_lib::storage::NotebookType;
use nous_lib::sync::{LogEmitter, SyncManager};
use tokio::sync::RwLock;

use super::api;
use super::auth::{ApiKeySet, Scope};
use super::daemon::DaemonState;
use super::tenant::{TenantBuildOpts, TenantManager, TenantState};
use super::tenants::{ReloadingRegistry, TenantRegistry, User, UserRole, UserStatus};

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
    /// PAT of a not-yet-activated (invited) user — multi-user envs only.
    pub invited_token: Option<String>,
    /// Live handle to the RAG config — mutate for semantic-mode tests.
    pub rag_config: Arc<RwLock<RagConfig>>,
}

/// Fixed session-cookie signing key for multi-user test envs — lets
/// tests mint their own (expired/tampered) cookies.
const TEST_SESSION_KEY: [u8; 32] = [7u8; 32];

/// How [`TestEnv::build`] configures authentication.
enum AuthSetup {
    Disabled,
    /// Legacy shared key file (rw, ro).
    Keys(String, String),
    /// Tenant-registry PATs (multi-user mode). `oidc` adds a
    /// static-key OIDC verifier (fixtures from `oidc::test_jwt`).
    MultiUser { oidc: bool },
}

impl TestEnv {
    /// Build an env with auth disabled. Most happy-path tests want this.
    pub fn new() -> Self {
        Self::build(AuthSetup::Disabled)
    }

    /// Build an env with auth enabled. Returns generated `rw` and `ro`
    /// tokens via `env.rw_token` / `env.ro_token`.
    pub fn with_auth() -> Self {
        let rw = format!("rw:{}", random_token_suffix());
        let ro = format!("ro:{}", random_token_suffix());
        Self::build(AuthSetup::Keys(rw, ro))
    }

    /// Build an env in multi-user mode: a tenant registry seeded with an
    /// active user "alice@example.org" (whose rw/ro PATs land in
    /// `env.rw_token` / `env.ro_token`) plus an invited (not yet active)
    /// user whose PAT lands in `env.invited_token`. The registry file
    /// lives at `{library_path}/tenants.json` for out-of-band edits.
    pub fn with_multi_user() -> Self {
        Self::build(AuthSetup::MultiUser { oidc: false })
    }

    /// Multi-user env with an OIDC verifier holding the static test key
    /// set — sign JWTs with `oidc::test_jwt::{valid_claims, sign}`.
    /// Registry seed is the same as [`Self::with_multi_user`]:
    /// active alice@example.org (no linked subject) and invited
    /// newbie@example.org.
    pub fn with_multi_user_oidc() -> Self {
        Self::build(AuthSetup::MultiUser { oidc: true })
    }

    fn build(auth_setup: AuthSetup) -> Self {
        let tmp = tempfile::tempdir().expect("create tempdir");
        let library_path = tmp.path().to_path_buf();

        // PythonAI is constructed lazily — passing a placeholder path is
        // safe because tests don't exercise Python-backed flows.
        let python_ai_arc = Arc::new(Mutex::new(PythonAI::new(PathBuf::from("nous-py"))));

        let (event_tx, event_rx) =
            tokio::sync::broadcast::channel::<AppEvent>(256);

        // The owner tenant, exactly as the daemon builds it — hosted()
        // opts skip what tests must not have running: no scheduler
        // thread, no Lua plugins.
        let owner = TenantState::build_at(
            library_path.clone(),
            library_path.clone(),
            Arc::clone(&python_ai_arc),
            event_tx.clone(),
            TenantBuildOpts::hosted(),
        )
        .expect("owner tenant build");

        // RAG (disabled by default — tests opt in by mutating
        // env.rag_config before sending requests).
        let rag_config = Arc::new(RwLock::new(RagConfig::disabled()));
        let rag_backend = Arc::new(RagBackend::new(Arc::clone(&rag_config)));
        let daemon_config_path = library_path.join("daemon-config.toml");

        let sync_manager = SyncManager::new(library_path.clone());
        let sync_manager_arc = Arc::new(sync_manager);
        sync_manager_arc.set_emitter(Arc::new(LogEmitter));
        sync_manager_arc.set_crdt_store(Arc::clone(&owner.crdt_store));

        // Auth before DaemonState so the multi-user context can be shared
        // between the middleware and the session handlers (same shape as
        // the real daemon boot).
        let (auth_state, multi_user_ctx, owner_user_id, rw_token, ro_token, invited_token) =
            match auth_setup {
                AuthSetup::Disabled => (api::AuthState::disabled(), None, None, None, None, None),
                AuthSetup::Keys(rw, ro) => {
                    let mut keys = ApiKeySet::empty();
                    keys.insert(rw.clone(), Scope::ReadWrite);
                    keys.insert(ro.clone(), Scope::ReadOnly);
                    (api::AuthState::enabled(keys), None, None, Some(rw), Some(ro), None)
                }
                AuthSetup::MultiUser { oidc } => {
                    let registry_path = library_path.join("tenants.json");
                    let mut reg = TenantRegistry::load(&registry_path).expect("registry load");

                    // Alice is the OWNER: pinned to the harness's seeded
                    // library, matching the daemon's oldest-owner rule.
                    let alice = User::new_invited("alice@example.org", UserRole::Owner);
                    let alice_id = alice.id.clone();
                    reg.insert(alice).expect("insert alice");
                    reg.update(&alice_id, |u| u.status = UserStatus::Active)
                        .expect("activate alice");
                    let rw = reg
                        .mint_token(&alice_id, "rw", Scope::ReadWrite)
                        .expect("mint rw");
                    let ro = reg
                        .mint_token(&alice_id, "ro", Scope::ReadOnly)
                        .expect("mint ro");

                    let invited = User::new_invited("newbie@example.org", UserRole::Member);
                    let invited_id = invited.id.clone();
                    reg.insert(invited).expect("insert invited");
                    let inv = reg
                        .mint_token(&invited_id, "onboarding", Scope::ReadWrite)
                        .expect("mint invited");

                    reg.save().expect("registry save");
                    let handle = ReloadingRegistry::open(&registry_path).expect("registry open");
                    let ctx = super::session::MultiUserCtx {
                        session_key: TEST_SESSION_KEY,
                        registry: Arc::new(Mutex::new(handle)),
                        oidc: oidc.then(|| Arc::new(super::oidc::test_jwt::verifier())),
                    };
                    (
                        api::AuthState::multi_user(ctx.clone()),
                        Some(ctx),
                        Some(alice_id),
                        Some(rw.token),
                        Some(ro.token),
                        Some(inv.token),
                    )
                }
            };

        let tenants = Arc::new(TenantManager::new(
            library_path.clone(),
            Arc::clone(&owner),
            owner_user_id,
            Arc::clone(&python_ai_arc),
        ));

        let state = Arc::new(DaemonState {
            storage: Arc::clone(&owner.storage),
            library_storage: Arc::clone(&owner.library_storage),
            inbox_storage: Arc::clone(&owner.inbox_storage),
            goals_storage: Arc::clone(&owner.goals_storage),
            energy_storage: Arc::clone(&owner.energy_storage),
            contacts_storage: Arc::clone(&owner.contacts_storage),
            sync_manager: sync_manager_arc,
            action_scheduler: Arc::clone(&owner.action_scheduler),
            search_index: Arc::clone(&owner.search_index),
            tantivy: Arc::clone(&owner.tantivy),
            rag: rag_backend,
            rag_config: Arc::clone(&rag_config),
            ai_config: Arc::new(RwLock::new(Default::default())),
            daemon_config_path,
            crdt_store: Arc::clone(&owner.crdt_store),
            // hosted() build opts → no plugin host in tests (keeps
            // construction fast, no user Lua loaded into the test
            // process).
            #[cfg(feature = "plugins")]
            plugin_host: owner.plugin_host.clone(),
            // Inert backup scheduler — tests must not spawn the real scheduler
            // (it runs a background loop against the real user data dir).
            backup_scheduler: std::sync::Arc::new(
                nous_lib::commands::BackupScheduler::inert(),
            ),
            library_path: library_path.clone(),
            // Placeholder-path bridge (see note above) — /api/ai routes
            // exercised in tests return clean 500s instead of results.
            python_ai: Arc::clone(&python_ai_arc),
            // No web bundle in the harness — /app routes 404 gracefully.
            web_app_dir: library_path.join("web-app"),
            multi_user: multi_user_ctx,
            tenants,
            event_tx,
        });

        let router = api::build_router(Arc::clone(&state), auth_state);

        Self {
            _tmp: tmp,
            library_path,
            state,
            router,
            event_rx,
            rw_token,
            ro_token,
            invited_token,
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

    /// Request authenticated by a session cookie instead of a bearer
    /// token (multi-user envs). Returns the response plus any Set-Cookie
    /// header value.
    pub async fn request_with_cookie(
        &self,
        method: Method,
        path: &str,
        body: Option<Value>,
        cookie: Option<&str>,
    ) -> (StatusCode, Value, Option<String>) {
        let mut req = Request::builder().method(method).uri(path);
        if let Some(c) = cookie {
            req = req.header("Cookie", format!("nous_session={c}"));
        }
        let body_bytes = body.map(|v| serde_json::to_vec(&v).unwrap());
        if body_bytes.is_some() {
            req = req.header("Content-Type", "application/json");
        }
        let req = req
            .body(body_bytes.map(Body::from).unwrap_or_else(Body::empty))
            .unwrap();

        let resp = self.router.clone().oneshot(req).await.expect("router serve");
        let status = resp.status();
        let set_cookie = resp
            .headers()
            .get("set-cookie")
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let bytes = to_bytes(resp.into_body(), 16 * 1024 * 1024)
            .await
            .expect("read body");
        let body = if bytes.is_empty() {
            Value::Null
        } else {
            serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).to_string()))
        };
        (status, body, set_cookie)
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

// ===== AI endpoints =====
//
// The harness bridge points at a placeholder Python path, so AI calls fail
// inside PyO3 — these tests pin down that failures surface as clean 500
// error envelopes (never panics/hangs) and that auth scoping applies.

#[tokio::test]
async fn ai_chat_returns_clean_error_without_python() {
    let env = TestEnv::new();
    let (status, body) = env
        .post_json(
            "/api/ai/chat",
            json!({"messages": [{"role": "user", "content": "hi"}], "providerType": "openai"}),
        )
        .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "body: {body}");
    assert!(body["error"].as_str().unwrap_or("").contains("AI chat"));
}

#[tokio::test]
async fn ai_suggest_tags_returns_clean_error_without_python() {
    let env = TestEnv::new();
    let (status, body) = env
        .post_json("/api/ai/suggest-tags", json!({"content": "some text"}))
        .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "body: {body}");
    assert!(body["error"].as_str().unwrap_or("").contains("AI suggest tags"));
}

#[tokio::test]
async fn ai_chat_stream_errors_before_stream_without_python() {
    // chat_with_tools_stream spawns its Python thread and streams failures
    // as error events, OR fails fast at setup — either way the request must
    // terminate (no hang) and not panic.
    let env = TestEnv::new();
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/ai/chat-stream")
        .header("Content-Type", "application/json")
        .body(Body::from(
            serde_json::to_vec(&json!({"userMessage": "hi"})).unwrap(),
        ))
        .unwrap();
    let resp = tokio::time::timeout(
        std::time::Duration::from_secs(30),
        env.router.clone().oneshot(req),
    )
    .await
    .expect("stream request must not hang")
    .unwrap();

    if resp.status() == StatusCode::OK {
        // SSE stream — must contain an error event and then end.
        assert_eq!(
            resp.headers()["content-type"].to_str().unwrap(),
            "text/event-stream"
        );
        let bytes = to_bytes(resp.into_body(), 1024 * 1024).await.unwrap();
        let text = String::from_utf8_lossy(&bytes);
        assert!(text.contains("\"error\""), "stream body: {text}");
    } else {
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
    }
}

#[tokio::test]
async fn ai_routes_require_write_scope() {
    let env = TestEnv::with_auth();
    let ro = env.ro_token.clone().unwrap();
    let rw = env.rw_token.clone().unwrap();

    // No token → 401
    let (status, _) = env
        .request_with_token(Method::POST, "/api/ai/chat", Some(json!({"messages": []})), None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Read-only token → 403 (POST is a write method)
    let (status, _) = env
        .request_with_token(
            Method::POST,
            "/api/ai/chat",
            Some(json!({"messages": []})),
            Some(&ro),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // RW token passes auth (then fails in the bridge → 500, not 401/403)
    let (status, _) = env
        .request_with_token(
            Method::POST,
            "/api/ai/chat",
            Some(json!({"messages": []})),
            Some(&rw),
        )
        .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

// ===== AI provider config (daemon-side credentials) =====

#[tokio::test]
async fn ai_configure_persists_and_redacts() {
    let env = TestEnv::new();

    // Configure a provider
    let (status, body) = env
        .post_json(
            "/api/ai/configure",
            json!({"providers": {"openai": {
                "apiKey": "rw:router-secret",
                "baseUrl": "http://localhost:4010/v1",
                "defaultModel": "auto-free"
            }}}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "body: {body}");
    // Echo is sanitized — never the key
    assert_eq!(body["data"]["providers"]["openai"]["api_key"], "***");
    assert_eq!(
        body["data"]["providers"]["openai"]["base_url"],
        "http://localhost:4010/v1"
    );

    // GET is redacted too
    let (status, body) = env.get_json("/api/ai/config").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["providers"]["openai"]["api_key"], "***");
    let raw = serde_json::to_string(&body).unwrap();
    assert!(!raw.contains("router-secret"), "key leaked: {raw}");

    // Persisted to daemon-config.toml with the real key on disk (0600)
    let on_disk = std::fs::read_to_string(&env.state.daemon_config_path).unwrap();
    assert!(on_disk.contains("router-secret"));
    assert!(on_disk.contains("[ai.providers.openai]"));

    // Partial update: change model only; key survives
    let (status, _) = env
        .post_json(
            "/api/ai/configure",
            json!({"providers": {"openai": {"defaultModel": "auto"}}}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let live = env.state.ai_config.read().await;
    let p = &live.providers["openai"];
    assert_eq!(p.api_key.as_deref(), Some("rw:router-secret"));
    assert_eq!(p.default_model.as_deref(), Some("auto"));
    drop(live);

    // Empty string clears a field; clearing everything removes the provider
    let (status, body) = env
        .post_json(
            "/api/ai/configure",
            json!({"providers": {"openai": {"apiKey": "", "baseUrl": "", "defaultModel": ""}}}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["data"]["providers"].get("openai").is_none(), "body: {body}");
}

#[tokio::test]
async fn ai_config_survives_rag_configure() {
    // rag_configure persists the whole DaemonConfig — it must not wipe [ai].
    let env = TestEnv::new();
    let (status, _) = env
        .post_json(
            "/api/ai/configure",
            json!({"providers": {"openai": {"apiKey": "keep-me"}}}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, _) = env
        .post_json("/api/search/rag/configure", json!({"collection": "other"}))
        .await;
    assert_eq!(status, StatusCode::OK);

    let on_disk = std::fs::read_to_string(&env.state.daemon_config_path).unwrap();
    assert!(on_disk.contains("keep-me"), "rag_configure wiped [ai]: {on_disk}");
    assert!(on_disk.contains("collection = \"other\""));
}

#[tokio::test]
async fn ai_requests_fall_back_to_daemon_credentials() {
    // With the placeholder Python bridge the call still fails, but the
    // failure path proves the request passed daemon-config resolution
    // (and precedence lives in nous_lib::ai_config unit tests).
    let env = TestEnv::new();
    let (status, _) = env
        .post_json(
            "/api/ai/configure",
            json!({"providers": {"openai": {"apiKey": "daemon-key"}}}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);

    let (status, body) = env
        .post_json("/api/ai/chat", json!({"messages": [{"role": "user", "content": "hi"}]}))
        .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    // Clean bridge error — not a config/validation error
    assert!(body["error"].as_str().unwrap_or("").contains("AI chat"));
}

// ─── Publish to Nous (daemon HTTP endpoint) ─────────────────────────────────

const FAKE_PAGE_ID: &str = "11111111-1111-1111-1111-111111111111";

#[tokio::test]
async fn publish_nous_rejects_missing_token() {
    let env = TestEnv::with_auth();
    let nb = env.create_notebook("pub-nb");
    let (status, _) = env
        .request_with_token(
            Method::POST,
            &format!("/api/notebooks/{}/pages/{}/publish-nous", nb, FAKE_PAGE_ID),
            Some(json!({"theme": "minimal", "expiry": "never"})),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn publish_nous_unknown_page_404() {
    let env = TestEnv::new();
    let nb = env.create_notebook("pub-nb");
    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/pages/{}/publish-nous", nb, FAKE_PAGE_ID),
            json!({"theme": "minimal", "expiry": "never"}),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn publish_nous_bad_expiry_400() {
    let env = TestEnv::new();
    let nb = env.create_notebook("pub-nb");
    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/pages/{}/publish-nous", nb, FAKE_PAGE_ID),
            json!({"theme": "minimal", "expiry": "bogus"}),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ─── Publish folder/section/notebook mini-sites to Nous ─────────────────────

const FAKE_ID: &str = "22222222-2222-2222-2222-222222222222";

#[tokio::test]
async fn publish_folder_nous_rejects_missing_token() {
    let env = TestEnv::with_auth();
    let nb = env.create_notebook("pub-nb");
    let (status, _) = env
        .request_with_token(
            Method::POST,
            &format!("/api/notebooks/{}/folders/{}/publish-nous", nb, FAKE_ID),
            Some(json!({"theme": "minimal", "expiry": "never"})),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn publish_folder_nous_unknown_folder_404() {
    let env = TestEnv::new();
    let nb = env.create_notebook("pub-nb");
    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/folders/{}/publish-nous", nb, FAKE_ID),
            json!({"theme": "minimal", "expiry": "never"}),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn publish_folder_nous_bad_expiry_400() {
    let env = TestEnv::new();
    let nb = env.create_notebook("pub-nb");
    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/folders/{}/publish-nous", nb, FAKE_ID),
            json!({"theme": "minimal", "expiry": "bogus"}),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn publish_section_nous_unknown_section_404() {
    let env = TestEnv::new();
    let nb = env.create_notebook("pub-nb");
    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/sections/{}/publish-nous", nb, FAKE_ID),
            json!({"theme": "minimal", "expiry": "never"}),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn publish_section_nous_bad_expiry_400() {
    let env = TestEnv::new();
    let nb = env.create_notebook("pub-nb");
    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/sections/{}/publish-nous", nb, FAKE_ID),
            json!({"theme": "minimal", "expiry": "bogus"}),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn publish_notebook_nous_rejects_missing_token() {
    let env = TestEnv::with_auth();
    let nb = env.create_notebook("pub-nb");
    let (status, _) = env
        .request_with_token(
            Method::POST,
            &format!("/api/notebooks/{}/publish-nous", nb),
            Some(json!({"theme": "minimal", "expiry": "never"})),
            None,
        )
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn publish_notebook_nous_unknown_notebook_404() {
    let env = TestEnv::new();
    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/publish-nous", FAKE_ID),
            json!({"theme": "minimal", "expiry": "never"}),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn publish_notebook_nous_bad_expiry_400() {
    let env = TestEnv::new();
    let nb = env.create_notebook("pub-nb");
    let (status, _) = env
        .post_json(
            &format!("/api/notebooks/{}/publish-nous", nb),
            json!({"theme": "minimal", "expiry": "bogus"}),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
}

// ===== Multi-user auth middleware =====

#[tokio::test]
async fn multi_user_rejects_missing_and_malformed_credentials() {
    let env = TestEnv::with_multi_user();

    // No credential.
    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Garbage PAT.
    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some("nous_definitely_wrong"))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Non-PAT bearer (JWT-shaped) — OIDC is not configured yet.
    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some("eyJhbGciOi.payload.sig"))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Legacy shared keys are retired in multi-user mode.
    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some("rw:legacykey"))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Public route stays open without credentials.
    let (status, _) = env
        .request_with_token(Method::GET, "/api/status", None, None)
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn multi_user_valid_pat_authenticates_and_scope_enforces() {
    let env = TestEnv::with_multi_user();
    let rw = env.rw_token.clone().unwrap();
    let ro = env.ro_token.clone().unwrap();

    // rw reads and writes.
    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&rw))
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = env
        .request_with_token(
            Method::POST,
            "/api/notebooks",
            Some(json!({"name": "MU Notebook"})),
            Some(&rw),
        )
        .await;
    assert!(status.is_success(), "rw create failed: {status} {body}");

    // ro reads but cannot write.
    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&ro))
        .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _) = env
        .request_with_token(
            Method::POST,
            "/api/notebooks",
            Some(json!({"name": "Denied"})),
            Some(&ro),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);

    // ?token= query form (WebSocket clients can't set headers).
    let (status, _) = env
        .request_with_token(Method::GET, &format!("/api/notebooks?token={rw}"), None, None)
        .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn multi_user_invited_pat_rejected_until_active() {
    let env = TestEnv::with_multi_user();
    let inv = env.invited_token.clone().unwrap();
    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&inv))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn multi_user_registry_reload_kills_disabled_user() {
    let env = TestEnv::with_multi_user();
    let rw = env.rw_token.clone().unwrap();
    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&rw))
        .await;
    assert_eq!(status, StatusCode::OK);

    // Disable alice out-of-band, exactly as the admin CLI would. The
    // running daemon must pick it up via the mtime-based reload — no
    // restart, next request dies.
    let registry_path = env.library_path.join("tenants.json");
    let mut reg = TenantRegistry::load(&registry_path).expect("load registry");
    let alice_id = reg
        .find_by_email("alice@example.org")
        .expect("alice exists")
        .id
        .clone();
    reg.update(&alice_id, |u| u.status = UserStatus::Disabled)
        .expect("disable alice");
    reg.save().expect("save registry");

    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&rw))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ===== OIDC JWT sessions (multi-user mode) =====

#[tokio::test]
async fn oidc_invited_jwt_activates_and_authenticates_end_to_end() {
    use super::oidc::test_jwt::{sign, valid_claims};

    let env = TestEnv::with_multi_user_oidc();
    let token = sign(
        &valid_claims("zitadel|web", Some("newbie@example.org"), Some("newbie")),
        "test-key",
    );

    // First request: invite claimed — subject linked, user activated.
    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&token))
        .await;
    assert_eq!(status, StatusCode::OK);

    // JWTs act as the user with full rights — writes allowed.
    let (status, body) = env
        .request_with_token(
            Method::POST,
            "/api/notebooks",
            Some(json!({"name": "Via OIDC"})),
            Some(&token),
        )
        .await;
    assert!(status.is_success(), "OIDC write failed: {status} {body}");

    // Activation persisted: subject linked, active, username claimed,
    // tenant dir created.
    let reg = TenantRegistry::load(&env.library_path.join("tenants.json")).unwrap();
    let user = reg.find_by_subject("zitadel|web").expect("subject linked");
    assert_eq!(user.email, "newbie@example.org");
    assert_eq!(user.status, UserStatus::Active);
    assert_eq!(user.username.as_deref(), Some("newbie"));
    assert!(env
        .library_path
        .join("tenants")
        .join(&user.id)
        .is_dir());
}

#[tokio::test]
async fn oidc_uninvited_and_takeover_jwts_get_friendly_403() {
    use super::oidc::test_jwt::{sign, valid_claims};

    let env = TestEnv::with_multi_user_oidc();

    // Complete stranger → 403 "invite required".
    let token = sign(
        &valid_claims("zitadel|nope", Some("stranger@example.org"), None),
        "test-key",
    );
    let (status, body) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&token))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["error"], "forbidden");
    assert_eq!(body["message"], "invite required");

    // Alice is active with NO linked subject — a matching email claim
    // from an unknown subject must not take her account over.
    let token = sign(
        &valid_claims("zitadel|attacker", Some("alice@example.org"), None),
        "test-key",
    );
    let (status, body) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&token))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "invite required");
    let reg = TenantRegistry::load(&env.library_path.join("tenants.json")).unwrap();
    assert_eq!(
        reg.find_by_email("alice@example.org").unwrap().external_subject,
        None,
        "takeover attempt must not link a subject"
    );
}

#[tokio::test]
async fn oidc_expired_jwt_is_plain_401() {
    use super::oidc::test_jwt::{sign, valid_claims};

    let env = TestEnv::with_multi_user_oidc();
    let mut claims = valid_claims("zitadel|web", Some("newbie@example.org"), None);
    claims.exp = chrono::Utc::now().timestamp() - 3600;
    let (status, _) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&sign(&claims, "test-key")))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

// ===== Browser sessions (cookie auth) =====

/// POST /api/session with a signed ID token; returns (status, body, cookie value).
async fn login_with_id_token(env: &TestEnv, id_token: &str) -> (StatusCode, Value, Option<String>) {
    let (status, body, set_cookie) = env
        .request_with_cookie(
            Method::POST,
            "/api/session",
            Some(json!({ "idToken": id_token })),
            None,
        )
        .await;
    let cookie = set_cookie
        .as_deref()
        .and_then(|s| s.split(';').next())
        .and_then(|s| s.strip_prefix("nous_session="))
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    (status, body, cookie)
}

#[tokio::test]
async fn session_login_cookie_and_me_round_trip() {
    use super::oidc::test_jwt::{sign, valid_claims};

    let env = TestEnv::with_multi_user_oidc();
    let token = sign(
        &valid_claims("zitadel|cookie", Some("newbie@example.org"), Some("newbie")),
        "test-key",
    );

    // Login: activates the invited user, returns the me-payload + cookie.
    let (status, body, cookie) = login_with_id_token(&env, &token).await;
    assert_eq!(status, StatusCode::OK);
    let cookie = cookie.expect("session cookie set");
    assert_eq!(body["status"], "active");
    assert_eq!(body["username"], "newbie");

    // Cookie authenticates /api/me and normal data routes (full rights).
    let (status, me, _) = env
        .request_with_cookie(Method::GET, "/api/me", None, Some(&cookie))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["userId"], body["userId"]);

    let (status, _, _) = env
        .request_with_cookie(
            Method::POST,
            "/api/notebooks",
            Some(json!({"name": "Via Cookie"})),
            Some(&cookie),
        )
        .await;
    assert!(status.is_success(), "cookie-authed write failed: {status}");

    // No cookie, no bearer → 401 on authed routes.
    let (status, _, _) = env
        .request_with_cookie(Method::GET, "/api/me", None, None)
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn session_login_rejects_bad_tokens_and_uninvited() {
    use super::oidc::test_jwt::{sign, valid_claims};

    let env = TestEnv::with_multi_user_oidc();

    // Garbage ID token → 401, no cookie.
    let (status, _, cookie) = login_with_id_token(&env, "not.a.jwt").await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(cookie.is_none());

    // Valid token for an uninvited subject → friendly 403, no cookie.
    let token = sign(
        &valid_claims("zitadel|stranger", Some("stranger@example.org"), None),
        "test-key",
    );
    let (status, body, cookie) = login_with_id_token(&env, &token).await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body["message"], "invite required");
    assert!(cookie.is_none());
}

#[tokio::test]
async fn tampered_and_expired_cookies_are_rejected() {
    let env = TestEnv::with_multi_user();
    let now = chrono::Utc::now().timestamp();

    // Forge a cookie for alice with the *right* key but expired.
    let reg = TenantRegistry::load(&env.library_path.join("tenants.json")).unwrap();
    let alice_id = reg.find_by_email("alice@example.org").unwrap().id.clone();
    let expired = super::session::mint_cookie_value(&TEST_SESSION_KEY, &alice_id, now - 10);
    let (status, _, _) = env
        .request_with_cookie(Method::GET, "/api/me", None, Some(&expired))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // Valid expiry but tampered signature.
    let good = super::session::mint_cookie_value(&TEST_SESSION_KEY, &alice_id, now + 3600);
    let mut tampered = good.clone();
    let flip = if tampered.ends_with('0') { '1' } else { '0' };
    tampered.pop();
    tampered.push(flip);
    let (status, _, _) = env
        .request_with_cookie(Method::GET, "/api/me", None, Some(&tampered))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    // The untampered one works (PAT-only env: cookies still valid — the
    // signing key exists independently of OIDC).
    let (status, me, _) = env
        .request_with_cookie(Method::GET, "/api/me", None, Some(&good))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(me["userId"], Value::String(alice_id));
}

#[tokio::test]
async fn disabling_a_user_kills_their_live_session() {
    let env = TestEnv::with_multi_user();
    let now = chrono::Utc::now().timestamp();

    let registry_path = env.library_path.join("tenants.json");
    let reg = TenantRegistry::load(&registry_path).unwrap();
    let alice_id = reg.find_by_email("alice@example.org").unwrap().id.clone();
    let cookie = super::session::mint_cookie_value(&TEST_SESSION_KEY, &alice_id, now + 3600);

    let (status, _, _) = env
        .request_with_cookie(Method::GET, "/api/me", None, Some(&cookie))
        .await;
    assert_eq!(status, StatusCode::OK);

    // Disable out-of-band (as the CLI would): the still-valid cookie must
    // die on the very next request via the per-request status re-check.
    let mut reg = TenantRegistry::load(&registry_path).unwrap();
    reg.update(&alice_id, |u| u.status = UserStatus::Disabled).unwrap();
    reg.save().unwrap();

    let (status, _, _) = env
        .request_with_cookie(Method::GET, "/api/me", None, Some(&cookie))
        .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn logout_clears_cookie_and_config_reports_oidc() {
    let env = TestEnv::with_multi_user_oidc();

    // Logout is public and clears the cookie client-side.
    let (status, _, set_cookie) = env
        .request_with_cookie(Method::DELETE, "/api/session", None, None)
        .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let set_cookie = set_cookie.expect("clearing Set-Cookie present");
    assert!(set_cookie.starts_with("nous_session=;"), "got: {set_cookie}");
    assert!(set_cookie.contains("Max-Age=0"));

    // Config advertises the issuer + client id for the SPA.
    let (status, body, _) = env
        .request_with_cookie(Method::GET, "/api/session/config", None, None)
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["issuer"], super::oidc::test_jwt::ISSUER);
    assert_eq!(body["clientId"], super::oidc::test_jwt::CLIENT_ID);

    // Without OIDC configured, config 404s so the SPA can say "sign-in
    // unavailable".
    let plain = TestEnv::with_multi_user();
    let (status, _, _) = plain
        .request_with_cookie(Method::GET, "/api/session/config", None, None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Legacy mode: session surface doesn't exist meaningfully.
    let legacy = TestEnv::new();
    let (status, _, _) = legacy
        .request_with_cookie(Method::GET, "/api/session/config", None, None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _, _) = legacy
        .request_with_cookie(Method::GET, "/api/me", None, None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn auth_callback_route_is_public_in_multi_user_mode() {
    // The OIDC redirect target must never require credentials — the whole
    // point is that an unauthenticated browser lands there. (404 here:
    // the harness deploys no web bundle; the assertion is that auth
    // does not intercept with a 401.)
    let env = TestEnv::with_multi_user_oidc();
    let (status, _, _) = env
        .request_with_cookie(Method::GET, "/auth/callback", None, None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

// ===== Tenant extractor (sweep contract) =====

/// A one-route probe router using the `Tenant` extractor, sharing the
/// env's DaemonState — what every swept handler will do.
fn tenant_probe_router(env: &TestEnv) -> Router {
    use super::tenant::Tenant;
    Router::new()
        .route(
            "/probe",
            axum::routing::get(|tenant: Tenant| async move {
                tenant.library_path.display().to_string()
            }),
        )
        .with_state(Arc::clone(&env.state))
}

async fn probe(router: &Router, user: Option<super::auth::AuthedUser>) -> String {
    let mut req = Request::builder().uri("/probe");
    if let Some(u) = user {
        req = req.extension(u);
    }
    let resp = router
        .clone()
        .oneshot(req.body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(resp.status(), StatusCode::OK);
    let bytes = to_bytes(resp.into_body(), 1 << 20).await.unwrap();
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[tokio::test]
async fn tenant_extractor_falls_back_to_owner_without_authed_user() {
    // Legacy single-user mode: no AuthedUser extension → owner tenant,
    // which is the env's library.
    let env = TestEnv::new();
    let path = probe(&tenant_probe_router(&env), None).await;
    assert_eq!(path, env.library_path.display().to_string());
}

#[tokio::test]
async fn tenant_extractor_maps_owner_and_lazily_builds_members() {
    use super::auth::AuthedUser;
    use super::auth::Scope;
    use super::tenants::UserRole;

    let env = TestEnv::with_multi_user();
    let router = tenant_probe_router(&env);
    let reg = TenantRegistry::load(&env.library_path.join("tenants.json")).unwrap();
    let alice_id = reg.find_by_email("alice@example.org").unwrap().id.clone();
    let newbie_id = reg.find_by_email("newbie@example.org").unwrap().id.clone();

    // Alice is the owner → the seeded library, no lazy build.
    let alice_path = probe(
        &router,
        Some(AuthedUser {
            user_id: alice_id,
            role: UserRole::Owner,
            scope: Scope::ReadWrite,
        }),
    )
    .await;
    assert_eq!(alice_path, env.library_path.display().to_string());
    assert_eq!(env.state.tenants.lazy_count(), 0);

    // Newbie → a lazily built tenant under {data}/tenants/{id}, stable
    // across requests.
    let newbie_user = AuthedUser {
        user_id: newbie_id.clone(),
        role: UserRole::Member,
        scope: Scope::ReadWrite,
    };
    let newbie_path = probe(&router, Some(newbie_user.clone())).await;
    assert_ne!(newbie_path, alice_path);
    assert!(newbie_path.contains(&format!("tenants/{newbie_id}")));
    assert_eq!(env.state.tenants.lazy_count(), 1);

    let again = probe(&router, Some(newbie_user)).await;
    assert_eq!(again, newbie_path);
    assert_eq!(env.state.tenants.lazy_count(), 1);

    // The lazy tenant's tree exists on disk with its own search index.
    let newbie_root = env.library_path.join("tenants").join(&newbie_id);
    assert!(newbie_root.is_dir());
}

#[tokio::test]
async fn swept_routes_isolate_tenants_end_to_end() {
    // The first end-to-end isolation proof through real routes: alice
    // (owner) and newbie (member) each see only their own data on the
    // swept notebook/page routes.
    let env = TestEnv::with_multi_user();
    let alice_pat = env.rw_token.clone().unwrap();
    let newbie_pat = env.invited_token.clone().unwrap();

    // Alice creates a notebook + page in the owner library.
    let (status, nb) = env
        .request_with_token(
            Method::POST,
            "/api/notebooks",
            Some(json!({"name": "Alice Notebook"})),
            Some(&alice_pat),
        )
        .await;
    assert!(status.is_success(), "alice create nb: {status} {nb}");
    let nb_id = nb["data"]["id"].as_str().expect("nb id").to_string();
    let (status, page) = env
        .request_with_token(
            Method::POST,
            &format!("/api/notebooks/{nb_id}/pages"),
            Some(json!({"title": "Alice Secret"})),
            Some(&alice_pat),
        )
        .await;
    assert!(status.is_success(), "alice create page: {status} {page}");
    let page_id = page["data"]["id"].as_str().expect("page id").to_string();

    // Activate newbie out-of-band (as the admin CLI would); his PAT now
    // authenticates and his first request lazily builds his tenant.
    let registry_path = env.library_path.join("tenants.json");
    let mut reg = TenantRegistry::load(&registry_path).unwrap();
    let newbie_id = reg.find_by_email("newbie@example.org").unwrap().id.clone();
    reg.update(&newbie_id, |u| u.status = UserStatus::Active).unwrap();
    reg.save().unwrap();

    // Newbie's notebook list is empty — not alice's library.
    let (status, body) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&newbie_pat))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().map(Vec::len), Some(0), "got: {body}");
    assert_eq!(env.state.tenants.lazy_count(), 1);

    // Direct fetch of alice's page → 404 in newbie's tenant.
    let (status, _) = env
        .request_with_token(
            Method::GET,
            &format!("/api/notebooks/{nb_id}/pages/{page_id}"),
            None,
            Some(&newbie_pat),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // Newbie's own notebook lands in his tenant, invisible to alice.
    let (status, his) = env
        .request_with_token(
            Method::POST,
            "/api/notebooks",
            Some(json!({"name": "Newbie Notebook"})),
            Some(&newbie_pat),
        )
        .await;
    assert!(status.is_success(), "newbie create nb: {status} {his}");
    let (_, alice_list) = env
        .request_with_token(Method::GET, "/api/notebooks", None, Some(&alice_pat))
        .await;
    let names: Vec<String> = alice_list["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["name"].as_str().unwrap_or_default().to_string())
        .collect();
    assert!(names.contains(&"Alice Notebook".to_string()));
    assert!(
        !names.contains(&"Newbie Notebook".to_string()),
        "cross-tenant leak into owner library: {names:?}"
    );
}
