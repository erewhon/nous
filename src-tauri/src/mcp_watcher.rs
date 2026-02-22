//! File watcher for MCP server writes.
//!
//! Watches the library directory for changes made by external processes
//! (e.g., the MCP server) and emits Tauri events so the UI refreshes.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{Config, Event, EventKind, PollWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::AppState;

/// How often the poll watcher checks for changes.
const POLL_INTERVAL: Duration = Duration::from_millis(750);

/// Events within this window after a Tauri write are ignored
/// (they're from the app itself, not MCP).
const SELF_WRITE_GRACE: Duration = Duration::from_secs(1);

/// Debounce window: collect events before processing.
const DEBOUNCE_WINDOW: Duration = Duration::from_millis(750);

/// Per-category cooldown: don't re-emit the same event category within this window.
/// This prevents spam from the app's own periodic writes (e.g., auto-goal checks).
const CATEGORY_COOLDOWN: Duration = Duration::from_secs(5);

/// Tracks the last time Tauri wrote to a path so we can ignore our own writes.
#[derive(Clone, Default)]
pub struct WriteTracker {
    last_writes: Arc<Mutex<HashMap<PathBuf, Instant>>>,
}

impl WriteTracker {
    pub fn record_write(&self, path: PathBuf) {
        if let Ok(mut map) = self.last_writes.lock() {
            map.insert(path, Instant::now());
        }
    }

    fn was_recent_write(&self, path: &PathBuf) -> bool {
        if let Ok(map) = self.last_writes.lock() {
            if let Some(t) = map.get(path) {
                return t.elapsed() < SELF_WRITE_GRACE;
            }
        }
        false
    }

    /// Prune entries older than the grace period to prevent unbounded growth.
    fn prune(&self) {
        if let Ok(mut map) = self.last_writes.lock() {
            map.retain(|_, t| t.elapsed() < SELF_WRITE_GRACE * 2);
        }
    }
}

/// Classification of a detected file change.
#[derive(Debug)]
enum ChangeKind {
    /// A page JSON changed: notebooks/{nb_id}/pages/{page_id}.json
    Page { notebook_id: String, page_id: String },
    /// An inbox item changed
    Inbox,
    /// Goals or goal progress changed
    Goals,
}

fn classify_path(path: &std::path::Path, library_path: &std::path::Path) -> Option<ChangeKind> {
    let rel = path.strip_prefix(library_path).ok()?;
    let components: Vec<&str> = rel
        .components()
        .filter_map(|c| c.as_os_str().to_str())
        .collect();

    // notebooks/{nb_id}/pages/{page_id}.json
    if components.len() == 4
        && components[0] == "notebooks"
        && components[2] == "pages"
        && components[3].ends_with(".json")
    {
        let page_id = components[3].trim_end_matches(".json").to_string();
        return Some(ChangeKind::Page {
            notebook_id: components[1].to_string(),
            page_id,
        });
    }

    // inbox/{item_id}.json
    if components.len() == 2 && components[0] == "inbox" && components[1].ends_with(".json") {
        return Some(ChangeKind::Inbox);
    }

    // goals/goals.json or goals/progress/{goal_id}.json
    if !components.is_empty() && components[0] == "goals" {
        if components.len() == 2 && components[1] == "goals.json" {
            return Some(ChangeKind::Goals);
        }
        if components.len() == 3
            && components[1] == "progress"
            && components[2].ends_with(".json")
        {
            return Some(ChangeKind::Goals);
        }
    }

    None
}

