//! Event emitter abstraction for sync operations.
//!
//! Decouples sync from Tauri so it can run in the daemon (headless) context.

use super::manager::{
    SyncContactsUpdated, SyncEnergyUpdated, SyncGoalsUpdated, SyncInboxUpdated, SyncPagesUpdated,
    SyncProgress,
};

/// Trait for emitting sync events to a frontend or log sink.
pub trait SyncEventEmitter: Send + Sync {
    fn emit_sync_progress(&self, payload: &SyncProgress);
    fn emit_sync_pages_updated(&self, payload: &SyncPagesUpdated);
    fn emit_sync_notebook_updated(&self, notebook_id: &str);
    fn emit_sync_goals_updated(&self, payload: &SyncGoalsUpdated);
    fn emit_sync_inbox_updated(&self, payload: &SyncInboxUpdated);
    fn emit_sync_contacts_updated(&self, payload: &SyncContactsUpdated);
    fn emit_sync_energy_updated(&self, payload: &SyncEnergyUpdated);
}

/// Emitter that sends events via Tauri's `AppHandle` (GUI context).
pub struct TauriEmitter {
    app_handle: tauri::AppHandle,
}

impl TauriEmitter {
    pub fn new(app_handle: tauri::AppHandle) -> Self {
        Self { app_handle }
    }
}

impl SyncEventEmitter for TauriEmitter {
    fn emit_sync_progress(&self, payload: &SyncProgress) {
        use tauri::Emitter;
        let _ = self.app_handle.emit("sync-progress", payload);
    }

    fn emit_sync_pages_updated(&self, payload: &SyncPagesUpdated) {
        use tauri::Emitter;
        let _ = self.app_handle.emit("sync-pages-updated", payload);
    }

    fn emit_sync_notebook_updated(&self, notebook_id: &str) {
        use tauri::Emitter;
        let _ = self.app_handle.emit(
            "sync-notebook-updated",
            serde_json::json!({ "notebookId": notebook_id }),
        );
    }

    fn emit_sync_goals_updated(&self, payload: &SyncGoalsUpdated) {
        use tauri::Emitter;
        let _ = self.app_handle.emit("sync-goals-updated", payload);
    }

    fn emit_sync_inbox_updated(&self, payload: &SyncInboxUpdated) {
        use tauri::Emitter;
        let _ = self.app_handle.emit("sync-inbox-updated", payload);
    }

    fn emit_sync_contacts_updated(&self, payload: &SyncContactsUpdated) {
        use tauri::Emitter;
        let _ = self.app_handle.emit("sync-contacts-updated", payload);
    }

    fn emit_sync_energy_updated(&self, payload: &SyncEnergyUpdated) {
        use tauri::Emitter;
        let _ = self.app_handle.emit("sync-energy-updated", payload);
    }
}

/// Emitter that logs events (daemon / headless context).
pub struct LogEmitter;

impl SyncEventEmitter for LogEmitter {
    fn emit_sync_progress(&self, payload: &SyncProgress) {
        log::info!(
            "sync-progress: notebook={} phase={} {}/{} {}",
            payload.notebook_name,
            payload.phase,
            payload.current,
            payload.total,
            payload.message,
        );
    }

    fn emit_sync_pages_updated(&self, payload: &SyncPagesUpdated) {
        log::info!(
            "sync-pages-updated: notebook={} pages={:?}",
            payload.notebook_id,
            payload.page_ids,
        );
    }

    fn emit_sync_notebook_updated(&self, notebook_id: &str) {
        log::info!("sync-notebook-updated: notebook={}", notebook_id);
    }

    fn emit_sync_goals_updated(&self, payload: &SyncGoalsUpdated) {
        log::info!(
            "sync-goals-updated: goals_changed={} progress_changed={}",
            payload.goals_changed,
            payload.progress_changed,
        );
    }

    fn emit_sync_inbox_updated(&self, payload: &SyncInboxUpdated) {
        log::info!(
            "sync-inbox-updated: inbox_changed={}",
            payload.inbox_changed,
        );
    }

    fn emit_sync_contacts_updated(&self, payload: &SyncContactsUpdated) {
        log::info!(
            "sync-contacts-updated: contacts_changed={} activities_changed={}",
            payload.contacts_changed,
            payload.activities_changed,
        );
    }

    fn emit_sync_energy_updated(&self, payload: &SyncEnergyUpdated) {
        log::info!(
            "sync-energy-updated: energy_changed={}",
            payload.energy_changed,
        );
    }
}
