//! Per-tenant state for the multi-user daemon.
//!
//! [`TenantState`] is the per-user slice of what used to be the whole
//! `DaemonState`: file storage, search index, CRDT store, the personal
//! storages, the action machinery. [`TenantManager`] maps authenticated
//! user ids to `Arc<TenantState>`, building tenants lazily on first
//! request. Process-globals (PythonAI/GIL, RAG + AI config, sync,
//! backups, the web bundle) stay on `DaemonState`.
//!
//! # Owner mapping — no file moves
//!
//! The daemon's existing data dir IS the owner's tenant. At boot the
//! owner `TenantState` is built from exactly the paths the daemon has
//! always used; in multi-user mode the oldest `role = owner` registry
//! user is pinned to it. Every other user lives under
//! `{data_dir}/tenants/{user_id}/`, a miniature data dir of the same
//! shape (own library tree, own search index, own energy/contacts).
//! Legacy single-user mode is the same code path with the owner as the
//! only tenant — behavior identical to the pre-tenancy daemon.
//!
//! # The sweep contract (sibling leaves)
//!
//! Route handlers migrate off the `DaemonState` aliases by adding one
//! extractor argument and swapping the state access — nothing else:
//!
//! ```ignore
//! async fn list_pages(
//!     State(state): State<AppState>,
//!     tenant: Tenant,                       // ← add
//!     Path(nb): Path<String>,
//! ) -> ... {
//!     let storage = tenant.storage.lock()?;  // ← was state.storage
//! }
//! ```
//!
//! [`Tenant`] implements `Deref<Target = TenantState>`. It resolves the
//! request's `AuthedUser` through the manager; with no `AuthedUser`
//! (legacy mode) it yields the owner tenant, so swept handlers behave
//! identically on a single-user daemon.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};

use anyhow::{Context, Result};

use nous_lib::actions::{ActionExecutor, ActionScheduler, ActionStorage};
use nous_lib::contacts::ContactsStorage;
use nous_lib::energy::EnergyStorage;
use nous_lib::events::EventSender;
use nous_lib::goals::GoalsStorage;
use nous_lib::inbox::InboxStorage;
use nous_lib::library::LibraryStorage;
#[cfg(feature = "plugins")]
use nous_lib::plugins;
use nous_lib::python_bridge::PythonAI;
use nous_lib::search::{SearchIndex, TantivyBackend};
use nous_lib::storage::FileStorage;
use nous_lib::sync::CrdtStore;

/// Construction options. The owner tenant on a real daemon starts its
/// background machinery and loads plugins (exactly the pre-tenancy
/// behavior); lazily built hosted tenants start quiet — the scheduler
/// lifecycle leaf owns their start/stop policy, and hosted plugins are
/// off by policy (never load another user's Lua into the daemon).
#[derive(Debug, Clone, Copy)]
pub struct TenantBuildOpts {
    /// Start the action scheduler after construction.
    pub start_scheduler: bool,
    /// Construct and load the Lua plugin host.
    pub plugins: bool,
}

impl TenantBuildOpts {
    /// The owner tenant of a running daemon.
    pub fn owner() -> Self {
        Self { start_scheduler: true, plugins: true }
    }

    /// A lazily built (hosted) tenant — quiet background, no plugins.
    pub fn hosted() -> Self {
        Self { start_scheduler: false, plugins: false }
    }
}

/// The per-user slice of daemon state. Everything here is rooted in the
/// tenant's own directory tree; two tenants never share a path.
pub struct TenantState {
    /// The tenant's data-dir-shaped root (the real data dir for the
    /// owner; `{data_dir}/tenants/{id}` otherwise). Energy/contacts
    /// live here.
    pub root_dir: PathBuf,
    /// The tenant's current library (under `root_dir`).
    pub library_path: PathBuf,
    pub storage: Arc<Mutex<FileStorage>>,
    pub library_storage: Arc<Mutex<LibraryStorage>>,
    pub inbox_storage: Arc<Mutex<InboxStorage>>,
    pub goals_storage: Arc<Mutex<GoalsStorage>>,
    pub energy_storage: Arc<Mutex<EnergyStorage>>,
    pub contacts_storage: Arc<Mutex<ContactsStorage>>,
    /// Raw Tantivy index (rebuild endpoint); `tantivy` is the backend
    /// wrapper the search dispatcher uses.
    pub search_index: Arc<Mutex<SearchIndex>>,
    pub tantivy: Arc<TantivyBackend>,
    pub crdt_store: Arc<CrdtStore>,
    /// Constructed for every tenant; started per [`TenantBuildOpts`].
    pub action_scheduler: Arc<Mutex<ActionScheduler>>,
    #[cfg(feature = "plugins")]
    pub plugin_host: Option<Arc<Mutex<plugins::PluginHost>>>,
    /// Event channel. The owner's is the daemon-wide channel the
    /// `/api/events` WS serves; lazy tenants get private channels that
    /// the per-tenant WS leaf will surface.
    pub event_tx: EventSender,
}

