//! Rust-side freeze watchdog.
//!
//! Spawns a background thread that pings the frontend every 2 seconds.
//! The frontend responds via invoke("freeze_pong") with its breadcrumb trail.
//! If no pong arrives within 5 seconds, the watchdog logs the last known
//! breadcrumbs and dumps thread stacks from /proc/self/task/*/stack.

use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

/// State shared between the watchdog thread and the pong command handler.
pub struct WatchdogState {
    pub last_pong: Mutex<Instant>,
    pub last_breadcrumbs: Mutex<String>,
}

impl WatchdogState {
    pub fn new() -> Self {
        Self {
            last_pong: Mutex::new(Instant::now()),
            last_breadcrumbs: Mutex::new(String::new()),
        }
    }
}

/// Tauri command: frontend calls this in response to "freeze-ping" events.
#[tauri::command]
pub fn freeze_pong(breadcrumbs: String, state: tauri::State<'_, Arc<WatchdogState>>) {
    if let Ok(mut last) = state.last_pong.lock() {
        *last = Instant::now();
    }
    if let Ok(mut bc) = state.last_breadcrumbs.lock() {
        *bc = breadcrumbs;
    }
}

/// Read kernel-level stack traces for all threads in this process.
/// Only works on Linux (/proc/self/task/).
fn dump_thread_stacks() -> String {
    let mut output = String::new();

    let task_dir = std::path::Path::new("/proc/self/task");
    if !task_dir.exists() {
        return "(/proc/self/task not available)".to_string();
    }

    if let Ok(entries) = std::fs::read_dir(task_dir) {
        for entry in entries.flatten() {
            let tid = entry.file_name();
            let stack_path = entry.path().join("stack");
            if let Ok(stack) = std::fs::read_to_string(&stack_path) {
                output.push_str(&format!("\n--- Thread {} ---\n{}", tid.to_string_lossy(), stack));
            }

            // Also try to read /proc/self/task/<tid>/status for thread name
            let status_path = entry.path().join("status");
            if let Ok(status) = std::fs::read_to_string(&status_path) {
                for line in status.lines() {
                    if line.starts_with("Name:") {
                        output.push_str(&format!("  {}\n", line));
                        break;
                    }
                }
            }
        }
    }

    output
}

/// Start the watchdog thread. Call from setup hook.
pub fn start_watchdog(app_handle: AppHandle, watchdog_state: Arc<WatchdogState>) {
    std::thread::Builder::new()
        .name("freeze-watchdog".to_string())
        .spawn(move || {
            log::info!("[FreezeWatchdog] Started");

            // Give the app time to initialize before monitoring
            std::thread::sleep(Duration::from_secs(10));

            let mut freeze_logged = false;

            loop {
                std::thread::sleep(Duration::from_secs(2));

                // Emit ping to frontend
                if let Err(e) = app_handle.emit("freeze-ping", ()) {
                    log::warn!("[FreezeWatchdog] Failed to emit ping: {}", e);
                    continue;
                }

                // Check time since last pong
                let elapsed = if let Ok(last) = watchdog_state.last_pong.lock() {
                    last.elapsed()
                } else {
                    continue;
                };

                if elapsed > Duration::from_secs(5) {
                    if !freeze_logged {
                        freeze_logged = true;

                        let breadcrumbs = watchdog_state
                            .last_breadcrumbs
                            .lock()
                            .map(|bc| bc.clone())
                            .unwrap_or_default();

                        log::error!(
                            "[FreezeWatchdog] FRONTEND FROZEN — no pong for {:.1}s",
                            elapsed.as_secs_f64()
                        );
                        log::error!(
                            "[FreezeWatchdog] Last breadcrumbs:\n{}",
                            if breadcrumbs.is_empty() {
                                "(none)".to_string()
                            } else {
                                breadcrumbs
                            }
                        );

                        let stacks = dump_thread_stacks();
                        log::error!("[FreezeWatchdog] Thread stacks:\n{}", stacks);
                    }
                } else {
                    if freeze_logged {
                        log::info!(
                            "[FreezeWatchdog] Frontend recovered after freeze"
                        );
                    }
                    freeze_logged = false;
                }
            }
        })
        .expect("Failed to spawn freeze watchdog thread");
}
