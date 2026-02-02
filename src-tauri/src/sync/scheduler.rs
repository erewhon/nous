use std::sync::{Arc, Mutex};

use chrono::Utc;
use tokio::sync::mpsc;
use uuid::Uuid;

use super::config::SyncMode;
use super::manager::{SharedLibraryStorage, SharedStorage, SyncManager};

/// Messages to control the sync scheduler
#[derive(Debug)]
pub enum SyncSchedulerMessage {
    /// Config changed, recalculate next sync times
    Reload,
    /// Remote changes detected for a specific library — trigger immediate sync
    RemoteChanged { library_id: Uuid },
    /// App closing
    Shutdown,
}

/// Handle for the periodic sync scheduler
pub struct SyncScheduler {
    sender: mpsc::Sender<SyncSchedulerMessage>,
}

impl SyncScheduler {
    /// Notify scheduler that sync config has changed
    pub fn reload(&self) {
        let _ = self.sender.try_send(SyncSchedulerMessage::Reload);
    }

    /// Notify scheduler that remote changes were detected for a library
    pub fn remote_changed(&self, library_id: Uuid) {
        let _ = self.sender.try_send(SyncSchedulerMessage::RemoteChanged { library_id });
    }

    /// Shut down the scheduler
    pub fn shutdown(&self) {
        let _ = self.sender.try_send(SyncSchedulerMessage::Shutdown);
    }

    /// Get a clone of the internal sender for external message producers (e.g., notify_push)
    pub fn sender_clone(&self) -> mpsc::Sender<SyncSchedulerMessage> {
        self.sender.clone()
    }
}

/// An item that needs periodic syncing
#[derive(Debug)]
enum SyncItem {
    Library {
        id: Uuid,
        interval_secs: u64,
        last_sync: Option<chrono::DateTime<Utc>>,
    },
    Notebook {
        id: Uuid,
        interval_secs: u64,
        last_sync: Option<chrono::DateTime<Utc>>,
    },
}

/// Minimum sync interval in seconds (prevents runaway syncing)
const MIN_INTERVAL_SECS: u64 = 60;

/// Fallback poll interval when no periodic items are configured
const FALLBACK_POLL_SECS: u64 = 60;

/// Start the periodic sync scheduler.
///
/// Spawns an async loop that monitors notebooks and libraries with periodic sync
/// enabled, and triggers syncs when their intervals elapse.
pub fn start_sync_scheduler(
    sync_manager: Arc<SyncManager>,
    storage: SharedStorage,
    library_storage: SharedLibraryStorage,
) -> SyncScheduler {
    let (tx, rx) = mpsc::channel(32);

    tauri::async_runtime::spawn(async move {
        sync_scheduler_loop(sync_manager, storage, library_storage, rx).await;
    });

    // Trigger initial scan
    let _ = tx.try_send(SyncSchedulerMessage::Reload);

    SyncScheduler { sender: tx }
}

/// Collect all items that have periodic sync enabled
fn collect_periodic_items(
    storage: &Arc<Mutex<crate::storage::FileStorage>>,
    library_storage: &Arc<Mutex<crate::library::LibraryStorage>>,
) -> Vec<SyncItem> {
    let mut items = Vec::new();

    // Collect libraries with periodic sync
    let libraries = {
        let lib_store = library_storage.lock().unwrap();
        lib_store.list_libraries().unwrap_or_default()
    };

    let mut library_synced_ids = std::collections::HashSet::new();

    for library in &libraries {
        if let Some(ref config) = library.sync_config {
            if config.enabled && config.sync_mode == SyncMode::Periodic {
                let interval = config
                    .sync_interval
                    .unwrap_or(300)
                    .max(MIN_INTERVAL_SECS);

                // For libraries, we don't have last_sync on the LibrarySyncConfig,
                // so we look at the managed notebooks' last_sync times to estimate.
                // We'll use the oldest last_sync among managed notebooks.
                items.push(SyncItem::Library {
                    id: library.id,
                    interval_secs: interval,
                    last_sync: find_library_last_sync(library.id, storage),
                });

                library_synced_ids.insert(library.id);
            }
        }
    }

    // Collect standalone notebooks with periodic sync
    let notebooks = {
        let store = storage.lock().unwrap();
        store.list_notebooks().unwrap_or_default()
    };

    for notebook in &notebooks {
        if let Some(ref config) = notebook.sync_config {
            // Skip notebooks managed by a library that already has periodic sync
            if config.managed_by_library == Some(true) {
                continue;
            }

            if config.enabled && config.sync_mode == SyncMode::Periodic {
                let interval = config
                    .sync_interval
                    .unwrap_or(300)
                    .max(MIN_INTERVAL_SECS);
                items.push(SyncItem::Notebook {
                    id: notebook.id,
                    interval_secs: interval,
                    last_sync: config.last_sync,
                });
            }
        }
    }

    items
}