impl TenantState {
    /// Build a tenant stack at `root_dir` with its current library at
    /// `library_path`. Mirrors the pre-tenancy daemon construction
    /// step for step — the owner tenant built this way is byte-for-byte
    /// the old daemon state.
    pub fn build_at(
        root_dir: PathBuf,
        library_path: PathBuf,
        python_ai: Arc<Mutex<PythonAI>>,
        event_tx: EventSender,
        opts: TenantBuildOpts,
    ) -> Result<Arc<Self>> {
        let storage = FileStorage::new(library_path.clone());
        storage.init().context("Failed to initialize storage")?;

        // Tantivy search index — per-tenant directory, so writer locks
        // never collide across tenants.
        let mut search_index = SearchIndex::new(library_path.join("search_index")).context(
            "Failed to initialize search index — another process is holding the Tantivy writer \
             lock. Stop any running desktop app or stale daemon and retry.",
        )?;

        // Fresh/empty index (new install, new tenant, or post-migration
        // rebuild): populate from all pages so search works immediately.
        if search_index.num_docs() == 0 {
            let mut pages = Vec::new();
            if let Ok(notebooks) = storage.list_notebooks() {
                for nb in notebooks {
                    match storage.list_pages(nb.id) {
                        Ok(nb_pages) => pages.extend(
                            nb_pages
                                .into_iter()
                                .filter(|p| p.deleted_at.is_none() && !p.is_archived),
                        ),
                        Err(e) => {
                            log::warn!("Startup index: failed to list pages for {}: {}", nb.id, e)
                        }
                    }
                }
            }
            if !pages.is_empty() {
                match search_index.rebuild_index(&pages) {
                    Ok(()) => {
                        log::info!("Populated empty search index with {} pages", pages.len())
                    }
                    Err(e) => log::warn!("Startup search index population failed: {}", e),
                }
            }
        }

        let crdt_store = Arc::new(CrdtStore::new(library_path.clone()));

        let library_storage = LibraryStorage::new(root_dir.clone());
        let inbox_storage =
            InboxStorage::new(library_path.clone()).context("Failed to initialize inbox storage")?;
        let goals_storage =
            GoalsStorage::new(library_path.clone()).context("Failed to initialize goals storage")?;
        let energy_storage =
            EnergyStorage::new(root_dir.clone()).context("Failed to initialize energy storage")?;
        let contacts_storage = ContactsStorage::new(root_dir.clone())
            .context("Failed to initialize contacts storage")?;
        let action_storage = ActionStorage::new(library_path.clone())
            .context("Failed to initialize action storage")?;

        let storage_arc = Arc::new(Mutex::new(storage));
        let library_storage_arc = Arc::new(Mutex::new(library_storage));
        let inbox_storage_arc = Arc::new(Mutex::new(inbox_storage));
        let goals_storage_arc = Arc::new(Mutex::new(goals_storage));
        let energy_storage_arc = Arc::new(Mutex::new(energy_storage));
        let contacts_storage_arc = Arc::new(Mutex::new(contacts_storage));
        let action_storage_arc = Arc::new(Mutex::new(action_storage));
        let search_index_arc = Arc::new(Mutex::new(search_index));

        let tantivy = Arc::new(TantivyBackend::new(Arc::clone(&search_index_arc)));

        // Plugin host (Lua VMs, capability gating). Owner only — hosted
        // tenants run without plugins by policy.
        #[cfg(feature = "plugins")]
        let plugin_host: Option<Arc<Mutex<plugins::PluginHost>>> = if opts.plugins {
            let mut api = plugins::HostApi::new(
                Arc::clone(&storage_arc),
                Arc::clone(&goals_storage_arc),
                Arc::clone(&inbox_storage_arc),
            );
            api.set_energy_storage(Arc::clone(&energy_storage_arc));
            api.set_python_ai(Arc::clone(&python_ai));
            let api = Arc::new(api);
            let mut host = plugins::PluginHost::new(api, library_path.join("plugins"));
            if let Err(e) = host.load_all() {
                log::warn!("Plugin load error: {e}");
            }
            Some(Arc::new(Mutex::new(host)))
        } else {
            None
        };

        let mut action_executor = ActionExecutor::new(
            Arc::clone(&storage_arc),
            Arc::clone(&action_storage_arc),
            Arc::clone(&python_ai),
        );
        action_executor.set_goals_storage(Arc::clone(&goals_storage_arc));
        action_executor.set_energy_storage(Arc::clone(&energy_storage_arc));
        action_executor.set_inbox_storage(Arc::clone(&inbox_storage_arc));
        action_executor.set_event_tx(event_tx.clone());
        #[cfg(feature = "plugins")]
        action_executor.set_plugin_host(plugin_host.clone());

        // Refresh built-in actions from Lua plugin definitions (if loaded).
        #[cfg(feature = "plugins")]
        if let Some(ref ph) = plugin_host {
            if let Ok(host) = ph.lock() {
                let builtins = host.get_builtin_actions();
                if !builtins.is_empty() {
                    if let Ok(storage) = action_storage_arc.lock() {
                        if let Err(e) = storage.refresh_builtins(builtins) {
                            log::warn!("Failed to refresh builtins from plugins: {e}");
                        }
                    }
                }
            }
        }

        let action_executor_arc = Arc::new(Mutex::new(action_executor));
        let mut action_scheduler = ActionScheduler::new(
            Arc::clone(&action_storage_arc),
            Arc::clone(&action_executor_arc),
        );
        if opts.start_scheduler {
            action_scheduler.start();
            log::info!("Action scheduler started ({})", library_path.display());
        }

        Ok(Arc::new(Self {
            root_dir,
            library_path,
            storage: storage_arc,
            library_storage: library_storage_arc,
            inbox_storage: inbox_storage_arc,
            goals_storage: goals_storage_arc,
            energy_storage: energy_storage_arc,
            contacts_storage: contacts_storage_arc,
            search_index: search_index_arc,
            tantivy,
            crdt_store,
            action_scheduler: Arc::new(Mutex::new(action_scheduler)),
            #[cfg(feature = "plugins")]
            plugin_host,
            event_tx,
        }))
    }
}

