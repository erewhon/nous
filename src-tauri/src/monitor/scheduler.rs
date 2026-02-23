//! Monitor Scheduler
//!
//! Background scheduler that periodically captures data from monitored
//! applications using AI vision and/or accessibility scraping.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;
use uuid::Uuid;

use super::capture;
use super::models::*;
use super::storage::MonitorStorage;
use crate::inbox::{CaptureSource, InboxItem, InboxStorage};
use crate::python_bridge::PythonAI;

/// Message types for monitor scheduler communication
#[derive(Debug)]
pub enum MonitorMessage {
    /// Reload targets from storage
    Reload,
    /// Shutdown the scheduler
    Shutdown,
    /// Force immediate capture for a specific target
    CaptureNow(Uuid),
    /// Pause all monitoring
    Pause,
    /// Resume monitoring
    Resume,
}

/// Monitor scheduler that runs in the background
pub struct MonitorScheduler {
    sender: Option<mpsc::Sender<MonitorMessage>>,
}

impl MonitorScheduler {
    pub fn new() -> Self {
        Self { sender: None }
    }

    /// Start the scheduler in a background task
    pub fn start(
        &mut self,
        monitor_storage: Arc<Mutex<MonitorStorage>>,
        inbox_storage: Arc<Mutex<InboxStorage>>,
        python_ai: Arc<Mutex<PythonAI>>,
        app_handle: AppHandle,
    ) {
        let (tx, rx) = mpsc::channel(32);
        self.sender = Some(tx.clone());

        tauri::async_runtime::spawn(async move {
            scheduler_loop(monitor_storage, inbox_storage, python_ai, app_handle, rx).await;
        });

        // Trigger initial load
        let _ = tx.try_send(MonitorMessage::Reload);
    }

    /// Request scheduler to reload targets
    pub fn reload(&self) {
        if let Some(sender) = &self.sender {
            let _ = sender.try_send(MonitorMessage::Reload);
        }
    }

    /// Request immediate capture for a target
    pub fn capture_now(&self, target_id: Uuid) {
        if let Some(sender) = &self.sender {
            let _ = sender.try_send(MonitorMessage::CaptureNow(target_id));
        }
    }

    /// Pause monitoring
    pub fn pause(&self) {
        if let Some(sender) = &self.sender {
            let _ = sender.try_send(MonitorMessage::Pause);
        }
    }

    /// Resume monitoring
    pub fn resume(&self) {
        if let Some(sender) = &self.sender {
            let _ = sender.try_send(MonitorMessage::Resume);
        }
    }

    /// Shutdown the scheduler
    pub fn shutdown(&self) {
        if let Some(sender) = &self.sender {
            let _ = sender.try_send(MonitorMessage::Shutdown);
        }
    }

    /// Whether the scheduler is running
    pub fn is_running(&self) -> bool {
        self.sender.is_some()
    }
}

