import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { OutputData } from "@editorjs/editorjs";

// History entry for a single state
export interface HistoryEntry {
  id: string;
  timestamp: number;
  data: OutputData;
  description?: string; // Optional description (e.g., "Added paragraph")
}

// Strip large binary data from blocks before persisting to avoid quota issues
function stripLargeDataForStorage(data: OutputData): OutputData {
  return {
    ...data,
    blocks: data.blocks.map((block) => {
      // Strip video thumbnails (base64 data URLs can be huge)
      if (block.type === "video" && block.data?.thumbnailUrl) {
        return {
          ...block,
          data: {
            ...block.data,
            thumbnailUrl: "", // Clear the base64 thumbnail
          },
        };
      }
      // Strip PDF thumbnails
      if (block.type === "pdf" && block.data?.thumbnailUrl) {
        return {
          ...block,
          data: {
            ...block.data,
            thumbnailUrl: "",
          },
        };
      }
      // Strip drawing data (can be large)
      if (block.type === "drawing" && block.data?.dataUrl) {
        return {
          ...block,
          data: {
            ...block.data,
            dataUrl: "", // Clear the base64 drawing
          },
        };
      }
      return block;
    }),
  };
}

// Custom storage that handles quota exceeded errors gracefully
const safeStorage = {
  getItem: (name: string): string | null => {
    try {
      return localStorage.getItem(name);
    } catch (error) {
      console.warn("Failed to read from localStorage:", error);
      return null;
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      localStorage.setItem(name, value);
    } catch (error) {
      if (error instanceof DOMException && error.name === "QuotaExceededError") {
        console.warn("localStorage quota exceeded, clearing undo history to free space");
        // Try to clear the undo history to free space
        try {
          localStorage.removeItem(name);
          // Try again with the new (hopefully smaller) value
          localStorage.setItem(name, value);
        } catch {
          console.error("Still unable to save undo history after clearing. Disabling persistence.");
        }
      } else {
        console.error("Failed to write to localStorage:", error);
      }
    }
  },
  removeItem: (name: string): void => {
    try {
      localStorage.removeItem(name);
    } catch (error) {
      console.warn("Failed to remove from localStorage:", error);
    }
  },
};

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
  maxHistorySize: 30, // Reduced from 50 to help prevent quota issues
  persistHistory: false,
  captureInterval: 1000, // 1 second debounce
};

// Maximum number of pages to keep history for (to prevent unbounded growth)
const MAX_PAGES_WITH_HISTORY = 20;

// Maximum allowed size for undo history storage (2MB to leave room for other data)
const MAX_STORAGE_SIZE_BYTES = 2 * 1024 * 1024;

// Startup check: Clear undo history if it's too large (helps recover from quota issues)
try {
  const stored = localStorage.getItem("nous-undo-history");
  if (stored && stored.length > MAX_STORAGE_SIZE_BYTES) {
    console.warn(`Undo history is too large (${(stored.length / 1024 / 1024).toFixed(2)}MB), clearing to prevent quota issues`);
    localStorage.removeItem("nous-undo-history");
  }
} catch (error) {
  console.warn("Error checking undo history size:", error);
  // If we can't even read it, try to clear it
  try {
    localStorage.removeItem("nous-undo-history");
  } catch {
    // Ignore
  }
}

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

        // Limit total number of pages with history to prevent unbounded growth
        let updatedHistories = { ...state.histories };
        const pageIds = Object.keys(updatedHistories);
        if (pageIds.length >= MAX_PAGES_WITH_HISTORY && !updatedHistories[pageId]) {
          // Remove the oldest page history (by oldest entry timestamp)
          let oldestPageId: string | null = null;
          let oldestTimestamp = Infinity;
          for (const pid of pageIds) {
            const firstEntry = updatedHistories[pid]?.entries[0];
            if (firstEntry && firstEntry.timestamp < oldestTimestamp) {
              oldestTimestamp = firstEntry.timestamp;
              oldestPageId = pid;
            }
          }
          if (oldestPageId) {
            delete updatedHistories[oldestPageId];
          }
        }

        set({
          histories: {
            ...updatedHistories,
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
      name: "nous-undo-history",
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => {
        // Only persist if setting is enabled
        if (!state.settings.persistHistory) {
          return { settings: state.settings };
        }
        // Strip large binary data from histories before persisting
        const strippedHistories: Record<string, PageHistory> = {};
        for (const [pageId, history] of Object.entries(state.histories)) {
          strippedHistories[pageId] = {
            ...history,
            entries: history.entries.map((entry) => ({
              ...entry,
              data: stripLargeDataForStorage(entry.data),
            })),
          };
        }
        return {
          histories: strippedHistories,
          settings: state.settings,
        };
      },
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error("Failed to rehydrate undo history, clearing:", error);
          // Clear the corrupted storage
          try {
            localStorage.removeItem("nous-undo-history");
          } catch {
            // Ignore errors when clearing
          }
          return;
        }
        if (state && !state.settings.persistHistory) {
          // Clear histories if persistence is disabled
          state.histories = {};
        }
      },
    }
  )
);