/// Start watching the library directory for external changes.
/// Returns the watcher handle (must be kept alive).
pub fn start_library_watcher(
    app: AppHandle,
    library_path: PathBuf,
) -> Result<PollWatcher, Box<dyn std::error::Error>> {
    let write_tracker = app
        .try_state::<WriteTracker>()
        .map(|s| (*s).clone())
        .unwrap_or_default();

    let lib_path = library_path.clone();

    // Watch paths
    let notebooks_dir = library_path.join("notebooks");
    let inbox_dir = library_path.join("inbox");
    let goals_dir = library_path.join("goals");

    // Pending changes accumulator (protected by mutex for the closure)
    let pending: Arc<Mutex<Vec<(PathBuf, Instant)>>> = Arc::new(Mutex::new(Vec::new()));
    let pending_clone = Arc::clone(&pending);
    let app_clone = app.clone();
    let lib_path_clone = lib_path.clone();
    let tracker_clone = write_tracker.clone();

    // Spawn a debounce processor thread
    std::thread::spawn(move || {
        // Per-category cooldown tracking
        let mut last_inbox_emit = Instant::now() - CATEGORY_COOLDOWN * 2;
        let mut last_goals_emit = Instant::now() - CATEGORY_COOLDOWN * 2;
        let mut last_pages_emit: HashMap<String, Instant> = HashMap::new();

        loop {
            std::thread::sleep(DEBOUNCE_WINDOW);

            let events: Vec<PathBuf> = {
                let mut pending = match pending_clone.lock() {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                let cutoff = Instant::now() - DEBOUNCE_WINDOW;
                let ready: Vec<PathBuf> = pending
                    .iter()
                    .filter(|(_, t)| *t < cutoff)
                    .map(|(p, _)| p.clone())
                    .collect();
                pending.retain(|(_, t)| *t >= cutoff);
                ready
            };

            if events.is_empty() {
                continue;
            }

            // Classify and deduplicate
            let mut page_changes: HashMap<String, Vec<String>> = HashMap::new();
            let mut inbox_changed = false;
            let mut goals_changed = false;

            for path in &events {
                match classify_path(path, &lib_path_clone) {
                    Some(ChangeKind::Page {
                        notebook_id,
                        page_id,
                    }) => {
                        page_changes
                            .entry(notebook_id)
                            .or_default()
                            .push(page_id);
                    }
                    Some(ChangeKind::Inbox) => inbox_changed = true,
                    Some(ChangeKind::Goals) => goals_changed = true,
                    None => {}
                }
            }

            let now = Instant::now();

            // Emit events (with per-category cooldown)
            for (notebook_id, page_ids) in &page_changes {
                let last = last_pages_emit
                    .get(notebook_id)
                    .copied()
                    .unwrap_or(Instant::now() - CATEGORY_COOLDOWN * 2);
                if now.duration_since(last) < CATEGORY_COOLDOWN {
                    continue;
                }
                last_pages_emit.insert(notebook_id.clone(), now);

                #[derive(Clone, serde::Serialize)]
                #[serde(rename_all = "camelCase")]
                struct PagesUpdated {
                    notebook_id: String,
                    page_ids: Vec<String>,
                }

                let payload = PagesUpdated {
                    notebook_id: notebook_id.clone(),
                    page_ids: page_ids.clone(),
                };
                if let Err(e) = app_clone.emit("sync-pages-updated", &payload) {
                    log::warn!("Failed to emit sync-pages-updated: {}", e);
                } else {
                    log::info!(
                        "[mcp-watcher] Emitted sync-pages-updated for {} page(s) in {}",
                        page_ids.len(),
                        &notebook_id[..8.min(notebook_id.len())]
                    );
                }
            }

            if inbox_changed && now.duration_since(last_inbox_emit) >= CATEGORY_COOLDOWN {
                last_inbox_emit = now;
                if let Err(e) = app_clone.emit("mcp-inbox-updated", ()) {
                    log::warn!("Failed to emit mcp-inbox-updated: {}", e);
                } else {
                    log::info!("[mcp-watcher] Emitted mcp-inbox-updated");
                }
            }

            if goals_changed && now.duration_since(last_goals_emit) >= CATEGORY_COOLDOWN {
                last_goals_emit = now;
                if let Err(e) = app_clone.emit("sync-goals-updated", ()) {
                    log::warn!("Failed to emit sync-goals-updated: {}", e);
                } else {
                    log::info!("[mcp-watcher] Emitted sync-goals-updated");
                }
            }

            tracker_clone.prune();
        }
    });

    let config = Config::default().with_poll_interval(POLL_INTERVAL);
    let pending_for_cb = Arc::clone(&pending);

    let mut watcher = PollWatcher::new(
        move |res: Result<Event, notify::Error>| {
            let event = match res {
                Ok(e) => e,
                Err(e) => {
                    log::warn!("[mcp-watcher] Watch error: {}", e);
                    return;
                }
            };

            // Only care about creates, modifications, and renames
            match event.kind {
                EventKind::Create(_) | EventKind::Modify(_) => {}
                _ => return,
            }

            for path in event.paths {
                // Skip .tmp files (atomic write intermediaries)
                if path
                    .extension()
                    .map_or(false, |ext| ext == "tmp")
                {
                    continue;
                }

                // Skip non-JSON files
                if path
                    .extension()
                    .map_or(true, |ext| ext != "json")
                {
                    continue;
                }

                // Skip our own recent writes
                if write_tracker.was_recent_write(&path) {
                    continue;
                }

                if let Ok(mut pending) = pending_for_cb.lock() {
                    pending.push((path, Instant::now()));
                }
            }
        },
        config,
    )?;

    // Watch the directories that exist
    for dir in [&notebooks_dir, &inbox_dir, &goals_dir] {
        if dir.exists() {
            if let Err(e) = watcher.watch(dir, RecursiveMode::Recursive) {
                log::warn!(
                    "[mcp-watcher] Failed to watch {}: {}",
                    dir.display(),
                    e
                );
            } else {
                log::info!("[mcp-watcher] Watching {}", dir.display());
            }
        }
    }

    log::info!(
        "[mcp-watcher] Library watcher started for {}",
        library_path.display()
    );

    Ok(watcher)
}