/// Maps authenticated user ids to tenants; builds lazily.
pub struct TenantManager {
    data_dir: PathBuf,
    /// The registry user pinned to the legacy data-dir tenant — the
    /// oldest `role = owner` user at boot. None in legacy mode (no
    /// registry) or when no owner exists yet.
    owner_user_id: Option<String>,
    owner: Arc<TenantState>,
    tenants: RwLock<HashMap<String, Arc<TenantState>>>,
    /// Shared across all tenants (one Python interpreter per process).
    python_ai: Arc<Mutex<PythonAI>>,
}

impl TenantManager {
    pub fn new(
        data_dir: PathBuf,
        owner: Arc<TenantState>,
        owner_user_id: Option<String>,
        python_ai: Arc<Mutex<PythonAI>>,
    ) -> Self {
        Self {
            data_dir,
            owner_user_id,
            owner,
            tenants: RwLock::new(HashMap::new()),
            python_ai,
        }
    }

    /// The owner / legacy tenant (also the fallback when a request has
    /// no `AuthedUser`, i.e. single-user mode).
    pub fn owner(&self) -> Arc<TenantState> {
        Arc::clone(&self.owner)
    }

    /// Number of lazily built tenants (excludes the owner).
    pub fn lazy_count(&self) -> usize {
        self.tenants.read().map(|m| m.len()).unwrap_or(0)
    }

    /// Resolve a user id to their tenant, building it on first use.
    ///
    /// Building is synchronous filesystem + Tantivy work (~tens of ms);
    /// it happens once per tenant per daemon lifetime, inline on the
    /// first authenticated request — same inline-blocking stance as the
    /// registry reload.
    pub fn resolve(&self, user_id: &str) -> Result<Arc<TenantState>> {
        if self.owner_user_id.as_deref() == Some(user_id) {
            return Ok(self.owner());
        }
        // User ids are registry-minted UUIDs; this guard is defense in
        // depth so a corrupted id can never shape a path.
        if user_id.is_empty()
            || !user_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            anyhow::bail!("invalid tenant user id");
        }
        if let Some(t) = self
            .tenants
            .read()
            .unwrap_or_else(|p| p.into_inner())
            .get(user_id)
        {
            return Ok(Arc::clone(t));
        }

        let mut map = self.tenants.write().unwrap_or_else(|p| p.into_inner());
        // Double-checked: another request may have built it while we
        // waited for the write lock.
        if let Some(t) = map.get(user_id) {
            return Ok(Arc::clone(t));
        }

        let root = self.data_dir.join("tenants").join(user_id);
        std::fs::create_dir_all(&root)
            .with_context(|| format!("Failed to create tenant root: {}", root.display()))?;

        // The tenant's own library tree; init() creates and selects a
        // default library on first touch.
        let library = LibraryStorage::new(root.clone())
            .init()
            .context("Failed to initialize tenant library")?;

        // Private event channel — surfaced by the per-tenant WS leaf.
        let (event_tx, _) = tokio::sync::broadcast::channel(256);

