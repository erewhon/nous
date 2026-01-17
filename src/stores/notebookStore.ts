import { create } from "zustand";
import type { Notebook, NotebookType } from "../types/notebook";
import * as api from "../utils/api";

interface NotebookState {
  notebooks: Notebook[];
  selectedNotebookId: string | null;
  showArchived: boolean;
  isLoading: boolean;
  error: string | null;
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

  // Selection
  selectNotebook: (id: string | null) => void;

  // Archive visibility
  toggleShowArchived: () => void;

  // Computed
  getVisibleNotebooks: () => Notebook[];
  getArchivedNotebooks: () => Notebook[];

  // Error handling
  clearError: () => void;
}

type NotebookStore = NotebookState & NotebookActions;

export const useNotebookStore = create<NotebookStore>((set, get) => ({
  // Initial state
  notebooks: [],
  selectedNotebookId: null,
  showArchived: false,
  isLoading: false,
  error: null,

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

  selectNotebook: (id) => {
    set({ selectedNotebookId: id });
  },

  toggleShowArchived: () => {
    set((state) => ({ showArchived: !state.showArchived }));
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

  clearError: () => {
    set({ error: null });
  },
}));
