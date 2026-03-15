/**
 * Hook that manages periodic auto-sync timers for cloud notebooks.
 * Mount once at app level (App.tsx). Watches autoSyncSettings from
 * the cloud store and starts/stops setInterval timers accordingly.
 */
import { useEffect, useRef } from "react";
import { useCloudStore } from "./cloudStore";

export function useCloudAutoSync() {
  const timers = useRef(new Map<string, ReturnType<typeof setInterval>>());
  const {
    autoSyncSettings,
    syncStatus,
    notebooks,
    isAuthenticated,
    isEncryptionUnlocked,
    syncNotebook,
  } = useCloudStore();

  const unlocked = isAuthenticated && isEncryptionUnlocked();

  useEffect(() => {
    const activeTimers = timers.current;

    // Clear timers for notebooks no longer in settings
    for (const [id, timer] of activeTimers) {
      if (!autoSyncSettings[id]?.enabled) {
        clearInterval(timer);
        activeTimers.delete(id);
      }
    }

    if (!unlocked) {
      // Not ready to sync — clear all timers
      for (const [id, timer] of activeTimers) {
        clearInterval(timer);
        activeTimers.delete(id);
      }
      return;
    }

    // Start/update timers for enabled notebooks
    for (const [cloudNotebookId, setting] of Object.entries(autoSyncSettings)) {
      if (!setting.enabled) continue;

      const intervalMs = setting.intervalMinutes * 60 * 1000;
      const existing = activeTimers.get(cloudNotebookId);

      // If timer already exists with same interval, skip
      if (existing) {
        // Can't compare intervals, so always replace
        // (this runs rarely — only when settings change)
        clearInterval(existing);
      }

      const timer = setInterval(() => {
        const state = useCloudStore.getState();
        // Skip if already syncing or not unlocked
        if (state.syncStatus[cloudNotebookId] === "syncing") return;
        if (!state.isAuthenticated || !state.isEncryptionUnlocked()) return;

        // Find the local notebook ID
        const notebook = state.notebooks.find((n) => n.id === cloudNotebookId);
        if (!notebook?.localNotebookId) return;

        // Fire and forget — errors are handled inside syncNotebook
        state.syncNotebook(notebook.localNotebookId, cloudNotebookId).catch(() => {});
      }, intervalMs);

      activeTimers.set(cloudNotebookId, timer);
    }

    return () => {
      for (const timer of activeTimers.values()) {
        clearInterval(timer);
      }
      activeTimers.clear();
    };
  }, [autoSyncSettings, unlocked, notebooks, syncNotebook, syncStatus]);
}