/// Find the oldest last_sync time among managed notebooks for a library.
/// This serves as a proxy for "when the library was last synced".
fn find_library_last_sync(
    _library_id: Uuid,
    storage: &Arc<Mutex<crate::storage::FileStorage>>,
) -> Option<chrono::DateTime<Utc>> {
    let store = storage.lock().unwrap();
    let notebooks = store.list_notebooks().unwrap_or_default();

    let mut oldest: Option<chrono::DateTime<Utc>> = None;

    for notebook in &notebooks {
        if let Some(ref config) = notebook.sync_config {
            if config.managed_by_library == Some(true) {
                match (oldest, config.last_sync) {
                    (None, Some(ls)) => oldest = Some(ls),
                    (Some(current), Some(ls)) if ls < current => oldest = Some(ls),
                    _ => {}
                }
            }
        }
    }

    oldest
}

/// Check sentinel for a library and decide whether a full sync is needed.
///
/// Returns `true` if the sentinel indicates remote changes (or on first check),
/// `false` if the sentinel ETag matches (no remote changes since last sync).
async fn should_sync_library(
    sync_manager: &SyncManager,
    library_id: Uuid,
    library_storage: &SharedLibraryStorage,
) -> bool {
    let library_config = {
        let lib_store = library_storage.lock().unwrap();
        lib_store
            .get_library(library_id)
            .ok()
            .and_then(|lib| lib.sync_config)
    };

    let Some(lib_config) = library_config else {
        return true; // No config, let sync_library handle it
    };

    match sync_manager.check_sentinel_for_library(library_id, &lib_config).await {
        Ok(changed) => {
            if !changed {
                log::info!(
                    "Sync scheduler: sentinel unchanged for library {}, skipping full sync",
                    library_id,
                );
            }
            changed
        }
        Err(e) => {
            log::debug!(
                "Sync scheduler: sentinel check failed for library {}: {} — proceeding with sync",
                library_id,
                e,
            );
            true // On error, sync anyway
        }
    }
}

