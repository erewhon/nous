import { create } from "zustand";
import type {
  SyncStatus,
  SyncResult,
  SyncConfigInput,
  QueueItem,
} from "../types/sync";
import {
  syncTestConnection,
  syncConfigure,
  syncStatus,
  syncNow,
  syncQueueStatus,
  syncDisable,
} from "../utils/api";

interface SyncState {
  // Per-notebook sync status
  statusByNotebook: Map<string, SyncStatus>;
  // Per-notebook queue items
  queueByNotebook: Map<string, QueueItem[]>;
  // Currently syncing notebook IDs
  syncingNotebooks: Set<string>;
  // Test connection state
  isTestingConnection: boolean;
  testConnectionResult: boolean | null;
  // Configuration state
  isConfiguring: boolean;
  // Errors
  error: string | null;
}

interface SyncActions {
  // Test connection
  testConnection: (
    serverUrl: string,
    username: string,
    password: string
  ) => Promise<boolean>;
  clearTestResult: () => void;

  // Configure sync
  configure: (
    notebookId: string,
    config: SyncConfigInput
  ) => Promise<void>;

  // Get status
  loadStatus: (notebookId: string) => Promise<SyncStatus>;

  // Trigger sync
  syncNow: (notebookId: string) => Promise<SyncResult>;

  // Queue status
  loadQueueStatus: (notebookId: string) => Promise<QueueItem[]>;

  // Disable sync
  disable: (notebookId: string) => Promise<void>;

  // Clear error
  clearError: () => void;

  // Check if notebook is syncing
  isSyncing: (notebookId: string) => boolean;

  // Get status for a notebook
  getStatus: (notebookId: string) => SyncStatus | undefined;

  // Get queue for a notebook
  getQueue: (notebookId: string) => QueueItem[];
}

type SyncStore = SyncState & SyncActions;

export const useSyncStore = create<SyncStore>((set, get) => ({
  // Initial state
  statusByNotebook: new Map(),
  queueByNotebook: new Map(),
  syncingNotebooks: new Set(),
  isTestingConnection: false,
  testConnectionResult: null,
  isConfiguring: false,
  error: null,

  // Test connection
  testConnection: async (serverUrl, username, password) => {
    set({ isTestingConnection: true, testConnectionResult: null, error: null });
    try {
      const result = await syncTestConnection(serverUrl, username, password);
      set({ testConnectionResult: result, isTestingConnection: false });
      return result;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ error, isTestingConnection: false, testConnectionResult: false });
      return false;
    }
  },

  clearTestResult: () => {
    set({ testConnectionResult: null });
  },

  // Configure sync
  configure: async (notebookId, config) => {
    set({ isConfiguring: true, error: null });
    try {
      await syncConfigure(notebookId, config);
      // Reload status after configuration
      const status = await syncStatus(notebookId);
      set((state) => {
        const newStatusMap = new Map(state.statusByNotebook);
        newStatusMap.set(notebookId, status);
        return { statusByNotebook: newStatusMap, isConfiguring: false };
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ error, isConfiguring: false });
      throw e;
    }
  },

  // Load status
  loadStatus: async (notebookId) => {
    try {
      const status = await syncStatus(notebookId);
      set((state) => {
        const newStatusMap = new Map(state.statusByNotebook);
        newStatusMap.set(notebookId, status);
        return { statusByNotebook: newStatusMap };
      });
      return status;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ error });
      throw e;
    }
  },

  // Sync now
  syncNow: async (notebookId) => {
    set((state) => {
      const newSyncingSet = new Set(state.syncingNotebooks);
      newSyncingSet.add(notebookId);
      // Update status to syncing
      const newStatusMap = new Map(state.statusByNotebook);
      const currentStatus = newStatusMap.get(notebookId);
      if (currentStatus) {
        newStatusMap.set(notebookId, { ...currentStatus, status: "syncing" });
      }
      return { syncingNotebooks: newSyncingSet, statusByNotebook: newStatusMap, error: null };
    });

    try {
      const result = await syncNow(notebookId);

      // Reload status after sync
      const status = await syncStatus(notebookId);

      set((state) => {
        const newSyncingSet = new Set(state.syncingNotebooks);
        newSyncingSet.delete(notebookId);
        const newStatusMap = new Map(state.statusByNotebook);
        newStatusMap.set(notebookId, status);
        return { syncingNotebooks: newSyncingSet, statusByNotebook: newStatusMap };
      });

      return result;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set((state) => {
        const newSyncingSet = new Set(state.syncingNotebooks);
        newSyncingSet.delete(notebookId);
        // Update status to error
        const newStatusMap = new Map(state.statusByNotebook);
        const currentStatus = newStatusMap.get(notebookId);
        if (currentStatus) {
          newStatusMap.set(notebookId, { ...currentStatus, status: "error", error });
        }
        return { syncingNotebooks: newSyncingSet, statusByNotebook: newStatusMap, error };
      });
      throw e;
    }
  },

  // Load queue status
  loadQueueStatus: async (notebookId) => {
    try {
      const queue = await syncQueueStatus(notebookId);
      set((state) => {
        const newQueueMap = new Map(state.queueByNotebook);
        newQueueMap.set(notebookId, queue);
        return { queueByNotebook: newQueueMap };
      });
      return queue;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ error });
      throw e;
    }
  },

  // Disable sync
  disable: async (notebookId) => {
    try {
      await syncDisable(notebookId);
      set((state) => {
        const newStatusMap = new Map(state.statusByNotebook);
        newStatusMap.set(notebookId, {
          status: "disabled",
          pendingChanges: 0,
        });
        const newQueueMap = new Map(state.queueByNotebook);
        newQueueMap.delete(notebookId);
        return { statusByNotebook: newStatusMap, queueByNotebook: newQueueMap };
      });
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      set({ error });
      throw e;
    }
  },

  // Clear error
  clearError: () => {
    set({ error: null });
  },

  // Check if notebook is syncing
  isSyncing: (notebookId) => {
    return get().syncingNotebooks.has(notebookId);
  },

  // Get status for a notebook
  getStatus: (notebookId) => {
    return get().statusByNotebook.get(notebookId);
  },

  // Get queue for a notebook
  getQueue: (notebookId) => {
    return get().queueByNotebook.get(notebookId) ?? [];
  },
}));
