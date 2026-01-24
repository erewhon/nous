import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OutputData } from "@editorjs/editorjs";

// History entry for a single state
export interface HistoryEntry {
  id: string;
  timestamp: number;
  data: OutputData;
  description?: string; // Optional description (e.g., "Added paragraph")
}

// History for a single page
interface PageHistory {
  entries: HistoryEntry[];
  currentIndex: number; // Points to current state (-1 means at latest)
}

// Settings for undo history
export interface UndoHistorySettings {
  maxHistorySize: number; // Max entries per page
  persistHistory: boolean; // Whether to persist across sessions
  captureInterval: number; // Minimum ms between captures (debounce)
}

const DEFAULT_SETTINGS: UndoHistorySettings = {
  maxHistorySize: 50,
  persistHistory: false,
  captureInterval: 1000, // 1 second debounce
};

interface UndoHistoryState {
  // Map of pageId -> PageHistory
  histories: Record<string, PageHistory>;
  settings: UndoHistorySettings;

  // Actions
  pushState: (pageId: string, data: OutputData, description?: string) => void;
  undo: (pageId: string) => OutputData | null;
  redo: (pageId: string) => OutputData | null;
  jumpToState: (pageId: string, entryId: string) => OutputData | null;
  getHistory: (pageId: string) => PageHistory | null;
  getCurrentIndex: (pageId: string) => number;
  canUndo: (pageId: string) => boolean;
  canRedo: (pageId: string) => boolean;
  clearHistory: (pageId: string) => void;
  clearAllHistory: () => void;
  setSettings: (settings: Partial<UndoHistorySettings>) => void;
}

// Generate unique ID for history entries
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Deep clone OutputData to avoid reference issues
function cloneData(data: OutputData): OutputData {
  return JSON.parse(JSON.stringify(data));
}

// Check if two OutputData objects are equal (shallow comparison of blocks)
function isDataEqual(a: OutputData, b: OutputData): boolean {
  if (a.blocks.length !== b.blocks.length) return false;
  return JSON.stringify(a.blocks) === JSON.stringify(b.blocks);
}

export const useUndoHistoryStore = create<UndoHistoryState>()(
  persist(
    (set, get) => ({
      histories: {},
      settings: DEFAULT_SETTINGS,

      pushState: (pageId, data, description) => {
        const state = get();
        const history = state.histories[pageId] || { entries: [], currentIndex: -1 };
        const { maxHistorySize } = state.settings;

        // Don't push if data is identical to the latest entry
        if (history.entries.length > 0) {
          const latestIndex = history.currentIndex === -1
            ? history.entries.length - 1
            : history.currentIndex;
          const latestEntry = history.entries[latestIndex];
          if (latestEntry && isDataEqual(latestEntry.data, data)) {
            return; // Skip duplicate state
          }
        }

        // If we're not at the end of history, truncate future entries
        let entries = [...history.entries];
        if (history.currentIndex !== -1 && history.currentIndex < entries.length - 1) {
          entries = entries.slice(0, history.currentIndex + 1);
        }

        // Add new entry
        const newEntry: HistoryEntry = {
          id: generateId(),
          timestamp: Date.now(),
          data: cloneData(data),
          description,
        };
        entries.push(newEntry);

        // Trim to max size (remove oldest entries)
        if (entries.length > maxHistorySize) {
          entries = entries.slice(entries.length - maxHistorySize);
        }

        set({
          histories: {
            ...state.histories,
            [pageId]: {
              entries,
              currentIndex: -1, // Reset to end
            },
          },
        });
      },

      undo: (pageId) => {
        const state = get();
        const history = state.histories[pageId];
        if (!history || history.entries.length === 0) return null;

        // Calculate current position
        const currentIndex = history.currentIndex === -1
          ? history.entries.length - 1
          : history.currentIndex;

        // Can't undo if at the beginning
        if (currentIndex <= 0) return null;

        const newIndex = currentIndex - 1;
        const entry = history.entries[newIndex];

        set({
          histories: {
            ...state.histories,
            [pageId]: {
              ...history,
              currentIndex: newIndex,
            },
          },
        });

        return cloneData(entry.data);
      },

      redo: (pageId) => {
        const state = get();
        const history = state.histories[pageId];
        if (!history || history.entries.length === 0) return null;

        // Can't redo if already at the end
        if (history.currentIndex === -1) return null;

        const newIndex = history.currentIndex + 1;

        // Check if we're at the end
        if (newIndex >= history.entries.length) return null;

        const entry = history.entries[newIndex];

        set({
          histories: {
            ...state.histories,
            [pageId]: {
              ...history,
              currentIndex: newIndex === history.entries.length - 1 ? -1 : newIndex,
            },
          },
        });

        return cloneData(entry.data);
      },

      jumpToState: (pageId, entryId) => {
        const state = get();
        const history = state.histories[pageId];
        if (!history) return null;

        const entryIndex = history.entries.findIndex((e) => e.id === entryId);
        if (entryIndex === -1) return null;

        const entry = history.entries[entryIndex];

        set({
          histories: {
            ...state.histories,
            [pageId]: {
              ...history,
              currentIndex: entryIndex === history.entries.length - 1 ? -1 : entryIndex,
            },
          },
        });

        return cloneData(entry.data);
      },

      getHistory: (pageId) => {
        return get().histories[pageId] || null;
      },

      getCurrentIndex: (pageId) => {
        const history = get().histories[pageId];
        if (!history) return -1;
        return history.currentIndex === -1 ? history.entries.length - 1 : history.currentIndex;
      },

      canUndo: (pageId) => {
        const history = get().histories[pageId];
        if (!history || history.entries.length === 0) return false;
        const currentIndex = history.currentIndex === -1
          ? history.entries.length - 1
          : history.currentIndex;
        return currentIndex > 0;
      },

      canRedo: (pageId) => {
        const history = get().histories[pageId];
        if (!history || history.entries.length === 0) return false;
        return history.currentIndex !== -1 && history.currentIndex < history.entries.length - 1;
      },

      clearHistory: (pageId) => {
        const state = get();
        const { [pageId]: _, ...rest } = state.histories;
        set({ histories: rest });
      },

      clearAllHistory: () => {
        set({ histories: {} });
      },

      setSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }));
      },
    }),
    {
      name: "katt-undo-history",
      partialize: (state) => {
        // Only persist if setting is enabled
        if (!state.settings.persistHistory) {
          return { settings: state.settings };
        }
        return {
          histories: state.histories,
          settings: state.settings,
        };
      },
      onRehydrateStorage: () => (state) => {
        if (state && !state.settings.persistHistory) {
          // Clear histories if persistence is disabled
          state.histories = {};
        }
      },
    }
  )
);
