import { create } from "zustand";
import type {
  InboxItem,
  InboxSummary,
  CaptureRequest,
  ApplyActionsResult,
  ActionOverride,
} from "../types/inbox";
import {
  inboxCapture,
  inboxList,
  inboxListUnprocessed,
  inboxSummary,
  inboxClassify,
  inboxApplyActions,
  inboxDelete,
  inboxClearProcessed,
} from "../utils/api";

interface InboxState {
  items: InboxItem[];
  summary: InboxSummary | null;
  isLoading: boolean;
  isClassifying: boolean;
  isApplying: boolean;
  error: string | null;
  selectedItemIds: Set<string>;
  actionOverrides: Map<string, ActionOverride>;
  showQuickCapture: boolean;
  showInboxPanel: boolean;
}

interface InboxActions {
  // Data fetching
  loadItems: () => Promise<void>;
  loadUnprocessed: () => Promise<void>;
  loadSummary: () => Promise<void>;
  refresh: () => Promise<void>;

  // Capture
  capture: (request: CaptureRequest) => Promise<InboxItem>;
  quickCapture: (title: string, content?: string, tags?: string[]) => Promise<InboxItem>;

  // Classification
  classifyItems: (itemIds?: string[]) => Promise<InboxItem[]>;
  classifyAll: () => Promise<InboxItem[]>;

  // Processing
  applyActions: (itemIds?: string[]) => Promise<ApplyActionsResult>;
  applySelected: () => Promise<ApplyActionsResult>;

  // Selection
  selectItem: (itemId: string) => void;
  deselectItem: (itemId: string) => void;
  toggleItem: (itemId: string) => void;
  selectAll: () => void;
  deselectAll: () => void;

  // Overrides
  setOverride: (override: ActionOverride) => void;
  clearOverride: (itemId: string) => void;
  clearAllOverrides: () => void;

  // Delete
  deleteItem: (itemId: string) => Promise<void>;
  deleteSelected: () => Promise<void>;
  clearProcessed: () => Promise<number>;

  // UI state
  openQuickCapture: () => void;
  closeQuickCapture: () => void;
  toggleQuickCapture: () => void;
  openInboxPanel: () => void;
  closeInboxPanel: () => void;
  toggleInboxPanel: () => void;
  clearError: () => void;
}

type InboxStore = InboxState & InboxActions;

