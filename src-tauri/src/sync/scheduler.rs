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

    /// Shut down the scheduler
    pub fn shutdown(&self) {
        let _ = self.sender.try_send(SyncSchedulerMessage::Shutdown);
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
    sync_manager: Arc<tokio::sync::Mutex<SyncManager>>,
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

/// Main scheduler loop
async fn sync_scheduler_loop(
    sync_manager: Arc<tokio::sync::Mutex<SyncManager>>,
    storage: SharedStorage,
    library_storage: SharedLibraryStorage,
    mut receiver: mpsc::Receiver<SyncSchedulerMessage>,
) {
    use std::time::Duration;

    log::info!("Sync scheduler started");

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
            let (interval_secs, last_sync) = match item {
                SyncItem::Library {
                    interval_secs,
                    last_sync,
                    ..
                } => (*interval_secs, *last_sync),
                SyncItem::Notebook {
                    interval_secs,
                    last_sync,
                    ..
                } => (*interval_secs, *last_sync),
            };

            let next_sync = match last_sync {
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

                    let next_sync = match last_sync {
                        Some(ls) => ls + chrono::Duration::seconds(interval_secs as i64),
                        None => now,
                    };

                    if next_sync > now {
                        continue;
                    }

                    if is_library {
                        log::info!("Sync scheduler: running periodic sync for library {}", id);
                        let manager = sync_manager.lock().await;
                        match manager
                            .sync_library(id, &library_storage, &storage, None)
                            .await
                        {
                            Ok(result) => {
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
                                log::error!(
                                    "Sync scheduler: library {} sync failed: {}",
                                    id,
                                    e
                                );
                            }
                        }
                        // sync_library already updates last_sync on each notebook
                        // Update the library's managed notebooks' last_sync is handled
                        // inside sync_notebook which is called by sync_library
                    } else {
                        log::info!("Sync scheduler: running periodic sync for notebook {}", id);
                        let manager = sync_manager.lock().await;
                        match manager.sync_notebook(id, &storage, None).await {
                            Ok(result) => {
                                log::info!(
                                    "Sync scheduler: notebook {} sync complete — pulled={}, pushed={}",
                                    id,
                                    result.pages_pulled,
                                    result.pages_pushed,
                                );
                            }
                            Err(e) => {
                                log::error!(
                                    "Sync scheduler: notebook {} sync failed: {}",
                                    id,
                                    e
                                );
                            }
                        }
                        // sync_notebook already updates last_sync in the notebook config
                    }
                }
            }

            msg = receiver.recv() => {
                match msg {
                    Some(SyncSchedulerMessage::Reload) => {
                        log::info!("Sync scheduler: reload requested, re-scanning configs");
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
