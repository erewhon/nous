//! Monitor storage implementation

use std::fs;
use std::path::PathBuf;

use uuid::Uuid;

use super::models::*;
use crate::storage::StorageError;

type Result<T> = std::result::Result<T, StorageError>;

/// Storage for monitor targets and capture events
pub struct MonitorStorage {
    targets_dir: PathBuf,
    events_dir: PathBuf,
    screenshots_dir: PathBuf,
}

impl MonitorStorage {
    /// Create a new monitor storage
    pub fn new(data_dir: PathBuf) -> Result<Self> {
        let monitor_dir = data_dir.join("monitor");
        let targets_dir = monitor_dir.join("targets");
        let events_dir = monitor_dir.join("events");
        let screenshots_dir = monitor_dir.join("screenshots");

        fs::create_dir_all(&targets_dir)?;
        fs::create_dir_all(&events_dir)?;
        fs::create_dir_all(&screenshots_dir)?;

        Ok(Self {
            targets_dir,
            events_dir,
            screenshots_dir,
        })
    }

    pub fn screenshots_dir(&self) -> &PathBuf {
        &self.screenshots_dir
    }

    // --- Target CRUD ---

    fn target_path(&self, id: Uuid) -> PathBuf {
        self.targets_dir.join(format!("{}.json", id))
    }

    /// Create a new monitor target
    pub fn create_target(&self, request: CreateTargetRequest) -> Result<MonitorTarget> {
        let mut target = MonitorTarget::new(request.name, request.window_match);

        if let Some(category) = request.category {
            target.category = category;
        }
        if let Some(method) = request.capture_method {
            target.capture_method = method;
        }
        if let Some(interval) = request.interval_secs {
            target.interval_secs = interval;
        }
        if let Some(instructions) = request.watch_instructions {
            target.watch_instructions = Some(instructions);
        }
        if let Some(send) = request.send_to_inbox {
            target.send_to_inbox = send;
        }

        self.save_target(&target)?;
        Ok(target)
    }

    /// Save a monitor target
    pub fn save_target(&self, target: &MonitorTarget) -> Result<()> {
        let path = self.target_path(target.id);
        let json = serde_json::to_string_pretty(target)?;
        fs::write(path, json)?;
        Ok(())
    }

    /// Get a monitor target by ID
    pub fn get_target(&self, id: Uuid) -> Result<MonitorTarget> {
        let path = self.target_path(id);
        if !path.exists() {
            return Err(StorageError::PageNotFound(id));
        }
        let content = fs::read_to_string(path)?;
        let target: MonitorTarget = serde_json::from_str(&content)?;
        Ok(target)
    }

    /// List all monitor targets
    pub fn list_targets(&self) -> Result<Vec<MonitorTarget>> {
        let mut targets = Vec::new();

        if !self.targets_dir.exists() {
            return Ok(targets);
        }

        for entry in fs::read_dir(&self.targets_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(target) = serde_json::from_str::<MonitorTarget>(&content) {
                        targets.push(target);
                    }
                }
            }
        }

        targets.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(targets)
    }

    /// Update a monitor target
    pub fn update_target(&self, id: Uuid, request: UpdateTargetRequest) -> Result<MonitorTarget> {
        let mut target = self.get_target(id)?;

        if let Some(name) = request.name {
            target.name = name;
        }
        if let Some(window_match) = request.window_match {
            target.window_match = window_match;
        }
        if let Some(category) = request.category {
            target.category = category;
        }
        if let Some(method) = request.capture_method {
            target.capture_method = method;
        }
        if let Some(interval) = request.interval_secs {
            target.interval_secs = interval;
        }
        if let Some(enabled) = request.enabled {
            target.enabled = enabled;
        }
        if let Some(instructions) = request.watch_instructions {
            target.watch_instructions = Some(instructions);
        }
        if let Some(send) = request.send_to_inbox {
            target.send_to_inbox = send;
        }

        target.updated_at = chrono::Utc::now();
        self.save_target(&target)?;
        Ok(target)
    }

    /// Delete a monitor target
    pub fn delete_target(&self, id: Uuid) -> Result<()> {
        let path = self.target_path(id);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    // --- Event CRUD ---

    fn event_path(&self, id: Uuid) -> PathBuf {
        self.events_dir.join(format!("{}.json", id))
    }

    /// Save a capture event
    pub fn save_event(&self, event: &CaptureEvent) -> Result<()> {
        let path = self.event_path(event.id);
        let json = serde_json::to_string_pretty(event)?;
        fs::write(path, json)?;
        Ok(())
    }

    /// Get a capture event by ID
    pub fn get_event(&self, id: Uuid) -> Result<CaptureEvent> {
        let path = self.event_path(id);
        if !path.exists() {
            return Err(StorageError::PageNotFound(id));
        }
        let content = fs::read_to_string(path)?;
        let event: CaptureEvent = serde_json::from_str(&content)?;
        Ok(event)
    }

    /// List capture events, optionally filtered by target
    pub fn list_events(
        &self,
        target_id: Option<Uuid>,
        limit: Option<usize>,
    ) -> Result<Vec<CaptureEvent>> {
        let mut events = Vec::new();

        if !self.events_dir.exists() {
            return Ok(events);
        }

        for entry in fs::read_dir(&self.events_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().map(|e| e == "json").unwrap_or(false) {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(event) = serde_json::from_str::<CaptureEvent>(&content) {
                        if let Some(tid) = target_id {
                            if event.target_id != tid {
                                continue;
                            }
                        }
                        events.push(event);
                    }
                }
            }
        }

        // Sort by capture time, newest first
        events.sort_by(|a, b| b.captured_at.cmp(&a.captured_at));

        if let Some(limit) = limit {
            events.truncate(limit);
        }

        Ok(events)
    }

    /// Mark a capture event as read
    pub fn mark_read(&self, id: Uuid) -> Result<CaptureEvent> {
        let mut event = self.get_event(id)?;
        event.is_read = true;
        self.save_event(&event)?;
        Ok(event)
    }

    /// Delete a capture event (and its screenshot if any)
    pub fn delete_event(&self, id: Uuid) -> Result<()> {
        // Try to delete the screenshot
        let screenshot_path = self.screenshots_dir.join(format!("{}.png", id));
        if screenshot_path.exists() {
            let _ = fs::remove_file(screenshot_path);
        }

        let path = self.event_path(id);
        if path.exists() {
            fs::remove_file(path)?;
        }
        Ok(())
    }

    /// Clean up old events beyond a given age
    pub fn cleanup_old_events(&self, max_age_days: u32) -> Result<usize> {
        let cutoff = chrono::Utc::now()
            - chrono::Duration::days(max_age_days as i64);
        let events = self.list_events(None, None)?;
        let mut count = 0;

        for event in events {
            if event.captured_at < cutoff {
                self.delete_event(event.id)?;
                count += 1;
            }
        }

        Ok(count)
    }

    /// Count unread events
    pub fn unread_count(&self) -> Result<usize> {
        let events = self.list_events(None, None)?;
        Ok(events.iter().filter(|e| !e.is_read).count())
    }
}