export const useInboxStore = create<InboxStore>()((set, get) => ({
  // Initial state
  items: [],
  summary: null,
  isLoading: false,
  isClassifying: false,
  isApplying: false,
  error: null,
  selectedItemIds: new Set(),
  actionOverrides: new Map(),
  showQuickCapture: false,
  showInboxPanel: false,

  // Data fetching
  loadItems: async () => {
    set({ isLoading: true, error: null });
    try {
      const items = await inboxList();
      set({ items, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  loadUnprocessed: async () => {
    set({ isLoading: true, error: null });
    try {
      const items = await inboxListUnprocessed();
      set({ items, isLoading: false });
    } catch (err) {
      set({ error: String(err), isLoading: false });
    }
  },

  loadSummary: async () => {
    try {
      const summary = await inboxSummary();
      set({ summary });
    } catch (err) {
      set({ error: String(err) });
    }
  },

  refresh: async () => {
    const { loadUnprocessed, loadSummary } = get();
    await Promise.all([loadUnprocessed(), loadSummary()]);
  },

  // Capture
  capture: async (request: CaptureRequest) => {
    set({ isLoading: true, error: null });
    try {
      const item = await inboxCapture(request);
      set((state) => ({
        items: [item, ...state.items],
        isLoading: false,
      }));
      // Refresh summary
      get().loadSummary();
      return item;
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  quickCapture: async (title: string, content?: string, tags?: string[]) => {
    return get().capture({
      title,
      content: content || "",
      tags: tags || [],
      source: { type: "quickCapture" },
    });
  },

  // Classification
  classifyItems: async (itemIds?: string[]) => {
    set({ isClassifying: true, error: null });
    try {
      const classifiedItems = await inboxClassify(itemIds);
      // Update the items in state with their classifications
      set((state) => ({
        items: state.items.map((item) => {
          const classified = classifiedItems.find((c) => c.id === item.id);
          return classified || item;
        }),
        isClassifying: false,
      }));
      return classifiedItems;
    } catch (err) {
      set({ error: String(err), isClassifying: false });
      throw err;
    }
  },

  classifyAll: async () => {
    return get().classifyItems();
  },

  // Processing
  applyActions: async (itemIds?: string[]) => {
    const { selectedItemIds, actionOverrides } = get();
    const idsToProcess = itemIds || Array.from(selectedItemIds);

    if (idsToProcess.length === 0) {
      throw new Error("No items selected");
    }

    // Build overrides array from the map
    const overrides = idsToProcess
      .map((id) => actionOverrides.get(id))
      .filter((o): o is ActionOverride => o !== undefined);

    set({ isApplying: true, error: null });
    try {
      const result = await inboxApplyActions({
        item_ids: idsToProcess,
        overrides: overrides.length > 0 ? overrides : undefined,
      });

      // Remove processed items from the list
      set((state) => ({
        items: state.items.filter(
          (item) => !idsToProcess.includes(item.id) || !result.processed_count
        ),
        selectedItemIds: new Set(),
        isApplying: false,
      }));

      // Refresh summary
      get().loadSummary();
      return result;
    } catch (err) {
      set({ error: String(err), isApplying: false });
      throw err;
    }
  },

  applySelected: async () => {
    return get().applyActions();
  },

  // Selection
  selectItem: (itemId: string) => {
    set((state) => ({
      selectedItemIds: new Set([...state.selectedItemIds, itemId]),
    }));
  },

  deselectItem: (itemId: string) => {
    set((state) => {
      const newSet = new Set(state.selectedItemIds);
      newSet.delete(itemId);
      return { selectedItemIds: newSet };
    });
  },

  toggleItem: (itemId: string) => {
    const { selectedItemIds } = get();
    if (selectedItemIds.has(itemId)) {
      get().deselectItem(itemId);
    } else {
      get().selectItem(itemId);
    }
  },

  selectAll: () => {
    set((state) => ({
      selectedItemIds: new Set(state.items.map((i) => i.id)),
    }));
  },

  deselectAll: () => {
    set({ selectedItemIds: new Set() });
  },

  // Overrides
  setOverride: (override: ActionOverride) => {
    set((state) => {
      const newMap = new Map(state.actionOverrides);
      newMap.set(override.item_id, override);
      return { actionOverrides: newMap };
    });
  },

  clearOverride: (itemId: string) => {
    set((state) => {
      const newMap = new Map(state.actionOverrides);
      newMap.delete(itemId);
      return { actionOverrides: newMap };
    });
  },

  clearAllOverrides: () => {
    set({ actionOverrides: new Map() });
  },

  // Delete
  deleteItem: async (itemId: string) => {
    set({ isLoading: true, error: null });
    try {
      await inboxDelete(itemId);
      set((state) => ({
        items: state.items.filter((i) => i.id !== itemId),
        isLoading: false,
      }));
      get().loadSummary();
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  deleteSelected: async () => {
    const { selectedItemIds } = get();
    set({ isLoading: true, error: null });
    try {
      await Promise.all(Array.from(selectedItemIds).map((id) => inboxDelete(id)));
      set((state) => ({
        items: state.items.filter((i) => !selectedItemIds.has(i.id)),
        selectedItemIds: new Set(),
        isLoading: false,
      }));
      get().loadSummary();
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  clearProcessed: async () => {
    set({ isLoading: true, error: null });
    try {
      const count = await inboxClearProcessed();
      await get().refresh();
      set({ isLoading: false });
      return count;
    } catch (err) {
      set({ error: String(err), isLoading: false });
      throw err;
    }
  },

  // UI state
  openQuickCapture: () => set({ showQuickCapture: true }),
  closeQuickCapture: () => set({ showQuickCapture: false }),
  toggleQuickCapture: () => set((state) => ({ showQuickCapture: !state.showQuickCapture })),

  openInboxPanel: () => set({ showInboxPanel: true }),
  closeInboxPanel: () => set({ showInboxPanel: false }),
  toggleInboxPanel: () => set((state) => ({ showInboxPanel: !state.showInboxPanel })),

  clearError: () => set({ error: null }),
}));