/// Main scheduler loop
async fn sync_scheduler_loop(
    sync_manager: Arc<SyncManager>,
    storage: SharedStorage,
    library_storage: SharedLibraryStorage,
    mut receiver: mpsc::Receiver<SyncSchedulerMessage>,
) {
    use std::collections::HashMap;
    use std::time::Duration;

    log::info!("Sync scheduler started");

    // Track when each item was last checked (sentinel or full sync).
    // This prevents the scheduler from spinning when the sentinel says
    // "unchanged" — without this, `last_sync` never advances and the
    // item remains perpetually overdue.
    let mut last_checked: HashMap<Uuid, chrono::DateTime<Utc>> = HashMap::new();

    loop {
        // 1. Scan for periodic sync items
        let items = collect_periodic_items(&storage, &library_storage);

        if items.is_empty() {
            log::debug!("Sync scheduler: no periodic sync items configured");
        } else {
            log::info!(
                "Sync scheduler: tracking {} periodic sync item(s)",
                items.len()
            );
        }

        // 2. Find the soonest due item
        let now = Utc::now();
        let mut soonest_wait: Option<Duration> = None;

        for item in &items {
            let (id, interval_secs, last_sync) = match item {
                SyncItem::Library {
                    id,
                    interval_secs,
                    last_sync,
                } => (*id, *interval_secs, *last_sync),
                SyncItem::Notebook {
                    id,
                    interval_secs,
                    last_sync,
                } => (*id, *interval_secs, *last_sync),
            };

            // Use the later of last_sync and last_checked to avoid spinning
            // when sentinel checks skip the full sync.
            let effective_last = match (last_sync, last_checked.get(&id)) {
                (Some(ls), Some(lc)) => Some(ls.max(*lc)),
                (Some(ls), None) => Some(ls),
                (None, Some(lc)) => Some(*lc),
                (None, None) => None,
            };

            let next_sync = match effective_last {
                Some(ls) => ls + chrono::Duration::seconds(interval_secs as i64),
                None => now, // Never synced, due immediately
            };

            let wait = if next_sync <= now {
                Duration::from_secs(0)
            } else {
                (next_sync - now)
                    .to_std()
                    .unwrap_or(Duration::from_secs(FALLBACK_POLL_SECS))
            };

            soonest_wait = Some(match soonest_wait {
                Some(current) => current.min(wait),
                None => wait,
            });
        }

        // Cap at fallback poll interval so we pick up config changes
        let wait_duration = soonest_wait
            .unwrap_or(Duration::from_secs(FALLBACK_POLL_SECS))
            .min(Duration::from_secs(FALLBACK_POLL_SECS));

        if !items.is_empty() {
            log::info!(
                "Sync scheduler: next check in {:.0}s",
                wait_duration.as_secs_f64()
            );
        }

        // 3. Wait for timer or control message
        tokio::select! {
            _ = tokio::time::sleep(wait_duration) => {
                // Check which items are due
                let now = Utc::now();
                let due_items = collect_periodic_items(&storage, &library_storage);

                for item in &due_items {
                    let (id, interval_secs, last_sync, is_library) = match item {
                        SyncItem::Library { id, interval_secs, last_sync } => {
                            (*id, *interval_secs, *last_sync, true)
                        }
                        SyncItem::Notebook { id, interval_secs, last_sync } => {
                            (*id, *interval_secs, *last_sync, false)
                        }
                    };

                    // Use effective_last (considering last_checked) for due calculation
                    let effective_last = match (last_sync, last_checked.get(&id)) {
                        (Some(ls), Some(lc)) => Some(ls.max(*lc)),
                        (Some(ls), None) => Some(ls),
                        (None, Some(lc)) => Some(*lc),
                        (None, None) => None,
                    };

                    let next_sync = match effective_last {
                        Some(ls) => ls + chrono::Duration::seconds(interval_secs as i64),
                        None => now,
                    };

                    if next_sync > now {
                        continue;
                    }

                    if is_library {
                        // Check sentinel before running full sync
                        if !should_sync_library(&sync_manager, id, &library_storage).await {
                            // Sentinel says no changes — record the check time so
                            // the scheduler waits a full interval before re-checking.
                            last_checked.insert(id, Utc::now());
                            continue;
                        }

                        log::info!("Sync scheduler: running periodic sync for library {}", id);
                        match sync_manager
                            .sync_library(id, &library_storage, &storage, None)
                            .await
                        {
                            Ok(result) => {
                                last_checked.insert(id, Utc::now());
                                log::info!(
                                    "Sync scheduler: library {} sync complete — pulled={}, pushed={}, assets_pushed={}, assets_pulled={}",
                                    id,
                                    result.pages_pulled,
                                    result.pages_pushed,
                                    result.assets_pushed,
                                    result.assets_pulled,
                                );
                            }
                            Err(e) => {
                                last_checked.insert(id, Utc::now());
                                log::error!(
                                    "Sync scheduler: library {} sync failed: {}",
                                    id,
                                    e
                                );
                            }
                        }
                    } else {
                        log::info!("Sync scheduler: running periodic sync for notebook {}", id);
                        match sync_manager.sync_notebook(id, &storage, None).await {
                            Ok(result) => {
                                last_checked.insert(id, Utc::now());
                                log::info!(
                                    "Sync scheduler: notebook {} sync complete — pulled={}, pushed={}",
                                    id,
                                    result.pages_pulled,
                                    result.pages_pushed,
                                );
                            }
                            Err(e) => {
                                last_checked.insert(id, Utc::now());
                                log::error!(
                                    "Sync scheduler: notebook {} sync failed: {}",
                                    id,
                                    e
                                );
                            }
                        }
                    }
                }
            }

            msg = receiver.recv() => {
                match msg {
                    Some(SyncSchedulerMessage::Reload) => {
                        log::info!("Sync scheduler: reload requested, re-scanning configs");
                        continue;
                    }
                    Some(SyncSchedulerMessage::RemoteChanged { library_id }) => {
                        log::info!("Sync scheduler: remote change detected for library {}, triggering sync", library_id);
                        match sync_manager
                            .sync_library(library_id, &library_storage, &storage, None)
                            .await
                        {
                            Ok(result) => {
                                last_checked.insert(library_id, Utc::now());
                                log::info!(
                                    "Sync scheduler: library {} (remote-triggered) sync complete — pulled={}, pushed={}",
                                    library_id,
                                    result.pages_pulled,
                                    result.pages_pushed,
                                );
                            }
                            Err(e) => {
                                last_checked.insert(library_id, Utc::now());
                                log::error!(
                                    "Sync scheduler: library {} (remote-triggered) sync failed: {}",
                                    library_id,
                                    e,
                                );
                            }
                        }
                        continue;
                    }
                    Some(SyncSchedulerMessage::Shutdown) | None => {
                        log::info!("Sync scheduler: shutting down");
                        break;
                    }
                }
            }
        }
    }
}