/// Main scheduler loop
async fn scheduler_loop(
    monitor_storage: Arc<Mutex<MonitorStorage>>,
    inbox_storage: Arc<Mutex<InboxStorage>>,
    python_ai: Arc<Mutex<PythonAI>>,
    app_handle: AppHandle,
    mut receiver: mpsc::Receiver<MonitorMessage>,
) {
    let mut targets: Vec<MonitorTarget> = Vec::new();
    let mut next_capture: HashMap<Uuid, DateTime<Utc>> = HashMap::new();
    let mut paused = false;

    loop {
        // Calculate wait duration until next due capture
        let wait_duration = if paused || targets.is_empty() {
            Duration::from_secs(5)
        } else {
            let now = Utc::now();
            let mut min_wait = Duration::from_secs(5);

            for target in &targets {
                if !target.enabled {
                    continue;
                }
                if let Some(next) = next_capture.get(&target.id) {
                    if *next <= now {
                        min_wait = Duration::from_millis(100);
                        break;
                    }
                    let wait = (*next - now)
                        .to_std()
                        .unwrap_or(Duration::from_secs(5));
                    if wait < min_wait {
                        min_wait = wait;
                    }
                }
            }

            min_wait
        };

        tokio::select! {
            _ = tokio::time::sleep(wait_duration) => {
                if paused {
                    continue;
                }

                let now = Utc::now();
                let due_targets: Vec<MonitorTarget> = targets
                    .iter()
                    .filter(|t| {
                        t.enabled
                            && next_capture
                                .get(&t.id)
                                .map(|next| *next <= now)
                                .unwrap_or(true)
                    })
                    .cloned()
                    .collect();

                for target in due_targets {
                    let event = perform_capture(
                        &target,
                        &monitor_storage,
                        &inbox_storage,
                        &python_ai,
                    );

                    if let Some(event) = event {
                        // Emit event to frontend
                        let _ = app_handle.emit("monitor-capture", &event);
                    }

                    // Schedule next capture
                    next_capture.insert(
                        target.id,
                        Utc::now() + chrono::Duration::seconds(target.interval_secs as i64),
                    );
                }
            }

            msg = receiver.recv() => {
                match msg {
                    Some(MonitorMessage::Reload) => {
                        log::info!("Monitor: Reloading targets");
                        if let Ok(storage) = monitor_storage.lock() {
                            targets = storage.list_targets().unwrap_or_default();
                        }
                        // Reset next_capture for new targets
                        let now = Utc::now();
                        for target in &targets {
                            next_capture.entry(target.id).or_insert(now);
                        }
                        // Remove entries for deleted targets
                        let target_ids: std::collections::HashSet<Uuid> =
                            targets.iter().map(|t| t.id).collect();
                        next_capture.retain(|id, _| target_ids.contains(id));
                        log::info!("Monitor: Loaded {} targets", targets.len());
                    }

                    Some(MonitorMessage::CaptureNow(target_id)) => {
                        log::info!("Monitor: Immediate capture for {}", target_id);
                        let target = targets.iter().find(|t| t.id == target_id).cloned();
                        if let Some(target) = target {
                            let event = perform_capture(
                                &target,
                                &monitor_storage,
                                &inbox_storage,
                                &python_ai,
                            );
                            if let Some(event) = event {
                                let _ = app_handle.emit("monitor-capture", &event);
                            }
                            // Reschedule
                            next_capture.insert(
                                target.id,
                                Utc::now() + chrono::Duration::seconds(target.interval_secs as i64),
                            );
                        }
                    }

                    Some(MonitorMessage::Pause) => {
                        log::info!("Monitor: Paused");
                        paused = true;
                    }

                    Some(MonitorMessage::Resume) => {
                        log::info!("Monitor: Resumed");
                        paused = false;
                    }

                    Some(MonitorMessage::Shutdown) | None => {
                        log::info!("Monitor: Shutting down");
                        break;
                    }
                }
            }
        }
    }
}

