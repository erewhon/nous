import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Notebook, NotebookType } from "../types/notebook";
import { usePageStore } from "./pageStore";
import { useSectionStore } from "./sectionStore";
import * as api from "../utils/api";

interface NotebookViewState {
  sectionId: string | null;
  pageId: string | null;
}

interface NotebookState {
  notebooks: Notebook[];
  selectedNotebookId: string | null;
  showArchived: boolean;
  isLoading: boolean;
  error: string | null;
  /** Remembers the last viewed section and page for each notebook */
  notebookViewState: Record<string, NotebookViewState>;
}

interface NotebookActions {
  // Data loading
  loadNotebooks: () => Promise<void>;

  // Notebook CRUD
  createNotebook: (name: string, type?: NotebookType) => Promise<void>;
  updateNotebook: (id: string, updates: Partial<Notebook>) => Promise<void>;
  deleteNotebook: (id: string) => Promise<void>;
  archiveNotebook: (id: string) => Promise<void>;
  unarchiveNotebook: (id: string) => Promise<void>;

  // Reordering
  reorderNotebooks: (notebookIds: string[]) => Promise<void>;

  // Selection
  selectNotebook: (id: string | null) => void;

  // View state memory
  saveNotebookViewState: (notebookId: string, sectionId: string | null, pageId: string | null) => void;
  getNotebookViewState: (notebookId: string) => NotebookViewState | null;

  // Archive visibility
  toggleShowArchived: () => void;

  // Pinning
  togglePinned: (id: string) => Promise<void>;

  // Computed
  getVisibleNotebooks: () => Notebook[];
  getArchivedNotebooks: () => Notebook[];
  getPinnedNotebooks: () => Notebook[];

  // Error handling
  clearError: () => void;
}

type NotebookStore = NotebookState & NotebookActions;

export const useNotebookStore = create<NotebookStore>()(
  persist(
    (set, get) => ({
  // Initial state
  notebooks: [],
  selectedNotebookId: null,
  showArchived: false,
  isLoading: false,
  error: null,
  notebookViewState: {},

  // Actions
  loadNotebooks: async () => {
    set({ isLoading: true, error: null });
    try {
      const notebooks = await api.listNotebooks();
      set({ notebooks, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load notebooks",
        isLoading: false,
      });
    }
  },

  createNotebook: async (name, type = "standard") => {
    set({ error: null });
    try {
      const notebook = await api.createNotebook(name, type);
      set((state) => ({
        notebooks: [notebook, ...state.notebooks],
        selectedNotebookId: notebook.id,
      }));

      // Auto-configure sync if library has sync enabled
      try {
        const currentLibrary = await api.getCurrentLibrary();
        if (currentLibrary.syncConfig?.enabled) {
          await api.librarySyncConfigureNotebook(currentLibrary.id, notebook.id);
        }
      } catch (syncErr) {
        // Don't fail notebook creation if sync auto-config fails
        console.warn("Failed to auto-configure sync for new notebook:", syncErr);
      }
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to create notebook",
      });
    }
  },

  updateNotebook: async (id, updates) => {
    set({ error: null });
    try {
      const notebook = await api.updateNotebook(id, updates);
      set((state) => ({
        notebooks: state.notebooks.map((n) => (n.id === id ? notebook : n)),
      }));
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to update notebook",
      });
    }
  },

  deleteNotebook: async (id) => {
    set({ error: null });
    try {
      await api.deleteNotebook(id);
      set((state) => ({
        notebooks: state.notebooks.filter((n) => n.id !== id),
        selectedNotebookId:
          state.selectedNotebookId === id ? null : state.selectedNotebookId,
      }));
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to delete notebook",
      });
    }
  },

  archiveNotebook: async (id) => {
    set({ error: null });
    try {
      const notebook = await api.updateNotebook(id, { archived: true });
      set((state) => ({
        notebooks: state.notebooks.map((n) => (n.id === id ? notebook : n)),
        // Deselect if the archived notebook was selected and we're not showing archived
        selectedNotebookId:
          state.selectedNotebookId === id && !state.showArchived
            ? null
            : state.selectedNotebookId,
      }));
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to archive notebook",
      });
    }
  },

  unarchiveNotebook: async (id) => {
    set({ error: null });
    try {
      const notebook = await api.updateNotebook(id, { archived: false });
      set((state) => ({
        notebooks: state.notebooks.map((n) => (n.id === id ? notebook : n)),
      }));
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to unarchive notebook",
      });
    }
  },

  reorderNotebooks: async (notebookIds) => {
    set({ error: null });
    try {
      await api.reorderNotebooks(notebookIds);
      // Update local state with new positions
      set((state) => {
        const updatedNotebooks = state.notebooks.map((n) => {
          const idx = notebookIds.indexOf(n.id);
          if (idx !== -1) {
            return { ...n, position: idx };
          }
          return n;
        });
        // Sort by position
        updatedNotebooks.sort((a, b) => a.position - b.position);
        return { notebooks: updatedNotebooks };
      });
    } catch (err) {
      set({
        error:
          err instanceof Error ? err.message : "Failed to reorder notebooks",
      });
    }
  },

  selectNotebook: (id) => {
    const currentId = get().selectedNotebookId;
    if (currentId && currentId !== id) {
      const pageId = usePageStore.getState().selectedPageId;
      const sectionId = useSectionStore.getState().selectedSectionId;
      set((state) => ({
        notebookViewState: {
          ...state.notebookViewState,
          [currentId]: { sectionId, pageId },
        },
      }));
    }
    set({ selectedNotebookId: id });
  },

  saveNotebookViewState: (notebookId, sectionId, pageId) => {
    set((state) => ({
      notebookViewState: {
        ...state.notebookViewState,
        [notebookId]: { sectionId, pageId },
      },
    }));
  },

  getNotebookViewState: (notebookId) => {
    return get().notebookViewState[notebookId] ?? null;
  },

  toggleShowArchived: () => {
    set((state) => ({ showArchived: !state.showArchived }));
  },

  togglePinned: async (id) => {
    const state = get();
    const notebook = state.notebooks.find((n) => n.id === id);
    if (!notebook) return;

    const newPinned = !notebook.isPinned;
    set({ error: null });
    try {
      const updated = await api.updateNotebook(id, { isPinned: newPinned });
      set((state) => ({
        notebooks: state.notebooks.map((n) => (n.id === id ? updated : n)),
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to toggle pinned",
      });
    }
  },

  getVisibleNotebooks: () => {
    const { notebooks, showArchived } = get();
    if (showArchived) {
      return notebooks;
    }
    return notebooks.filter((n) => !n.archived);
  },

  getArchivedNotebooks: () => {
    const { notebooks } = get();
    return notebooks.filter((n) => n.archived);
  },

  getPinnedNotebooks: () => {
    const { notebooks } = get();
    return notebooks.filter((n) => n.isPinned && !n.archived);
  },

  clearError: () => {
    set({ error: null });
  },
}),
    {
      name: "nous-notebooks",
      partialize: (state) => ({
        selectedNotebookId: state.selectedNotebookId,
        notebookViewState: state.notebookViewState,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && !state.notebookViewState) {
          state.notebookViewState = {};
        }
      },
    }
  )
);