        let state = TenantState::build_at(
            root,
            library.path,
            Arc::clone(&self.python_ai),
            event_tx,
            TenantBuildOpts::hosted(),
        )?;
        log::info!("Built tenant state for user {user_id}");
        map.insert(user_id.to_string(), Arc::clone(&state));
        Ok(state)
    }
}

/// Extractor resolving the request's tenant — THE handler-side entry
/// point to per-tenant state (see the module docs for the sweep
/// contract). `AuthedUser` present → that user's tenant; absent
/// (single-user mode) → the owner tenant.
pub struct Tenant(pub Arc<TenantState>);

impl std::ops::Deref for Tenant {
    type Target = TenantState;
    fn deref(&self) -> &TenantState {
        &self.0
    }
}

impl<S> axum::extract::FromRequestParts<S> for Tenant
where
    S: Send + Sync,
    Arc<super::daemon::DaemonState>: axum::extract::FromRef<S>,
{
    type Rejection = axum::response::Response;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        use axum::extract::FromRef;
        use axum::response::IntoResponse;

        let daemon: Arc<super::daemon::DaemonState> = FromRef::from_ref(state);
        let resolved = match parts.extensions.get::<super::auth::AuthedUser>() {
            Some(user) => daemon.tenants.resolve(&user.user_id),
            None => Ok(daemon.tenants.owner()),
        };
        match resolved {
            Ok(t) => Ok(Tenant(t)),
            Err(e) => {
                log::error!("tenant resolution failed: {e:#}");
                Err((
                    axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                    axum::Json(serde_json::json!({ "error": "internal error" })),
                )
                    .into_response())
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nous_lib::python_bridge::PythonAI;
    use tempfile::TempDir;

    fn python() -> Arc<Mutex<PythonAI>> {
        Arc::new(Mutex::new(PythonAI::new(PathBuf::from("nous-py"))))
    }

    fn build(root: &std::path::Path) -> Arc<TenantState> {
        let (event_tx, _) = tokio::sync::broadcast::channel(16);
        TenantState::build_at(
            root.to_path_buf(),
            root.to_path_buf(),
            python(),
            event_tx,
            TenantBuildOpts::hosted(),
        )
        .expect("tenant build")
    }

    #[tokio::test]
    async fn two_tenants_build_with_disjoint_trees_and_indexes() {
        // Two tenant stacks side by side: both Tantivy writers must open
        // (per-tenant index dirs — no writer-lock collision), and their
        // trees must be disjoint.
        let a_dir = TempDir::new().unwrap();
        let b_dir = TempDir::new().unwrap();
        let a = build(a_dir.path());
        let b = build(b_dir.path());
        assert_ne!(a.library_path, b.library_path);
        assert!(a_dir.path().join("search_index").is_dir());
        assert!(b_dir.path().join("search_index").is_dir());

        // Writes through one tenant's storage never appear in the other.
        let nb = a
            .storage
            .lock()
            .unwrap()
            .create_notebook("A only".into(), nous_lib::storage::NotebookType::Standard)
            .unwrap();
        assert!(a.storage.lock().unwrap().get_notebook(nb.id).is_ok());
        assert!(b.storage.lock().unwrap().list_notebooks().unwrap().is_empty());
    }

    #[tokio::test]
    async fn manager_resolves_owner_lazily_builds_and_caches_tenants() {
        let data = TempDir::new().unwrap();
        let owner = build(data.path());
        let mgr = TenantManager::new(
            data.path().to_path_buf(),
            Arc::clone(&owner),
            Some("owner-1".into()),
            python(),
        );

        // Owner id → the owner tenant, no lazy build.
        let got = mgr.resolve("owner-1").unwrap();
        assert!(Arc::ptr_eq(&got, &owner));
        assert_eq!(mgr.lazy_count(), 0);

        // Unknown id → built under {data}/tenants/{id} with its own
        // library; cached (same Arc) on the second resolve.
        let u1 = mgr.resolve("11111111-aaaa-bbbb-cccc-000000000001").unwrap();
        assert!(u1
            .root_dir
            .starts_with(data.path().join("tenants")));
        assert!(!Arc::ptr_eq(&u1, &owner));
        assert_eq!(mgr.lazy_count(), 1);
        let again = mgr.resolve("11111111-aaaa-bbbb-cccc-000000000001").unwrap();
        assert!(Arc::ptr_eq(&again, &u1));
        assert_eq!(mgr.lazy_count(), 1);

        // A second user gets a distinct tenant.
        let u2 = mgr.resolve("11111111-aaaa-bbbb-cccc-000000000002").unwrap();
        assert!(!Arc::ptr_eq(&u2, &u1));
        assert_ne!(u1.library_path, u2.library_path);
        assert_eq!(mgr.lazy_count(), 2);

        // Path-shaping ids are rejected outright.
        assert!(mgr.resolve("../escape").is_err());
        assert!(mgr.resolve("").is_err());
    }
}