/// Perform a capture for a single target
fn perform_capture(
    target: &MonitorTarget,
    monitor_storage: &Arc<Mutex<MonitorStorage>>,
    inbox_storage: &Arc<Mutex<InboxStorage>>,
    python_ai: &Arc<Mutex<PythonAI>>,
) -> Option<CaptureEvent> {
    // Find the window
    let windows = capture::find_windows(&target.window_match);
    if windows.is_empty() {
        log::debug!(
            "Monitor: Window not found for '{}' (pattern: '{}')",
            target.name,
            target.window_match
        );
        return None;
    }

    let window = &windows[0];
    let mut event = CaptureEvent::new(
        target.id,
        target.name.clone(),
        target.capture_method.clone(),
    );

    // Capture based on method
    match &target.capture_method {
        CaptureMethod::AiVision | CaptureMethod::Both => {
            // Take screenshot
            let screenshots_dir = if let Ok(storage) = monitor_storage.lock() {
                storage.screenshots_dir().clone()
            } else {
                return None;
            };

            let screenshot_path = screenshots_dir.join(format!("{}.png", event.id));

            match capture::capture_window_screenshot(&window.window_id, &screenshot_path) {
                Ok(()) => {
                    event.screenshot_path =
                        Some(screenshot_path.to_string_lossy().to_string());

                    // Analyze with AI vision
                    if let Ok(ai) = python_ai.lock() {
                        match ai.analyze_screenshot(
                            &screenshot_path.to_string_lossy(),
                            target.watch_instructions.as_deref(),
                        ) {
                            Ok(result) => {
                                apply_vision_result(&mut event, &result);
                            }
                            Err(e) => {
                                log::warn!(
                                    "Monitor: Vision analysis failed for '{}': {}",
                                    target.name,
                                    e
                                );
                                event.content =
                                    format!("Screenshot captured but analysis failed: {}", e);
                            }
                        }
                    }
                }
                Err(e) => {
                    log::warn!(
                        "Monitor: Screenshot failed for '{}': {}",
                        target.name,
                        e
                    );
                }
            }
        }
        _ => {}
    }

    match &target.capture_method {
        CaptureMethod::Accessibility | CaptureMethod::Both => {
            // Scrape accessibility tree
            if let Ok(ai) = python_ai.lock() {
                match ai.scrape_accessibility(&target.window_match) {
                    Ok(result) => {
                        apply_accessibility_result(&mut event, &result);
                    }
                    Err(e) => {
                        log::warn!(
                            "Monitor: Accessibility scrape failed for '{}': {}",
                            target.name,
                            e
                        );
                    }
                }
            }
        }
        _ => {}
    }

    // Save the event
    if let Ok(storage) = monitor_storage.lock() {
        if let Err(e) = storage.save_event(&event) {
            log::error!("Monitor: Failed to save event: {}", e);
        }
    }

    // Send to inbox if configured
    if target.send_to_inbox && !event.content.is_empty() {
        if let Ok(storage) = inbox_storage.lock() {
            let mut inbox_item = InboxItem::new(
                format!("[{}] {}", target.name, &event.content[..event.content.len().min(100)]),
                event.content.clone(),
            );
            inbox_item = inbox_item.with_source(CaptureSource::Monitor {
                target_name: target.name.clone(),
                target_id: target.id.to_string(),
            });
            if let Err(e) = storage.save_item(&inbox_item) {
                log::error!("Monitor: Failed to save inbox item: {}", e);
            }
            event.sent_to_inbox = true;
        }

        // Update event with sent_to_inbox flag
        if let Ok(storage) = monitor_storage.lock() {
            let _ = storage.save_event(&event);
        }
    }

    Some(event)
}

/// Apply vision analysis results to a capture event
fn apply_vision_result(event: &mut CaptureEvent, result: &Value) {
    if let Some(summary) = result.get("summary").and_then(|v| v.as_str()) {
        event.content = summary.to_string();
    }

    if let Some(items) = result.get("items").and_then(|v| v.as_array()) {
        for item in items {
            let captured = CapturedItem {
                item_type: item
                    .get("item_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("other")
                    .to_string(),
                sender: item.get("sender").and_then(|v| v.as_str()).map(String::from),
                subject: item.get("subject").and_then(|v| v.as_str()).map(String::from),
                content: item
                    .get("content")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string(),
                timestamp: item
                    .get("timestamp")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                urgency: item
                    .get("urgency")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            };
            event.items.push(captured);
        }
    }
}

/// Apply accessibility scrape results to a capture event
fn apply_accessibility_result(event: &mut CaptureEvent, result: &Value) {
    // Build content from text and labels
    let mut parts = Vec::new();

    if let Some(labels) = result.get("labels").and_then(|v| v.as_array()) {
        for label in labels.iter().take(20) {
            if let Some(text) = label.as_str() {
                if !text.is_empty() {
                    parts.push(text.to_string());
                }
            }
        }
    }

    if let Some(texts) = result.get("text_content").and_then(|v| v.as_array()) {
        for text in texts.iter().take(20) {
            if let Some(t) = text.as_str() {
                if !t.is_empty() {
                    parts.push(t.to_string());
                }
            }
        }
    }

    if !parts.is_empty() {
        if event.content.is_empty() {
            event.content = parts.join("\n");
        } else {
            event.content.push_str("\n---\n");
            event.content.push_str(&parts.join("\n"));
        }
    }

    // Convert list items to captured items
    if let Some(list_items) = result.get("list_items").and_then(|v| v.as_array()) {
        for item in list_items.iter().take(50) {
            if let Some(text) = item.as_str() {
                if !text.is_empty() {
                    event.items.push(CapturedItem {
                        item_type: "list_item".to_string(),
                        sender: None,
                        subject: None,
                        content: text.to_string(),
                        timestamp: None,
                        urgency: None,
                    });
                }
            }
        }
    }
}
