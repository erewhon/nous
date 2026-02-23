//! Tauri commands for app monitoring operations

use tauri::State;
use uuid::Uuid;

use crate::monitor::{
    CaptureEvent, CreateTargetRequest, MonitorTarget, UpdateTargetRequest, WindowInfo,
};
use crate::AppState;

type CommandResult<T> = Result<T, String>;

// --- Target management ---

/// List all monitor targets
#[tauri::command]
pub fn monitor_list_targets(state: State<AppState>) -> CommandResult<Vec<MonitorTarget>> {
    let storage = state.monitor_storage.lock().map_err(|e| e.to_string())?;
    storage.list_targets().map_err(|e| e.to_string())
}

/// Get a specific monitor target
#[tauri::command]
pub fn monitor_get_target(
    state: State<AppState>,
    target_id: Uuid,
) -> CommandResult<MonitorTarget> {
    let storage = state.monitor_storage.lock().map_err(|e| e.to_string())?;
    storage.get_target(target_id).map_err(|e| e.to_string())
}

/// Create a new monitor target
#[tauri::command]
pub fn monitor_create_target(
    state: State<AppState>,
    request: CreateTargetRequest,
) -> CommandResult<MonitorTarget> {
    let storage = state.monitor_storage.lock().map_err(|e| e.to_string())?;
    let target = storage.create_target(request).map_err(|e| e.to_string())?;

    // Reload scheduler so it picks up the new target
    if let Ok(scheduler) = state.monitor_scheduler.lock() {
        if let Some(s) = scheduler.as_ref() {
            s.reload();
        }
    }

    Ok(target)
}

/// Update a monitor target
#[tauri::command]
pub fn monitor_update_target(
    state: State<AppState>,
    target_id: Uuid,
    request: UpdateTargetRequest,
) -> CommandResult<MonitorTarget> {
    let storage = state.monitor_storage.lock().map_err(|e| e.to_string())?;
    let target = storage
        .update_target(target_id, request)
        .map_err(|e| e.to_string())?;

    // Reload scheduler
    drop(storage);
    if let Ok(scheduler) = state.monitor_scheduler.lock() {
        if let Some(s) = scheduler.as_ref() {
            s.reload();
        }
    }

    Ok(target)
}

/// Delete a monitor target
#[tauri::command]
pub fn monitor_delete_target(state: State<AppState>, target_id: Uuid) -> CommandResult<()> {
    let storage = state.monitor_storage.lock().map_err(|e| e.to_string())?;
    storage.delete_target(target_id).map_err(|e| e.to_string())?;

    // Reload scheduler
    drop(storage);
    if let Ok(scheduler) = state.monitor_scheduler.lock() {
        if let Some(s) = scheduler.as_ref() {
            s.reload();
        }
    }

    Ok(())
}

// --- Capture operations ---

/// Force an immediate capture for a target
#[tauri::command]
pub fn monitor_capture_now(state: State<AppState>, target_id: Uuid) -> CommandResult<()> {
    let scheduler = state.monitor_scheduler.lock().map_err(|e| e.to_string())?;
    if let Some(s) = scheduler.as_ref() {
        s.capture_now(target_id);
        Ok(())
    } else {
        Err("Monitor scheduler not running".to_string())
    }
}

/// List capture events
#[tauri::command]
pub fn monitor_list_events(
    state: State<AppState>,
    target_id: Option<Uuid>,
    limit: Option<usize>,
) -> CommandResult<Vec<CaptureEvent>> {
    let storage = state.monitor_storage.lock().map_err(|e| e.to_string())?;
    storage
        .list_events(target_id, limit)
        .map_err(|e| e.to_string())
}

/// Mark a capture event as read
#[tauri::command]
pub fn monitor_mark_read(state: State<AppState>, event_id: Uuid) -> CommandResult<CaptureEvent> {
    let storage = state.monitor_storage.lock().map_err(|e| e.to_string())?;
    storage.mark_read(event_id).map_err(|e| e.to_string())
}

/// Dismiss (delete) a capture event
#[tauri::command]
pub fn monitor_dismiss_event(state: State<AppState>, event_id: Uuid) -> CommandResult<()> {
    let storage = state.monitor_storage.lock().map_err(|e| e.to_string())?;
    storage.delete_event(event_id).map_err(|e| e.to_string())
}

// --- Scheduler control ---

/// Start the monitor scheduler
#[tauri::command]
pub fn monitor_start(state: State<AppState>, app_handle: tauri::AppHandle) -> CommandResult<()> {
    let mut scheduler = state.monitor_scheduler.lock().map_err(|e| e.to_string())?;

    if scheduler.as_ref().map(|s| s.is_running()).unwrap_or(false) {
        return Ok(()); // Already running
    }

    let mut new_scheduler = crate::monitor::scheduler::MonitorScheduler::new();
    new_scheduler.start(
        state.monitor_storage.clone(),
        state.inbox_storage.clone(),
        state.python_ai.clone(),
        app_handle,
    );
    *scheduler = Some(new_scheduler);

    Ok(())
}

/// Stop the monitor scheduler
#[tauri::command]
pub fn monitor_stop(state: State<AppState>) -> CommandResult<()> {
    let mut scheduler = state.monitor_scheduler.lock().map_err(|e| e.to_string())?;
    if let Some(s) = scheduler.as_ref() {
        s.shutdown();
    }
    *scheduler = None;
    Ok(())
}

// --- Discovery ---

/// List all visible windows for the target picker
#[tauri::command]
pub fn monitor_list_windows() -> CommandResult<Vec<WindowInfo>> {
    Ok(crate::monitor::capture::list_all_windows())
}

/// Get unread event count
#[tauri::command]
pub fn monitor_unread_count(state: State<AppState>) -> CommandResult<usize> {
    let storage = state.monitor_storage.lock().map_err(|e| e.to_string())?;
    storage.unread_count().map_err(|e| e.to_string())
}
